import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ALL_POSITIONS } from '@/data/nfl-players';

export const runtime = 'nodejs';
export const revalidate = 31536000;

// ── 4:5 X-safe canvas (nothing cropped on X) ──
const CANVAS_W = 1080;
const CANVAS_H = 1350;

type Tier = 'pro' | 'hof' | 'jackpot' | 'jackhof';
interface Player { team: string; pos: string; bye?: string | number; adp?: string | number; pick?: string | number; playerId?: string }
interface Payload { tier?: Tier; passNo?: string | number; teamNo?: string | number; leagueNo?: string | number; players?: Player[]; preReveal?: boolean }

const FRAME: Record<Tier, string> = {
  pro: 'linear-gradient(135deg,#6b21a8,#d8b4fe 30%,#a855f7 52%,#f3e8ff 64%,#7e22ce 84%,#c084fc)',
  hof: 'linear-gradient(135deg,#7c5a14,#ffe9a0 22%,#d9b53c 44%,#fff6cf 58%,#b8901f 80%,#f0d875)',
  jackpot: 'linear-gradient(135deg,#7e1316,#ff8a85 24%,#e23b3b 46%,#ffd9d4 58%,#b01c1c 80%,#ef5350)',
  // JackHOF = the Jackpot red flowing into HOF gold — both tiers on one card.
  jackhof: 'linear-gradient(135deg,#7e1316,#ff8a85 22%,#e23b3b 40%,#ffe9a0 56%,#d9b53c 72%,#b8901f 86%,#f0d875)',
};
const GREY_FRAME = 'linear-gradient(135deg,#23262d,#aab0bb 22%,#474d58 44%,#dfe4ec 58%,#3a3f48 80%,#878e99)';
const BADGE: Record<Tier, { text: string; bg: string; line: string; dot: string; label: string }> = {
  pro: { text: '#c79bff', bg: 'rgba(168,85,247,.16)', line: 'rgba(168,85,247,.5)', dot: '#b87cff', label: 'PRO' },
  hof: { text: '#f3d057', bg: 'rgba(225,200,75,.14)', line: 'rgba(225,200,75,.5)', dot: '#f1c84b', label: 'HOF' },
  jackpot: { text: '#ff7b7b', bg: 'rgba(239,68,68,.16)', line: 'rgba(239,68,68,.5)', dot: '#ff5a5a', label: 'JACKPOT' },
  jackhof: { text: '#ffb37b', bg: 'rgba(239,108,55,.16)', line: 'rgba(239,108,55,.5)', dot: '#ff8a50', label: 'JACKHOF' },
};
const POS_ON_DARK: Record<string, string> = { QB: '#ff5a5f', RB: '#69c93f', WR: '#d98cf0', TE: '#5b8cff', DST: '#f0a050' };
const POS_ORDER = ['QB', 'RB', 'WR', 'TE', 'DST'];
const basePos = (p: string) => p.replace(/[0-9]/g, '').toUpperCase();
const posColor = (pos: string) => POS_ON_DARK[basePos(pos)] || '#9aa0ab';

const META = new Map(ALL_POSITIONS.map((p) => [p.playerId, p]));
function fill(p: Player): Required<Pick<Player, 'team' | 'pos' | 'bye' | 'adp' | 'pick'>> {
  const team = p.team || (p.playerId || '').split('-')[0] || '';
  const pos = p.pos || (p.playerId || '').split('-')[1] || '';
  const m = META.get(p.playerId || `${team}-${pos}`);
  return {
    team, pos,
    bye: p.bye ?? m?.byeWeek ?? '-',
    adp: p.adp ?? m?.adp ?? '-',
    pick: p.pick ?? '-',
  };
}

