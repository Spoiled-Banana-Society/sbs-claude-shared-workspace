import { useAuth } from "@/hooks/useAuth"
import { COLORS, getTruncatedAccountName } from "@/utils/helpers"
import { SummaryProps } from "@/utils/types/types"
import React from "react"
import styled from "styled-components"

type BoardHeadingProps = {
    item: SummaryProps
}

const StyledHeading = styled.div`
    width: 100px;
    margin-top: 25px;
    padding: 5px;
    text-align: center;
    cursor: normal;
    box-sizing: content-box;
    p {
        padding: 0 5px;
        line-height: 20px;
    }
`

const ManageBoardItemComponent: React.FC<BoardHeadingProps> = (props) => {
    const { item } = props
    const { walletAddress } = useAuth()
    return (
        <StyledHeading className="font-primary text-left text-white font-bold">
            <p
                className="text-[12px]"
                style={{
                    color: walletAddress === item.playerInfo.ownerAddress ? COLORS.primary : COLORS.lightWhite,
                }}
            >
                {getTruncatedAccountName(item.pfpInfo.displayName, item.playerInfo.ownerAddress)}
            </p>
        </StyledHeading>
    )
}

export default ManageBoardItemComponent
