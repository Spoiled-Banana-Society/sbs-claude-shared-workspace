package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/Spoiled-Banana-Society/sbs-drafts-api/batchproof"
	draftActions "github.com/Spoiled-Banana-Society/sbs-drafts-api/draft-actions"
	draftState "github.com/Spoiled-Banana-Society/sbs-drafts-api/draft-state"
	"github.com/Spoiled-Banana-Society/sbs-drafts-api/leagues"
	"github.com/Spoiled-Banana-Society/sbs-drafts-api/models"
	"github.com/Spoiled-Banana-Society/sbs-drafts-api/owner"
	"github.com/Spoiled-Banana-Society/sbs-drafts-api/staging"
	"github.com/Spoiled-Banana-Society/sbs-drafts-api/utils"
	"github.com/go-chi/chi"
	"github.com/go-chi/chi/middleware"
	"github.com/go-chi/cors"
)

func main() {
	// Validate required environment variables at startup
	env := os.Getenv("ENVIRONMENT")
	if env == "" {
		log.Fatal("ENVIRONMENT environment variable is required")
	}

	// Validate environment-specific required variables
	if env == "prod" {
		if os.Getenv("PROD_GCP_CREDS_LOCATION") == "" {
			log.Fatal("PROD_GCP_CREDS_LOCATION is required when ENVIRONMENT=prod")
		}
		if os.Getenv("PROD_RT_DB_URL") == "" {
			log.Fatal("PROD_RT_DB_URL is required when ENVIRONMENT=prod")
		}
	} else {
		if os.Getenv("TEST_GCP_CREDS_LOCATION") == "" {
			log.Fatal("TEST_GCP_CREDS_LOCATION is required when ENVIRONMENT=dev")
		}
		if os.Getenv("TEST_RT_DB_URL") == "" {
			log.Fatal("TEST_RT_DB_URL is required when ENVIRONMENT=dev")
		}
	}

	// Validate Cloud Tasks variables (required for auto-draft functionality)
	if os.Getenv("GCP_PROJECT_ID") == "" {
		log.Fatal("GCP_PROJECT_ID is required for Cloud Tasks")
	}

	port := "8080"

	if fromEnv := os.Getenv("PORT"); fromEnv != "" {
		port = fromEnv
	}

	utils.NewDatabaseClient(false)

	// Publish the live draft-activity summary (in-progress fast drafts + furthest
	// round) to a single RTDB node every ~10s. Read-only, off the pick path,
	// panic-isolated, fail-closed. Kill with LIVE_ACTIVITY_AGGREGATOR=off.
	models.StartLiveActivityAggregator()

	// Initialize Cloud Tasks client for auto-draft functionality
	if err := utils.InitCloudTasksClient(false); err != nil {
		log.Fatalf("Failed to initialize Cloud Tasks client: %v", err)
	}

	fmt.Printf("Starting up on http://localhost:%s\n", port)

	r := chi.NewRouter()

	r.Use(middleware.Logger)

	// Sep Address 0xbf732e170b17107417568891f31c52e51998669e 2024 season
	// Mainnet Address 0x6b417828051328caef5b4e0bfe8325962ec8fb17 2024 season
	contractAddress := utils.GetenvOrDefault("ETH_CONTRACT_ADDRESS", "0x6b417828051328caef5b4e0bfe8325962ec8fb17")
	infuraKey := os.Getenv("INFURA_API_KEY")
	if infuraKey == "" {
		log.Fatal("INFURA_API_KEY environment variable is required")
	}
	infuraEndpoint := fmt.Sprintf("https://mainnet.infura.io/v3/%s", infuraKey)
	err := utils.CreateEthConnection(contractAddress, infuraEndpoint)
	if err != nil {
		fmt.Println("ERROR creating eth connection: ", err)
		panic(err)
	}

	// BBB4BatchProof — provably-fair commit/reveal for SBS draft batches
	// on Base mainnet. Independent of the legacy Ethereum mainnet
	// connection above; talks to a different chain + different contract.
	// Reads contract address from Firestore system_config/batchProof
	// (written by the in-app admin "Deploy BatchProof" button). Reads
	// signing key from BBB4_OWNER_PRIVATE_KEY (same admin wallet that
	// owns BBB4 + BBB4BatchProof). Best-effort init: if config or key is
	// missing, the manager runs in disabled mode and draft fills proceed
	// without batch proofs, producing the "pre-launch" status the
	// frontend already handles.
	if err := initBatchProof(); err != nil {
		fmt.Printf("[batchproof] init skipped: %v\n", err)
	}

	// CORS: Currently open for testing. TODO: Restrict origins once out of testing phase.
	corConfig := cors.New(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token"},
		ExposedHeaders:   []string{"Link"},
		AllowCredentials: true,
		MaxAge:           300,
	})
	r.Use(corConfig.Handler)

	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("Hello World"))
	})

	dr := &draftState.DraftResources{}
	r.Mount("/draft", dr.Routes())

	dra := &draftActions.DraftActionResources{}
	r.Mount("/draft-actions", dra.Routes())

	lr := &leagues.LeagueResources{}
	r.Mount("/league", lr.Routes())

	or := &owner.OwnerResources{}
	r.Mount("/owner", or.Routes())

	sr := &staging.StagingResources{}
	r.Mount("/staging", sr.Routes())

	log.Fatal(http.ListenAndServe(":"+port, r))
}

