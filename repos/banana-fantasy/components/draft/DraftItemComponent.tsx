import { positionColor } from "@/utils/helpers"
import React, { useState } from "react"
import styled from "styled-components"
import { PlayerDataProps, PlayerStateInfo } from "@/utils/types/types"
import { useAppDispatch, useAppSelector } from "@/redux/hooks/reduxHooks"
import { useAuth } from "@/hooks/useAuth"
import { setQueue } from "@/redux/leagueSlice"
import { Queue } from "@/utils/api"

type RankingItemProps = {
    item: PlayerDataProps
    makePick: (player: { playerId: string; displayName: string; team: string; position: string }) => void
}

const StyledWrapper = styled.div`
    border-width: 2px;
    border-top: 1px solid #222;
    cursor: pointer;
    border-bottom: 1px solid #222;
    background: #000;
    margin: 5px auto;
    width: 900px;
    padding: 5px 0px;
    @media screen and (max-width: 900px) {
        width: 100%;
        max-width: 100vw;
        box-sizing: border-box;
        padding: 5px 8px;
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
                font-size: 13px;
                color: #888;
            }
            div {
                font-weight: bold;
                font-size: 13px;
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
    .yellow-image-filter,
    .banana-queue-button:hover {
        filter: brightness(50%) sepia(1) hue-rotate(21deg) saturate(2000%) brightness(100%);
    }
`

const DraftItemComponent: React.FC<RankingItemProps> = (props) => {
    const [show, setShow] = useState<boolean>(false)
    const { item, makePick } = props

    const leagueId = useAppSelector((state) => state.league.leagueId)
    const { walletAddress } = useAuth()
    const queuedPlayers = useAppSelector((state) => state.league.queuedPlayers)
    const dispatch = useAppDispatch()
    const canDraft = useAppSelector((state) => state.league.canDraft)
    const [isDrafting, setIsDrafting] = useState<boolean>(false)

    const draftPlayer = () => {
        if (!canDraft) return
        setIsDrafting(true)
        try {
            makePick({
                playerId: item.playerStateInfo.playerId,
                displayName: item.playerStateInfo.displayName,
                team: item.playerStateInfo.team,
                position: item.playerStateInfo.position,
            })
            setIsDrafting(false)
        } catch {
            console.error("Error sending pick via WebSocket")
        }
    }

    // send queue request via ws
    const queuePlayer = () => {
        const newQueue = [] as PlayerStateInfo[]
        queuedPlayers.forEach((i) => {
            newQueue.push(i)
        })

        newQueue.push(item.playerStateInfo)

        try {
            // set queue
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
            if (item.playerId !== i.playerId) {
                newQueue.push(i)
            }
        })

        try {
            // set queue
            Queue.setQueue(walletAddress!, leagueId!, newQueue).then((res) => {
                dispatch(setQueue(res))
            })
        } catch {
            console.error("Error sending payload")
        }
    }

    return (
        <StyledWrapper
            role="button"
            tabIndex={0}
            aria-label={`${item.playerStateInfo?.displayName ?? item.playerId} — ${show ? 'collapse' : 'expand'} details`}
            onClick={() => setShow((prev) => !prev)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShow((prev) => !prev); } }}
            style={{
                borderLeft: `2px solid ${positionColor(item.playerId)}`,
                borderRight: `2px solid ${positionColor(item.playerId)}`,
            }}
        >
            <div>
                <div className="first-row group">
                    <div className="w-[24px] h-[24px]">
                        <button
                            onClick={(e) => {
                                e.stopPropagation()
                                if (queuedPlayers.some((queue: PlayerStateInfo) => queue.playerId === item.ranking.playerId)) {
                                    deQueuePlayer()
                                } else {
                                    queuePlayer()
                                }
                            }}
                            aria-label={queuedPlayers.some((queue: PlayerStateInfo) => queue.playerId === item.ranking.playerId) ? `Remove ${item.playerId} from queue` : `Add ${item.playerId} to queue`}
                            className="bg-none border-none banana-queue-button"
                        >
                            {queuedPlayers.some(
                                (queue: PlayerStateInfo) => queue && queue.playerId === item.ranking.playerId
                            ) ? (
                                <img
                                    src="/banana-filled.webp"
                                    alt="banana"
                                    className="relative left-3 yellow-image-filter"
                                />
                            ) : (
                                <img src="/banana.webp" alt="banana" className="relative left-3" />
                            )}
                        </button>
                    </div>
                    <div>
                        <div
                            className="text-[18px] font-primary font-bold text-black px-1 rounded text-xs sm:text-base md:text-sm lg:text-sm xl:text-sm"
                            style={{ background: positionColor(item.playerId) }}
                        >
                            {item.playerId}
                        </div>
                        <div className="text-[12px] font-bold">BYE {item.stats.byeWeek}</div>
                    </div>
                    <div className="flex-row">
                        <div className="info">
                            <div>{item.stats.adp === 0 ? "N/A" : item.stats.adp}</div>
                        </div>
                        <div className="info">
                            <div>{item.ranking.rank}</div>
                        </div>
                    </div>
                </div>
            </div>
            {show && (
                <div>
                    <div className="second-row">
                        
                    </div>
                    {item.stats.playersFromTeam && (
                        <div>
                            <div className="players">Players from team</div>
                            <div className="players-from-team">
                                {item.stats.playersFromTeam.map((player) => {
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
                            data-tutorial="make-pick"
                            aria-label={`Draft ${item.playerStateInfo?.displayName ?? item.playerId}`}
                            className="bg-primary font-primary text-black font-bold uppercase py-1 px-2 rounded cursor-pointer disabled:cursor-not-allowed disabled:bg-gray-500 disabled:text-gray-400 focus-visible:ring-2 focus-visible:ring-white"
                            disabled={isDrafting || !canDraft}
                            onClick={draftPlayer}
                        >
                            Draft
                        </button>
                        <button
                            onClick={() => {
                                if (queuedPlayers.some((queue: PlayerStateInfo) => queue.playerId === item.ranking.playerId)) {
                                    deQueuePlayer()
                                } else {
                                    queuePlayer()
                                }
                            }}
                            className="bg-primary font-primary text-black font-bold uppercase py-1 px-2 rounded cursor-pointer"
                        >
                            {queuedPlayers.some(
                                (queue: PlayerStateInfo) => queue && queue.playerId === item.ranking.playerId
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

export default React.memo(DraftItemComponent)
