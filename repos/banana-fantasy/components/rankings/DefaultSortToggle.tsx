'use client';

import React from 'react';
import { useAutoPickSortPreference, type SortPreference } from '@/hooks/useAutoPickSortPreference';

interface DefaultSortToggleProps {
  /** Controlled mode — when provided, the parent owns the preference so it
   *  stays in sync with edits made elsewhere on the page (e.g. customizing
   *  rankings flips this to 'rank' automatically). Omit for standalone use. */
  preference?: SortPreference;
  loaded?: boolean;
  saving?: boolean;
  onChange?: (pref: SortPreference) => void;
}

/**
 * Toggle for the user's default auto-pick sort order.
 * - 'adp'  → new drafts open with ADP order (current default behavior)
 * - 'rank' → new drafts open using the user's own rankings
 *
 * The user can still flip ADP/Rank within a draft; this only sets the
 * initial value when joining a new draft.
 */
export function DefaultSortToggle(props: DefaultSortToggleProps = {}) {
  const own = useAutoPickSortPreference();
  const controlled = props.onChange !== undefined;
  const preference = controlled ? (props.preference ?? 'adp') : own.preference;
  const loaded = controlled ? (props.loaded ?? true) : own.loaded;
  const saving = controlled ? (props.saving ?? false) : own.saving;
  const setPreference = controlled ? props.onChange! : own.setPreference;

  return (
    <div className="mb-6 rounded-xl border border-white/10 bg-bg-secondary px-4 py-3">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-text-primary font-semibold">Default sort when joining drafts</span>
          <span className="text-xs text-text-muted">
            Pick which order the auto-drafter uses by default. You can still toggle ADP / Rank inside any draft.
          </span>
        </div>
        <div className="inline-flex rounded-lg border border-white/10 bg-bg-tertiary p-0.5" role="group">
          <button
            type="button"
            disabled={!loaded || saving}
            onClick={() => setPreference('adp')}
            aria-pressed={preference === 'adp'}
            className={`px-3 py-1.5 text-xs font-bold rounded transition-colors disabled:opacity-50 ${
              preference === 'adp'
                ? 'bg-banana text-black'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            ADP
          </button>
          <button
            type="button"
            disabled={!loaded || saving}
            onClick={() => setPreference('rank')}
            aria-pressed={preference === 'rank'}
            className={`px-3 py-1.5 text-xs font-bold rounded transition-colors disabled:opacity-50 ${
              preference === 'rank'
                ? 'bg-banana text-black'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            My Rankings
          </button>
        </div>
      </div>
    </div>
  );
}
