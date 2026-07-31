/**
 * Server-side mapping from a real-time stream event → the persisted bell
 * notification it should create. Mirrors the copy the client used to render
 * in `hooks/useUserEventStream.ts` `renderEvent`, but with content-stable
 * dedupeKeys so the same logical event produces exactly one bell entry
 * (idempotent across retries / devices).
 *
 * Returns null for event types that carry no persistent bell entry (e.g. the
 * content-less `'notification'` refetch ping).
 *
 * Consumed by `pushStreamEvent` (lib/userEventStream.ts) via dynamic import
 * to avoid a circular dependency with `lib/queueNotifications.ts`.
 */

import { BADGE_BY_ID } from '@/lib/badges/catalog';
import {
  firstBuyPitchQuantity,
  firstPurchaseHeadline,
  firstPurchaseOfferLine,
  newPlayerFirstBuy,
  returningFirstBuy,
} from '@/lib/firstPurchaseCopy';
import { isSpinOnPurchaseEnabled } from '@/lib/featureFlags';
import type { StreamEventType, StreamEventPayload } from '@/lib/userEventStream';
import type { CreateNotificationInput } from '@/lib/queueNotifications';

export function eventNotificationContent(
  userId: string,
  type: StreamEventType,
  payload: StreamEventPayload,
): CreateNotificationInput | null {
  const draftId = payload.draftId ?? '';
  switch (type) {
    case 'badge-unlock': {
      const badge = payload.badgeId ? BADGE_BY_ID[payload.badgeId] : null;
      if (!badge) return null;
      return {
        type: 'promo',
        title: `Badge unlocked: ${badge.label}`,
        message: badge.description,
        link: '/profile?tab=badges',
        dedupeKey: `badge-${payload.badgeId}`,
        icon: 'award',
      };
    }
    case 'promo-new-user':
      // No bell — the single welcome bell is already created once on signup
      // (type 'welcome', dedupeKey 'welcome-new-user' in createUser). Firing
      // another here on X-verify would be a duplicate welcome (Boris 2026-06-14).
      return null;
    case 'promo-pick-10': {
      const pickSlot = payload.slot ?? 10;
      return {
        type: 'promo',
        title: `Pick ${pickSlot} → Free Spin`,
        message: `You drew slot ${pickSlot} in a draft. Your free spin is ready to claim.`,
        link: '/promos',
        dedupeKey: `promo-pick-10-${draftId}`,
        icon: 'target',
      };
    }
    case 'promo-pick-chase': {
      const spins = payload.spins ?? 1;
      const pickSlot = payload.slot ?? 0;
      return {
        type: 'promo',
        title: `You matched your pick! ${spins} Free Spin${spins === 1 ? '' : 's'}`,
        message: `You landed Pick ${pickSlot} again — ${spins} Free Spin${spins === 1 ? '' : 's'} ready to claim. Draft again to match your next pick.`,
        link: '/promos',
        dedupeKey: `promo-pick-chase-${draftId}`,
        icon: 'target',
      };
    }
    case 'promo-jackpot-hit': {
      const count = payload.awardedCount ?? 1;
      return {
        type: 'promo',
        title: 'Jackpot Hit!',
        message: count === 1
          ? 'You hit a Jackpot draft — claim your free spin.'
          : `You hit a Jackpot draft — claim your ${count} free spins.`,
        link: '/promos',
        dedupeKey: `promo-jackpot-${draftId}`,
        icon: 'sparkles',
      };
    }
    case 'promo-buy-10': {
      const count = payload.awardedCount ?? 1;
      return {
        type: 'promo',
        title: 'Free spin earned!',
        message: count === 1
          ? 'You completed Buy 10 — claim your free spin.'
          : `You completed Buy 10 — claim your ${count} free spins.`,
        link: '/promos',
        icon: 'bag',
        // No stable id in payload — server fires once per buy; auto-id.
      };
    }
    case 'deposit-received': {
      // The ONE deposit-moment bell (Boris 2026-07-24): confirms the money is
      // in, folds in whatever this deposit came with (free-pass front / fee
      // milestone / pending first-purchase spins) so deposit day is a single
      // ping — creditCardDeposit suppresses the separate free-pass bell when
      // it fires this. Copy scales with amount; spins line only when a NEW
      // player has budgeted spins waiting (see computeDepositBudgetGrant).
      const amount = payload.amountUsd ?? 0;
      const spins = payload.spins ?? 0;
      const freePasses = payload.freePasses ?? 0;
      const title = `Thanks for depositing $${amount} — it's in your account`;
      // Aim the spins line at the BALANCE — a first depositor also holds the
      // fronted FREE pass, and entering with that pass earns no spins (spins
      // fire when balance is SPENT). "Using your $X balance" points them at
      // the action that actually pays (Boris 2026-07-24).
      // "+ a Bonus Spin with every purchase" — Spin-on-Purchase stacks ON TOP of
      // the promo spins, and the deposit bell is where a first buyer learns
      // their total value (Boris 2026-07-28). One clause, not a lecture.
      const spinsLine = spins > 0
        ? (spins <= 2
          ? ` Enter a draft using your $${amount} balance to receive your ${spins} Free Spins — plus a Bonus Spin with every purchase.`
          : ` Enter drafts using your $${amount} balance to receive your ${spins} Free Spins — plus a Bonus Spin with every purchase.`)
        : '';
      let lead: string;
      if (freePasses > 0 && payload.fronted) {
        lead = 'You also got a FREE Paid Draft Pass — we cover your first card fee, and every $25 in card fees earns another, automatically.';
      } else if (freePasses > 0) {
        lead = freePasses === 1
          ? 'Your card fees just earned you another FREE Paid Draft Pass.'
          : `Your card fees just earned you ${freePasses} more FREE Paid Draft Passes.`;
      } else {
        lead = spins > 0 ? '' : 'Jump into a draft — your balance covers entries in one tap.';
      }
      return {
        type: 'promo',
        title,
        message: `${lead}${spinsLine}`.trim(),
        link: '/drafting',
        dedupeKey: `deposit-${payload.txHash || `${userId}-${amount}`}`,
        // Money-in moment: 'bag' (distinct from 'ticket' purchases and 'gift'
        // free-draft awards).
        icon: 'bag',
      };
    }
    case 'promo-card-free-draft': {
      const count = payload.awardedCount ?? 1;
      // Fronted = the first-card-purchase bonus draft. Explain the program:
      // this one came with the purchase, and every $25 in card fees earns
      // the next one automatically.
      if (payload.fronted) {
        return {
          type: 'promo',
          title: count === 1 ? 'Free Paid Draft Pass — card fee covered' : `${count} free Paid Draft Passes — card fees covered`,
          message: count === 1
            ? 'We cover card fees: your purchase came with a free Paid Draft Pass. Every $25 you rack up in card fees earns you another one, automatically.'
            : `We cover card fees: your purchase came with ${count} free Paid Draft Passes. Every $25 you rack up in card fees earns you another one, automatically.`,
          link: '/drafting',
          icon: 'gift',
        };
      }
      return {
        type: 'promo',
        title: count === 1 ? 'Paid Draft Pass earned' : `${count} Paid Draft Passes earned`,
        message: count === 1
          ? 'Your card fees reached $25 — a free Paid Draft Pass just landed. Every $25 in fees earns the next one.'
          : `Your card fees earned you ${count} Paid Draft Passes — on us. Every $25 in fees earns the next one.`,
        link: '/drafting',
        // 'gift' = a FREE draft (earned/won), distinct from a PURCHASED pass
        // ('ticket'). Matches the wheel-win free-draft bell (Boris 2026-06-20).
        icon: 'gift',
      };
    }
    case 'promo-daily-drafts':
      return {
        type: 'promo',
        title: '4 Drafts in 24 Hours complete!',
        message: 'You finished 4 paid drafts in time — claim your free spin.',
        link: '/promos',
        dedupeKey: `promo-daily-${draftId}`,
        icon: 'calendar',
      };
    case 'promo-first-purchase': {
      const count = payload.awardedCount ?? 1;
      return {
        type: 'promo',
        title: 'Your Free Spins are here!',
        message: count === 1
          ? 'Your first purchase earned a Free Spin — claim it now.'
          : `Your first purchase earned ${count} Free Spins — claim them now.`,
        link: '/promos',
        dedupeKey: `promo-first-purchase-${userId}`,
        icon: 'star',
      };
    }
    case 'first-purchase-unlocked':
      // Fires the moment their LAST welcome-wheel free draft finishes — so the
      // bell opens on the draft they just played, then pitches the offer.
      // Variant-correct math: returning players (payload.isReturning, stamped
      // by the unlock gate) get the classic buy-2-get-1 rate, everyone else
      // the new-player buy-1-get-2. Bonus Spins are deliberately NOT mentioned
      // here (flag-gated feature; surfaces that are gated on it pitch it).
      // Bell now carries the SAME sentence as the promo modal (Boris review
      // 2026-07-30) — headline, guarantee, ceiling and spin count all from the
      // shared helpers, so the bell can never drift from the card. Server
      // passes both halves of the flag: copy must never count Bonus Spins the
      // server isn't actually granting.
      {
        const variant = payload.isReturning ? 'returning' : 'new';
        const bonusOn = isSpinOnPurchaseEnabled();
        const qty = firstBuyPitchQuantity(variant);
        const o = payload.isReturning ? returningFirstBuy(qty, bonusOn) : newPlayerFirstBuy(qty, bonusOn);
        const passWord = qty === 1 ? 'Draft Pass' : `${qty} Draft Passes`;
        return {
          type: 'promo',
          title: firstPurchaseHeadline(variant, bonusOn),
          message:
            `Buy your first ${passWord} → ${firstPurchaseOfferLine(o)}. `
            + `You get ${o.spins} Banana Wheel Spin${o.spins === 1 ? '' : 's'} — spin to collect. `
            + 'One-time offer, first purchase only.',
          link: '/buy-drafts',
          dedupeKey: `first-purchase-unlocked-${userId}`,
          icon: 'gift',
        };
      }
    case 'referral-milestone': {
      // This generic event is ONLY emitted for the 'verified' milestone, and
      // verifying pays the REFERRER nothing — it's informational progress. The
      // referrer's Free Spin comes ONLY when their friend buys a Draft Pass
      // (those fire a separate, named bell via notifyReferrerOfMilestones). So
      // DON'T tell them to "claim your free spin" here.
      if (payload.milestone === 'verified') {
        return {
          type: 'promo',
          title: 'Your referral is in!',
          message: "A friend you referred verified their X and took their spin. You'll earn a Free Spin when they buy a Draft Pass.",
          link: '/promos?promo=3',
          dedupeKey: `referral-verified-${userId}`,
          icon: 'users',
        };
      }
      // Defensive fallback (mints normally use the named bell, not this event).
      return {
        type: 'promo',
        title: 'Referral Free Spin!',
        message: 'A friend you referred bought a Draft Pass — claim your Free Spin.',
        link: '/promos?promo=3',
        dedupeKey: `referral-${payload.milestone ?? 'x'}-${userId}`,
        icon: 'users',
      };
    }
    case 'notification':
    default:
      return null;
  }
}
