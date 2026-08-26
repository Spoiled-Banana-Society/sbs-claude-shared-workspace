package models

import (
	"testing"
	"time"
)

func TestSlowDraftPickEndUnix_9PMTo12PMNextDay(t *testing.T) {
	// 9pm PT Jan 2, 2024 + 8h effective: 1h (21:00->22:00) then pause to 05:00,
	// then 7h -> 12pm PT Jan 3, 2024
	start := time.Date(2024, 1, 2, 21, 0, 0, 0, pacific).Unix()
	want := time.Date(2024, 1, 3, 12, 0, 0, 0, pacific).Unix()
	got := SlowDraftPickEndUnix(start, 8*3600)
	if got != want {
		t.Fatalf("SlowDraftPickEndUnix = %d (%s), want %d (%s)",
			got, time.Unix(got, 0).In(pacific).Format(time.RFC3339),
			want, time.Unix(want, 0).In(pacific).Format(time.RFC3339))
	}
}

func TestSlowDraftPickEndUnix_2AMStartsAfter5AM(t *testing.T) {
	// 2am PT -> clock starts 5am same day, +8h -> 1pm same day
	start := time.Date(2024, 6, 10, 2, 0, 0, 0, pacific).Unix()
	want := time.Date(2024, 6, 10, 13, 0, 0, 0, pacific).Unix()
	got := SlowDraftPickEndUnix(start, 8*3600)
	if got != want {
		t.Fatalf("SlowDraftPickEndUnix = %d (%s), want %d (%s)",
			got, time.Unix(got, 0).In(pacific).Format(time.RFC3339),
			want, time.Unix(want, 0).In(pacific).Format(time.RFC3339))
	}
}

func TestSlowDraftEffectiveElapsed_9PMTo10PM(t *testing.T) {
	start := time.Date(2024, 1, 2, 21, 0, 0, 0, pacific).Unix()
	end := time.Date(2024, 1, 2, 22, 0, 0, 0, pacific).Unix()
	got := SlowDraftEffectiveElapsedSeconds(start, end)
	if got != 3600 {
		t.Fatalf("effective elapsed = %d, want 3600", got)
	}
}

func TestSlowDraftPickEndRoundTrip(t *testing.T) {
	start := time.Date(2024, 3, 15, 10, 30, 0, 0, pacific).Unix()
	pickLen := int64(12345)
	end := SlowDraftPickEndUnix(start, pickLen)
	elapsed := SlowDraftEffectiveElapsedSeconds(start, end)
	if elapsed != pickLen {
		t.Fatalf("elapsed %d != pickLen %d", elapsed, pickLen)
	}
}

// ── Fresh-clock-after-pause (system_config/slowDraftClock.freshClockAfterPause) ──

func TestSlowDraftPickEndUnix_Fresh_9PMRestartsFullAt5AM(t *testing.T) {
	// 9pm PT + 4h fresh: 1h burns (21→22), then a FULL 4h from 05:00 → 9am.
	start := time.Date(2026, 8, 26, 21, 0, 0, 0, pacific).Unix()
	want := time.Date(2026, 8, 27, 9, 0, 0, 0, pacific).Unix()
	got := slowDraftPickEndUnixOpts(start, 4*3600, true)
	if got != want {
		t.Fatalf("fresh = %s, want %s", time.Unix(got, 0).In(pacific).Format(time.RFC3339), time.Unix(want, 0).In(pacific).Format(time.RFC3339))
	}
	// Legacy carry-over for the same input: 1h + 3h → 8am.
	wantLegacy := time.Date(2026, 8, 27, 8, 0, 0, 0, pacific).Unix()
	if got := slowDraftPickEndUnixOpts(start, 4*3600, false); got != wantLegacy {
		t.Fatalf("legacy = %s, want %s", time.Unix(got, 0).In(pacific).Format(time.RFC3339), time.Unix(wantLegacy, 0).In(pacific).Format(time.RFC3339))
	}
}

func TestSlowDraftPickEndUnix_Fresh_NoStraddleUnchanged(t *testing.T) {
	// 10am + 4h never touches the pause → identical either way.
	start := time.Date(2026, 8, 26, 10, 0, 0, 0, pacific).Unix()
	want := time.Date(2026, 8, 26, 14, 0, 0, 0, pacific).Unix()
	if got := slowDraftPickEndUnixOpts(start, 4*3600, true); got != want {
		t.Fatalf("fresh no-straddle = %d, want %d", got, want)
	}
	if got := slowDraftPickEndUnixOpts(start, 4*3600, false); got != want {
		t.Fatalf("legacy no-straddle = %d, want %d", got, want)
	}
}

func TestSlowDraftPickEndUnix_Fresh_DuringPauseStartsFullAt5AM(t *testing.T) {
	// 2am PT: clock hasn't started; both modes → 05:00 + 4h = 9am.
	start := time.Date(2026, 8, 27, 2, 0, 0, 0, pacific).Unix()
	want := time.Date(2026, 8, 27, 9, 0, 0, 0, pacific).Unix()
	if got := slowDraftPickEndUnixOpts(start, 4*3600, true); got != want {
		t.Fatalf("fresh in-pause = %d, want %d", got, want)
	}
}

func TestSlowDraftPickEndUnix_Fresh_TooLongFallsBackToCarryOver(t *testing.T) {
	// 18h can never fit one active window; fresh must degrade to carry-over, not loop forever.
	start := time.Date(2026, 8, 26, 6, 0, 0, 0, pacific).Unix()
	got := slowDraftPickEndUnixOpts(start, 18*3600, true)
	want := slowDraftPickEndUnixOpts(start, 18*3600, false)
	if got != want {
		t.Fatalf("fresh too-long = %d, want carry-over %d", got, want)
	}
}

func TestSlowDraftEffectivePickLength_SwitchOffIsLegacy(t *testing.T) {
	// No Firestore client in tests → switch reads as OFF.
	if got := SlowDraftEffectivePickLength(0); got != 8*3600 {
		t.Fatalf("default = %d, want 28800", got)
	}
	if got := SlowDraftEffectivePickLength(12345); got != 12345 {
		t.Fatalf("stored passthrough = %d, want 12345", got)
	}
	if SlowDraftFreshClockAfterPause() {
		t.Fatal("fresh clock must be OFF with no config")
	}
}
