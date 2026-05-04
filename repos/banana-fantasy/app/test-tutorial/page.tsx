"use client"

import React, { useEffect, useMemo, useState } from "react"
import PlayerComponent from "@/components/draft/PlayerComponent"
import MainComponent from "@/components/draft/MainComponent"
import DraftTutorial, { DRAFT_TUTORIAL_STEPS, type TutorialTab } from "@/components/tutorial/DraftTutorial"
import { useTutorial } from "@/hooks/useTutorial"
import { useAuth } from "@/hooks/useAuth"
import { useAppDispatch, useAppSelector } from "@/redux/hooks/reduxHooks"
import { setDraftInfo, setDraftRankings, setDraftRosters, setDraftSummary, setDraftSort } from "@/redux/draftSlice"
import {
  setCanDraft,
  setCurrentDrafter,
  setCurrentRound,
  setEndOfTurnTimestamp,
  setLeagueId,
  setLeagueLevel,
  setLeagueName,
  setLeagueStatus,
  setPickNumber,
  setQueue,
  setStartOfTurnTimestamp,
  setTutorialMode,
  setViewState,
} from "@/redux/leagueSlice"
import { DraftRosterProps, PlayerDataProps, SortState, ViewState } from "@/utils/types/types"

const MOCK_WALLET = "0xabc123def456"

function mockPlayer(team: string, pos: string, adp: number, rank: number, bye: number) {
  return {
    playerId: `${team}-${pos}`,
    ranking: { playerId: `${team}-${pos}`, rank, score: 0 },
    stats: { playerId: `${team}-${pos}`, averageScore: 0, highestScore: 0, top5Finishes: 0, adp, byeWeek: bye, playersFromTeam: [] },
    playerStateInfo: {
      playerId: `${team}-${pos}`,
      displayName: `${team}-${pos}`,
      team,
      position: pos,
      ownerAddress: "",
      pickNum: 0,
      round: 0,
    },
  }
}

function mockSummaryItem(
  pickNum: number,
  round: number,
  owner: string,
  playerId: string,
  displayName: string,
  team: string,
  pos: string
) {
  return {
    playerInfo: {
      playerId,
      displayName,
      team,
      position: pos,
      ownerAddress: owner,
      pickNum,
      round,
    },
    pfpInfo: {
      imageUrl: "",
      nftContract: "",
      displayName: owner === MOCK_WALLET ? "You" : `Team ${pickNum}`,
    },
  }
}

function buildTutorialData(activeWallet: string) {
  const rankings = [
    mockPlayer("MIN", "WR1", 1, 1, 6),
    mockPlayer("ATL", "RB1", 3, 2, 12),
    mockPlayer("DAL", "WR2", 6, 4, 7),
    mockPlayer("PHI", "RB2", 8, 5, 5),
    mockPlayer("DET", "WR1", 9, 7, 5),
    mockPlayer("NYJ", "RB1", 11, 8, 12),
    mockPlayer("KC", "QB", 12, 9, 6),
    mockPlayer("KC", "TE", 15, 12, 6),
    mockPlayer("CLE", "WR1", 49, 49, 9),
    mockPlayer("IND", "WR1", 51, 51, 11),
    mockPlayer("LV", "WR1", 53, 53, 8),
    mockPlayer("CIN", "WR2", 68, 69, 10),
    mockPlayer("NO", "QB", 0, 140, 12),
    mockPlayer("DET", "TE", 0, 139, 5),
    mockPlayer("ARI", "QB", 0, 143, 11),
  ]

  const summary = [
    mockSummaryItem(1, 1, "0xteam1", "SF-RB1", "SF-RB1", "SF", "RB"),
    mockSummaryItem(2, 1, activeWallet, "MIA-WR1", "MIA-WR1", "MIA", "WR"),
    mockSummaryItem(3, 1, "0xteam2", "PHI-WR1", "PHI-WR1", "PHI", "WR"),
    mockSummaryItem(4, 1, "0xteam3", "CIN-WR1", "CIN-WR1", "CIN", "WR"),
    mockSummaryItem(5, 1, "0xteam4", "PHI-RB1", "PHI-RB1", "PHI", "RB"),
    mockSummaryItem(6, 1, activeWallet, "DET-WR2", "DET-WR2", "DET", "WR"),
    mockSummaryItem(7, 1, "0xteam5", "BUF-QB", "BUF-QB", "BUF", "QB"),
    mockSummaryItem(8, 1, "0xteam6", "NYJ-WR1", "NYJ-WR1", "NYJ", "WR"),
    mockSummaryItem(9, 1, "0xteam7", "JAX-RB1", "JAX-RB1", "JAX", "RB"),
    mockSummaryItem(10, 1, "0xteam8", "HOU-WR1", "HOU-WR1", "HOU", "WR"),
    mockSummaryItem(11, 2, "0xteam8", "", "", "", ""),
    mockSummaryItem(12, 2, "0xteam7", "", "", "", ""),
    mockSummaryItem(13, 2, "0xteam6", "", "", "", ""),
    mockSummaryItem(14, 2, "0xteam5", "", "", "", ""),
    mockSummaryItem(15, 2, activeWallet, "", "", "", ""),
  ]

  const rosters: Record<string, unknown> = {
    [activeWallet]: { QB: [], RB: [], WR: [{ playerId: "MIA-WR1" }, { playerId: "DET-WR2" }], TE: [], DST: [] },
    "0xteam1": { QB: [], RB: [{ playerId: "SF-RB1" }], WR: [], TE: [], DST: [] },
    "0xteam2": { QB: [], RB: [], WR: [{ playerId: "PHI-WR1" }], TE: [], DST: [] },
    "0xteam3": { QB: [], RB: [], WR: [{ playerId: "CIN-WR1" }], TE: [], DST: [] },
    "0xteam4": { QB: [], RB: [{ playerId: "PHI-RB1" }], WR: [], TE: [], DST: [] },
    "0xteam5": { QB: [{ playerId: "BUF-QB" }], RB: [], WR: [], TE: [], DST: [] },
    "0xteam6": { QB: [], RB: [], WR: [{ playerId: "NYJ-WR1" }], TE: [], DST: [] },
    "0xteam7": { QB: [], RB: [{ playerId: "JAX-RB1" }], WR: [], TE: [], DST: [] },
    "0xteam8": { QB: [], RB: [], WR: [{ playerId: "HOU-WR1" }], TE: [], DST: [] },
  }

  return { rankings, summary, rosters }
}

