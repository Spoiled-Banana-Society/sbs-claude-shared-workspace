import { COLORS, positionColor, getTruncatedAccountName } from "@/utils/helpers"
import { DraftRosterProps, RosterProps } from "@/utils/types/types"
import React from "react"
import styled from "styled-components"

type RosterItemProps = {
    selectedPlayer: string
    roster: DraftRosterProps[]
}

const StyledWrapper = styled.div`
    .header {
        padding-top: 30px;
    }
    .header-players {
        display: flex;
        flex-direction: row;
        align-items: center;
        justify-content: center;
        gap: 15px;
    }
    .player-text {
        text-align: center;
        font-weight: bold;
        color: #fff;
        font-size: 22px;
    }
    .header-text {
        text-align: center;
        font-weight: bold;
        color: #fff;
        font-size: 18px;
    }
    .position-item {
        display: flex;
        flex-flow: row nowrap;
        justify-content: flex-end;
        padding: 7px 0 0 10px;
        margin-bottom: 10px;
    }
    .position-item:last-child {
        margin-bottom: 0;
    }
    .position-border {
        border-left: 2px solid #666;
    }
    .item-header {
        color: #ccc;
        text-transform: uppercase;
        font-size: 14px;
        font-weight: bold;
    }
    .item-values {
        color: #fff;
        font-weight: bold;
        text-transform: uppercase;
        font-size: 13px;
    }
    .position-value {
        font-size: 16px;
    }
    .item-container {
        border-bottom: 1px solid #666;
        padding-bottom: 25px;
    }
    .profile-photo {
        width: 40px;
        height: 40px;
        background: #424242;
        border: 1px solid #777;
        border-radius: 50%;
        margin: 10px auto;
    }
`

type ItemProps = {
    player: RosterProps
}

const RosterHeading: React.FC = () => {
    return (
        <div className="position-item">
            <div style={{ flex: 7 }}></div>
            <div style={{ flex: 1 }}>
                <p className="item-header text-right">BYE</p>
            </div>
            <div style={{ flex: 1 }}>
                <p className="item-header text-right">ADP</p>
            </div>
            <div style={{ flex: 1 }}>
                <p className="item-header text-right">PICK</p>
            </div>
        </div>
    )
}

const RosterItem: React.FC<ItemProps> = (props) => {
    const { player } = props
    return (
        <div
            className="position-item position-border"
            style={{
                borderColor: positionColor(player.playerId),
            }}
        >
            <div style={{ flex: 7 }}>
                <p className="item-values position-value">{player.playerId}</p>
            </div>
            <div style={{ flex: 1 }}>
                <p className="item-values text-right">{player.stats.byeWeek}</p>
            </div>
            <div style={{ flex: 1 }}>
                <p className="item-values text-right">{player.stats.adp}</p>
            </div>
            <div style={{ flex: 1 }}>
                <p className="item-values text-right">{player.playerStateInfo.pickNum}</p>
            </div>
        </div>
    )
}

