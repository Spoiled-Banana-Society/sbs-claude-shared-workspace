export const COLORS = {
    primary: "#F3E216",
    secondary: "#444262",
    tertiary: "#FF7754",
    black: "#000000",
    offBlack: "#222",
    grey: "#83829A",
    darkGrey: "#222222",
    white: "#F3F4F8",
    lightWhite: "#FAFAFC",
    qb: "#FF474C",
    rb: "#3c9120",
    wr: "#cb6ce6",
    te: "#326cf8",
    dst: "#DF893E",
}

export function classNames(...classes: string[]) {
    return classes.filter(Boolean).join(" ")
}

export const truncate = (string: string, limiter = 11) => {
    if (!string) return
    if (string.length >= limiter) {
        const truncatedString = string.slice(0, 5) + "." + string.slice(-4)
        return truncatedString
    }
    return string
}

export const truncateDisplayName = (string: string, limiter = 15) => {
    if (!string) return
    if (string.length >= limiter) {
        const truncatedString = string.slice(0, 15) + "..."
        return truncatedString
    }
    return string
}

export const positionColor = (position: string) => {
    const withoutHyphenation = position.substring(position.indexOf("-") + 1)
    switch (withoutHyphenation) {
        case "QB":
            return COLORS.qb
        case "RB1":
        case "RB2":
        case "RB":
            return COLORS.rb
        case "WR1":
        case "WR2":
        case "WR":
            return COLORS.wr
        case "TE":
            return COLORS.te
        case "DST":
            return COLORS.dst
    }
}

export const isWalletAddress = (address: string) => {
    return new RegExp("^(0x)?[0-9a-fA-F]{40}$").test(address)
}

// Display names that aren't real, user-chosen names — leftover test
// placeholders. Kept in sync with isPlaceholderName in lib/api/owner.ts.
const PLACEHOLDER_NAMES = new Set(["testname", "testuser", "test"])

// On-brand fallback name, tagged with the wallet's first four hex chars so
// it visibly matches the user's `0x93e2…` address. Matches
// friendlyDefaultName in lib/api/owner.ts.
const bananaDefaultName = (walletAddress: string): string => {
    const hex = (walletAddress || "").replace(/^0x/i, "")
    return `Banana #${(hex.slice(0, 4) || "0000").toLowerCase()}`
}

// Returns the user's display name if it's a real, user-chosen one;
// otherwise an on-brand "Banana #abcd" default. Never surfaces a raw
// wallet address or a leftover "TestName" placeholder.
export const getTruncatedAccountName = (displayName: string, walletAddress: string) => {
    const name = (displayName || "").trim()
    const isPlaceholder =
        name === "" || isWalletAddress(name) || PLACEHOLDER_NAMES.has(name.toLowerCase())

    return isPlaceholder ? bananaDefaultName(walletAddress) : truncateDisplayName(name)
}
