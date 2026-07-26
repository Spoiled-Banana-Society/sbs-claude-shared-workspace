import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { BADGE_BY_ID } from '@/lib/badges/catalog';
import { BANANA_VIEWBOX, BANANA_TRANSFORM, BANANA_PATH } from '@/lib/badges/bananaPath';
import { JACKPOT_RED, HOF_GOLD } from '@/components/ui/JackHofWordmark';

export const runtime = 'nodejs';
export const revalidate = 31536000;

/**
 * Shareable badge card — GET /api/og/badge?b=<badgeId>&n=<displayName>
 *
 * Follows the locked SBS promo-asset template (near-black radial ground, SBS
 * mark top-left, banana eyebrow, huge Inter-900 line, banana $100K + white
 * contest line) so a posted badge reads as the same family as every other
 * asset.
 *
 * The disc is REDRAWN here rather than reusing <BadgeIcon>: this route renders
 * through satori, which needs an explicit `display: flex` on anything with
 * multiple children and does not support `conic-gradient`. The JackHOF rim
 * therefore uses a linear red→gold sweep instead of the app's conic one —
 * visually equivalent at this size, and the COLORS come from the shared module
 * so the palette can never drift.
 *
 * `?w=wide` gives the 1200x628 landscape for X's desktop link unfurl; the
 * default 4:5 is what downloads and what the mobile share sheet attaches.
 */

const TALL_W = 1080, TALL_H = 1350;
const WIDE_W = 1200, WIDE_H = 628;
const BANANA = '#fbbf24';
const GLASS = 'radial-gradient(120% 120% at 30% 22%, #2a2c33 0%, #17181d 58%, #101116 100%)';

async function loadFont(file: string): Promise<ArrayBuffer | null> {
  try {
    const buf = await readFile(path.join(process.cwd(), 'public/fonts', file));
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  } catch { return null; }
}

// Same crown geometry BadgeIcon draws for the King badge.
const CROWN_BODY =
  'M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z';

/**
 * Center content for the disc. Badges are NOT all text: ripeness draws the
 * vector banana, King draws a crown, champions draw a roman numeral. Falling
 * through to `text` alone rendered an EMPTY disc for those (caught on the
 * King card, 2026-07-26). Paths are imported from the same modules the app
 * uses so the shapes can't drift.
 */
function discContent(size: number, badgeId: string, kind: string, color: string, text?: string, numeral?: string) {
  if (badgeId === 'jackhof-club') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ display: 'flex', color: JACKPOT_RED, fontSize: Math.round(size * 0.2), fontWeight: 900, letterSpacing: 1 }}>JACK</div>
        <div style={{ display: 'flex', color: HOF_GOLD, fontSize: Math.round(size * 0.236), fontWeight: 900, letterSpacing: 1 }}>HOF</div>
      </div>
    );
  }
  if (kind === 'banana') {
    const box = Math.round(size * 0.6);
    return (
      <svg width={box} height={box} viewBox={BANANA_VIEWBOX}>
        <g transform={BANANA_TRANSFORM} fill={color}><path d={BANANA_PATH} /></g>
      </svg>
    );
  }
  if (kind === 'icon') {
    const box = Math.round(size * 0.42);
    return <svg width={box} height={box} viewBox="0 0 24 24" fill={color}><path d={CROWN_BODY} /></svg>;
  }
  const label = text ?? numeral ?? '';
  return (
    <div style={{
      display: 'flex', color, fontWeight: 900, letterSpacing: 1,
      fontSize: Math.round(size * (label.length > 2 ? 0.24 : 0.33)),
    }}>{label}</div>
  );
}