const RosterItemComponent: React.FC<RosterItemProps> = (props) => {
    const { selectedPlayer, roster } = props
    // @ts-expect-error roster item typing mismatch
    const selectedRoster = roster[selectedPlayer]

    return (
        <StyledWrapper>
            {selectedRoster && (
                <>
                    <div className="header">
                        <div>
                            <img
                                src={
                                    selectedRoster.PFP.imageUrl !== ""
                                        ? selectedRoster.PFP.imageUrl
                                        : "/banana-profile.png"
                                }
                                alt="SBS Fantasy"
                                className="profile-photo"
                            />
                        </div>
                        <div>
                            <p className="player-text">
                                {getTruncatedAccountName(selectedRoster.PFP.displayName, selectedPlayer)}
                            </p>
                        </div>
                        <div className="header-players">
                            <div>
                                <div>
                                    <p className="font-primary font-bold" style={{ color: `${COLORS.qb}` }}>
                                        QB
                                    </p>
                                </div>
                                <div>
                                    <p className="header-text">
                                        {selectedRoster.QB !== null ? selectedRoster.QB.length : 0}
                                    </p>
                                </div>
                            </div>
                            <div>
                                <div>
                                    <p className="font-primary font-bold" style={{ color: `${COLORS.rb}` }}>
                                        RB
                                    </p>
                                </div>
                                <div>
                                    <p className="header-text">
                                        {selectedRoster.RB !== null ? selectedRoster.RB.length : 0}
                                    </p>
                                </div>
                            </div>
                            <div>
                                <div>
                                    <p className="font-primary font-bold" style={{ color: `${COLORS.wr}` }}>
                                        WR
                                    </p>
                                </div>
                                <div>
                                    <p className="header-text">
                                        {selectedRoster.WR !== null ? selectedRoster.WR.length : 0}
                                    </p>
                                </div>
                            </div>
                            <div>
                                <div>
                                    <p className="font-primary font-bold" style={{ color: `${COLORS.te}` }}>
                                        TE
                                    </p>
                                </div>
                                <div>
                                    <p className="header-text">
                                        {selectedRoster.TE !== null ? selectedRoster.TE.length : 0}
                                    </p>
                                </div>
                            </div>
                            <div>
                                <div>
                                    <p className="font-primary font-bold" style={{ color: `${COLORS.dst}` }}>
                                        DST
                                    </p>
                                </div>
                                <div>
                                    <p className="header-text">
                                        {selectedRoster.DST !== null ? selectedRoster.DST.length : 0}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="mt-10">
                        <div className="item-container">
                            <RosterHeading />
                        </div>
                    </div>
                    <div style={{ paddingBottom: 150 }}>
                        <div className="item-container">
                            <div>
                                <p
                                    className="font-primary font-bold"
                                    style={{ fontSize: 21, paddingTop: 20, paddingBottom: 5, color: COLORS.qb }}
                                >
                                    QB
                                </p>
                            </div>
                            {selectedRoster["QB"].length === 0 ? (
                                <div className="my-5">
                                    <p style={{ color: "#fff" }}>--</p>
                                </div>
                            ) : (
                                selectedRoster["QB"].map((player: RosterProps) => (
                                    <RosterItem player={player} key={player.playerStateInfo.pickNum} />
                                ))
                            )}
                        </div>
                        <div className="item-container">
                            <div>
                                <p
                                    className="font-primary font-bold"
                                    style={{ fontSize: 21, paddingTop: 20, paddingBottom: 5, color: COLORS.rb }}
                                >
                                    RB
                                </p>
                            </div>
                            {selectedRoster["RB"].length === 0 ? (
                                <div className="my-5">
                                    <p style={{ color: "#fff" }}>--</p>
                                </div>
                            ) : (
                                selectedRoster["RB"].map((player: RosterProps) => (
                                    <RosterItem player={player} key={player.playerStateInfo.pickNum} />
                                ))
                            )}
                        </div>
                        <div className="item-container">
                            <div>
                                <p
                                    className="font-primary font-bold"
                                    style={{ fontSize: 21, paddingTop: 20, paddingBottom: 5, color: COLORS.wr }}
                                >
                                    WR
                                </p>
                            </div>
                            {selectedRoster["WR"].length === 0 ? (
                                <div className="my-5">
                                    <p style={{ color: "#fff" }}>--</p>
                                </div>
                            ) : (
                                selectedRoster["WR"].map((player: RosterProps) => (
                                    <RosterItem player={player} key={player.playerStateInfo.pickNum} />
                                ))
                            )}
                        </div>
                        <div className="item-container">
                            <div>
                                <p
                                    className="font-primary font-bold"
                                    style={{ fontSize: 21, paddingTop: 20, paddingBottom: 5, color: COLORS.te }}
                                >
                                    TE
                                </p>
                            </div>
                            {selectedRoster["TE"].length === 0 ? (
                                <div className="my-5">
                                    <p style={{ color: "#fff" }}>--</p>
                                </div>
                            ) : (
                                selectedRoster["TE"].map((player: RosterProps) => (
                                    <RosterItem player={player} key={player.playerStateInfo.pickNum} />
                                ))
                            )}
                        </div>
                        <div className="item-container">
                            <div>
                                <p
                                    className="font-primary font-bold"
                                    style={{ fontSize: 21, paddingTop: 20, paddingBottom: 5, color: COLORS.dst }}
                                >
                                    DST
                                </p>
                            </div>
                            {selectedRoster["DST"].length === 0 ? (
                                <div className="my-5">
                                    <p style={{ color: "#fff" }}>--</p>
                                </div>
                            ) : (
                                selectedRoster["DST"].map((player: RosterProps) => (
                                    <RosterItem player={player} key={player.playerStateInfo.pickNum} />
                                ))
                            )}
                        </div>
                    </div>
                </>
            )}
        </StyledWrapper>
    )
}

export default RosterItemComponent
