'use client';

import React from 'react';
import { Tooltip } from '@/components/ui/Tooltip';
import { BananaGlyph } from './BananaGlyph';
import { ripenessTooltip, ripenessFromCount } from '@/lib/badges/ripeness';
import type { Badge, Ripeness } from '@/types';

interface BadgeIconProps {
  badge: Badge;
  size?: number; // pixel diameter — default 20
  unlocked?: boolean; // greys it out when false
  showTooltip?: boolean; // wrap in <Tooltip>; default true
  /** For the dynamic ripeness badge: the user's current tier (drives the
   *  banana fill color + tooltip). Ignored by all other badges. Defaults to
   *  Unripe when omitted so a banana always renders. */
  ripeness?: Ripeness | null;
  /** Corner-overlay mode (avatar badge). Same disc recipe; just a flag kept
   *  for call-site clarity — the renderer scales everything by `size`. */
  plain?: boolean;
}

// ── Obsidian-disc geometry (locked to ~/Desktop/badges-each.html) ────────
// rim padding + drop-shadow scale with size; inner glass insets are fixed.
const GLASS_BG =
  'radial-gradient(125% 125% at 32% 24%,#26262b 0%,#161618 46%,#0b0b0d 100%)';
const GLASS_INSET =
  'inset 0 1px .5px rgba(255,255,255,.14),inset 0 -3px 7px rgba(0,0,0,.55)';

// Locked badges drop all color → a dim, colorless disc.
const LOCKED_RIM = '#33333a';
const LOCKED_CONTENT = '#5b5b62';

// Lucide crown + key paths, inlined (no runtime dep). Crown is filled for
// champion badges, stroked for the King outline; Key is always stroked.
const CROWN_BODY =
  'M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z';
const CROWN_BASE = 'M5 21h14';

/** Filled crown (champion topper). The base line contributes nothing when
 *  filled, matching the reference. */
function FilledCrown({ px, color }: { px: number; color: string }) {
  return (
    <svg width={px} height={px} viewBox="0 0 24 24" fill={color} stroke="none">
      <path d={CROWN_BODY} />
      <path d={CROWN_BASE} />
    </svg>
  );
}

/** Outline crown (King of Drafts). */
function OutlineCrown({ px, color }: { px: number; color: string }) {
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={CROWN_BODY} />
      <path d={CROWN_BASE} />
    </svg>
  );
}

/** Outline key (Founders League). */
function OutlineKey({ px, color }: { px: number; color: string }) {
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4" />
      <path d="m21 2-9.6 9.6" />
      <circle cx="7.5" cy="15.5" r="5.5" />
    </svg>
  );
}

// Per-text sizing for the `text` content kind (ratio of disc size + weight).
const TEXT_SPEC: Record<string, { ratio: number; weight: number }> = {
  JP: { ratio: 0.333, weight: 700 },
  HOF: { ratio: 0.236, weight: 700 },
  OG: { ratio: 0.305, weight: 400 },
};

/**
 * Renders a single badge as an obsidian disc: a dark-glass center with a
 * solid colored rim and a flat center icon. No glow. The center content is
 * chosen by `badge.contentKind`. Locked badges render as a dim, colorless
 * disc. Everything scales by `size`.
 */
