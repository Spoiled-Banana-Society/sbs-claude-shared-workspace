package models

import (
	"fmt"
	"os"
	"strings"
)

// DraftSeasonYear returns the year prefix for draft league IDs (e.g. "2024-fast-draft-42").
// Set DRAFT_SEASON_YEAR in the environment to keep staging cleanup and production join in sync.
func DraftSeasonYear() string {
	if y := strings.TrimSpace(os.Getenv("DRAFT_SEASON_YEAR")); y != "" {
		return y
	}
	return "2026"
}

func FormatDraftLeagueID(draftType string, draftNum int) string {
	return fmt.Sprintf("%s-%s-draft-%d", DraftSeasonYear(), draftType, draftNum)
}
