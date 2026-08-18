import webpack from 'next/dist/compiled/webpack/webpack-lib.js';
import { withSentryConfig } from '@sentry/nextjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  compiler: {
    styledComponents: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'a.espncdn.com',
        pathname: '/i/teamlogos/**',
      },
      {
        protocol: 'https',
        hostname: 'i2c.seadn.io',
      },
      {
        protocol: 'https',
        hostname: 'storage.googleapis.com',
        pathname: '/sbs-draft-token-images/**',
      },
      {
        // Uploaded user profile pictures. Without this, any avatar rendered via
        // next/image (header/profile, useNextImage=true) 400s and falls back to
        // the banana. The draft room uses a plain <img> so it's unaffected, but
        // these surfaces need the bucket path whitelisted.
        protocol: 'https',
        hostname: 'storage.googleapis.com',
        pathname: '/sbs-staging-pfps/**',
      },
      {
        // Our own /api/og/team-card obsidian card images (NFT card art).
        protocol: 'https',
        hostname: '*.vercel.app',
        pathname: '/api/og/**',
      },
      {
        // Same og card images when the build serves the custom launch domain
        // (NEXT_PUBLIC_SITE_URL=https://sbsfantasy.com → og URLs point here).
        // Without these the optimizer 400s every card → black marketplace tiles.
        protocol: 'https',
        hostname: 'sbsfantasy.com',
        pathname: '/api/og/**',
      },
      {
        // www + staging.sbsfantasy.com (same build, custom subdomains).
        protocol: 'https',
        hostname: '**.sbsfantasy.com',
        pathname: '/api/og/**',
      },
    ],
  },
  async redirects() {
    return [
      // Route renames — keep old URLs working for bookmarks / shared links and
      // existing notification deep-links (query strings are preserved).
      // /drafting → /draft and /my-teams → /teams (shorter, match the nav).
      { source: '/drafting', destination: '/draft', permanent: false },
      { source: '/my-teams', destination: '/teams', permanent: false },
      // The Teams page was /standings → /my-teams → now /teams. Point the
      // oldest alias straight at /teams so there's no double redirect.
      { source: '/standings', destination: '/teams', permanent: false },
      // The Prizes page moved from /prizes → /winnings (same reasoning).
      { source: '/prizes', destination: '/winnings', permanent: false },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin-allow-popups',
          },
          {
            // Chrome's Reporting API: after a RENDERER CRASH ("Aw, Snap!"),
            // the browser itself POSTs a crash report here — including
            // body.reason, which says "oom" outright when it was memory.
            // This is the ONLY way to learn the crash reason: the page's JS
            // is dead by then, so no in-page telemetry can ever capture it.
            // Two days of memWatch shows FC's heap at 98-140 MB right up to
            // his crashes, so the reason field is now the whole question.
            // Delivery is best-effort and can lag minutes; endpoint is
            // app/api/debug/crash/route.ts → v2_debug_events tag "crash".
            key: 'Reporting-Endpoints',
            value: 'default="https://sbsfantasy.com/api/debug/crash"',
          },
        ],
      },
    ];
  },
  webpack: (config) => {
    config.plugins.push(
      new webpack.ProvidePlugin({
        React: 'react',
      })
    );
    return config;
  },
};

// Wrap with Sentry to upload source maps on production builds.
// Without this, Sentry sees minified bundle line numbers instead
// of the actual TS source, so stack traces are unreadable. SENTRY_AUTH_TOKEN
// must be set in Vercel env for the upload to succeed; if missing the
// build proceeds but maps aren't uploaded (no fatal error).
export default withSentryConfig(nextConfig, {
  org: 'sbs-ti',
  project: 'javascript-nextjs',
  // Quieter build logs — Sentry's defaults are noisy. Errors still surface.
  silent: !process.env.CI,
  // Source maps need to be uploaded but NOT served publicly (privacy).
  // widenClientFileUpload uploads a BROADER set of source maps (prettier
  // stack traces) at the cost of extra build memory/time. Disabled because
  // the broadened pass was contributing to Vercel build OOM (SIGKILL).
  // Core source maps are still uploaded — traces stay readable.
  widenClientFileUpload: false,
  hideSourceMaps: true,
  disableLogger: true,
  // Tunnel Sentry client-side traffic through a Next route to bypass
  // ad blockers (no-op if Sentry isn't loaded by the user).
  tunnelRoute: '/api/sentry-tunnel',
  // Sentry's API is not part of our deploy: a 504 from `releases finalize`
  // FAILED a Vercel build (2026-08-18) after the app had compiled and linted
  // clean. Log upload/finalize errors and keep going — worst case that
  // release has less-pretty stack traces.
  unstable_sentryWebpackPluginOptions: {
    errorHandler: (err) => {
      console.warn('[sentry] source-map/release step failed (non-fatal):', err?.message ?? err);
    },
  },
});