/** The obsidian disc, satori-safe. */
function disc(size: number, badgeId: string, rim: string, content: string, text?: string, kind = 'text', numeral?: string) {
  const isJackHof = badgeId === 'jackhof-club';
  const rimFill = isJackHof
    ? `linear-gradient(135deg, ${JACKPOT_RED} 0%, ${JACKPOT_RED} 34%, ${HOF_GOLD} 66%, ${HOF_GOLD} 100%)`
    : rim;
  const pad = Math.round(size * 0.028);
  return (
    <div style={{
      display: 'flex', width: size, height: size, padding: pad, borderRadius: 9999,
      background: rimFill, boxSizing: 'border-box',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: '100%', height: '100%', borderRadius: 9999, background: GLASS,
      }}>
        {discContent(size, badgeId, kind, content, text, numeral)}
      </div>
    </div>
  );
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const badgeId = searchParams.get('b') ?? 'og';
  const name = (searchParams.get('n') ?? '').slice(0, 24);
  const wide = searchParams.get('w') === 'wide';
  const badge = BADGE_BY_ID[badgeId] ?? BADGE_BY_ID['og'];

  const [i400, i700, i900] = await Promise.all([
    loadFont('Inter-400.ttf'), loadFont('Inter-700.ttf'), loadFont('Inter-900.ttf'),
  ]);
  const fonts: { name: string; data: ArrayBuffer; weight: 400 | 700 | 900; style: 'normal' }[] = [];
  if (i400) fonts.push({ name: 'Inter', data: i400, weight: 400, style: 'normal' });
  if (i700) fonts.push({ name: 'Inter', data: i700, weight: 700, style: 'normal' });
  if (i900) fonts.push({ name: 'Inter', data: i900, weight: 900, style: 'normal' });

  const logoBuf = await readFile(path.join(process.cwd(), 'public/sbs-logo-white.png')).catch(() => null);
  const logo = logoBuf ? `data:image/png;base64,${logoBuf.toString('base64')}` : null;

  const W = wide ? WIDE_W : TALL_W;
  const H = wide ? WIDE_H : TALL_H;
  const discSize = wide ? 200 : 300;
  const titleSize = wide ? 58 : 92;

  return new ImageResponse(
    (
      <div style={{
        width: W, height: H, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', position: 'relative',
        fontFamily: 'Inter',
        background: 'radial-gradient(120% 90% at 50% 12%, #17171d 0%, #0c0c10 55%, #08080a 100%)',
      }}>
        {/* SBS mark */}
        <div style={{ position: 'absolute', top: wide ? 40 : 62, left: wide ? 48 : 76, display: 'flex', alignItems: 'center', gap: 13 }}>
          {logo ? <img src={logo} width={wide ? 26 : 34} height={wide ? 26 : 34} style={{ objectFit: 'contain' }} /> : null}
          <div style={{ display: 'flex', color: '#fff', fontWeight: 700, fontSize: wide ? 23 : 30, letterSpacing: 9 }}>SBS</div>
        </div>

        {disc(discSize, badge.id, badge.rimColor, badge.contentColor ?? '#f3f5f8', badge.text, badge.contentKind, badge.numeral)}

        <div style={{ display: 'flex', marginTop: wide ? 26 : 40, color: BANANA, fontWeight: 900, fontSize: wide ? 19 : 24, letterSpacing: 9 }}>
          BADGE UNLOCKED
        </div>

        <div style={{ display: 'flex', marginTop: wide ? 14 : 22, color: '#fff', fontWeight: 900, fontSize: titleSize, letterSpacing: -1 }}>
          {badge.label}
        </div>

        <div style={{ display: 'flex', marginTop: wide ? 12 : 18, maxWidth: wide ? 760 : 820, textAlign: 'center', color: 'rgba(255,255,255,.6)', fontWeight: 700, fontSize: wide ? 22 : 30 }}>
          {name ? `${name} — ${badge.description}` : badge.description}
        </div>

        {/* Footer */}
        <div style={{ position: 'absolute', bottom: wide ? 42 : 78, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ display: 'flex', color: BANANA, fontWeight: 900, fontSize: wide ? 34 : 50 }}>
            $100K Guaranteed Prize Pool
          </div>
          <div style={{ display: 'flex', marginTop: 10, color: '#fff', fontWeight: 900, fontSize: wide ? 17 : 24, letterSpacing: 3 }}>
            BANANA BEST BALL IV · FANTASY FOOTBALL CONTEST
          </div>
        </div>
      </div>
    ),
    { width: W, height: H, fonts: fonts.length ? fonts : undefined },
  );
}
