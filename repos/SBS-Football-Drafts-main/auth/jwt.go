package auth

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"strings"
	"time"
)

// VerifiedUser is the result of a successful Privy JWT verification.
type VerifiedUser struct {
	UserID        string // Privy DID, e.g. "did:privy:xxx"
	WalletAddress string // lowercased, may be empty if JWT had no wallet claim
}

// VerifyAccessToken parses and verifies a Privy access token. Returns a
// VerifiedUser on success or a descriptive error on any failure (bad
// signature, expired, wrong audience, etc.). Designed to mirror the TS
// implementation in lib/auth.ts.
func VerifyAccessToken(token string) (*VerifiedUser, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, fmt.Errorf("invalid auth token")
	}
	headerJSON, err := b64URLDecode(parts[0])
	if err != nil {
		return nil, fmt.Errorf("invalid auth token header: %w", err)
	}
	payloadJSON, err := b64URLDecode(parts[1])
	if err != nil {
		return nil, fmt.Errorf("invalid auth token payload: %w", err)
	}
	signature, err := b64URLDecode(parts[2])
	if err != nil {
		return nil, fmt.Errorf("invalid auth token signature: %w", err)
	}

	var header struct {
		Alg string `json:"alg"`
		Kid string `json:"kid"`
	}
	if err := json.Unmarshal(headerJSON, &header); err != nil {
		return nil, fmt.Errorf("parse JWT header: %w", err)
	}
	if header.Alg != "ES256" && header.Alg != "RS256" {
		return nil, fmt.Errorf("unsupported alg %s", header.Alg)
	}
	if header.Kid == "" {
		return nil, fmt.Errorf("missing kid in JWT header")
	}

	signingInput := []byte(parts[0] + "." + parts[1])

	verifySig := func(forceRefresh bool) (bool, error) {
		key, err := keyForKid(header.Kid, forceRefresh)
		if err != nil {
			return false, err
		}
		return verifySignature(header.Alg, key, signingInput, signature)
	}

	ok, err := verifySig(false)
	if err != nil || !ok {
		// Retry once with a forced JWKS refresh — covers the case where Privy
		// has rotated keys since our cache was last loaded.
		ok, err = verifySig(true)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, fmt.Errorf("token signature verification failed")
		}
	}

	var payload map[string]any
	if err := json.Unmarshal(payloadJSON, &payload); err != nil {
		return nil, fmt.Errorf("parse JWT payload: %w", err)
	}

	if exp, ok := payload["exp"].(float64); ok {
		if time.Now().Unix() >= int64(exp) {
			return nil, fmt.Errorf("auth token expired")
		}
	}

	if aud, ok := payload["aud"]; ok && aud != nil {
		expectedAud, audErr := privyAppID()
		if audErr != nil {
			return nil, audErr
		}
		switch v := aud.(type) {
		case string:
			if v != expectedAud {
				return nil, fmt.Errorf("invalid auth token audience")
			}
		case []any:
			matched := false
			for _, candidate := range v {
				if s, ok := candidate.(string); ok && s == expectedAud {
					matched = true
					break
				}
			}
			if !matched {
				return nil, fmt.Errorf("invalid auth token audience")
			}
		}
	}

	if expectedIss := strings.TrimSpace(os.Getenv("PRIVY_JWT_ISSUER")); expectedIss != "" {
		if iss, ok := payload["iss"].(string); ok && iss != expectedIss {
			return nil, fmt.Errorf("invalid auth token issuer")
		}
	}

	user := &VerifiedUser{}
	if sub, ok := payload["sub"].(string); ok && sub != "" {
		user.UserID = sub
	} else if userID, ok := payload["user_id"].(string); ok && userID != "" {
		user.UserID = userID
	} else if userID, ok := payload["userId"].(string); ok && userID != "" {
		user.UserID = userID
	}
	if user.UserID == "" {
		return nil, fmt.Errorf("invalid auth token (no subject)")
	}

	user.WalletAddress = strings.ToLower(walletFromPayload(payload))

	return user, nil
}

func walletFromPayload(payload map[string]any) string {
	for _, key := range []string{"walletAddress", "wallet_address", "address", "user_wallet_address"} {
		if v, ok := payload[key].(string); ok {
			if trimmed := strings.TrimSpace(v); trimmed != "" {
				return trimmed
			}
		}
	}
	if linked, ok := payload["linked_accounts"].([]any); ok {
		for _, account := range linked {
			obj, ok := account.(map[string]any)
			if !ok {
				continue
			}
			if t, _ := obj["type"].(string); t != "wallet" {
				continue
			}
			if addr, ok := obj["address"].(string); ok {
				if trimmed := strings.TrimSpace(addr); trimmed != "" {
					return trimmed
				}
			}
		}
	}
	return ""
}

func verifySignature(alg string, key cachedKey, signingInput, signature []byte) (bool, error) {
	digest := sha256.Sum256(signingInput)
	switch alg {
	case "RS256":
		if key.rsa == nil {
			return false, fmt.Errorf("kid is EC but token alg is RS256")
		}
		err := rsa.VerifyPKCS1v15(key.rsa, crypto.SHA256, digest[:], signature)
		return err == nil, nil
	case "ES256":
		if key.ec == nil {
			return false, fmt.Errorf("kid is RSA but token alg is ES256")
		}
		// IEEE P1363 form: r || s, each 32 bytes for P-256.
		if len(signature) != 64 {
			return false, fmt.Errorf("ES256 signature must be 64 bytes")
		}
		r := new(big.Int).SetBytes(signature[:32])
		s := new(big.Int).SetBytes(signature[32:])
		return ecdsa.Verify(key.ec, digest[:], r, s), nil
	default:
		return false, fmt.Errorf("unsupported alg %s", alg)
	}
}
