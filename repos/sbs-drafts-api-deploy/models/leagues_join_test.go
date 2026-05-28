package models

import (
	"fmt"
	"sync"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// selectLowestPartialLeague: concurrent fan-out + same selection as the old
// sequential scanForPartialLeague (lowest-numbered partial league this owner
// is not already in, within the lookback window).
// ---------------------------------------------------------------------------

func TestSelectLowestPartialLeague_PicksLowestEligible(t *testing.T) {
	const owner = "0xowner"
	// Seed: 5 full, 7 partial (owner not in), 9 partial (owner IS in), 11 partial (owner not in).
	// Eligible = {7, 11}; lowest = 7. (5 is full, 9 already contains owner.)
	seeded := map[int]*League{
		5:  {NumPlayers: 10, CurrentUsers: []LeagueUser{}},
		7:  {NumPlayers: 3, CurrentUsers: []LeagueUser{{OwnerId: "0xa"}}},
		9:  {NumPlayers: 4, CurrentUsers: []LeagueUser{{OwnerId: owner}}},
		11: {NumPlayers: 2, CurrentUsers: []LeagueUser{{OwnerId: "0xb"}}},
	}
	read := func(n int) (*League, bool) {
		l, ok := seeded[n]
		return l, ok
	}
	got := selectLowestPartialLeague(20, 30, owner, read)
	if got != 7 {
		t.Fatalf("selectLowestPartialLeague = %d, want 7", got)
	}
}

func TestSelectLowestPartialLeague_NoneEligibleReturnsZero(t *testing.T) {
	read := func(n int) (*League, bool) {
		// every candidate is full
		return &League{NumPlayers: 10}, true
	}
	if got := selectLowestPartialLeague(20, 30, "0xowner", read); got != 0 {
		t.Fatalf("selectLowestPartialLeague = %d, want 0 when nothing eligible", got)
	}
}

func TestSelectLowestPartialLeague_RespectsLookbackWindow(t *testing.T) {
	// Only an eligible league OUTSIDE the lookback window exists -> not found.
	seeded := map[int]*League{
		1: {NumPlayers: 2, CurrentUsers: []LeagueUser{{OwnerId: "0xa"}}},
	}
	read := func(n int) (*League, bool) {
		l, ok := seeded[n]
		return l, ok
	}
	// startFrom=40, window=30 -> scans 40..11, so n=1 is out of range.
	if got := selectLowestPartialLeague(40, 30, "0xowner", read); got != 0 {
		t.Fatalf("selectLowestPartialLeague = %d, want 0 (n=1 outside lookback)", got)
	}
}

func TestSelectLowestPartialLeague_ReadsRunConcurrently(t *testing.T) {
	const perReadDelay = 20 * time.Millisecond
	const lookback = 30
	var mu sync.Mutex
	var starts []time.Time
	read := func(n int) (*League, bool) {
		mu.Lock()
		starts = append(starts, time.Now())
		mu.Unlock()
		time.Sleep(perReadDelay) // simulate a Firestore round-trip
		return nil, false        // NotFound for all -> exercises the full fan-out
	}

	overallStart := time.Now()
	selectLowestPartialLeague(30, lookback, "0xowner", read)
	elapsed := time.Since(overallStart)

	// Sequential would be ~lookback*perReadDelay (600ms). Concurrent should be
	// close to a single delay. Assert well under half the sequential total.
	if elapsed > (lookback*perReadDelay)/2 {
		t.Fatalf("reads not concurrent: elapsed %v, sequential would be ~%v", elapsed, lookback*perReadDelay)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(starts) != lookback {
		t.Fatalf("expected %d reads, got %d", lookback, len(starts))
	}
	// All reads should have started within a tight window of each other.
	min, max := starts[0], starts[0]
	for _, s := range starts {
		if s.Before(min) {
			min = s
		}
		if s.After(max) {
			max = s
		}
	}
	if spread := max.Sub(min); spread > perReadDelay {
		t.Fatalf("reads did not start concurrently: spread %v", spread)
	}
}

// ---------------------------------------------------------------------------
// runConcurrently: run independent writes (cleanup, per-user state) in
// parallel, wait for all, return the first error.
// ---------------------------------------------------------------------------

func TestRunConcurrently_AllRun(t *testing.T) {
	var n int32
	var mu sync.Mutex
	inc := func() error { mu.Lock(); n++; mu.Unlock(); return nil }
	if err := runConcurrently(inc, inc, inc); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if n != 3 {
		t.Fatalf("expected 3 fns to run, ran %d", n)
	}
}

func TestRunConcurrently_RunsInParallel(t *testing.T) {
	const delay = 40 * time.Millisecond
	fn := func() error { time.Sleep(delay); return nil }
	start := time.Now()
	if err := runConcurrently(fn, fn, fn); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if elapsed := time.Since(start); elapsed > 2*delay {
		t.Fatalf("not parallel: elapsed %v for 3x%v work", elapsed, delay)
	}
}

func TestRunConcurrently_PropagatesError(t *testing.T) {
	ok := func() error { return nil }
	boom := func() error { return fmt.Errorf("write failed") }
	if err := runConcurrently(ok, boom, ok); err == nil {
		t.Fatal("expected an error to propagate, got nil")
	}
}

func TestRunConcurrently_NoFns(t *testing.T) {
	if err := runConcurrently(); err != nil {
		t.Fatalf("unexpected error for zero fns: %v", err)
	}
}
