'use client';

import { useState, useRef, useMemo, useEffect } from 'react';

interface MultiChipSearchProps {
  chips: string[];
  onChange: (chips: string[]) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  /** When provided, restricts inputs to a closed list (autocomplete). */
  options?: string[];
  /** Max suggestions shown in dropdown. Default 8. */
  maxSuggestions?: number;
}

export function MultiChipSearch({
  chips,
  onChange,
  placeholder = 'Add filter…',
  className = '',
  inputClassName = '',
  options,
  maxSuggestions = 8,
}: MultiChipSearchProps) {
  const [draft, setDraft] = useState('');
  const [highlightedIdx, setHighlightedIdx] = useState(0);
  const [focused, setFocused] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const normalizedDraft = draft.trim().toUpperCase().replace(/\s+/g, ' ');

  // Filter options by substring match (whitespace-insensitive). Excludes
  // already-selected chips. Only used when options is provided.
  const suggestions = useMemo(() => {
    if (!options || normalizedDraft === '') return [] as string[];
    const compact = (s: string) => s.toUpperCase().replace(/\s+/g, '');
    const q = compact(normalizedDraft);
    const selectedCompact = new Set(chips.map(compact));
    return options
      .filter(opt => !selectedCompact.has(compact(opt)) && compact(opt).includes(q))
      .slice(0, maxSuggestions);
  }, [options, normalizedDraft, chips, maxSuggestions]);

  // Reset highlight when suggestions change
  useEffect(() => {
    setHighlightedIdx(0);
  }, [normalizedDraft, suggestions.length]);

  const addChip = (raw: string) => {
    const trimmed = raw.trim().replace(/\s+/g, ' ');
    if (!trimmed) return;
    if (options) {
      // Strict mode: only accept exact (case + whitespace insensitive) option matches.
      const compact = (s: string) => s.toUpperCase().replace(/\s+/g, '');
      const target = compact(trimmed);
      const match = options.find(o => compact(o) === target);
      if (!match) return;
      if (chips.some(c => compact(c) === compact(match))) {
        setDraft('');
        return;
      }
      onChange([...chips, match]);
      setDraft('');
      return;
    }
    if (chips.some(c => c.toLowerCase() === trimmed.toLowerCase())) {
      setDraft('');
      return;
    }
    onChange([...chips, trimmed]);
    setDraft('');
  };

  const removeChip = (idx: number) => {
    onChange(chips.filter((_, i) => i !== idx));
  };

  const showDropdown = focused && options !== undefined && suggestions.length > 0;
  const hasDraft = draft.trim().length > 0;

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <div className="flex items-center gap-1.5 flex-wrap bg-bg-secondary border border-bg-tertiary rounded-xl pl-3 pr-1.5 py-1.5 focus-within:border-banana transition-colors">
        <svg className="w-3.5 h-3.5 text-text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        {chips.map((chip, idx) => (
          <span
            key={`${chip}-${idx}`}
            className="flex items-center gap-1.5 bg-banana/15 text-banana px-2.5 py-0.5 rounded-full text-xs font-medium"
          >
            <span className="uppercase tracking-wide">{chip}</span>
            <button
              type="button"
              onClick={() => removeChip(idx)}
              className="hover:opacity-70 -mr-0.5"
              aria-label={`Remove ${chip}`}
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </span>
        ))}
        <input
          type="text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            // Delay so dropdown clicks register first
            setTimeout(() => setFocused(false), 150);
          }}
          onKeyDown={e => {
            if (showDropdown) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHighlightedIdx(i => Math.min(i + 1, suggestions.length - 1));
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHighlightedIdx(i => Math.max(i - 1, 0));
                return;
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                const pick = suggestions[highlightedIdx];
                if (pick) addChip(pick);
                return;
              }
              if (e.key === 'Escape') {
                setDraft('');
                return;
              }
            }
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              addChip(draft);
            } else if (e.key === 'Backspace' && draft === '' && chips.length > 0) {
              removeChip(chips.length - 1);
            }
          }}
          placeholder={chips.length === 0 ? placeholder : 'Add another…'}
          className={`flex-1 min-w-[80px] bg-transparent text-xs text-text-primary placeholder:text-text-muted focus:outline-none py-1 uppercase tracking-wide ${inputClassName}`}
        />
        {hasDraft && (!options || suggestions.length > 0) ? (
          <button
            type="button"
            onMouseDown={e => {
              e.preventDefault();
              const pick = options ? suggestions[highlightedIdx] : draft;
              if (pick) addChip(pick);
            }}
            className="flex items-center gap-1 bg-banana text-black px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider hover:brightness-110 transition-all shrink-0"
            aria-label="Add filter"
            title="Add filter (Enter)"
          >
            Add
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>
        ) : chips.length === 0 ? (
          <span className="text-text-muted text-[10px] uppercase tracking-wider px-1.5 shrink-0 hidden sm:inline">↵ to add</span>
        ) : null}
      </div>

      {showDropdown && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-bg-secondary border border-bg-tertiary rounded-xl shadow-2xl overflow-hidden">
          {suggestions.map((opt, idx) => (
            <button
              key={opt}
              type="button"
              onMouseDown={e => {
                e.preventDefault();
                addChip(opt);
              }}
              onMouseEnter={() => setHighlightedIdx(idx)}
              className={`w-full text-left px-3 py-2 text-xs uppercase tracking-wide transition-colors ${
                idx === highlightedIdx ? 'bg-banana/15 text-banana' : 'text-text-secondary hover:bg-white/[0.04]'
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
      {focused && options !== undefined && hasDraft && suggestions.length === 0 && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-bg-secondary border border-bg-tertiary rounded-xl px-3 py-2 text-[11px] text-text-muted">
          No matches. Try a team or slot name (e.g. <span className="text-text-secondary font-mono">IND RB</span>).
        </div>
      )}
    </div>
  );
}
