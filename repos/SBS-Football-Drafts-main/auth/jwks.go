// Package auth verifies Privy JWT access tokens and extracts the caller's
// wallet, mirroring the Next.js implementation in banana-fantasy/lib/auth.ts.
//
// Identity resolution:
//   1. Caller sends Authorization: Bearer <jwt>.
//   2. JWT signature verified against Privy's JWKS (ES256 or RS256).
//   3. Wallet extracted from token payload (direct claim or linked_accounts).
//   4. Handlers must compare the verified wallet against any path-param
//      wallet (e.g. /owner/{ownerId}/...) and reject mismatches.
package auth

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"os"
	"sync"
	"time"
)

const jwksCacheTTL = time.Hour

type jwksKey struct {
	Kid string `json:"kid"`
	Kty string `json:"kty"`
	Crv string `json:"crv"`
	X   string `json:"x"`
	Y   string `json:"y"`
	N   string `json:"n"`
	E   string `json:"e"`
	Alg string `json:"alg"`
}

type jwksDoc struct {
	Keys []jwksKey `json:"keys"`
}

type cachedKey struct {
	rsa *rsa.PublicKey
	ec  *ecdsa.PublicKey
}

var (
	jwksMu       sync.Mutex
	jwksCache    map[string]cachedKey
	jwksCachedAt time.Time
)

func privyAppID() (string, error) {
	id := os.Getenv("PRIVY_APP_ID")
	if id == "" {
		id = os.Getenv("NEXT_PUBLIC_PRIVY_APP_ID")
	}
	if id == "" {
		return "", fmt.Errorf("PRIVY_APP_ID env var not set")
	}
	return id, nil
}

func jwksURL(appID string) string {
	return fmt.Sprintf("https://auth.privy.io/api/v1/apps/%s/jwks.json", appID)
}

func b64URLDecode(s string) ([]byte, error) {
	if pad := len(s) % 4; pad != 0 {
		s += "===="[:4-pad]
	}
	return base64.URLEncoding.WithPadding(base64.StdPadding).DecodeString(s)
}

func parseJWK(k jwksKey) (cachedKey, error) {
	switch k.Kty {
	case "EC":
		var curve elliptic.Curve
		switch k.Crv {
		case "P-256":
			curve = elliptic.P256()
		case "P-384":
			curve = elliptic.P384()
		case "P-521":
			curve = elliptic.P521()
		default:
			return cachedKey{}, fmt.Errorf("unsupported EC curve %s", k.Crv)
		}
		xb, err := b64URLDecode(k.X)
		if err != nil {
			return cachedKey{}, fmt.Errorf("decode EC x: %w", err)
		}
		yb, err := b64URLDecode(k.Y)
		if err != nil {
			return cachedKey{}, fmt.Errorf("decode EC y: %w", err)
		}
		return cachedKey{ec: &ecdsa.PublicKey{
			Curve: curve,
			X:     new(big.Int).SetBytes(xb),
			Y:     new(big.Int).SetBytes(yb),
		}}, nil
	case "RSA":
		nb, err := b64URLDecode(k.N)
		if err != nil {
			return cachedKey{}, fmt.Errorf("decode RSA n: %w", err)
		}
		eb, err := b64URLDecode(k.E)
		if err != nil {
			return cachedKey{}, fmt.Errorf("decode RSA e: %w", err)
		}
		return cachedKey{rsa: &rsa.PublicKey{
			N: new(big.Int).SetBytes(nb),
			E: int(new(big.Int).SetBytes(eb).Int64()),
		}}, nil
	default:
		return cachedKey{}, fmt.Errorf("unsupported kty %s", k.Kty)
	}
}

// refreshJWKS fetches and parses Privy's JWKS document, replacing the cache.
// Caller must hold jwksMu.
func refreshJWKS() error {
	appID, err := privyAppID()
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodGet, jwksURL(appID), nil)
	if err != nil {
		return fmt.Errorf("build JWKS request: %w", err)
	}
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("fetch JWKS: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("JWKS HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read JWKS: %w", err)
	}
	var doc jwksDoc
	if err := json.Unmarshal(body, &doc); err != nil {
		return fmt.Errorf("parse JWKS: %w", err)
	}
	next := make(map[string]cachedKey, len(doc.Keys))
	for _, k := range doc.Keys {
		parsed, err := parseJWK(k)
		if err != nil {
			// Skip unparseable key, log nothing — Privy may rotate in keys we
			// don't yet support; the rest of the doc is still useful.
			continue
		}
		next[k.Kid] = parsed
	}
	jwksCache = next
	jwksCachedAt = time.Now()
	return nil
}

// keyForKid returns the cached key for the given kid, refreshing the cache
// once if it's stale or the kid is unknown.
func keyForKid(kid string, forceRefresh bool) (cachedKey, error) {
	jwksMu.Lock()
	defer jwksMu.Unlock()
	stale := jwksCachedAt.IsZero() || time.Since(jwksCachedAt) > jwksCacheTTL
	if !forceRefresh && !stale {
		if k, ok := jwksCache[kid]; ok {
			return k, nil
		}
	}
	if err := refreshJWKS(); err != nil {
		return cachedKey{}, err
	}
	k, ok := jwksCache[kid]
	if !ok {
		return cachedKey{}, fmt.Errorf("unknown JWKS kid %s", kid)
	}
	return k, nil
}
