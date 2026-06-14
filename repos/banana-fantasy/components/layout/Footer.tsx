'use client';

import Link from 'next/link';

export function Footer() {
  const year = new Date().getFullYear();

  // Support → open the Crisp chat (same as the profile menu's "Chat with us"),
  // on desktop and mobile. Replaces the old Discord-invite link.
  const openSupportChat = () => {
    try {
      if (window.$crisp) {
        document.documentElement.classList.add('crisp-open');
        (window.$crisp as unknown[]).push(['do', 'chat:show']);
        (window.$crisp as unknown[]).push(['do', 'chat:open']);
      }
    } catch {}
  };

  return (
    // Thin single-row footer on every size (mobile used to stack into a thick
    // block). Copyright shortens to "SBS" on phones so it stays on one line.
    <footer className="border-t border-bg-tertiary py-3 mt-auto">
      <div className="flex flex-row items-center justify-between gap-3 px-4 sm:px-8 lg:px-12">
        <p className="text-[11px] sm:text-xs text-text-muted whitespace-nowrap">
          © {year}{' '}
          <span className="sm:hidden">SBS</span>
          <span className="hidden sm:inline">Spoiled Banana Society. All rights reserved.</span>
        </p>
        <div className="flex items-center gap-3 sm:gap-4">
          <Link href="/terms" className="text-xs text-text-muted hover:text-text-secondary transition-colors">
            Terms
          </Link>
          <Link href="/faq" className="text-xs text-text-muted hover:text-text-secondary transition-colors">
            FAQ
          </Link>
          <button
            type="button"
            onClick={openSupportChat}
            className="text-xs text-text-muted hover:text-text-secondary transition-colors"
          >
            Support
          </button>
        </div>
      </div>
    </footer>
  );
}
