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
