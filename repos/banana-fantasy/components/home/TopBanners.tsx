'use client';

/**
 * Top-of-home promo banners: First Purchase + Get-the-App, in one responsive row.
 *
 * Layout (Boris's spec):
 *   - both visible  → side by side on desktop, stacked on mobile
 *   - one visible   → centered at a comfortable width (no lonely full-width bar)
 *   - none          → nothing (but the install modal can still mount)
 *
 * Each card is dismissible with ×. Dismissing the First Purchase BANNER does NOT
 * remove the First Purchase promo card in the carousel below — that one is
 * governed only by the promo rules (purchased + nothing left to claim).
 *
 * Style: Option 1 — yellow-outlined card, bare banana line-icon (no square),
 * title + one-line subtitle, prominent pill CTA.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useInstallPrompt } from '@/hooks/useInstallPrompt';
import { InstallModal } from '@/components/home/AddToHomeScreenCard';
import { isWalletAdmin } from '@/lib/adminAllowlist';

/* ───────────────────────── shared bits ───────────────────────── */

function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3.5 rounded-2xl border border-banana bg-white/[0.03] pl-4 pr-2.5 py-3">
      {children}
    </div>
  );
}

function DismissX({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      aria-label="Dismiss"
      className="flex-none w-7 h-7 flex items-center justify-center rounded-full text-text-secondary hover:text-text-primary hover:bg-white/10 transition-colors text-lg leading-none"
    >
      ×
    </button>
  );
}

const GiftIcon = (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="text-banana flex-none">
    <polyline points="20 12 20 22 4 22 4 12" />
    <rect x="2" y="7" width="20" height="5" />
    <line x1="12" y1="22" x2="12" y2="7" />
    <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
    <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
  </svg>
);

const PhoneIcon = (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="text-banana flex-none">
    <rect x="6" y="2" width="12" height="20" rx="3" />
    <circle cx="12" cy="18.5" r="0.6" fill="currentColor" />
  </svg>
);

/* ───────────────────── First Purchase banner ───────────────────── */

const fpDismissKey = (wallet?: string) => `sbs-first-purchase-banner-dismissed-${wallet ?? 'anon'}`;

function useFirstPurchaseBanner() {
  const { user, isBB3Holder, isLoggedIn } = useAuth();
  const router = useRouter();
  const wallet = user?.walletAddress;
  const [dismissed, setDismissed] = useState(true); // hidden until storage checked

  useEffect(() => {
    if (typeof window === 'undefined' || !wallet) { setDismissed(true); return; }
    setDismissed(!!window.localStorage.getItem(fpDismissKey(wallet)));
  }, [wallet]);

  useEffect(() => {
    const onUnlock = () => {
      if (wallet && !window.localStorage.getItem(fpDismissKey(wallet))) setDismissed(false);
    };
    window.addEventListener('sbs-first-purchase-unlocked', onUnlock);
    return () => window.removeEventListener('sbs-first-purchase-unlocked', onUnlock);
  }, [wallet]);

  const dismiss = useCallback(() => {
    if (typeof window !== 'undefined' && wallet) window.localStorage.setItem(fpDismissKey(wallet), '1');
    setDismissed(true);
  }, [wallet]);

  const goBuy = useCallback(() => router.push('/buy-drafts'), [router]);

  // Returning (BB3) players see it right away; brand-new users once they've
  // finished their welcome-wheel free drafts (firstPurchasePromoUnlocked).
  const inWindow = isBB3Holder || !!user?.firstPurchasePromoUnlocked;
  // IMPORTANT: require firstPurchaseBonusGranted to be KNOWN-false. It loads a
  // moment after the user object (via the balance stream), so it's `undefined`
  // on first paint. Using `!granted` there would flash the banner for ~1s for a
  // user who has already purchased. `=== false` keeps it hidden until we're sure.
  const show = isLoggedIn && !!wallet && user?.firstPurchaseBonusGranted === false && inWindow && !dismissed;

  return { show, dismiss, goBuy };
}

function FirstPurchaseCard({ goBuy, dismiss }: { goBuy: () => void; dismiss: () => void }) {
  return (
    <CardShell>
      {GiftIcon}
      <div className="flex-1 min-w-0" onClick={goBuy} role="button" tabIndex={0}>
        <p className="text-text-primary font-semibold text-[14px] leading-tight">First Purchase Bonus</p>
        <p className="text-text-secondary text-xs mt-0.5">Every 4 passes = 1 free spin</p>
      </div>
      <button
        onClick={goBuy}
        className="flex-none rounded-full bg-banana text-[#1d1d1f] font-bold text-[13px] px-5 py-2.5 transition-transform hover:scale-[1.03]"
      >
        Buy Drafts
      </button>
      <DismissX onClick={dismiss} />
    </CardShell>
  );
}

/* ───────────────────────── Get-the-App banner ───────────────────────── */

const A2HS_DISMISS_KEY = 'sbs-a2hs-dismissed';
const A2HS_ENGAGED_KEY = 'sbs-a2hs-engaged';

