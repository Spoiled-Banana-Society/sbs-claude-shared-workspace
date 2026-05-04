import { useAppDispatch, useAppSelector } from "@/redux/hooks/reduxHooks"
import { useAuth } from "@/hooks/useAuth"
import RosterItemComponent from "./RosterItemComponent"
import { setDraftRosters } from "@/redux/draftSlice"
import React, { useEffect, useState } from "react"
import { truncate } from "@/utils/helpers"
import Dropdown from "react-dropdown"
import ReactLoading from "react-loading"
import { Draft } from "@/utils/api"
import "react-dropdown/style.css"

const RosterComponent = () => {
    const { walletAddress } = useAuth()
    const roster = useAppSelector((state) => state.draft.draftRosters)
    const [selectedPlayer, setSelectedPlayer] = useState<string>(walletAddress!)
    const currentPickNumber = useAppSelector((state) => state.league.currentPickNumber)
    const [refetch, setRefetch] = useState<boolean>(false)
    const selectedCard = useAppSelector((state) => state.league.selectedCard)
    const leagueId = useAppSelector((state) => state.league.leagueId)
    const players = Object.keys(roster!)
    const dispatch = useAppDispatch()

    useEffect(() => {
        if (selectedCard) setSelectedPlayer(selectedCard)
    }, [selectedCard])

    useEffect(() => {
        if (currentPickNumber) {
            setRefetch(true)
            Draft.getDraftRosters(leagueId!).then((response) => {
                dispatch(setDraftRosters(response))
            })
            const refetcher = setTimeout(() => {
                setRefetch(false)
            }, 250)
            return () => clearTimeout(refetcher)
        }
    }, [currentPickNumber])

    useEffect(() => {
        if (selectedCard) {
            setSelectedPlayer(selectedCard)
        } else {
            setSelectedPlayer(walletAddress!)
        }
    }, [])

    return (
        <div className="px-3 pt-5 w-full lg:w-[900px] mx-auto" data-tutorial="roster">
            {players && walletAddress ? (
                <Dropdown
                    options={players}
                    onChange={(e) => setSelectedPlayer(e.value)}
                    value={truncate(selectedPlayer) || truncate(walletAddress!)}
                    placeholder="Select a player"
                    className="font-primary font-bold"
                />
            ) : (
                <div>
                    <p className="text-center font-primary font-bold">Please wait...</p>
                </div>
            )}
            <div>
                {selectedPlayer && roster && !refetch ? (
                    <RosterItemComponent selectedPlayer={selectedPlayer} roster={roster} />
                ) : (
                    <div className="h-full flex items-center justify-center">
                        <ReactLoading type={"bubbles"} color={"#fff"} height={100} width={100} />
                    </div>
                )}
            </div>
        </div>
    )
}

export default RosterComponent
