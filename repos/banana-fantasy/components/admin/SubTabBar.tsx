'use client';

/**
 * Shared sub-tab navigator used inside consolidated tabs (Money, Drafts,
 * Audit). Reads/writes a `sub=` query param so a refresh keeps the user
 * on the same sub-view, and so external links (e.g. from User Lookup)
 * can deep-link straight into a specific sub-tab.
 *
 * Apple-clean: pill-shaped segmented control, soft hairline divider
 * underneath. No icons — labels do the work.
 */

import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';

export interface SubTabItem<K extends string = string> {
  key: K;
  label: string;
  /** Optional notification badge count. */
  badge?: number;
}

interface Props<K extends string = string> {
  items: SubTabItem<K>[];
  /** Currently active sub-tab key. */
  active: K;
  /** Called when the user picks a new sub. Also updates the URL `sub=` param. */
  onChange: (key: K) => void;
  /** Extra Tailwind classes for the outer container. */
  className?: string;
}

export function SubTabBar<K extends string = string>({
  items,
  active,
  onChange,
  className = '',
}: Props<K>) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleClick = (k: K) => {
    onChange(k);
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    params.set('sub', k);
    router.replace(`/admin?${params.toString()}`, { scroll: false });
  };

  return (
    <div className={`border-b border-white/[0.06] -mt-2 mb-5 ${className}`}>
      <div className="flex items-center gap-1 overflow-x-auto pb-[2px]">
        {items.map((item) => {
          const isActive = item.key === active;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => handleClick(item.key)}
              className={`shrink-0 inline-flex items-center gap-2 px-3 py-2 text-[13px] font-medium rounded-t-md border-b-2 transition-colors ${
                isActive
                  ? 'border-banana text-white'
                  : 'border-transparent text-gray-400 hover:text-white hover:border-white/20'
              }`}
            >
              <span>{item.label}</span>
              {!!item.badge && item.badge > 0 && (
                <span
                  className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full text-[10px] font-bold ${
                    isActive ? 'bg-banana text-black' : 'bg-white/[0.06] text-gray-300'
                  }`}
                >
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Convenience hook: reads the current `sub=` URL param, validated against
 * a known list of keys. Falls back to the first key when missing/invalid.
 */
export function useSubTab<K extends string>(validKeys: readonly K[], fallback: K): K {
  const searchParams = useSearchParams();
  return useMemo(() => {
    const v = searchParams?.get('sub') ?? null;
    if (v && (validKeys as readonly string[]).includes(v)) return v as K;
    return fallback;
  }, [searchParams, validKeys, fallback]);
}
