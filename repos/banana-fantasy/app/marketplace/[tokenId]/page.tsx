'use client';

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { useSendTransaction, useWallets, useFundWallet } from '@privy-io/react-auth';
import { useAuth } from '@/hooks/useAuth';
import { ensureBaseNetwork } from '@/lib/ensureBaseNetwork';
import { friendlyTxError } from '@/lib/marketplace/txErrors';
import { resolveWalletFallback } from '@/lib/marketplace/walletFallback';
import { bananaPlaceholderName } from '@/utils/helpers';
import { useNftOffers, useTokenSaleHistory, logActivity, notifySeller, notifyOwnerOfOffer, notifyOffererOfAcceptance } from '@/hooks/useMarketplace';
import { useListTeam } from '@/hooks/useListTeam';
import { useFounderTeams } from '@/hooks/useFounderTeams';
import { useNotifications } from '@/components/NotificationCenter';
import { SbsPassThumb } from '@/components/marketplace/SbsPassThumb';
import { PaymentMethodSquares } from '@/components/marketplace/PaymentMethodSquares';
import { BASE_SEPOLIA, getUsdcBalance } from '@/lib/contracts/bbb4';
import type { Address } from 'viem';
import type { DraftType, OfferData } from '@/lib/opensea';
import { BBB4_CONTRACT, resolveLeagueNumber } from '@/lib/opensea';
import { buildTieredDraftPassUrl } from '@/lib/nftCard';
import { hasSeasonStarted } from '@/lib/draftTypes';
import { reportClientError } from '@/lib/clientErrors';
import { clientLog } from '@/lib/clientLog';
import { LOG_SOURCES } from '@/lib/logSources';
import { UserPopover } from '@/components/social/UserPopover';
import { AvatarWithBadge } from '@/components/badges/AvatarWithBadge';
import type { Ripeness } from '@/types';
import { logger } from '@/lib/logger';

interface NftTrait {
  trait_type: string;
  value: string | number;
}

interface NftDetail {
  identifier: string;
  name: string | null;
  description: string | null;
  image_url: string | null;
  display_image_url: string | null;
  traits: NftTrait[];
  owner: string | null;
  ownerName: string | null;
  ownerPfp: string | null;
  ownerBadge?: string | null;
  ownerRipeness?: Ripeness | null;
  pricePaid?: number | null;
  listing: {
    order_hash: string;
    protocol_address: string;
    price: { current: { value: string; decimals: number } };
    protocol_data: { parameters: { offerer: string; endTime?: string; startTime?: string } };
  } | null;
  team?: {
    leagueId: string;
    leagueDisplayName: string;
    level: string;
    rank: string;
    seasonScore: string;
    weekScore: string;
    source: 'cardid_match' | 'firestore_map';
  } | null;
}

const ROSTER_KEYS = [
  'QB1', 'QB2', 'RB1', 'RB2', 'RB3',
  'WR1', 'WR2', 'WR3',
  'TE1', 'TE2', 'TE3', 'TE4',
  'DST1', 'DST2', 'DST3',
];

const POS_COLORS: Record<string, string> = {
  QB: 'bg-red-500/20 text-red-400 border-red-500/30',
  RB: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  WR: 'bg-green-500/20 text-green-400 border-green-500/30',
  TE: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  DST: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
};

function getPositionColor(slot: string): string {
  const pos = slot.replace(/[0-9]/g, '');
  return POS_COLORS[pos] || 'bg-bg-tertiary text-text-secondary border-bg-tertiary';
}

function parseTrait(traits: NftTrait[], key: string): string {
  const t = traits.find(t => t.trait_type === key);
  return t ? String(t.value) : '';
}

