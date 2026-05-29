'use client';

import React, { useState, useEffect, useRef, createContext, useContext } from 'react';
import { usePathname } from 'next/navigation';
import { PrivyProvider } from '@/providers/PrivyProvider';
import { QueryProvider } from '@/providers/QueryProvider';
import { AuthProvider } from '@/hooks/useAuth';
import { ReduxProvider } from '@/redux/provider';
import { ToastProvider } from '@/components/ui/Toast';
import { Header } from '@/components/layout/Header';
import { MobileTabBar } from '@/components/layout/MobileTabBar';
import { EditProfileModal } from '@/components/modals/EditProfileModal';
import { OnboardingTutorial } from '@/components/onboarding/OnboardingTutorial';
import { CrispChat } from '@/components/CrispChat';
import { SupportChatButton } from '@/components/SupportChatButton';
import { useAuth } from '@/hooks/useAuth';
import { useOnboarding } from '@/hooks/useOnboarding';
import OneSignal from 'react-onesignal';
import { useNotificationOptIn, type NotifOptInTrigger } from '@/hooks/useNotificationOptIn';
import { NotificationOptIn } from '@/components/notifications/NotificationOptIn';
import { useBadgeUnlockNotifier } from '@/hooks/useBadgeUnlockNotifier';
import { useUserEventStream } from '@/hooks/useUserEventStream';
import { setClientLogWallet } from '@/lib/clientLog';
import { installGlobalErrorHandlers } from '@/lib/globalErrorHandlers';
import { ClaimCelebrationProvider } from '@/contexts/ClaimCelebrationContext';
import { SocialNotifier } from '@/components/social/SocialNotifier';

// Context to expose triggerOptIn to any component in the tree
type NotifContextType = { triggerOptIn: (trigger?: NotifOptInTrigger) => void };
const NotifContext = createContext<NotifContextType>({ triggerOptIn: () => {} });
export const useNotifOptIn = () => useContext(NotifContext);

function AppContent({ children }: { children: React.ReactNode }) {
  const { showLoginModal, setShowLoginModal, setShowOnboarding, login, user } = useAuth();
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
  const { showOnboarding } = useOnboarding();
  const pathname = usePathname();
  const isDraftRoom = pathname === '/draft-room';
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const notif = useNotificationOptIn();
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
    login();
    setShowLoginModal(false);
  }, [showLoginModal, login, setShowLoginModal]);

  const handleShowTutorial = () => {
    setShowTutorial(true);
  };

  return (
    <NotifContext.Provider value={{ triggerOptIn: notif.triggerOptIn }}>
      <div className="min-h-screen bg-bg-primary">
        {!isDraftRoom && <Header onEditProfile={() => setShowEditProfile(true)} onShowTutorial={handleShowTutorial} />}
        <main className="pb-16 md:pb-0">{children}</main>
        {!isDraftRoom && <MobileTabBar />}
        <EditProfileModal isOpen={showEditProfile} onClose={() => setShowEditProfile(false)} />
        {showOnboarding && <OnboardingTutorial onComplete={() => setShowOnboarding(false)} />}
        {showTutorial && <OnboardingTutorial onComplete={() => setShowTutorial(false)} />}
        <CrispChat />
        {/* Fires in-app notis for new friend requests / messages. Renders
            nothing; runs app-wide incl. the draft room. */}
        <SocialNotifier />
        {!isDraftRoom && <SupportChatButton />}
        <NotificationOptIn
          show={notif.showPrompt}
          isLoading={notif.isLoading}
          onAccept={notif.acceptOptIn}
          onDismiss={notif.dismissOptIn}
        />
      </div>
    </NotifContext.Provider>
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
