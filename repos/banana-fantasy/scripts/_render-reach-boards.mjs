import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
const boards = JSON.parse(readFileSync('/private/tmp/claude-501/-Users-richardvagner/2bbb0781-fe9e-4803-845d-70ed57ca3f73/scratchpad/boards.json','utf8'));
const OUT = '/Users/richardvagner/Downloads/adp-reach-boards';
const POS = { QB:'#FF474C', RB:'#3c9120', WR:'#cb6ce6', TE:'#326cf8', DST:'#DF893E' };
const posOf = s => (s.match(/-(QB|RB|WR|TE|DST)/)||[])[1] || '';
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');

function boardHtml(b) {
  // columns = round-1 order
  const r1 = b.picks.filter(p => p.round === 1).sort((a,b)=>a.pick-b.pick);
  const cols = r1.map(p => p.owner);
  const colOf = {}; cols.forEach((o,i)=>colOf[o]=i);
  const grid = Array.from({length:15}, () => Array(10).fill(null));
  for (const p of b.picks) { const c = colOf[p.owner]; if (c == null) continue; grid[p.round-1][c] = p; }
  const flags = b.picks.filter(p => !p.bot && p.pick <= 110 && p.reach >= 40).sort((a,b)=>b.reach-a.reach);
  const steals = b.picks.filter(p => p.adp <= 120 && p.reach <= -25).sort((a,b)=>a.reach-b.reach);
  const flagCount = {}; for (const f of flags) flagCount[f.owner]=(flagCount[f.owner]||0)+1;
  const stealCount = {}; for (const f of steals) stealCount[f.owner]=(stealCount[f.owner]||0)+1;
  const head = cols.map((o,i) => { const u = r1[i]; return `<th><div class="seat">${i+1}</div><div class="user ${u.bot?'bot':''}">${esc(u.user)}${u.bot?' 🤖':''}</div><div class="tag">${flagCount[o]?`<span class="rf">${flagCount[o]} reach</span>`:''}${stealCount[o]?`<span class="sf">${stealCount[o]} fell</span>`:''}</div></th>`; }).join('');
  const rows = grid.map((row, r) => `<tr><td class="rn">${r+1}</td>` + row.map(p => {
    if (!p) return '<td class="cell empty"></td>';
    const pos = posOf(p.slot); const big = !p.bot && p.pick<=110 && p.reach>=40; const mid = !p.bot && p.pick<=110 && p.reach>=25 && p.reach<40; const steal = p.adp<=120 && p.reach<=-25;
    const cls = big?'big':mid?'mid':steal?'steal':'';
    const d = p.reach; const delta = d>=1?`+${d.toFixed(0)}`:d<=-1?`${d.toFixed(0)}`:'0';
    return `<td class="cell ${cls}" style="border-left:5px solid ${POS[pos]||'#888'}"><div class="name">${esc(p.player)}</div><div class="meta"><span>#${p.pick}</span><span>ADP ${p.adp.toFixed(0)}</span><span class="delta">${delta}</span></div></td>`;
  }).join('') + '</tr>').join('');
  const flagLine = flags.map(f => `<b>${esc(f.user)}</b> took ${esc(f.player)} at #${f.pick} (ADP ${f.adp.toFixed(0)}, ${f.reach.toFixed(0)} early)`).join(' &nbsp;·&nbsp; ');
  return `<section class="board">
  <h1>${esc(b.name)}${b.complete?'':' (still drafting)'} <span class="sub">${b.id}</span></h1>
  <div class="flags">${flagLine || 'no flagged reaches'}</div>
  <table><thead><tr><th class="rn"></th>${head}</tr></thead><tbody>${rows}</tbody></table>
  <div class="legend"><span class="sw big"></span>reach 40+ spots early (rounds 1–11) <span class="sw mid"></span>reach 25–39 <span class="sw steal"></span>fell 25+ spots past ADP &nbsp;|&nbsp; ADP = avg pick across the ~80 drafts nearest in time (undrafted = 151) &nbsp;|&nbsp; number = ADP − pick</div>
  </section>`;
}
const css = `
body{margin:0;background:#0b0b0f;color:#eee;font-family:-apple-system,Helvetica,Arial,sans-serif}
.board{width:1800px;padding:22px 26px;box-sizing:border-box;background:#0b0b0f;page-break-after:always}
h1{margin:0 0 6px;font-size:28px;color:#F3E216}.sub{font-size:14px;color:#777;font-weight:400;margin-left:10px}
.flags{font-size:15px;color:#ffb3b3;margin-bottom:12px;line-height:1.5}
table{border-collapse:separate;border-spacing:3px;width:100%;table-layout:fixed}
th{background:#16161d;padding:6px 4px;font-size:13px;vertical-align:top;border-radius:4px}
th .seat{color:#888;font-size:11px}th .user{font-weight:700;font-size:14px;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}th .user.bot{color:#888}
th .tag span{display:inline-block;margin:3px 2px 0;padding:1px 6px;border-radius:8px;font-size:11px}
.rf{background:#c0392b;color:#fff}.sf{background:#1e8449;color:#fff}
td.rn,th.rn{width:26px;color:#666;font-size:12px;text-align:center;background:transparent}
td.cell{background:#16161d;padding:5px 6px;border-radius:4px;height:52px;vertical-align:top}
td.empty{background:#0f0f14}
td .name{font-weight:700;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
td .meta{display:flex;justify-content:space-between;font-size:11px;color:#9a9a9a;margin-top:4px}
td .delta{font-weight:700;color:#bbb}
.sw.big,td.big{background:#7a1f1f;outline:2px solid #ff4d4d}td.big .meta,td.big .delta{color:#ffd6d6}
.sw.mid,td.mid{background:#4a3416;outline:1px solid #e0a030}td.mid .delta{color:#ffcc66}
.sw.steal,td.steal{background:#163b22;outline:1px solid #2ecc71}td.steal .delta{color:#7dffb0}
.legend{margin-top:10px;font-size:12px;color:#999}.sw{display:inline-block;width:14px;height:12px;border-radius:2px;margin:0 5px 0 12px;vertical-align:middle}
`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1800, height: 1200 }, deviceScaleFactor: 1 });
let i = 0;
for (const b of boards) {
  i++;
  const html = `<html><head><meta charset="utf-8"><style>${css}</style></head><body>${boardHtml(b)}</body></html>`;
  await page.setContent(html, { waitUntil: 'load' });
  const el = await page.$('.board');
  const fn = `${String(i).padStart(2,'0')}-${b.name.replace(/[^\w#]+/g,'-').replace(/#/g,'')}.png`;
  await el.screenshot({ path: `${OUT}/${fn}` });
}
// combined PDF (worst first)
const all = `<html><head><meta charset="utf-8"><style>${css}@page{size:1850px 1250px;margin:0}</style></head><body>${boards.map(boardHtml).join('')}</body></html>`;
await page.setContent(all, { waitUntil: 'load' });
await page.pdf({ path: '/Users/richardvagner/Downloads/adp-reach-boards-2026-08-17.pdf', width: '1850px', height: '1250px', printBackground: true, margin: { top: 0, bottom: 0, left: 0, right: 0 } });
await browser.close();
console.log('rendered', i, 'boards');
