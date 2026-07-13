'use client';

import React, { createContext, useCallback, useContext } from 'react';

export type ToastLevel = 'success' | 'error' | 'info' | 'warn';

export interface Toast {
  id: string;
  level: ToastLevel;
  message: string;
  requestId?: string;
  action?: { label: string; onClick: () => void };
}

interface ToastContextValue {
  show: (toast: Omit<Toast, 'id'>) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * Toasts are globally DISABLED site-wide (Boris, 2026-06-20: no toasts anywhere,
 * for anything). The bell / NotificationCenter carries every message that used to
 * toast — so nothing is lost, it's just delivered through the bell instead.
 *
 * This provider keeps the exact same context shape (`show`/`dismiss`) so every
 * existing `useToast().show(...)` call site across the app stays valid — they're
 * now harmless no-ops and nothing ever renders. If toasts are ever wanted back,
 * restore the rendering provider from git history.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const show = useCallback((toast: Omit<Toast, 'id'>) => { void toast; /* disabled */ }, []);
  const dismiss = useCallback((id: string) => { void id; /* disabled */ }, []);
  return (
    <ToastContext.Provider value={{ show, dismiss }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
