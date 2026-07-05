'use client';

/**
 * Branded full-screen "Joining lobby…" transition.
 *
 * Shown by the drafting page while the joinDraft network call is in flight
 * (join-before-navigate). The overlay's fade-in is delayed ~140ms (see
 * `.animate-joining-in` in globals.css) so a fast join barely flashes it,
 * while a slow join gets the full branded beat. It never pads the wait —
 * the moment the join resolves the page navigates and this unmounts.
 *
 * `error` renders the join-failure message as an in-page card. This exists
 * because window.alert() is silently swallowed in iOS saved-to-home-screen
 * apps — a failure shown via alert() was invisible to PWA users, who saw
 * only a dipped pass counter (2026-07-05). Do not switch these messages
 * back to alert().
 */
export function JoiningLobbyOverlay({
  show,
  instant = false,
  error = null,
  onDismiss,
}: {
  show: boolean;
  instant?: boolean;
  error?: string | null;
  onDismiss?: () => void;
}) {
  if (error) {
    return (
      <div
        role="alertdialog"
        aria-live="assertive"
        aria-label="Could not join"
        className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#0a0a0f]/[0.97] backdrop-blur-xl px-6"
      >
        <div className="glass-card max-w-sm w-full rounded-2xl border border-white/10 p-6 text-center">
          <div className="text-5xl mb-4 select-none" aria-hidden="true">🍌</div>
          <p className="text-white text-lg font-semibold mb-2">Couldn&apos;t join</p>
          <p className="text-white/70 text-sm leading-relaxed mb-5">{error}</p>
          <button
            onClick={onDismiss}
            className="w-full px-4 py-3 rounded-xl bg-yellow-400 text-black font-semibold hover:bg-yellow-300 transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    );
  }

  if (!show) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Joining lobby"
      // `instant` (used by /draft-room/loading.tsx) skips the fade-in so the
      // overlay continues seamlessly across the route hand-off instead of
      // re-fading from transparent — which would itself read as a flash.
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#0a0a0f]/[0.97] backdrop-blur-xl${instant ? '' : ' animate-joining-in'}`}
    >
      {/* Pulsing banana glow */}
      <div className="relative mb-7 flex items-center justify-center">
        <div className="absolute h-28 w-28 rounded-full bg-yellow-400/20 blur-2xl animate-pulse-glow" aria-hidden="true" />
        <div className="text-6xl animate-pulse-glow select-none" aria-hidden="true">🍌</div>
      </div>

      <p className="text-white text-lg font-semibold tracking-wide">
        Joining lobby<span className="animate-joining-dots" />
      </p>

      {/* Indeterminate banana-gradient progress bar */}
      <div className="mt-5 h-1 w-44 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full w-1/3 rounded-full animate-joining-bar"
          style={{ background: 'linear-gradient(90deg, #fbbf24, #f59e0b)' }}
        />
      </div>
    </div>
  );
}
