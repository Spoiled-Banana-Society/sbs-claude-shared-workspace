import { configureStore } from "@reduxjs/toolkit"
import { leagueSlice } from "./leagueSlice"
import { draftSlice } from "./draftSlice"
import { manageSlice } from "./manageSlice"
import { mintSlice } from "./mintSlice"

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch

export const store = configureStore({
    reducer: {
        league: leagueSlice.reducer,
        draft: draftSlice.reducer,
        manage: manageSlice.reducer,
        mint: mintSlice.reducer,
    },
})
