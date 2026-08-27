package models

import "time"

// Slow drafts only count pick time during the active window
// pauseEnd:00–22:00 America/Los_Angeles (22:00–pauseEnd is paused).
// pauseEnd is 05 legacy; system_config/slowDraftClock.pauseEndHour overrides
// it while the switch is active (Richard 2026-08-26: 7am).

var pacific *time.Location

const slowDraftPauseStartHour = 22

func init() {
	var err error
	pacific, err = time.LoadLocation("America/Los_Angeles")
	if err != nil {
		panic("slow draft clock: America/Los_Angeles: " + err.Error())
	}
}

func slowDraftInNightPauseAt(t time.Time, pauseEndHour int) bool {
	t = t.In(pacific)
	sod := t.Hour()*3600 + t.Minute()*60 + t.Second()
	return sod >= slowDraftPauseStartHour*3600 || sod < pauseEndHour*3600
}

func slowDraftInNightPause(t time.Time) bool {
	return slowDraftInNightPauseAt(t, SlowDraftPauseEndHour())
}

// nextPauseEnd returns pauseEnd:00 PT on the day after y/m/d.
func nextPauseEnd(y int, m time.Month, d int, pauseEndHour int) time.Time {
	midnight := time.Date(y, m, d, 0, 0, 0, 0, pacific)
	return midnight.AddDate(0, 0, 1).Add(time.Duration(pauseEndHour) * time.Hour)
}

// slowDraftAdvanceToNextActive returns the earliest instant >= t that is not in the night pause window.
func slowDraftAdvanceToNextActiveAt(t time.Time, pauseEndHour int) time.Time {
	t = t.In(pacific)
	if !slowDraftInNightPauseAt(t, pauseEndHour) {
		return t
	}
	y, m, d := t.Date()
	sod := t.Hour()*3600 + t.Minute()*60 + t.Second()
	if sod >= slowDraftPauseStartHour*3600 {
		return nextPauseEnd(y, m, d, pauseEndHour)
	}
	return time.Date(y, m, d, pauseEndHour, 0, 0, 0, pacific)
}

func slowDraftAdvanceToNextActive(t time.Time) time.Time {
	return slowDraftAdvanceToNextActiveAt(t, SlowDraftPauseEndHour())
}

// SlowDraftPickEndUnix returns the Unix instant when pickLengthSec of slow-draft clock have elapsed from fromUnix.
// Honours the system_config/slowDraftClock switch (fresh clock after the pause, pause end hour).
func SlowDraftPickEndUnix(fromUnix int64, pickLengthSec int64) int64 {
	return slowDraftPickEndUnixOpts(fromUnix, pickLengthSec, SlowDraftFreshClockAfterPause(), SlowDraftPauseEndHour())
}

// slowDraftPickEndUnixOpts is the pure form. freshAfterPause=true: a pick that
// would cross the 22:00 PT pause does NOT carry its leftover minutes into the
// morning — it restarts with the FULL pickLengthSec when the pause ends (so
// nobody wakes up to 40 minutes left). false: legacy carry-over.
func slowDraftPickEndUnixOpts(fromUnix int64, pickLengthSec int64, freshAfterPause bool, pauseEndHour int) int64 {
	if pickLengthSec <= 0 {
		return fromUnix
	}
	if pickLengthSec > int64(slowDraftPauseStartHour-pauseEndHour)*3600 {
		// Can't fit in one active window — a fresh clock would never end.
		freshAfterPause = false
	}
	cur := slowDraftAdvanceToNextActiveAt(time.Unix(fromUnix, 0), pauseEndHour)
	remaining := pickLengthSec
	for remaining > 0 {
		cur = cur.In(pacific)
		y, m, d := cur.Date()
		windowClose := time.Date(y, m, d, slowDraftPauseStartHour, 0, 0, 0, pacific)
		avail := int64(windowClose.Sub(cur).Seconds())
		if avail <= 0 {
			cur = nextPauseEnd(y, m, d, pauseEndHour)
			continue
		}
		if remaining <= avail {
			return cur.Add(time.Duration(remaining) * time.Second).Unix()
		}
		if freshAfterPause {
			remaining = pickLengthSec
		} else {
			remaining -= avail
		}
		cur = nextPauseEnd(y, m, d, pauseEndHour)
	}
	return cur.Unix()
}

// SlowDraftEffectiveElapsedSeconds returns how many slow-draft "active" seconds elapse between startUnix and endUnix.
func SlowDraftEffectiveElapsedSeconds(startUnix, endUnix int64) int64 {
	return slowDraftEffectiveElapsedSecondsAt(startUnix, endUnix, SlowDraftPauseEndHour())
}

func slowDraftEffectiveElapsedSecondsAt(startUnix, endUnix int64, pauseEndHour int) int64 {
	if endUnix <= startUnix {
		return 0
	}
	var total int64
	cur := slowDraftAdvanceToNextActiveAt(time.Unix(startUnix, 0), pauseEndHour)
	endT := time.Unix(endUnix, 0).In(pacific)
	for cur.Before(endT) {
		cur = cur.In(pacific)
		y, m, d := cur.Date()
		windowClose := time.Date(y, m, d, slowDraftPauseStartHour, 0, 0, 0, pacific)
		if !windowClose.After(cur) {
			cur = nextPauseEnd(y, m, d, pauseEndHour)
			continue
		}
		chunkEnd := windowClose
		if endT.Before(chunkEnd) {
			chunkEnd = endT
		}
		total += int64(chunkEnd.Sub(cur).Seconds())
		if !chunkEnd.Before(endT) {
			break
		}
		cur = nextPauseEnd(y, m, d, pauseEndHour)
	}
	return total
}
