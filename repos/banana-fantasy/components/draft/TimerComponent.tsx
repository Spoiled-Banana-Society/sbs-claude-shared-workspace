import { useAppSelector } from "@/redux/hooks/reduxHooks";
import styled from "styled-components";
import { useEffect, useState } from "react";

const StyledTimer = styled.div<{ time: number, leagueLevel: string }>`
    color: ${props => props.time > 10 ? "white" : (
        props.leagueLevel === 'Jackpot' ? "yellow" : "red"
    )};
    font-weight: bold;
    font-size: 18px;
    margin: 5px auto 0px auto;
    text-align: center;
`;

const TimerComponent = () => {
    const endOfTurnTimestamp = useAppSelector(state => state.league.endOfTurnTimestamp);
    const [timeRemaining, setTimeRemaining] = useState(30); // Start with default 30 seconds
    const preTime = useAppSelector(state => state.league.preTimeRemaining);
    const leagueLevel = useAppSelector((state) => state.league.leagueLevel)
    const draftInfo = useAppSelector(state => state.draft.draftInfo);
    const draftStartTime = draftInfo?.draftStartTime;

    useEffect(() => {
        const updateTimer = () => {
            const now = Date.now();

            // Check if the draft has started
            if (draftStartTime && now < draftStartTime * 1000) {
                // Countdown to draft start
                const remaining = draftStartTime * 1000 - now;
                setTimeRemaining(Math.max(0, Math.floor(remaining / 1000))); // Convert milliseconds to seconds
            } else if (endOfTurnTimestamp) {
                // Countdown for turn timer
                const timestampMs = endOfTurnTimestamp * 1000; // Convert to milliseconds
                const remaining = timestampMs - now;
                setTimeRemaining(Math.max(0, Math.floor(remaining / 1000))); // Convert milliseconds to seconds
            } else {
                // Set default preTime if no timestamps are available
                setTimeRemaining(preTime || 30);
            }
        };

        const timer = setInterval(updateTimer, 1000);
        updateTimer(); // Initial call to set the timer immediately

        return () => clearInterval(timer); // Cleanup the interval on component unmount
    }, [endOfTurnTimestamp, preTime, draftStartTime]);

    // Function to format time remaining in MM:SS format
    const formatTime = (time: number) => {
        const minutes = Math.floor(time / 60);
        const seconds = time % 60;
        return `${minutes < 10 ? `0${minutes}` : minutes}:${seconds < 10 ? `0${seconds}` : seconds}`;
    };

    return (
        <div data-tutorial="timer">
            <StyledTimer time={timeRemaining} leagueLevel={leagueLevel}>
                {formatTime(timeRemaining)}
            </StyledTimer>
        </div>
    );
};

export default TimerComponent;
