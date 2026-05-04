import { useAppDispatch, useAppSelector } from "@/redux/hooks/reduxHooks"
import { useAuth } from "@/hooks/useAuth"
import { setQueue } from "@/redux/leagueSlice"
import React from "react"
import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd"
import QueueItemComponent from "./QueueItemComponent"
import { PlayerDataProps } from "@/utils/types/types"
import { Queue } from "@/utils/api"
import { logger } from '@/lib/logger';

type DraftQueueComponentProps = {
    availablePlayers: PlayerDataProps[],
    setAvailablePlayers: (players: PlayerDataProps[]) => void
    makePick: (player: { playerId: string; displayName: string; team: string; position: string }) => void
}

const QueueComponent: React.FC<DraftQueueComponentProps> = (props) => {
    const { availablePlayers, setAvailablePlayers: _setAvailablePlayers, makePick } = props
    const leagueId = useAppSelector((state) => state.league.leagueId)
    const { walletAddress } = useAuth()
    const queuedPlayers = useAppSelector((state) => state.league.queuedPlayers)
    const dispatch = useAppDispatch()

    const handleDrop = (droppedItem: DropResult) => {
        if (!droppedItem.destination) return
        const updatedList = [...queuedPlayers]
        const [reorderedItem] = updatedList.splice(droppedItem.source.index, 1)
        updatedList.splice(droppedItem.destination.index, 0, reorderedItem)

        try {
            Queue.setQueue(walletAddress!, leagueId!, updatedList).then((res) => {
                dispatch(setQueue(res))
            })
        } catch {
            console.error("Error sending payload")
        }
    }

    const getAvailablePlayer = (id: string) : PlayerDataProps | undefined => {
        const p = availablePlayers.filter(p => p.playerId === id)
        if (p.length === 1) {
            return p[0]
        }

        return undefined
    }

    logger.debug("queuedPlayers", queuedPlayers)

    return (
        <div>
            {queuedPlayers.length > 0 ? (
                <DragDropContext onDragEnd={handleDrop}>
                    <Droppable droppableId="list-container">
                        {(provided) => (
                            <div className="list-container" {...provided.droppableProps} ref={provided.innerRef}>
                                {queuedPlayers &&
                                    queuedPlayers.map((player, index) => {
                                        const fullPlayer = getAvailablePlayer(player.playerId)
                                        if (!fullPlayer) return ''

                                        return (
                                            <Draggable key={player.playerId} draggableId={player.playerId} index={index}>
                                                {(provided) => (
                                                    <div
                                                        className="item-container"
                                                        ref={provided.innerRef}
                                                        {...provided.dragHandleProps}
                                                        {...provided.draggableProps}
                                                    >
                                                        <QueueItemComponent player={fullPlayer} makePick={makePick} />
                                                    </div>
                                                )}
                                            </Draggable>
                                        )
                                    })}
                            </div>
                        )}
                    </Droppable>
                </DragDropContext>
            ) : (
                <h1 className="font-primary text-center italic mt-16 text-gray-300">
                    Your queue is empty. <br /> Add players from the Draft tab to set your pick order.
                </h1>
            )}
        </div>
    )
}

export default QueueComponent
