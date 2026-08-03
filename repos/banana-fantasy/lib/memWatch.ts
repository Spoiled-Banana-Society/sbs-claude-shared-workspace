'use client';

/**
 * Memory watchdog — the missing instrument for "Aw, Snap! Error code: 5".
 *
 * Error code 5 is Chrome killing the renderer for running out of memory. The
 * JS context dies with it, so the crash can NEVER report itself: nothing lands
 * in `v2_error_events`, and absence there proves nothing (see
 * `lib/clientLog.ts` for the leak that caused this the first time, fixed
 * 2026-08-01). We spent a day inferring the cause from log RATE last time.
 *
 * This closes that gap two ways:
 *
 *  1. `mem.sample` every 60s — heap size, DOM node count, image/media element
 *     counts. A leak shows up as a straight line up; WHICH number climbs says
 *     whether it's JS objects, detached DOM, or media elements.
 *  2. `mem.resume` on boot — the last sample is mirrored into sessionStorage,
 *     which Chrome RESTORES after a crash-reload. So the first thing a
 *     resurrected tab reports is how big it had gotten right before it died,
 *     and on what page. That is the direct proof an OOM kill otherwise eats.
 *
 * Volume: 1 event/min/tab, tiny scalar payload. Our heaviest user already
 * emits ~15/min, so this is noise. It does NOT mirror to console — doing that
 * is what caused the original leak.
 *
 * `performance.memory` is Chromium-only and reports the JS heap only (not
 * decoded images / DOM / GPU), so a flat heap with a rising node or image
 * count is a meaningful result, not a null one.
 */

import { clientLog } from '@/lib/clientLog';

const SAMPLE_MS = 60_000;
const LAST_KEY = 'sbs-mem-last';

interface MemSample {
  /** Minutes this tab has been alive. */
  up: number;
  /** JS heap in MB (0 when the browser doesn't expose it). */
  heap: number;
  /** Heap ceiling in MB — the number `heap` is racing toward. */
  cap: number;
  /** Live DOM elements. */
  nodes: number;
  /** <img> elements (decoded-image memory is invisible to `heap`). */
  imgs: number;
  /** <audio>/<video> elements — each one pins a decoded buffer. */
  media: number;
  path: string;
  /** Wall-clock ms, so a resumed sample can be aged. */
  at: number;
}

interface PerfMemory {
  usedJSHeapSize?: number;
  jsHeapSizeLimit?: number;
}

const mb = (n: number | undefined) => Math.round((n ?? 0) / 1048576);

function take(startedAt: number): MemSample {
  const perf = performance as Performance & { memory?: PerfMemory };
  return {
    up: Math.round((Date.now() - startedAt) / 60_000),
    heap: mb(perf.memory?.usedJSHeapSize),
    cap: mb(perf.memory?.jsHeapSizeLimit),
    nodes: document.getElementsByTagName('*').length,
    imgs: document.images.length,
    media: document.querySelectorAll('audio,video').length,
    path: window.location.pathname,
    at: Date.now(),
  };
}

let started = false;

/**
 * Start the watchdog. Idempotent — safe to call from a component that
 * remounts. Never started more than once per tab.
 */
export function startMemoryWatch(): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  const startedAt = Date.now();

  // Did we come back from the dead? sessionStorage survives a crash-reload,
  // so a stored sample here is the last thing the previous renderer saw.
  try {
    const raw = sessionStorage.getItem(LAST_KEY);
    if (raw) {
      const prev = JSON.parse(raw) as MemSample;
      const nav = performance.getEntriesByType('navigation')[0] as
        | PerformanceNavigationTiming
        | undefined;
      clientLog('mem', 'resume', {
        // How the tab came back: "reload" is what an "Aw, Snap!" Reload button
        // produces, and is the signature we're hunting.
        navType: nav?.type ?? 'unknown',
        // The dead renderer's final numbers.
        lastUp: prev.up,
        lastHeap: prev.heap,
        lastCap: prev.cap,
        lastNodes: prev.nodes,
        lastImgs: prev.imgs,
        lastMedia: prev.media,
        lastPath: prev.path,
        // Gap between its last heartbeat and this boot. A short gap after a
        // big heap = it died right there.
        gapSec: Math.round((Date.now() - prev.at) / 1000),
      });
    }
  } catch {
    /* private mode / malformed — nothing to recover */
  }

  const tick = () => {
    try {
      const s = take(startedAt);
      clientLog('mem', 'sample', s);
      sessionStorage.setItem(LAST_KEY, JSON.stringify(s));
    } catch {
      /* storage full or blocked — keep sampling, just don't persist */
    }
  };

  // First sample at 60s, not at 0: a just-booted tab is uninteresting and the
  // boot-time number is dominated by hydration churn.
  setInterval(tick, SAMPLE_MS);
}
