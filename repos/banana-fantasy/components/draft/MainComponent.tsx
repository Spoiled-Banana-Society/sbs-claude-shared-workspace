import React from "react"
import dynamic from "next/dynamic"
import DraftComponent from "./DraftComponent"
import QueueComponent from "./QueueComponent"
import BoardComponent from "./BoardComponent"
import RosterComponent from "./RosterComponent"
import { useAppDispatch, useAppSelector } from "@/redux/hooks/reduxHooks"
import { ViewState } from "@/utils/types/types"
import { setViewState } from "@/redux/leagueSlice"
import { PlayerDataProps } from "@/utils/types/types"

const CompletedComponent = dynamic(() => import("./CompletedComponent"), { ssr: false })

type MainDraftComponentProps = {
    availablePlayers: PlayerDataProps[]
    setAvailablePlayers: (players: PlayerDataProps[]) => void
    makePick: (player: { playerId: string; displayName: string; team: string; position: string }) => void
}

const MainComponent: React.FC<MainDraftComponentProps> = (props) => {
    const { availablePlayers, setAvailablePlayers, makePick } = props

    const viewState = useAppSelector((state) => state.league.viewState)
    const leagueStatus = useAppSelector((state) => state.league.leagueStatus)
    const queuedPlayers = useAppSelector((state) => state.league.queuedPlayers)

    const dispatch = useAppDispatch()
    return (
        <main>
            {
                // leagueLevel !== "Hall of Fame" && leagueLevel !== "Jackpot" ? (
                //     <div>
                //         <StyledDraftHoverCard>
                //             <Tooltip style={{width: '500px', marginLeft: '20px'}} id="hof-tooltip" />
                //             <span>Not HOF Draft</span>
                //                 <AiFillInfoCircle 
                //                     style={{fontSize: '20px', marginLeft: '5px'}} 
                //                     data-tooltip-id="hof-tooltip"
                //                     data-tooltip-content="1.2 ETH (~$4,000) Guaranteed Prize for 1st Place of Hall Of Fame Leagues. 5% of leagues will become HOF leagues. Hall of Fame Leagues compete for even more prizes in addition to the Weekly and Seasonal prizes available."
                //                     data-tooltip-place="right"
                //                 />
                //         </StyledDraftHoverCard>
                //         <StyledDraftHoverCard style={{top: '555px'}}>
                //             <Tooltip style={{width: '500px', marginLeft: '20px'}} id="jackpot-tooltip" />
                //             <span>Not Jackpot Draft</span>
                //                 <AiFillInfoCircle 
                //                     style={{fontSize: '22px', marginLeft: '5px'}}
                //                     data-tooltip-id="jackpot-tooltip"
                //                     data-tooltip-content="Jackpot leagues will automatically advance the winner of the league to the finals skipping the first two weeks of the playoffs. 1% percent of leagues will become Jackpot leagues."
                //                     data-tooltip-place="right"
                //                 />
                //         </StyledDraftHoverCard>
                //     </div>
                // ) : ''
            }
            {leagueStatus === "ongoing" ? (
                <>
                    <div className="mx-auto flex items-center justify-center mt-[200px] sm:mt-[290px]">
                        <nav className="flex items-center justify-center gap-2 sm:gap-4 md:gap-10 font-primary uppercase cursor-pointer font-bold text-sm sm:text-base">
                            <div
                                onClick={() => dispatch(setViewState(ViewState.DRAFT))}
                                className={`${
                                    viewState === ViewState.DRAFT
                                        ? "text-primary border border-primary px-2 rounded"
                                        : ""
                                }`}
                            >
                                Draft
                            </div>
                            <div
                                onClick={() => dispatch(setViewState(ViewState.QUEUE))}
                                data-tutorial="queue-tab"
                                className={`${
                                    viewState === ViewState.QUEUE
                                        ? "text-primary border border-primary px-2 rounded"
                                    : ""
                                }`}
                            >
                                Queue {queuedPlayers.length ? `(${queuedPlayers.length})` : ""}
                            </div>
                            <div
                                onClick={() => dispatch(setViewState(ViewState.BOARD))}
                                className={`${
                                    viewState === ViewState.BOARD
                                        ? "text-primary border border-primary px-2 rounded"
                                        : ""
                                }`}
                            >
                                Board
                            </div>
                            <div
                                onClick={() => dispatch(setViewState(ViewState.ROSTER))}
                                className={`${
                                    viewState === ViewState.ROSTER
                                        ? "text-primary border border-primary px-2 rounded"
                                        : ""
                                }`}
                            >
                                Roster
                            </div>
                        </nav>
                    </div>
                    {viewState === ViewState.DRAFT && (
                        <DraftComponent availablePlayers={availablePlayers} setAvailablePlayers={setAvailablePlayers} makePick={makePick} />
                    )}
                    {viewState === ViewState.QUEUE && (
                        <QueueComponent availablePlayers={availablePlayers} setAvailablePlayers={setAvailablePlayers} makePick={makePick} />
                    )}
                    {viewState === ViewState.BOARD && <BoardComponent />}
                    {viewState === ViewState.ROSTER && <RosterComponent />}
                </>
            ) : (
                <CompletedComponent />
            )}
        </main>
    )
}

export default MainComponent
