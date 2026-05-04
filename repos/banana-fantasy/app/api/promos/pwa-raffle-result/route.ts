import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { generateSeed, seededRandomFloat } from '@/lib/rng';
import { json, jsonError, getSearchParam } from '@/lib/api/routeUtils';

export const dynamic = 'force-dynamic';

const ENTRIES_COLLECTION = 'pwa_install_entries';
const RESULTS_COLLECTION = 'pwa_raffle_results';
const PROMO_ID = 'pwa-install-promo';
const DRAW_TIME = '2026-04-01T02:00:00Z'; // PROMO_END + 2 hours
const SPINS_PRIZE = 5;

function isDrawTime(): boolean {
  return Date.now() >= new Date(DRAW_TIME).getTime();
}

/** GET — Fetch raffle result (triggers draw on first call after draw time) */
export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    const db = getAdminFirestore();
    const userId = getSearchParam(req, 'userId');

    // Always return entrant list for the animation
    const entriesSnapshot = await db.collection(ENTRIES_COLLECTION)
      .where('promoId', '==', PROMO_ID)
      .get();

    const entrants = entriesSnapshot.docs.map(doc => {
      const data = doc.data();
      return { wallet: data.wallet as string, userId: data.userId as string };
    });

    // If draw time hasn't passed, return waiting state
    if (!isDrawTime()) {
      return json({
        status: 'waiting',
        drawTime: DRAW_TIME,
        entrantCount: entrants.length,
        entrants: entrants.map(e => e.wallet),
      }, 200);
    }

    // No entries = no draw
    if (entrants.length === 0) {
      return json({ status: 'no_entries', drawTime: DRAW_TIME, entrantCount: 0, entrants: [] }, 200);
    }

    // Check if already drawn
    const resultRef = db.collection(RESULTS_COLLECTION).doc(PROMO_ID);
    const resultDoc = await resultRef.get();

    if (resultDoc.exists) {
      // Already drawn — return cached result
      const result = resultDoc.data()!;
      return json({
        status: 'drawn',
        winnerWallet: result.winnerWallet,
        winnerUserId: result.winnerUserId,
        isCurrentUserWinner: userId ? result.winnerUserId === userId : false,
        entrantCount: result.entrantCount,
        entrants: entrants.map(e => e.wallet),
        drawnAt: result.drawnAt,
        seed: result.seed,
        drawTime: DRAW_TIME,
      }, 200);
    }

    // First call after draw time — perform the draw atomically
    const seed = generateSeed();
    const roll = seededRandomFloat(seed);
    const winnerIndex = Math.floor(roll * entrants.length);
    const winner = entrants[winnerIndex];

    await db.runTransaction(async (tx) => {
      // Double-check no result written by another request
      const check = await tx.get(resultRef);
      if (check.exists) return; // Another request beat us — no-op

      // Write the raffle result
      tx.set(resultRef, {
        promoId: PROMO_ID,
        winnerUserId: winner.userId,
        winnerWallet: winner.wallet,
        drawnAt: new Date().toISOString(),
        entrantCount: entrants.length,
        seed,
      });

      // Award spins to winner
      const usersSnapshot = await tx.get(
        db.collection('v2_users').where('id', '==', winner.userId).limit(1)
      );
      if (!usersSnapshot.empty) {
        const userDoc = usersSnapshot.docs[0];
        const currentSpins = (userDoc.data().wheelSpins as number) || 0;
        tx.update(userDoc.ref, { wheelSpins: currentSpins + SPINS_PRIZE });
      }
    });

    // Re-read the result (in case another request wrote it)
    const finalDoc = await resultRef.get();
    const finalResult = finalDoc.data()!;

    return json({
      status: 'drawn',
      winnerWallet: finalResult.winnerWallet,
      winnerUserId: finalResult.winnerUserId,
      isCurrentUserWinner: userId ? finalResult.winnerUserId === userId : false,
      entrantCount: finalResult.entrantCount,
      entrants: entrants.map(e => e.wallet),
      drawnAt: finalResult.drawnAt,
      seed: finalResult.seed,
      drawTime: DRAW_TIME,
    }, 200);
  } catch (err) {
    console.error('[pwa-raffle-result GET]', err);
    return jsonError('Internal Server Error', 500);
  }
}
