'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { useInstallPrompt } from '@/hooks/useInstallPrompt';

const DISMISS_KEY = 'sbs-a2hs-dismissed';
const ENGAGED_KEY = 'sbs-a2hs-engaged'; // They saw the install steps

function isDismissed(): boolean {
  if (typeof window === 'undefined') return true;
  // If they've engaged with the modal (saw install steps), don't show card again
  // They can still find it in profile dropdown
  if (localStorage.getItem(ENGAGED_KEY) === '1') return true;
  const ts = localStorage.getItem(DISMISS_KEY);
  if (!ts) return false;
  return (Date.now() - Number(ts)) / (1000 * 60 * 60 * 24) < 7;
}

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isIOSSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent.toLowerCase();
  return /iphone|ipad|ipod/.test(ua) && /safari/.test(ua) && !/chrome|crios|fxios/.test(ua);
}

// ── Install Steps Modal ─────────────────────────────────────────────────

export function InstallModal({ onClose, browser, promoBanner }: { onClose: () => void; browser: 'safari' | 'chrome'; promoBanner?: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-[340px] bg-[#111118] border border-white/[0.08] rounded-2xl overflow-hidden animate-modal-sheet"
        onClick={e => e.stopPropagation()}
      >
        {/* Promo Banner */}
        {promoBanner}

        {/* Header */}
        <div className="px-5 pt-5 pb-1 text-center">
          <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-black border border-white/10 flex items-center justify-center">
            <Image src="/icons/icon-192.png" alt="SBS" width={44} height={44} className="rounded-xl" />
          </div>
          <h3 className="text-white font-bold text-lg">Install SBS</h3>
          <p className="text-white/40 text-xs mt-1">
            {browser === 'safari' ? '3 simple steps' : 'Open in Safari first'}
          </p>
        </div>

        {/* Steps */}
        <div className="px-5 py-4">
          {browser === 'chrome' ? (
            /* Chrome on iOS — show Safari requirement + same 5 steps */
            <div>
              {/* Safari required banner */}
              <div className="mb-4 p-3 rounded-xl bg-blue-500/10 border border-blue-500/20">
                <div className="flex items-center gap-2 mb-2">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
                  </svg>
                  <p className="text-white font-medium text-xs">Must be done in Safari</p>
                </div>
                <p className="text-white/40 text-[11px] mb-2">Open this page in Safari, then follow the 5 steps below.</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(window.location.origin).catch(() => {});
                      window.location.href = `x-safari-${window.location.href}`;
                    }}
                    className="flex-1 py-2 bg-blue-500 text-white text-xs font-bold rounded-lg"
                  >
                    Open Safari
                  </button>
                  <CopyLinkButton />
                </div>
              </div>

              {/* Same 4 steps as Safari */}
              <p className="text-white/25 text-[10px] uppercase tracking-wider mb-3">Then in Safari:</p>
              <div className="space-y-3.5">
                <Step
                  num={1}
                  icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="5" cy="12" r="1.5" fill="#fbbf24" /><circle cx="12" cy="12" r="1.5" fill="#fbbf24" /><circle cx="19" cy="12" r="1.5" fill="#fbbf24" /></svg>}
                  title={<>Tap the <span className="text-banana">three dots</span> next to the URL</>}
                  desc="Bottom-right of your browser"
                />
                <Step
                  num={2}
                  icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" /><polyline points="16 6 12 2 8 6" /><line x1="12" y1="2" x2="12" y2="15" /></svg>}
                  title={<>Tap <span className="text-banana">Share</span></>}
                  desc=""
                />
                <Step
                  num={3}
                  icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>}
                  title={<>Scroll down &amp; tap <span className="text-banana">Add to Home Screen</span></>}
                  desc="Don&apos;t see it? Tap More first"
                />
              </div>
            </div>
          ) : (
            /* Safari — 4 step install flow */
            <div className="space-y-3.5">
              <Step
                num={1}
                icon={
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="5" cy="12" r="1.5" fill="#fbbf24" />
                    <circle cx="12" cy="12" r="1.5" fill="#fbbf24" />
                    <circle cx="19" cy="12" r="1.5" fill="#fbbf24" />
                  </svg>
                }
                title={<>Tap the <span className="text-banana">three dots</span> — bottom right</>}
                desc=""
              />
              <Step
                num={2}
                icon={
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
                    <polyline points="16 6 12 2 8 6" />
                    <line x1="12" y1="2" x2="12" y2="15" />
                  </svg>
                }
                title={<>Tap <span className="text-banana">Share</span></>}
                desc=""
              />
              <Step
                num={3}
                icon={
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                }
                title={<>Scroll down &amp; tap <span className="text-banana">Add to Home Screen</span></>}
                desc="Don&apos;t see it? Tap More first"
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5">
          <button
            onClick={onClose}
            className="w-full py-3 bg-banana text-black font-bold rounded-xl text-sm"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

function Step({ num, icon, title, desc }: { num: number; icon: React.ReactNode; title: React.ReactNode; desc: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center flex-shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-white font-medium text-[13px] leading-tight">
          <span className="text-banana/60 font-bold mr-1">{num}.</span>
          {title}
        </p>
        {desc && <p className="text-white/30 text-[11px] mt-0.5">{desc}</p>}
      </div>
    </div>
  );
}

function CopyLinkButton() {
  const [copied, setCopied] = useState(false);
  const url = typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(url).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
      className="flex-1 py-2 bg-white/[0.06] text-white/50 font-medium rounded-lg text-xs flex items-center justify-center gap-1.5"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
      {copied ? 'Copied!' : 'Copy Link'}
    </button>
  );
}

