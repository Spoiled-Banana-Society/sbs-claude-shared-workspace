import { useEffect, useState } from "react";
import { useAppSelector, useAppDispatch } from "@/redux/hooks/reduxHooks";
import { Draft } from "@/utils/api";
import { setDraftInfo } from "@/redux/draftSlice";

const useTimer = (leagueId: string | null) => {
    const endOfTurnTimestamp = useAppSelector(state => state.league.endOfTurnTimestamp);
    const draftInfo = useAppSelector(state => state.draft.draftInfo);
    const draftStartTime = draftInfo?.draftStartTime;
    const currentPickEndTime = draftInfo?.currentPickEndTime;
    const [timeRemaining, setTimeRemaining] = useState(0);
    const [prevTimeRemaining, setPrevTimeRemaining] = useState<number | null>(null); // To track the previous state
    const dispatch = useAppDispatch();

    useEffect(() => {
        if (leagueId) {
            Draft.getDraftInfo(leagueId).then((res) => {
                dispatch(setDraftInfo(res.data));
            });
        }
    }, [leagueId]);

    useEffect(() => {
        const updateTimer = () => {
            const now = Date.now();

            // Check if the draft has started
            if (draftStartTime && now < draftStartTime * 1000) {
                // Countdown to draft start
                const remaining = draftStartTime * 1000 - now;
                setTimeRemaining(Math.max(0, Math.ceil(remaining / 1000))); // Convert milliseconds to seconds
            } else if (endOfTurnTimestamp) {
                // Countdown for turn timer
                const timestampMs = endOfTurnTimestamp * 1000; // Convert to milliseconds
                const remaining = timestampMs - now;
                setTimeRemaining(Math.max(0, Math.ceil(remaining / 1000))); // Convert milliseconds to seconds
            } else if (currentPickEndTime) {
                // Countdown for current pick
                const timestampMs = currentPickEndTime * 1000; // Convert to milliseconds
                const remaining = timestampMs - now;
                setTimeRemaining(Math.max(0, Math.ceil(remaining / 1000))); // Convert milliseconds to seconds
            } else {
                // Set default preTime if no timestamps are available
                setTimeRemaining(30);
            }
        };

        const timer: NodeJS.Timeout = setInterval(updateTimer, 1000);
        updateTimer(); // Initial call to set the timer immediately

        return () => clearInterval(timer); // Cleanup the interval on component unmount
    }, [endOfTurnTimestamp, draftStartTime, currentPickEndTime]);

    useEffect(() => {
        // Update the previous time remaining state
        setPrevTimeRemaining(timeRemaining);
    }, [timeRemaining]);

    return { timeRemaining, prevTimeRemaining, formatTime };
};

const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = time % 60;
    return `${minutes < 10 ? `0${minutes}` : minutes}:${seconds < 10 ? `0${seconds}` : seconds}`;
};

export default useTimer;
