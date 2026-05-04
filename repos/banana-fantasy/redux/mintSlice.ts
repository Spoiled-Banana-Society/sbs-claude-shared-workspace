import { createSlice } from "@reduxjs/toolkit"
import { mintProps } from "../utils/types/types"
import { isStagingMode } from "@/lib/staging"

// TODO: Replace price in production
const initialState: mintProps = {
    count: 1,
    price: isStagingMode() ? 0.0001 : 0.01,
}

export const mintSlice = createSlice({
    name: "mint",
    initialState,
    reducers: {
        incrementCount: (state) => {
            state.count = state.count + 1
        },
        decrementCount: (state) => {
            state.count = state.count - 1
        },
    },
})

export const { incrementCount, decrementCount } = mintSlice.actions
