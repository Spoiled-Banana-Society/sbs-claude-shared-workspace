'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useFundWallet, useSendTransaction, useWallets } from '@privy-io/react-auth';
import { useNotifications } from '@/components/NotificationCenter';
import { ActivityTab } from '@/app/components/marketplace/ActivityTab';
import { BuyTab } from '@/app/components/marketplace/BuyTab';
import { SellTab } from '@/app/components/marketplace/SellTab';
import { SweepModal } from '@/app/components/marketplace/SweepModal';
import { WatchlistTab } from '@/app/components/marketplace/WatchlistTab';
import { useAuth } from '@/hooks/useAuth';
import { logActivity, notifySeller, useActivityHistory, useCollectionNfts, useCollectionStats, useLastSales, useListings, useMyNftOffers, useMyNfts, useWatchlist } from '@/hooks/useMarketplace';
import { BASE_SEPOLIA, getUsdcBalance } from '@/lib/contracts/bbb4';
import { isDraftingOpen } from '@/lib/draftTypes';
import { logger } from '@/lib/logger';
import type { MarketplaceTeam } from '@/lib/opensea';
import type { Address } from 'viem';

type TabKey = 'buy' | 'sell' | 'activity' | 'watchlist';
type ViewFilter = 'listed' | 'all' | 'top' | 'jackpot' | 'hof';
type BuyStep = 'confirm' | 'processing' | 'complete';
type PaymentMethod = 'card' | 'usdc';
type SweepStep = 'confirm' | 'processing' | 'complete';
type SweepStatus = 'pending' | 'processing' | 'done' | 'failed';
type SuccessType = 'buy' | 'sell' | 'list';
type CardFlowStep = 'idle' | 'funding' | 'waiting' | 'buying';

