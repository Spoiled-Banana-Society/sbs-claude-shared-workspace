package models

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/Spoiled-Banana-Society/sbs-drafts-api/utils"
)

// Slow-draft clock switch — system_config/slowDraftClock.
//
// Ships DARK. While the doc is missing or enabled=false every helper below
// returns the legacy behaviour (8h picks, the overnight pause carries the
// remaining clock over). Flipping enabled=true is the green light:
//
//   {
//     enabled: true,
//     pickLengthSec: 14400,        // 4h — match Underdog 1:1; change here, no deploy
//     freshClockAfterPause: true,  // pick that straddles 22:00 PT restarts with a FULL clock at 05:00 PT
//   }
//
// Applies to EVERY slow draft, including ones already in progress: the stored
// PickLength on the draft doc is overridden at each pick advance
// (ProcessNewPick / watchdog re-arm / draft creation). The pick currently on
// the clock keeps the PickEndTime it was armed with; the next pick gets the
// new clock.
//
// Read through a 60s in-process cache so it costs one Firestore read a minute
// per instance, never one per pick.

const (
	slowDraftLegacyPickLengthSec int64 = 8 * 3600
	slowDraftClockConfigDoc            = "slowDraftClock"
	slowDraftClockConfigTTL            = 60 * time.Second
	// Longest pick that can still finish inside one 05:00–22:00 active window.
	// The fresh-clock rule is only meaningful below this; above it the pick
	// could never end and we fall back to carry-over.
	slowDraftActiveWindowSec int64 = 17 * 3600
)

type SlowDraftClockConfig struct {
	Enabled              bool  `firestore:"enabled"`
	PickLengthSec        int64 `firestore:"pickLengthSec"`
	FreshClockAfterPause bool  `firestore:"freshClockAfterPause"`
	// Optional RFC3339 instant. While set and in the future the switch reads
	// as OFF even if Enabled — lets Richard arm it today for "5am PT tomorrow"
	// without anything having to wake up and flip it.
	StartsAtIso string `firestore:"startsAtIso"`
}

// active reports whether the switch is in force right now (Enabled AND past
// StartsAtIso, if any). An unparseable StartsAtIso is treated as "no gate".
func (c SlowDraftClockConfig) active(now time.Time) bool {
	if !c.Enabled {
		return false
	}
	if c.StartsAtIso == "" {
		return true
	}
	t, err := time.Parse(time.RFC3339, c.StartsAtIso)
	if err != nil {
		return true
	}
	return !now.Before(t)
}

var (
	slowClockCfgMu     sync.Mutex
	slowClockCfgCached SlowDraftClockConfig
	slowClockCfgAt     time.Time
	slowClockCfgLoaded bool
)

// LoadSlowDraftClockConfig returns the current switch state. Nil-safe (tests,
// startup): with no Firestore client it reports disabled. On a read error it
// keeps serving the last good value rather than flapping back to legacy.
func LoadSlowDraftClockConfig() SlowDraftClockConfig {
	if utils.Db == nil || utils.Db.Client == nil {
		return SlowDraftClockConfig{}
	}
	slowClockCfgMu.Lock()
	defer slowClockCfgMu.Unlock()
	if slowClockCfgLoaded && time.Since(slowClockCfgAt) < slowDraftClockConfigTTL {
		return slowClockCfgCached
	}
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	snap, err := utils.Db.Client.Collection("system_config").Doc(slowDraftClockConfigDoc).Get(ctx)
	if err != nil {
		if !slowClockCfgLoaded {
			// Missing doc == switch off. Cache that so we don't re-read every pick.
			slowClockCfgCached = SlowDraftClockConfig{}
			slowClockCfgLoaded = true
			slowClockCfgAt = time.Now()
		} else {
			fmt.Printf("[slowclock] WARN config read failed, serving cached: %v\n", err)
		}
		return slowClockCfgCached
	}
	var cfg SlowDraftClockConfig
	if derr := snap.DataTo(&cfg); derr != nil {
		fmt.Printf("[slowclock] WARN config decode failed, serving cached: %v\n", derr)
		return slowClockCfgCached
	}
	if slowClockCfgCached != cfg {
		fmt.Printf("[slowclock] config now enabled=%v pickLengthSec=%d freshClockAfterPause=%v startsAt=%q active=%v\n",
			cfg.Enabled, cfg.PickLengthSec, cfg.FreshClockAfterPause, cfg.StartsAtIso, cfg.active(time.Now()))
	}
	slowClockCfgCached = cfg
	slowClockCfgLoaded = true
	slowClockCfgAt = time.Now()
	return cfg
}

// SlowDraftEffectivePickLength is the pick clock a slow draft should be armed
// with RIGHT NOW. Switch on → the configured length (overrides whatever the
// draft doc stored at creation). Switch off → the stored value, or the 8h
// legacy default when the doc has none.
func SlowDraftEffectivePickLength(stored int64) int64 {
	cfg := LoadSlowDraftClockConfig()
	if cfg.active(time.Now()) && cfg.PickLengthSec > 0 {
		return cfg.PickLengthSec
	}
	if stored > 0 {
		return stored
	}
	return slowDraftLegacyPickLengthSec
}

// SlowDraftFreshClockAfterPause reports whether a pick that straddles the
// overnight pause restarts with a full clock at 05:00 PT.
func SlowDraftFreshClockAfterPause() bool {
	cfg := LoadSlowDraftClockConfig()
	return cfg.active(time.Now()) && cfg.FreshClockAfterPause
}
