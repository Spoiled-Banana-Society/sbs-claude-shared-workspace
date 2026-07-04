import { useAppDispatch, useAppSelector } from "@/redux/hooks/reduxHooks"
import { useAuth } from "@/hooks/useAuth"
import RosterItemComponent from "./RosterItemComponent"
import { setDraftRosters } from "@/redux/draftSlice"
import React, { useEffect, useState } from "react"
import { bananaPlaceholderName, isWalletAddress } from "@/utils/helpers"
import Dropdown from "react-dropdown"
import ReactLoading from "react-loading"
import { Draft } from "@/utils/api"
import { UserPopover } from "@/components/social/UserPopover"
import { useDraftRoomUsers } from "@/hooks/useDraftRoomUsers"
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
    const roomUsers = useDraftRoomUsers([selectedPlayer])

    // Show the "add friend / message" affordance only when looking at
    // another real human's roster — not yourself, not a bot slot.
    const viewingOther =
        isWalletAddress(selectedPlayer) &&
        selectedPlayer.toLowerCase() !== (walletAddress || "").toLowerCase() &&
        !selectedPlayer.toLowerCase().startsWith("bot-")
    const otherInfo = roomUsers[selectedPlayer?.toLowerCase()]

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
                    options={players.map((w) => ({ value: w, label: bananaPlaceholderName(w) }))}
                    onChange={(e) => setSelectedPlayer(e.value)}
                    value={{
                        value: selectedPlayer || walletAddress!,
                        label: bananaPlaceholderName(
                            isWalletAddress(selectedPlayer) ? selectedPlayer : walletAddress!
                        ),
                    }}
                    placeholder="Select a player"
                    className="font-primary font-bold"
                />
            ) : (
                <div>
                    <p className="text-center font-primary font-bold">Please wait...</p>
                </div>
            )}

            {viewingOther && (
                <div className="mt-2 flex justify-center">
                    <UserPopover
                        walletAddress={selectedPlayer}
                        username={otherInfo?.displayName || bananaPlaceholderName(selectedPlayer)}
                        pfpUrl={otherInfo?.imageUrl || undefined}
                    >
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5 text-[13px] font-medium text-white/80 transition-colors hover:bg-white/[0.12] hover:text-white cursor-pointer">
                            <span aria-hidden>👤</span>
                            Add friend / message
                        </span>
                    </UserPopover>
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
