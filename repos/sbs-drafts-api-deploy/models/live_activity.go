package models

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/Spoiled-Banana-Society/sbs-drafts-api/utils"
)

// live_activity.go — a lightweight, READ-ONLY aggregator that publishes a single
// RTDB summary node the app (lobby + draft room) subscribes to, and the fill-alert
// feed reads at post time: how many FAST drafts are currently in progress, and the
// furthest-along round among them. Purpose is a "keep waiting" nudge — a draft is
// about to wrap, and those players roll into the next room, so don't leave.
//
// Design constraints (informed by the draft-freeze / Firestore-wedge incidents):
//   - READ-ONLY against draft state. Writes ONE isolated node (stats/liveDraftActivity).
//     It can never mutate a draft, so it can never wedge one.
//   - OFF the hot pick path — a standalone ticker in its own goroutine.
//   - Bounded work per tick: scans a window of RECENT fast-draft ids (mirrors the
//     scanForPartialLeague lookback idiom) instead of reading the whole `drafts`
//     RTDB node, which accumulates every draft ever filled (never pruned in prod).
//   - Fail-closed: stamps updatedAt every tick so a stalled/dead aggregator makes
//     every reader HIDE the line rather than show a frozen number.
//   - Panic-isolated: a bad tick (or a single bad read) is recovered and logged;
//     it never stops the ticker or takes down the process.
//
// SLOW drafts are excluded by construction — only "<season>-fast-draft-<n>" ids are
// scanned. Wheel-won special JP/HOF drafts (their own id sequence) are likewise not
// counted; this reflects only the regular fast-draft pool.

const (
	liveActivityRTDBPath    = "stats/liveDraftActivity"
	liveActivityTickSeconds = 10
	liveActivityScanWindow  = 100 // recent fast-draft ids to check each tick
	liveActivityReadWorkers = 20  // bounded concurrency for per-node RTDB reads
	liveActivityIOTimeout   = 5 * time.Second
)

// StartLiveActivityAggregator launches the background ticker. Disable without a
// code change by setting LIVE_ACTIVITY_AGGREGATOR=off. The scan depth can be
// tuned with LIVE_ACTIVITY_SCAN_WINDOW (default 100).
func StartLiveActivityAggregator() {
	if os.Getenv("LIVE_ACTIVITY_AGGREGATOR") == "off" {
		fmt.Println("[live-activity] aggregator disabled via LIVE_ACTIVITY_AGGREGATOR=off")
		return
	}
	window := liveActivityScanWindow
	if v := os.Getenv("LIVE_ACTIVITY_SCAN_WINDOW"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			window = n
		}
	}
	go func() {
		// A panic here must never take the server down; log and relaunch.
		defer func() {
			if r := recover(); r != nil {
				fmt.Printf("[live-activity] aggregator panic recovered: %v — relaunching in 30s\n", r)
				time.Sleep(30 * time.Second)
				StartLiveActivityAggregator()
			}
		}()
		ticker := time.NewTicker(liveActivityTickSeconds * time.Second)
		defer ticker.Stop()
		fmt.Printf("[live-activity] aggregator started (window=%d, tick=%ds)\n", window, liveActivityTickSeconds)
		publishLiveActivity(window) // publish once immediately so the value exists at boot
		for range ticker.C {
			publishLiveActivity(window)
		}
	}()
}

// publishLiveActivity computes {count, round} over in-progress FAST drafts and
// writes the summary node. Every error is swallowed with a log line — a bad tick
// must never stop the ticker.
func publishLiveActivity(window int) {
	defer func() {
		if r := recover(); r != nil {
			fmt.Printf("[live-activity] tick panic recovered: %v\n", r)
		}
	}()

	// The fast-draft id sequence == CurrentLiveDraftCount, so this is the highest
	// fast-draft number in existence. ReadDocument routes through the Firestore
	// retry wrapper.
	var counts DraftLeagueTracker
	if err := utils.Db.ReadDocument("drafts", "draftTracker", &counts); err != nil {
		fmt.Printf("[live-activity] draftTracker read failed, skipping tick: %v\n", err)
		return
	}
	maxN := counts.CurrentLiveDraftCount
	if maxN <= 0 {
		writeLiveActivity(0, 0)
		return
	}

	lo := maxN - window + 1
	if lo < 1 {
		lo = 1
	}

	var (
		wg       sync.WaitGroup
		mu       sync.Mutex
		count    int
		maxRound int
		sem      = make(chan struct{}, liveActivityReadWorkers)
	)
	for n := maxN; n >= lo; n-- {
		wg.Add(1)
		sem <- struct{}{}
		go func(n int) {
			defer wg.Done()
			defer func() { <-sem }()
			defer func() { _ = recover() }() // isolate a single bad read

			draftId := fmt.Sprintf("%s-fast-draft-%d", seasonYear, n)
			ctx, cancel := context.WithTimeout(context.Background(), liveActivityIOTimeout)
			defer cancel()

			ref := utils.Db.RTdb.NewRef(fmt.Sprintf("drafts/%s/realTimeDraftInfo", draftId))
			var info RealTimeDraftInfo
			if err := ref.Get(ctx, &info); err != nil {
				return
			}
			// A missing RTDB node deserializes to an all-zero struct, which must
			// NOT be counted. A genuine in-progress draft has started
			// (DraftStartTime>0, pick>=1, round>=1) and is not complete.
			if info.IsDraftComplete || info.DraftStartTime <= 0 || info.CurrentPickNumber < 1 || info.CurrentRound < 1 {
				return
			}
			mu.Lock()
			count++
			if info.CurrentRound > maxRound {
				maxRound = info.CurrentRound
			}
			mu.Unlock()
		}(n)
	}
	wg.Wait()

	writeLiveActivity(count, maxRound)
}

// writeLiveActivity publishes the single summary node. round is 0 when count is 0;
// readers hide the line when count < 1. updatedAt (unix ms) drives fail-closed
// staleness on the reader side.
func writeLiveActivity(count, round int) {
	ctx, cancel := context.WithTimeout(context.Background(), liveActivityIOTimeout)
	defer cancel()
	ref := utils.Db.RTdb.NewRef(liveActivityRTDBPath)
	payload := map[string]interface{}{
		"count":     count,
		"round":     round,
		"updatedAt": time.Now().UnixMilli(),
	}
	if err := ref.Set(ctx, payload); err != nil {
		fmt.Printf("[live-activity] publish failed: %v\n", err)
		return
	}
	fmt.Printf("[live-activity] published count=%d round=%d\n", count, round)
}
