import webpack from 'next/dist/compiled/webpack/webpack-lib.js';

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
    // Standard security header set. Each one closes a known browser-side
    // attack vector. Configured site-wide via the `/:path*` matcher.
    return [
      {
        source: '/:path*',
        headers: [
          // Enforce HTTPS for the site + subdomains for 2 years. Browser
          // refuses HTTP downgrades after the first visit.
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          // Block the browser from sniffing a different MIME type than
          // the server declared — closes one variety of XSS upload trick.
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          // No iframe embedding from other sites (clickjacking). SAMEORIGIN
          // still allows our own pages to embed each other (e.g. /spectate).
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
          // Don't leak full referrer URLs cross-origin. Same-origin gets
          // the full path; cross-origin gets only the origin.
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          // Disable browser APIs we don't use. If KYC ever needs camera,
          // allowlist explicit origins here.
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
          // Privy + WalletConnect popups need this — keeps the login
          // window from being orphaned by stricter COOP.
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

export default nextConfig;
