import { PayloadAction, createSlice } from "@reduxjs/toolkit"
import { PlayerStateInfo, ViewState, leagueProps, mostRecentPlayerProps } from "../utils/types/types"

const initialState: leagueProps = {
    leagueId: null,
    leagueName: null,
    tutorialMode: false,
    leagueLevel: "Pro",
    currentRound: null,
    currentPickNumber: null,
    currentDrafter: null,
    queuedPlayers: [],
    timeRemaining: null,
    endOfTurnTimestamp: null,
    startOfTurnTimestamp: null,
    mostRecentPlayerDrafted: null,
    leagueStatus: null,
    autopick: false,
    idleCount: 0,
    canDraft: false,
    tokenId: null,
    lobbyRefresh: false,
    shouldReconnect: false,
    selectedCard: null,
    viewState: ViewState.DRAFT,
    audioOn: true,
    preTimeRemaining: 0,
    generatedCard: null,
}

export const leagueSlice = createSlice({
    name: "league",
    initialState,
    reducers: {
        setTutorialMode: (state, action: PayloadAction<boolean>) => {
            state.tutorialMode = action.payload
        },
        setGeneratedCard: (state, action) => {
            state.generatedCard = action.payload
        },
        setPreTimer: (state, action) => {
            state.preTimeRemaining = action.payload
        },
        setAudio: (state, action: PayloadAction<boolean>) => {
            state.audioOn = action.payload
        },
        setLeagueLevel: (state, action: PayloadAction<string>) => {
            state.leagueLevel = action.payload
        },
        setLeagueId: (state, action: PayloadAction<string>) => {
            const leagueId = action.payload
            state.leagueId = leagueId
        },
        setLeagueName: (state, action: PayloadAction<string>) => {
            const leagueName = action.payload
            state.leagueName = leagueName
        },
        setPickNumber: (state, action: PayloadAction<number>) => {
            state.currentPickNumber = action.payload
        },
        setCurrentRound: (state, action: PayloadAction<number>) => {
            state.currentRound = action.payload
        },
        setCurrentDrafter: (state, action: PayloadAction<string>) => {
            state.currentDrafter = action.payload
        },
        setQueue: (state, action: PayloadAction<PlayerStateInfo[]>) => {
            state.queuedPlayers = action.payload
        },
        removeQueue: (state, action: PayloadAction<string>) => {
            state.queuedPlayers = state.queuedPlayers.filter((player) => player.playerId !== action.payload)
        },
        setEndOfTurnTimestamp: (state, action: PayloadAction<number>) => {
            state.endOfTurnTimestamp = action.payload
            if (state.startOfTurnTimestamp !== null) {
                state.timeRemaining = state.endOfTurnTimestamp - state.startOfTurnTimestamp
            }
        },
        setStartOfTurnTimestamp: (state, action: PayloadAction<number>) => {
            state.startOfTurnTimestamp = action.payload
            if (state.endOfTurnTimestamp !== null) {
                state.timeRemaining = state.endOfTurnTimestamp - state.startOfTurnTimestamp
            }
        },
        tickTime: (state, action: PayloadAction<number>) => {
            if (state.timeRemaining === null) return
            state.timeRemaining = state.timeRemaining! - action.payload
        },
        setMostRecentPlayerDrafted: (state, action: PayloadAction<mostRecentPlayerProps>) => {
            state.mostRecentPlayerDrafted = action.payload
        },
        setLeagueStatus: (state, action: PayloadAction<string>) => {
            state.leagueStatus = action.payload
        },
        setAutopick: (state, action: PayloadAction<boolean>) => {
            state.autopick = action.payload
        },
        setIdleCount: (state, action: PayloadAction<number>) => {
            state.idleCount = action.payload
        },
        setCanDraft: (state, action: PayloadAction<boolean>) => {
            state.canDraft = action.payload
        },
        setTokenId: (state, action: PayloadAction<string>) => {
            state.tokenId = action.payload
        },
        setLobbyRefresh: (state, action: PayloadAction<boolean>) => {
            state.lobbyRefresh = action.payload
        },
        setConnection: (state, action: PayloadAction<boolean>) => {
            state.shouldReconnect = action.payload
        },
        setSelectedCard: (state, action: PayloadAction<string>) => {
            state.selectedCard = action.payload
        },
        setViewState: (state, action: PayloadAction<ViewState>) => {
            state.viewState = action.payload
        },
        clearLeague: (state) => {
            state.leagueId = null
            state.leagueName = null
            state.tutorialMode = false
            state.leagueLevel = "Pro"
            state.currentRound = null
            state.currentPickNumber = null
            state.currentDrafter = null
            state.queuedPlayers = []
            state.timeRemaining = null
            state.endOfTurnTimestamp = null
            state.startOfTurnTimestamp = null
            state.mostRecentPlayerDrafted = null
            state.leagueStatus = null
            state.autopick = false
            state.idleCount = 0
            state.canDraft = false
            state.tokenId = null
            state.lobbyRefresh = false
            state.shouldReconnect = false
            state.selectedCard = null
            state.audioOn = true
            state.viewState = ViewState.DRAFT
            state.preTimeRemaining = 0
            state.generatedCard = null
        },
    },
})

export const {
    setQueue,
    setTutorialMode,
    setGeneratedCard,
    setCanDraft,
    tickTime,
    setLobbyRefresh,
    setIdleCount,
    setLeagueId,
    setEndOfTurnTimestamp,
    setStartOfTurnTimestamp,
    setLeagueName,
    setPickNumber,
    setCurrentDrafter,
    setCurrentRound,
    setLeagueStatus,
    setAutopick,
    setAudio,
    setTokenId,
    clearLeague,
    setConnection,
    removeQueue,
    setSelectedCard,
    setViewState,
    setLeagueLevel,
    setPreTimer,
    setMostRecentPlayerDrafted,
} = leagueSlice.actions
