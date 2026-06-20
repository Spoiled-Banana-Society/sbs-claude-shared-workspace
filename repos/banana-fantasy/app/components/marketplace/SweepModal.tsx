'use client';

import Image from 'next/image';
import type { MarketplaceTeam } from '@/lib/opensea';
import { useAuth } from '@/hooks/useAuth';
import { PaymentMethodSquares } from '@/components/marketplace/PaymentMethodSquares';

type SweepStep = 'confirm' | 'processing' | 'complete';
type SweepStatus = 'pending' | 'processing' | 'done' | 'failed';
type SweepPaymentMethod = 'card' | 'usdc';

interface SweepModalProps {
  show: boolean;
  sweepStep: SweepStep;
  sweepTeams: MarketplaceTeam[];
  sweepProgress: Record<string, SweepStatus>;
  sweepPaymentMethod: SweepPaymentMethod;
  sweepTotal: number;
  txError: string | null;
  onClose: () => void;
  onSetPaymentMethod: (method: SweepPaymentMethod) => void;
  onExecuteSweep: () => void;
  onDone: () => void;
}

export function SweepModal({
  show,
  sweepStep,
  sweepTeams,
  sweepProgress,
  sweepPaymentMethod,
  sweepTotal,
  txError,
  onClose,
  onSetPaymentMethod,
  onExecuteSweep,
  onDone,
}: SweepModalProps) {
  const { isEmbeddedWallet, user } = useAuth();
  if (!show) return null;

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={() => sweepStep === 'confirm' && onClose()}
    >
      <div
        className="bg-bg-secondary border border-bg-tertiary rounded-2xl w-full max-w-md max-h-[80vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {sweepStep === 'confirm' && (
          <>
            <div className="flex items-center justify-between p-6 border-b border-bg-tertiary sticky top-0 bg-bg-secondary z-10">
              <h2 className="text-lg font-semibold text-text-primary">Sweep Buy</h2>
              <button
                onClick={onClose}
                className="w-8 h-8 flex items-center justify-center rounded-lg bg-bg-primary text-text-secondary hover:text-text-primary transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6">
              <div className="space-y-3 mb-6">
                {sweepTeams.map(team => (
                  <div key={team.tokenId} className="flex items-center justify-between p-3 bg-bg-primary rounded-xl border border-bg-tertiary">
                    <div className="flex items-center gap-3">
                      {team.imageUrl ? (
                        <Image src={team.imageUrl} alt={team.name} width={40} height={40} className="rounded-lg" />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-bg-tertiary flex items-center justify-center">
                          <span className="text-sm">🍌</span>
                        </div>
                      )}
                      <span className="text-text-primary font-mono text-sm">{team.name}</span>
                    </div>
                    <span className="text-text-primary font-mono text-sm font-semibold">${(team.price || 0).toFixed(2)}</span>
                  </div>
                ))}
              </div>

              <div className="mb-4">
                <label className="block text-text-secondary text-sm mb-3">Payment Method</label>
                <PaymentMethodSquares
                  value={sweepPaymentMethod}
                  onChange={onSetPaymentMethod}
                  isEmbeddedWallet={isEmbeddedWallet}
                  usdcBalance={user?.usdcBalance}
                  requiredAmount={sweepTotal}
                />
              </div>

              <div className="p-4 bg-bg-primary rounded-xl space-y-2 mb-4">
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary">{sweepTeams.length} teams</span>
                  <span className="text-text-primary font-mono">${sweepTotal.toFixed(2)}</span>
                </div>
                {sweepPaymentMethod === 'card' && (
                  <div className="flex justify-between text-sm">
                    <span className="text-text-secondary">Processing Fee (3%)</span>
                    <span className="text-text-primary font-mono">${(sweepTotal * 0.03).toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm pt-2 border-t border-bg-tertiary font-semibold">
                  <span className="text-text-primary">Total</span>
                  <span className="text-text-primary font-mono">
                    ${sweepPaymentMethod === 'card' ? (sweepTotal * 1.03).toFixed(2) : sweepTotal.toFixed(2)}
                  </span>
                </div>
              </div>

              {txError && (
                <div className="p-3 bg-error/10 border border-error/30 rounded-xl mb-4">
                  <p className="text-error text-sm">{txError}</p>
                </div>
              )}

              <button
                onClick={onExecuteSweep}
                className="w-full py-4 bg-banana text-black font-semibold rounded-xl hover:brightness-110 transition-all"
              >
                Pay ${sweepPaymentMethod === 'card' ? (sweepTotal * 1.03).toFixed(2) : sweepTotal.toFixed(2)}
              </button>
            </div>
          </>
        )}

        {sweepStep === 'processing' && (
          <div className="p-6">
            <h3 className="text-text-primary font-semibold text-lg mb-6 text-center">Purchasing Teams</h3>
            <div className="space-y-3">
              {sweepTeams.map(team => {
                const status = sweepProgress[team.tokenId] || 'pending';
                return (
                  <div key={team.tokenId} className="flex items-center justify-between p-3 bg-bg-primary rounded-xl border border-bg-tertiary">
                    <div className="flex items-center gap-3">
                      {status === 'done' ? (
                        <div className="w-6 h-6 rounded-full bg-success/20 flex items-center justify-center">
                          <svg className="w-3.5 h-3.5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      ) : status === 'failed' ? (
                        <div className="w-6 h-6 rounded-full bg-error/20 flex items-center justify-center">
                          <svg className="w-3.5 h-3.5 text-error" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path d="M18 6L6 18M6 6l12 12" />
                          </svg>
                        </div>
                      ) : status === 'processing' ? (
                        <div className="w-6 h-6 rounded-full border-2 border-banana/30 border-t-banana animate-spin" />
                      ) : (
                        <div className="w-6 h-6 rounded-full border border-bg-tertiary" />
                      )}
                      <span className="text-text-primary font-mono text-sm">{team.name}</span>
                    </div>
                    <span className="text-text-primary font-mono text-sm">${(team.price || 0).toFixed(2)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {sweepStep === 'complete' && (
          <div className="p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-6 bg-success/20 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-text-primary font-semibold text-lg mb-2">Sweep Complete!</h3>
            <p className="text-text-secondary text-sm mb-6">
              {Object.values(sweepProgress).filter(status => status === 'done').length} of {sweepTeams.length} teams purchased
              {Object.values(sweepProgress).some(status => status === 'failed') && (
                <span className="text-error"> ({Object.values(sweepProgress).filter(status => status === 'failed').length} failed)</span>
              )}
            </p>
            <button
              onClick={onDone}
              className="px-8 py-3 bg-banana text-black font-semibold rounded-xl hover:brightness-110 transition-all"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
