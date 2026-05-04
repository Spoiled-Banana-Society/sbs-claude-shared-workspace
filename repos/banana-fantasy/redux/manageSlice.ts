import { PayloadAction, createSlice } from "@reduxjs/toolkit"
import { ViewState, manageProps } from "../utils/types/types"

const initialState: manageProps = {
    manageState: ViewState.LEADERBOARD,
    draftPlayerRankings: null,
    draftSummary: null,
    draftRosters: null,
    leagueId: null,
    selectedCard: null,
}

export const manageSlice = createSlice({
    name: "manage",
    initialState,
    reducers: {
        setManageView: (state, action: PayloadAction<ViewState>) => {
            state.manageState = action.payload
        },
        setManageDraftSummary: (state, action: PayloadAction<manageProps["draftSummary"]>) => {
            state.draftSummary = action.payload
        },
        setManageDraftRosters: (state, action: PayloadAction<manageProps["draftRosters"]>) => {
            state.draftRosters = action.payload
        },
        setManageDraftRankings: (state, action: PayloadAction<manageProps["draftPlayerRankings"]>) => {
            state.draftPlayerRankings = action.payload
        },
        setManageLeagueId: (state, action: PayloadAction<manageProps["leagueId"]>) => {
            state.leagueId = action.payload
        },
        clearManage: (state) => {
            state.manageState = initialState.manageState
            state.draftSummary = initialState.draftSummary
            state.draftRosters = initialState.draftRosters
            state.draftPlayerRankings = initialState.draftPlayerRankings
            state.leagueId = initialState.leagueId
            state.selectedCard = initialState.selectedCard
        },
        setManageSelectedCard: (state, action: PayloadAction<manageProps["selectedCard"]>) => {
            state.selectedCard = action.payload
        },
    },
})

export const {
    setManageView,
    clearManage,
    setManageLeagueId,
    setManageDraftSummary,
    setManageDraftRosters,
    setManageDraftRankings,
    setManageSelectedCard,
} = manageSlice.actions
