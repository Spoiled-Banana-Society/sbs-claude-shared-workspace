'use client';

import { useRef, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';

const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;
const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,20}$/;
const looksLookupable = (s: string) => WALLET_RE.test(s) || USERNAME_RE.test(s);

interface UserHit {
  username: string;
  wallet: string;
  profilePicture: string | null;
  bananaNumber: number | null;
}

/**
 * People lookup with username type-ahead. Suggestions are fetched in a
 * debounced CHANGE handler (never a useEffect) so there's no render-loop /
 * self-DDoS risk. Selecting a suggestion (or pressing Enter on a valid
 * username/wallet) navigates to /u/[id].
 */
export function UserSearchBox({ className = '', autoFocus = false }: { className?: string; autoFocus?: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<UserHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqIdRef = useRef(0);
  const blurRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const go = (idOrWallet: string) => {
    const v = idOrWallet.trim();
    if (!v) return;
    router.push(`/u/${encodeURIComponent(WALLET_RE.test(v) ? v.toLowerCase() : v)}`);
  };

  const fetchSuggestions = (raw: string) => {
    const term = raw.trim();
    // Wallets and too-short terms get no suggestions.
    if (term.length < 1 || /^0x/i.test(term)) { setHits([]); setOpen(false); return; }
    const id = ++reqIdRef.current;
    fetch(`/api/marketplace/search-users?q=${encodeURIComponent(term)}`)
      .then((r) => (r.ok ? r.json() : { users: [] }))
      .then((d: { users?: UserHit[] }) => {
        if (id !== reqIdRef.current) return; // a newer keystroke superseded this
        const users = Array.isArray(d.users) ? d.users : [];
        setHits(users);
        setOpen(users.length > 0);
        setActive(-1);
      })
      .catch(() => { if (id === reqIdRef.current) { setHits([]); setOpen(false); } });
  };

  const onChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(value), 180);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (open && hits.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % hits.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i <= 0 ? hits.length - 1 : i - 1)); return; }
      if (e.key === 'Enter' && active >= 0) { e.preventDefault(); go(hits[active].username); return; }
    }
    if (e.key === 'Enter') { if (looksLookupable(query.trim())) go(query); }
    if (e.key === 'Escape') { setOpen(false); }
  };

  return (
    <div className={`relative ${className}`}>
      <div className="flex items-center gap-2">
        <input
          value={query}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => { if (hits.length > 0) setOpen(true); }}
          onBlur={() => { blurRef.current = setTimeout(() => setOpen(false), 120); }}
          placeholder="Username or wallet"
          className="w-full rounded-full bg-black/30 border border-white/[0.10] focus:border-banana/50 px-4 py-2.5 text-sm text-text-primary outline-none transition-colors"
        />
        <button
          onClick={() => { if (looksLookupable(query.trim())) go(query); }}
          disabled={!looksLookupable(query.trim())}
          className="px-5 py-2.5 rounded-full bg-banana hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed text-black font-semibold text-sm transition-all shrink-0"
        >
          View
        </button>
      </div>

      {open && hits.length > 0 && (
        <div className="absolute z-20 mt-2 w-[calc(100%-5.5rem)] max-w-md rounded-2xl border border-bg-tertiary bg-bg-secondary shadow-xl overflow-hidden">
          {hits.map((u, i) => (
            <button
              key={u.wallet}
              // onMouseDown (not onClick) so it fires before the input's blur.
              onMouseDown={(e) => { e.preventDefault(); if (blurRef.current) clearTimeout(blurRef.current); go(u.username); }}
              onMouseEnter={() => setActive(i)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${active === i ? 'bg-bg-tertiary/70' : 'hover:bg-bg-tertiary/50'}`}
            >
              {u.profilePicture ? (
                <Image src={u.profilePicture} alt="" width={28} height={28} className="rounded-full object-cover w-7 h-7" />
              ) : (
                <span className="w-7 h-7 rounded-full bg-bg-tertiary flex items-center justify-center text-sm">🍌</span>
              )}
              <span className="text-sm font-medium text-text-primary truncate">{u.username}</span>
              {u.bananaNumber != null && <span className="ml-auto text-[10px] font-mono text-text-muted">#{u.bananaNumber}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
