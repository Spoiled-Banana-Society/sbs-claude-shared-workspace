'use client';

import React, { useCallback, useMemo } from 'react';
import { Tooltip } from '@/components/ui/Tooltip';
import { BadgeIcon } from './BadgeIcon';
import { useBadges } from '@/hooks/useBadges';
import { useToast } from '@/components/ui/Toast';
import type { Badge, BadgeCategory } from '@/types';

const CATEGORY_LABEL: Record<BadgeCategory, string> = {
  drafts: 'Drafts',
  league: 'League Performance',
  finals: 'Playoffs & Finals',
  wheel: 'Wheel',
  founder: 'Founder',
  legacy: 'Legacy Champions',
  team: 'NFL Team Flair',
};

const CATEGORY_ORDER: BadgeCategory[] = ['drafts', 'league', 'finals', 'wheel', 'founder', 'legacy', 'team'];

interface BadgeCatalogGridProps {
  /** When set, viewing another user's catalog read-only — equip controls hidden. */
  readOnlyForUserId?: string;
}

/**
 * Renders the full catalog. Unlocked badges are colored, locked ones are
 * greyed with the unlock criteria visible on hover. Click an unlocked
 * badge to equip / unequip.
 */
export function BadgeCatalogGrid({ readOnlyForUserId }: BadgeCatalogGridProps) {
  const { catalog, unlockedIds, equipped, equipBadge, isLoading } = useBadges(
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
    const out: Record<BadgeCategory, Badge[]> = {
      drafts: [], league: [], finals: [], wheel: [], founder: [], legacy: [], team: [],
    };
    for (const b of catalog) {
      // Hidden badges (past-season champions) only show once unlocked.
      // While locked, they're invisible — preserves the surprise.
      if (b.hidden && !unlockedIds.has(b.id)) continue;
      out[b.category].push(b);
    }
    return out;
  }, [catalog, unlockedIds]);

  if (isLoading && catalog.length === 0) {
    return <div className="text-sm text-text-secondary">Loading badges…</div>;
  }

  return (
    <div className="space-y-6">
      {CATEGORY_ORDER.map(cat => (
        grouped[cat].length === 0 ? null : (
          <section key={cat}>
            <h4 className="text-xs font-bold uppercase tracking-wider text-text-secondary mb-3">
              {CATEGORY_LABEL[cat]}
            </h4>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
              {grouped[cat].map(badge => {
                const isUnlocked = unlockedIds.has(badge.id);
                const isEquipped = equipped === badge.id;
                const clickable = !readOnlyForUserId && isUnlocked;

                const inner = (
                  <button
                    type="button"
                    onClick={clickable
                      ? () => handleEquip(isEquipped ? null : badge.id)
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
                            {isEquipped ? 'Click to unequip' : 'Click to equip'}
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
        )
      ))}

      {!readOnlyForUserId && (
        <div className="text-xs text-text-muted">
          You can only equip badges you&apos;ve unlocked. Hover any badge for details.
          {equipped && (
            <button
              type="button"
              onClick={() => handleEquip(null)}
              className="ml-3 underline hover:text-banana"
            >
              Clear equipped badge
            </button>
          )}
        </div>
      )}
    </div>
  );
}
