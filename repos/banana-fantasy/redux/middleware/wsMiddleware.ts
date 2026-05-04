import { Socket } from "@/utils/webSocket"
import { getDraftServerUrl } from "@/lib/staging"
import type { Middleware } from "@reduxjs/toolkit"
import { logger } from '@/lib/logger';
import type { DraftInfoPayload, NewPickPayload, TimerPayload } from '@/hooks/useDraftWebSocket';
import type { PlayerStateInfo } from '@/utils/types/types';
import {
    setConnection,
    setCurrentDrafter,
    setCurrentRound,
    setGeneratedCard,
    setLeagueStatus,
    setMostRecentPlayerDrafted,
    setPickNumber,
    setPreTimer,
    setEndOfTurnTimestamp,
    setStartOfTurnTimestamp,
} from "../leagueSlice"

type SocketAction = {
    type: string
    payload?: unknown
}

type CountdownUpdateMessage = {
    type: "countdown_update"
    payload: {
        timeRemaining: number
        currentDrafter: string
    }
}

type TimerUpdateMessage = {
    type: "timer_update"
    payload: TimerPayload
}

type NewPickMessage = {
    type: "new_pick"
    payload: NewPickPayload
}

type DraftInfoUpdateMessage = {
    type: "draft_info_update"
    payload: DraftInfoPayload
}

type FinalCardMessage = {
    type: "final_card"
    payload: {
        _imageUrl: string
    }
}

type DraftCompleteMessage = {
    type: "draft_complete"
    payload?: unknown
}

type NewQueueMessage = {
    type: "new_queue"
    payload: PlayerStateInfo[]
}

type SocketMessage =
    | CountdownUpdateMessage
    | TimerUpdateMessage
    | NewPickMessage
    | DraftInfoUpdateMessage
    | FinalCardMessage
    | DraftCompleteMessage
    | NewQueueMessage
    | { type?: string; payload?: unknown }

function isCountdownUpdateMessage(data: SocketMessage): data is CountdownUpdateMessage {
    return data.type === "countdown_update"
}

function isTimerUpdateMessage(data: SocketMessage): data is TimerUpdateMessage {
    return data.type === "timer_update"
}

function isNewPickMessage(data: SocketMessage): data is NewPickMessage {
    return data.type === "new_pick"
}

function isDraftInfoUpdateMessage(data: SocketMessage): data is DraftInfoUpdateMessage {
    return data.type === "draft_info_update"
}

function isFinalCardMessage(data: SocketMessage): data is FinalCardMessage {
    return data.type === "final_card"
}

export const socketMiddleware =
    (socket: Socket): Middleware =>
    (params) =>
    (next) =>
    (action: unknown) => {
        const typedAction = action as SocketAction
        const { type, payload } = typedAction
        const { dispatch } = params

        switch (type) {
            case "socket/connect":
                const connectPayload = payload as { walletAddress: string; leagueName: string }
                socket.disconnect()
                socket.connect(
                    `${getDraftServerUrl()}/ws?address=${connectPayload.walletAddress}&draftName=${connectPayload.leagueName}`
                )
                socket.on("open", () => {
                    logger.debug("Websocket connected successfully!")
                    dispatch(setLeagueStatus("ongoing"))
                })
                socket.on("message", (event: Event) => {
                    const message = event as MessageEvent
                    let data: SocketMessage
                    try {
                        data = JSON.parse(message.data) as SocketMessage
                    } catch (error) {
                        console.error("Failed to parse websocket message", error, message.data)
                        return
                    }
                    if (isCountdownUpdateMessage(data)) {
                        logger.debug("countdown_update", data)
                        dispatch(setPreTimer(data.payload.timeRemaining))
                        dispatch(setCurrentDrafter(data.payload.currentDrafter))
                    }
                    if (isTimerUpdateMessage(data)) {
                        logger.debug("timer_update", data)
                        dispatch(setEndOfTurnTimestamp(data.payload.endOfTurnTimestamp))
                        dispatch(setStartOfTurnTimestamp(data.payload.startOfTurnTimestamp))
                        dispatch(setCurrentDrafter(data.payload.currentDrafter))
                    }
                    if (isNewPickMessage(data)) {
                        dispatch(setMostRecentPlayerDrafted(data.payload))
                        if (data.payload.pickNum === 150) {
                            dispatch(setPickNumber(data.payload.pickNum))
                            dispatch(setCurrentRound(data.payload.round))
                        }
                    }
                    if (isDraftInfoUpdateMessage(data)) {
                        dispatch(setPickNumber(data.payload.pickNumber))
                        dispatch(setCurrentRound(data.payload.roundNum))
                    }
                    if (isFinalCardMessage(data)) {
                        logger.debug("final card", data.payload)
                        dispatch(setGeneratedCard(data.payload._imageUrl))
                        socket.disconnect()
                        dispatch(setLeagueStatus("completed"))
                    }
                    if (data.type === "draft_complete") {
                        // init close experience
                        logger.debug("draft complete", data.payload)
                        socket.disconnect()
                        dispatch(setLeagueStatus("completed"))
                    }
                })
                socket.on("close", (message) => {
                    logger.debug("Websocket disconnected: ", message)
                    dispatch(setConnection(false))
                })
                socket.on("error", (error) => {
                    logger.debug("Websocket error: ", error)
                })
                break
            case "socket/send":
                logger.debug(payload)
                socket.send(payload as JSON)
                break
            case "socket/disconnect":
                socket.disconnect()
                break
            default:
                break
        }
        return next(action)
    }
