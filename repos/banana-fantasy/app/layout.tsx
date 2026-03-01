import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from './providers';
import StyledComponentsRegistry from '@/lib/registry';
import GoogleAnalytics from './components/GoogleAnalytics';
import { StagingBanner } from '@/components/StagingBanner';
import { Footer } from '@/components/layout/Footer';
// import ServiceWorkerRegistration from '@/components/ServiceWorkerRegistration';
// import PWAInstallPrompt from '@/components/PWAInstallPrompt';

const SITE_URL = 'https://bananafantasy.com';
const SITE_NAME = 'Banana Fantasy';
const DEFAULT_TITLE = 'Banana Fantasy | Onchain Best Ball Fantasy Football Drafts';
const DEFAULT_DESCRIPTION =
  'Draft best ball teams onchain, enter Spoiled Banana Society contests, and compete for prizes across fast and slow fantasy football drafts.';
const DEFAULT_OG_IMAGE = '/bestball.webp';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: DEFAULT_TITLE,
    template: '%s | Banana Fantasy',
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
        alt: 'Banana Fantasy best ball drafting platform',
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
    title: 'Banana Fantasy',
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
      'Spoiled Banana Society powers Banana Fantasy, an onchain best ball fantasy football drafting platform with prize contests.',
  };

  return (
    <html lang="en">
      <head>
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
        <StagingBanner />
        <StyledComponentsRegistry>
          <Providers>
            <div className="flex flex-col min-h-screen">
              <div className="flex-1">{children}</div>
              <Footer />
            </div>
            {/* <PWAInstallPrompt /> */}
          </Providers>
        </StyledComponentsRegistry>
      </body>
    </html>
  );
}
