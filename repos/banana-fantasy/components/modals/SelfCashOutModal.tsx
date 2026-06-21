'use client';

import { useEffect, useRef, useState } from 'react';
import { usePrivy, useSendTransaction } from '@privy-io/react-auth';
import { encodeFunctionData, parseUnits, type Address } from 'viem';
import { Modal } from '../ui/Modal';
import { VerificationModal } from './VerificationModal';
import { useSendUsdcOnBase } from '@/hooks/useSendUsdcOnBase';

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address;
const BASE_CHAIN_ID = 8453;
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

const ERC20_TRANSFER_ABI = [
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

type Step = 'checking' | 'verify' | 'blocked' | 'form' | 'sending' | 'done' | 'error';

interface SelfCashOutModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The user's withdrawable USDC (their on-chain Base balance). */
  balanceUsdc: number;
  walletAddress?: string | null;
  /** Web2 (embedded) → gas-sponsored send. Web3 → wallet signs (we top up gas). */
  isEmbeddedWallet: boolean;
  /** Called after KYC completes so the parent can refetch eligibility. */
  onVerified?: () => void;
  /** Copy-review preview: skip the KYC/jurisdiction preflight and render the
   *  tutorial form directly. No real withdrawal is possible. */
  previewMode?: boolean;
}

/**
 * Self-custody cash-out. Instead of a hosted fiat off-ramp, the user sends their
 * own USDC (on Base) to their own Coinbase/exchange address, then sells it to
 * USD and withdraws to their bank ON COINBASE. We just (a) gate on KYC, (b)
 * send the USDC from their wallet (sponsored gas for web2, gas top-up for web3),
 * and (c) walk them through every step — including AFTER the USDC arrives.
 *
 * The on-chain send is irreversible and a wrong address / wrong network loses
 * the funds, so the form forces an explicit "Base network" confirmation.
 */
