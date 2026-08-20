/**
 * Is this draft a SPECIAL wheel/promo-seat draft (Jackpot #N / HOF #N /
 * JackHOF #N lobbies filled by wheel-won or promo-granted seats)?
 *
 * Special drafts are themselves prizes — they must NEVER advance other
 * promos (Around The Banana, Pick 10, Match Your Pick, Banana Vault, the
 * 4-in-24 counter, jackpot draws). Before this gate (Boris 2026-08-19) a
 * wheel-won slow draft closing credited ATB slots etc. like a regular BBB
 * draft.
 *
 * Detection: regular drafts are named "BBB #N"; special lobbies are named
 * "Jackpot #N (from Wheel)", "HOF #N (from Wheel)", "JackHOF #N (from
 * Promo)" etc. The name is stamped by the Go engine at creation and is the
 * same field every crediting path already reads.
 */
export function isSpecialSeatDraft(displayName: string | null | undefined): boolean {
  const n = String(displayName ?? '').trim();
  if (!n) return false;
  if (/^BBB\s*#/i.test(n)) return false;
  return /(from wheel|from promo)|^(jackpot|hof|jackhof)\s*#/i.test(n);
}