function isA2hsDismissed(): boolean {
  if (typeof window === 'undefined') return true;
  if (localStorage.getItem(A2HS_ENGAGED_KEY) === '1') return true;
  const ts = localStorage.getItem(A2HS_DISMISS_KEY);
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

function isStandaloneNow(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches
    || Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
}

function useAppInstallBanner() {
  const { triggerInstall } = useInstallPrompt();
  // Decide visibility ONCE, on mount (client only). Starting false keeps SSR and
  // hydration in agreement; the effect then computes the real value exactly once.
  // We deliberately don't react to later isStandalone/appinstalled changes — on
  // desktop with the PWA installed Chrome can fire `appinstalled` mid-session,
  // which previously flipped it off after it had shown (the flash-then-blank).
  const [show, setShow] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [modalBrowser, setModalBrowser] = useState<'safari' | 'chrome' | 'both' | null>(null);

  useEffect(() => {
    setIsDesktop(!/iphone|ipad|ipod|android/i.test(navigator.userAgent));
    // One-time bring-back: forces the Get-the-App banner to show ONCE — even
    // inside the installed app (bypasses the standalone gate) — for QA. Two
    // triggers: ?showbanner=1 (works in a browser) OR the sessionStorage flag
    // set by the profile-menu "Show install banner" button (works in the
    // installed app, which has no address bar). Either clears the sticky
    // dismissal so NORMAL rules resume afterward: ×-ing it re-dismisses as usual.
    const params = new URLSearchParams(window.location.search);
    const forceFlag = sessionStorage.getItem('sbs-force-install-banner') === '1';
    const forceOnce = params.get('showbanner') === '1' || forceFlag;
    if (forceOnce) {
      localStorage.removeItem(A2HS_ENGAGED_KEY);
      localStorage.removeItem(A2HS_DISMISS_KEY);
      sessionStorage.removeItem('sbs-force-install-banner'); // consume it
      if (params.has('showbanner')) {
        params.delete('showbanner');
        const qs = params.toString();
        window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
      }
    }
    setShow(forceOnce || (!isStandaloneNow() && !isA2hsDismissed()));
  }, []);

  const onClick = useCallback(async () => {
    if (isDesktop) { setModalBrowser('both'); return; }
    if (isIOS()) { setModalBrowser(isIOSSafari() ? 'safari' : 'chrome'); return; }
    const installed = await triggerInstall();
    if (installed) setShow(false);
  }, [isDesktop, triggerInstall]);

  const dismiss = useCallback(() => {
    if (typeof window !== 'undefined') localStorage.setItem(A2HS_ENGAGED_KEY, '1');
    setShow(false);
  }, []);

  const modalNode = modalBrowser && typeof document !== 'undefined'
    ? createPortal(<InstallModal browser={modalBrowser} onClose={() => setModalBrowser(null)} />, document.body)
    : null;

  return { show, dismiss, onClick, modalNode };
}

function AppInstallCard({ onClick, dismiss }: { onClick: () => void; dismiss: () => void }) {
  return (
    <CardShell>
      {PhoneIcon}
      <div className="flex-1 min-w-0 cursor-pointer" onClick={onClick} role="button" tabIndex={0}>
        <p className="text-text-primary font-semibold text-[14px] leading-tight">Get the App</p>
        <p className="text-text-secondary text-xs mt-0.5">
          Works like a real app <span className="whitespace-nowrap">on your phone</span>
        </p>
      </div>
      <button
        onClick={onClick}
        className="flex-none rounded-full bg-banana text-[#1d1d1f] font-bold text-[13px] px-5 py-2.5 transition-transform hover:scale-[1.03]"
      >
        Install
      </button>
      <DismissX onClick={dismiss} />
    </CardShell>
  );
}

/* ───────────────────────── orchestrator ───────────────────────── */

export function TopBanners() {
  const { user } = useAuth();
  const fp = useFirstPurchaseBanner();
  const app = useAppInstallBanner();

  // Render only after mount: visibility is computed from window/localStorage, so
  // gating on mount keeps SSR and the first client render in agreement and kills
  // the hydration flash (banner appearing for a frame, then settling).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Admin-only preview: force both banners to render for layout/QA without
  // touching account data. Toggled from admin (sessionStorage 'sbs-preview-banners').
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setPreview(isWalletAdmin(user?.walletAddress) && window.sessionStorage.getItem('sbs-preview-banners') === '1');
  }, [user?.walletAddress]);

  if (!mounted) return null;

  const slots: React.ReactNode[] = [];
  if (fp.show || preview) slots.push(<FirstPurchaseCard key="fp" goBuy={fp.goBuy} dismiss={fp.dismiss} />);
  if (app.show || preview) slots.push(<AppInstallCard key="app" onClick={app.onClick} dismiss={app.dismiss} />);

  const two = slots.length === 2;
  return (
    <>
      {slots.length > 0 && (
        <div className="mb-6">
          <div className={two ? 'flex flex-col md:flex-row gap-3' : 'flex justify-center'}>
            {slots.map((s) => (
              // Stable key (s.key = 'fp' | 'app') so a card never remounts when
              // the slot count changes (e.g. the other banner appears/dismisses).
              <div key={(s as React.ReactElement).key} className={two ? 'md:flex-1 min-w-0' : 'w-full max-w-lg'}>
                {s}
              </div>
            ))}
          </div>
        </div>
      )}
      {app.modalNode}
    </>
  );
}
