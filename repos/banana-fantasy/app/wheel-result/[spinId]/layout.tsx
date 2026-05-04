import type { Metadata } from 'next';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';

const WHEEL_SPINS_COLLECTION = 'wheelSpins';
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://banana-fantasy-sbs.vercel.app';

interface WheelSpinDoc {
  userId: string;
  spinId: string;
  result: string;
  prize: { type: string; value: string | number };
  timestamp: string;
}

async function fetchSpin(spinId: string): Promise<WheelSpinDoc | null> {
  if (!isFirestoreConfigured()) return null;
  try {
    const db = getAdminFirestore();
    const snap = await db.collection(WHEEL_SPINS_COLLECTION).doc(spinId).get();
    if (!snap.exists) return null;
    return snap.data() as WheelSpinDoc;
  } catch {
    return null;
  }
}

interface PrizeCopy {
  title: string;
  description: string;
  image: string;
  video?: string; // absolute URL to MP4
}

function prizeCopy(result: string): PrizeCopy {
  if (result === 'jackpot') {
    return {
      title: 'JACKPOT on the Banana Wheel 🎰',
      description: 'Win the league → skip straight to the finals. Come spin yours on SBS Fantasy.',
      image: `${SITE_URL}/jackpot-logo.png`,
      video: `${SITE_URL}/slots/jackpot.mp4`,
    };
  }
  if (result === 'hof') {
    return {
      title: 'Hall of Fame draft unlocked 🏆',
      description: 'Competing for bonus prizes on SBS Fantasy. Spin the Banana Wheel for your shot.',
      image: `${SITE_URL}/hof-logo.jpg`,
      video: `${SITE_URL}/slots/hof.mp4`,
    };
  }
  const m = result.match(/^draft-(\d+)$/);
  if (m) {
    const n = m[1];
    return {
      title: `Won ${n} draft pass${n === '1' ? '' : 'es'} on the Banana Wheel 🍌`,
      description: 'Spin the Banana Wheel on SBS Fantasy for free drafts, HOF entries, and Jackpot shots.',
      image: `${SITE_URL}/banana-wheel.png`,
    };
  }
  return {
    title: 'Banana Wheel Spin 🍌',
    description: 'Spin the Banana Wheel on SBS Fantasy for free drafts, HOF entries, and Jackpot shots.',
    image: `${SITE_URL}/banana-wheel.png`,
  };
}

export async function generateMetadata(
  { params }: { params: { spinId: string } },
): Promise<Metadata> {
  const spin = await fetchSpin(params.spinId);
  const copy = prizeCopy(spin?.result ?? '');

  const base: Metadata = {
    title: copy.title,
    description: copy.description,
    openGraph: {
      title: copy.title,
      description: copy.description,
      images: [{ url: copy.image, alt: copy.title }],
      ...(copy.video
        ? {
            videos: [
              {
                url: copy.video,
                type: 'video/mp4',
                width: 720,
                height: 720,
              },
            ],
          }
        : {}),
    },
    twitter: {
      card: copy.video ? 'player' : 'summary_large_image',
      title: copy.title,
      description: copy.description,
      images: [copy.image],
      ...(copy.video
        ? {
            players: [
              {
                playerUrl: `${SITE_URL}/wheel-result/${params.spinId}/player`,
                streamUrl: copy.video,
                width: 720,
                height: 720,
              },
            ],
          }
        : {}),
    },
  };

  return base;
}

export default function WheelResultLayout({ children }: { children: React.ReactNode }) {
  return children;
}
