'use client';

import { useEffect, useRef } from 'react';
import { useDraftRoom, type PickEntry } from '@/hooks/useDraftRoom';
import { useAppDispatch } from '@/redux/hooks/reduxHooks';
import {
  setCanDraft,
  setCurrentDrafter,
  setCurrentRound,
  setEndOfTurnTimestamp,
  setGeneratedCard,
  setIdleCount,
  setLeagueId,
  setLeagueLevel,
  setLeagueStatus,
  setMostRecentPlayerDrafted,
  setPickNumber,
  setPreTimer,
  setStartOfTurnTimestamp,
} from '@/redux/leagueSlice';
import {
  setDraftInfo,
  setDraftRankings,
  setDraftRosters,
  setDraftSummary,
} from '@/redux/draftSlice';
import type { DraftRosterProps } from '@/utils/types/types';

type SummaryLike = {
  playerInfo: {
    playerId: string;
    displayName: string;
    team: string;
    position: string;
    ownerAddress: string;
    pickNum: number;
    round: number | null;
  };
  pfpInfo: {
    imageUrl: string;
    nftContract: string;
    displayName: string;
  };
};

function toUnixSeconds(value: number | null): number | null {
  if (value == null) return null;
  if (value > 10_000_000_000) return Math.floor(value / 1000);
  return Math.floor(value);
}

function mapPicksToSummary(picks: PickEntry[]): SummaryLike[] {
  return picks.map((pick) => ({
    playerInfo: {
      playerId: pick.playerId,
      displayName: pick.displayName,
      team: pick.team,
      position: pick.position,
      ownerAddress: pick.ownerAddress,
      pickNum: pick.pickNum,
      round: pick.round,
    },
    pfpInfo: {
      imageUrl: '',
      nftContract: '',
      displayName: pick.ownerAddress,
    },
  }));
}

function normalizeRosters(raw: unknown): unknown {
  if (!raw) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (!Array.isArray(raw)) return null;

  const mapped: Record<string, unknown> = {};
  for (const item of raw) {
    const token = item as Record<string, unknown>;
    const roster = token.roster;
    if (!roster || typeof roster !== 'object') continue;

    let ownerAddress =
      (typeof token.ownerAddress === 'string' && token.ownerAddress) ||
      (typeof token.ownerId === 'string' && token.ownerId) ||
      '';

    if (!ownerAddress) {
      const rosterObj = roster as Record<string, unknown>;
      for (const key of ['QB', 'RB', 'WR', 'TE', 'DST']) {
        const group = rosterObj[key];
        if (Array.isArray(group) && group.length > 0) {
          const first = group[0] as Record<string, unknown>;
          const nested = (first.playerStateInfo ?? first) as Record<string, unknown>;
          if (typeof nested.ownerAddress === 'string' && nested.ownerAddress) {
            ownerAddress = nested.ownerAddress;
            break;
          }
        }
      }
    }

    if (ownerAddress) {
      mapped[ownerAddress] = roster;
    }
  }

  return Object.keys(mapped).length > 0 ? mapped : raw;
}

export function useDraftRoomBridge(draftId: string | null) {
  const dispatch = useAppDispatch();
  const draftRoom = useDraftRoom(draftId);
  const lastPickNumRef = useRef<number | null>(null);

  useEffect(() => {
    if (draftId) dispatch(setLeagueId(draftId));
  }, [dispatch, draftId]);

  useEffect(() => {
    if (draftRoom.currentDrafter) dispatch(setCurrentDrafter(draftRoom.currentDrafter));
    if (draftRoom.currentPickNumber != null) dispatch(setPickNumber(draftRoom.currentPickNumber));
    if (draftRoom.currentRound != null) dispatch(setCurrentRound(draftRoom.currentRound));

    const endSec = toUnixSeconds(draftRoom.endOfTurnTimestamp);
    if (endSec != null) dispatch(setEndOfTurnTimestamp(endSec));

    const startSec = toUnixSeconds(draftRoom.startOfTurnTimestamp);
    if (startSec != null) dispatch(setStartOfTurnTimestamp(startSec));

    if (draftRoom.phase === 'countdown' && draftRoom.countdown != null) {
      dispatch(setPreTimer(draftRoom.countdown));
    }

    dispatch(setCanDraft(draftRoom.canDraft));
    dispatch(setIdleCount(draftRoom.idleCount));
    dispatch(setLeagueStatus(draftRoom.phase === 'completed' ? 'completed' : 'ongoing'));
    dispatch(setLeagueLevel(draftRoom.draftLevel));

    if (draftRoom.generatedCardUrl) {
      dispatch(setGeneratedCard(draftRoom.generatedCardUrl));
    }
  }, [
    dispatch,
    draftRoom.canDraft,
    draftRoom.countdown,
    draftRoom.currentDrafter,
    draftRoom.currentPickNumber,
    draftRoom.currentRound,
    draftRoom.draftLevel,
    draftRoom.endOfTurnTimestamp,
    draftRoom.generatedCardUrl,
    draftRoom.idleCount,
    draftRoom.phase,
    draftRoom.startOfTurnTimestamp,
  ]);

  useEffect(() => {
    if (draftRoom.draftInfo) dispatch(setDraftInfo(draftRoom.draftInfo as never));

    const summary = draftRoom.picks.length > 0 ? mapPicksToSummary(draftRoom.picks) : [];
    dispatch(setDraftSummary(summary));

    const normalizedRosters = normalizeRosters(draftRoom.draftRostersRaw);
    if (normalizedRosters) dispatch(setDraftRosters(normalizedRosters as DraftRosterProps[]));

    if (Array.isArray(draftRoom.draftRankingsRaw)) {
      dispatch(setDraftRankings(draftRoom.draftRankingsRaw));
    }
  }, [
    dispatch,
    draftRoom.draftInfo,
    draftRoom.draftRankingsRaw,
    draftRoom.draftRostersRaw,
    draftRoom.picks,
  ]);

  useEffect(() => {
    if (draftRoom.picks.length === 0) return;
    const latest = draftRoom.picks[draftRoom.picks.length - 1];

    if (lastPickNumRef.current == null) {
      lastPickNumRef.current = latest.pickNum;
      return;
    }

    if (latest.pickNum > lastPickNumRef.current) {
      dispatch(setMostRecentPlayerDrafted(latest));
      lastPickNumRef.current = latest.pickNum;
    }
  }, [dispatch, draftRoom.picks]);

  return draftRoom;
}
