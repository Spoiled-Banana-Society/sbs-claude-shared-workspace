'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface NotificationOptInProps {
  show: boolean;
  isLoading: boolean;
  onAccept: () => void;
  onDismiss: () => void;
}

/**
 * Slide-up notification opt-in prompt.
 * Appears after first draft or purchase with a clear value prop.
 */
export function NotificationOptIn({ show, isLoading, onAccept, onDismiss }: NotificationOptInProps) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ y: 200, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 200, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-[380px] z-50"
        >
          <div className="bg-[#1a1a1a] border border-[#F3E216]/30 rounded-xl p-5 shadow-2xl shadow-[#F3E216]/10">
            {/* Bell icon */}
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-10 h-10 bg-[#F3E216]/10 rounded-full flex items-center justify-center">
                <span className="text-xl">🔔</span>
              </div>
              <div className="flex-1">
                <h3 className="text-white font-bold font-primary text-base">
                  Never miss a draft!
                </h3>
                <p className="text-gray-400 text-sm mt-1 leading-relaxed">
                  Get notified 5 minutes before your draft starts so you&apos;re always ready to pick.
                </p>
              </div>
            </div>

            {/* Buttons */}
            <div className="flex gap-3 mt-4">
              <button
                onClick={onAccept}
                disabled={isLoading}
                className="flex-1 bg-[#F3E216] text-black font-bold font-primary py-2.5 px-4 rounded-lg text-sm hover:bg-[#F3E216]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="animate-spin">⏳</span> Enabling...
                  </span>
                ) : (
                  'Enable Notifications'
                )}
              </button>
              <button
                onClick={onDismiss}
                disabled={isLoading}
                className="text-gray-500 hover:text-gray-300 text-sm font-primary py-2.5 px-3 transition-colors min-h-[44px]"
              >
                Not now
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
