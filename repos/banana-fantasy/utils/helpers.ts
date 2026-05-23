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

// Deterministic FNV-1a 32-bit hash of the wallet hex, mapped into a
// 7-digit space [1_000_000, 9_999_999]. ~9M handles. Stable per user,
// no server coordination needed. Birthday-paradox collision odds:
// ~5% at ~1.5k users; revisit / move to server-assigned if we grow past.
// Boris's prior 4-hex `Banana #93e2` was 65k space — this is 138x wider.
export const bananaNumberFromWallet = (walletAddress: string): number => {
    const hex = (walletAddress || "").replace(/^0x/i, "").toLowerCase()
    let h = 0x811c9dc5
    for (let i = 0; i < hex.length; i++) {
        h ^= hex.charCodeAt(i)
        h = Math.imul(h, 0x01000193)
    }
    return ((h >>> 0) % 9_000_000) + 1_000_000
}

// On-brand default handle for users who haven't set a name. Stable per
// wallet (deterministic from the address) so the same user always sees
// the same number across devices and sessions.
export const bananaDefaultName = (walletAddress: string): string => {
    if (!walletAddress) return "Banana"
    return `Banana #${bananaNumberFromWallet(walletAddress)}`
}

// Returns the user's display name if it's a real, user-chosen one;
// otherwise an on-brand "Banana #1234567" default derived from the
// wallet. Never surfaces a leftover "TestName" placeholder or a raw
// wallet address.
export const getTruncatedAccountName = (displayName: string, walletAddress: string) => {
    const name = (displayName || "").trim()
    const isPlaceholder =
        name === "" || isWalletAddress(name) || PLACEHOLDER_NAMES.has(name.toLowerCase())

    return isPlaceholder ? bananaDefaultName(walletAddress) : truncateDisplayName(name)
}
