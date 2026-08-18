// Promo visual system — ONE hue pair per promo type, shared by every surface
// (/promos spotlight + long cards, home carousel, draft-room sidebar, and the
// promo modal header). Colors ride as CSS vars (--pa / --pb) that the
// `.promo-grad` recipe in globals.css turns into the dark drifting gradient.
//
// Boris 2026-08-18: dark cards, deep hues under a scrim (white text must stay
// readable on every card), one indicator per promo that matches its mechanic
// (packs / pick tile / 4 pips / 10 slots / friends / cycle) — never a generic bar.

import type { CSSProperties } from 'react';
import type { Promo, PromoType } from '@/types';

export interface PromoHue {
  /** Bright end of the gradient — also the accent used for kicker text. */
  a: string;
  /** Deep end of the gradient. */
  b: string;
}

export const PROMO_HUES: Record<PromoType, PromoHue> = {
  'around-the-banana': { a: '#e0284a', b: '#4a0818' }, // jackpot red — the prize is a Jackpot seat
  'drop':              { a: '#e5731f', b: '#4d1c06' },
  'daily-drafts':      { a: '#c98f00', b: '#4a3300' },
  'pick-chase':        { a: '#0aa3c7', b: '#04304d' },
  'referral':          { a: '#1f9d55', b: '#08361d' },
  'pick-10':           { a: '#8b63e6', b: '#28104f' },
  'jackpot':           { a: '#d63fb0', b: '#460b36' },
  'first-purchase':    { a: '#5b66e0', b: '#1a1e52' },
  'new-user':          { a: '#23b39c', b: '#083a33' },
  'mint':              { a: '#a855f7', b: '#2e0f4f' },
  'buy-bonus':         { a: '#22c55e', b: '#0b3a1c' },
  'founder-draft':     { a: '#06b6d4', b: '#063a45' },
  'hof':               { a: '#d4af37', b: '#4a3a05' },
  'tweet-engagement':  { a: '#0ea5e9', b: '#052c44' },
  'spin-share':        { a: '#8b5cf6', b: '#2a1160' },
  'banana-draw':       { a: '#ef6c37', b: '#4a1a06' },
  'eliminator':        { a: '#ef6c37', b: '#4a1a06' },
  'banana-vault':      { a: '#fbbf24', b: '#4a3300' },
};

/** Inline style carrying the hue pair for `.promo-grad` (+ optional sweep delay). */
export function promoHueStyle(type: PromoType, sweepDelayS = 0): CSSProperties {
  const h = PROMO_HUES[type] ?? PROMO_HUES.jackpot;
  return { '--pa': h.a, '--pb': h.b, '--pd': `${sweepDelayS}s` } as CSSProperties;
}

export function promoAccent(type: PromoType): string {
  return (PROMO_HUES[type] ?? PROMO_HUES.jackpot).a;
}

/**
 * The short reward line above the title ("JACKPOT SEAT · LIVE"). Written per
 * type so it says what you actually get, not the category name.
 */
export function promoKicker(promo: Promo): string {
  switch (promo.type) {
    case 'around-the-banana': return 'JACKPOT SEAT · LIVE RACE';
    case 'drop': return 'JACKHOF SEAT · 9 PM PT';
    case 'daily-drafts': return 'FREE SPIN · EVERY 4';
    case 'pick-chase': return 'UP TO 5 SPINS';
    case 'referral': return 'FREE SPINS · WHEN FRIENDS BUY';
    case 'pick-10': return 'FREE SPIN · PASSIVE';
    case 'jackpot': return 'FREE SPINS · PASSIVE';
    case 'first-purchase': return 'FIRST BUY';
    case 'new-user': return 'WELCOME · FREE';
    case 'mint': return 'BUY 10 · FREE SPIN';
    case 'buy-bonus': return 'KICKOFF · FREE SPIN';
    case 'founder-draft': return 'FOUNDER DRAFT · FREE SPIN';
    case 'hof': return 'HOF';
    case 'tweet-engagement': return 'X · FREE SPIN';
    case 'spin-share': return 'SHARE · FREE SPIN';
    case 'banana-draw': return 'JACKHOF SEAT';
    case 'eliminator': return 'JACKHOF SEAT';
    case 'banana-vault': return 'JACKPOT SEAT';
    default: return 'PROMO';
  }
}

/** Card title — the promo title with the "→ REWARD" tail dropped (the kicker carries it). */
export function promoName(promo: Promo): string {
  const t = promo.title || '';
  const head = t.includes('→') ? t.split('→')[0] : t;
  return head.trim();
}

/**
 * The rules list for the inline "How it works" — the modal explanation split
 * on its bullet lines. Server copy is the source; this only splits it.
 */
export function promoRules(promo: Promo): string[] {
  const raw = promo.modalContent?.explanation || '';
  const lines = raw
    .split(/\n+/)
    .map((l) => l.replace(/^\s*[•\-–]\s*/, '').trim())
    .filter(Boolean);
  // Drop the section headings ("HOW TO EARN BANANAS — 4 WAYS") that some
  // explanations carry — the card list reads better as plain rules.
  return lines.filter((l) => !(l === l.toUpperCase() && l.length > 8 && !/\d/.test(l)));
}

/** Where the primary action goes for promos that have one. */
export function promoCta(promo: Promo, opts: { canOpenPacks?: boolean } = {}): { label: string; href: string } | null {
  switch (promo.type) {
    case 'around-the-banana': return { label: 'Enter a draft', href: '/draft' };
    case 'drop': return opts.canOpenPacks ? { label: 'Open packs', href: '/drop' } : { label: 'Draft', href: '/draft' };
    case 'daily-drafts': return { label: 'Draft', href: '/draft' };
    case 'pick-chase': return { label: 'Draft', href: '/draft' };
    case 'first-purchase': return { label: 'Buy a pass', href: '/buy-drafts' };
    case 'mint': return { label: 'Buy passes', href: '/buy-drafts' };
    case 'buy-bonus': return { label: 'Buy passes', href: '/buy-drafts' };
    case 'founder-draft': return { label: 'View drafts', href: '/draft' };
    case 'eliminator': return { label: 'Draft', href: '/draft' };
    case 'banana-draw': return { label: 'Draft', href: '/draft' };
    default: return null;
  }
}
