'use client';

import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Contest } from '@/types';
import { ContestInfoTabs } from './ContestInfoTabs';

interface ContestDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  contest: Contest | null;
  onEnter: () => void;
}

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);

export function ContestDetailsModal({
  isOpen,
  onClose,
  contest,
  onEnter,
}: ContestDetailsModalProps) {
  if (!contest) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Contest Details" size="lg">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-xl font-bold text-text-primary">{contest.name}</h3>
              {contest.type === 'jackpot' && <Badge type="jackpot">Jackpot</Badge>}
              {contest.type === 'hof' && <Badge type="hof">HOF</Badge>}
            </div>
            <p className="text-text-secondary">
              {contest.currentEntries.toLocaleString()} entries
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm text-text-muted">Entry Fee</p>
            <p className="text-2xl font-bold text-banana">{formatCurrency(contest.entryFee)}</p>
          </div>
        </div>

        {/* Shared tabbed info — How it Works / Contest / FAQ */}
        <ContestInfoTabs contest={contest} />

        {/* Actions */}
        <div className="flex gap-3 pt-4 border-t border-bg-tertiary">
          <Button onClick={onEnter} className="flex-1">
            Enter Draft
          </Button>
        </div>
      </div>
    </Modal>
  );
}
