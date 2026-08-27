import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from './providers';
import StyledComponentsRegistry from '@/lib/registry';
import GoogleAnalytics from './components/GoogleAnalytics';
import { Footer } from '@/components/layout/Footer';
import { ServiceNoticeBanner } from '@/components/ServiceNoticeBanner';
// import ServiceWorkerRegistration from '@/components/ServiceWorkerRegistration';

const SITE_URL = 'https://sbsfantasy.com';
const SITE_NAME = 'SBSFantasy';
const DEFAULT_TITLE = 'SBSFantasy';
const DEFAULT_DESCRIPTION =
  'Banana Best Ball IV is live now! $100K Guaranteed Prize Pool';

// The share-card image must be an ABSOLUTE url pointing at the SAME deployment
// that renders the page — otherwise metadataBase (sbsfantasy.com) rewrites it
// to the prod domain even on staging, so a staging share would 404 the image
// until prod has the file. Vercel auto-exposes VERCEL_PROJECT_PRODUCTION_URL
// (= banana-fantasy-sbs.vercel.app on staging, sbsfantasy.com on prod), so each
// environment serves its own /og-card.png. Falls back to sbsfantasy.com locally.
const DEPLOY_ORIGIN = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : SITE_URL;
// Dedicated 1200×630 share card: black SBS football-banana centered on a clean
// white background (baked in, no transparency) so it renders identically on
// every platform — Discord/iMessage dark cards, X, etc. The bare transparent
// logo washed out on light card backgrounds. Static .png so it's served
// directly (the prelaunch middleware walls off extension-less routes, which
// would otherwise break the countdown's share card). Bump ?v= to bust caches.
const DEFAULT_OG_IMAGE = `${DEPLOY_ORIGIN}/og-card.png?v=4`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: DEFAULT_TITLE,
    template: '%s | SBSFantasy',
  },
  description: DEFAULT_DESCRIPTION,
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    url: SITE_URL,
    siteName: SITE_NAME,
    type: 'website',
    images: [
      {
        url: DEFAULT_OG_IMAGE,
        width: 1200,
        height: 630,
        alt: 'SBSFantasy',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    images: [DEFAULT_OG_IMAGE],
  },
  robots: {
    index: true,
    follow: true,
  },
  keywords: ['fantasy football', 'best ball', 'drafting', 'tradeable teams', 'prizes'],
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'SBSFantasy',
  },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: true,
  themeColor: '#F3E216',
  // Required for env(safe-area-inset-*) to report real values on iOS —
  // without it the home-indicator bar overlaps the bottom tab bar and
  // taps land on the indicator instead (Boris 2026-06-11).
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const organizationStructuredData = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Spoiled Banana Society',
    url: SITE_URL,
    description:
      'Spoiled Banana Society powers SBSFantasy, an onchain best ball fantasy football drafting platform with prize contests.',
  };

  return (
    <html lang="en">
      <head>
        {/* Base.dev app verification (dashboard.base.org) */}
        <meta name="base:app_id" content="6a90abade727f5ee4f5f4a9f" />
        {/* Preload critical font to avoid render-blocking */}
        <link
          rel="preload"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          as="style"
        />
      </head>
      <body className="antialiased">
        {/* Skip to content — visible on focus for keyboard users */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:bg-[#F3E216] focus:text-black focus:px-4 focus:py-2 focus:rounded-lg focus:font-bold focus:text-sm"
        >
          Skip to main content
        </a>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationStructuredData) }}
        />
        <GoogleAnalytics />
        {/* Unregister stale service worker that was breaking Next.js navigation */}
        <script
          dangerouslySetInnerHTML={{
            __html: `if('serviceWorker' in navigator){navigator.serviceWorker.getRegistrations().then(function(r){r.forEach(function(reg){reg.unregister()})});caches.keys().then(function(k){k.forEach(function(n){caches.delete(n)})})}`
          }}
        />
        <ServiceNoticeBanner />
        <StyledComponentsRegistry>
          <Providers>
            <div className="flex flex-col min-h-screen">
              <div className="flex-1">{children}</div>
              <Footer />
            </div>
          </Providers>
        </StyledComponentsRegistry>
      </body>
    </html>
  );
}