async function loadFont(file: string): Promise<ArrayBuffer | null> {
  try {
    const buf = await readFile(path.join(process.cwd(), 'public/fonts', file));
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  } catch { return null; }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  let p: Payload = {};
  try {
    const d = searchParams.get('d');
    if (d) p = JSON.parse(Buffer.from(d, 'base64url').toString('utf8'));
  } catch { /* empty → pre-reveal pass */ }
  const tier: Tier = p.tier && FRAME[p.tier] ? p.tier : 'pro';
  const preReveal = !!p.preReveal;
  const players = (p.players || []).slice(0, 15).map(fill);
  const passNo = p.passNo != null && p.passNo !== '' ? `#${p.passNo}` : '';
  const idsLine = [
    p.teamNo != null && p.teamNo !== '' ? `TEAM #${p.teamNo}` : '',
    p.leagueNo != null && p.leagueNo !== '' ? `LEAGUE #${p.leagueNo}` : '',
  ].filter(Boolean).join(' · ');

  const [i400, i700, i900, i800i] = await Promise.all([
    loadFont('Inter-400.ttf'), loadFont('Inter-700.ttf'), loadFont('Inter-900.ttf'), loadFont('Inter-800i.ttf'),
  ]);
  const fonts: { name: string; data: ArrayBuffer; weight: 400 | 700 | 800 | 900; style: 'normal' | 'italic' }[] = [];
  if (i400) fonts.push({ name: 'Inter', data: i400, weight: 400, style: 'normal' });
  if (i700) fonts.push({ name: 'Inter', data: i700, weight: 700, style: 'normal' });
  if (i900) fonts.push({ name: 'Inter', data: i900, weight: 900, style: 'normal' });
  if (i800i) fonts.push({ name: 'Inter', data: i800i, weight: 800, style: 'italic' });

  const logoData = await readFile(path.join(process.cwd(), 'public/sbs-logo-white.png')).catch(() => null);
  const logoSrc = logoData ? `data:image/png;base64,${logoData.toString('base64')}` : undefined;

  // Per-card scale so each fills ~88% of the canvas height, centered.
  const cardH = preReveal ? 452 : 540;
  const S = (CANVAS_H * 0.88) / (cardH + 8);
  const px = (n: number) => Math.round(n * S);

  const card = preReveal ? renderPass(px, passNo, logoSrc, tier) : renderTeam(px, tier, players, logoSrc, idsLine);

  return new ImageResponse(
    (
      <div style={{ width: CANVAS_W, height: CANVAS_H, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter', background: 'linear-gradient(172deg,#0d0d12 0%,#08080b 70%,#060608 100%)' }}>
        {card}
      </div>
    ),
    { width: CANVAS_W, height: CANVAS_H, fonts: fonts.length ? fonts : undefined },
  );
}

type Px = (n: number) => number;

function frameWrap(px: Px, cardW: number, cardH: number, children: React.ReactNode, background: string) {
  return (
    <div style={{ display: 'flex', padding: px(4), borderRadius: px(28), background }}>
      <div style={{ width: px(cardW), height: px(cardH), borderRadius: px(23), position: 'relative', display: 'flex', overflow: 'hidden', background: 'linear-gradient(172deg,#17171e 0%,#0d0d12 58%,#070709 100%)' }}>
        {children}
      </div>
    </div>
  );
}

function renderTeam(px: Px, tier: Tier, players: ReturnType<typeof fill>[], logoSrc?: string, idsLine?: string) {
  const b = BADGE[tier];
  const groups = POS_ORDER
    .map((pos) => ({ pos, players: players.filter((p) => basePos(p.pos) === pos) }))
    .filter((g) => g.players.length > 0);
  const statCol = (v: React.ReactNode, head = false) => (
    <div style={{ display: 'flex', justifyContent: 'flex-end', width: px(34), fontSize: px(head ? 8 : 9.5), fontWeight: head ? 900 : 700, letterSpacing: head ? px(1) : 0, color: head ? 'rgba(255,255,255,.3)' : 'rgba(255,255,255,.82)' }}>{v}</div>
  );
  return frameWrap(px, 340, 540,
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', height: '100%', padding: `${px(14)}px ${px(16)}px ${px(14)}px` }}>
      {logoSrc ? <img src={logoSrc} width={px(26)} height={px(26)} style={{ objectFit: 'contain', opacity: 0.92 }} /> : null}
      <div style={{ marginTop: px(5), fontSize: px(12), fontWeight: 700, letterSpacing: px(0.6), color: 'rgba(255,255,255,.85)' }}>BANANA BEST BALL IV</div>
      {idsLine ? <div style={{ marginTop: px(4), fontSize: px(8.5), fontWeight: 700, letterSpacing: px(1.4), color: 'rgba(255,255,255,.42)' }}>{idsLine}</div> : null}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: px(7), padding: `${px(3)}px ${px(11)}px`, borderRadius: px(30), fontSize: px(11), fontWeight: 900, letterSpacing: px(1.5), color: b.text, background: b.bg, border: `1px solid ${b.line}` }}>
        {b.label}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', width: '100%', marginTop: px(12), paddingBottom: px(5), borderBottom: '1px solid rgba(255,255,255,.12)' }}>
        <div style={{ display: 'flex', flexGrow: 1 }} />
        {statCol('BYE', true)}{statCol('ADP', true)}{statCol('PICK', true)}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', flexGrow: 1, justifyContent: 'space-between', paddingTop: px(4) }}>
        {groups.map((g) => {
          const c = posColor(g.pos);
          return (
            <div key={g.pos} style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', fontSize: px(11), fontWeight: 900, letterSpacing: px(1), color: c, marginTop: px(3), marginBottom: px(1) }}>{g.pos}</div>
              {g.players.map((p, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', height: px(17) }}>
                  <div style={{ display: 'flex', width: px(2.5), height: px(12), borderRadius: px(2), background: c, marginRight: px(8) }} />
                  <div style={{ display: 'flex', fontSize: px(11.5), fontWeight: 700, color: '#fff' }}>{p.team}-{p.pos}</div>
                  <div style={{ display: 'flex', flexGrow: 1 }} />
                  {statCol(p.bye)}{statCol(p.adp)}{statCol(p.pick)}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: px(10), fontSize: px(10), fontWeight: 900, letterSpacing: px(0.6), color: 'rgba(255,255,255,.55)' }}>SBS</div>
    </div>,
    FRAME[tier],
  );
}

function renderPass(px: Px, passNo: string, logoSrc?: string, tier: Tier = 'pro') {
  // Pro passes keep the neutral grey shell (unchanged). A wheel-won HOF/Jackpot
  // pass gets its real tier frame (gold / red) + level badge so the prize reads
  // accurately before the draft reveals it into a team.
  const special = tier !== 'pro';
  const b = BADGE[tier];
  return (
    <div style={{ display: 'flex', position: 'relative' }}>
      {frameWrap(px, 320, 452,
        <>
          <div style={{ position: 'absolute', top: px(11), left: px(11), right: px(11), bottom: px(11), border: `2px dashed ${special ? b.line : 'rgba(255,255,255,.20)'}`, borderRadius: px(15) }} />
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', height: '100%', padding: `${px(32)}px ${px(24)}px ${px(26)}px` }}>
            {logoSrc ? <img src={logoSrc} width={px(42)} height={px(42)} style={{ objectFit: 'contain' }} /> : null}
            <div style={{ marginTop: px(16), fontSize: px(13.5), fontWeight: 900, letterSpacing: px(3.5), color: 'rgba(255,255,255,.9)' }}>{`DRAFT PASS ${passNo}`.trim()}</div>
            {special ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: px(8), padding: `${px(3)}px ${px(12)}px`, borderRadius: px(30), fontSize: px(11), fontWeight: 900, letterSpacing: px(1.5), color: b.text, background: b.bg, border: `1px solid ${b.line}` }}>
                {b.label}
              </div>
            ) : null}
            {/* These tier-framed passes only come from the wheel (buildTieredDraftPassUrl),
                so stamp the origin + that the draft is still filling, right on the art. */}
            {special ? (
              <div style={{ display: 'flex', marginTop: px(6), fontSize: px(8), fontWeight: 800, letterSpacing: px(1.6), color: 'rgba(255,255,255,.5)' }}>
                WHEEL PRIZE · DRAFT FILLING
              </div>
            ) : null}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: 'auto 0' }}>
              <div style={{ fontStyle: 'italic', fontWeight: 800, fontSize: px(30), lineHeight: 1.05, color: '#fbbf24', textAlign: 'center' }}>BANANA</div>
              <div style={{ fontStyle: 'italic', fontWeight: 800, fontSize: px(30), lineHeight: 1.05, color: '#fbbf24', textAlign: 'center' }}>BEST BALL</div>
              <div style={{ fontStyle: 'italic', fontWeight: 800, fontSize: px(38), lineHeight: 1, color: '#fbbf24', marginTop: px(3) }}>IV</div>
            </div>
            <div style={{ fontSize: px(11), fontWeight: 900, letterSpacing: px(2), color: 'rgba(255,255,255,.58)' }}>SBS</div>
          </div>
        </>,
        special ? FRAME[tier] : GREY_FRAME,
      )}
      <div style={{ position: 'absolute', top: '50%', left: px(-12), width: px(24), height: px(24), borderRadius: px(24), background: '#060608', transform: 'translateY(-50%)' }} />
      <div style={{ position: 'absolute', top: '50%', right: px(-12), width: px(24), height: px(24), borderRadius: px(24), background: '#060608', transform: 'translateY(-50%)' }} />
    </div>
  );
}
