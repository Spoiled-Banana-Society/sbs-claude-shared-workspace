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

export default nextConfig;