export default function MarketplacePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isLoggedIn, walletAddress, user, setShowLoginModal } = useAuth();
  const { addNotification } = useNotifications();
  const { wallets } = useWallets();
  const { sendTransaction } = useSendTransaction();
  const { fundWallet } = useFundWallet();

  const selectedWallet = useMemo(() => {
    if (wallets.length === 0) return null;
    if (walletAddress) {
      return wallets.find(wallet => wallet.address.toLowerCase() === walletAddress.toLowerCase()) || wallets[0];
    }
    return wallets[0];
  }, [walletAddress, wallets]);

  const [activeTab, setActiveTab] = useState<TabKey>('buy');
  const [viewFilter, setViewFilter] = useState<ViewFilter>('listed');
  const [hofFilter] = useState(false);
  const [jackpotFilter] = useState(false);
  const [rosterFilter, setRosterFilter] = useState('');
  const [sortBy, setSortBy] = useState('price-low');
  const [selectedTeam, setSelectedTeam] = useState<MarketplaceTeam | null>(null);
  const [showBuyModal, setShowBuyModal] = useState(false);
  const [showSellModal, setShowSellModal] = useState(false);
  const [showFreePassInfo, setShowFreePassInfo] = useState<'team' | 'pass' | null>(null);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successType, setSuccessType] = useState<SuccessType>('buy');
  const [listPrice, setListPrice] = useState('');
  const [buyStep, setBuyStep] = useState<BuyStep>('confirm');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('card');
  const [txError, setTxError] = useState<string | null>(null);
  const [cancelConfirmTeam, setCancelConfirmTeam] = useState<MarketplaceTeam | null>(null);
  const [cardFlowStep, setCardFlowStep] = useState<CardFlowStep>('idle');
  const [sweepMode, setSweepMode] = useState(false);
  const [sweepSelected, setSweepSelected] = useState<Set<string>>(new Set());
  const [showSweepModal, setShowSweepModal] = useState(false);
  const [sweepStep, setSweepStep] = useState<SweepStep>('confirm');
  const [sweepProgress, setSweepProgress] = useState<Record<string, SweepStatus>>({});
  const [sweepPaymentMethod, setSweepPaymentMethod] = useState<PaymentMethod>('card');
  const [cancellingTokenId, setCancellingTokenId] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    const tabParam = searchParams?.get('tab');
    if (tabParam === 'sell' || tabParam === 'activity' || tabParam === 'watchlist') setActiveTab(tabParam);
  }, [searchParams]);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const { data: collectionStats, isLoading: statsLoading } = useCollectionStats();

  const sortMap: Record<string, { sort: string; direction: string }> = {
    'price-low': { sort: 'price', direction: 'asc' },
    'price-high': { sort: 'price', direction: 'desc' },
    rank: { sort: 'price', direction: 'asc' },
    points: { sort: 'price', direction: 'desc' },
    playoffs: { sort: 'price', direction: 'desc' },
  };
  const currentSort = sortMap[sortBy] || sortMap['price-low'];

  const { data: listings, isLoading: listingsLoading, hasMore, loadMore, refetch: refetchListings } = useListings(currentSort.sort, currentSort.direction);
  const { data: allNfts, isLoading: allNftsLoading, hasMore: allNftsHasMore, loadMore: loadMoreAllNfts } = useCollectionNfts();
  const { data: myNfts, isLoading: myNftsLoading, refetch: refetchMyNfts } = useMyNfts(isLoggedIn ? walletAddress : null);
  const { activities, isLoading: activityLoading, hasMore: activityHasMore, loadMore: loadMoreActivity, refetch: refetchActivity } = useActivityHistory(isLoggedIn ? walletAddress : null);
  const { allOffers: myNftOffers, isLoading: myNftOffersLoading } = useMyNftOffers(isLoggedIn ? walletAddress : null, myNfts);
  const { watchlist, watchlistSet, toggle: toggleWatchlist } = useWatchlist(isLoggedIn ? walletAddress : null);

  const enrichedListings = useMemo(() => {
    if (!walletAddress || !user) return listings;
    return listings.map(team => team.ownerAddress?.toLowerCase() === walletAddress.toLowerCase()
      ? { ...team, owner: user.username || team.owner, ownerPfp: user.profilePicture || team.ownerPfp }
      : team);
  }, [listings, walletAddress, user]);

  const baseTeams = useMemo(() => {
    if (viewFilter === 'all') return allNfts;
    if (viewFilter === 'jackpot' || viewFilter === 'hof' || viewFilter === 'top') return enrichedListings.concat(allNfts.filter(team => !team.orderHash));
    return enrichedListings;
  }, [viewFilter, enrichedListings, allNfts]);

  const filteredTeams = useMemo(() => baseTeams.filter(team => {
    if (viewFilter === 'jackpot' && !team.isJackpot) return false;
    if (viewFilter === 'hof' && !team.isHof) return false;
    if (viewFilter === 'top' && team.points <= 0) return false;
    if (viewFilter === 'listed' || viewFilter === 'all') {
      if (hofFilter && !team.isHof) return false;
      if (jackpotFilter && !team.isJackpot) return false;
    }

    if (rosterFilter) {
      const query = rosterFilter.trim().replace(/^#/, '');
      if (/^\d+$/.test(query)) {
        const matchesTokenId = team.tokenId === query;
        const matchesName = team.name.includes(query);
        if (!matchesTokenId && !matchesName) return false;
      } else {
        const normalized = query.toUpperCase().replace(/\s+/g, '');
        const matchesName = team.name.toUpperCase().replace(/\s+/g, '').includes(normalized);
        const hasRosterMatch = team.roster.some(slot => slot.toUpperCase().replace(/\s+/g, '').includes(normalized));
        if (!matchesName && !hasRosterMatch) return false;
      }
    }
    return true;
  }).sort((a, b) => {
    if (viewFilter === 'top') return b.points - a.points;
    switch (sortBy) {
      case 'price-low': return (a.price || 9999) - (b.price || 9999);
      case 'price-high': return (b.price || 0) - (a.price || 0);
      case 'rank': return (a.rank || 9999) - (b.rank || 9999);
      case 'points': return b.points - a.points;
      case 'playoffs': return b.playoffOdds - a.playoffOdds;
      default: return 0;
    }
  }), [baseTeams, viewFilter, hofFilter, jackpotFilter, rosterFilter, sortBy]);

  const deduplicatedTeams = useMemo(() => {
    const seen = new Set<string>();
    return filteredTeams.filter(team => {
      if (seen.has(team.tokenId)) return false;
      seen.add(team.tokenId);
      return true;
    });
  }, [filteredTeams]);

  const displayedTokenIds = useMemo(() => deduplicatedTeams.map(team => team.tokenId), [deduplicatedTeams]);
  const lastSales = useLastSales(displayedTokenIds);
  const sweepTeams = useMemo(() => deduplicatedTeams.filter(team => sweepSelected.has(team.tokenId) && team.price != null), [deduplicatedTeams, sweepSelected]);
  const sweepTotal = useMemo(() => sweepTeams.reduce((sum, team) => sum + (team.price || 0), 0), [sweepTeams]);
  const leaderboardTeams = useMemo(() => [...enrichedListings].filter(team => team.price !== null).sort((a, b) => (b.price || 0) - (a.price || 0)).slice(0, 5), [enrichedListings]);

  const requireLogin = useCallback((callback: () => void) => {
    if (!isLoggedIn) {
      setShowLoginModal(true);
      return;
    }
    callback();
  }, [isLoggedIn, setShowLoginModal]);

  const handleShare = useCallback((team: { name: string; tokenId: string; price?: number | null }, event?: React.MouseEvent) => {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    const url = `${window.location.origin}/marketplace/${team.tokenId}`;
    const text = `Check out ${team.name}${team.price ? ` - $${team.price.toFixed(2)}` : ''} on SBS Marketplace`;
    window.open(`https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, '_blank');
  }, []);

  const openBuyModal = useCallback((team: MarketplaceTeam) => {
    requireLogin(() => {
      setSelectedTeam(team);
      setBuyStep('confirm');
      setTxError(null);
      setShowBuyModal(true);
    });
  }, [requireLogin]);

  const openSellModal = useCallback((team: MarketplaceTeam) => {
    setSelectedTeam(team);
    setListPrice('');
    setTxError(null);
    setShowSellModal(true);
  }, []);

  const toggleSweepSelect = useCallback((tokenId: string) => {
    setSweepSelected(previous => {
      const next = new Set(previous);
      if (next.has(tokenId)) next.delete(tokenId);
      else next.add(tokenId);
      return next;
    });
  }, []);

  const executeBuy = useCallback(async () => {
    if (!selectedTeam?.orderHash || !selectedTeam.protocolAddress || !walletAddress) return;

    const { getFulfillmentTx } = await import('@/lib/marketplace/buy');
    const tx = await getFulfillmentTx(selectedTeam.orderHash, walletAddress, selectedTeam.protocolAddress);
    const receipt = await sendTransaction(
      { to: tx.to, value: BigInt(tx.value), data: tx.data as `0x${string}`, chainId: 8453 },
      { sponsor: true, uiOptions: { description: 'Purchase NFT — gas fees covered by SBS' } },
    );
    const txHash = (receipt as Record<string, unknown>).transactionHash ?? (receipt as Record<string, unknown>).hash;
    logger.debug('[Marketplace] Buy tx:', txHash);

    if (selectedTeam.ownerAddress) {
      notifySeller({
        sellerWallet: selectedTeam.ownerAddress,
        tokenId: selectedTeam.tokenId,
        teamName: selectedTeam.name,
        price: selectedTeam.price || 0,
        buyerWallet: walletAddress,
      });
    }

    logActivity({ type: 'buy', walletAddress, tokenId: selectedTeam.tokenId, teamName: selectedTeam.name, price: selectedTeam.price, counterparty: selectedTeam.ownerAddress || null, orderHash: selectedTeam.orderHash || null, txHash: txHash ? String(txHash) : null });
    if (selectedTeam.ownerAddress) {
      logActivity({ type: 'sell', walletAddress: selectedTeam.ownerAddress, tokenId: selectedTeam.tokenId, teamName: selectedTeam.name, price: selectedTeam.price, counterparty: walletAddress, orderHash: selectedTeam.orderHash || null, txHash: txHash ? String(txHash) : null });
    }

    addNotification({
      type: 'purchase_complete',
      title: 'Purchase Complete',
      message: `You bought ${selectedTeam.name} for $${(selectedTeam.price || 0).toFixed(2)}`,
      link: `/marketplace/${selectedTeam.tokenId}`,
    });

    return txHash;
  }, [addNotification, selectedTeam, sendTransaction, walletAddress]);

  const handleBuy = useCallback(async () => {
    if (!selectedTeam?.orderHash || !selectedTeam.protocolAddress || !walletAddress) return;
    const price = selectedTeam.price || 0;

    if (paymentMethod === 'usdc') {
      setBuyStep('processing');
      setTxError(null);
      try {
        const { checkUsdcBalance } = await import('@/lib/marketplace/buy');
        const { sufficient, balance } = await checkUsdcBalance(walletAddress, price);
        if (!sufficient) {
          setTxError(`Insufficient balance. You have $${balance.toFixed(2)} but need $${price.toFixed(2)}.`);
          setBuyStep('confirm');
          return;
        }

        await executeBuy();
        setBuyStep('complete');
        setTimeout(() => {
          setShowBuyModal(false);
          setSuccessType('buy');
          setShowSuccessModal(true);
          refetchListings();
          refetchMyNfts();
          refetchActivity();
        }, 1500);
      } catch (error) {
        console.error('[Marketplace] Buy failed:', error);
        setTxError(error instanceof Error ? error.message : 'Transaction failed');
        setBuyStep('confirm');
      }
      return;
    }

    setTxError(null);
    setCardFlowStep('funding');
    setBuyStep('processing');

    try {
      const result = await fundWallet({
        address: walletAddress,
        options: { chain: BASE_SEPOLIA, amount: String(price), asset: 'USDC', card: { preferredProvider: 'moonpay' } },
      });

      if (result.status === 'cancelled') {
        setCardFlowStep('idle');
        setBuyStep('confirm');
        return;
      }

      setCardFlowStep('waiting');
      const requiredUsdc = BigInt(Math.ceil(price * 1e6));
      const startTime = Date.now();
      while (!cancelledRef.current && Date.now() - startTime < 300_000) {
        const balance = await getUsdcBalance(walletAddress as Address);
        if (balance >= requiredUsdc) break;
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      if (cancelledRef.current) return;

      setCardFlowStep('buying');
      await executeBuy();
      setBuyStep('complete');
      setCardFlowStep('idle');
      setTimeout(() => {
        setShowBuyModal(false);
        setSuccessType('buy');
        setShowSuccessModal(true);
        refetchListings();
        refetchMyNfts();
        refetchActivity();
      }, 1500);
    } catch (error) {
      console.error('[Marketplace] Card buy failed:', error);
      setTxError(error instanceof Error ? error.message : 'Payment failed');
      setBuyStep('confirm');
      setCardFlowStep('idle');
    }
  }, [executeBuy, fundWallet, paymentMethod, refetchActivity, refetchListings, refetchMyNfts, selectedTeam, walletAddress]);

  const handleList = useCallback(async () => {
    if (!selectedTeam || !walletAddress || !listPrice) return;
    setTxError(null);

    if (selectedTeam.passType === 'free' && isDraftingOpen()) {
      setShowSellModal(false);
      setShowFreePassInfo('team');
      return;
    }

    try {
      const { createListing } = await import('@/lib/marketplace/sell');
      const { ethers } = await import('ethers');
      const { BBB4_CONTRACT } = await import('@/lib/opensea');

      if (!selectedWallet) throw new Error('No wallet connected');
      const ethereum = await selectedWallet.getEthereumProvider();
      const currentChainHex = (await ethereum.request({ method: 'eth_chainId' })) as string;
      if (parseInt(currentChainHex, 16) !== 8453) await selectedWallet.switchChain(8453);

      const OPENSEA_CONDUIT = '0x1e0049783f008a0085193e00003d00cd54003c71';
      const iface = new ethers.Interface([
        'function isApprovedForAll(address owner, address operator) view returns (bool)',
        'function setApprovalForAll(address operator, bool approved)',
      ]);
      const checkData = iface.encodeFunctionData('isApprovedForAll', [walletAddress, OPENSEA_CONDUIT]);
      const checkRes = await fetch(process.env.NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL || 'https://mainnet.base.org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: BBB4_CONTRACT, data: checkData }, 'latest'] }),
      });
      const checkResult = await checkRes.json();
      const isApproved = checkResult?.result && parseInt(checkResult.result, 16) === 1;

      if (!isApproved) {
        const approvalData = iface.encodeFunctionData('setApprovalForAll', [OPENSEA_CONDUIT, true]);
        const receipt = await sendTransaction(
          { to: BBB4_CONTRACT as `0x${string}`, data: approvalData as `0x${string}`, chainId: 8453 },
          { sponsor: true, uiOptions: { description: 'Approve marketplace to list your NFTs — no cost to you, fees covered by SBS' } },
        );
        logger.debug('[Marketplace] Approval tx:', receipt.hash);
      }

      const provider = new ethers.BrowserProvider(ethereum);
      const result = await createListing(selectedTeam.tokenId, parseFloat(listPrice), walletAddress, provider);
      logger.debug('[Marketplace] Listed with orderHash:', result.orderHash);

      logActivity({ type: 'list', walletAddress, tokenId: selectedTeam.tokenId, teamName: selectedTeam.name, price: parseFloat(listPrice), orderHash: result.orderHash || null });
      addNotification({
        type: 'listing_created',
        title: 'Team Listed',
        message: `${selectedTeam.name} listed for $${parseFloat(listPrice).toFixed(2)}`,
        link: `/marketplace/${selectedTeam.tokenId}`,
      });

      setShowSellModal(false);
      setSuccessType('list');
      setShowSuccessModal(true);
      refetchListings();
      refetchMyNfts();
      refetchActivity();
    } catch (error) {
      console.error('[Marketplace] List failed:', error);
      setTxError(error instanceof Error ? error.message : 'Listing failed');
    }
  }, [addNotification, listPrice, refetchActivity, refetchListings, refetchMyNfts, selectedTeam, selectedWallet, sendTransaction, walletAddress]);

  const executeCancel = useCallback(async (team: MarketplaceTeam) => {
    if (!team.orderHash || !walletAddress) return;
    setCancellingTokenId(team.tokenId);
    setTxError(null);

    try {
      const response = await fetch('/api/marketplace/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderHash: team.orderHash }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to prepare cancel transaction' }));
        throw new Error(errorData.error || `Cancel failed: ${response.status}`);
      }

      const tx = await response.json();
      await sendTransaction(
        { to: tx.to as `0x${string}`, data: tx.data as `0x${string}`, chainId: 8453 },
        { sponsor: true, uiOptions: { description: 'Cancel your listing — fees covered by SBS' } },
      );

      logger.debug('[Marketplace] Cancelled listing for token:', team.tokenId);
      logActivity({ type: 'cancel', walletAddress, tokenId: team.tokenId, teamName: team.name, price: team.price, orderHash: team.orderHash || null });
      refetchListings();
      refetchMyNfts();
      refetchActivity();
    } catch (error) {
      console.error('[Marketplace] Cancel failed:', error);
      setTxError(error instanceof Error ? error.message : 'Failed to cancel listing');
    } finally {
      setCancellingTokenId(null);
      setCancelConfirmTeam(null);
    }
  }, [refetchActivity, refetchListings, refetchMyNfts, sendTransaction, walletAddress]);

  const executeSweep = useCallback(async () => {
    if (sweepTeams.length === 0 || !walletAddress) return;

    setSweepStep('processing');
    const progress: Record<string, SweepStatus> = {};
    sweepTeams.forEach(team => { progress[team.tokenId] = 'pending'; });
    setSweepProgress({ ...progress });

    if (sweepPaymentMethod === 'card') {
      try {
        const result = await fundWallet({
          address: walletAddress,
          options: { chain: BASE_SEPOLIA, amount: String(sweepTotal), asset: 'USDC', card: { preferredProvider: 'moonpay' } },
        });
        if (result.status === 'cancelled') {
          setSweepStep('confirm');
          return;
        }
        const requiredUsdc = BigInt(Math.ceil(sweepTotal * 1e6));
        const startTime = Date.now();
        while (!cancelledRef.current && Date.now() - startTime < 300_000) {
          const balance = await getUsdcBalance(walletAddress as Address);
          if (balance >= requiredUsdc) break;
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
        if (cancelledRef.current) return;
      } catch (error) {
        console.error('[Sweep] Fund failed:', error);
        setSweepStep('confirm');
        return;
      }
    } else {
      try {
        const { checkUsdcBalance } = await import('@/lib/marketplace/buy');
        const { sufficient, balance } = await checkUsdcBalance(walletAddress, sweepTotal);
        if (!sufficient) {
          setTxError(`Insufficient balance. You have $${balance.toFixed(2)} but need $${sweepTotal.toFixed(2)}.`);
          setSweepStep('confirm');
          return;
        }
      } catch {
        setSweepStep('confirm');
        return;
      }
    }

    const { getFulfillmentTx } = await import('@/lib/marketplace/buy');
    for (const team of sweepTeams) {
      progress[team.tokenId] = 'processing';
      setSweepProgress({ ...progress });

      try {
        if (!team.orderHash || !team.protocolAddress) throw new Error('Missing order data');
        const tx = await getFulfillmentTx(team.orderHash, walletAddress, team.protocolAddress);
        const receipt = await sendTransaction(
          { to: tx.to, value: BigInt(tx.value), data: tx.data as `0x${string}`, chainId: 8453 },
          { sponsor: true, uiOptions: { description: `Purchase ${team.name} — gas fees covered by SBS` } },
        );
        const txHash = (receipt as Record<string, unknown>).transactionHash ?? (receipt as Record<string, unknown>).hash;

        if (team.ownerAddress) {
          notifySeller({ sellerWallet: team.ownerAddress, tokenId: team.tokenId, teamName: team.name, price: team.price || 0, buyerWallet: walletAddress });
        }
        logActivity({ type: 'buy', walletAddress, tokenId: team.tokenId, teamName: team.name, price: team.price, counterparty: team.ownerAddress || null, orderHash: team.orderHash || null, txHash: txHash ? String(txHash) : null });
        if (team.ownerAddress) {
          logActivity({ type: 'sell', walletAddress: team.ownerAddress, tokenId: team.tokenId, teamName: team.name, price: team.price, counterparty: walletAddress, orderHash: team.orderHash || null, txHash: txHash ? String(txHash) : null });
        }

        progress[team.tokenId] = 'done';
      } catch (error) {
        console.error(`[Sweep] Failed ${team.tokenId}:`, error);
        progress[team.tokenId] = 'failed';
      }
      setSweepProgress({ ...progress });
    }

    setSweepStep('complete');
    refetchListings();
    refetchMyNfts();
    refetchActivity();
  }, [fundWallet, refetchActivity, refetchListings, refetchMyNfts, sendTransaction, sweepPaymentMethod, sweepTeams, sweepTotal, walletAddress]);

  const handleCancel = useCallback((team: MarketplaceTeam | null) => setCancelConfirmTeam(team), []);

  return (
    <div className="w-full px-4 sm:px-8 lg:px-12 py-8">
      <Header
        activeTab={activeTab}
        watchlistCount={watchlist.length}
        onChangeTab={(tab) => {
          if (tab === 'buy') {
            setActiveTab(tab);
            return;
          }
          requireLogin(() => setActiveTab(tab));
        }}
      />

      {activeTab === 'buy' && (
        <BuyTab
          collectionStats={collectionStats}
          statsLoading={statsLoading}
          viewFilter={viewFilter}
          rosterFilter={rosterFilter}
          sortBy={sortBy}
          sweepMode={sweepMode}
          sweepSelected={sweepSelected}
          deduplicatedTeams={deduplicatedTeams}
          listingsLoading={listingsLoading}
          allNftsLoading={allNftsLoading}
          hasMore={hasMore}
          allNftsHasMore={allNftsHasMore}
          watchlistSet={watchlistSet}
          walletAddress={walletAddress}
          lastSales={lastSales}
          leaderboardTeams={leaderboardTeams}
          showBuyModal={showBuyModal}
          selectedTeam={selectedTeam}
          buyStep={buyStep}
          paymentMethod={paymentMethod}
          cardFlowStep={cardFlowStep}
          txError={txError}
          userUsdcBalance={user?.usdcBalance}
          onSetViewFilter={setViewFilter}
          onSetRosterFilter={setRosterFilter}
          onSetSortBy={setSortBy}
          onToggleSweepMode={() => requireLogin(() => setSweepMode(previous => {
            if (previous) setSweepSelected(new Set());
            return !previous;
          }))}
          onToggleSweepSelect={toggleSweepSelect}
          onClearSweep={() => setSweepSelected(new Set())}
          onOpenSweepModal={() => {
            setSweepStep('confirm');
            setShowSweepModal(true);
          }}
          onLoadMore={viewFilter === 'listed' ? loadMore : loadMoreAllNfts}
          onSearchToken={(tokenId) => router.push(`/marketplace/${tokenId}`)}
          onToggleWatchlist={(tokenId, price) => requireLogin(() => toggleWatchlist(tokenId, price))}
          onShare={handleShare}
          onOpenBuyModal={openBuyModal}
          onGoToSellTab={() => requireLogin(() => setActiveTab('sell'))}
          onNavigateToTeam={(tokenId) => router.push(`/marketplace/${tokenId}`)}
          onMakeOffer={(tokenId) => router.push(`/marketplace/${tokenId}?offer=true`)}
          onCloseBuyModal={() => setShowBuyModal(false)}
          onSetPaymentMethod={setPaymentMethod}
          onHandleBuy={handleBuy}
        />
      )}

      {activeTab === 'sell' && (
        <SellTab
          myNfts={myNfts}
          myNftsLoading={myNftsLoading}
          myNftOffers={myNftOffers}
          myNftOffersLoading={myNftOffersLoading}
          collectionStats={collectionStats}
          showSellModal={showSellModal}
          showFreePassInfo={showFreePassInfo}
          showSuccessModal={showSuccessModal}
          successType={successType}
          selectedTeam={selectedTeam}
          listPrice={listPrice}
          txError={txError}
          cancelConfirmTeam={cancelConfirmTeam}
          cancellingTokenId={cancellingTokenId}
          onOpenSellModal={openSellModal}
          onCloseSellModal={() => setShowSellModal(false)}
          onSetListPrice={setListPrice}
          onHandleList={handleList}
          onShowFreePassInfo={setShowFreePassInfo}
          onHandleCancel={handleCancel}
          onExecuteCancel={executeCancel}
          onCloseSuccessModal={() => setShowSuccessModal(false)}
        />
      )}

      {activeTab === 'activity' && (
        <ActivityTab
          myNfts={myNfts}
          myNftsLoading={myNftsLoading}
          activities={activities}
          activityLoading={activityLoading}
          activityHasMore={activityHasMore}
          cancellingTokenId={cancellingTokenId}
          onCancel={(team) => setCancelConfirmTeam(team)}
          onLoadMoreActivity={loadMoreActivity}
        />
      )}

      {activeTab === 'watchlist' && (
        <WatchlistTab
          watchlist={watchlist}
          watchlistSet={watchlistSet}
          deduplicatedTeams={deduplicatedTeams}
          onBrowseTeams={() => setActiveTab('buy')}
          onViewTeam={(tokenId) => router.push(`/marketplace/${tokenId}`)}
          onToggleWatchlist={(tokenId, price) => toggleWatchlist(tokenId, price)}
          onOpenBuyModal={openBuyModal}
          onViewAllTeams={() => {
            setViewFilter('all');
            setActiveTab('buy');
          }}
        />
      )}

      {showSuccessModal && successType === 'buy' && selectedTeam && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowSuccessModal(false)}>
          <div className="bg-bg-secondary border border-bg-tertiary rounded-2xl w-full max-w-sm p-8 text-center" onClick={event => event.stopPropagation()}>
            <div className="w-16 h-16 mx-auto mb-6 bg-success/20 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-text-primary font-semibold text-lg mb-2">Purchase Complete!</h3>
            <p className="text-text-secondary text-sm mb-6">The team has been transferred to your wallet.</p>
            <Link
              href={`/marketplace/${selectedTeam.tokenId}`}
              onClick={() => setShowSuccessModal(false)}
              className="w-full py-3 bg-banana text-black font-semibold rounded-xl hover:brightness-110 transition-all block mb-3"
            >
              View Your Team
            </Link>
            <button onClick={() => setShowSuccessModal(false)} className="w-full py-3 border border-bg-tertiary text-text-secondary rounded-xl hover:bg-bg-tertiary transition-all text-sm">
              Back to Marketplace
            </button>
          </div>
        </div>
      )}

      <SweepModal
        show={showSweepModal}
        sweepStep={sweepStep}
        sweepTeams={sweepTeams}
        sweepProgress={sweepProgress}
        sweepPaymentMethod={sweepPaymentMethod}
        sweepTotal={sweepTotal}
        txError={txError}
        onClose={() => setShowSweepModal(false)}
        onSetPaymentMethod={setSweepPaymentMethod}
        onExecuteSweep={executeSweep}
        onDone={() => {
          setShowSweepModal(false);
          setSweepMode(false);
          setSweepSelected(new Set());
        }}
      />
    </div>
  );
}

function Header({
  activeTab,
  watchlistCount,
  onChangeTab,
}: {
  activeTab: TabKey;
  watchlistCount: number;
  onChangeTab: (tab: TabKey) => void;
}) {
  return (
    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-8">
      <div>
        <h1 className="text-2xl font-bold text-text-primary mb-2">Team Marketplace</h1>
        <p className="text-text-secondary text-sm">Buy and sell BBB teams instantly. No external accounts needed.</p>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex gap-1 bg-bg-secondary p-1 rounded-xl border border-bg-tertiary">
          <TabButton active={activeTab === 'buy'} label="Buy Teams" onClick={() => onChangeTab('buy')} />
          <TabButton active={activeTab === 'sell'} label="Sell My Teams" onClick={() => onChangeTab('sell')} />
          <TabButton active={activeTab === 'activity'} label="Activity" onClick={() => onChangeTab('activity')} />
          <button
            onClick={() => onChangeTab('watchlist')}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${activeTab === 'watchlist' ? 'bg-banana text-black' : 'text-text-secondary hover:text-text-primary'}`}
          >
            <svg className="w-3.5 h-3.5" fill={activeTab === 'watchlist' ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
            </svg>
            Watchlist
            {watchlistCount > 0 && (
              <span className="text-[10px] bg-error/20 text-error px-1.5 py-0.5 rounded-full font-bold leading-none">{watchlistCount}</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${active ? 'bg-banana text-black' : 'text-text-secondary hover:text-text-primary'}`}
    >
      {label}
    </button>
  );
}
