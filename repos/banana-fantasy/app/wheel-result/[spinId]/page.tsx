import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';

const WHEEL_SPINS_COLLECTION = 'wheelSpins';

interface WheelSpinDoc {
  spinId: string;
  result: string;
  prize: { type: string; value: string | number };
  timestamp: string;
  /** Present on spins settled after SPIN_ON_PURCHASE: which stack it came from
   *  and the drafts actually credited (wedge minus one on purchase spins). */
  spinSource?: 'promo' | 'purchase';
  bonusDrafts?: number;
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

interface PrizeDisplay {
  headline: string;
  subheadline: string;
  imageSrc: string;
  imageAlt: string;
  accentColor: string;
  glowClass: string;
}

function displayForResult(result: string, spin?: Pick<WheelSpinDoc, 'spinSource' | 'bonusDrafts'>): PrizeDisplay {
  // Purchase-spin share cards must state what was CREDITED, not the wedge —
  // a Bonus Spin landing "5 Drafts" paid 4 (one is the draft they bought), and
  // a no-bonus result must never share as "1 DRAFT PASS" won.
  if (spin?.spinSource === 'purchase' && /^draft-\d+$/.test(result)) {
    const bonus = Math.max(0, spin.bonusDrafts ?? 0);
    if (bonus === 0) {
      return {
        headline: 'BONUS SPIN',
        subheadline: 'Every SBS draft entry comes with a free bonus spin',
        imageSrc: '/banana-wheel.png',
        imageAlt: 'Banana Wheel',
        accentColor: '#fbbf24',
        glowClass: 'glow-banana',
      };
    }
    return {
      headline: `+${bonus} BONUS DRAFT${bonus === 1 ? '' : 'S'}`,
      subheadline: 'Won on a free bonus spin — every SBS draft entry comes with one',
      imageSrc: '/banana-wheel.png',
      imageAlt: 'Banana Wheel',
      accentColor: '#fbbf24',
      glowClass: 'glow-banana',
    };
  }
  if (result === 'jackpot') {
    return {
      headline: 'JACKPOT',
      subheadline: 'Win the league → skip straight to the finals',
      imageSrc: '/jackpot-logo.png',
      imageAlt: 'Jackpot',
      accentColor: '#ef4444',
      glowClass: 'glow-jackpot',
    };
  }
  if (result === 'hof') {
    return {
      headline: 'HALL OF FAME',
      subheadline: 'Compete for bonus prizes on top of regular rewards',
      imageSrc: '/hof-logo.jpg',
      imageAlt: 'Hall of Fame',
      accentColor: '#D4AF37',
      glowClass: 'glow-hof',
    };
  }
  const m = result.match(/^draft-(\d+)$/);
  if (m) {
    const n = m[1];
    return {
      headline: `${n} DRAFT PASS${n === '1' ? '' : 'ES'}`,
      subheadline: 'Free drafts on SBS Fantasy',
      imageSrc: '/banana-wheel.png',
      imageAlt: 'Banana Wheel',
      accentColor: '#fbbf24',
      glowClass: 'glow-banana',
    };
  }
  return {
    headline: 'BANANA WHEEL SPIN',
    subheadline: 'Spin the Banana Wheel on SBS Fantasy',
    imageSrc: '/banana-wheel.png',
    imageAlt: 'Banana Wheel',
    accentColor: '#fbbf24',
    glowClass: 'glow-banana',
  };
}

export default async function WheelResultPage({ params }: { params: { spinId: string } }) {
  const spin = await fetchSpin(params.spinId);
  if (!spin) notFound();

  const display = displayForResult(spin.result, spin);

  return (
    <main className="min-h-screen bg-bg-primary flex items-center justify-center px-4 py-12">
      <div
        className={`glass-card ${display.glowClass} max-w-md w-full p-8 text-center space-y-6`}
        style={{ borderColor: `${display.accentColor}40` }}
      >
        <div className="flex justify-center">
          <Image
            src={display.imageSrc}
            alt={display.imageAlt}
            width={160}
            height={160}
            className={display.imageAlt === 'Hall of Fame' ? 'hof-gold-filter' : ''}
          />
        </div>
        <h1
          className="text-3xl font-bold tracking-tight"
          style={{ color: display.accentColor }}
        >
          {display.headline}
        </h1>
        <p className="text-sm text-text-secondary">{display.subheadline}</p>
        <div className="pt-4 border-t border-bg-tertiary">
          <p className="text-xs text-text-muted mb-3">
            Want a shot of your own?
          </p>
          <Link
            href="/banana-wheel"
            className="inline-block px-6 py-2.5 rounded-xl bg-banana text-black font-semibold hover:bg-banana/90 transition-colors"
          >
            Spin the Banana Wheel
          </Link>
        </div>
      </div>
    </main>
  );
}
