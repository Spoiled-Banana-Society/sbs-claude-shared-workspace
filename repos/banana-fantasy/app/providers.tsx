'use client';

import React, { useState, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { PrivyProvider, useSafePrivy as usePrivy } from '@/providers/PrivyProvider';
import { reportClientError } from '@/lib/clientErrors';
import { LOG_SOURCES } from '@/lib/logSources';
import { QueryProvider } from '@/providers/QueryProvider';
import { AuthProvider } from '@/hooks/useAuth';
import { ReduxProvider } from '@/redux/provider';
import { ToastProvider } from '@/components/ui/Toast';
import { Header } from '@/components/layout/Header';
import { MobileTabBar } from '@/components/layout/MobileTabBar';
import { EditProfileModal } from '@/components/modals/EditProfileModal';
import { OnboardingTutorial } from '@/components/onboarding/OnboardingTutorial';
import { CrispChat } from '@/components/CrispChat';
import { useAuth } from '@/hooks/useAuth';
import { useOnboarding } from '@/hooks/useOnboarding';
import OneSignal from 'react-onesignal';
import { useBadgeUnlockNotifier } from '@/hooks/useBadgeUnlockNotifier';
import { useUserEventStream } from '@/hooks/useUserEventStream';
import { setClientLogWallet } from '@/lib/clientLog';
import { wakeRealtime } from '@/lib/api/firebase';
import { installGlobalErrorHandlers } from '@/lib/globalErrorHandlers';
import { recordPath } from '@/lib/navHistory';
import { ClaimCelebrationProvider } from '@/contexts/ClaimCelebrationContext';
import { SocialNotifier } from '@/components/social/SocialNotifier';

function AppContent({ children }: { children: React.ReactNode }) {
  const { showLoginModal, setShowLoginModal, setShowOnboarding, login, user } = useAuth();
  const privy = usePrivy();
  // Attribute client logs to the logged-in wallet so inspect-debug-logs
  // can filter by user.
  React.useEffect(() => {
    setClientLogWallet(user?.walletAddress);
  }, [user?.walletAddress]);
  // Catch every uncaught error / rejected promise app-wide and route it
  // to the admin Logs tab. Idempotent — safe to call on every mount.
  useEffect(() => {
    installGlobalErrorHandlers();
  }, []);

  // iOS installed PWAs suspend the realtime websocket when backgrounded and
  // don't reliably revive it on foreground — so notifications/promos stop
  // arriving live (they dump minutes later). Force a fresh connection every
  // time the app is foregrounded so real-time resumes immediately. The
  // per-hook focus-refetches then pull the latest the instant you look.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') wakeRealtime(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, []);
  const { showOnboarding } = useOnboarding();
  const pathname = usePathname();
  const isDraftRoom = pathname === '/draft-room';
  // App-wide "where did I just come from" recorder. Runs as a parent effect
  // (after the page's own effects), so any page can read getLastPath() on mount
  // to see the route it arrived from. Powers the marketplace scroll-restore.
  useEffect(() => { if (pathname) recordPath(pathname); }, [pathname]);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  // Real-time push from RTDB — primary source for badge unlocks +
  // promo events (toast + bell within ~100ms). Mounted app-wide so any
  // page sees the unlock the moment it happens server-side.
  useUserEventStream();
  // 5-minute poll safety net for badges in case RTDB push misses an
  // unlock (network blip, write failure, granted-while-offline).
  useBadgeUnlockNotifier();

  useEffect(() => {
    const handleShowTutorial = () => setShowTutorial(true);
    window.addEventListener('show-tutorial', handleShowTutorial);
    return () => window.removeEventListener('show-tutorial', handleShowTutorial);
  }, []);

  useEffect(() => {
    if (!showLoginModal) return;
    // Signal-only alarm: if the login prompt fires while Privy STILL reports
    // authenticated, the user is actually logged in and this is the auth-blink
    // bug (spurious login modal) — not a real logged-out user. Surface it to
    // the admin feed so a recurrence is caught. (Replaces the chatty authblink
    // diagnostic; the debounce fix should keep this silent.)
    if (privy?.authenticated) {
      reportClientError({
        source: LOG_SOURCES.auth.SPURIOUS_LOGIN_MODAL,
        message: 'Login modal triggered while Privy authenticated (auth-blink)',
        route: pathname ?? undefined,
        actor: user?.walletAddress ?? undefined,
      });
    }
    login();
    setShowLoginModal(false);
  }, [showLoginModal, login, setShowLoginModal, privy, pathname, user?.walletAddress]);

  const handleShowTutorial = () => {
    setShowTutorial(true);
  };

  return (
      <div className="min-h-screen bg-bg-primary">
        {!isDraftRoom && <Header onEditProfile={() => setShowEditProfile(true)} onShowTutorial={handleShowTutorial} />}
        <main className="pb-20 md:pb-0">{children}</main>
        {!isDraftRoom && <MobileTabBar />}
        <EditProfileModal isOpen={showEditProfile} onClose={() => setShowEditProfile(false)} />
        {showOnboarding && <OnboardingTutorial onComplete={() => setShowOnboarding(false)} />}
        {showTutorial && <OnboardingTutorial onComplete={() => setShowTutorial(false)} />}
        <CrispChat />
        {/* Fires in-app notis for new friend requests / messages. Renders
            nothing; runs app-wide incl. the draft room. */}
        <SocialNotifier />
        {/* First-purchase bonus is now announced via a subtle toast (see
            useUserEventStream 'first-purchase-unlocked') + the persistent home
            banner + promo box. The old full-screen modal was removed — too
            abrupt on the post-draft card/roster reveal. */}
        {/* The floating "Chat with us" launcher was removed — the only entry
            point is now "Chat with us" in the profile dropdown. */}
      </div>
  );
}

function OneSignalInit() {
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    const appId = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
    if (!appId) return;
    initialized.current = true;
    OneSignal.init({
      appId,
      safari_web_id: 'web.onesignal.auto.3182d724-6e8d-450b-a283-f7f35292ae01',
      allowLocalhostAsSecureOrigin: process.env.NODE_ENV === 'development',
    }).catch((err: unknown) => {
      console.warn('OneSignal init failed:', err);
    });
  }, []);

  // Auto-refresh the OneSignal push subscription whenever the PWA
  // becomes visible. iOS occasionally rotates APNS push tokens — when
  // that happens, OneSignal's stored token goes stale and pushes start
  // arriving at APNS but never reaching the device (successful=1,
  // received=0). The standard workaround is asking the user to toggle
  // push off/on in settings, which is terrible UX. Instead: on every
  // PWA foregrounding, call optIn() (no-op if state hasn't changed,
  // forces a token sync with OneSignal if it has) and re-POST the
  // current subscription id to our /api/notifications/subscribe so
  // the server-side wallet → playerId mapping stays current. User
  // never has to think about it.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const refreshIfOptedIn = async () => {
      try {
        const sub = OneSignal?.User?.PushSubscription;
        // Only refresh if the user previously opted in — otherwise we'd
        // be silently re-prompting users who deliberately turned push off.
        if (!sub || sub.optedIn !== true) return;
        // Calling optIn when already opted in is a no-op for state but
        // forces the SDK to re-sync the subscription with OneSignal —
        // which is what triggers OneSignal to pick up a rotated APNS
        // token. The playerId (server-side mapping key) is stable, so
        // no separate /api/notifications/subscribe POST is needed.
        await OneSignal.User.PushSubscription.optIn();
      } catch (err) {
        console.warn('OneSignal subscription refresh failed:', err);
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') refreshIfOptedIn();
    };
    document.addEventListener('visibilitychange', onVisibility);
    // Also run once on mount so freshly-opened PWAs immediately refresh,
    // not just on subsequent foregrounding.
    refreshIfOptedIn();
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider>
      <AuthProvider>
        <ReduxProvider>
          <QueryProvider>
            <ToastProvider>
              <ClaimCelebrationProvider>
                <OneSignalInit />
                <AppContent>{children}</AppContent>
              </ClaimCelebrationProvider>
            </ToastProvider>
          </QueryProvider>
        </ReduxProvider>
      </AuthProvider>
    </PrivyProvider>
  );
}
