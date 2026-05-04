import { useAppDispatch, useAppSelector } from "@/redux/hooks/reduxHooks"
import { useAuth } from "@/hooks/useAuth"
import React, { useEffect, useRef, useState } from "react"
import TimerComponent from "./TimerComponent"
import { SummaryProps, ViewState } from "@/utils/types/types"
import { COLORS, positionColor, getTruncatedAccountName } from "@/utils/helpers"
import styled from "styled-components"
import { setSelectedCard, setViewState } from "@/redux/leagueSlice"

const minHeight = "54px"

const StyledContainer = styled.div`
    min-width: 140px;
    text-align: center;
    padding: 10px 0px 0px 0px;
    align-items: center;
    border-radius: 5px;
    overflow: hidden;
    flex: 1;
    border-width: 1px;
    transition: all 0.25s ease-in-out;

    &:hover {
        cursor: pointer;
        background: #333;
        border: 1px solid #fff;
    }

    .rp-label {
        font-size: 15px;
        font-weight: 800;
    }

    @media (max-width: 1024px) {
        min-width: 100px;
        padding-top: 2px;

        .rp-label {
            font-size: 13px;
            color: pink;
        }
    }

    @media (max-width: 480px) {
        min-width: 80px;
        padding-top: 2px;
        font-size: 11px;

        .rp-label {
            font-size: 11px;
        }
    }
`

const StyledPositions = styled.div`
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    min-height: ${minHeight};
    color: #fff;
`

type PlayerCardComponentProps = {
    draftedPlayer: string
    item: SummaryProps
    roster: Record<string, unknown[] | null>
}

const getBackgroundColor = (leagueLevel: string, dark=false) => {
    switch (leagueLevel) {
        case 'Hall of Fame':
            return '#F3E216'
        case 'Jackpot':
            return '#FF474C'
        default:
            return dark ? '#222' : '#fff'
    }
}

const getTextColor = (leagueLevel: string, dark=false) => {
    switch (leagueLevel) {
        case 'Hall of Fame':
            return '#111'
        case 'Jackpot':
            return '#222'
        default:
            return dark ? '#222' : '#fff'
    }
}

