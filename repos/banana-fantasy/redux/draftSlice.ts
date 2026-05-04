import { PayloadAction, createSlice } from "@reduxjs/toolkit"
import { DraftInfoProps, draftSliceProps, SortState } from "@/utils/types/types"

const initialState: draftSliceProps = {
    draftInfo: null,
    draftSummary: null,
    draftRosters: null,
    draftPlayerRankings: null,
    liveDraftPicks: [],
    sortBy: SortState.ADP
}

export const draftSlice = createSlice({
    name: "draft",
    initialState,
    reducers: {
        setDraftInfo: (state, action: PayloadAction<DraftInfoProps>) => {
            state.draftInfo = action.payload
        },
        setDraftSummary: (state, action: PayloadAction<draftSliceProps["draftSummary"]>) => {
            state.draftSummary = action.payload
        },
        setDraftRosters: (state, action: PayloadAction<draftSliceProps["draftRosters"]>) => {
            state.draftRosters = action.payload
        },
        setDraftRankings: (state, action: PayloadAction<draftSliceProps["draftPlayerRankings"]>) => {
            state.draftPlayerRankings = action.payload
        },
        clearDraft: (state) => {
            state.draftInfo = null
            state.draftSummary = null
            state.draftRosters = null
            state.draftPlayerRankings = null
            state.liveDraftPicks = []
            state.sortBy = SortState.ADP
        },
        setDraftSort: (state, action: PayloadAction<draftSliceProps["sortBy"]>) => {
            state.sortBy = action.payload
        }
    },
})

export const { setDraftInfo, clearDraft, setDraftSummary, setDraftRosters, setDraftRankings, setDraftSort } = draftSlice.actions
