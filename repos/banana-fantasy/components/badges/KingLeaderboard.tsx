'use client';

/**
 * King of Drafts — LIVE weekly leaderboard (badges tab).
 *
 * Shows the current Mon–Sun race (closes Sunday 11pm PT, when the weekly cron
 * crowns the winner and moves the transient King badge). Counting = PAID
 * drafts that FILLED this week — identical to the crowning logic, so what
 * users watch here is exactly what decides the badge. Top 10 + the viewer's
 * own rank (pinned below when outside the top 10), live-updated: refetches on
 * the user-event stream ping (~seconds after any fill) with a 60s poll as
 * fallback.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useStreamRefetch } from '@/hooks/useStreamRefetch';

interface Standing { wallet: string; name: string; pfp: string | null; count: number; rank: number }
interface LeaderboardData {
  finalizesAtIso: string;
  totalPlayers: number;
  top: Standing[];
  me: { rank: number | null; count: number } | null;
}

function timeLeftLabel(finalizesAtIso: string): string {
  const ms = new Date(finalizesAtIso).getTime() - Date.now();
  if (ms <= 0) return 'finalizing…';
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (d > 0) return `${d}d ${h}h left`;
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m left`;
}

export function KingLeaderboard() {
  const { user, walletAddress } = useAuth();
  const wallet = (walletAddress || user?.walletAddress || '').toLowerCase();
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [, setTick] = useState(0); // countdown re-render

  const refetch = useCallback(async () => {
    try {
      const q = wallet ? `?me=${encodeURIComponent(wallet)}` : '';
      const res = await fetch(`/api/badges/king-leaderboard${q}`);
      if (!res.ok) return;
      setData(await res.json());
    } catch { /* keep last-known */ }
  }, [wallet]);

  useEffect(() => {
    void refetch();
    const poll = setInterval(() => { void refetch(); }, 60_000);
    const tick = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [refetch]);

  // Live: any fill pings the stream → standings refresh within ~seconds.
  useStreamRefetch(wallet || null, () => { void refetch(); });

  if (!data) return null;

  const meInTop = !!(wallet && data.top.some((s) => s.wallet === wallet));
  const showMeRow = !!(data.me && data.me.rank !== null && !meInTop);

  return (
    <div
      className="rounded-2xl p-5 mb-6 backdrop-blur-md"
      style={{
        background: 'rgba(20, 20, 20, 0.7)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        boxShadow: '0 4px 24px rgba(0, 0, 0, 0.4)',
      }}
    >
      <div className="flex items-baseline justify-between mb-1">
        <h3 className="text-[16px] font-semibold text-white tracking-tight">King of Drafts</h3>
        <span className="text-banana text-[12px] font-semibold tabular-nums">{timeLeftLabel(data.finalizesAtIso)}</span>
      </div>
      <p className="text-text-muted text-[11px] mb-4">
        Most paid drafts filled this week takes the crown · finalizes Sunday 11 PM PT
      </p>

      {data.top.length === 0 ? (
        <p className="text-text-secondary text-[13px] py-3 text-center">
          No paid drafts filled yet this week — the first fill takes the lead.
        </p>
      ) : (
        <div className="space-y-1">
          {data.top.map((s) => {
            const isMe = wallet && s.wallet === wallet;
            return (
              <div
                key={s.wallet}
                className={`flex items-center gap-3 rounded-xl px-3 py-2 ${isMe ? 'bg-banana/10 border border-banana/30' : 'bg-white/[0.02]'}`}
              >
                <span className={`w-7 text-[13px] font-bold tabular-nums ${s.rank === 1 ? 'text-banana' : 'text-text-muted'}`}>
                  {s.rank === 1 ? '👑' : `#${s.rank}`}
                </span>
                {s.pfp ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.pfp} alt="" className="w-7 h-7 rounded-full object-cover flex-none" />
                ) : (
                  <span className="w-7 h-7 rounded-full bg-[#2a2a35] flex items-center justify-center text-[13px] flex-none">🍌</span>
                )}
                <span className={`flex-1 truncate text-[13px] ${isMe ? 'text-banana font-semibold' : 'text-white'}`}>
                  {s.name}{isMe ? ' (you)' : ''}
                </span>
                <span className="text-[13px] font-semibold tabular-nums text-text-secondary">
                  {s.count} {s.count === 1 ? 'draft' : 'drafts'}
                </span>
              </div>
            );
          })}

          {showMeRow && data.me && (
            <>
              <div className="h-px bg-white/[0.06] my-2" />
              <div className="flex items-center gap-3 rounded-xl px-3 py-2 bg-banana/10 border border-banana/30">
                <span className="w-7 text-[13px] font-bold tabular-nums text-banana">#{data.me.rank}</span>
                <span className="flex-1 text-[13px] text-banana font-semibold">You</span>
                <span className="text-[13px] font-semibold tabular-nums text-text-secondary">
                  {data.me.count} {data.me.count === 1 ? 'draft' : 'drafts'}
                </span>
              </div>
            </>
          )}

          {wallet && data.me && data.me.rank === null && (
            <p className="text-text-muted text-[11px] pt-2 text-center">
              Fill a paid draft to enter this week&apos;s race · {data.totalPlayers} competing
            </p>
          )}
        </div>
      )}
    </div>
  );
}
