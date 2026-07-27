'use client';

import React, { useCallback, useMemo } from 'react';
import { Tooltip } from '@/components/ui/Tooltip';
import { BadgeIcon } from './BadgeIcon';
import { ShareCard } from '@/components/share/ShareCard';
import { buildBadgeCardUrl, buildBadgeSharePageUrl } from '@/lib/nftCard';
import { BADGE_BY_ID } from '@/lib/badges/catalog';
import { useBadges } from '@/hooks/useBadges';
import { useToast } from '@/components/ui/Toast';
import { ripenessFromCount, RIPENESS_TIERS } from '@/lib/badges/ripeness';
import type { Badge, BadgeCategory } from '@/types';

// Sections in display order, each with plain-English copy.
const SECTIONS: Array<{ key: BadgeCategory; title: string; blurb: string }> = [
  { key: 'ripeness', title: 'Your Banana', blurb: 'Your banana ripens as you do more paid BBB4 drafts — tiers unlock at 1 / 10 / 20 / 50 / 100 / 200. Equip whichever unlocked banana you want to show off.' },
  { key: 'championship', title: 'Championships', blurb: 'Win a season — a BBB final or the HOF bracket.' },
  { key: 'club', title: 'Clubs', blurb: 'Earned the moment you enter a Jackpot or HOF draft.' },
  { key: 'status', title: 'Status', blurb: 'Special standing across SBS — top drafter, founders, and OGs.' },
  { key: 'team', title: 'Team Flair', blurb: 'Cosmetic — rep your NFL team. Always available.' },
];

interface BadgeCatalogGridProps {
  /** When set, viewing another user's catalog read-only — equip controls hidden. */
  readOnlyForUserId?: string;
}

/**
 * The profile badge area. Organized into Your Banana → Championships →
 * Clubs → Status → Team Flair, each with a one-line explainer. Unlocked
 * badges are colored + click-to-equip; locked ones are dimmed with the
 * unlock criteria on hover. The banana tiers work the same way — locked
 * until you've bought enough paid drafts, then equippable like any badge.
 */
