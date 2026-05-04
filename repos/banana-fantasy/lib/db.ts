import * as firestoreDb from './db-firestore';

// Use Firestore for all data — persists across Vercel serverless functions.
const db = firestoreDb;

export const getPromos = db.getPromos;
export const claimPromo = db.claimPromo;
export const updatePromo = db.updatePromo;
export const getReferralStats = db.getReferralStats;
export const generateReferralCode = db.generateReferralCode;
export const trackReferral = db.trackReferral;
export const updateReferralRewards = db.updateReferralRewards;
export const spinWheel = db.spinWheel;
export const getWheelHistory = db.getWheelHistory;
export const createPurchase = db.createPurchase;
export const verifyPurchase = db.verifyPurchase;
export const getPurchaseHistory = db.getPurchaseHistory;
export const createWithdrawal = db.createWithdrawal;
export const getWithdrawalsByUser = db.getWithdrawalsByUser;
export const getContests = db.getContests;
export const getContest = db.getContest;
export const getContestStandings = db.getContestStandings;
export const getExposure = db.getExposure;
export const getDraftHistory = db.getDraftHistory;
export const getQueueStatus = db.getQueueStatus;
export const joinQueue = db.joinQueue;
export const updateQueueRoundDraftId = db.updateQueueRoundDraftId;
export const updateQueueRoundStatus = db.updateQueueRoundStatus;
export const fillQueueRoundWithBots = db.fillQueueRoundWithBots;
export const resetQueue = db.resetQueue;
export const recordDraftCompletion = db.recordDraftCompletion;
export const recordPick10 = db.recordPick10;
export const recordJackpotHit = db.recordJackpotHit;
export const incrementMintPromos = db.incrementMintPromos;
export const incrementReferralPromos = db.incrementReferralPromos;
