'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';

// Floating SBS-logo button (desktop, bottom-right) that opens Crisp.
// Underdog-style: brand logo on a yellow circle, fixed to viewport.
// Mobile hides the launcher — small screens can use the Support entry
// in the profile dropdown instead.

export function SupportChatButton() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const id = setInterval(() => {
      const w = window as Window & { $crisp?: { push: (cmd: unknown[]) => void } };
      if (w.$crisp && typeof w.$crisp.push === 'function') {
        try {
          w.$crisp.push(['on', 'chat:opened', () => setOpen(true)]);
          // When the user closes the chat, Crisp would normally surface
          // its own bubble launcher. We want our SBS-logo button to
          // remain the only entry point, so re-hide Crisp entirely.
          w.$crisp.push(['on', 'chat:closed', () => {
            setOpen(false);
            try { w.$crisp!.push(['do', 'chat:hide']); } catch {}
          }]);
        } catch {}
        clearInterval(id);
      }
    }, 500);
    const stop = setTimeout(() => clearInterval(id), 15000);
    return () => {
      clearInterval(id);
      clearTimeout(stop);
    };
  }, []);

  const handleClick = () => {
    const w = window as Window & { $crisp?: { push: (cmd: unknown[]) => void } };
    if (!w.$crisp) return;
    if (open) {
      w.$crisp.push(['do', 'chat:close']);
    } else {
      w.$crisp.push(['do', 'chat:show']);
      w.$crisp.push(['do', 'chat:open']);
    }
  };

  return (
    <div className="hidden lg:block fixed bottom-6 right-6 z-50 group">
      {/* Tooltip — shows on hover */}
      <span className="absolute right-full mr-3 top-1/2 -translate-y-1/2 px-3 py-1.5 rounded-lg bg-black/90 text-white text-xs font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity shadow-lg">
        Chat with us
      </span>
      <button
        type="button"
        onClick={handleClick}
        aria-label="Open support chat"
        className="flex items-center justify-center w-14 h-14 rounded-full bg-banana shadow-[0_8px_24px_rgba(0,0,0,0.35)] hover:scale-105 active:scale-95 transition-transform"
      >
        <Image
          src="/sbs-logo-black.png"
          alt="SBS"
          width={32}
          height={32}
          className="w-7 h-7 object-contain"
          priority={false}
        />
      </button>
    </div>
  );
}
