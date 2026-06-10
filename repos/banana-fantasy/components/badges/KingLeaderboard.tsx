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
import { BadgeIcon } from '@/components/badges/BadgeIcon';
import { BADGE_BY_ID } from '@/lib/badges/catalog';

interface Standing { wallet: string; name: string; pfp: string | null; count: number; rank: number }
interface LeaderboardData {
  finalizesAtIso: string;
  totalPlayers: number;
  top: Standing[];
  me: { rank: number | null; count: number; lifetime: number | null } | null;
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

export function KingLeaderboard({ demoData }: { demoData?: LeaderboardData } = {}) {
  const { user, walletAddress } = useAuth();
  const wallet = (walletAddress || user?.walletAddress || '').toLowerCase();
  const [live, setLive] = useState<LeaderboardData | null>(null);
  const [, setTick] = useState(0); // countdown re-render

  const refetch = useCallback(async () => {
    try {
      const q = wallet ? `?me=${encodeURIComponent(wallet)}` : '';
      const res = await fetch(`/api/badges/king-leaderboard${q}`);
      if (!res.ok) return;
      setLive(await res.json());
    } catch { /* keep last-known */ }
  }, [wallet]);

  useEffect(() => {
    if (demoData) return; // mockup mode — no fetching
    void refetch();
    const poll = setInterval(() => { void refetch(); }, 60_000);
    const tick = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [refetch, demoData]);

  // Live: any fill pings the stream → standings refresh within ~seconds.
  useStreamRefetch(demoData ? null : wallet || null, () => { void refetch(); });

  const data = demoData ?? live;
  if (!data) return null;

  const meInTop = !!(wallet && data.top.some((s) => s.wallet === wallet));
  const showMeRow = !!(data.me && data.me.rank !== null && !meInTop);

  return (
    <div
      className="rounded-2xl p-4 mb-6 backdrop-blur-md"
      style={{
        background: 'rgba(20, 20, 20, 0.7)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        boxShadow: '0 4px 24px rgba(0, 0, 0, 0.4)',
      }}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <BadgeIcon badge={BADGE_BY_ID['king-of-drafts']} size={28} unlocked showTooltip={false} />
          <h3 className="text-[15px] font-semibold text-white tracking-tight">King of Drafts</h3>
        </div>
        <span className="text-banana text-[12px] font-semibold tabular-nums">{timeLeftLabel(data.finalizesAtIso)}</span>
      </div>
      <p className="text-text-muted text-[11px] mb-3 leading-relaxed">
        Most paid drafts this week wins the crown for next week &middot; Mon 5&nbsp;AM &ndash; Sun 11&nbsp;PM&nbsp;PT <span className="text-white/25">(a draft counts once it fills)</span>
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
                className={`flex items-center gap-3 rounded-xl px-3 py-1.5 ${isMe ? 'bg-banana/10 border border-banana/30' : 'bg-white/[0.02]'}`}
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
                  {isMe && data.me?.lifetime != null && (
                    <span className="text-text-muted font-normal"> · {data.me.lifetime} all-time</span>
                  )}
                </span>
              </div>
            );
          })}

          {showMeRow && data.me && (
            <>
              <div className="h-px bg-white/[0.06] my-2" />
              <div className="flex items-center gap-3 rounded-xl px-3 py-2 bg-banana/10 border border-banana/30">
                <span className="w-7 text-[13px] font-bold tabular-nums text-banana">#{data.me.rank}</span>
                <span className="flex-1 text-[13px] text-banana font-semibold">
                  You <span className="text-text-muted font-normal">of {data.totalPlayers}</span>
                </span>
                <span className="text-[13px] font-semibold tabular-nums text-text-secondary">
                  {data.me.count} this week
                  {data.me.lifetime != null && (
                    <span className="text-text-muted font-normal"> · {data.me.lifetime} all-time</span>
                  )}
                </span>
              </div>
            </>
          )}

          {wallet && data.me && data.me.rank === null && (
            <p className="text-text-muted text-[11px] pt-2 text-center">
              Fill a paid draft to enter this week&apos;s race · {data.totalPlayers} competing
              {data.me.lifetime != null && data.me.lifetime > 0 ? ` · ${data.me.lifetime} paid drafts all-time` : ''}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
