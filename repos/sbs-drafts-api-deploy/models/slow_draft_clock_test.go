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
	got := slowDraftPickEndUnixOpts(start, 4*3600, true, 5)
	if got != want {
		t.Fatalf("fresh = %s, want %s", time.Unix(got, 0).In(pacific).Format(time.RFC3339), time.Unix(want, 0).In(pacific).Format(time.RFC3339))
	}
	// Legacy carry-over for the same input: 1h + 3h → 8am.
	wantLegacy := time.Date(2026, 8, 27, 8, 0, 0, 0, pacific).Unix()
	if got := slowDraftPickEndUnixOpts(start, 4*3600, false, 5); got != wantLegacy {
		t.Fatalf("legacy = %s, want %s", time.Unix(got, 0).In(pacific).Format(time.RFC3339), time.Unix(wantLegacy, 0).In(pacific).Format(time.RFC3339))
	}
}

func TestSlowDraftPickEndUnix_Fresh_NoStraddleUnchanged(t *testing.T) {
	// 10am + 4h never touches the pause → identical either way.
	start := time.Date(2026, 8, 26, 10, 0, 0, 0, pacific).Unix()
	want := time.Date(2026, 8, 26, 14, 0, 0, 0, pacific).Unix()
	if got := slowDraftPickEndUnixOpts(start, 4*3600, true, 5); got != want {
		t.Fatalf("fresh no-straddle = %d, want %d", got, want)
	}
	if got := slowDraftPickEndUnixOpts(start, 4*3600, false, 5); got != want {
		t.Fatalf("legacy no-straddle = %d, want %d", got, want)
	}
}

func TestSlowDraftPickEndUnix_Fresh_DuringPauseStartsFullAt5AM(t *testing.T) {
	// 2am PT: clock hasn't started; both modes → 05:00 + 4h = 9am.
	start := time.Date(2026, 8, 27, 2, 0, 0, 0, pacific).Unix()
	want := time.Date(2026, 8, 27, 9, 0, 0, 0, pacific).Unix()
	if got := slowDraftPickEndUnixOpts(start, 4*3600, true, 5); got != want {
		t.Fatalf("fresh in-pause = %d, want %d", got, want)
	}
}

func TestSlowDraftPickEndUnix_Fresh_TooLongFallsBackToCarryOver(t *testing.T) {
	// 18h can never fit one active window; fresh must degrade to carry-over, not loop forever.
	start := time.Date(2026, 8, 26, 6, 0, 0, 0, pacific).Unix()
	got := slowDraftPickEndUnixOpts(start, 18*3600, true, 5)
	want := slowDraftPickEndUnixOpts(start, 18*3600, false, 5)
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

func TestSlowDraftClockConfig_StartsAtGate(t *testing.T) {
	now := time.Date(2026, 8, 26, 20, 0, 0, 0, pacific)
	c := SlowDraftClockConfig{Enabled: true, PickLengthSec: 14400, FreshClockAfterPause: true, StartsAtIso: "2026-08-27T12:00:00Z"}
	if c.active(now) {
		t.Fatal("must be inactive before startsAt")
	}
	if !c.active(now.Add(24 * time.Hour)) {
		t.Fatal("must be active after startsAt")
	}
	if !(SlowDraftClockConfig{Enabled: true}).active(now) {
		t.Fatal("no gate → active")
	}
	if !(SlowDraftClockConfig{Enabled: true, StartsAtIso: "garbage"}).active(now) {
		t.Fatal("bad gate → treated as no gate")
	}
	if (SlowDraftClockConfig{Enabled: false, StartsAtIso: "2020-01-01T00:00:00Z"}).active(now) {
		t.Fatal("disabled stays off")
	}
}

func TestSlowDraftPickEndUnix_PauseEnds7AM(t *testing.T) {
	// 9pm + 4h fresh, pause 22:00–07:00 → 07:00 + 4h = 11am.
	start := time.Date(2026, 8, 26, 21, 0, 0, 0, pacific).Unix()
	want := time.Date(2026, 8, 27, 11, 0, 0, 0, pacific).Unix()
	if got := slowDraftPickEndUnixOpts(start, 4*3600, true, 7); got != want {
		t.Fatalf("7am fresh = %s, want %s", time.Unix(got, 0).In(pacific).Format(time.RFC3339), time.Unix(want, 0).In(pacific).Format(time.RFC3339))
	}
	// 6am is still paused with a 7am end → clock starts 07:00 → 11am.
	start6 := time.Date(2026, 8, 27, 6, 0, 0, 0, pacific).Unix()
	if got := slowDraftPickEndUnixOpts(start6, 4*3600, true, 7); got != want {
		t.Fatalf("6am start with 7am pause end = %d, want %d", got, want)
	}
	if !slowDraftInNightPauseAt(time.Date(2026, 8, 27, 6, 30, 0, 0, pacific), 7) {
		t.Fatal("06:30 must be paused when pause ends at 7")
	}
	if slowDraftInNightPauseAt(time.Date(2026, 8, 27, 6, 30, 0, 0, pacific), 5) {
		t.Fatal("06:30 must be active on legacy 5am")
	}
	// Elapsed across the pause with 7am end: 9pm→noon = 1h + 5h.
	if got := slowDraftEffectiveElapsedSecondsAt(start, time.Date(2026, 8, 27, 12, 0, 0, 0, pacific).Unix(), 7); got != 6*3600 {
		t.Fatalf("elapsed = %d, want %d", got, 6*3600)
	}
	if SlowDraftPauseEndHour() != 5 {
		t.Fatal("no config → legacy 5am")
	}
}
