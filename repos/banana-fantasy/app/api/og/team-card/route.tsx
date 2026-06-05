import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const runtime = 'nodejs';
// OpenSea / X re-fetch this; cache hard once rendered.
export const revalidate = 31536000;

// ── 4:5 X-safe canvas (nothing cropped on X timeline) ──
const CANVAS_W = 1080;
const CANVAS_H = 1350;
// Card design is 312x452; scale up and center on the obsidian canvas.
const S = 2.5;
const px = (n: number) => Math.round(n * S);

type Tier = 'pro' | 'hof' | 'jackpot';
interface Player { team: string; pos: string; bye: string | number; adp: string | number; pick: string | number }
interface Payload { tier?: Tier; passNo?: string | number; players?: Player[]; preReveal?: boolean }

const FRAME: Record<Tier, string> = {
  pro: 'linear-gradient(135deg,#6b21a8,#d8b4fe 30%,#a855f7 52%,#f3e8ff 64%,#7e22ce 84%,#c084fc)',
  hof: 'linear-gradient(135deg,#7c5a14,#ffe9a0 22%,#d9b53c 44%,#fff6cf 58%,#b8901f 80%,#f0d875)',
  jackpot: 'linear-gradient(135deg,#7e1316,#ff8a85 24%,#e23b3b 46%,#ffd9d4 58%,#b01c1c 80%,#ef5350)',
};
const GREY_FRAME = 'linear-gradient(135deg,#23262d,#aab0bb 22%,#474d58 44%,#dfe4ec 58%,#3a3f48 80%,#878e99)';
const BADGE: Record<Tier, { text: string; bg: string; line: string; dot: string; label: string }> = {
  pro: { text: '#c79bff', bg: 'rgba(168,85,247,.16)', line: 'rgba(168,85,247,.5)', dot: '#b87cff', label: 'PRO' },
  hof: { text: '#f3d057', bg: 'rgba(225,200,75,.14)', line: 'rgba(225,200,75,.5)', dot: '#f1c84b', label: 'HOF' },
  jackpot: { text: '#ff7b7b', bg: 'rgba(239,68,68,.16)', line: 'rgba(239,68,68,.5)', dot: '#ff5a5a', label: 'JACKPOT' },
};
const POS_ON_DARK: Record<string, string> = { QB: '#ff5a5f', RB: '#69c93f', WR: '#d98cf0', TE: '#5b8cff', DST: '#f0a050' };
const posColor = (pos: string) => POS_ON_DARK[pos.replace(/[0-9]/g, '').toUpperCase()] || '#9aa0ab';

