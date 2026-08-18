'use client';

import React, { useEffect, useCallback } from 'react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Custom header (replaces the plain title bar). Receives nothing — render
   *  your own close button or rely on Escape / backdrop. */
  header?: React.ReactNode;
  /** Slide up as a bottom sheet on phones (rounded top, pinned to the bottom
   *  edge) instead of a centered dialog. Desktop is unchanged. */
  sheetOnMobile?: boolean;
}

const sizeStyles = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
};

export function Modal({ isOpen, onClose, children, title, size = 'md', header, sheetOnMobile = false }: ModalProps) {
  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, handleEscape]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop + Container */}
      <div
        className={`fixed inset-0 bg-black/70 backdrop-blur-sm animate-fade-in flex justify-center ${sheetOnMobile ? 'z-50 items-end sm:items-center p-0 sm:p-4' : 'z-40 items-center p-4'}`}
        onClick={onClose}
      >
        {/* Modal */}
        <div
          className={`
            bg-bg-secondary border border-bg-tertiary
            ${sheetOnMobile ? 'rounded-t-[22px] rounded-b-none sm:rounded-2xl' : 'rounded-2xl'}
            shadow-2xl w-full ${sizeStyles[size]}
            max-h-[92dvh] sm:max-h-[85vh] overflow-y-auto overscroll-contain scrollbar-hide
            animate-fade-in ${sheetOnMobile ? 'pb-[env(safe-area-inset-bottom)] sm:pb-0' : ''}
          `}
          onClick={(e) => e.stopPropagation()}
          // 92dvh (not vh) so mobile browser chrome doesn't eat the bottom of
          // the modal, and touch/momentum scrolling stays on — a long promo
          // modal was unscrollable on phones (Richard 2026-08-02).
          style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' }}
        >
        {/* Header */}
        {header ? header : title && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-bg-tertiary">
            <h2 className="text-xl font-semibold text-text-primary">{title}</h2>
            <button
              onClick={onClose}
              className="text-text-muted hover:text-text-primary transition-colors p-1"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}

        {/* Content */}
        <div className="p-6">{children}</div>
        </div>
      </div>
    </>
  );
}
