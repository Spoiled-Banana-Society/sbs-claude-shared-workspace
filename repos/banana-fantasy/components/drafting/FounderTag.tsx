'use client';

// Presentational FOUNDER tag — celebratory cyan crown pill. No data fetching;
// callers decide whether to render it. Shared by FounderPill (self-fetching)
// and the drafts list row.
export function FounderTag({ size = 'sm', className = '' }: { size?: 'sm' | 'md'; className?: string }) {
  const md = size === 'md';
  const sizing = md ? 'text-[12px] px-2.5 py-1 gap-1.5' : 'text-[10px] px-2 py-0.5 gap-1';
  const crown = md ? 'w-3.5 h-3.5' : 'w-3 h-3';
  return (
    <span
      className={`glow-founder inline-flex items-center shrink-0 ${sizing} rounded-full font-black uppercase tracking-wider text-black ${className}`}
      style={{ background: 'linear-gradient(90deg, #67e8f9 0%, #06b6d4 100%)' }}
    >
      <svg className={`${crown} fill-black`} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 7l4 4 5-7 5 7 4-4-1.6 11H4.6L3 7zm1.8 13h14.4v1.6H4.8V20z" />
      </svg>
      Founder
    </span>
  );
}
