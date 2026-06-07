'use client';

import React, { useCallback, useMemo } from 'react';
import { Tooltip } from '@/components/ui/Tooltip';
import { BadgeIcon } from './BadgeIcon';
import { useBadges } from '@/hooks/useBadges';
import { useToast } from '@/components/ui/Toast';
import { ripenessFromCount } from '@/lib/badges/ripeness';
import type { Badge, BadgeCategory } from '@/types';

// Sections in display order, each with plain-English copy.
const SECTIONS: Array<{ key: BadgeCategory; title: string; blurb: string }> = [
  { key: 'ripeness', title: 'Your Banana', blurb: 'Everyone starts with a banana. It ripens as you buy more PAID BBB4 drafts — each tier unlocks at 1 / 10 / 20 / 50 / 100 / 200. Equip whichever unlocked banana you want to show off.' },
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
      if (out[b.category]) out[b.category].push(b);
    }
    return out;
  }, [catalog]);

  const tier = ripeness ?? ripenessFromCount(0);
  // The id of the banana the user is currently showing by default (their
  // highest unlocked tier) — highlighted so they can see "this is my banana".
  const defaultBananaId = `ripeness-${tier.label.toLowerCase()}`;

  if (isLoading && catalog.length === 0) {
    return <div className="text-sm text-text-secondary">Loading badges…</div>;
  }

  return (
    <div className="space-y-8">
      <p className="text-sm text-text-secondary">
        Badges show what you&apos;ve done in SBS. Equip one to show it next to your
        avatar across the site — or keep your banana.
      </p>

      {SECTIONS.map(section => {
        const badges = grouped[section.key] ?? [];
        if (badges.length === 0) return null;
        return (
          <section key={section.key}>
            <h4 className="text-xs font-bold uppercase tracking-wider text-text-secondary mb-1">
              {section.title}
            </h4>
            <p className="text-xs text-text-muted mb-3">{section.blurb}</p>
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
                    disabled={!clickable}
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