const viewStateToTutorialTab: Record<ViewState, TutorialTab> = {
  [ViewState.DRAFT]: "draft",
  [ViewState.QUEUE]: "queue",
  [ViewState.BOARD]: "board",
  [ViewState.ROSTER]: "roster",
  [ViewState.CHAT]: "draft",
  [ViewState.LEADERBOARD]: "draft",
}

const tutorialTabToViewState: Record<TutorialTab, ViewState> = {
  draft: ViewState.DRAFT,
  queue: ViewState.QUEUE,
  board: ViewState.BOARD,
  roster: ViewState.ROSTER,
}

export default function TestTutorialPage() {
  const dispatch = useAppDispatch()
  const { walletAddress } = useAuth()
  const [availablePlayers, setAvailablePlayers] = useState<PlayerDataProps[]>([])
  const tutorialState = useTutorial(DRAFT_TUTORIAL_STEPS.length)
  const viewState = useAppSelector((state) => state.league.viewState)
  const activeTutorialTab = viewStateToTutorialTab[viewState] ?? "draft"

  const activeWallet = useMemo(() => walletAddress ?? MOCK_WALLET, [walletAddress])

  useEffect(() => {
    const nowSec = Math.floor(Date.now() / 1000)
    const nowMs = Date.now()
    const { rankings, summary, rosters } = buildTutorialData(activeWallet)

    dispatch(setTutorialMode(true))
    dispatch(setLeagueId("test-tutorial-draft"))
    dispatch(setLeagueName("test-tutorial-draft"))
    dispatch(setLeagueLevel("Hall of Fame"))
    dispatch(setCurrentRound(2))
    dispatch(setPickNumber(11))
    dispatch(setCurrentDrafter(activeWallet))
    dispatch(setQueue([
      { playerId: "KC-TE", displayName: "KC-TE", team: "KC", position: "TE", ownerAddress: "", pickNum: 0, round: 0 },
      { playerId: "CLE-WR1", displayName: "CLE-WR1", team: "CLE", position: "WR", ownerAddress: "", pickNum: 0, round: 0 },
      { playerId: "ATL-RB1", displayName: "ATL-RB1", team: "ATL", position: "RB", ownerAddress: "", pickNum: 0, round: 0 },
    ]))
    dispatch(setStartOfTurnTimestamp(nowSec - 3))
    dispatch(setEndOfTurnTimestamp(nowSec + 27))
    dispatch(setLeagueStatus("ongoing"))
    dispatch(setCanDraft(true))
    dispatch(setViewState(ViewState.DRAFT))

    dispatch(setDraftInfo({
      draftId: "test-tutorial-draft",
      displayName: "Tutorial Draft",
      draftStartTime: nowMs - 300000,
      currentPickEndTime: nowMs + 27000,
      currentDrafter: activeWallet,
      pickNumber: 11,
      roundNum: 2,
      pickInRound: 1,
      pickLength: 30,
      draftOrder: [],
    }))
    dispatch(setDraftSummary(summary))
    dispatch(setDraftRosters(rosters as unknown as DraftRosterProps[]))
    dispatch(setDraftRankings(rankings))
    dispatch(setDraftSort(SortState.ADP))
  }, [dispatch, activeWallet])

  return (
    <div>
      <PlayerComponent
        availablePlayers={availablePlayers}
        setAvailablePlayers={setAvailablePlayers}
        makePick={() => {}}
      />
      <MainComponent
        availablePlayers={availablePlayers}
        setAvailablePlayers={setAvailablePlayers}
        makePick={() => {}}
      />
      <DraftTutorial
        {...tutorialState}
        activeTab={activeTutorialTab}
        setActiveTab={(tab) => dispatch(setViewState(tutorialTabToViewState[tab]))}
      />
    </div>
  )
}
// cache-bust 1770765410
