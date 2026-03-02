import * as jsonDb from './db-json';

// Always use JSON db for app data (contests, promos, etc.).
// Firestore is used directly by specific routes that need it (e.g. verify-twitter).
const db = jsonDb;

export const getPromos = db.getPromos;
export const claimPromo = db.claimPromo;
export const getReferralStats = db.getReferralStats;
export const generateReferralCode = db.generateReferralCode;
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