function timeUntil(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'Expired';
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/** Human "time left" for a Seaport order's endTime (Unix seconds string). */
function formatExpiresIn(endTimeSec?: string): string | null {
  if (!endTimeSec) return null;
  const end = Number(endTimeSec) * 1000;
  if (!Number.isFinite(end) || end <= 0) return null;
  const diff = end - Date.now();
  if (diff <= 0) return 'Expired';
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

// How long a listing stays live before OpenSea expires it. The user picks one;
// the value flows into the Seaport order's endTime at sign time. OpenSea caps
// listings at ~6 months, so 90 days is comfortably inside that.
const LISTING_DURATIONS: Array<{ label: string; seconds: number }> = [
  { label: '1 day', seconds: 1 * 24 * 3600 },
  { label: '3 days', seconds: 3 * 24 * 3600 },
  { label: '7 days', seconds: 7 * 24 * 3600 },
  { label: '14 days', seconds: 14 * 24 * 3600 },
  { label: '30 days', seconds: 30 * 24 * 3600 },
  { label: '90 days', seconds: 90 * 24 * 3600 },
];
const DEFAULT_LISTING_SECONDS = 30 * 24 * 3600;

export default function NftDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  // Return to the marketplace page/tab the user came FROM (it stores its tab +
  // filter in the URL), not the default Listed view. history.back() restores
  // that exact URL; fall back to /marketplace if they deep-linked here.
  const goBackToMarketplace = useCallback(() => {
    // Scroll restore is handled by the marketplace itself (it detects it arrived
    // from a team page via getLastPath, for button + browser back alike). Here we
    // just return to the tab/filter the user came from — history.back restores it.
    if (typeof window !== 'undefined' && window.history.length > 1 && document.referrer.includes('/marketplace')) {
      router.back();
    } else {
      router.push('/marketplace');
    }
  }, [router]);
  const tokenId = (params?.tokenId as string) ?? '';
  const autoBuy = searchParams?.get('buy') === 'true';
  const autoOffer = searchParams?.get('offer') === 'true';
  // Arriving from the "Review" button on Offers-on-Your-Teams: jump straight to
  // the Offers section so the owner can Accept without scrolling the whole page.
  const reviewOffers = searchParams?.get('review') === 'offers';
  const offersSectionRef = React.useRef<HTMLDivElement>(null);
  const { isLoggedIn, walletAddress, user, setShowLoginModal, isEmbeddedWallet } = useAuth();
  const { wallets, ready: walletsReady } = useWallets();
  const { sendTransaction } = useSendTransaction();
  const { fundWallet } = useFundWallet();
  const { addNotification } = useNotifications();

  const selectedWallet = useMemo(() => {
    if (wallets.length === 0) return null;
    if (walletAddress) {
      return wallets.find(w => w.address.toLowerCase() === walletAddress.toLowerCase()) || wallets[0];
    }
    return wallets[0];
  }, [walletAddress, wallets]);

  // Route transactions by wallet type — same pattern as marketplace/page.tsx.
  // Privy's useSendTransaction with sponsor:true is gasless but ONLY works for
  // embedded Privy wallets; calling it with an external wallet (MetaMask,
  // Coinbase) throws "No embedded or connected wallet found for address."
  // External wallets sign via their own provider and pay their own gas.
  const sendTx = useCallback(async (
    txRequest: { to: `0x${string}`; data?: `0x${string}`; value?: bigint; chainId: number },
    // opts.wallet: mobile external-wallet fallback (see resolveWalletFallback) —
    // handlers resolve a signer when useWallets() is empty and pass it here,
    // since this closure's selectedWallet is null in exactly that case.
    opts: { description: string; waitForReceipt?: boolean; wallet?: typeof selectedWallet },
  ): Promise<{ hash: string }> => {
    const activeWallet = opts.wallet ?? selectedWallet;
    if (!activeWallet) throw new Error('No wallet connected');

    if (activeWallet.walletClientType === 'privy') {
      const receipt = await sendTransaction(
        txRequest,
        // Embedded (web2) wallets sign silently — zero-friction buy/sell/offer.
        { sponsor: true, uiOptions: { description: opts.description, showWalletUIs: false } },
      );
      const r = receipt as Record<string, unknown>;
      return { hash: String(r.hash ?? r.transactionHash ?? '') };
    }

    const ethereum = await activeWallet.getEthereumProvider();
    const currentChainHex = (await ethereum.request({ method: 'eth_chainId' })) as string;
    if (parseInt(currentChainHex, 16) !== txRequest.chainId) {
      await activeWallet.switchChain(txRequest.chainId);
    }
    const { ethers } = await import('ethers');
    const provider = new ethers.BrowserProvider(ethereum);
    const signer = await provider.getSigner();
    const tx = await signer.sendTransaction({
      to: txRequest.to,
      data: txRequest.data,
      value: txRequest.value,
    });
    if (opts.waitForReceipt) await tx.wait();
    return { hash: tx.hash };
  }, [selectedWallet, sendTransaction]);

  const [nft, setNft] = useState<NftDetail | null>(null);
  // Founder-draft team? (one batched check; team leagueId == founder draftId)
  const founderTeamIds = useFounderTeams(
    tokenId ? [{ tokenId, owner: nft?.owner ?? null, leagueId: nft?.team?.leagueId ?? null }] : [],
  );
  const isFounderTeam = founderTeamIds.has(tokenId);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Wheel-won JP/HOF level for a pass still in a filling round — drives the
  // tier-styled card art so the detail/listing page matches the Sell grid.
  const [fillingLevel, setFillingLevel] = useState<'hof' | 'jackpot' | null>(null);
  const [buyStep, setBuyStep] = useState<'confirm' | 'processing' | 'complete'>('confirm');
  // Set true to abort a card buy that's stuck waiting on MoonPay funds (user
  // bailed). The funds-polling loop checks it so the user can close the modal.
  const cancelBuyRef = useRef(false);
  const cancelBuy = useCallback(() => {
    cancelBuyRef.current = true;
    setCardFlowStep('idle');
    setBuyStep('confirm');
    setShowBuyModal(false);
  }, []);
  const [txError, setTxError] = useState<string | null>(null);
  const [showBuyModal, setShowBuyModal] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'card' | 'usdc'>('card');
  const [cardFlowStep, setCardFlowStep] = useState<'idle' | 'funding' | 'waiting' | 'buying'>('idle');

  // Offer state
  const [showOfferModal, setShowOfferModal] = useState(false);
  const [offerAmount, setOfferAmount] = useState('');
  const [offerExpiration, setOfferExpiration] = useState(7);
  const [offerPaymentMethod, setOfferPaymentMethod] = useState<'card' | 'usdc'>('usdc');
  const [showCustomExpiry, setShowCustomExpiry] = useState(false);
  const [customExpiryAmount, setCustomExpiryAmount] = useState('');
  const [customExpiryUnit, setCustomExpiryUnit] = useState<'hours' | 'days'>('hours');

  // Owner-side listing controls (list / cancel for the team's owner).
  const { listTeam, cancelTeam, busy: listBusy, error: listError } = useListTeam(walletAddress);
  const [ownerListPrice, setOwnerListPrice] = useState('');
  const [listDurationSeconds, setListDurationSeconds] = useState(DEFAULT_LISTING_SECONDS);
  const [offerStep, setOfferStep] = useState<'input' | 'processing' | 'complete'>('input');
  const [offerError, setOfferError] = useState<string | null>(null);
  // Bail out of a card-funded offer stuck waiting on MoonPay funds.
  const cancelOfferRef = useRef(false);
  const cancelOffer = useCallback(() => {
    cancelOfferRef.current = true;
    setOfferStep('input');
    setShowOfferModal(false);
  }, []);

  // Accept offer state
  const [acceptingOfferHash, setAcceptingOfferHash] = useState<string | null>(null);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  // Cancel offer state
  const [cancellingOfferHash, setCancellingOfferHash] = useState<string | null>(null);
  const [cancellingAllOffers, setCancellingAllOffers] = useState(false);

  // Share state
  const [shareCopied, setShareCopied] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false);

  // Activity feed (sales + listings) filter + truncation.
  const [activityFilter, setActivityFilter] = useState<'all' | 'sales' | 'listings'>('all');
  const [activityExpanded, setActivityExpanded] = useState(false);

  // Offers data
  const { offers, isLoading: offersLoading, refetch: refetchOffers, bestOffer } = useNftOffers(tokenId);

  // Activity feed: sales + listings, newest first.
  const { activities: saleHistory, isLoading: saleHistoryLoading } = useTokenSaleHistory(tokenId);

  // Normalize raw activity rows into display items. A sale is logged twice (a
  // 'buy' by the buyer + a 'sell' by the seller, same txHash) — collapse those
  // into a single "Sold" row so the feed reads cleanly.
  const activityItems = useMemo(() => {
    const buyTxs = new Set(
      saleHistory.filter(a => a.type === 'buy' && a.txHash).map(a => a.txHash as string),
    );
    type Item = { id: string; kind: 'sale' | 'listing' | 'delisting'; label: string; price: number | null; who: string | null; seller: string | null; timestamp: string };
    const items: Item[] = [];
    for (const a of saleHistory) {
      if (a.type === 'sell' && a.txHash && buyTxs.has(a.txHash)) continue; // dup of a buy
      if (a.type === 'buy' || a.type === 'sell') {
        // Keep BOTH sides so the row can show the viewer's own role (bought vs sold).
        const buyer = a.type === 'buy' ? a.walletAddress : a.counterparty;
        const seller = a.type === 'buy' ? a.counterparty : a.walletAddress;
        items.push({ id: a.id, kind: 'sale', label: 'Sold', price: a.price, who: buyer, seller, timestamp: a.timestamp });
      } else if (a.type === 'offer_accepted') {
        // Offer acceptance IS a sale: the owner (walletAddress) sold to the
        // offerer (counterparty). Without this the sale never showed in the feed.
        items.push({ id: a.id, kind: 'sale', label: 'Sold', price: a.price, who: a.counterparty, seller: a.walletAddress, timestamp: a.timestamp });
      } else if (a.type === 'list') {
        items.push({ id: a.id, kind: 'listing', label: 'Listed', price: a.price, who: a.walletAddress, seller: null, timestamp: a.timestamp });
      } else if (a.type === 'cancel') {
        items.push({ id: a.id, kind: 'delisting', label: 'Listing removed', price: null, who: a.walletAddress, seller: null, timestamp: a.timestamp });
      }
    }
    return items;
  }, [saleHistory]);

  const filteredActivity = useMemo(() => {
    if (activityFilter === 'sales') return activityItems.filter(i => i.kind === 'sale');
    if (activityFilter === 'listings') return activityItems.filter(i => i.kind === 'listing' || i.kind === 'delisting');
    return activityItems;
  }, [activityItems, activityFilter]);

  // Resolve the buyer/seller wallets in the sale history to usernames so rows
  // read "from Boris" instead of raw hex. Guarded by `namesResolvedRef` (each
  // wallet fetched once) so it never loops — Rule #0 safe.
  const [nameMap, setNameMap] = useState<Record<string, string>>({});
  const namesResolvedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const wallets = Array.from(new Set(
      activityItems.flatMap(i => [i.who, i.seller]).filter(Boolean) as string[],
    )).map(w => w.toLowerCase());
    const missing = wallets.filter(w => /^0x[0-9a-fA-F]{40}$/.test(w) && !namesResolvedRef.current.has(w));
    if (missing.length === 0) return;
    missing.forEach(w => namesResolvedRef.current.add(w));
    let cancelled = false;
    fetch(`/api/marketplace/resolve-users?wallets=${missing.join(',')}`)
      .then(r => (r.ok ? r.json() : { names: {} }))
      .then((d: { names?: Record<string, string> }) => { if (!cancelled && d.names) setNameMap(prev => ({ ...prev, ...d.names })); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activityItems]);

  const nameFor = (w?: string | null) => {
    if (!w) return '';
    return nameMap[w.toLowerCase()] || bananaPlaceholderName(w);
  };

  const ACTIVITY_PREVIEW = 5;
  const visibleActivity = activityExpanded ? filteredActivity : filteredActivity.slice(0, ACTIVITY_PREVIEW);

  const fetchNft = useCallback((opts?: { silent?: boolean }) => {
    if (!tokenId) return;
    // Silent refetches (the post-landing OpenSea-lag re-checks) update the data
    // in the background WITHOUT flipping the loading state — otherwise the page
    // visibly "refreshes" a couple times on its own after landing.
    if (!opts?.silent) setIsLoading(true);
    // Pass the viewer's wallet so the API can fall back to our backend when
    // OpenSea hasn't revealed a freshly-drafted team yet (a few-minute lag) —
    // the person viewing their own new team is its owner.
    const q = walletAddress ? `?owner=${walletAddress}` : '';
    fetch(`/api/marketplace/nft/${tokenId}${q}`)
      .then(res => {
        if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
        return res.json();
      })
      .then(data => { setNft(data); setError(null); })
      .catch(err => setError(err.message))
      .finally(() => { if (!opts?.silent) setIsLoading(false); });
  }, [tokenId, walletAddress]);

  const handleOwnerList = useCallback(async () => {
    if (!isLoggedIn) { setShowLoginModal(true); return; }
    const p = parseFloat(ownerListPrice);
    if (!Number.isFinite(p) || p <= 0) return;
    try {
      const res = await listTeam(tokenId, p, listDurationSeconds);
      setOwnerListPrice('');
      // Optimistically show it as listed; delay the reconciling refetch so a
      // stale OpenSea read can't overwrite this before it has indexed.
      setNft(prev => prev ? {
        ...prev,
        listing: {
          order_hash: res.orderHash,
          protocol_address: '',
          price: { current: { value: String(Math.round(res.price * 1e6)), decimals: 6 } },
          protocol_data: { parameters: { offerer: walletAddress ?? '', endTime: String(Math.floor(Date.now() / 1000) + listDurationSeconds) } },
        },
      } : prev);
      setTimeout(() => fetchNft(), 12000);
    } catch { /* listError surfaces the message */ }
  }, [isLoggedIn, setShowLoginModal, ownerListPrice, listTeam, tokenId, fetchNft, walletAddress, listDurationSeconds]);

  const handleOwnerCancel = useCallback(async () => {
    const orderHash = nft?.listing?.order_hash;
    if (!orderHash) return;
    try {
      await cancelTeam(tokenId, orderHash);
      // Optimistically clear the listing; reconcile once OpenSea drops it.
      setNft(prev => prev ? { ...prev, listing: null } : prev);
      setTimeout(() => fetchNft(), 12000);
    } catch { /* listError surfaces the message */ }
  }, [nft, cancelTeam, tokenId, fetchNft]);

  // Change the price of an active listing. A Seaport order's price is immutable,
  // so under the hood this cancels the old order and creates a fresh one at the
  // new price — presented as a single "Update Price" action so it feels like an
  // in-place edit (no separate cancel + re-list dance for the user).
  const handleOwnerUpdatePrice = useCallback(async () => {
    if (!isLoggedIn) { setShowLoginModal(true); return; }
    const p = parseFloat(ownerListPrice);
    if (!Number.isFinite(p) || p <= 0) return;
    const orderHash = nft?.listing?.order_hash;
    if (!orderHash) return;
    try {
      await cancelTeam(tokenId, orderHash);
      const res = await listTeam(tokenId, p, listDurationSeconds);
      setOwnerListPrice('');
      setNft(prev => prev ? {
        ...prev,
        listing: {
          order_hash: res.orderHash,
          protocol_address: '',
          price: { current: { value: String(Math.round(res.price * 1e6)), decimals: 6 } },
          protocol_data: { parameters: { offerer: walletAddress ?? '', endTime: String(Math.floor(Date.now() / 1000) + listDurationSeconds) } },
        },
      } : prev);
      setTimeout(() => fetchNft(), 12000);
    } catch {
      // listError surfaces the message. But if the cancel succeeded and only the
      // re-list failed, the team is now delisted on-chain while the UI still shows
      // the old listing — reconcile from chain so it doesn't show a phantom price.
      fetchNft();
    }
  }, [isLoggedIn, setShowLoginModal, ownerListPrice, nft, cancelTeam, listTeam, tokenId, fetchNft, walletAddress, listDurationSeconds]);

  useEffect(() => {
    fetchNft();
  }, [fetchNft]);

  // OpenSea lags a few seconds indexing a just-created/cancelled listing, so a
  // fresh page load can show the wrong listing state (e.g. "List for Sale" on a
  // team you just listed). Re-check a couple times shortly after landing so it
  // self-corrects without a manual refresh.
  useEffect(() => {
    if (!tokenId) return;
    const t1 = setTimeout(() => fetchNft({ silent: true }), 7000);
    const t2 = setTimeout(() => fetchNft({ silent: true }), 15000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [tokenId, fetchNft]);

  // One-shot: is this token a wheel-won JP/HOF pass still in a filling round?
  // If so, render the tier-styled card art (matches the Sell grid). Deps are a
  // stable scalar only (tokenId) — no Privy-derived callback (Rule #0).
  useEffect(() => {
    if (!tokenId) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/queues/wheel-pass-filling?tokenIds=${tokenId}`);
        if (!r.ok) return;
        const lvl = ((await r.json()) as { levels?: Record<string, 'hof' | 'jackpot'> }).levels?.[tokenId];
        if (!cancelled && (lvl === 'hof' || lvl === 'jackpot')) setFillingLevel(lvl);
      } catch { /* best-effort — falls back to the normal image */ }
    })();
    return () => { cancelled = true; };
  }, [tokenId]);

  // Auto-refresh OpenSea metadata once per tokenId when traits look stale
  // (no LEAGUE-NAME and no roster slots). OpenSea sometimes serves a cached
  // response from before the draft completed; nudging it to re-pull from
  // our metadata endpoint usually fixes it within a few seconds.
  const refreshAttemptedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!tokenId || !nft || isLoading) return;
    if (refreshAttemptedRef.current.has(tokenId)) return;

    const traits = Array.isArray(nft.traits) ? nft.traits : [];
    const hasLeagueName = traits.some(t => t.trait_type === 'LEAGUE-NAME');
    const hasRoster = traits.some(t => /^(QB|RB|WR|TE|DST)\d+$/.test(t.trait_type));
    if (hasLeagueName || hasRoster) return;

    refreshAttemptedRef.current.add(tokenId);
    fetch(`/api/marketplace/refresh/${tokenId}`, { method: 'POST' })
      .then(res => { if (res.ok) setTimeout(() => fetchNft({ silent: true }), 5000); })
      .catch(() => { /* refresh is best-effort */ });
  }, [tokenId, nft, isLoading, fetchNft]);

  const getShareText = useCallback(() => {
    const url = window.location.href;
    const name = nft?.name || `Team #${tokenId}`;
    const listing = nft?.listing;
    const buyPrice = listing?.price?.current
      ? Number(listing.price.current.value) / Math.pow(10, listing.price.current.decimals ?? 18)
      : null;
    const text = `Check out ${name}${buyPrice ? ` - $${buyPrice.toFixed(2)}` : ''} on SBS Marketplace`;
    return { text, url };
  }, [nft, tokenId]);

  const handleShareX = useCallback(() => {
    const { text, url } = getShareText();
    window.open(`https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, '_blank');
    setShowShareMenu(false);
  }, [getShareText]);

  const handleCopyLink = useCallback(async () => {
    const { text, url } = getShareText();
    await navigator.clipboard.writeText(`${text}\n${url}`);
    setShareCopied(true);
    setShowShareMenu(false);
    setTimeout(() => setShareCopied(false), 2000);
  }, [getShareText]);

  // Auto-trigger buy flow when navigated with ?buy=true
  const buyTriggered = React.useRef(false);
  useEffect(() => {
    if (autoBuy && nft?.listing && isLoggedIn && !buyTriggered.current && !showBuyModal) {
      buyTriggered.current = true;
      const timer = setTimeout(() => {
        setBuyStep('confirm');
        setTxError(null);
        setShowBuyModal(true);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [autoBuy, nft, isLoggedIn, showBuyModal]);

  // Auto-open offer modal when navigated with ?offer=true
  const offerTriggered = React.useRef(false);
  useEffect(() => {
    if (autoOffer && nft && isLoggedIn && !offerTriggered.current) {
      offerTriggered.current = true;
      setShowOfferModal(true);
    }
  }, [autoOffer, nft, isLoggedIn]);

  // Navigated via "Review" (?review=offers): scroll straight to the Offers
  // section once it's rendered, so accepting an offer is one tap, no scrolling.
  const reviewScrolled = React.useRef(false);
  useEffect(() => {
    if (reviewOffers && !reviewScrolled.current && offersSectionRef.current && (offers.length > 0 || !offersLoading)) {
      reviewScrolled.current = true;
      offersSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [reviewOffers, offers.length, offersLoading]);

  const executeBuy = useCallback(async () => {
    if (!nft?.listing?.order_hash || !nft?.listing?.protocol_address || !walletAddress) return;

    const buyPrice = nft.listing?.price?.current
      ? Number(nft.listing.price.current.value) / Math.pow(10, nft.listing.price.current.decimals ?? 18)
      : null;

    // Mobile external wallet: useWallets() can be empty for a logged-in user
    // (wallet-SDK login never registers with Privy — ticket-2681). Without
    // this, the buy falls into the embedded branch below and dies at sendTx
    // with "No wallet connected". Recover the signer like the mint flow does.
    let activeWallet = selectedWallet;
    if (!activeWallet && !isEmbeddedWallet) {
      activeWallet = (await resolveWalletFallback(walletAddress, 'buy')) as unknown as typeof selectedWallet;
    }

    let txHashResult: string;
    if (activeWallet && activeWallet.walletClientType !== 'privy' && nft.listing?.price?.current?.value) {
      // External wallet (MetaMask, Coinbase, …): gasless relay. One free
      // permit signature; the server pulls the USDC and fulfills the Seaport
      // order with the NFT delivered straight to this wallet. No ETH needed.
      const { relayBuyExternal } = await import('@/lib/marketplace/relay');
      const receipt = await relayBuyExternal({
        wallet: activeWallet,
        orderHash: nft.listing.order_hash,
        protocolAddress: nft.listing.protocol_address,
        priceWei: BigInt(nft.listing.price.current.value),
      });
      txHashResult = receipt.hash;
    } else {
      const { getFulfillmentTx } = await import('@/lib/marketplace/buy');
      const tx = await getFulfillmentTx(
        nft.listing.order_hash,
        walletAddress,
        nft.listing.protocol_address,
      );
      const receipt = await sendTx(
        { to: tx.to as `0x${string}`, value: BigInt(tx.value), data: tx.data as `0x${string}`, chainId: 8453 },
        { description: 'Purchase NFT — gas fees covered by SBS', wallet: activeWallet },
      );
      txHashResult = receipt.hash;
    }

    const sellerAddr = nft.listing?.protocol_data?.parameters?.offerer || nft.owner;

    // The purchase consumed the seller's order — mark it dead in our listing
    // cache (keyed by tokenId) so it no longer reads as "Listed" for the buyer.
    void fetch('/api/marketplace/listings/cancelled', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokenId, wallet: sellerAddr || walletAddress }),
    }).catch(() => { /* best-effort */ });

    if (sellerAddr) {
      notifySeller({
        sellerWallet: sellerAddr,
        tokenId,
        teamName: nft.name || `Team #${tokenId}`,
        price: buyPrice || 0,
        buyerWallet: walletAddress,
      });
    }

    logActivity({
      type: 'buy',
      walletAddress,
      tokenId,
      teamName: nft.name || `Team #${tokenId}`,
      price: buyPrice,
      counterparty: nft.listing?.protocol_data?.parameters?.offerer || null,
      orderHash: nft.listing?.order_hash || null,
      txHash: txHashResult ? String(txHashResult) : null,
    });

    if (sellerAddr) {
      logActivity({
        type: 'sell',
        walletAddress: sellerAddr,
        tokenId,
        teamName: nft.name || `Team #${tokenId}`,
        price: buyPrice,
        counterparty: walletAddress,
        orderHash: nft.listing?.order_hash || null,
        txHash: txHashResult ? String(txHashResult) : null,
      });
    }

    addNotification({
      type: 'purchase_complete',
      title: 'Purchase Complete',
      message: `You bought ${nft.name || `Team #${tokenId}`} for $${(buyPrice || 0).toFixed(2)}`,
      link: `/marketplace/${tokenId}`,
    });

    return txHashResult;
  }, [nft, walletAddress, sendTx, tokenId, addNotification, selectedWallet, isEmbeddedWallet]);

  const handleBuy = useCallback(async () => {
    if (!nft?.listing?.order_hash || !nft?.listing?.protocol_address || !walletAddress) return;

    const buyPrice = nft.listing?.price?.current
      ? Number(nft.listing.price.current.value) / Math.pow(10, nft.listing.price.current.decimals ?? 18)
      : 0;

    if (paymentMethod === 'usdc') {
      setBuyStep('processing');
      setTxError(null);
      try {
        const { checkUsdcBalance } = await import('@/lib/marketplace/buy');
        const { sufficient, balance } = await checkUsdcBalance(walletAddress, buyPrice);
        if (!sufficient) {
          setTxError(`Insufficient balance. You have $${balance.toFixed(2)} but need $${buyPrice.toFixed(2)}.`);
          setBuyStep('confirm');
          return;
        }

        await executeBuy();
        // Bought a still-filling wheel pass → move the queue slot to us so the
        // draft shows on our drafting page (server verifies on-chain ownership).
        if (fillingLevel && walletAddress) {
          try {
            await fetch('/api/queues/reassign-pass', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tokenId, wallet: walletAddress }) });
          } catch { /* best-effort */ }
        }
        setBuyStep('complete');
        setTimeout(() => fetchNft(), 2000);
      } catch (err) {
        console.error('[NFT Detail] Buy failed:', err);
        setTxError(friendlyTxError(err, "We couldn't confirm your purchase. If any USDC left your wallet, it's returned automatically within a few minutes — check your balance before trying again."));
        setBuyStep('confirm');
      }
    } else {
      // Card flow via MoonPay
      setTxError(null);
      setCardFlowStep('funding');
      setBuyStep('processing');

      try {
        cancelBuyRef.current = false;
        const result = await fundWallet({
          address: walletAddress,
          options: {
            chain: BASE_SEPOLIA,
            amount: String(buyPrice),
            asset: 'USDC',
            defaultFundingMethod: 'card',
            card: { preferredProvider: 'moonpay' },
          },
        });

        if (cancelBuyRef.current || result.status === 'cancelled') {
          cancelBuyRef.current = false;
          setCardFlowStep('idle');
          setBuyStep('confirm');
          return;
        }

        // Poll for USDC arrival
        setCardFlowStep('waiting');
        const requiredUsdc = BigInt(Math.ceil(buyPrice * 1e6));
        const startTime = Date.now();
        const maxWait = 300_000;

        while (Date.now() - startTime < maxWait) {
          if (cancelBuyRef.current) { cancelBuyRef.current = false; setCardFlowStep('idle'); setBuyStep('confirm'); return; }
          const balance = await getUsdcBalance(walletAddress as Address);
          if (balance >= requiredUsdc) break;
          await new Promise(r => setTimeout(r, 3000));
        }

        // Execute Seaport buy
        setCardFlowStep('buying');
        await executeBuy();

        // Bought a still-filling wheel pass → move the queue slot to us (server
        // verifies on-chain ownership) so the draft shows on our drafting page.
        if (fillingLevel && walletAddress) {
          try {
            await fetch('/api/queues/reassign-pass', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tokenId, wallet: walletAddress }) });
          } catch { /* best-effort */ }
        }

        setBuyStep('complete');
        setCardFlowStep('idle');
        setTimeout(() => fetchNft(), 2000);
      } catch (err) {
        console.error('[NFT Detail] Card buy failed:', err);
        setTxError(friendlyTxError(err, 'Payment failed. Please try again.'));
        setBuyStep('confirm');
        setCardFlowStep('idle');
      }
    }
  }, [nft, walletAddress, paymentMethod, executeBuy, fundWallet, fetchNft, fillingLevel, tokenId]);

  const handleMakeOffer = useCallback(async () => {
    if (!offerAmount) return;
    // Never fail silently here. An external wallet (MetaMask/Coinbase) is only in
    // Privy's `wallets` list while it's actually connected in THIS browser
    // session, so a logged-in user can reach an enabled Submit Offer button with
    // `selectedWallet === null` — the old bare `return` made the button look dead.
    clientLog('marketplace#', 'offer_submit_clicked', {
      tokenId, amount: offerAmount, walletsReady, walletCount: wallets.length, hasSelected: !!selectedWallet,
    });
    if (!walletAddress) { setShowLoginModal(true); return; }
    let activeWallet = selectedWallet;
    if (!activeWallet && walletsReady && !isEmbeddedWallet) {
      // Mobile external wallet: login via the wallet's own SDK never registers
      // with Privy, so useWallets() stays empty on this device and "reconnect"
      // advice can't work (ticket-2681). Recover the signer directly — same
      // fallback the mint flow has used since June.
      setOfferError(null);
      activeWallet = (await resolveWalletFallback(walletAddress, 'make_offer')) as unknown as typeof selectedWallet;
    }
    if (!activeWallet) {
      setOfferError(walletsReady
        ? 'We couldn’t reach your wallet. Open your wallet app and approve the connection, then tap Submit Offer again.'
        : 'Still connecting your wallet — give it a second and tap Submit Offer again.');
      return;
    }
    const amount = parseFloat(offerAmount);
    if (isNaN(amount) || amount <= 0) {
      setOfferError('Enter a valid offer amount');
      return;
    }

    setOfferStep('processing');
    setOfferError(null);

    try {
      // Card path: buy the USDC for the offer via MoonPay first, then the offer
      // is created/escrowed once it lands (createOffer handles the approval).
      if (offerPaymentMethod === 'card') {
        cancelOfferRef.current = false;
        const fundRes = await fundWallet({
          address: walletAddress,
          options: { chain: BASE_SEPOLIA, amount: String(amount), asset: 'USDC', defaultFundingMethod: 'card', card: { preferredProvider: 'moonpay' } },
        });
        if (cancelOfferRef.current || fundRes.status === 'cancelled') { cancelOfferRef.current = false; setOfferStep('input'); return; }
        const requiredUsdc = BigInt(Math.ceil(amount * 1e6));
        const start = Date.now();
        while (Date.now() - start < 300_000) {
          if (cancelOfferRef.current) { cancelOfferRef.current = false; setOfferStep('input'); return; }
          const bal = await getUsdcBalance(walletAddress as Address);
          if (bal >= requiredUsdc) break;
          await new Promise(r => setTimeout(r, 3000));
        }
      }

      const { createOffer } = await import('@/lib/marketplace/offer');
      const { ethers } = await import('ethers');

      const ethereum = await activeWallet.getEthereumProvider();
      const baseNet = await ensureBaseNetwork(ethereum);
      if (!baseNet.ok) throw new Error(baseNet.message ?? 'Please switch your wallet to the Base network to continue.');

      const requiredAmount = ethers.parseUnits(amount.toString(), 6);

      if (activeWallet.walletClientType !== 'privy') {
        // External wallet: gasless USDC approval — free permit signature,
        // the server submits it on-chain and pays the gas.
        const { ensureConduitAllowanceGasless } = await import('@/lib/marketplace/relay');
        await ensureConduitAllowanceGasless({ wallet: activeWallet, requiredWei: BigInt(requiredAmount) });
      } else {
        // Embedded wallet: sponsored approve tx, as before.
        const OPENSEA_CONDUIT = '0x1e0049783f008a0085193e00003d00cd54003c71';
        const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
        const iface = new ethers.Interface([
          'function allowance(address owner, address spender) view returns (uint256)',
          'function approve(address spender, uint256 amount) returns (bool)',
        ]);

        // Check current allowance
        const checkData = iface.encodeFunctionData('allowance', [walletAddress, OPENSEA_CONDUIT]);
        const checkRes = await fetch(process.env.NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL || 'https://mainnet.base.org', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', id: 1, method: 'eth_call',
            params: [{ to: USDC_BASE, data: checkData }, 'latest'],
          }),
        });
        const checkResult = await checkRes.json();
        const currentAllowance = BigInt(checkResult?.result || '0x0');

        if (currentAllowance < requiredAmount) {
          // Approve max USDC for the conduit (sponsored)
          const maxApproval = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
          const approvalData = iface.encodeFunctionData('approve', [OPENSEA_CONDUIT, maxApproval]);
          await sendTx(
            { to: USDC_BASE as `0x${string}`, data: approvalData as `0x${string}`, chainId: 8453 },
            { description: 'Approve USDC for offers — no cost to you', waitForReceipt: true, wallet: activeWallet },
          );
        }
      }

      const provider = new ethers.BrowserProvider(ethereum);
      const result = await createOffer(
        tokenId,
        amount,
        walletAddress,
        provider,
        offerExpiration,
      );

      logger.debug('[NFT Detail] Offer created:', result.orderHash);

      // Notify the NFT owner that they received an offer
      const ownerAddr = nft?.owner || nft?.listing?.protocol_data?.parameters?.offerer;
      if (ownerAddr && walletAddress) {
        notifyOwnerOfOffer({
          ownerWallet: ownerAddr,
          tokenId,
          teamName: nft?.name || `Team #${tokenId}`,
          offerAmount: amount,
          offererWallet: walletAddress,
        });
      }

      logActivity({
        type: 'offer_made',
        walletAddress,
        tokenId,
        teamName: nft?.name || `Team #${tokenId}`,
        price: amount,
        counterparty: ownerAddr || null,
      });

      setOfferStep('complete');
      refetchOffers();
    } catch (err) {
      console.error('[NFT Detail] Offer failed:', err);
      reportClientError({
        source: LOG_SOURCES.marketplace.OFFER_CREATE_FAILED,
        message: err instanceof Error ? err.message : String(err),
        route: 'marketplace',
        context: { tokenId, offerAmount: amount, offerExpiration },
        stack: err instanceof Error ? err.stack : undefined,
      });
      setOfferError(friendlyTxError(err, 'Failed to create offer. Please try again.'));
      setOfferStep('input');
    }
  }, [walletAddress, selectedWallet, offerAmount, offerExpiration, offerPaymentMethod, fundWallet, tokenId, sendTx, refetchOffers, nft, walletsReady, wallets.length, isEmbeddedWallet, setShowLoginModal]);

  const handleAcceptOffer = useCallback(async (offer: OfferData) => {
    clientLog('marketplace#', 'offer_accept_clicked', {
      tokenId, orderHash: offer.orderHash, walletsReady, walletCount: wallets.length, hasSelected: !!selectedWallet,
    });
    if (!walletAddress) { setShowLoginModal(true); return; }
    setAcceptingOfferHash(offer.orderHash);
    setAcceptError(null);
    // Same dead-button trap as Submit Offer — recover the signer via the
    // mobile fallback before giving up (ticket-2681: reconnect advice can't
    // work when the wallet SDK login never registers with Privy).
    let activeWallet = selectedWallet;
    if (!activeWallet && walletsReady && !isEmbeddedWallet) {
      activeWallet = (await resolveWalletFallback(walletAddress, 'accept_offer')) as unknown as typeof selectedWallet;
    }
    if (!activeWallet) {
      setAcceptingOfferHash(null);
      setAcceptError(walletsReady
        ? 'We couldn’t reach your wallet. Open your wallet app and approve the connection, then accept again.'
        : 'Still connecting your wallet — give it a second and try again.');
      return;
    }

    try {
      const { getOfferFulfillmentTx } = await import('@/lib/marketplace/offer');
      const { ethers } = await import('ethers');
      const { BBB4_CONTRACT } = await import('@/lib/opensea');

      const ethereum = await activeWallet.getEthereumProvider();
      const baseNet = await ensureBaseNetwork(ethereum);
      if (!baseNet.ok) throw new Error(baseNet.message ?? 'Please switch your wallet to the Base network to continue.');

      // Check NFT approval for conduit
      const OPENSEA_CONDUIT = '0x1e0049783f008a0085193e00003d00cd54003c71';
      const iface = new ethers.Interface([
        'function isApprovedForAll(address owner, address operator) view returns (bool)',
        'function setApprovalForAll(address operator, bool approved)',
      ]);

      const checkData = iface.encodeFunctionData('isApprovedForAll', [walletAddress, OPENSEA_CONDUIT]);
      const checkRes = await fetch(process.env.NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL || 'https://mainnet.base.org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'eth_call',
          params: [{ to: BBB4_CONTRACT, data: checkData }, 'latest'],
        }),
      });
      const checkResult = await checkRes.json();
      const isApproved = checkResult?.result && parseInt(checkResult.result, 16) === 1;

      const isExternal = activeWallet.walletClientType !== 'privy';

      if (!isApproved) {
        if (isExternal) {
          // We pay the gas: fund the wallet's exact shortfall before it
          // sends the approval tx (can't be signature-relayed on ERC-721).
          const { topUpGasIfNeeded } = await import('@/lib/marketplace/relay');
          await topUpGasIfNeeded('approve-nft');
        }
        const approvalData = iface.encodeFunctionData('setApprovalForAll', [OPENSEA_CONDUIT, true]);
        await sendTx(
          { to: BBB4_CONTRACT as `0x${string}`, data: approvalData as `0x${string}`, chainId: 8453 },
          { description: 'Approve marketplace — no cost to you', waitForReceipt: true, wallet: activeWallet },
        );
      }

      const tx = await getOfferFulfillmentTx(
        offer.orderHash,
        walletAddress,
        offer.protocolAddress,
        tokenId,
      );

      if (isExternal) {
        const { topUpGasIfNeeded } = await import('@/lib/marketplace/relay');
        await topUpGasIfNeeded('accept-offer');
      }
      const acceptReceipt = await sendTx(
        { to: tx.to as `0x${string}`, value: BigInt(tx.value), data: tx.data as `0x${string}`, chainId: 8453 },
        { description: 'Accept offer — gas fees covered by SBS', waitForReceipt: true, wallet: activeWallet },
      );
      const acceptTxHash = acceptReceipt.hash || null;

      logger.debug('[NFT Detail] Offer accepted:', offer.orderHash);

      // Accepting an offer IS a sale — log it as a buy+sell pair (same shape as
      // a Buy Now), not just 'offer_accepted'. This is what powers "You paid $X"
      // for the buyer (paidByToken reads 'buy') and the instant drop from the
      // seller's My Teams (recentSells reads 'sell'); offer_accepted alone fed
      // neither, so a sold-via-offer team lingered and "You paid" stayed stale.
      // Same txHash on both → the activity feed dedups them into one Sold row.
      logActivity({
        type: 'sell',
        walletAddress,
        tokenId,
        teamName: nft?.name || `Team #${tokenId}`,
        price: offer.amount,
        counterparty: offer.offererAddress || null,
        orderHash: offer.orderHash || null,
        txHash: acceptTxHash,
      });
      if (offer.offererAddress) {
        logActivity({
          type: 'buy',
          walletAddress: offer.offererAddress,
          tokenId,
          teamName: nft?.name || `Team #${tokenId}`,
          price: offer.amount,
          counterparty: walletAddress,
          orderHash: offer.orderHash || null,
          txHash: acceptTxHash,
        });
      }

      // Notify the offerer (Firestore — they're not on this page)
      if (offer.offererAddress) {
        notifyOffererOfAcceptance({
          offererWallet: offer.offererAddress,
          tokenId,
          teamName: nft?.name || `Team #${tokenId}`,
          offerAmount: offer.amount,
        });
      }

      void fetch('/api/marketplace/offers/consumed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderHash: offer.orderHash, tokenId }) }).catch(() => {});
      refetchOffers();
      setTimeout(() => fetchNft(), 2000);
    } catch (err) {
      console.error('[NFT Detail] Accept offer failed:', err);
      reportClientError({
        source: LOG_SOURCES.marketplace.OFFER_ACCEPT_FAILED,
        message: err instanceof Error ? err.message : String(err),
        route: 'marketplace',
        context: { tokenId, orderHash: offer.orderHash, offerAmount: offer.amount, offererAddress: offer.offererAddress || null },
        stack: err instanceof Error ? err.stack : undefined,
      });
      setAcceptError(friendlyTxError(err, 'Failed to accept offer. Please try again.'));
    } finally {
      setAcceptingOfferHash(null);
    }
  }, [walletAddress, selectedWallet, tokenId, sendTx, refetchOffers, nft, fetchNft, walletsReady, wallets.length, isEmbeddedWallet, setShowLoginModal]);

  const handleCancelOffer = useCallback(async (offer: OfferData) => {
    if (!walletAddress) return;
    setCancellingOfferHash(offer.orderHash);
    setAcceptError(null);

    try {
      const res = await fetch('/api/marketplace/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderHash: offer.orderHash, type: 'offer' }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Failed to cancel offer' }));
        throw new Error(errData.error || `Cancel failed: ${res.status}`);
      }

      const tx = await res.json();

      await sendTx(
        { to: tx.to as `0x${string}`, data: tx.data as `0x${string}`, chainId: 8453 },
        { description: 'Cancel your offer — fees covered by SBS' },
      );

      logger.debug('[NFT Detail] Cancelled offer:', offer.orderHash);

      logActivity({
        type: 'cancel',
        walletAddress,
        tokenId,
        teamName: nft?.name || `Team #${tokenId}`,
        price: offer.amount,
        orderHash: offer.orderHash || null,
      });

      void fetch('/api/marketplace/offers/consumed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderHash: offer.orderHash, tokenId }) }).catch(() => {});
      refetchOffers();
    } catch (err) {
      console.error('[NFT Detail] Cancel offer failed:', err);
      reportClientError({
        source: LOG_SOURCES.marketplace.CANCEL_OFFER_FAILED,
        message: err instanceof Error ? err.message : String(err),
        route: 'marketplace-detail',
        actor: walletAddress,
        context: { tokenId, orderHash: offer.orderHash },
      });
      setAcceptError(friendlyTxError(err, 'Failed to cancel offer. Please try again.'));
    } finally {
      setCancellingOfferHash(null);
    }
  }, [walletAddress, sendTx, refetchOffers, tokenId, nft]);

  /** Cancel EVERY offer the viewer has on this token — Seaport's cancel takes
   *  an array of orders, so this is one signature / one sponsored tx. */
  const handleCancelAllOffers = useCallback(async (myOffers: OfferData[]) => {
    if (!walletAddress || myOffers.length === 0) return;
    setCancellingAllOffers(true);
    setAcceptError(null);

    const hashes = myOffers.map(o => o.orderHash).filter(Boolean);
    try {
      const res = await fetch('/api/marketplace/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderHashes: hashes, type: 'offer' }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Failed to cancel offers' }));
        throw new Error(errData.error || `Cancel failed: ${res.status}`);
      }

      const tx = await res.json();

      await sendTx(
        { to: tx.to as `0x${string}`, data: tx.data as `0x${string}`, chainId: 8453 },
        { description: `Cancel ${hashes.length} offers in one go — fees covered by SBS` },
      );

      logger.debug('[NFT Detail] Cancelled all offers:', hashes);

      for (const offer of myOffers) {
        logActivity({
          type: 'cancel',
          walletAddress,
          tokenId,
          teamName: nft?.name || `Team #${tokenId}`,
          price: offer.amount,
          orderHash: offer.orderHash || null,
        });
        void fetch('/api/marketplace/offers/consumed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderHash: offer.orderHash, tokenId }) }).catch(() => {});
      }
      refetchOffers();
    } catch (err) {
      console.error('[NFT Detail] Cancel all offers failed:', err);
      reportClientError({
        source: LOG_SOURCES.marketplace.CANCEL_OFFER_FAILED,
        message: err instanceof Error ? err.message : String(err),
        route: 'marketplace-detail',
        actor: walletAddress,
        context: { tokenId, orderHashes: hashes },
      });
      setAcceptError(friendlyTxError(err, 'Failed to cancel offers. Please try again.'));
    } finally {
      setCancellingAllOffers(false);
    }
  }, [walletAddress, sendTx, refetchOffers, tokenId, nft]);

  if (isLoading) {
    return (
      <div className="w-full px-4 sm:px-8 lg:px-12 py-8 max-w-6xl mx-auto">
        <div className="animate-pulse">
          <div className="h-6 bg-bg-tertiary rounded w-40 mb-8" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
            <div className="aspect-[3/4] bg-bg-tertiary rounded-2xl" />
            <div className="space-y-4">
              <div className="h-8 bg-bg-tertiary rounded w-3/4" />
              <div className="h-4 bg-bg-tertiary rounded w-1/2" />
              <div className="h-40 bg-bg-tertiary rounded-2xl" />
              <div className="h-12 bg-bg-tertiary rounded-xl" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !nft) {
    return (
      <div className="w-full px-4 sm:px-8 lg:px-12 py-8 max-w-6xl mx-auto text-center py-20">
        <div className="text-4xl mb-4">🍌</div>
        <h2 className="text-text-primary text-xl font-semibold mb-2">Team Not Found</h2>
        <p className="text-text-secondary text-sm mb-6">{error || 'This team could not be loaded.'}</p>
        <button type="button" onClick={goBackToMarketplace} className="text-banana hover:underline text-sm">
          Back to Marketplace
        </button>
      </div>
    );
  }

  // Parse traits
  const traits = nft.traits || [];
  const roster = ROSTER_KEYS.map(key => ({
    slot: key,
    value: parseTrait(traits, key),
  })).filter(r => r.value);

  const rank = parseTrait(traits, 'RANK');
  const seasonScore = parseTrait(traits, 'SEASON-SC0RE') || parseTrait(traits, 'SEASON-SCORE');
  const weekScore = parseTrait(traits, 'WEEK-SCORE');
  const leagueName = parseTrait(traits, 'LEAGUE-NAME');
  // Pre-season the RANK trait holds a placeholder (the token id), not a 1-10 league
  // position, and SEASON/WEEK scores are seed values — only treat them as real once
  // the season has actually scored points.
  const rankNum = rank ? parseInt(rank, 10) : 0;
  const hasValidRank = hasSeasonStarted() && rankNum >= 1 && rankNum <= 10;
  const hasSeasonStats = hasSeasonStarted();
  const level = parseTrait(traits, 'LEVEL');

  const draftType: DraftType = level === 'Jackpot' ? 'jackpot' : level === 'Hall of Fame' ? 'hof' : 'pro';

  // Price from listing
  const listing = nft.listing;
  let price: number | null = null;
  if (listing?.price?.current) {
    const decimals = listing.price.current.decimals ?? 18;
    price = Number(listing.price.current.value) / Math.pow(10, decimals);
  }
  const seller = listing?.protocol_data?.parameters?.offerer;
  const nftOwner = nft.owner || seller;
  const isOwner = walletAddress && nftOwner && walletAddress.toLowerCase() === nftOwner.toLowerCase();

  const imageUrl = nft.display_image_url || nft.image_url;
  // For a wheel-won JP/HOF pass still filling, show the tier-styled card art
  // (gold HOF / red Jackpot) instead of the generic pass image — matches the
  // Sell grid. Keep `imageUrl` for league-number resolution below.
  const cardImage = fillingLevel ? buildTieredDraftPassUrl(tokenId, fillingLevel) : imageUrl;
  // Users only ever see Team # (= token id) and League #. Never the raw league
  // name ("BBB #…") or "Token #". League # comes from the same source the card
  // image uses (backend-derived), so text === card.
  const leagueNumber = resolveLeagueNumber(imageUrl, leagueName);
  const teamName = `Team #${tokenId}`;

  // Group roster by position type
  const qbs = roster.filter(r => r.slot.startsWith('QB'));
  const rbs = roster.filter(r => r.slot.startsWith('RB'));
  const wrs = roster.filter(r => r.slot.startsWith('WR'));
  const tes = roster.filter(r => r.slot.startsWith('TE'));
  const dsts = roster.filter(r => r.slot.startsWith('DST'));

  const offerAmountNum = parseFloat(offerAmount) || 0;
  const offerFee = offerAmountNum * 0.01;

  return (
    <div className="w-full px-4 sm:px-8 lg:px-12 py-8 max-w-6xl mx-auto">
      {/* Back Link — returns to the tab/filter the user came from */}
      <button
        type="button"
        onClick={goBackToMarketplace}
        className="inline-flex items-center gap-2 text-text-secondary hover:text-text-primary text-sm mb-8 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Back to Marketplace
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
        {/* Left: Card Image */}
        <div>
          <div className={`relative aspect-[3/4] rounded-2xl overflow-hidden border ${
            (fillingLevel ?? draftType) === 'jackpot' ? 'border-error/40' : (fillingLevel ?? draftType) === 'hof' ? 'border-hof/40' : 'border-bg-tertiary'
          }`}>
            {cardImage ? (
              <Image
                src={cardImage}
                alt={teamName}
                fill
                className="object-contain"
                sizes="(max-width: 1024px) 100vw, 50vw"
                priority
                unoptimized
              />
            ) : (
              <div className={`w-full h-full bg-gradient-to-br ${
                draftType === 'jackpot' ? 'from-error/20 to-bg-secondary'
                : draftType === 'hof' ? 'from-hof/20 to-bg-secondary'
                : 'from-pro/20 to-bg-secondary'
              } flex items-center justify-center p-8`}>
                <SbsPassThumb
                  label={leagueName?.startsWith('BBB') ? leagueName.replace('BBB ', '') : `#${tokenId}`}
                  size={320}
                  roster={roster.map(r => r.value)}
                />
              </div>
            )}

            {/* Type + Founder badges */}
            {(draftType !== 'pro' || isFounderTeam) && (
              <div className="absolute top-4 left-4 flex items-center gap-2">
                {draftType === 'jackpot' && (
                  <span className="px-4 py-1.5 bg-error text-white text-xs font-bold uppercase rounded-full shadow-lg">
                    JACKPOT
                  </span>
                )}
                {draftType === 'hof' && (
                  <span className="px-4 py-1.5 bg-hof text-white text-xs font-bold uppercase rounded-full shadow-lg">
                    HOF
                  </span>
                )}
                {isFounderTeam && (
                  <span className="px-4 py-1.5 text-white text-xs font-bold uppercase rounded-full shadow-lg" style={{ background: '#06b6d4' }}>
                    Founder
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right: Details */}
        <div>
          {/* Title */}
          <div className="flex items-center justify-between mb-1">
            <h1 className="text-2xl font-bold text-text-primary font-mono">{teamName}</h1>
            <div className="relative">
              <button
                onClick={() => setShowShareMenu(prev => !prev)}
                className="w-10 h-10 rounded-xl bg-bg-secondary border border-bg-tertiary flex items-center justify-center text-text-secondary hover:text-text-primary hover:border-banana transition-all"
              >
                {shareCopied ? (
                  <svg className="w-5 h-5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path d="M5 13l4 4L19 7"/>
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                )}
              </button>
              {showShareMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowShareMenu(false)} />
                  <div className="absolute right-0 top-12 z-50 bg-bg-secondary border border-bg-tertiary rounded-xl shadow-xl overflow-hidden min-w-[180px]">
                    <button
                      onClick={handleShareX}
                      className="w-full flex items-center gap-3 px-4 py-3 text-sm text-text-primary hover:bg-bg-tertiary transition-colors"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                      </svg>
                      Share on X
                    </button>
                    <button
                      onClick={handleCopyLink}
                      className="w-full flex items-center gap-3 px-4 py-3 text-sm text-text-primary hover:bg-bg-tertiary transition-colors border-t border-bg-tertiary"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                      </svg>
                      Copy Link
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 mb-6">
            {leagueNumber != null && (
              <span className="px-2.5 py-1 rounded-lg bg-white/[0.04] border border-white/[0.08] text-text-secondary text-xs font-mono">
                League #{leagueNumber}
              </span>
            )}
            <a
              href={`https://opensea.io/assets/base/${BBB4_CONTRACT}/${tokenId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.04] border border-white/[0.08] text-text-secondary hover:text-text-primary hover:border-white/20 transition-colors text-xs font-medium"
              title="View on OpenSea"
            >
              OpenSea
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 17 17 7M17 7H8M17 7v9" />
              </svg>
            </a>
            {nftOwner && (
              <UserPopover walletAddress={nftOwner} username={nft.ownerName ?? undefined} pfpUrl={nft.ownerPfp ?? undefined}>
                <span className="inline-flex items-center gap-2.5 pl-1 pr-2.5 py-1 rounded-lg bg-white/[0.04] border border-white/[0.08] hover:border-white/20 transition-colors text-xs cursor-pointer">
                  {/* Banana pfp + name by default; their custom pfp/name if set;
                      a badge ONLY if they've equipped/earned one (no default badge). */}
                  <AvatarWithBadge
                    imageUrl={nft.ownerPfp}
                    alt={nft.ownerName ?? 'owner'}
                    size={20}
                    equippedBadge={nft.ownerBadge ?? null}
                    ripeness={nft.ownerRipeness ?? null}
                    showBadge={!!nft.ownerBadge || (!!nft.ownerRipeness && nft.ownerRipeness.count >= 1)}
                    useNextImage={false}
                    badgeRingColor="#13141a"
                  />
                  <span className="text-text-secondary">
                    {nft.ownerName || bananaPlaceholderName(nftOwner)}
                  </span>
                </span>
              </UserPopover>
            )}
          </div>

          {/* Price & Buy / Make Offer — primary action, kept at the top */}
          <div className="bg-bg-secondary border border-bg-tertiary rounded-2xl p-5 mb-6">
            {isOwner && typeof nft.pricePaid === 'number' && nft.pricePaid > 0 && (
              <div className="flex items-center gap-1.5 mb-3 text-xs text-text-secondary">
                <span className="text-text-muted">You paid</span>
                <span className="font-mono font-semibold text-banana">${nft.pricePaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            )}
            {price !== null ? (
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-text-muted text-xs mb-1">Current Price</p>
                    <p className="text-text-primary font-mono text-3xl font-bold">
                      ${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    {(() => {
                      const exp = formatExpiresIn(nft?.listing?.protocol_data?.parameters?.endTime);
                      return exp ? <p className="text-text-muted text-xs mt-1">Listing expires in {exp}</p> : null;
                    })()}
                  </div>

                  {buyStep === 'complete' && showBuyModal ? null : buyStep === 'complete' ? (
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2 text-success font-semibold">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                        Yours!
                      </div>
                      <Link href="/marketplace?tab=sell" className="text-banana text-xs hover:underline">
                        View My Teams
                      </Link>
                    </div>
                  ) : !isOwner ? (
                    <button
                      onClick={() => {
                        if (!isLoggedIn) { setShowLoginModal(true); return; }
                        setBuyStep('confirm');
                        setTxError(null);
                        setShowBuyModal(true);
                      }}
                      className="px-8 py-3 bg-banana text-black font-semibold rounded-xl hover:brightness-110 transition-all"
                    >
                      Buy Now
                    </button>
                  ) : isOwner ? (
                    // Owner of a LISTED team: change the price in place, or cancel.
                    <div className="flex flex-col items-end gap-2">
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1 bg-bg-tertiary/60 border border-bg-tertiary rounded-xl px-3 py-2.5 w-28">
                          <span className="text-text-muted">$</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={ownerListPrice}
                            onChange={e => setOwnerListPrice(e.target.value)}
                            placeholder={price.toFixed(2)}
                            className="w-full bg-transparent text-text-primary placeholder:text-text-muted focus:outline-none font-mono"
                          />
                        </div>
                        <button
                          onClick={handleOwnerUpdatePrice}
                          disabled={listBusy || !ownerListPrice || parseFloat(ownerListPrice) <= 0 || parseFloat(ownerListPrice) === price}
                          className="px-5 py-2.5 bg-banana text-black font-semibold rounded-xl hover:brightness-110 transition-all disabled:opacity-50"
                        >
                          {listBusy ? 'Updating…' : 'Update Price'}
                        </button>
                      </div>
                      <button
                        onClick={handleOwnerCancel}
                        disabled={listBusy}
                        className="text-red-400 text-xs hover:underline disabled:opacity-50"
                      >
                        Cancel Listing
                      </button>
                    </div>
                  ) : null}
                </div>

                {(txError || listError) && (
                  <p className="text-error text-xs mt-3">{txError || listError}</p>
                )}
              </>
            ) : isOwner ? (
              // Owner viewing their own unlisted team — let them list it here.
              <div>
                <p className="text-text-muted text-xs mb-2">List this team for sale</p>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 flex-1 bg-bg-tertiary/60 border border-bg-tertiary rounded-xl px-3 py-2.5">
                    <span className="text-text-muted">$</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={ownerListPrice}
                      onChange={e => setOwnerListPrice(e.target.value)}
                      placeholder="Price in USDC"
                      className="flex-1 bg-transparent text-text-primary placeholder:text-text-muted focus:outline-none font-mono"
                    />
                  </div>
                  <select
                    value={listDurationSeconds}
                    onChange={e => setListDurationSeconds(Number(e.target.value))}
                    aria-label="Listing duration"
                    className="bg-bg-tertiary/60 border border-bg-tertiary rounded-xl px-3 py-2.5 text-text-primary text-sm focus:outline-none focus:border-banana/50 cursor-pointer"
                  >
                    {LISTING_DURATIONS.map(({ label, seconds }) => (
                      <option key={seconds} value={seconds}>{label}</option>
                    ))}
                  </select>
                  <button
                    onClick={handleOwnerList}
                    disabled={listBusy || !ownerListPrice || parseFloat(ownerListPrice) <= 0}
                    className="px-6 py-2.5 bg-banana text-black font-semibold rounded-xl hover:brightness-110 transition-all disabled:opacity-50"
                  >
                    {listBusy ? 'Listing…' : 'List for Sale'}
                  </button>
                </div>
                <p className="text-text-muted text-[11px] mt-2">
                  Lists for {LISTING_DURATIONS.find(d => d.seconds === listDurationSeconds)?.label ?? '30 days'} · only a 1% OpenSea fee · you keep the rest.
                </p>
                {listError && <p className="text-error text-xs mt-2">{listError}</p>}
                {bestOffer && (
                  <p className="text-text-secondary text-xs mt-2">
                    Best offer: <span className="text-banana font-mono font-semibold">${bestOffer.amount.toFixed(2)}</span>
                  </p>
                )}
              </div>
            ) : (
              <div className="text-center">
                <p className="text-text-muted text-sm">This team is not currently listed for sale.</p>
                {bestOffer && (
                  <p className="text-text-secondary text-xs mt-1">
                    Best offer: <span className="text-banana font-mono font-semibold">${bestOffer.amount.toFixed(2)}</span>
                  </p>
                )}
              </div>
            )}

            {/* Make Offer button — shown to non-owners */}
            {!isOwner && buyStep !== 'complete' && (
              <button
                onClick={() => {
                  if (!isLoggedIn) { setShowLoginModal(true); return; }
                  setShowOfferModal(true);
                  setOfferStep('input');
                  setOfferAmount('');
                  setOfferError(null);
                }}
                className="w-full mt-3 py-3 border border-banana text-banana font-semibold rounded-xl hover:bg-banana/10 transition-all text-sm"
              >
                Make Offer
              </button>
            )}
          </div>

          {/* Stats Row */}
          {hasSeasonStats && (
            <div className={`grid ${hasValidRank ? 'grid-cols-3' : 'grid-cols-2'} gap-3 mb-6`}>
              {hasValidRank && (
                <div className="bg-bg-secondary border border-bg-tertiary rounded-xl p-4 text-center">
                  <p className="text-text-muted text-[10px] uppercase tracking-wider mb-1">Rank</p>
                  <p className="font-mono text-xl font-bold text-banana">#{rank}/10</p>
                </div>
              )}
              {seasonScore && (
                <div className="bg-bg-secondary border border-bg-tertiary rounded-xl p-4 text-center">
                  <p className="text-text-muted text-[10px] uppercase tracking-wider mb-1">Season Pts</p>
                  <p className="font-mono text-xl font-bold text-text-primary">
                    {parseFloat(seasonScore).toLocaleString(undefined, { maximumFractionDigits: 1 })}
                  </p>
                </div>
              )}
              {weekScore && (
                <div className="bg-bg-secondary border border-bg-tertiary rounded-xl p-4 text-center">
                  <p className="text-text-muted text-[10px] uppercase tracking-wider mb-1">Week Score</p>
                  <p className="font-mono text-xl font-bold text-success">
                    {parseFloat(weekScore).toLocaleString(undefined, { maximumFractionDigits: 1 })}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Wheel-pass explainer — what you're buying, how it was won, what it gives. */}
          {fillingLevel && (
            <div className={`rounded-2xl p-5 mb-6 border ${fillingLevel === 'jackpot' ? 'border-error/30 bg-error/[0.04]' : 'border-hof/30 bg-hof/[0.04]'}`}>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-lg">⚡</span>
                <h3 className="text-text-primary font-semibold text-sm">
                  {fillingLevel === 'jackpot' ? 'Jackpot' : 'HOF'} Draft Pass — won on the Banana Wheel
                </h3>
              </div>
              <p className="text-text-secondary text-xs leading-relaxed mb-3">
                This isn&apos;t a drafted team — it&apos;s a <span className="text-text-primary font-semibold">{fillingLevel === 'jackpot' ? 'Jackpot' : 'Hall of Fame'} entry someone won on the Banana Wheel</span>, and its draft lobby is still filling — so right now it trades as a pass to that seat.
              </p>
              <div className="space-y-1.5 text-text-secondary text-xs leading-relaxed">
                <p><span className="text-text-primary font-semibold">Buy it →</span> the seat is transferred to you and you take their spot in the {fillingLevel === 'jackpot' ? 'Jackpot' : 'HOF'}-only lobby.</p>
                <p><span className="text-text-primary font-semibold">When the lobby fills (10 winners) →</span> you draft your team. Slow Draft, 8 hours per pick.</p>
                <p><span className="text-text-primary font-semibold">Win your league →</span> {fillingLevel === 'jackpot' ? 'you skip straight to the season Finals.' : 'you enter the Hall of Fame playoff bracket for bonus prizes.'}</p>
                <p className="text-text-muted pt-1">Once it fills, the pass becomes your drafted team.</p>
              </div>
            </div>
          )}

          {/* Full Roster */}
          {roster.length > 0 && (
            <div className="bg-bg-secondary border border-bg-tertiary rounded-2xl p-5 mb-6">
              <h3 className="text-text-primary font-semibold text-sm mb-4">Full Roster</h3>
              <div className="space-y-4">
                {[
                  { label: 'Quarterbacks', items: qbs },
                  { label: 'Running Backs', items: rbs },
                  { label: 'Wide Receivers', items: wrs },
                  { label: 'Tight Ends', items: tes },
                  { label: 'Defense', items: dsts },
                ].filter(g => g.items.length > 0).map(group => (
                  <div key={group.label}>
                    <p className="text-text-muted text-[10px] uppercase tracking-wider mb-2">{group.label}</p>
                    <div className="flex flex-wrap gap-2">
                      {group.items.map(r => (
                        <div
                          key={r.slot}
                          className={`px-3 py-1.5 rounded-lg border text-xs font-mono font-medium ${getPositionColor(r.slot)}`}
                        >
                          {r.value}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Offers Section */}
          {(offers.length > 0 || offersLoading) && (
            <div ref={offersSectionRef} className="bg-bg-secondary border border-bg-tertiary rounded-2xl p-5 scroll-mt-24">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-text-primary font-semibold text-sm">
                  Offers {offers.length > 0 && <span className="text-text-muted font-normal">({offers.length})</span>}
                </h3>
                <div className="flex items-center gap-3">
                  {(() => {
                    const myOffers = walletAddress
                      ? offers.filter(o => o.offererAddress?.toLowerCase() === walletAddress.toLowerCase() && o.orderHash)
                      : [];
                    return myOffers.length >= 2 ? (
                      <button
                        onClick={() => handleCancelAllOffers(myOffers)}
                        disabled={cancellingAllOffers || cancellingOfferHash != null}
                        className="px-3 py-1 rounded-lg text-xs font-semibold border border-error/40 text-error hover:bg-error/10 transition-all disabled:opacity-50"
                      >
                        {cancellingAllOffers ? 'Cancelling…' : `Cancel all (${myOffers.length})`}
                      </button>
                    ) : null;
                  })()}
                  {bestOffer && (
                    <span className="text-xs text-text-muted">
                      Best: <span className="text-banana font-mono font-semibold">${bestOffer.amount.toFixed(2)}</span>
                    </span>
                  )}
                </div>
              </div>

              {offersLoading && offers.length === 0 ? (
                <div className="space-y-3">
                  {[...Array(2)].map((_, i) => (
                    <div key={i} className="h-12 bg-bg-tertiary rounded-xl animate-pulse" />
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {offers.map((offer, i) => {
                    const isMyOffer = walletAddress && offer.offererAddress?.toLowerCase() === walletAddress.toLowerCase();
                    return (
                      <div
                        key={offer.orderHash}
                        className={`flex items-center justify-between p-3 rounded-xl ${
                          isMyOffer ? 'bg-pro/5 border border-pro/20'
                          : i === 0 ? 'bg-banana/5 border border-banana/20'
                          : 'bg-bg-primary border border-bg-tertiary'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          {offer.offererPfp ? (
                            <Image src={offer.offererPfp} alt="" width={28} height={28} className="rounded-full" />
                          ) : (
                            <div className="w-7 h-7 rounded-full bg-bg-tertiary flex items-center justify-center">
                              <span className="text-[10px]">🍌</span>
                            </div>
                          )}
                          <div>
                            <p className="text-text-primary text-sm font-medium font-mono">
                              ${offer.amount.toFixed(2)}
                              {isMyOffer && <span className="text-pro text-[10px] ml-1.5 font-semibold">YOUR OFFER</span>}
                              {!isMyOffer && i === 0 && <span className="text-banana text-[10px] ml-1.5 font-semibold">BEST</span>}
                            </p>
                            <p className="text-text-muted text-[11px]">
                              by {offer.offererName} &middot; {timeUntil(offer.expiresAt)} left
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {isMyOffer && (
                            <button
                              onClick={() => handleCancelOffer(offer)}
                              disabled={cancellingOfferHash === offer.orderHash}
                              className="px-3 py-1.5 border border-red-500/40 text-red-400 text-xs font-semibold rounded-lg hover:bg-red-500/10 transition-all disabled:opacity-50"
                            >
                              {cancellingOfferHash === offer.orderHash ? 'Cancelling...' : 'Cancel'}
                            </button>
                          )}
                          {isOwner && !isMyOffer && (
                            offer.protocolAddress ? (
                              <button
                                onClick={() => handleAcceptOffer(offer)}
                                disabled={acceptingOfferHash === offer.orderHash}
                                className="px-4 py-1.5 bg-success text-white text-xs font-semibold rounded-lg hover:brightness-110 transition-all disabled:opacity-50"
                              >
                                {acceptingOfferHash === offer.orderHash ? 'Accepting...' : 'Accept'}
                              </button>
                            ) : (
                              // Offer is in our cache but OpenSea hasn't indexed it yet
                              // (~5-15s). Accepting needs OpenSea's fulfillment data, so
                              // show a disabled hint instead of letting it hard-fail.
                              <button
                                disabled
                                title="This offer is still being confirmed — you can accept it in a few seconds."
                                className="px-4 py-1.5 bg-white/10 text-text-muted text-xs font-semibold rounded-lg cursor-not-allowed"
                              >
                                Indexing…
                              </button>
                            )
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {acceptError && (
                <p className="text-error text-xs mt-3">{acceptError}</p>
              )}
            </div>
          )}

          {/* Activity — sales + listings, filterable, truncated */}
          {(activityItems.length > 0 || saleHistoryLoading) && (
            <div className="bg-bg-secondary border border-bg-tertiary rounded-2xl p-5 mt-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-text-primary font-semibold text-sm">
                  Activity {activityItems.length > 0 && <span className="text-text-muted font-normal">({activityItems.length})</span>}
                </h3>
                {activityItems.length > 0 && (
                  <div className="flex items-center gap-1 bg-bg-primary rounded-lg p-0.5">
                    {([
                      { key: 'all', label: 'All' },
                      { key: 'sales', label: 'Sales' },
                      { key: 'listings', label: 'Listings' },
                    ] as const).map(({ key, label }) => (
                      <button
                        key={key}
                        onClick={() => { setActivityFilter(key); setActivityExpanded(false); }}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                          activityFilter === key ? 'bg-bg-tertiary text-text-primary' : 'text-text-muted hover:text-text-secondary'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {saleHistoryLoading && activityItems.length === 0 ? (
                <div className="space-y-3">
                  {[...Array(2)].map((_, i) => (
                    <div key={i} className="h-10 bg-bg-tertiary rounded-xl animate-pulse" />
                  ))}
                </div>
              ) : visibleActivity.length === 0 ? (
                <p className="text-text-muted text-xs">No {activityFilter === 'all' ? '' : activityFilter} activity yet.</p>
              ) : (
                <>
                  <div className="space-y-2">
                    {visibleActivity.map(item => {
                      const date = new Date(item.timestamp);
                      const timeAgo = (() => {
                        const diff = Date.now() - date.getTime();
                        const mins = Math.floor(diff / 60000);
                        if (mins < 1) return 'just now';
                        if (mins < 60) return `${mins}m ago`;
                        const hrs = Math.floor(mins / 60);
                        if (hrs < 24) return `${hrs}h ago`;
                        const days = Math.floor(hrs / 24);
                        if (days < 30) return `${days}d ago`;
                        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                      })();
                      const tone = item.kind === 'sale'
                        ? { bg: 'bg-green-500/10', text: 'text-green-400' }
                        : item.kind === 'listing'
                          ? { bg: 'bg-banana/10', text: 'text-banana' }
                          : { bg: 'bg-white/5', text: 'text-text-muted' };
                      // Show the row from the viewer's perspective: if the logged-in
                      // wallet is the buyer → "You bought · from <seller>"; if the
                      // seller → "You sold · to <buyer>"; otherwise neutral "Sold".
                      const me = walletAddress?.toLowerCase();
                      const iBought = item.kind === 'sale' && !!me && item.who?.toLowerCase() === me;
                      const iSold = item.kind === 'sale' && !!me && item.seller?.toLowerCase() === me;
                      const saleLabel = item.kind === 'sale' ? (iBought ? 'You bought' : iSold ? 'You sold' : 'Sold') : item.label;
                      const counterparty = iBought ? item.seller : item.who;
                      const whoLabel = item.kind === 'sale'
                        ? (counterparty ? `${iBought ? 'from' : 'to'} ${nameFor(counterparty)}` : null)
                        : item.who ? `by ${nameFor(item.who)}` : null;
                      return (
                        <div key={item.id} className="flex items-center justify-between p-3 rounded-xl bg-bg-primary border border-bg-tertiary">
                          <div className="flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${tone.bg}`}>
                              {item.kind === 'sale' ? (
                                <svg className={`w-4 h-4 ${tone.text}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                              ) : item.kind === 'listing' ? (
                                <svg className={`w-4 h-4 ${tone.text}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5a1.99 1.99 0 011.414.586l7 7a2 2 0 010 2.828l-5 5a2 2 0 01-2.828 0l-7-7A1.99 1.99 0 013 12V7a4 4 0 014-4z"/></svg>
                              ) : (
                                <svg className={`w-4 h-4 ${tone.text}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                              )}
                            </div>
                            <div>
                              <p className="text-text-primary text-sm font-medium">
                                {saleLabel}{item.price != null && <span className="font-mono"> · ${item.price.toFixed(2)}</span>}
                              </p>
                              {whoLabel && <p className="text-text-muted text-[11px]">{whoLabel}</p>}
                            </div>
                          </div>
                          <span className="text-text-muted text-xs">{timeAgo}</span>
                        </div>
                      );
                    })}
                  </div>
                  {filteredActivity.length > ACTIVITY_PREVIEW && (
                    <button
                      onClick={() => setActivityExpanded(v => !v)}
                      className="w-full mt-3 py-2 text-xs font-medium text-banana hover:bg-banana/5 rounded-lg transition-colors"
                    >
                      {activityExpanded ? 'Show less' : `Show all ${filteredActivity.length}`}
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Buy Modal */}
      {showBuyModal && nft?.listing && price !== null && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => {
            if (buyStep === 'confirm') setShowBuyModal(false);
            // Stuck waiting on MoonPay funds → tapping the backdrop bails out.
            else if (buyStep === 'processing' && cardFlowStep !== 'buying') cancelBuy();
          }}
        >
          <div
            className="bg-bg-secondary border border-bg-tertiary rounded-2xl w-full max-w-md relative"
            onClick={e => e.stopPropagation()}
          >
            {/* Escape hatch while waiting on card funds (can't cancel mid-purchase). */}
            {buyStep === 'processing' && cardFlowStep !== 'buying' && (
              <button
                type="button"
                onClick={cancelBuy}
                aria-label="Cancel"
                className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-white/10 transition-colors"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
              </button>
            )}
            {buyStep === 'confirm' && (
              <>
                <div className="flex items-center justify-between p-6 border-b border-bg-tertiary">
                  <h2 className="text-lg font-semibold text-text-primary">Buy Team</h2>
                  <button
                    onClick={() => setShowBuyModal(false)}
                    className="w-8 h-8 flex items-center justify-center rounded-lg bg-bg-primary text-text-secondary hover:text-text-primary transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                  </button>
                </div>

                <div className="p-6">
                  {/* Team Preview */}
                  <div className="flex items-center gap-4 p-4 bg-bg-primary rounded-xl mb-4">
                    {imageUrl ? (
                      <Image src={imageUrl} alt={teamName} width={56} height={56} className="rounded-xl object-cover" />
                    ) : (
                      <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${
                        draftType === 'jackpot' ? 'from-error/40 to-error/20'
                        : draftType === 'hof' ? 'from-hof/40 to-hof/20'
                        : 'from-pro/40 to-pro/20'
                      } flex items-center justify-center`}>
                        <span className="text-2xl">🍌</span>
                      </div>
                    )}
                    <div>
                      <h3 className="text-text-primary font-semibold font-mono">{teamName}</h3>
                      <div className="flex gap-2 mt-1">
                        {draftType === 'jackpot' && (
                          <span className="px-2 py-0.5 bg-error/20 text-error text-[10px] font-bold rounded">JACKPOT</span>
                        )}
                        {draftType === 'hof' && (
                          <span className="px-2 py-0.5 bg-hof/20 text-hof text-[10px] font-bold rounded">HOF</span>
                        )}
                        {hasValidRank && (
                          <span className="text-text-muted text-xs">Rank #{rank}/10</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Payment Method */}
                  <div className="mb-4">
                    <label className="block text-text-secondary text-sm mb-3">Payment Method</label>
                    <PaymentMethodSquares
                      value={paymentMethod}
                      onChange={setPaymentMethod}
                      isEmbeddedWallet={isEmbeddedWallet}
                      usdcBalance={user?.usdcBalance ?? null}
                      requiredAmount={price ?? 0}
                    />
                  </div>

                  {/* Error display */}
                  {txError && (
                    <div className="p-3 bg-error/10 border border-error/30 rounded-xl mb-4">
                      <p className="text-error text-sm">{txError}</p>
                    </div>
                  )}

                  {/* Price Summary */}
                  <div className="p-4 bg-bg-primary rounded-xl space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-text-secondary">Price</span>
                      <span className="text-text-primary font-mono">
                        ${price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </span>
                    </div>
                    {paymentMethod === 'card' ? (
                      <div className="flex justify-between text-sm">
                        <span className="text-text-secondary">Processing Fee (3%)</span>
                        <span className="text-text-primary font-mono">
                          ${(price * 0.03).toFixed(2)}
                        </span>
                      </div>
                    ) : (
                      <div className="flex justify-between text-sm">
                        <span className="text-text-secondary">Network Fee (est.)</span>
                        <span className="text-text-primary font-mono">~$0.01</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm pt-3 border-t border-bg-tertiary font-semibold">
                      <span className="text-text-primary">Total</span>
                      <span className="text-text-primary font-mono">
                        {paymentMethod === 'card'
                          ? `$${(price * 1.03).toFixed(2)}`
                          : `$${(price + 0.01).toFixed(2)}`
                        }
                      </span>
                    </div>
                  </div>
                </div>

                <div className="p-6 pt-0">
                  <button
                    onClick={handleBuy}
                    className="w-full py-4 bg-banana text-black font-semibold rounded-xl hover:brightness-110 transition-all flex items-center justify-center gap-2"
                  >
                    {paymentMethod === 'card' ? (
                      <>
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/>
                        </svg>
                        Pay ${(price * 1.03).toFixed(2)}
                      </>
                    ) : (
                      <>
                        Pay ${(price + 0.01).toFixed(2)}{isEmbeddedWallet ? '' : ' USDC'}
                      </>
                    )}
                  </button>
                  <p className="text-center text-text-muted text-xs mt-3">
                    {paymentMethod === 'card'
                      ? 'Secure payment powered by MoonPay'
                      : 'Paid with your balance'
                    }
                  </p>
                </div>
              </>
            )}

            {buyStep === 'processing' && (
              <div className="p-12 text-center">
                <div className="w-16 h-16 mx-auto mb-6 relative">
                  <div className="absolute inset-0 border-4 border-bg-tertiary rounded-full"></div>
                  <div className="absolute inset-0 border-4 border-banana rounded-full border-t-transparent animate-spin"></div>
                </div>
                <h3 className="text-text-primary font-semibold text-lg mb-2">
                  {paymentMethod === 'card'
                    ? cardFlowStep === 'funding' ? 'Completing Payment'
                    : cardFlowStep === 'waiting' ? 'Waiting for Funds'
                    : 'Purchasing Team'
                    : 'Processing Payment'
                  }
                </h3>
                <p className="text-text-secondary text-sm">
                  {paymentMethod === 'card'
                    ? cardFlowStep === 'funding' ? 'Complete your payment in the MoonPay window...'
                    : cardFlowStep === 'waiting' ? 'Your funds are on the way. This may take a moment...'
                    : 'Completing your purchase...'
                    : 'Completing your purchase...'
                  }
                </p>
                {paymentMethod === 'card' && cardFlowStep !== 'idle' && (
                  <div className="mt-6 space-y-2 text-left max-w-[240px] mx-auto">
                    {[
                      { key: 'funding', label: 'Card payment' },
                      { key: 'waiting', label: 'Funds arriving' },
                      { key: 'buying', label: 'Purchase team' },
                    ].map(({ key, label }) => {
                      const stepOrder = ['funding', 'waiting', 'buying'];
                      const currentIdx = stepOrder.indexOf(cardFlowStep);
                      const stepIdx = stepOrder.indexOf(key);
                      const isComplete = stepIdx < currentIdx;
                      const isActive = key === cardFlowStep;

                      return (
                        <div key={key} className="flex items-center gap-2.5 text-sm">
                          {isComplete ? (
                            <div className="w-5 h-5 rounded-full bg-success/20 flex items-center justify-center">
                              <svg className="w-3 h-3 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path d="M5 13l4 4L19 7"/>
                              </svg>
                            </div>
                          ) : isActive ? (
                            <div className="w-5 h-5 rounded-full border-2 border-banana/30 border-t-banana animate-spin" />
                          ) : (
                            <div className="w-5 h-5 rounded-full border border-bg-tertiary" />
                          )}
                          <span className={isComplete ? 'text-text-primary' : isActive ? 'text-text-secondary' : 'text-text-muted'}>
                            {label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {buyStep === 'complete' && (
              <div className="p-12 text-center">
                <div className="w-16 h-16 mx-auto mb-6 bg-success/20 rounded-full flex items-center justify-center">
                  <svg className="w-8 h-8 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path d="M5 13l4 4L19 7"/>
                  </svg>
                </div>
                <h3 className="text-text-primary font-semibold text-lg mb-2">Purchase Complete!</h3>
                <p className="text-text-secondary text-sm mb-6">
                  {fillingLevel
                    ? `${fillingLevel === 'jackpot' ? 'Jackpot' : 'HOF'} Pass #${tokenId} is yours — your draft is filling`
                    : `${teamName} is now yours`}
                </p>
                <div className="flex gap-3 justify-center">
                  <button
                    onClick={() => {
                      setShowBuyModal(false);
                      fetchNft();
                    }}
                    className="px-6 py-3 bg-bg-primary border border-bg-tertiary text-text-primary font-semibold rounded-xl hover:bg-bg-tertiary transition-all text-sm"
                  >
                    Close
                  </button>
                  {/* A still-filling wheel pass is a draft-in-progress, not a team
                      yet — send the buyer to their drafting page, not My Teams. */}
                  <Link
                    href={fillingLevel ? '/drafting' : '/marketplace?tab=sell'}
                    className="px-6 py-3 bg-banana text-black font-semibold rounded-xl hover:brightness-110 transition-all text-sm"
                  >
                    {fillingLevel ? 'View Draft' : 'View My Teams'}
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Make Offer Modal */}
      {showOfferModal && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => {
            if (offerStep === 'input') setShowOfferModal(false);
            else if (offerStep === 'processing') cancelOffer();
          }}
        >
          <div
            className="bg-bg-secondary border border-bg-tertiary rounded-2xl w-full max-w-md relative"
            onClick={e => e.stopPropagation()}
          >
            {/* Escape hatch while a card-funded offer waits on MoonPay funds. */}
            {offerStep === 'processing' && (
              <button
                type="button"
                onClick={cancelOffer}
                aria-label="Cancel"
                className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-white/10 transition-colors"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
              </button>
            )}
            {offerStep === 'input' && (
              <>
                <div className="flex items-center justify-between p-6 border-b border-bg-tertiary">
                  <h2 className="text-lg font-semibold text-text-primary">Make Offer</h2>
                  <button
                    onClick={() => setShowOfferModal(false)}
                    className="w-8 h-8 flex items-center justify-center rounded-lg bg-bg-primary text-text-secondary hover:text-text-primary transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                  </button>
                </div>

                <div className="p-6">
                  {/* Team Preview */}
                  <div className="flex items-center gap-4 p-4 bg-bg-primary rounded-xl mb-6">
                    {imageUrl ? (
                      <Image src={imageUrl} alt={teamName} width={56} height={56} className="rounded-xl object-cover" />
                    ) : (
                      <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${
                        draftType === 'jackpot' ? 'from-error/40 to-error/20'
                        : draftType === 'hof' ? 'from-hof/40 to-hof/20'
                        : 'from-pro/40 to-pro/20'
                      } flex items-center justify-center`}>
                        <span className="text-2xl">🍌</span>
                      </div>
                    )}
                    <div>
                      <h3 className="text-text-primary font-semibold font-mono">{teamName}</h3>
                      <p className="text-text-muted text-xs">{isEmbeddedWallet ? '#' : 'Token #'}{tokenId}</p>
                    </div>
                  </div>

                  {/* Offer Amount */}
                  <div className="mb-4">
                    <label className="block text-text-secondary text-sm mb-2">Your Offer{isEmbeddedWallet ? '' : ' (USDC)'}</label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted text-lg font-mono">$</span>
                      <input
                        type="number"
                        value={offerAmount}
                        onChange={(e) => setOfferAmount(e.target.value)}
                        placeholder="0.00"
                        min="0"
                        step="0.01"
                        className="w-full bg-bg-primary border border-bg-tertiary rounded-xl pl-8 pr-4 py-3 text-text-primary font-mono text-lg placeholder:text-text-muted/50 focus:outline-none focus:border-banana [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                    </div>
                    {price && offerAmountNum > 0 && offerAmountNum >= price && (
                      <p className="text-warning text-xs mt-1.5">Your offer is at or above the listing price. Consider using Buy Now instead.</p>
                    )}
                  </div>

                  {/* Expiration */}
                  <div className="mb-4">
                    <label className="block text-text-secondary text-sm mb-2">Offer Expires In</label>
                    <div className="flex gap-2">
                      {[
                        { label: '1hr', days: 1 / 24 },
                        { label: '1d', days: 1 },
                        { label: '3d', days: 3 },
                        { label: '7d', days: 7 },
                      ].map(opt => (
                        <button
                          key={opt.label}
                          onClick={() => { setOfferExpiration(opt.days); setShowCustomExpiry(false); }}
                          className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all border ${
                            !showCustomExpiry && offerExpiration === opt.days
                              ? 'border-banana bg-banana/10 text-banana'
                              : 'border-bg-tertiary text-text-secondary hover:border-bg-elevated'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                      <button
                        onClick={() => {
                          setShowCustomExpiry(true);
                          setOfferExpiration(0);
                        }}
                        className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all border ${
                          showCustomExpiry
                            ? 'border-banana bg-banana/10 text-banana'
                            : 'border-bg-tertiary text-text-secondary hover:border-bg-elevated'
                        }`}
                      >
                        Custom
                      </button>
                    </div>
                    {showCustomExpiry && (
                      <div className="flex items-center gap-2 mt-3">
                        <input
                          type="text"
                          inputMode="numeric"
                          placeholder="e.g. 12"
                          value={customExpiryAmount}
                          onChange={(e) => {
                            const raw = e.target.value.replace(/[^0-9]/g, '');
                            setCustomExpiryAmount(raw);
                            const val = parseInt(raw, 10);
                            if (!isNaN(val) && val > 0) {
                              setOfferExpiration(customExpiryUnit === 'days' ? val : val / 24);
                            } else {
                              setOfferExpiration(0);
                            }
                          }}
                          className="flex-1 bg-bg-primary border border-bg-tertiary rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-banana/50 [appearance:textfield]"
                        />
                        <div className="flex rounded-lg border border-bg-tertiary overflow-hidden">
                          <button
                            onClick={() => {
                              setCustomExpiryUnit('hours');
                              const val = parseInt(customExpiryAmount, 10);
                              if (!isNaN(val) && val > 0) setOfferExpiration(val / 24);
                            }}
                            className={`px-3 py-2.5 text-xs font-medium transition-all ${
                              customExpiryUnit === 'hours'
                                ? 'bg-banana/15 text-banana'
                                : 'bg-bg-primary text-text-secondary hover:text-white'
                            }`}
                          >
                            Hours
                          </button>
                          <button
                            onClick={() => {
                              setCustomExpiryUnit('days');
                              const val = parseInt(customExpiryAmount, 10);
                              if (!isNaN(val) && val > 0) setOfferExpiration(val);
                            }}
                            className={`px-3 py-2.5 text-xs font-medium transition-all ${
                              customExpiryUnit === 'days'
                                ? 'bg-banana/15 text-banana'
                                : 'bg-bg-primary text-text-secondary hover:text-white'
                            }`}
                          >
                            Days
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Payment Method — Card funds the offer via MoonPay, then it escrows */}
                  <div className="mb-4">
                    <label className="block text-text-secondary text-sm mb-2">Pay with</label>
                    <PaymentMethodSquares
                      value={offerPaymentMethod}
                      onChange={setOfferPaymentMethod}
                      isEmbeddedWallet={isEmbeddedWallet}
                      usdcBalance={user?.usdcBalance ?? null}
                      requiredAmount={offerAmountNum}
                    />
                  </div>

                  {/* Summary */}
                  {offerAmountNum > 0 && (
                    <div className="p-4 bg-bg-primary rounded-xl space-y-2 mb-4">
                      <div className="flex justify-between text-sm">
                        <span className="text-text-secondary">Offer Amount</span>
                        <span className="text-text-primary font-mono">${offerAmountNum.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-text-secondary">Seller receives (after 1% OpenSea fee)</span>
                        <span className="text-text-primary font-mono">${(offerAmountNum - offerFee).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-sm pt-2 border-t border-bg-tertiary font-semibold">
                        <span className="text-text-primary">You Pay</span>
                        <span className="text-text-primary font-mono">${offerAmountNum.toFixed(2)}</span>
                      </div>
                    </div>
                  )}

                  {offerError && (
                    <div className="p-3 bg-error/10 border border-error/30 rounded-xl mb-4">
                      <p className="text-error text-sm">{offerError}</p>
                    </div>
                  )}

                  <button
                    onClick={handleMakeOffer}
                    disabled={!offerAmount || offerAmountNum <= 0 || offerExpiration <= 0}
                    className="w-full py-4 bg-banana text-black font-semibold rounded-xl hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Submit Offer
                  </button>
                  <p className="text-center text-text-muted text-xs mt-3">
                    {isEmbeddedWallet
                      ? 'Your offer is held securely until it’s accepted or expires.'
                      : 'Your USDC will be held in escrow until the offer is accepted or expires.'}
                  </p>
                </div>
              </>
            )}

            {offerStep === 'processing' && (
              <div className="p-12 text-center">
                <div className="w-16 h-16 mx-auto mb-6 relative">
                  <div className="absolute inset-0 border-4 border-bg-tertiary rounded-full"></div>
                  <div className="absolute inset-0 border-4 border-banana rounded-full border-t-transparent animate-spin"></div>
                </div>
                <h3 className="text-text-primary font-semibold text-lg mb-2">
                  Creating Offer
                </h3>
                <p className="text-text-secondary text-sm">
                  Signing your offer...
                </p>
              </div>
            )}

            {offerStep === 'complete' && (
              <div className="p-12 text-center">
                <div className="w-16 h-16 mx-auto mb-6 bg-success/20 rounded-full flex items-center justify-center">
                  <svg className="w-8 h-8 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path d="M5 13l4 4L19 7"/>
                  </svg>
                </div>
                <h3 className="text-text-primary font-semibold text-lg mb-2">Offer Submitted!</h3>
                <p className="text-text-secondary text-sm mb-6">
                  Your ${offerAmountNum.toFixed(2)} offer on {teamName} is live.
                </p>
                <button
                  onClick={() => setShowOfferModal(false)}
                  className="px-8 py-3 bg-banana text-black font-semibold rounded-xl hover:brightness-110 transition-all"
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
