import { useAppDispatch, useAppSelector } from "@/redux/hooks/reduxHooks"
import { useAuth } from "@/hooks/useAuth"
import { PlayerDataProps, SortState } from "@/utils/types/types"
import React, { useEffect, useState } from "react"
import DraftSearchbar from "./DraftSearchbar"
import DraftItemComponent from "./DraftItemComponent"
import { Draft, Queue } from "@/utils/api"
import { setDraftRankings, setDraftSort } from "@/redux/draftSlice"
import { setQueue } from "@/redux/leagueSlice"
import { logger } from '@/lib/logger';

type DraftComponentProps = {
    availablePlayers: PlayerDataProps[]
    setAvailablePlayers: (players: PlayerDataProps[]) => void
    makePick: (player: { playerId: string; displayName: string; team: string; position: string }) => void
}

const DraftComponent: React.FC<DraftComponentProps> = ({ makePick, ..._props }) => {
    const leagueId = useAppSelector((state) => state.league.leagueId)
    const { walletAddress } = useAuth()
    const mostRecentDraftedPlayer = useAppSelector((state) => state.league.mostRecentPlayerDrafted)
    const [availablePlayers, setAvailablePlayers] = useState<PlayerDataProps[]>([])
    const sortState = useAppSelector((state) => state.draft.sortBy)
    const [expandInput, setExpandInput] = useState<boolean>(false)
    const [inputString, setInputString] = useState<string>("")
    const [selectedPositions, setSelectedPositions] = useState<string[]>([])
    const rankings = useAppSelector((state) => state.draft.draftPlayerRankings)
    const dispatch = useAppDispatch()

    useEffect(() => {
        Draft.getPlayerRankings(leagueId!, walletAddress!).then((res) => {
            dispatch(setDraftRankings(res))
        })
        Queue.getQueue(walletAddress!, leagueId!).then((res) => {
            dispatch(setQueue(res))
        })
        Draft.getDraftSortOrder(leagueId!, walletAddress!).then((res) => {
            if (res.toUpperCase() === "ADP") {
                dispatch(setDraftSort(SortState.ADP))
            } else if (res.toUpperCase() === "RANK") {
                dispatch(setDraftSort(SortState.RANK))
            } else {
                // default to ADP if call fails
                dispatch(setDraftSort(SortState.ADP))
            }
        })
    }, [])

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

    // therefore we update list based off recently drafted player
    useEffect(() => {
        if (mostRecentDraftedPlayer) {
            const updatedRankings = availablePlayers.filter(
                (data) => data.stats.playerId !== mostRecentDraftedPlayer.playerId
            )
            setAvailablePlayers(updatedRankings)
        }
    }, [mostRecentDraftedPlayer])

    const searchChangeHandler = (payload: string) => {
        if (payload === "ADP") {
            Draft.updateDraftSortOrder(leagueId!, walletAddress!, "ADP").then((res: string) => {
                if (res === payload) {
                    dispatch(setDraftSort(SortState.ADP))
                }
            })
            return
        }
        if (payload === "RANK") {
            Draft.updateDraftSortOrder(leagueId!, walletAddress!, "RANK").then((res: string) => {
                if (res === payload) {
                    dispatch(setDraftSort(SortState.RANK))
                }
            })
            return
            return
        }
        
        // if selectedPositions includes position, exclude it
        if (selectedPositions.includes(payload)) {
            setSelectedPositions(selectedPositions.filter((item) => item !== payload))
        } else {
            // if less than 3 filters active, then add it to array
            if (selectedPositions.length < 5) {
                setSelectedPositions([...selectedPositions, payload])
            }
        }
    }

    const customSort = (a: PlayerDataProps, b: PlayerDataProps) => {
        if (sortState === SortState.RANK || (a.stats.adp === 0 && b.stats.adp === 0)) {
            return a.ranking.rank - b.ranking.rank
        } else {
            if (a.stats.adp === 0 && b.stats.adp !== 0) {
                return 1
            } else if (a.stats.adp !== 0 && b.stats.adp === 0) {
                return -1
            } else {
                return a.stats.adp - b.stats.adp
            }
        }
    }

    const filterAndSortPlayers = (players: PlayerDataProps[], positions: string[]) => {
        // if search expand is on, then reutrn queried data instead
        if (expandInput) {
            const queriedData = availablePlayers.filter((data) => data.stats.playerId.includes(inputString))
            return queriedData
        } else {
            let filteredAndSortedArray: PlayerDataProps[] = []
            // if no positions selected, return all players
            if (positions.length === 0) {
                filteredAndSortedArray = players
            }

            // else return players that match selected positions
            positions.forEach((position) => {
                filteredAndSortedArray = [
                    ...filteredAndSortedArray,
                    ...players.filter((player) => player.stats.playerId.includes(position)),
                ]
                logger.debug(filteredAndSortedArray)
            })
            return filteredAndSortedArray.sort(customSort)
        }
    }

    const filteredAndSortedPlayers: PlayerDataProps[] = filterAndSortPlayers(availablePlayers, selectedPositions)

    return (
        <div data-tutorial="player-list">
            {selectedPositions && (
                <DraftSearchbar
                    searchChangeHandler={searchChangeHandler}
                    selectedPositions={selectedPositions}
                    setSelectedPositions={setSelectedPositions}
                    expandInput={expandInput}
                    setExpandInput={setExpandInput}
                    inputString={inputString}
                    setInputString={setInputString}
                    sortState={sortState}
                />
            )}
            {filteredAndSortedPlayers.map((player) => {
                return <DraftItemComponent key={player.ranking.rank} item={player} makePick={makePick} />
            })}
        </div>
    )
}

export default DraftComponent