export function BadgeIcon({
  badge,
  size = 20,
  unlocked = true,
  showTooltip = true,
  ripeness,
  // `plain` is accepted (call sites pass it for the avatar-corner overlay) but
  // the obsidian-disc renderer scales everything by `size`, so it's a no-op.
}: BadgeIconProps) {
  const s = size;
  const pad = Math.max(1, Math.round(s * 0.028));
  const dropY = Math.max(1, Math.round(s * 0.055));
  const dropBlur = Math.max(1, Math.round(s * 0.085));

  const rim = unlocked ? badge.rimColor : LOCKED_RIM;
  const content = unlocked ? (badge.contentColor || '#f3f5f8') : LOCKED_CONTENT;

  // Ripeness: fill the banana with the user's tier color (defaults to Unripe).
  const tier = ripeness ?? ripenessFromCount(0);

  // ── Center content per kind ──────────────────────────────────────────
  let inner: React.ReactNode = null;
  if (badge.contentKind === 'banana') {
    const box = Math.round(s * 0.62);
    inner = (
      <span style={{ width: box, height: box, display: 'inline-flex' }}>
        <BananaGlyph color={unlocked ? tier.color : LOCKED_CONTENT} />
      </span>
    );
  } else if (badge.contentKind === 'logo' && badge.iconUrl) {
    const box = Math.round(s * 0.6);
    inner = (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={badge.iconUrl}
        alt=""
        width={box}
        height={box}
        style={{
          objectFit: 'contain',
          display: 'block',
          opacity: unlocked ? 1 : 0.5,
          filter: unlocked ? undefined : 'grayscale(1)',
        }}
        draggable={false}
      />
    );
  } else if (badge.contentKind === 'text') {
    const spec = TEXT_SPEC[badge.text ?? ''] ?? { ratio: 0.3, weight: 700 };
    inner = (
      <span
        style={{
          fontWeight: spec.weight,
          fontSize: Math.round(s * spec.ratio),
          color: content,
          fontFamily: '-apple-system, system-ui, sans-serif',
          letterSpacing: '.03em',
          lineHeight: 1,
        }}
      >
        {badge.text}
      </span>
    );
  } else if (badge.contentKind === 'icon') {
    const px = Math.round(s * 0.42);
    inner = badge.iconName === 'key'
      ? <OutlineKey px={px} color={content} />
      : <OutlineCrown px={px} color={content} />;
  } else if (badge.contentKind === 'numeral-crown') {
    inner = (
      <span
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: Math.round(s * 0.139),
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'inline-flex',
          }}
        >
          <FilledCrown px={Math.round(s * 0.194)} color={content} />
        </span>
        <span
          style={{
            fontWeight: 300,
            fontSize: Math.round(s * 0.333),
            color: content,
            fontFamily: '-apple-system, system-ui, sans-serif',
            marginTop: Math.round(s * 0.097),
            lineHeight: 1,
          }}
        >
          {badge.numeral}
        </span>
      </span>
    );
  } else if (badge.contentKind === 'hof-champ') {
    inner = (
      <span
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
          lineHeight: 1,
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: Math.round(s * 0.139),
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'inline-flex',
          }}
        >
          <FilledCrown px={Math.round(s * 0.167)} color={content} />
        </span>
        <span
          style={{
            fontWeight: 700,
            fontSize: Math.round(s * 0.208),
            color: content,
            fontFamily: '-apple-system, system-ui, sans-serif',
            marginTop: Math.round(s * 0.125),
          }}
        >
          HOF
        </span>
        <span
          style={{
            fontWeight: 600,
            fontSize: Math.round(s * 0.153),
            color: content,
            marginTop: Math.round(s * 0.014),
          }}
        >
          {badge.numeral}
        </span>
      </span>
    );
  }

  const disc = (
    <span
      aria-label={badge.label}
      style={{
        position: 'relative',
        display: 'inline-flex',
        width: s,
        height: s,
        borderRadius: '9999px',
        background: rim,
        padding: pad,
        boxSizing: 'border-box',
        filter: `drop-shadow(0 ${dropY}px ${dropBlur}px rgba(0,0,0,.55))`,
        opacity: unlocked ? 1 : 0.85,
      }}
    >
      <span
        style={{
          position: 'relative',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
          borderRadius: '9999px',
          background: GLASS_BG,
          boxShadow: GLASS_INSET,
          overflow: 'hidden',
        }}
      >
        {inner}
      </span>
    </span>
  );

  if (!showTooltip) return disc;

  // Tooltip: ripeness shows its tier label + range; everything else shows the
  // description (unlocked) or the unlock criteria (locked).
  const isRipeness = badge.dynamic === 'ripeness';
  const title = isRipeness ? tier.label : badge.label;
  const body = isRipeness
    ? ripenessTooltip(tier)
    : (unlocked ? badge.description : badge.criteria);

  return (
    <Tooltip
      position="top"
      content={
        <div className="text-xs leading-tight max-w-[220px]">
          <div className="font-bold">{title}</div>
          <div className="text-text-secondary">{body}</div>
        </div>
      }
    >
      {disc}
    </Tooltip>
  );
}
