import { useAppDispatch, useAppSelector } from "@/redux/hooks/reduxHooks"
import { useAuth } from "@/hooks/useAuth"
import { setIdleCount, setQueue } from "@/redux/leagueSlice"
import { Queue } from "@/utils/api"
import { positionColor } from "@/utils/helpers"
import { PlayerDataProps, PlayerStateInfo } from "@/utils/types/types"
import React, { useState } from "react"
import styled from "styled-components"

type QueueItemProps = {
    player: PlayerDataProps
    makePick: (player: { playerId: string; displayName: string; team: string; position: string }) => void
}

const StyledWrapper = styled.div`
    border-top: 1px solid #222;
    cursor: pointer;
    border-bottom: 1px solid #222;
    background: #000;
    margin: 20px auto 10px auto;
    width: 900px;
    padding: 10px 0px;
    @media screen and (max-width: 900px) {
        width: 100vw;
    }
    .first-row {
        gap: 20px;
        display: flex;
        flex-direction: row;
        align-items: center;
        justify-content: space-between;
        .icon {
            position: relative;
            font-size: 24px;
            bottom: 3px;
            left: 7px;
        }
        text-align: left;
    }
    .second-row {
        gap: 10px;
        display: flex;
        flex-direction: row;
        align-items: center;
        justify-content: center;
        text-align: center;
        h2 {
            font-size: 12px;
            color: #888;
            text-transform: uppercase;
        }
    }
    .flex-row {
        display: flex;
        flex-grow: 1;
        flex-direction: row;
        justify-content: flex-end;
        padding-right: 15px;
        gap: 15px;
        .info {
            min-width: 40px;
            h2 {
                font-size: 12px;
                color: #888;
            }
            div {
                font-weight: bold;
            }
        }
    }
    .players {
        text-align: center;
        font-size: 12px;
        color: #888;
        margin: 10px 0px 3px 0px;
        text-transform: uppercase;
    }
    .players-from-team {
        text-align: center;
        font-size: 14px;
    }
    .yellow-image-filter {
        filter: brightness(50%) sepia(1) hue-rotate(21deg) saturate(2000%) brightness(100%);
    }
`

const QueueItemComponent: React.FC<QueueItemProps> = (props) => {
    const { player, makePick: makePickProp } = props
    const [show, setShow] = useState<boolean>(false)

    const leagueId = useAppSelector((state) => state.league.leagueId)
    const { walletAddress } = useAuth()
    const queuedPlayers = useAppSelector((state) => state.league.queuedPlayers)
    const [isDrafting, setIsDrafting] = useState<boolean>(false)
    const canDraft = useAppSelector((state) => state.league.canDraft)
    const dispatch = useAppDispatch()

    const draftPlayer = () => {
        if (!canDraft) return
        setIsDrafting(true)
        try {
            makePickProp({
                playerId: player.playerStateInfo.playerId,
                displayName: player.playerStateInfo.displayName,
                team: player.playerStateInfo.team,
                position: player.playerStateInfo.position,
            })
            dispatch(setIdleCount(0))
            setIsDrafting(false)
        } catch {
            console.error("Error sending pick via WebSocket")
        }
    }

    // send queue request via REST
    const queuePlayer = () => {
        const newQueue = [...queuedPlayers, player.playerStateInfo]

        try {
            Queue.setQueue(walletAddress!, leagueId!, newQueue).then((res) => {
                dispatch(setQueue(res))
            })
        } catch {
            console.error("Error sending payload")
        }
    }

    const deQueuePlayer = () => {
        const newQueue = [] as PlayerStateInfo[]
        queuedPlayers.forEach((i) => {
            // push all players other than this one to queue
            if (player.playerId !== i.playerId) {
                newQueue.push(i)
            }
        })

        try {
            Queue.setQueue(walletAddress!, leagueId!, newQueue).then((res) => {
                dispatch(setQueue(res))
            })
        } catch {
            console.error("Error sending payload")
        }
    }

    return (
        <StyledWrapper
            style={{
                borderLeft: `2px solid ${positionColor(player.playerId)}`,
                borderRight: `2px solid ${positionColor(player.playerId)}`,
            }}
            onClick={() => setShow((prev) => !prev)}
        >
            <div>
                <div className="first-row group">
                    <div className="w-[24px] h-[24px]">
                        {queuedPlayers.some((queue: PlayerStateInfo) => queue && queue.playerId === player.playerId) ? (
                            <img
                                src="/banana-filled.webp"
                                alt="banana"
                                className="relative left-3 yellow-image-filter"
                            />
                        ) : (
                            <img src="/banana.webp" alt="banana" className="relative left-3" />
                        )}
                    </div>
                    <div>
                        <div className="font-primary font-bold">{player.playerId}</div>
                        <div className="text-sm">BYE {player.stats.byeWeek}</div>
                    </div>
                    <div className="flex-row">
                        <div className="info">
                            <h2>ADP</h2>
                            <div>{player.stats.adp === 0 ? "N/A" : player.stats.adp}</div>
                        </div>
                        <div className="info">
                            <h2>Rank</h2>
                            <div>{player.ranking.rank}</div>
                        </div>
                    </div>
                </div>
            </div>
            {show && (
                <div>
                    <div className="second-row">
                        
                    </div>
                    {player.stats.playersFromTeam && (
                        <div>
                            <div className="players">Players from team</div>
                            <div className="players-from-team">
                                {player.stats.playersFromTeam.map((player) => {
                                    return (
                                        <span key={player} className="pr-2">
                                            {player}
                                        </span>
                                    )
                                })}
                            </div>
                        </div>
                    )}
                    <div className="flex mx-auto text-center items-center justify-center gap-4 py-5">
                        <button
                            className="bg-primary font-primary text-black font-bold uppercase py-1 px-2 rounded cursor-pointer disabled:cursor-not-allowed disabled:bg-gray-500 disabled:text-gray-400"
                            disabled={isDrafting || !canDraft}
                            onClick={draftPlayer}
                        >
                            Draft
                        </button>
                        <button
                            onClick={() => {
                                if (queuedPlayers.some((queue: PlayerStateInfo) => queue.playerId === player.ranking.playerId)) {
                                    deQueuePlayer()
                                } else {
                                    queuePlayer()
                                }
                            }}
                            className="bg-primary font-primary text-black font-bold uppercase py-1 px-2 rounded cursor-pointer"
                        >
                            {queuedPlayers.some(
                                (queue: PlayerStateInfo) => queue && queue.playerId === player.ranking.playerId
                            )
                                ? "Unqueue"
                                : "Queue"}
                        </button>
                    </div>
                </div>
            )}
        </StyledWrapper>
    )
}

export default QueueItemComponent
