'use client';

/**
 * Debounced search input for User Lookup. Accepts a wallet (40-hex),
 * username, or email — paste a 40-hex address to skip search and go
 * straight to lookup; partial username/email drops a dropdown of
 * matches (reuses /api/admin/users?q= which already supports prefix
 * search on all three fields).
 */

import { useEffect, useRef, useState } from 'react';
import {
  useAdminUsers,
  type AdminUser,
} from '@/hooks/admin/useAdminApi';

const WALLET_REGEX = /^0x[0-9a-fA-F]{40}$/;

interface Props {
  value: string;
  onPick: (wallet: string) => void;
  onClear: () => void;
}

function shortHex(w: string) {
  if (!w) return '';
  const hex = w.replace(/^0x/i, '');
  return hex.length <= 10 ? `0x${hex}` : `0x${hex.slice(0, 6)}…${hex.slice(-4)}`;
}

export function UserSearchInput({ value, onPick, onClear }: Props) {
  // Initialize the input with the currently-selected wallet so it stays
  // visible after a paste. Before this, pasting a wallet detected it via
  // WALLET_REGEX → called onPick() → then cleared the input, so Boris
  // couldn't see what he'd just pasted.
  const [input, setInput] = useState(value || '');
  const [debounced, setDebounced] = useState('');
  const [openDropdown, setOpenDropdown] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Keep the input mirroring the externally-selected wallet — covers
  // cross-tab navigation (WalletLink click elsewhere → ?wallet= changes
  // → value prop changes) and the Clear button.
  useEffect(() => {
    setInput(value || '');
  }, [value]);

  // Direct wallet paste: skip search, fire immediately. Keep the wallet
  // visible in the input (don't clear it) so the admin can confirm what
  // they pasted. The parent panel will show the loaded user data below.
  useEffect(() => {
    const trimmed = input.trim();
    if (WALLET_REGEX.test(trimmed)) {
      const lower = trimmed.toLowerCase();
      if (lower !== value) onPick(lower);
      setOpenDropdown(false);
      return;
    }
    const t = setTimeout(() => setDebounced(trimmed), 300);
    return () => clearTimeout(t);
  }, [input, onPick, value]);

  // Close on outside click.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpenDropdown(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  // Only query when we have at least 2 chars (avoid spamming on first keystroke).
  const search = useAdminUsers(debounced.length >= 2, 0, 10, debounced);
  const results = search.data?.users ?? [];

  return (
    <div ref={wrapRef} className="relative">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[200px]">
          <input
            type="text"
            placeholder="Search by wallet, username, or email…"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setOpenDropdown(true);
            }}
            onFocus={() => setOpenDropdown(true)}
            className="w-full rounded-md border border-gray-700 bg-gray-950/60 px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-[#F3E216]/50"
          />
        </div>
        {value && (
          <div className="flex items-center gap-2">
            <span
              className="rounded-md bg-emerald-500/10 px-2 py-0.5 font-mono text-[11px] text-emerald-300 ring-1 ring-emerald-500/30"
              title={value}
            >
              loaded {shortHex(value)}
            </span>
            <button
              type="button"
              onClick={() => {
                setInput('');
                setDebounced('');
                onClear();
              }}
              className="rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-400 hover:text-gray-200"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {/* Results dropdown */}
      {openDropdown && debounced.length >= 2 && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-md border border-gray-700 bg-gray-950 shadow-lg">
          {search.isLoading ? (
            <p className="px-3 py-2 text-xs text-gray-500">Searching…</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-2 text-xs text-gray-500">
              No matches for &quot;{debounced}&quot;
            </p>
          ) : (
            <ul className="max-h-64 overflow-y-auto">
              {results.map((u: AdminUser) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick(u.walletAddress.toLowerCase());
                      setInput('');
                      setDebounced('');
                      setOpenDropdown(false);
                    }}
                    className="flex w-full items-baseline gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-gray-800"
                  >
                    <span className="font-medium text-white">
                      {u.username || u.email || 'Unnamed'}
                    </span>
                    {u.email && u.username && (
                      <span className="text-xs text-gray-400">{u.email}</span>
                    )}
                    <span className="ml-auto font-mono text-[11px] text-gray-500">
                      {shortHex(u.walletAddress)}
                    </span>
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
