
import ReactLoading from "react-loading"
import { AnimatePresence } from "framer-motion"
import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAppSelector } from "@/redux/hooks/reduxHooks"

const CompletedComponent = () => {
    const router = useRouter()
    const leagueId = useAppSelector ((state) => state.league.leagueId)
    const leagueStatus = useAppSelector((state) => state.league.leagueStatus)

    useEffect(() => {
        if(leagueStatus === 'completed'){
            setTimeout(() => {
                router.push(`/authenticated/manage/${leagueId}`)
            }, 10000)
        }
    }, [leagueStatus])

    return (
        <div className="mt-[340px] text-center">
            <h1 className="text-center font-primary font-bold italic uppercase text-lg mt-5">Draft is complete</h1>
            <p className="px-3 text-center">Please wait while we are generating your card...</p>
            <AnimatePresence>
                <div className="mx-auto text-center flex items-center justify-center">
                    <div>
                        <ReactLoading
                            type={"bubbles"}
                            color={"#fff"}
                            height={100}
                            width={100}
                            className="mx-auto"
                        />
                    </div>
                </div>
            </AnimatePresence>
        </div>
    )
}

export default CompletedComponent