// ── Main Card ───────────────────────────────────────────────────────────

export function AddToHomeScreenCard() {
  const { canInstall: _canInstall, isStandalone, triggerInstall } = useInstallPrompt();
  const [show, setShow] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [modalBrowser, setModalBrowser] = useState<'safari' | 'chrome' | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const isMobile = /iphone|ipad|ipod|android/i.test(navigator.userAgent);
    setIsDesktop(!isMobile);
    // Show on EVERY device (desktop too) so desktop users learn the app exists
    // and how to install it on their phone. Hidden once installed (standalone)
    // or after they engage with the steps.
    if (!isStandalone && !isDismissed()) {
      setShow(true);
    }
  }, [isStandalone]);

  const handleInstall = useCallback(async () => {
    localStorage.setItem(ENGAGED_KEY, '1');

    // Desktop can't install the phone app — show the iPhone Safari steps so the
    // user knows to finish on their phone.
    if (isDesktop) {
      setModalBrowser('safari');
      return;
    }
    if (isIOS()) {
      setModalBrowser(isIOSSafari() ? 'safari' : 'chrome');
    } else {
      const installed = await triggerInstall();
      if (installed) setShow(false);
    }
  }, [triggerInstall, isDesktop]);

  if (!show) return null;

  return (
    <>
      <aside
        onClick={handleInstall}
        className="mb-6 rounded-2xl border border-banana/20 bg-gradient-to-r from-banana/[0.06] to-transparent cursor-pointer hover:border-banana/40 transition-colors active:scale-[0.99]"
      >
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="w-10 h-10 rounded-xl bg-black border border-white/10 flex items-center justify-center flex-shrink-0">
            <Image src="/icons/icon-192.png" alt="SBS" width={32} height={32} className="rounded-lg" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-semibold text-[13px]">
              {isDesktop ? 'Get the App on Your Phone' : 'Get the App'}
            </p>
            <p className="text-white/40 text-[11px]">
              {isDesktop
                ? 'On your iPhone, open in Safari → Share → Add to Home Screen'
                : 'Add to home screen — works like a real app'}
            </p>
          </div>
          <span className="px-4 py-1.5 bg-banana text-black text-xs font-bold rounded-full flex-shrink-0 pointer-events-none">
            {isDesktop ? 'How' : 'Install'}
          </span>
        </div>
      </aside>

      {modalBrowser && (
        <InstallModal
          browser={modalBrowser}
          promoBanner={isDesktop ? (
            <div className="px-5 pt-4 -mb-1 text-center">
              <p className="text-banana text-xs font-semibold">📱 Do this on your iPhone, in Safari</p>
              <p className="text-white/40 text-[11px] mt-0.5">Open SBS in Safari on your phone, then follow these steps:</p>
            </div>
          ) : undefined}
          onClose={() => { setModalBrowser(null); setShow(false); localStorage.setItem(ENGAGED_KEY, '1'); }}
        />
      )}
    </>
  );
}

// ── Profile Dropdown Button ─────────────────────────────────────────────

export function InstallAppButton() {
  const { isStandalone, triggerInstall } = useInstallPrompt();
  const [isMobile, setIsMobile] = useState(false);
  const [modalBrowser, setModalBrowser] = useState<'safari' | 'chrome' | null>(null);

  useEffect(() => {
    setIsMobile(/iphone|ipad|ipod|android/i.test(navigator.userAgent));
  }, []);

  if (!isMobile || isStandalone) return null;

  const handleClick = () => {
    if (isIOS()) {
      setModalBrowser(isIOSSafari() ? 'safari' : 'chrome');
    } else {
      triggerInstall();
    }
  };

  return (
    <>
      <button
        onClick={handleClick}
        className="w-full px-4 py-2 text-left text-text-secondary hover:bg-bg-tertiary hover:text-text-primary transition-colors flex items-center gap-3 text-sm"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        Install App
      </button>

      {modalBrowser && typeof document !== 'undefined' && createPortal(
        <InstallModal
          browser={modalBrowser}
          onClose={() => setModalBrowser(null)}
        />,
        document.body
      )}
    </>
  );
}
