package models

import (
	"testing"
	"time"
)

func TestSlowDraftPickEndUnix_9PMTo3PMNextDay(t *testing.T) {
	// 9pm EST Jan 2, 2024 + 8h effective -> 3pm EST Jan 3, 2024
	start := time.Date(2024, 1, 2, 21, 0, 0, 0, americaNewYork).Unix()
	want := time.Date(2024, 1, 3, 15, 0, 0, 0, americaNewYork).Unix()
	got := SlowDraftPickEndUnix(start, 8*3600)
	if got != want {
		t.Fatalf("SlowDraftPickEndUnix = %d (%s), want %d (%s)",
			got, time.Unix(got, 0).In(americaNewYork).Format(time.RFC3339),
			want, time.Unix(want, 0).In(americaNewYork).Format(time.RFC3339))
	}
}

func TestSlowDraftPickEndUnix_2AMStartsAfter8AM(t *testing.T) {
	// 2am EST -> clock starts 8am same day, +8h -> 4pm same day
	start := time.Date(2024, 6, 10, 2, 0, 0, 0, americaNewYork).Unix()
	want := time.Date(2024, 6, 10, 16, 0, 0, 0, americaNewYork).Unix()
	got := SlowDraftPickEndUnix(start, 8*3600)
	if got != want {
		t.Fatalf("SlowDraftPickEndUnix = %d (%s), want %d (%s)",
			got, time.Unix(got, 0).In(americaNewYork).Format(time.RFC3339),
			want, time.Unix(want, 0).In(americaNewYork).Format(time.RFC3339))
	}
}

func TestSlowDraftEffectiveElapsed_9PMTo10PM(t *testing.T) {
	start := time.Date(2024, 1, 2, 21, 0, 0, 0, americaNewYork).Unix()
	end := time.Date(2024, 1, 2, 22, 0, 0, 0, americaNewYork).Unix()
	got := SlowDraftEffectiveElapsedSeconds(start, end)
	if got != 3600 {
		t.Fatalf("effective elapsed = %d, want 3600", got)
	}
}

func TestSlowDraftPickEndRoundTrip(t *testing.T) {
	start := time.Date(2024, 3, 15, 10, 30, 0, 0, americaNewYork).Unix()
	pickLen := int64(12345)
	end := SlowDraftPickEndUnix(start, pickLen)
	elapsed := SlowDraftEffectiveElapsedSeconds(start, end)
	if elapsed != pickLen {
		t.Fatalf("elapsed %d != pickLen %d", elapsed, pickLen)
	}
}
