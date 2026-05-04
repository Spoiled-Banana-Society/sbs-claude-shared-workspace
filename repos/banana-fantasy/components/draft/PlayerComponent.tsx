"use client"
import { useAppDispatch, useAppSelector } from "@/redux/hooks/reduxHooks"
import { useAuth } from "@/hooks/useAuth"
import {
    setAudio,
    setIdleCount,
    setQueue,
} from "@/redux/leagueSlice"
import { Draft } from "@/utils/api"
import React, { useEffect, useState } from "react"
import PlayerCardComponent from "./PlayerCardComponent"
import styled from "styled-components"
import ReactLoading from "react-loading"
import { MdAudiotrack } from "react-icons/md"
import { useAudioYourTurn } from "@/hooks/useAudioYourTurn"
import { PlayerDataProps, SummaryProps } from "@/utils/types/types"
import { setDraftRosters } from "@/redux/draftSlice"
import { logger } from '@/lib/logger';

type PlayerComponentProps = {
    availablePlayers: PlayerDataProps[]
    setAvailablePlayers: (players: PlayerDataProps[]) => void
    makePick: (player: { playerId: string; displayName: string; team: string; position: string }) => void
}

const StyledContainer = styled.div`
    &::-webkit-scrollbar {
        display: none;
    }

    margin-top: 15px;
`

const getStyleForLeagueLevel = (leagueLevel: string) => {
    switch (leagueLevel) {
        case 'Hall of Fame':
            return "bg-primary-dark fixed top-0 z-20 w-full overflow-hidden text-black"
        case 'Jackpot':
            return "bg-red-500 fixed top-0 z-20 w-full overflow-hidden text-black"
        default:
            return "fixed top-0 bg-black z-20 w-full overflow-hidden text-white"
    }
}

