import { useAppDispatch } from "@/redux/hooks/reduxHooks"
import { useAuth } from "@/hooks/useAuth"
import { setSelectedCard, setViewState } from "@/redux/leagueSlice"
import { COLORS, positionColor } from "@/utils/helpers"
import { SummaryProps, ViewState } from "@/utils/types/types"
import React from "react"
import styled from "styled-components"

type BoardItemProps = {
    item: SummaryProps
}

const StyledBlock = styled.div`
    border-radius: 5px;
    width: 100px;
    height: 80px;
    margin: 7px 5px;
    padding: 5px;
    display: flex;
    flex-flow: column nowrap;
    align-items: flex-start;
    justify-content: space-between;
    text-align: left;
    transition: all 0.1s ease-in-out;
    cursor: pointer;
    &:hover {
        transform: scale(1.05);
        filter: brightness(2);
    }
    p {
        line-height: 20px;
    }
    p:first-child {
        padding-top: 5px;
    }
    p:last-child {
        padding-bottom: 5px;
    }
`

const ManageBoardItemComponent: React.FC<BoardItemProps> = (props) => {
    const { item } = props
    const dispatch = useAppDispatch()
    const { walletAddress } = useAuth()
    return (
        <StyledBlock
            className="font-primary text-left text-black font-bold"
            onClick={() => {
                dispatch(setSelectedCard(item.playerInfo.ownerAddress))
                dispatch(setViewState(ViewState.ROSTER))
            }}
            style={{
                background: item.playerInfo.playerId ? positionColor(item.playerInfo.playerId) : "#333",
                border:
                    item.playerInfo.ownerAddress === walletAddress
                        ? "3px solid " + COLORS.primary
                        : "3px solid" + positionColor(item.playerInfo.playerId),
            }}
        >
            <p className="text-[17px]">{item.playerInfo.playerId}</p>
            <p className="text-[12px]">
                R{item.playerInfo.round} P{item.playerInfo.pickNum}
            </p>
        </StyledBlock>
    )
}

export default ManageBoardItemComponent