async function loadFont(file: string): Promise<ArrayBuffer | null> {
  try {
    const buf = await readFile(path.join(process.cwd(), 'public/fonts', file));
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  let p: Payload = {};
  try {
    const d = searchParams.get('d');
    if (d) p = JSON.parse(Buffer.from(d, 'base64url').toString('utf8'));
  } catch { /* fall back to empty (pre-reveal pass) */ }
  const tier: Tier = p.tier && FRAME[p.tier] ? p.tier : 'pro';
  const preReveal = !!p.preReveal;
  const players = (p.players || []).slice(0, 15);
  const passNo = p.passNo != null && p.passNo !== '' ? `#${p.passNo}` : '';

  // Fonts: local Inter TTFs (public/fonts) — parse reliably in @vercel/og.
  const [i400, i700, i900, i800i] = await Promise.all([
    loadFont('Inter-400.ttf'),
    loadFont('Inter-700.ttf'),
    loadFont('Inter-900.ttf'),
    loadFont('Inter-800i.ttf'),
  ]);
  const fonts: { name: string; data: ArrayBuffer; weight: 400 | 700 | 800 | 900; style: 'normal' | 'italic' }[] = [];
  if (i400) fonts.push({ name: 'Inter', data: i400, weight: 400, style: 'normal' });
  if (i700) fonts.push({ name: 'Inter', data: i700, weight: 700, style: 'normal' });
  if (i900) fonts.push({ name: 'Inter', data: i900, weight: 900, style: 'normal' });
  if (i800i) fonts.push({ name: 'Inter', data: i800i, weight: 800, style: 'italic' });
  const fontFamily = 'Inter';

  const logoData = await readFile(path.join(process.cwd(), 'public/sbs-logo-white.png')).catch(() => null);
  const logoSrc = logoData ? `data:image/png;base64,${logoData.toString('base64')}` : undefined;

  const card = preReveal ? renderPass(passNo, logoSrc) : renderTeam(tier, players, logoSrc);

  return new ImageResponse(
    (
      <div
        style={{
          width: CANVAS_W,
          height: CANVAS_H,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily,
          background: 'linear-gradient(172deg,#0d0d12 0%,#08080b 70%,#060608 100%)',
        }}
      >
        {card}
      </div>
    ),
    { width: CANVAS_W, height: CANVAS_H, fonts: fonts.length ? fonts : undefined },
  );
}

function frameWrap(children: React.ReactNode, background: string) {
  return (
    <div style={{ display: 'flex', padding: px(4), borderRadius: px(28), background }}>
      <div
        style={{
          width: px(312),
          height: px(452),
          borderRadius: px(23),
          position: 'relative',
          display: 'flex',
          overflow: 'hidden',
          background: 'linear-gradient(172deg,#17171e 0%,#0d0d12 58%,#070709 100%)',
        }}
      >
        {children}
      </div>
    </div>
  );
}

function renderTeam(tier: Tier, players: Player[], logoSrc?: string) {
  const b = BADGE[tier];
  return frameWrap(
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', height: '100%', padding: `${px(14)}px ${px(16)}px ${px(15)}px` }}>
      {logoSrc ? <img src={logoSrc} width={px(26)} height={px(26)} style={{ objectFit: 'contain', opacity: 0.92 }} /> : null}
      <div style={{ marginTop: px(5), fontSize: px(12), fontWeight: 700, letterSpacing: px(0.6), color: 'rgba(255,255,255,.85)' }}>BANANA BEST BALL IV</div>
      <div style={{ display: 'flex', alignItems: 'center', marginTop: px(7), padding: `${px(3)}px ${px(11)}px`, borderRadius: px(30), fontSize: px(11), fontWeight: 900, letterSpacing: px(1.5), color: b.text, background: b.bg, border: `1px solid ${b.line}` }}>
        <div style={{ display: 'flex', width: px(5), height: px(5), borderRadius: px(5), background: b.dot, marginRight: px(5) }} />
        {b.label}
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-end', marginTop: px(13), width: '100%' }}>
        <div style={{ display: 'flex', width: px(104) }} />
        {['BYE', 'ADP', 'PICK'].map((h) => (
          <div key={h} style={{ display: 'flex', justifyContent: 'center', width: px(30), marginLeft: px(8), fontSize: px(7), fontWeight: 900, letterSpacing: px(1.2), color: 'rgba(255,255,255,.26)' }}>{h}</div>
        ))}
      </div>
      <div style={{ display: 'flex', width: '88%', height: 2, marginTop: px(4), background: 'linear-gradient(90deg,transparent,rgba(255,255,255,.14),transparent)' }} />
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', flexGrow: 1, justifyContent: 'space-between', padding: `${px(4)}px 0 ${px(2)}px` }}>
        {players.map((pl, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flexGrow: 1, borderBottom: i < players.length - 1 ? '1px solid rgba(255,255,255,.05)' : 'none' }}>
            <div style={{ display: 'flex', width: px(104), justifyContent: 'center' }}>
              <span style={{ fontSize: px(15), fontWeight: 700, color: '#fff' }}>{pl.team}</span>
              <span style={{ fontSize: px(15), fontWeight: 900, color: posColor(pl.pos), marginLeft: px(6) }}>{pl.pos}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', width: px(30), marginLeft: px(8), fontSize: px(9), fontWeight: 700, color: 'rgba(255,255,255,.4)' }}>{pl.bye}</div>
            <div style={{ display: 'flex', justifyContent: 'center', width: px(30), marginLeft: px(8), fontSize: px(9), fontWeight: 700, color: 'rgba(255,255,255,.4)' }}>{pl.adp}</div>
            <div style={{ display: 'flex', justifyContent: 'center', width: px(30), marginLeft: px(8), fontSize: px(9), fontWeight: 700, color: 'rgba(255,255,255,.4)' }}>#{pl.pick}</div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: px(13), fontSize: px(10.5), fontWeight: 900, letterSpacing: px(0.6), color: 'rgba(255,255,255,.55)' }}>SBS</div>
    </div>,
    FRAME[tier],
  );
}

function renderPass(passNo: string, logoSrc?: string) {
  return (
    <div style={{ display: 'flex', position: 'relative' }}>
      {frameWrap(
        <>
          <div style={{ position: 'absolute', top: px(11), left: px(11), right: px(11), bottom: px(11), border: '2px dashed rgba(255,255,255,.20)', borderRadius: px(15) }} />
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', height: '100%', padding: `${px(32)}px ${px(24)}px ${px(26)}px` }}>
            {logoSrc ? <img src={logoSrc} width={px(42)} height={px(42)} style={{ objectFit: 'contain' }} /> : null}
            <div style={{ marginTop: px(16), fontSize: px(13.5), fontWeight: 900, letterSpacing: px(3.5), color: 'rgba(255,255,255,.9)' }}>{`DRAFT PASS ${passNo}`.trim()}</div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: 'auto 0' }}>
              <div style={{ fontStyle: 'italic', fontWeight: 800, fontSize: px(30), lineHeight: 1.05, color: '#fbbf24', textAlign: 'center' }}>BANANA</div>
              <div style={{ fontStyle: 'italic', fontWeight: 800, fontSize: px(30), lineHeight: 1.05, color: '#fbbf24', textAlign: 'center' }}>BEST BALL</div>
              <div style={{ fontStyle: 'italic', fontWeight: 800, fontSize: px(38), lineHeight: 1, color: '#fbbf24', marginTop: px(3) }}>IV</div>
            </div>
            <div style={{ fontSize: px(11), fontWeight: 900, letterSpacing: px(2), color: 'rgba(255,255,255,.58)' }}>SBS</div>
          </div>
        </>,
        GREY_FRAME,
      )}
      <div style={{ position: 'absolute', top: '50%', left: px(-12), width: px(24), height: px(24), borderRadius: px(24), background: '#060608', transform: 'translateY(-50%)' }} />
      <div style={{ position: 'absolute', top: '50%', right: px(-12), width: px(24), height: px(24), borderRadius: px(24), background: '#060608', transform: 'translateY(-50%)' }} />
    </div>
  );
}
