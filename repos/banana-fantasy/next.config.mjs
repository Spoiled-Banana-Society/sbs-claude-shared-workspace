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
    ],
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
});
