'use client';

import { POSITION_COLORS, DRAFT_TYPES, TOTAL_ROUNDS } from '@/lib/draftRoomConstants';

// Renders the full draft board (10 columns × 15 rounds) to an offscreen
// canvas and returns a PNG blob. Hand-drawn rather than DOM-rasterized
// (no html2canvas dependency, no cross-origin avatar tainting) — the same
// approach as generateRosterImage on the draft-results page. Works
// mid-draft too: unpicked slots render as faint placeholders, so a
// half-finished board reads as "draft in progress" rather than broken.

export interface BoardImageCell {
  pickNum: number;
  round: number; // 1-indexed
  playerId: string; // '' = not yet picked
  position: string; // 'QB' | 'WR1' | ... (tier digits ok)
  ownerIndex: number; // 0-indexed draft-order column
}

export interface BoardImageOptions {
  cells: BoardImageCell[];
  /** 10 display names in draft order (column headers). */
  ownerNames: string[];
  /** 0-indexed column to highlight as the viewer's own; -1 = none. */
  userDraftPosition?: number;
  /** Numeric league id, e.g. "343" → titled "League #343". */
  leagueNumber?: string;
  /** 'jackpot' | 'hof' | 'pro' | 'jackhof' — colors the subtitle. */
  draftType?: string | null;
  totalRounds?: number;
}

const COLS = 10;
const CELL_W = 148;
const CELL_H = 76;
const GAP = 10;
const MARGIN = 48;
const ROUND_GUTTER = 44;
const HEADER_H = 214; // logo + title + column names
const FOOTER_H = 64;

const FONT = "'Montserrat', system-ui, sans-serif";

