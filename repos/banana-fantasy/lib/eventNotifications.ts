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
      return {
        type: 'promo',
        title: count === 1 ? 'Free draft earned!' : `${count} free drafts earned!`,
        message: count === 1
          ? 'Your card fees added up to $25 — a free draft is on us. Tap to play.'
          : `Your card fees earned you ${count} free drafts — on us. Tap to play.`,
        link: '/drafting',
        icon: 'ticket',
      };
    }
    case 'promo-daily-drafts':
      return {
        type: 'promo',
        title: 'Daily promo complete!',
        message: 'You finished 4 drafts today — claim your free spin.',
        link: '/promos',
        dedupeKey: `promo-daily-${draftId}`,
        icon: 'calendar',
      };
    case 'promo-first-purchase': {
      const count = payload.awardedCount ?? 1;
      return {
        type: 'promo',
        title: 'First purchase bonus!',
        message: count === 1
          ? 'Your first purchase earned a free spin — claim it now.'
          : `Your first purchase earned ${count} free spins — claim them now.`,
        link: '/promos',
        dedupeKey: `promo-first-purchase-${userId}`,
        icon: 'star',
      };
    }
    case 'first-purchase-unlocked':
      return {
        type: 'promo',
        title: 'First Purchase Bonus 🍌',
        message: 'Every 4 passes on your first buy = 1 free spin. Buy them in one transaction to stack the most spins.',
        link: '/buy-drafts',
        dedupeKey: `first-purchase-unlocked-${userId}`,
        icon: 'gift',
      };
    case 'referral-milestone': {
      const m =
        payload.milestone === 'verified' ? 'verified their X account' :
        payload.milestone === 'bought1' ? 'bought their first draft' :
        payload.milestone === 'bought10' ? 'bought 10 drafts' :
        'hit a milestone';
      return {
        type: 'promo',
        title: 'Referral free spin!',
        message: `A friend you referred ${m}. Claim your free spin.`,
        link: '/promos',
        dedupeKey: `referral-${payload.milestone ?? 'x'}-${userId}`,
        icon: 'users',
      };
    }
    case 'notification':
    default:
      return null;
  }
}