export function BadgeCatalogGrid({ readOnlyForUserId }: BadgeCatalogGridProps) {
  const { catalog, unlockedIds, equipped, ripeness, equipBadge, isLoading } = useBadges(
    readOnlyForUserId ? { userId: readOnlyForUserId } : undefined,
  );
  const { show } = useToast();

  const handleEquip = useCallback(async (badgeId: string | null) => {
    const res = await equipBadge(badgeId);
    if (!res.ok) {
      show({ level: 'error', message: `Couldn't equip badge: ${res.reason || 'unknown error'}` });
    }
  }, [equipBadge, show]);

  const grouped = useMemo(() => {
    const out: Record<string, Badge[]> = {
      ripeness: [], championship: [], club: [], status: [], team: [],
    };
    for (const b of catalog) {
      // Hidden badges (champion trophies, OG) are winner-only/era-only — they
      // never show as locked teasers, only in the catalogs of holders.
      if (b.hidden && !unlockedIds.has(b.id)) continue;
      if (out[b.category]) out[b.category].push(b);
    }
    return out;
  }, [catalog, unlockedIds]);

  const tier = ripeness ?? ripenessFromCount(0);
  const paidDone = tier.count ?? 0;
  // The id of the banana the user is currently showing by default (their
  // highest unlocked tier) — highlighted so they can see "this is my banana".
  // The default banana is EARNED (≥1 paid draft); 0 paid drafts = no default.
  const defaultBananaId = paidDone >= 1 ? `ripeness-${tier.label.toLowerCase()}` : null;
  // Live progress toward the NEXT banana tier ("3 more paid drafts to Fresh").
  const nextTier = RIPENESS_TIERS.find(t => paidDone < t.min) ?? null;

  if (isLoading && catalog.length === 0) {
    return <div className="text-sm text-text-secondary">Loading badges…</div>;
  }

  // The badge they're actually wearing — equipped, else their default banana.
  // Only ever a badge they've unlocked, so a shared card can't show a locked one.
  const shareBadgeId = (equipped && unlockedIds.has(equipped)) ? equipped : defaultBananaId;
  const shareName = '';

  return (
    <div className="space-y-8">
      <p className="text-sm text-text-secondary">
        Badges show what you&apos;ve done in SBS. Equip one to show it next to your
        avatar across the site — or keep your banana.
      </p>

      {/* Post the badge you're WEARING. One control above the grid rather than
          a button per tile — the tiles are a dense 6-up click-to-equip grid and
          per-tile actions would wreck it. Own profile only. */}
      {!readOnlyForUserId && shareBadgeId && (
        <div className="max-w-[340px]">
          <ShareCard
            imageUrl={buildBadgeCardUrl(shareBadgeId, shareName)}
            // /s/badge, not /profile — /profile carries no og:image of its own.
            pageUrl={buildBadgeSharePageUrl(shareBadgeId, shareName)}
            tweetText={`${BADGE_BY_ID[shareBadgeId]?.label ?? 'Badge'} unlocked on @SBSFantasy 🍌🏈`}
            fileName={`SBS-Badge-${BADGE_BY_ID[shareBadgeId]?.label ?? shareBadgeId}`}
            label="Post badge"
          />
        </div>
      )}

      {SECTIONS.map(section => {
        const badges = grouped[section.key] ?? [];
        if (badges.length === 0) return null;
        return (
          <section key={section.key}>
            <h4 className="text-xs font-bold uppercase tracking-wider text-text-secondary mb-1">
              {section.title}
            </h4>
            <p className="text-xs text-text-muted mb-3">{section.blurb}</p>
            {/* Live ripeness progress — paid drafts filled + distance to the
                next banana tier, with a hairline progress bar. Own profile
                only. Refreshes on every badge read (each profile open runs the
                server sweep, which recounts from the Go API). */}
            {section.key === 'ripeness' && !readOnlyForUserId && (
              <div className="mb-4 max-w-sm rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm text-white">
                    <span className="font-bold tabular-nums">{paidDone}</span>
                    <span className="text-text-secondary"> paid draft{paidDone === 1 ? '' : 's'}</span>
                  </span>
                  {nextTier ? (
                    <span className="text-xs text-text-secondary whitespace-nowrap">
                      <span className="font-semibold text-white tabular-nums">{nextTier.min - paidDone}</span> more to{' '}
                      <span className="font-semibold" style={{ color: nextTier.color }}>{nextTier.label}</span>
                    </span>
                  ) : (
                    <span className="text-xs font-semibold whitespace-nowrap" style={{ color: '#cca54f' }}>
                      Spoiled · maxed out
                    </span>
                  )}
                </div>
                <div className="mt-2 h-1 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: nextTier ? `${Math.min(100, Math.round((paidDone / nextTier.min) * 100))}%` : '100%',
                      background: nextTier ? nextTier.color : '#cca54f',
                    }}
                  />
                </div>
              </div>
            )}
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
              {badges.map(badge => {
                const isUnlocked = unlockedIds.has(badge.id);
                const isEquipped = equipped
                  ? equipped === badge.id
                  // Nothing explicitly equipped → the default banana is "active".
                  : badge.id === defaultBananaId;
                const clickable = !readOnlyForUserId && isUnlocked;

                const inner = (
                  <button
                    type="button"
                    onClick={clickable
                      ? () => handleEquip(isEquipped && equipped ? null : badge.id)
                      : undefined
                    }
                    // NOT the `disabled` attribute: browsers suppress ALL mouse/touch
                    // events over disabled buttons, so the <Tooltip> wrapper never saw
                    // hover/tap on locked badges (the recurring "King badge shows no
                    // copy" bug — locked-for-you badges had dead tooltips everywhere).
                    // Locked tiles are inert anyway (no onClick); aria keeps semantics.
                    aria-disabled={!clickable}
                    className={`relative flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition ${
                      isEquipped
                        ? 'border-banana bg-banana/15'
                        : clickable
                          ? 'border-white/10 hover:border-white/30 hover:bg-white/5'
                          : 'border-white/5'
                    } ${!clickable ? 'cursor-default' : 'cursor-pointer'}`}
                    style={{
                      width: '100%',
                      boxShadow: isEquipped ? '0 0 0 3px rgba(251,191,36,0.35), 0 0 18px rgba(251,191,36,0.45)' : undefined,
                    }}
                  >
                    {isEquipped && (
                      <span className="absolute -top-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-banana text-black text-[9px] font-black uppercase tracking-widest whitespace-nowrap">
                        Equipped
                      </span>
                    )}
                    <BadgeIcon badge={badge} size={44} unlocked={isUnlocked} showTooltip={false} />
                    <div className="text-[11px] font-bold text-center leading-tight">
                      {badge.label}
                    </div>
                    {!isUnlocked && (
                      <div className="text-[9px] uppercase tracking-wider text-text-muted">
                        Locked
                      </div>
                    )}
                  </button>
                );

                return (
                  <Tooltip
                    key={badge.id}
                    position="top"
                    content={
                      <div className="text-xs leading-tight max-w-[200px]">
                        <div className="font-bold">{badge.label}</div>
                        <div className="text-text-secondary mt-0.5">
                          {isUnlocked ? badge.description : badge.criteria}
                        </div>
                        {clickable && (
                          <div className="text-[10px] text-banana mt-1">
                            {isEquipped && equipped ? 'Click to unequip' : 'Click to equip'}
                          </div>
                        )}
                      </div>
                    }
                  >
                    {inner}
                  </Tooltip>
                );
              })}
            </div>
          </section>
        );
      })}

      {!readOnlyForUserId && (
        <div className="text-xs text-text-muted">
          You can only equip badges you&apos;ve unlocked. Hover any badge for details.
          {equipped && (
            <button
              type="button"
              onClick={() => handleEquip(null)}
              className="ml-3 underline hover:text-banana"
            >
              Clear equipped badge (back to your banana)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