function positionColorHex(pos: string): string {
  const base = (pos || '').replace(/[0-9]/g, '');
  return POSITION_COLORS[base] || '#888888';
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

export function generateBoardImage(opts: BoardImageOptions): Promise<Blob | null> {
  const {
    cells,
    ownerNames,
    userDraftPosition = -1,
    leagueNumber = '',
    draftType = null,
    totalRounds = TOTAL_ROUNDS,
  } = opts;

  return new Promise((resolve) => {
    const logo = new Image();
    logo.crossOrigin = 'anonymous';
    logo.src = '/sbs-logo.png';

    const render = async () => {
      // Best effort: have the brand font ready so the canvas matches the
      // on-screen board. Falls back to system-ui if unavailable.
      try {
        await document.fonts.load(`bold 24px ${FONT}`);
      } catch { /* draw with fallback font */ }

      const gridW = COLS * CELL_W + (COLS - 1) * GAP;
      const gridH = totalRounds * CELL_H + (totalRounds - 1) * GAP;
      const W = MARGIN + ROUND_GUTTER + gridW + MARGIN;
      const H = HEADER_H + gridH + FOOTER_H;
      const gridX = MARGIN + ROUND_GUTTER;
      const gridY = HEADER_H;

      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(null); return; }

      // Background
      ctx.fillStyle = '#0a0a0f';
      ctx.fillRect(0, 0, W, H);

      // Logo + SBS wordmark, centered
      const logoH = 52;
      if (logo.complete && logo.naturalWidth > 0) {
        const logoW = (logo.naturalWidth / logo.naturalHeight) * logoH;
        ctx.font = `bold 34px ${FONT}`;
        const textW = ctx.measureText('SBS').width;
        const totalW = logoW + 14 + textW;
        const startX = (W - totalW) / 2;
        ctx.drawImage(logo, startX, 38, logoW, logoH);
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'left';
        ctx.fillText('SBS', startX + logoW + 14, 38 + logoH / 2 + 12);
      } else {
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold 34px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText('SBS', W / 2, 74);
      }

      // "League #N · TYPE" subtitle
      const typeInfo = draftType ? DRAFT_TYPES[draftType as keyof typeof DRAFT_TYPES] : null;
      const parts: Array<{ text: string; color: string }> = [
        { text: leagueNumber ? `League #${leagueNumber}` : 'Draft Board', color: '#ffffff' },
      ];
      if (typeInfo) {
        parts.push({ text: '  ·  ', color: 'rgba(255,255,255,0.3)' });
        parts.push({ text: typeInfo.label, color: typeInfo.color });
      }
      ctx.font = `bold 24px ${FONT}`;
      const subW = parts.reduce((w, p) => w + ctx.measureText(p.text).width, 0);
      let sx = (W - subW) / 2;
      ctx.textAlign = 'left';
      for (const p of parts) {
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, sx, 134);
        sx += ctx.measureText(p.text).width;
      }

      // Column headers (owner names)
      ctx.font = `bold 19px ${FONT}`;
      ctx.textAlign = 'center';
      for (let c = 0; c < COLS; c++) {
        const cx = gridX + c * (CELL_W + GAP) + CELL_W / 2;
        ctx.fillStyle = c === userDraftPosition ? '#F3E216' : '#ffffff';
        ctx.fillText(ellipsize(ctx, ownerNames[c] || `Team ${c + 1}`, CELL_W - 8), cx, gridY - 18);
      }

      // Round labels down the left gutter
      ctx.font = `bold 16px ${FONT}`;
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      for (let r = 0; r < totalRounds; r++) {
        const cy = gridY + r * (CELL_H + GAP) + CELL_H / 2 + 6;
        ctx.fillText(`R${r + 1}`, gridX - 14, cy);
      }

      // Empty slots first, then picked cells on top
      const byKey = new Map<string, BoardImageCell>();
      for (const cell of cells) {
        if (cell.ownerIndex < 0 || cell.ownerIndex >= COLS) continue;
        if (cell.round < 1 || cell.round > totalRounds) continue;
        byKey.set(`${cell.round}:${cell.ownerIndex}`, cell);
      }

      for (let r = 0; r < totalRounds; r++) {
        for (let c = 0; c < COLS; c++) {
          const x = gridX + c * (CELL_W + GAP);
          const y = gridY + r * (CELL_H + GAP);
          const cell = byKey.get(`${r + 1}:${c}`);
          const picked = !!cell && cell.playerId !== '';

          if (!picked) {
            ctx.fillStyle = '#1b1b22';
            roundRectPath(ctx, x, y, CELL_W, CELL_H, 8);
            ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.14)';
            ctx.font = `bold 14px ${FONT}`;
            ctx.textAlign = 'left';
            if (cell) ctx.fillText(`R${cell.round} P${cell.pickNum}`, x + 12, y + CELL_H - 12);
            continue;
          }

          const color = positionColorHex(cell.position || cell.playerId.split('-')[1] || '');
          ctx.fillStyle = color;
          roundRectPath(ctx, x, y, CELL_W, CELL_H, 8);
          ctx.fill();

          // Viewer's own picks get the brand-yellow border, same as on-screen
          if (c === userDraftPosition) {
            ctx.strokeStyle = '#F3E216';
            ctx.lineWidth = 3;
            roundRectPath(ctx, x + 1.5, y + 1.5, CELL_W - 3, CELL_H - 3, 7);
            ctx.stroke();
          }

          ctx.fillStyle = '#000000';
          ctx.textAlign = 'left';
          let f = 24;
          ctx.font = `bold ${f}px ${FONT}`;
          while (f > 15 && ctx.measureText(cell.playerId).width > CELL_W - 20) {
            f -= 1;
            ctx.font = `bold ${f}px ${FONT}`;
          }
          ctx.fillText(cell.playerId, x + 12, y + 32);

          ctx.fillStyle = 'rgba(0,0,0,0.72)';
          ctx.font = `bold 14px ${FONT}`;
          ctx.fillText(`R${cell.round} P${cell.pickNum}`, x + 12, y + CELL_H - 12);
        }
      }

      // Footer
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.font = `18px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('sbsfantasy.com', W / 2, H - 26);

      canvas.toBlob((blob) => resolve(blob), 'image/png');
    };

    if (logo.complete) {
      void render();
    } else {
      logo.onload = () => void render();
      logo.onerror = () => void render(); // render without logo if it fails
    }
  });
}
