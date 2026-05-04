'use client';

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useSendTransaction, useWallets, useFundWallet } from '@privy-io/react-auth';
import { useAuth } from '@/hooks/useAuth';
import { useNftOffers, useTokenSaleHistory, logActivity, notifySeller, notifyOwnerOfOffer, notifyOffererOfAcceptance } from '@/hooks/useMarketplace';
import { useNotifications } from '@/components/NotificationCenter';
import { BASE_SEPOLIA, getUsdcBalance } from '@/lib/contracts/bbb4';
import type { Address } from 'viem';
import type { DraftType, OfferData } from '@/lib/opensea';
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
  listing: {
    order_hash: string;
    protocol_address: string;
    price: { current: { value: string; decimals: number } };
    protocol_data: { parameters: { offerer: string } };
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

export default function NftDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const tokenId = (params?.tokenId as string) ?? '';
  const autoBuy = searchParams?.get('buy') === 'true';
  const autoOffer = searchParams?.get('offer') === 'true';
  const { isLoggedIn, walletAddress, user, setShowLoginModal } = useAuth();
  const { wallets, ready: _walletsReady } = useWallets();
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

  const [nft, setNft] = useState<NftDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [buyStep, setBuyStep] = useState<'confirm' | 'processing' | 'complete'>('confirm');
  const [txError, setTxError] = useState<string | null>(null);
  const [showBuyModal, setShowBuyModal] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'card' | 'usdc'>('card');
  const [cardFlowStep, setCardFlowStep] = useState<'idle' | 'funding' | 'waiting' | 'buying'>('idle');

  // Offer state
  const [showOfferModal, setShowOfferModal] = useState(false);
  const [offerAmount, setOfferAmount] = useState('');
  const [offerExpiration, setOfferExpiration] = useState(7);
  const [showCustomExpiry, setShowCustomExpiry] = useState(false);
  const [customExpiryAmount, setCustomExpiryAmount] = useState('');
  const [customExpiryUnit, setCustomExpiryUnit] = useState<'hours' | 'days'>('hours');
  const [offerStep, setOfferStep] = useState<'input' | 'processing' | 'complete'>('input');
  const [offerError, setOfferError] = useState<string | null>(null);

  // Accept offer state
  const [acceptingOfferHash, setAcceptingOfferHash] = useState<string | null>(null);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  // Cancel offer state
  const [cancellingOfferHash, setCancellingOfferHash] = useState<string | null>(null);

  // Share state
  const [shareCopied, setShareCopied] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false);

  // Offers data
  const { offers, isLoading: offersLoading, refetch: refetchOffers, bestOffer } = useNftOffers(tokenId);

  // Sale history
  const { activities: saleHistory, isLoading: saleHistoryLoading } = useTokenSaleHistory(tokenId);

  const fetchNft = useCallback(() => {
    if (!tokenId) return;
    setIsLoading(true);
    fetch(`/api/marketplace/nft/${tokenId}`)
      .then(res => {
        if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
        return res.json();
      })
      .then(data => { setNft(data); setError(null); })
      .catch(err => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [tokenId]);

  useEffect(() => {
    fetchNft();
  }, [fetchNft]);

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

  const executeBuy = useCallback(async () => {
    if (!nft?.listing?.order_hash || !nft?.listing?.protocol_address || !walletAddress) return;

    const buyPrice = nft.listing?.price?.current
      ? Number(nft.listing.price.current.value) / Math.pow(10, nft.listing.price.current.decimals ?? 18)
      : null;

    const { getFulfillmentTx } = await import('@/lib/marketplace/buy');
    const tx = await getFulfillmentTx(
      nft.listing.order_hash,
      walletAddress,
      nft.listing.protocol_address,
    );
    const receipt = await sendTransaction(
      { to: tx.to, value: BigInt(tx.value), data: tx.data as `0x${string}`, chainId: 8453 },
      { sponsor: true, uiOptions: { description: 'Purchase NFT — gas fees covered by SBS' } },
    );
    const txHashResult = (receipt as Record<string, unknown>).transactionHash ?? (receipt as Record<string, unknown>).hash;

    const sellerAddr = nft.listing?.protocol_data?.parameters?.offerer || nft.owner;
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
  }, [nft, walletAddress, sendTransaction, tokenId, addNotification]);

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
        setBuyStep('complete');
        setTimeout(() => fetchNft(), 2000);
      } catch (err) {
        console.error('[NFT Detail] Buy failed:', err);
        setTxError(err instanceof Error ? err.message : 'Transaction failed');
        setBuyStep('confirm');
      }
    } else {
      // Card flow via MoonPay
      setTxError(null);
      setCardFlowStep('funding');
      setBuyStep('processing');

      try {
        const result = await fundWallet({
          address: walletAddress,
          options: {
            chain: BASE_SEPOLIA,
            amount: String(buyPrice),
            asset: 'USDC',
            card: { preferredProvider: 'moonpay' },
          },
        });

        if (result.status === 'cancelled') {
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
          const balance = await getUsdcBalance(walletAddress as Address);
          if (balance >= requiredUsdc) break;
          await new Promise(r => setTimeout(r, 3000));
        }

        // Execute Seaport buy
        setCardFlowStep('buying');
        await executeBuy();

        setBuyStep('complete');
        setCardFlowStep('idle');
        setTimeout(() => fetchNft(), 2000);
      } catch (err) {
        console.error('[NFT Detail] Card buy failed:', err);
        setTxError(err instanceof Error ? err.message : 'Payment failed');
        setBuyStep('confirm');
        setCardFlowStep('idle');
      }
    }
  }, [nft, walletAddress, paymentMethod, executeBuy, fundWallet, fetchNft]);

  const handleMakeOffer = useCallback(async () => {
    if (!walletAddress || !selectedWallet || !offerAmount) return;
    const amount = parseFloat(offerAmount);
    if (isNaN(amount) || amount <= 0) {
      setOfferError('Enter a valid offer amount');
      return;
    }

    setOfferStep('processing');
    setOfferError(null);

    try {
      const { createOffer } = await import('@/lib/marketplace/offer');
      const { ethers } = await import('ethers');

      const ethereum = await selectedWallet.getEthereumProvider();
      const currentChainHex = (await ethereum.request({ method: 'eth_chainId' })) as string;
      if (parseInt(currentChainHex, 16) !== 8453) {
        await selectedWallet.switchChain(8453);
      }

      // Sponsor USDC approval for the conduit if needed
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
      const requiredAmount = ethers.parseUnits(amount.toString(), 6);

      if (currentAllowance < requiredAmount) {
        // Approve max USDC for the conduit (sponsored)
        const maxApproval = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
        const approvalData = iface.encodeFunctionData('approve', [OPENSEA_CONDUIT, maxApproval]);
        await sendTransaction(
          { to: USDC_BASE as `0x${string}`, data: approvalData as `0x${string}`, chainId: 8453 },
          { sponsor: true, uiOptions: { description: 'Approve USDC for offers — no cost to you' } },
        );
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
      setOfferError(err instanceof Error ? err.message : 'Failed to create offer');
      setOfferStep('input');
    }
  }, [walletAddress, selectedWallet, offerAmount, offerExpiration, tokenId, sendTransaction, refetchOffers, nft]);

  const handleAcceptOffer = useCallback(async (offer: OfferData) => {
    if (!walletAddress || !selectedWallet) return;
    setAcceptingOfferHash(offer.orderHash);
    setAcceptError(null);

    try {
      const { getOfferFulfillmentTx } = await import('@/lib/marketplace/offer');
      const { ethers } = await import('ethers');
      const { BBB4_CONTRACT } = await import('@/lib/opensea');

      const ethereum = await selectedWallet.getEthereumProvider();
      const currentChainHex = (await ethereum.request({ method: 'eth_chainId' })) as string;
      if (parseInt(currentChainHex, 16) !== 8453) {
        await selectedWallet.switchChain(8453);
      }

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

      if (!isApproved) {
        const approvalData = iface.encodeFunctionData('setApprovalForAll', [OPENSEA_CONDUIT, true]);
        await sendTransaction(
          { to: BBB4_CONTRACT as `0x${string}`, data: approvalData as `0x${string}`, chainId: 8453 },
          { sponsor: true, uiOptions: { description: 'Approve marketplace — no cost to you' } },
        );
      }

      const tx = await getOfferFulfillmentTx(
        offer.orderHash,
        walletAddress,
        offer.protocolAddress,
        tokenId,
      );

      await sendTransaction(
        { to: tx.to, value: BigInt(tx.value), data: tx.data as `0x${string}`, chainId: 8453 },
        { sponsor: true, uiOptions: { description: 'Accept offer — gas fees covered by SBS' } },
      );

      logger.debug('[NFT Detail] Offer accepted:', offer.orderHash);

      logActivity({
        type: 'offer_accepted',
        walletAddress,
        tokenId,
        teamName: nft?.name || `Team #${tokenId}`,
        price: offer.amount,
        counterparty: offer.offererAddress || null,
        orderHash: offer.orderHash || null,
      });

      // Notify the offerer (Firestore — they're not on this page)
      if (offer.offererAddress) {
        notifyOffererOfAcceptance({
          offererWallet: offer.offererAddress,
          tokenId,
          teamName: nft?.name || `Team #${tokenId}`,
          offerAmount: offer.amount,
        });
      }

      refetchOffers();
      setTimeout(() => fetchNft(), 2000);
    } catch (err) {
      console.error('[NFT Detail] Accept offer failed:', err);
      setAcceptError(err instanceof Error ? err.message : 'Failed to accept offer');
    } finally {
      setAcceptingOfferHash(null);
    }
  }, [walletAddress, selectedWallet, tokenId, sendTransaction, refetchOffers, nft, fetchNft]);

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

      await sendTransaction(
        { to: tx.to as `0x${string}`, data: tx.data as `0x${string}`, chainId: 8453 },
        { sponsor: true, uiOptions: { description: 'Cancel your offer — fees covered by SBS' } },
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

      refetchOffers();
    } catch (err) {
      console.error('[NFT Detail] Cancel offer failed:', err);
      setAcceptError(err instanceof Error ? err.message : 'Failed to cancel offer');
    } finally {
      setCancellingOfferHash(null);
    }
  }, [walletAddress, sendTransaction, refetchOffers, tokenId, nft]);

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
        <Link href="/marketplace" className="text-banana hover:underline text-sm">
          Back to Marketplace
        </Link>
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
  const teamName = leagueName || nft.name || `Team #${tokenId}`;

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
      {/* Back Link */}
      <Link
        href="/marketplace"
        className="inline-flex items-center gap-2 text-text-secondary hover:text-text-primary text-sm mb-8 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Back to Marketplace
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
        {/* Left: Card Image */}
        <div>
          <div className={`relative aspect-[3/4] rounded-2xl overflow-hidden border ${
            draftType === 'jackpot' ? 'border-error/40' : draftType === 'hof' ? 'border-hof/40' : 'border-bg-tertiary'
          }`}>
            {imageUrl ? (
              <Image
                src={imageUrl}
                alt={teamName}
                fill
                className="object-cover"
                sizes="(max-width: 1024px) 100vw, 50vw"
                priority
              />
            ) : (
              <div className={`w-full h-full bg-gradient-to-br ${
                draftType === 'jackpot' ? 'from-error/20 to-bg-secondary'
                : draftType === 'hof' ? 'from-hof/20 to-bg-secondary'
                : 'from-pro/20 to-bg-secondary'
              } flex items-center justify-center`}>
                <span className="text-8xl">🍌</span>
              </div>
            )}

            {/* Type Badge */}
            {draftType !== 'pro' && (
              <div className="absolute top-4 left-4">
                {draftType === 'jackpot' && (
                  <span className="px-4 py-1.5 bg-error text-white text-xs font-bold uppercase rounded-full shadow-lg">
                    JACKPOT
                  </span>
                )}
                {draftType === 'hof' && (
                  <span className="px-4 py-1.5 bg-gradient-to-r from-hof to-pink-600 text-white text-xs font-bold uppercase rounded-full shadow-lg flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                    </svg>
                    HALL OF FAME
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
          <div className="flex items-center gap-2 text-text-muted text-sm mb-6">
            <span>Token #{tokenId}</span>
            {nftOwner && (
              <>
                <span>&middot;</span>
                {nft.ownerPfp ? (
                  <Image src={nft.ownerPfp} alt="" width={20} height={20} className="rounded-full" />
                ) : null}
                <span>
                  Owner: {nft.ownerName || `${nftOwner.slice(0, 6)}...${nftOwner.slice(-4)}`}
                </span>
              </>
            )}
          </div>

          {/* Stats Row */}
          {(rank || seasonScore || weekScore) && (
            <div className="grid grid-cols-3 gap-3 mb-6">
              {rank && rank !== 'N/A' && (
                <div className="bg-bg-secondary border border-bg-tertiary rounded-xl p-4 text-center">
                  <p className="text-text-muted text-[10px] uppercase tracking-wider mb-1">Rank</p>
                  <p className="font-mono text-xl font-bold text-banana">#{rank}</p>
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

          {/* Price & Buy / Make Offer */}
          <div className="bg-bg-secondary border border-bg-tertiary rounded-2xl p-5 mb-6">
            {price !== null ? (
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-text-muted text-xs mb-1">Current Price</p>
                    <p className="text-text-primary font-mono text-3xl font-bold">
                      ${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
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
                  ) : null}
                </div>

                {txError && (
                  <p className="text-error text-xs mt-3">{txError}</p>
                )}
              </>
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

          {/* Offers Section */}
          {(offers.length > 0 || offersLoading) && (
            <div className="bg-bg-secondary border border-bg-tertiary rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-text-primary font-semibold text-sm">
                  Offers {offers.length > 0 && <span className="text-text-muted font-normal">({offers.length})</span>}
                </h3>
                {bestOffer && (
                  <span className="text-xs text-text-muted">
                    Best: <span className="text-banana font-mono font-semibold">${bestOffer.amount.toFixed(2)}</span>
                  </span>
                )}
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
                            <button
                              onClick={() => handleAcceptOffer(offer)}
                              disabled={acceptingOfferHash === offer.orderHash}
                              className="px-4 py-1.5 bg-success text-white text-xs font-semibold rounded-lg hover:brightness-110 transition-all disabled:opacity-50"
                            >
                              {acceptingOfferHash === offer.orderHash ? 'Accepting...' : 'Accept'}
                            </button>
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

          {/* Sale History */}
          {(saleHistory.length > 0 || saleHistoryLoading) && (
            <div className="bg-bg-secondary border border-bg-tertiary rounded-2xl p-5 mt-6">
              <h3 className="text-text-primary font-semibold text-sm mb-4">
                Sale History {saleHistory.length > 0 && <span className="text-text-muted font-normal">({saleHistory.length})</span>}
              </h3>
              {saleHistoryLoading && saleHistory.length === 0 ? (
                <div className="space-y-3">
                  {[...Array(2)].map((_, i) => (
                    <div key={i} className="h-10 bg-bg-tertiary rounded-xl animate-pulse" />
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {saleHistory.map(sale => {
                    const saleDate = new Date(sale.timestamp);
                    const timeAgo = (() => {
                      const diff = Date.now() - saleDate.getTime();
                      const mins = Math.floor(diff / 60000);
                      if (mins < 60) return `${mins}m ago`;
                      const hrs = Math.floor(mins / 60);
                      if (hrs < 24) return `${hrs}h ago`;
                      const days = Math.floor(hrs / 24);
                      if (days < 30) return `${days}d ago`;
                      return saleDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                    })();
                    return (
                      <div
                        key={sale.id}
                        className="flex items-center justify-between p-3 rounded-xl bg-bg-primary border border-bg-tertiary"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-banana/10 flex items-center justify-center">
                            <svg className="w-4 h-4 text-banana" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                            </svg>
                          </div>
                          <div>
                            <p className="text-text-primary text-sm font-mono font-medium">
                              ${sale.price?.toFixed(2) ?? '—'}
                            </p>
                            {sale.counterparty && (
                              <p className="text-text-muted text-[11px]">
                                {sale.type === 'buy' ? 'Bought by' : 'Sold to'} {sale.counterparty.slice(0, 6)}...{sale.counterparty.slice(-4)}
                              </p>
                            )}
                          </div>
                        </div>
                        <span className="text-text-muted text-xs">{timeAgo}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Buy Modal */}
      {showBuyModal && nft?.listing && price !== null && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => buyStep === 'confirm' && setShowBuyModal(false)}
        >
          <div
            className="bg-bg-secondary border border-bg-tertiary rounded-2xl w-full max-w-md"
            onClick={e => e.stopPropagation()}
          >
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
                        {rank && rank !== 'N/A' && (
                          <span className="text-text-muted text-xs">Rank #{rank}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Payment Method */}
                  <div className="mb-4">
                    <label className="block text-text-secondary text-sm mb-3">Payment Method</label>
                    <div className="grid gap-3 grid-cols-2">
                      <button
                        onClick={() => setPaymentMethod('card')}
                        className={`p-4 rounded-xl border-2 transition-all ${
                          paymentMethod === 'card'
                            ? 'border-banana bg-banana/10'
                            : 'border-bg-tertiary hover:border-bg-elevated'
                        }`}
                      >
                        <div className="flex items-center justify-center gap-2 mb-2">
                          <svg className="w-6 h-4" viewBox="0 0 24 16" fill="none">
                            <rect width="24" height="16" rx="2" fill="#1A1F71"/>
                            <path d="M9.5 10.5L10.5 5.5H12L11 10.5H9.5Z" fill="white"/>
                            <path d="M15.5 5.5C15 5.5 14.5 5.7 14.3 6L12 10.5H13.7L14 9.7H16L16.2 10.5H17.7L16.5 5.5H15.5ZM14.5 8.5L15.2 6.7L15.6 8.5H14.5Z" fill="white"/>
                            <path d="M8 5.5L6 10.5H7.5L7.8 9.5H9.5L9.8 10.5H11.3L9.3 5.5H8ZM8 8.3L8.5 6.7L9 8.3H8Z" fill="white"/>
                          </svg>
                          <svg className="w-8 h-5" viewBox="0 0 32 20" fill="none">
                            <rect width="32" height="20" rx="2" fill="#EB001B"/>
                            <circle cx="12" cy="10" r="6" fill="#EB001B"/>
                            <circle cx="20" cy="10" r="6" fill="#F79E1B"/>
                            <path d="M16 5.5C17.5 6.7 18.5 8.2 18.5 10C18.5 11.8 17.5 13.3 16 14.5C14.5 13.3 13.5 11.8 13.5 10C13.5 8.2 14.5 6.7 16 5.5Z" fill="#FF5F00"/>
                          </svg>
                        </div>
                        <span className={`text-sm font-medium ${paymentMethod === 'card' ? 'text-text-primary' : 'text-text-secondary'}`}>
                          Card
                        </span>
                        <p className="text-text-muted text-[10px] mt-1">Powered by MoonPay</p>
                      </button>
                      <button
                        onClick={() => setPaymentMethod('usdc')}
                        className={`p-4 rounded-xl border-2 transition-all ${
                          paymentMethod === 'usdc'
                            ? 'border-banana bg-banana/10'
                            : 'border-bg-tertiary hover:border-bg-elevated'
                        }`}
                      >
                        <div className="flex items-center justify-center gap-2 mb-2">
                          <span className="text-lg font-bold text-text-primary">$</span>
                        </div>
                        <span className={`text-sm font-medium ${paymentMethod === 'usdc' ? 'text-text-primary' : 'text-text-secondary'}`}>
                          USDC
                        </span>
                        {user?.usdcBalance != null && (
                          <p className="text-text-muted text-[10px] mt-1">
                            Balance: ${user.usdcBalance.toFixed(2)}
                          </p>
                        )}
                      </button>
                    </div>
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
                        Pay ${(price + 0.01).toFixed(2)} USDC
                      </>
                    )}
                  </button>
                  <p className="text-center text-text-muted text-xs mt-3">
                    {paymentMethod === 'card'
                      ? 'Secure payment powered by MoonPay'
                      : 'USDC payment on Base network'
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
                    : 'Completing your purchase on Base...'
                    : 'Completing your purchase on Base...'
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
                <p className="text-text-secondary text-sm mb-6">{teamName} is now yours</p>
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
                  <Link
                    href="/marketplace?tab=sell"
                    className="px-6 py-3 bg-banana text-black font-semibold rounded-xl hover:brightness-110 transition-all text-sm"
                  >
                    View My Teams
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
          onClick={() => offerStep === 'input' && setShowOfferModal(false)}
        >
          <div
            className="bg-bg-secondary border border-bg-tertiary rounded-2xl w-full max-w-md"
            onClick={e => e.stopPropagation()}
          >
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
                      <p className="text-text-muted text-xs">Token #{tokenId}</p>
                    </div>
                  </div>

                  {/* Offer Amount */}
                  <div className="mb-4">
                    <label className="block text-text-secondary text-sm mb-2">Your Offer (USDC)</label>
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

                  {/* Summary */}
                  {offerAmountNum > 0 && (
                    <div className="p-4 bg-bg-primary rounded-xl space-y-2 mb-4">
                      <div className="flex justify-between text-sm">
                        <span className="text-text-secondary">Offer Amount</span>
                        <span className="text-text-primary font-mono">${offerAmountNum.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-text-secondary">OpenSea Fee (1%)</span>
                        <span className="text-text-primary font-mono">${offerFee.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-sm pt-2 border-t border-bg-tertiary font-semibold">
                        <span className="text-text-primary">Total USDC Required</span>
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
                    Your USDC will be held in escrow until the offer is accepted or expires.
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
                  Signing your offer on Base...
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
