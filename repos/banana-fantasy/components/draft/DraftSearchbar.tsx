import React from "react"
import { positionColor } from "@/utils/helpers"
import { SortState } from "@/utils/types/types"
import { styled } from "styled-components"
import { IoIosCloseCircle } from "react-icons/io"

type DraftSearchbarProps = {
    searchChangeHandler: (payload: string) => void
    setSelectedPositions: React.Dispatch<React.SetStateAction<string[]>>
    expandInput: boolean
    setExpandInput: React.Dispatch<React.SetStateAction<boolean>>
    selectedPositions: string[]
    setInputString: React.Dispatch<React.SetStateAction<string>>
    inputString: string
    sortState: SortState
}

const StyledWrapper = styled.div`
    max-width: 920px;
    padding: 0px 10px;
    margin: 20px auto 0px auto;
    .search-container {
        display: flex;
        padding: 10px 0px;
        text-align: center;
        justify-content: center;
        align-items: center;
        gap: 10px;
    }
    .input input {
        background: #424242;
        border-radius: 5px;
        flex: 1;
        font-size: 18px;
        color: #fff;
        padding: 0px 3px;
    }
    .search {
        flex: 1;
        display: flex;
        background: #000;
        border: 1px solid #555;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 32px;
        border-radius: 5px;
    }
    .text {
        color: #fff;
        text-align: center;
    }
    .all {
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        height: 32px;
        border-radius: 5px;
        background: #555;
    }
    .text-bold {
        font-weight: bold;
        color: #fff;
        font-size: 12px;
        text-align: center;
    }
`

const StyledButton = styled.button`
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 44px;
    min-height: 44px;
    border-radius: 5px;
    transition: all 0.15s ease-in-out;
    border-width: 1px;

    @media (min-width: 640px) {
        height: 32px;
        min-height: 32px;
    }
`

const DraftSearchbar: React.FC<DraftSearchbarProps> = (props) => {
    const {
        searchChangeHandler,
        setSelectedPositions,
        expandInput,
        setExpandInput,
        selectedPositions,
        setInputString,
        inputString,
        sortState,
    } = props

    const onQueryType = (e: string) => {
        setInputString(e.toUpperCase())
    }

    return (
        <StyledWrapper>
            <div className="search-container">
                {expandInput ? (
                    <>
                        <div className="input">
                            <input
                                onChange={(e) => onQueryType(e.target.value)}
                                value={inputString.toUpperCase()}
                                autoComplete="off"
                                placeholder="Example: PHI-QB"
                                className="font-primary font-bold"
                            />
                        </div>
                        <button onClick={() => setExpandInput(false)}>
                            <IoIosCloseCircle />
                        </button>
                    </>
                ) : (
                    <>
                        <button className="search" onClick={() => setExpandInput(true)}>
                            <p className="text text-[9px]">SEARCH</p>
                        </button>
                        <button className="all" onClick={() => setSelectedPositions([])}>
                            <p className="text-bold">ALL</p>
                        </button>
                        <StyledButton
                            style={{
                                borderColor: positionColor("-QB"),
                                backgroundColor: selectedPositions.includes("-QB") ? positionColor("-QB") : "#000",
                            }}
                            onClick={() => searchChangeHandler("-QB")}
                            disabled={selectedPositions.length >= 5 && !selectedPositions.includes("-QB")}
                        >
                            <p className="text-bold">QB</p>
                        </StyledButton>
                        <StyledButton
                            style={{
                                borderColor: positionColor("-RB"),
                                backgroundColor: selectedPositions.includes("-RB") ? positionColor("-RB") : "#000",
                            }}
                            onClick={() => searchChangeHandler("-RB")}
                            disabled={selectedPositions.length >= 5 && !selectedPositions.includes("-RB")}
                        >
                            <p className="text-bold">RB</p>
                        </StyledButton>
                        <StyledButton
                            style={{
                                borderColor: positionColor("-WR"),
                                backgroundColor: selectedPositions.includes("-WR") ? positionColor("-WR") : "#000",
                            }}
                            onClick={() => searchChangeHandler("-WR")}
                            disabled={selectedPositions.length >= 5 && !selectedPositions.includes("-WR")}
                        >
                            <p className="text-bold">WR</p>
                        </StyledButton>
                        <StyledButton
                            style={{
                                borderColor: positionColor("-TE"),
                                backgroundColor: selectedPositions.includes("-TE") ? positionColor("-TE") : "#000",
                            }}
                            onClick={() => searchChangeHandler("-TE")}
                            disabled={selectedPositions.length >= 5 && !selectedPositions.includes("-TE")}
                        >
                            <p className="text-bold">TE</p>
                        </StyledButton>
                        <StyledButton
                            style={{
                                borderColor: positionColor("-DST"),
                                backgroundColor: selectedPositions.includes("-DST") ? positionColor("-DST") : "#000",
                            }}
                            onClick={() => searchChangeHandler("-DST")}
                            disabled={selectedPositions.length >= 5 && !selectedPositions.includes("-DST")}
                        >
                            <p className="text-bold">DST</p>
                        </StyledButton>
                    </>
                )}
            </div>
            <div className="border-b-0 border-gray-700 px-1 lg:px-3 pb-1 pt-4 flex flex-row justify-end items-center">
                {/* <div>
                    <p className="text-white font-bold">SORT BY:</p>
                </div> */}
                <div className="flex flex-row">
                    <button className="flex flex-row pr-3" onClick={() => searchChangeHandler("ADP")}>
                        <p
                            className={
                                sortState === SortState.ADP
                                    ? "text-yellow-300 pl-2 font-bold"
                                    : "text-gray-500 pl-2 font-bold"
                            }
                        >
                            ADP
                        </p>
                    </button>
                    <button className="flex flex-row lg:pr-1" onClick={() => searchChangeHandler("RANK")}>
                        <p
                            className={
                                sortState === SortState.RANK
                                    ? "text-yellow-300 pl-2 font-bold"
                                    : "text-gray-500 pl-2 font-bold"
                            }
                        >
                            RANK
                        </p>
                    </button>
                </div>
            </div>
        </StyledWrapper>
    )
}

export default DraftSearchbar
