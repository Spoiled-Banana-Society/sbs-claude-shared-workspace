'use client';

/**
 * Global search box in the admin top bar.
 *
 * Accepts wallet (40-hex), banana username, or email. Debounced; results
 * drop in a dropdown under the input. Clicking a result jumps straight
 * to User Lookup populated with that wallet.
 *
 * Pasting a raw 40-hex address skips the search and navigates immediately.
 *
 * Phase 3 addition (May 2026). The same shortcuts the existing UsersTable
 * search box provides — but available from anywhere in admin without
 * having to first navigate to the Users tab.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAdminUsers } from '@/hooks/admin/useAdminApi';

const ETH_ADDRESS_RE = /^0x?[a-fA-F0-9]{40}$/;

export function GlobalSearch({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounce the query value so we don't fire an API call on every keystroke.
  // 250ms is the sweet spot — slow enough to dedupe a fast typer, fast enough
  // that the dropdown still feels responsive.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  // Close the dropdown when clicking outside.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Keyboard shortcut: Cmd/Ctrl+K to focus the search box. Standard for
  // admin tools, and the muscle memory from VS Code / Linear carries over.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const isWalletPaste = useMemo(() => ETH_ADDRESS_RE.test(q.trim()), [q]);

  // Only hit the API when not a wallet paste (those route directly) and
  // when the user has typed at least 2 characters.
  const usersQ = useAdminUsers(
    enabled && open && !isWalletPaste && debouncedQ.length >= 2,
    0,
    10,
    debouncedQ,
  );

  const navigateToWallet = (wallet: string) => {
    const clean = wallet.startsWith('0x') ? wallet : `0x${wallet}`;
    router.push(`/admin?tab=user-lookup&wallet=${encodeURIComponent(clean.toLowerCase())}`);
    setOpen(false);
    setQ('');
    inputRef.current?.blur();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isWalletPaste) {
      navigateToWallet(q.trim());
      return;
    }
    // No wallet — fall back to the Users tab pre-filtered by the query
    if (debouncedQ) {
      router.push(`/admin?tab=users&q=${encodeURIComponent(debouncedQ)}`);
      setOpen(false);
      setQ('');
    }
  };

  const results = usersQ.data?.users ?? [];

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <form onSubmit={handleSubmit}>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm pointer-events-none">⌕</span>
          <input
            ref={inputRef}
            type="text"
            value={q}
            onChange={(e) => { setQ(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            placeholder="Search wallet, name, or email…"
            className="w-full pl-9 pr-16 py-1.5 rounded-md bg-white/[0.04] border border-white/[0.08] text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-banana/60 focus:bg-white/[0.06] transition-colors"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="hidden md:inline-flex absolute right-3 top-1/2 -translate-y-1/2 items-center px-1.5 h-5 rounded border border-white/10 bg-white/[0.04] text-[10px] text-gray-500 font-mono pointer-events-none">
            ⌘K
          </kbd>
        </div>
      </form>

      {open && q.trim().length >= 2 && (
        <div className="absolute z-50 left-0 right-0 mt-1 rounded-lg border border-white/[0.08] bg-[#15151a]/95 backdrop-blur shadow-2xl shadow-black/60 overflow-hidden">
          {isWalletPaste ? (
            <button
              type="button"
              onClick={() => navigateToWallet(q.trim())}
              className="w-full text-left px-4 py-3 hover:bg-white/[0.04] transition-colors"
            >
              <p className="text-[11px] text-gray-400 mb-0.5">Open wallet</p>
              <p className="font-mono text-xs text-banana truncate">{q.trim().toLowerCase()}</p>
            </button>
          ) : usersQ.isLoading ? (
            <p className="px-4 py-3 text-xs text-gray-500">Searching…</p>
          ) : results.length === 0 ? (
            <p className="px-4 py-3 text-xs text-gray-500">No matches for &ldquo;{debouncedQ}&rdquo;</p>
          ) : (
            <ul className="divide-y divide-white/[0.04] max-h-80 overflow-y-auto">
              {results.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => navigateToWallet(u.walletAddress)}
                    className="w-full text-left px-4 py-2.5 hover:bg-white/[0.04] transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-white truncate">
                          {u.displayName || u.username || <span className="text-gray-500 italic">no name</span>}
                        </p>
                        <p className="text-[11px] text-gray-500 font-mono truncate">{u.walletAddress}</p>
                      </div>
                      {u.email && (
                        <p className="text-[11px] text-gray-400 truncate max-w-[160px]">{u.email}</p>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
