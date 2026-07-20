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
    case 'promo-card-free-draft': {
      const count = payload.awardedCount ?? 1;
      // Fronted = the first-card-purchase bonus draft. Explain the program:
      // this one came with the purchase, and every $25 in card fees earns
      // the next one automatically.
      if (payload.fronted) {
        return {
          type: 'promo',
          title: count === 1 ? 'Bonus Draft Pass — card fee covered' : `${count} Bonus Draft Passes — card fees covered`,
          message: count === 1
            ? 'We cover card fees: your purchase came with a free Draft Pass. Every $25 you rack up in card fees earns you another one, automatically.'
            : `We cover card fees: your purchase came with ${count} free Draft Passes. Every $25 you rack up in card fees earns you another one, automatically.`,
          link: '/drafting',
          icon: 'gift',
        };
      }
      return {
        type: 'promo',
        title: count === 1 ? 'Draft Pass earned' : `${count} Draft Passes earned`,
        message: count === 1
          ? 'Your card fees reached $25 — a free Draft Pass just landed. Every $25 in fees earns the next one.'
          : `Your card fees earned you ${count} Draft Passes — on us. Every $25 in fees earns the next one.`,
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
      return {
        type: 'promo',
        title: 'First Purchase Promo — Win up to 40 Free Drafts',
        message: 'Every Draft Pass = 2 Free Spins. Buy 1 → 2 Free Drafts guaranteed — win up to 40 Free Drafts ($1,000 in Drafts).',
        link: '/buy-drafts',
        dedupeKey: `first-purchase-unlocked-${userId}`,
        icon: 'gift',
      };
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