export function SelfCashOutModal({
  isOpen,
  onClose,
  balanceUsdc,
  walletAddress,
  isEmbeddedWallet,
  onVerified,
  previewMode = false,
}: SelfCashOutModalProps) {
  const { getAccessToken } = usePrivy();
  const { sendTransaction } = useSendTransaction();
  const sendTxRef = useRef(sendTransaction);
  sendTxRef.current = sendTransaction;
  const { send: sendExternal } = useSendUsdcOnBase();

  const [step, setStep] = useState<Step>('checking');
  const [address, setAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [blockMsg, setBlockMsg] = useState<string | null>(null);
  const [showVerify, setShowVerify] = useState(false);

  // Run the KYC/jurisdiction preflight whenever the modal opens.
  useEffect(() => {
    if (!isOpen) return;
    setTxHash(null);
    setErrorMsg(null);
    setConfirmed(false);
    setAmount(balanceUsdc > 0 ? String(Math.floor(balanceUsdc * 100) / 100) : '');
    // Copy-review preview: skip the preflight network call and show the form.
    if (previewMode) { setStep('form'); return; }
    setStep('checking');
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch('/api/withdraw/preflight', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        });
        if (cancelled) return;
        if (res.ok) { setStep('form'); return; }
        const data = await res.json().catch(() => null);
        if (data?.requiresVerification) { setStep('verify'); setShowVerify(true); return; }
        if (data?.blocked) { setBlockMsg(data.error || 'Withdrawal not permitted in your location.'); setStep('blocked'); return; }
        setErrorMsg(data?.error || 'Could not start withdrawal'); setStep('error');
      } catch (err) {
        if (!cancelled) { setErrorMsg(err instanceof Error ? err.message : 'Could not start withdrawal'); setStep('error'); }
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, balanceUsdc, getAccessToken, previewMode]);

  const amountNum = Number(amount);
  const amountValid = Number.isFinite(amountNum) && amountNum > 0 && amountNum <= balanceUsdc + 1e-9;
  const addressValid = ADDRESS_RE.test(address.trim());
  const sending = step === 'sending';
  const canSend = addressValid && confirmed && amountValid;

  const handleSend = async () => {
    if (!canSend) return;
    setStep('sending');
    setErrorMsg(null);
    const to = address.trim() as Address;
    const value = parseUnits(amountNum.toFixed(6), 6);
    try {
      let hash: string | undefined;
      if (isEmbeddedWallet) {
        // Web2: gas-sponsored ERC20.transfer (Privy pays the gas).
        const data = encodeFunctionData({ abi: ERC20_TRANSFER_ABI, functionName: 'transfer', args: [to, value] });
        const res = (await sendTxRef.current(
          { to: USDC_BASE, data, chainId: BASE_CHAIN_ID },
          { sponsor: true, uiOptions: { showWalletUIs: false } },
        )) as { hash?: string; transactionHash?: string };
        hash = res?.hash ?? res?.transactionHash;
      } else {
        // Web3: cover the gas first, then the wallet signs the transfer.
        try {
          const token = await getAccessToken();
          await fetch('/api/marketplace/gas-topup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: JSON.stringify({ action: 'withdraw' }),
          });
        } catch { /* top-up best-effort; wallet may already have gas */ }
        const result = await sendExternal(to, amountNum);
        hash = result.txHash;
      }
      setTxHash(hash ?? null);
      setStep('done');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Send failed';
      setErrorMsg(/user (rejected|denied)|cancelled/i.test(msg) ? 'Send cancelled' : msg);
      setStep('error');
    }
  };

  const close = () => { setShowVerify(false); onClose(); };

  // ---- KYC ----
  if (showVerify && (walletAddress)) {
    return (
      <VerificationModal
        isOpen={isOpen}
        onClose={close}
        userId={walletAddress}
        onComplete={() => { setShowVerify(false); onVerified?.(); setStep('form'); }}
      />
    );
  }

  return (
    <Modal isOpen={isOpen} onClose={close} title="Cash out" size="md">
      {step === 'checking' && (
        <div className="py-10 text-center text-text-muted text-sm">Checking your account…</div>
      )}

      {step === 'blocked' && (
        <div className="py-8 text-center space-y-2">
          <p className="text-warning font-semibold">Withdrawal not available</p>
          <p className="text-text-muted text-sm">{blockMsg}</p>
        </div>
      )}

      {step === 'error' && (
        <div className="py-8 text-center space-y-4">
          <p className="text-error font-semibold">Something went wrong</p>
          <p className="text-text-muted text-sm break-words">{errorMsg}</p>
          <button onClick={() => setStep('form')} className="px-5 py-2.5 rounded-xl bg-bg-tertiary text-text-primary text-sm font-semibold hover:bg-bg-elevated transition-colors">Try again</button>
        </div>
      )}

      {(step === 'form' || step === 'sending') && (
        <div className="space-y-5">
          <div>
            <p className="text-text-muted text-sm">You&apos;re cashing out</p>
            <p className="text-3xl font-bold text-banana">${balanceUsdc.toFixed(2)}</p>
          </div>

          {/* Step-by-step — works even for someone who's never touched crypto. */}
          <div className="rounded-xl bg-bg-tertiary/50 border border-bg-tertiary p-4 space-y-3">
            <p className="text-text-primary font-semibold text-sm">How to cash out to your bank</p>
            <ol className="space-y-2.5 text-text-secondary text-xs leading-relaxed list-none">
              <li><span className="text-banana font-bold">1.</span> Create a free account at <a href="https://www.coinbase.com/signup" target="_blank" rel="noopener noreferrer" className="text-banana underline">coinbase.com</a> (or the Coinbase app) and verify your ID.</li>
              <li><span className="text-banana font-bold">2.</span> In Coinbase, search for <strong>USDC</strong> and open it, then choose <strong>Receive crypto</strong> and pick the <strong className="text-banana">Base</strong> network. <span className="text-text-muted">(On the app: tap <strong>Transfer → Receive crypto</strong>. On desktop: it&apos;s in the right-hand panel.)</span> ⚠️ The network MUST be Base — picking the wrong one loses your funds.</li>
              <li><span className="text-banana font-bold">3.</span> Copy the address Coinbase shows you and paste it below.</li>
              <li><span className="text-banana font-bold">4.</span> Hit send — your USDC lands in your Coinbase account in seconds (we cover the network fee).</li>
              <li><span className="text-banana font-bold">5.</span> In Coinbase, tap <strong>Cash out → Withdraw</strong> — to your bank (1–3 days) or use an instant option (e.g. debit card).</li>
            </ol>
          </div>

          <div className="space-y-2">
            <label className="text-text-primary text-sm font-semibold">Your USDC address (Base network)</label>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Paste your Coinbase USDC (Base) address — 0x…"
              className="w-full rounded-xl bg-bg-primary border border-bg-tertiary focus:border-banana px-3.5 py-2.5 text-sm font-mono text-text-primary placeholder:text-text-muted outline-none"
            />
            {address.trim() && !addressValid && (
              <p className="text-error text-xs">That doesn&apos;t look like a valid wallet address (it should start with 0x and be 42 characters).</p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-text-primary text-sm font-semibold">Amount (USDC)</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="flex-1 rounded-xl bg-bg-primary border border-bg-tertiary focus:border-banana px-3.5 py-2.5 text-sm font-mono text-text-primary outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <button onClick={() => setAmount(String(Math.floor(balanceUsdc * 100) / 100))} className="px-3 py-2.5 rounded-xl bg-bg-tertiary text-text-secondary text-xs font-semibold hover:text-text-primary transition-colors">Max</button>
            </div>
            {amount && !amountValid && <p className="text-error text-xs">Enter an amount between $0 and your ${balanceUsdc.toFixed(2)} balance.</p>}
          </div>

          <label className="flex items-start gap-2.5 cursor-pointer">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 accent-banana w-4 h-4" />
            <span className="text-text-secondary text-xs leading-relaxed">I confirm this is my own <strong>USDC</strong> address on the <strong className="text-banana">Base</strong> network. I understand sends are irreversible.</span>
          </label>

          <button
            onClick={handleSend}
            disabled={!canSend || sending}
            className={`w-full py-4 rounded-xl font-bold text-base transition-all ${canSend && !sending ? 'bg-banana text-black hover:brightness-110' : 'bg-bg-tertiary text-text-muted cursor-not-allowed'}`}
          >
            {sending ? 'Sending…' : `Send $${amountValid ? amountNum.toFixed(2) : balanceUsdc.toFixed(2)} USDC`}
          </button>
        </div>
      )}

      {step === 'done' && (
        <div className="space-y-5 py-2">
          <div className="text-center space-y-2">
            <div className="w-14 h-14 mx-auto rounded-full bg-success/20 flex items-center justify-center text-2xl">✅</div>
            <h3 className="text-lg font-bold text-text-primary">USDC sent!</h3>
            <p className="text-text-secondary text-sm">It should land in your Coinbase account within a minute or two.</p>
            {txHash && (
              <a href={`https://basescan.org/tx/${txHash}`} target="_blank" rel="noopener noreferrer" className="text-banana text-xs underline">View transaction</a>
            )}
          </div>
          <div className="rounded-xl bg-bg-tertiary/50 border border-bg-tertiary p-4 space-y-2">
            <p className="text-text-primary font-semibold text-sm">Last steps — in Coinbase</p>
            <ol className="space-y-2 text-text-secondary text-xs leading-relaxed">
              <li><span className="text-banana font-bold">1.</span> Once the USDC shows up, tap <strong>Sell</strong> and convert it to USD.</li>
              <li><span className="text-banana font-bold">2.</span> Tap <strong>Cash out</strong> — pick your bank (1–3 business days, free) or an <strong>instant</strong> debit-card payout (small fee). First time, you&apos;ll link your payout method.</li>
            </ol>
          </div>
          <button onClick={close} className="w-full py-3 rounded-xl bg-bg-tertiary text-text-primary font-semibold text-sm hover:bg-bg-elevated transition-colors">Done</button>
        </div>
      )}
    </Modal>
  );
}