const PlayerCardComponent: React.FC<PlayerCardComponentProps> = (props) => {
    const mostRecentPlayerDrafted = useAppSelector((state) => state.league.mostRecentPlayerDrafted)
    const currentPickNumber = useAppSelector((state) => state.league.currentPickNumber)
    const [recentlyDraftedPlayer, setRecentlyDraftedPlayer] = useState<string>("")
    const { walletAddress } = useAuth()
    const timeRemaining = useAppSelector((state) => state.league.timeRemaining)
    const leagueStatus = useAppSelector((state) => state.league.leagueStatus)
    const leagueLevel = useAppSelector((state) => state.league.leagueLevel)
    const dispatch = useAppDispatch()

    const { item, draftedPlayer, roster } = props
    useEffect(() => {
        if (
            mostRecentPlayerDrafted &&
            item.playerInfo.pickNum === mostRecentPlayerDrafted.pickNum &&
            item.playerInfo.ownerAddress === mostRecentPlayerDrafted.ownerAddress
        )
            setRecentlyDraftedPlayer(mostRecentPlayerDrafted.playerId)
    }, [mostRecentPlayerDrafted])

    const currentRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (item.playerInfo.pickNum === currentPickNumber)
            currentRef.current?.scrollIntoView({ behavior: "smooth", inline: "start" })
    }, [item.playerInfo.pickNum, currentPickNumber])

    return (
        <StyledContainer
            ref={currentRef}
            style={{
                borderColor:
                    item.playerInfo.ownerAddress === walletAddress
                        ? COLORS.primary
                        : item.playerInfo.pickNum === currentPickNumber
                        ? "#fff"
                        : "#444",
                backgroundColor:
                    item.playerInfo.ownerAddress === walletAddress
                        ? getBackgroundColor(leagueLevel, true)
                        : "#222",
            }}
            onClick={() => {
                dispatch(setSelectedCard(item.playerInfo.ownerAddress))
                dispatch(setViewState(ViewState.ROSTER))
            }}
        >
            <div>
                <img
                    src={item.pfpInfo.imageUrl !== "" ? item.pfpInfo.imageUrl : "/banana-profile.png"}
                    alt="Banana Best Ball Player"
                    className="rounded-full w-[30px] mx-auto h-[30px] border border-gray-500"
                />
                {item.playerInfo.pickNum === currentPickNumber && leagueStatus !== "completed" ? (
                    <TimerComponent />
                ) : (
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "row",
                            justifyContent: "center",
                            alignItems: "center",
                            gap: 15,
                            marginTop: 5,
                            paddingBottom: 3,
                        }}
                    >
                        <div>
                            <p
                                className="rp-label"
                                style={{
                                    color:
                                        item.playerInfo.ownerAddress === walletAddress
                                            ? getTextColor(leagueLevel, false)
                                            : "#fff",
                                }}
                            >
                                R{item.playerInfo.round}
                            </p>
                        </div>
                        <div>
                            <p
                                className="rp-label"
                                style={{
                                    color:
                                        item.playerInfo.ownerAddress === walletAddress
                                            ? getTextColor(leagueLevel, false)
                                            : "#fff",
                                }}
                            >
                                P{item.playerInfo.pickNum}
                            </p>
                        </div>
                    </div>
                )}
                <div
                    className="lg:mt-1 font-bold text-[11px] lg:text-[14px] font-primary"
                    style={{
                        color:
                            item.playerInfo.ownerAddress === walletAddress
                                ? getTextColor(leagueLevel, false)
                                : "#fff",
                    }}
                >
                    {getTruncatedAccountName(item.pfpInfo.displayName, item.playerInfo.ownerAddress)}
                </div>
                {roster && item.playerInfo.pickNum > currentPickNumber! && (
                    <StyledPositions>
                        <div
                            style={{
                                flex: 1,
                                borderTopWidth: 2,
                                color:
                                    item.playerInfo.ownerAddress === walletAddress
                                        ? getTextColor(leagueLevel, false)
                                        : "#fff",
                                borderTopColor: COLORS.qb,
                            }}
                        >
                            <p style={{ fontSize: "10px" }}>QB</p>
                            <p className="text-xs">{roster["QB"] === null ? 0 : roster["QB"].length}</p>
                        </div>
                        <div
                            style={{
                                flex: 1,
                                borderTopWidth: 2,
                                color:
                                    item.playerInfo.ownerAddress === walletAddress
                                        ? getTextColor(leagueLevel, false)
                                        : "#fff",
                                borderTopColor: COLORS.rb,
                            }}
                        >
                            <p style={{ fontSize: "10px" }}>RB</p>
                            <p className="text-xs">{roster["RB"] === null ? 0 : roster["RB"].length}</p>
                        </div>
                        <div
                            style={{
                                flex: 1,
                                borderTopWidth: 2,
                                color:
                                    item.playerInfo.ownerAddress === walletAddress
                                        ? getTextColor(leagueLevel, false)
                                        : "#fff",
                                borderTopColor: COLORS.wr,
                            }}
                        >
                            <p style={{ fontSize: "10px" }}>WR</p>
                            <p className="text-xs">{roster["WR"] === null ? 0 : roster["WR"].length}</p>
                        </div>
                        <div
                            style={{
                                flex: 1,
                                borderTopWidth: 2,
                                color:
                                    item.playerInfo.ownerAddress === walletAddress
                                        ? getTextColor(leagueLevel, false)
                                        : "#fff",
                                borderTopColor: COLORS.te,
                            }}
                        >
                            <p style={{ fontSize: "10px" }}>TE</p>
                            <p className="text-xs">{roster["TE"] === null ? 0 : roster["TE"].length}</p>
                        </div>
                        <div
                            style={{
                                flex: 1,
                                borderTopWidth: 2,
                                color:
                                    item.playerInfo.ownerAddress === walletAddress
                                        ? getTextColor(leagueLevel, false)
                                        : "#fff",
                                borderTopColor: COLORS.dst,
                            }}
                        >
                            <p style={{ fontSize: "10px" }}>DST</p>
                            <p className="text-xs">{roster["DST"] === null ? 0 : roster["DST"].length}</p>
                        </div>
                    </StyledPositions>
                )}
                {item.playerInfo.pickNum === currentPickNumber && (
                    <div
                        style={{
                            borderBottomWidth: 5,
                            borderBottomColor: "#fff",
                            width: "100%",
                            minHeight,
                        }}
                    >
                        <p
                            className="font-primary text-[15px] font-bold italic text-center pt-2"
                            style={{
                                color:
                                    item.playerInfo.ownerAddress === walletAddress
                                        ? getTextColor(leagueLevel, false)
                                        : "#fff",
                            }}
                        >
                            {leagueStatus === "completed" ? (
                                <></>
                            ) : (
                                <>
                                    {timeRemaining === null
                                        ? "Starting soon!"
                                        : "Picking..."}
                                </>
                            )}
                        </p>
                    </div>
                )}
                {item.playerInfo.pickNum < currentPickNumber! && (
                    <div
                        style={{
                            borderBottomWidth: 5,
                            borderBottomColor: positionColor(draftedPlayer ? draftedPlayer : recentlyDraftedPlayer),
                            width: "100%",
                            height: "55px",
                        }}
                    >
                        <p
                            style={{
                                color:
                                    item.playerInfo.ownerAddress === walletAddress
                                        ? getTextColor(leagueLevel, false)
                                        : "#fff",
                                fontWeight: "800",
                                fontSize: 15,
                                textAlign: "center",
                                paddingTop: 5,
                            }}
                            className="font-primary"
                        >
                            {draftedPlayer ? draftedPlayer : recentlyDraftedPlayer}
                        </p>
                    </div>
                )}
            </div>
        </StyledContainer>
    )
}

export default PlayerCardComponent
