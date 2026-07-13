package models

import "time"

// Slow drafts only count pick time during 05:00–22:00 America/Los_Angeles (22:00–05:00 PT is paused).

var pacific *time.Location

func init() {
	var err error
	pacific, err = time.LoadLocation("America/Los_Angeles")
	if err != nil {
		panic("slow draft clock: America/Los_Angeles: " + err.Error())
	}
}

func slowDraftInNightPause(t time.Time) bool {
	t = t.In(pacific)
	sod := t.Hour()*3600 + t.Minute()*60 + t.Second()
	return sod >= 22*3600 || sod < 5*3600
}

// slowDraftAdvanceToNextActive returns the earliest instant >= t that is not in the night pause window.
func slowDraftAdvanceToNextActive(t time.Time) time.Time {
	t = t.In(pacific)
	if !slowDraftInNightPause(t) {
		return t
	}
	y, m, d := t.Date()
	sod := t.Hour()*3600 + t.Minute()*60 + t.Second()
	if sod >= 22*3600 {
		midnight := time.Date(y, m, d, 0, 0, 0, 0, pacific)
		return midnight.AddDate(0, 0, 1).Add(5 * time.Hour)
	}
	return time.Date(y, m, d, 5, 0, 0, 0, pacific)
}

// SlowDraftPickEndUnix returns the Unix instant when pickLengthSec of slow-draft clock have elapsed from fromUnix.
func SlowDraftPickEndUnix(fromUnix int64, pickLengthSec int64) int64 {
	if pickLengthSec <= 0 {
		return fromUnix
	}
	cur := slowDraftAdvanceToNextActive(time.Unix(fromUnix, 0))
	remaining := pickLengthSec
	for remaining > 0 {
		cur = cur.In(pacific)
		y, m, d := cur.Date()
		windowClose := time.Date(y, m, d, 22, 0, 0, 0, pacific)
		avail := int64(windowClose.Sub(cur).Seconds())
		if avail <= 0 {
			midnight := time.Date(y, m, d, 0, 0, 0, 0, pacific)
			cur = midnight.AddDate(0, 0, 1).Add(5 * time.Hour)
			continue
		}
		if remaining <= avail {
			return cur.Add(time.Duration(remaining) * time.Second).Unix()
		}
		remaining -= avail
		midnight := time.Date(y, m, d, 0, 0, 0, 0, pacific)
		cur = midnight.AddDate(0, 0, 1).Add(5 * time.Hour)
	}
	return cur.Unix()
}

// SlowDraftEffectiveElapsedSeconds returns how many slow-draft "active" seconds elapse between startUnix and endUnix.
func SlowDraftEffectiveElapsedSeconds(startUnix, endUnix int64) int64 {
	if endUnix <= startUnix {
		return 0
	}
	var total int64
	cur := slowDraftAdvanceToNextActive(time.Unix(startUnix, 0))
	endT := time.Unix(endUnix, 0).In(pacific)
	for cur.Before(endT) {
		cur = cur.In(pacific)
		y, m, d := cur.Date()
		windowClose := time.Date(y, m, d, 22, 0, 0, 0, pacific)
		if !windowClose.After(cur) {
			midnight := time.Date(y, m, d, 0, 0, 0, 0, pacific)
			cur = midnight.AddDate(0, 0, 1).Add(5 * time.Hour)
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
		midnight := time.Date(y, m, d, 0, 0, 0, 0, pacific)
		cur = midnight.AddDate(0, 0, 1).Add(5 * time.Hour)
	}
	return total
}
