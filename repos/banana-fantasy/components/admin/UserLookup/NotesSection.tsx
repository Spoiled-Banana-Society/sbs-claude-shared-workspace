'use client';

/**
 * Shared admin notes for one wallet. Visible to ALL admins so the team
 * builds institutional memory on a user without scattering it across
 * Slack/DMs ("this user already tried fix X", "whale, escalate", etc.).
 */

import { useState } from 'react';
import {
  isSectionFail,
  useAddUserNote,
  useDeleteUserNote,
  type UserLookupNote,
} from '@/hooks/admin/useUserLookup';
import { WalletLink } from '@/components/admin/WalletLink';

function fmtAgo(v: string | null) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  const sec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

interface Props {
  wallet: string;
  notes: UserLookupNote[] | { ok: false; reason: string };
}

export function NotesSection({ wallet, notes }: Props) {
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState('');
  const add = useAddUserNote();
  const del = useDeleteUserNote();

  if (isSectionFail(notes)) {
    return (
      <Card>
        <Header />
        <p className="mt-2 text-sm text-red-300">
          Notes unavailable: {notes.reason}
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <Header
        count={notes.length}
        right={
          composing ? null : (
            <button
              type="button"
              onClick={() => setComposing(true)}
              className="rounded-md border border-gray-700 bg-gray-800 px-3 py-1 text-xs text-gray-200 transition-colors hover:border-[#F3E216]/50 hover:text-[#F3E216]"
            >
              + Add note
            </button>
          )
        }
      />

      {composing && (
        <form
          className="mt-3 space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const text = draft.trim();
            if (!text || add.isPending) return;
            try {
              await add.mutateAsync({ wallet, text });
              setDraft('');
              setComposing(false);
            } catch {
              /* mutation surfaces error via add.error below */
            }
          }}
        >
          <textarea
            autoFocus
            rows={2}
            maxLength={2000}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="e.g. Whale — escalate any support requests. Reach out via DM."
            className="w-full rounded-md border border-gray-700 bg-gray-950/60 px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-[#F3E216]/50"
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={!draft.trim() || add.isPending}
              className="rounded-md bg-[#F3E216] px-3 py-1 text-xs font-semibold text-black transition-opacity disabled:opacity-40"
            >
              {add.isPending ? 'Saving…' : 'Save note'}
            </button>
            <button
              type="button"
              onClick={() => {
                setComposing(false);
                setDraft('');
              }}
              className="text-xs text-gray-400 hover:text-gray-200"
            >
              Cancel
            </button>
            {add.error && (
              <span className="text-xs text-red-300">{add.error.message}</span>
            )}
          </div>
        </form>
      )}

      {notes.length === 0 ? (
        <p className="mt-2 text-sm text-gray-500">
          No notes yet. Add context that future-you (or Richard) will need.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {notes.map((n) => (
            <li
              key={n.id}
              className="rounded-md border border-gray-800 bg-gray-950/40 p-2.5 text-sm"
            >
              <div className="flex items-start gap-2">
                <p className="flex-1 whitespace-pre-wrap break-words text-gray-100">
                  {n.text}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm('Delete this note?')) {
                      del.mutate({ id: n.id, wallet });
                    }
                  }}
                  disabled={del.isPending}
                  className="text-xs text-gray-500 hover:text-red-300 disabled:opacity-40"
                  aria-label="Delete note"
                >
                  ×
                </button>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-gray-500">
                <WalletLink wallet={n.createdBy} bare className="!text-gray-400" />
                <span>·</span>
                <time
                  dateTime={n.createdAt ?? undefined}
                  title={n.createdAt ?? undefined}
                >
                  {fmtAgo(n.createdAt)}
                </time>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[#F3E216]/20 bg-[#F3E216]/[0.03] p-4">
      {children}
    </section>
  );
}

function Header({
  count,
  right,
}: {
  count?: number;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[#F3E216]/80">
        Notes {typeof count === 'number' && `(${count})`}
      </h3>
      {right}
    </div>
  );
}
