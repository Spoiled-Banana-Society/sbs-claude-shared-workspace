'use client';

import React, { useEffect, useRef } from 'react';
import { Modal } from '../ui/Modal';

interface PersonaVerificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  templateId: string;
  userId: string;
  onComplete: (inquiryId: string, status: string) => void;
}

export function PersonaVerificationModal({
  isOpen,
  onClose,
  templateId,
  userId,
  onComplete,
}: PersonaVerificationModalProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clientRef = useRef<any>(null);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;

    import('persona').then((Persona) => {
      if (cancelled) return;

      const client = new Persona.Client({
        templateId,
        environmentId: process.env.NEXT_PUBLIC_PERSONA_ENVIRONMENT_ID || '',
        referenceId: userId,
        onReady: () => {
          client.open();
        },
        onComplete: ({ inquiryId, status }: { inquiryId: string; status: string }) => {
          console.log('[Persona] Verification complete:', inquiryId, status);
          onComplete(inquiryId, status);
        },
        onCancel: () => {
          console.log('[Persona] User cancelled verification');
          onClose();
        },
        onError: (error: unknown) => {
          console.error('[Persona] Verification error:', error);
        },
      });

      clientRef.current = client;
    });

    return () => {
      cancelled = true;
      if (clientRef.current) {
        clientRef.current.destroy();
        clientRef.current = null;
      }
    };
  }, [isOpen, templateId, userId, onComplete, onClose]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Identity Verification" size="lg">
      <div className="min-h-[400px] flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 mx-auto border-2 border-banana border-t-transparent rounded-full animate-spin" />
          <p className="text-text-secondary text-sm">Loading verification...</p>
        </div>
      </div>
    </Modal>
  );
}