// initBatchProof wires the BBB4BatchProof manager. Returns nil on success
// (manager installed and ready) or a non-fatal error (manager left
// uninstalled; downstream callers Default() == nil and skip).
func initBatchProof() error {
	ctx := context.Background()

	cfg, err := batchproof.LoadSystemConfig(ctx, utils.Db.Client)
	if err != nil {
		return fmt.Errorf("read system_config/batchProof: %w", err)
	}

	privKey := os.Getenv("BBB4_OWNER_PRIVATE_KEY")
	if privKey == "" {
		return fmt.Errorf("BBB4_OWNER_PRIVATE_KEY env var not set")
	}

	rpcURL := utils.GetenvOrDefault("BASE_RPC_URL", "https://mainnet.base.org")

	variant := cfg.ContractVariant
	if variant == "" {
		variant = batchproof.VariantCommitReveal
	}

	client, err := batchproof.NewClient(batchproof.Config{
		RPCURL:          rpcURL,
		ContractAddress: cfg.ContractAddress,
		PrivateKeyHex:   privKey,
		Variant:         variant,
	})
	if err != nil {
		return fmt.Errorf("build client: %w", err)
	}

	mgr := batchproof.NewManager(client, utils.Db.Client, variant, "")

	// Optional: attach Merkle-variant contract client when system_config/
	// batchProofMerkle has been deployed via /api/admin/deploy-batch-proof-merkle.
	// The Merkle variant lives on a separate contract address from the
	// legacy vrf-commit variant, so we instantiate a second Client with
	// the same signer + RPC. If the doc isn't present, the Manager
	// gracefully runs without Merkle support and any attempt to use the
	// vrf-commit-merkle variant returns ErrMerkleClientNotConfigured.
	merkleCfg, merkleErr := batchproof.LoadMerkleSystemConfig(ctx, utils.Db.Client)
	if merkleErr != nil {
		fmt.Printf("[batchproof] WARN: failed to read system_config/batchProofMerkle: %v\n", merkleErr)
	} else if merkleCfg != nil {
		merkleClient, mcErr := batchproof.NewClient(batchproof.Config{
			RPCURL:          rpcURL,
			ContractAddress: merkleCfg.ContractAddress,
			PrivateKeyHex:   privKey,
			Variant:         batchproof.VariantVRFCommitMerkle,
		})
		if mcErr != nil {
			fmt.Printf("[batchproof] WARN: failed to build merkle client: %v\n", mcErr)
		} else {
			mgr.SetMerkleClient(merkleClient)
			fmt.Printf("[batchproof] merkle client attached: contract=%s\n", merkleClient.ContractAddress().Hex())
		}
	}

	batchproof.Set(mgr)
	fmt.Printf("[batchproof] manager initialized: variant=%s contract=%s signer=%s rpc=%s\n",
		variant, client.ContractAddress().Hex(), client.SignerAddress().Hex(), rpcURL)
	return nil
}
