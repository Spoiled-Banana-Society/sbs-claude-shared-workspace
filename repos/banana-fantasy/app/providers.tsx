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
import { useAuth } from '@/hooks/useAuth';
import { useOnboarding } from '@/hooks/useOnboarding';
import OneSignal from 'react-onesignal';
import { useNotificationOptIn, type NotifOptInTrigger } from '@/hooks/useNotificationOptIn';
import { NotificationOptIn } from '@/components/notifications/NotificationOptIn';

// Context to expose triggerOptIn to any component in the tree
type NotifContextType = { triggerOptIn: (trigger?: NotifOptInTrigger) => void };
const NotifContext = createContext<NotifContextType>({ triggerOptIn: () => {} });
export const useNotifOptIn = () => useContext(NotifContext);

function AppContent({ children }: { children: React.ReactNode }) {
  const { showLoginModal, setShowLoginModal, setShowOnboarding, login } = useAuth();
  const { showOnboarding } = useOnboarding();
  const pathname = usePathname();
  const isDraftRoom = pathname === '/draft-room';
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const notif = useNotificationOptIn();

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

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider>
      <AuthProvider>
        <ReduxProvider>
          <QueryProvider>
            <ToastProvider>
              <OneSignalInit />
              <AppContent>{children}</AppContent>
            </ToastProvider>
          </QueryProvider>
        </ReduxProvider>
      </AuthProvider>
    </PrivyProvider>
  );
}
