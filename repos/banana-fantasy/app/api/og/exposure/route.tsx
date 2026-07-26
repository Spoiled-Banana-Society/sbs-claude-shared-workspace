import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const runtime = 'nodejs';
export const revalidate = 3600;

/**
 * Shareable EXPOSURE card — GET /api/og/exposure?d=<base64url payload>
 *
 * Payload: { name, totalDrafts, rows: [{ tp, pct, drafts }] }
 *   tp     "CIN-WR1" — team-position, the way SBS names players
 *   pct    exposure percentage
 *   drafts how many of their drafts contain it
 *
 * Exposure screenshots are the single most native format on fantasy X — it's
 * what best-ball players post unprompted all season. This makes ours a real
 * asset instead of a cropped screenshot, and it's self-marketing: the roster
 * IS the content, so there's nothing to fake and nothing to farm.
 *
 * `?w=wide` renders 1200x628 for X's desktop link unfurl (link cards crop to
 * 1.91:1); the default 4:5 is what downloads and what the mobile share sheet
 * attaches.
 */

const TALL_W = 1080, TALL_H = 1350;
const WIDE_W = 1200, WIDE_H = 628;
const BANANA = '#fbbf24';

// Same on-dark position palette the team card and draft room use.
const POS_COLOR: Record<string, string> = {
  QB: '#ff5a5f', RB: '#69c93f', WR: '#d98cf0', TE: '#5b8cff', DST: '#f0a050',
};
const basePos = (p: string) => p.replace(/[0-9]/g, '').toUpperCase();

interface Row { tp: string; pct: number; drafts?: number }
interface Payload { name?: string; totalDrafts?: number; rows?: Row[] }

async function loadFont(file: string): Promise<ArrayBuffer | null> {
  try {
    const buf = await readFile(path.join(process.cwd(), 'public/fonts', file));
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  } catch { return null; }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const wide = searchParams.get('w') === 'wide';

  let p: Payload = {};
  try {
    const d = searchParams.get('d');
    if (d) p = JSON.parse(Buffer.from(d, 'base64url').toString('utf8'));
  } catch { /* empty payload → header-only card */ }

  const name = (p.name ?? '').slice(0, 22);
  const totalDrafts = Number(p.totalDrafts) || 0;
  // Wide fits fewer rows; both are sorted highest-exposure first by the caller.
  const rows = (p.rows ?? []).slice(0, wide ? 8 : 12);

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
  const rowH = wide ? 46 : 68;
  const nameSize = wide ? 22 : 32;
  const pctSize = wide ? 22 : 32;
  const barW = wide ? 250 : 400;

  return new ImageResponse(
    (
      <div style={{
        width: W, height: H, display: 'flex', flexDirection: 'column',
        position: 'relative', fontFamily: 'Inter',
        padding: wide ? '38px 56px' : '64px 84px',
        background: 'radial-gradient(120% 90% at 50% 12%, #17171d 0%, #0c0c10 55%, #08080a 100%)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
          {logo ? <img src={logo} width={wide ? 24 : 32} height={wide ? 24 : 32} style={{ objectFit: 'contain' }} /> : null}
          <div style={{ display: 'flex', color: '#fff', fontWeight: 700, fontSize: wide ? 21 : 28, letterSpacing: 9 }}>SBS</div>
        </div>

        <div style={{ display: 'flex', marginTop: wide ? 16 : 30, color: BANANA, fontWeight: 900, fontSize: wide ? 16 : 22, letterSpacing: 8 }}>
          MY EXPOSURE
        </div>
        <div style={{ display: 'flex', marginTop: wide ? 6 : 12, color: '#fff', fontWeight: 900, fontSize: wide ? 40 : 66, letterSpacing: -1.4 }}>
          {name || 'Banana Best Ball IV'}
        </div>
        {totalDrafts > 0 ? (
          <div style={{ display: 'flex', marginTop: 6, color: 'rgba(255,255,255,.5)', fontWeight: 700, fontSize: wide ? 18 : 26 }}>
            across {totalDrafts} {totalDrafts === 1 ? 'draft' : 'drafts'}
          </div>
        ) : null}

        {/* Rows — team-position, a proportional bar, then the % */}
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: wide ? 16 : 34 }}>
          {rows.map((r) => {
            const color = POS_COLOR[basePos(String(r.tp).split('-')[1] ?? '')] ?? '#9aa0ab';
            const pct = Math.max(0, Math.min(100, Number(r.pct) || 0));
            return (
              <div key={r.tp} style={{ display: 'flex', alignItems: 'center', height: rowH }}>
                <div style={{ display: 'flex', width: wide ? 34 : 46, height: wide ? 4 : 6, borderRadius: 3, background: color, marginRight: wide ? 14 : 20 }} />
                <div style={{ display: 'flex', flexGrow: 1, color: '#fff', fontWeight: 700, fontSize: nameSize }}>{r.tp}</div>
                <div style={{ display: 'flex', width: barW, height: wide ? 8 : 12, borderRadius: 6, background: 'rgba(255,255,255,.07)', marginRight: wide ? 16 : 24 }}>
                  <div style={{ display: 'flex', width: Math.max(4, Math.round((barW * pct) / 100)), height: '100%', borderRadius: 6, background: color }} />
                </div>
                <div style={{ display: 'flex', width: wide ? 78 : 116, justifyContent: 'flex-end', color: '#fff', fontWeight: 900, fontSize: pctSize }}>
                  {pct.toFixed(0)}%
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{ position: 'absolute', bottom: wide ? 30 : 62, left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ display: 'flex', color: BANANA, fontWeight: 900, fontSize: wide ? 27 : 42 }}>
            $100K Guaranteed Prize Pool
          </div>
          <div style={{ display: 'flex', marginTop: 8, color: '#fff', fontWeight: 900, fontSize: wide ? 15 : 21, letterSpacing: 3 }}>
            BANANA BEST BALL IV · FANTASY FOOTBALL CONTEST
          </div>
        </div>
      </div>
    ),
    { width: W, height: H, fonts: fonts.length ? fonts : undefined },
  );
}