const PlayerComponent: React.FC<PlayerComponentProps> = (props) => {
    const { availablePlayers, setAvailablePlayers, makePick } = props
    const { walletAddress } = useAuth()
    const leagueId = useAppSelector((state) => state.league.leagueId)
    const tutorialMode = useAppSelector((state) => state.league.tutorialMode)
    const draftSummary = useAppSelector((state) => state.draft.draftSummary)
    const draftInfo = useAppSelector((state) => state.draft.draftInfo)
    const roster = useAppSelector((state) => state.draft.draftRosters)
    const currentPickNumber = useAppSelector((state) => state.league.currentPickNumber)
    const currentDrafter = useAppSelector((state) => state.league.currentDrafter)
    const queuedPlayers = useAppSelector((state) => state.league.queuedPlayers)
    const currentRound = useAppSelector((state) => state.league.currentRound)
    const canDraft = useAppSelector((state) => state.league.canDraft)
    const [autoPick, _setAutoPick] = useState<boolean>(false)
    const audioOn = useAppSelector((state) => state.league.audioOn)
    const rankings = useAppSelector((state) => state.draft.draftPlayerRankings)
    const idleCount = useAppSelector((state) => state.league.idleCount)
    const recentlyDraftedPlayer = useAppSelector((state) => state.league.mostRecentPlayerDrafted)
    const [bestADPPlayers, setBestADPPlayers] = useState<PlayerDataProps[]>([])
    const timeRemaining = useAppSelector((state) => state.league.timeRemaining)

    const dispatch = useAppDispatch()
    // const {timeRemaining} = useTimer(leagueId)

    useEffect(() => {
        const bestPlayers = availablePlayers
            .filter((data) => data.stats.adp !== 0)
            .sort((a, b) => {
                if (a.stats.adp === 0 && b.stats.adp !== 0) {
                    return 1
                } else if (a.stats.adp !== 0 && b.stats.adp === 0) {
                    return -1
                } else {
                    return a.stats.adp - b.stats.adp
                }
            })
        setBestADPPlayers(bestPlayers)
    }, [availablePlayers])

    // set available players on component mount, however data is stale after new pick
    useEffect(() => {
        if (rankings) {
            try {
                const players = rankings.filter((data) => data.playerStateInfo.ownerAddress === "")
                setAvailablePlayers(players)
            } catch (e) {
                console.error(e)
                // pass
            }
            
        }
    }, [rankings])

    useEffect(() => {
        if (recentlyDraftedPlayer && rankings) {
            // grab players that are still available
            const updatedAvailablePlayers = rankings!.filter((data) => data.playerStateInfo.ownerAddress === "")
            setAvailablePlayers(updatedAvailablePlayers)
        }
    }, [recentlyDraftedPlayer, rankings])

    // update queue with available players
    useEffect(() => {
        if (availablePlayers) {
            const updatedPlayers = queuedPlayers.filter((player) =>
                availablePlayers.some((data) => data.playerStateInfo.playerId === player.playerId)
            )
            dispatch(setQueue(updatedPlayers))
        }
    }, [availablePlayers])

    const submitPick = (candidate?: PlayerDataProps) => {
        if (!candidate) return
        makePick({
            playerId: candidate.playerStateInfo.playerId,
            displayName: candidate.playerStateInfo.displayName,
            team: candidate.playerStateInfo.team,
            position: candidate.playerStateInfo.position,
        })
    }

    // idle pick
    useEffect(() => {
        if (tutorialMode) return
        // TODO: Update 3 to 30 in prod
        if (idleCount >= 2 && canDraft && timeRemaining! < 27) {
            logger.debug("init auotpick")
            // @ts-expect-error roster map value typing
            const myRoster = Object.entries(roster[walletAddress!]).map(([key, value]) => ({
                key,
                // @ts-expect-error roster slot length typing
                length: value.length,
            }))
            if (queuedPlayers.length > 0) {
                logger.debug("autopick: choosing from queued players")
                makePick({
                    playerId: queuedPlayers[0].playerId,
                    displayName: queuedPlayers[0].displayName,
                    team: queuedPlayers[0].team,
                    position: queuedPlayers[0].position,
                })
                // if within the first 12 rounds, then draft highest ADP players
            } else if (currentRound! < 12) {
                logger.debug("currentRound < 12")
                submitPick(bestADPPlayers[0])
            } else {
                if (myRoster.some((item) => item.key === "RB" && item.length < 1)) {
                    logger.debug("choosing rb")
                    const bestAvailable = availablePlayers.find(
                        (position) => position.stats.playerId.indexOf("-RB") >= 1
                    )
                    submitPick(bestAvailable)
                } else if (myRoster.some((item) => item.key === "WR" && item.length < 1)) {
                    logger.debug("choosing wr")
                    const bestAvailable = availablePlayers.find(
                        (position) => position.stats.playerId.indexOf("-WR") >= 1
                    )
                    submitPick(bestAvailable)
                } else if (myRoster.some((item) => item.key === "QB" && item.length < 1)) {
                    logger.debug("choosing qb")
                    const bestAvailable = availablePlayers.find(
                        (position) => position.stats.playerId.indexOf("-QB") >= 1
                    )
                    submitPick(bestAvailable)
                } else if (myRoster.some((item) => item.key === "TE" && item.length < 1)) {
                    logger.debug("choosing te")
                    const bestAvailable = availablePlayers.find(
                        (position) => position.stats.playerId.indexOf("-TE") >= 1
                    )
                    submitPick(bestAvailable)
                } else if (myRoster.some((item) => item.key === "DST" && item.length < 1)) {
                    logger.debug("choosing dst")
                    const bestAvailable = availablePlayers.find(
                        (position) => position.stats.playerId.indexOf("-DST") >= 1
                    )
                    submitPick(bestAvailable)
                    // if all min positions are filled, then go back to highest adp
                } else {
                    logger.debug("choosing whomever")
                    submitPick(bestADPPlayers[0])
                }
            }
        }
    }, [availablePlayers, bestADPPlayers, canDraft, currentRound, idleCount, makePick, queuedPlayers, roster, timeRemaining, tutorialMode, walletAddress])

    const { playYourTurn } = useAudioYourTurn("/your-turn.wav")

    useEffect(() => {
        if (currentDrafter === walletAddress && canDraft && audioOn) {
            playYourTurn()
        }
    }, [audioOn, canDraft, currentDrafter, playYourTurn, walletAddress])

    useEffect(() => {
        if (idleCount >= 2) {
            // setAutoPick(true)
        }
    }, [idleCount])

    useEffect(() => {
        if (autoPick) {
            dispatch(setIdleCount(2))
        } else {
            dispatch(setIdleCount(0))
        }
    }, [autoPick])

    // calculate turn
    const [turn, setTurn] = useState<number>(0)

    useEffect(() => {
        if (!tutorialMode && leagueId) {
            Draft.getDraftRosters(leagueId).then((response) => {
                dispatch(setDraftRosters(response))
            })
        }
        if (currentPickNumber && draftSummary) {
            // index the current pick
            const index = draftSummary.findIndex((item) => item.playerInfo.pickNum === currentPickNumber)
            const currentList = draftSummary.slice(index)
            const nextIndex = currentList.findIndex((item) => item.playerInfo.ownerAddress === walletAddress)
            // const nextList = currentList.slice(0, nextIndex + 1)
            const nextPick = currentList.filter((item, index) => index < nextIndex).length
            setTurn(nextPick)
        }
    }, [currentPickNumber, draftSummary, tutorialMode, leagueId])
    const leagueLevel = useAppSelector((state) => state.league.leagueLevel)

    // Build all 150 pick slots (15 rounds × 10 drafters) from draftOrder,
    // then overlay actual pick data where it exists. This matches the working
    // product: all boxes pre-rendered, scrolling right as picks are made.
    const allSlots: SummaryProps[] = React.useMemo(() => {
        const order = draftInfo?.draftOrder
        if (!order || order.length === 0) return draftSummary ?? []

        const totalRounds = 15
        const perRound = order.length
        const totalPicks = totalRounds * perRound

        // Index existing picks by pickNum for fast lookup
        const picksByNum: Record<number, SummaryProps> = {}
        if (draftSummary) {
            for (const s of draftSummary) {
                picksByNum[s.playerInfo.pickNum] = s
            }
        }

        const slots: SummaryProps[] = []
        for (let i = 0; i < totalPicks; i++) {
            const pickNum = i + 1
            const round = Math.floor(i / perRound) + 1
            // Snake draft: odd rounds L→R, even rounds R→L
            const indexInRound = i % perRound
            const slotIndex = round % 2 === 1 ? indexInRound : perRound - 1 - indexInRound
            const drafter = order[slotIndex]

            if (picksByNum[pickNum]) {
                slots.push(picksByNum[pickNum])
            } else {
                slots.push({
                    playerInfo: {
                        playerId: "",
                        displayName: "",
                        team: "",
                        position: "",
                        ownerAddress: drafter?.ownerId ?? "",
                        pickNum,
                        round,
                    },
                    pfpInfo: {
                        imageUrl: "",
                        nftContract: "",
                        displayName: drafter?.ownerId ?? "",
                    },
                })
            }
        }
        return slots
    }, [draftInfo?.draftOrder, draftSummary])

    const visibleSummary: SummaryProps[] = allSlots

    return (
        <div
            className={getStyleForLeagueLevel(leagueLevel)}
        >
            <StyledContainer className="w-full flex gap-2 lg:gap-5 overflow-x-auto">
                {visibleSummary.length > 0 && roster && currentPickNumber !== null ? (
                    visibleSummary.map((item) => {
                        return (
                            <PlayerCardComponent
                                item={item}
                                key={`${item.playerInfo.ownerAddress}-${item.playerInfo.pickNum}`}
                                draftedPlayer={item.playerInfo.playerId}
                                // @ts-expect-error roster entry type is dynamic
                                roster={roster[item.playerInfo.ownerAddress]}
                            />
                        )
                    })
                ) : (
                    <ReactLoading type={"bubbles"} color={"#fff"} height={100} width={100} />
                )}
            </StyledContainer>
            <div className="flex items-center justify-between px-3 pt-2 mt-3 bg-slate-80">
                <div role="status" aria-live="polite" className="grow text-center uppercase text-sm font-bold">
                    {timeRemaining === null
                        ? "Draft will start soon"
                        : currentPickNumber && turn > 0
                        ? `${turn} turn(s) until your pick!`
                        : turn === 0 && currentDrafter === walletAddress
                        ? "Your turn to draft!"
                        : ""}
                </div>
            </div>
            <div className="flex items-center justify-center py-2 border-b border-slate-700">
                {leagueLevel === "Hall of Fame" && (
                    <div>
                        <img src="/hof.png" alt="Hall of Fame" className=" w-[50px] mr-2 h-auto" />
                    </div>
                )}
                {leagueLevel === "Jackpot" && (
                    <div style={{marginRight: '5px'}}>
                        <img src="/jackpot.png" alt="Jackpot" className=" w-[100px] mr-2 h-auto" />
                    </div>
                )}
                <div>
                    <button
                        onClick={() => (audioOn ? dispatch(setAudio(false)) : dispatch(setAudio(true)))}
                        className="text-[12px] text-right cursor-pointer flex items-center justify-end border border-gray-500 px-1 mr-2"
                    >
                        {audioOn ? "MUTE" : "UNMUTE"} <MdAudiotrack />
                    </button>
                </div>
                {
                    /**
                    <div>
                        <span className="text-xs relative bottom-0.5 pr-1">AUTOPICK</span>
                        <Switch
                            checked={autoPick}
                            onChange={() => setAutoPick((prev) => !prev)}
                            className={classNames(
                                autoPick ? "bg-red-500" : "bg-slate-500",
                                "relative inline-flex h-4 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-slate-600 focus:ring-offset-2"
                            )}
                        >
                            <span className="sr-only">Toggle Autopick</span>
                            <span
                                aria-hidden="true"
                                className={classNames(
                                    autoPick ? "translate-x-5" : "translate-x-0",
                                    "pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white transition duration-200 ease-in-out"
                                )}
                            />
                        </Switch>
                    </div>
                     */
                }
                
            </div>
        </div>
    )
}

export default PlayerComponent
