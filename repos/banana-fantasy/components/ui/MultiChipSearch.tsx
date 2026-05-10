'use client';

import { useState } from 'react';

interface MultiChipSearchProps {
  chips: string[];
  onChange: (chips: string[]) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
}

export function MultiChipSearch({
  chips,
  onChange,
  placeholder = 'Add filter…',
  className = '',
  inputClassName = '',
}: MultiChipSearchProps) {
  const [draft, setDraft] = useState('');

  const addChip = (raw: string) => {
    const trimmed = raw.trim().replace(/\s+/g, ' ');
    if (!trimmed) return;
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

  return (
    <div className={`flex items-center gap-1.5 flex-wrap bg-bg-secondary border border-bg-tertiary rounded-full pl-3 pr-2 py-1 focus-within:border-banana transition-colors ${className}`}>
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
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            addChip(draft);
          } else if (e.key === 'Backspace' && draft === '' && chips.length > 0) {
            removeChip(chips.length - 1);
          }
        }}
        onBlur={() => {
          if (draft.trim()) addChip(draft);
        }}
        placeholder={chips.length === 0 ? placeholder : ''}
        className={`flex-1 min-w-[80px] bg-transparent text-xs text-text-primary placeholder:text-text-muted focus:outline-none py-1 ${inputClassName}`}
      />
    </div>
  );
}
