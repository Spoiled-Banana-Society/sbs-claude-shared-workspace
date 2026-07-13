'use client';

import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/hooks/useAuth';
import { useEligibility } from '@/hooks/usePrizes';

export default function VerifyPage() {
  const { isLoggedIn, setShowLoginModal, user } = useAuth();
  const { data: eligibility } = useEligibility(user?.id ? { userId: user.id } : undefined);
  const router = useRouter();

  if (!isLoggedIn) {
    return (
      <div className="w-full px-4 sm:px-8 lg:px-12 py-8">
        <div className="text-center py-12">
          <div className="text-6xl mb-4">🔒</div>
          <h1 className="text-3xl font-bold text-text-primary mb-4">Verification</h1>
          <p className="text-text-secondary mb-6">Log in to view your verification status</p>
          <button onClick={() => setShowLoginModal(true)} className="btn-primary">Log In</button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full px-4 sm:px-8 lg:px-12 py-8 max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold text-text-primary mb-2">Verification</h1>
      <p className="text-text-secondary mb-8">Identity verification is required when you withdraw winnings.</p>

      <Card className="mb-6">
        <h3 className="font-semibold text-text-primary mb-4">Verification Status</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between py-3 border-b border-bg-tertiary">
            <div>
              <p className="text-sm font-medium text-text-primary">Age + Location</p>
              <p className="text-xs text-text-muted">Required for first withdrawal</p>
            </div>
            {eligibility?.tier1Verified ? (
              <span className="px-3 py-1 rounded-full text-xs font-medium bg-success/20 text-success">Verified</span>
            ) : (
              <span className="px-3 py-1 rounded-full text-xs font-medium bg-bg-elevated text-text-muted">At Withdrawal</span>
            )}
          </div>
          <div className="flex items-center justify-between py-3">
            <div>
              <p className="text-sm font-medium text-text-primary">Full Identity (KYC)</p>
              <p className="text-xs text-text-muted">Required when cumulative withdrawals reach $2,000</p>
            </div>
            {eligibility?.tier2Verified ? (
              <span className="px-3 py-1 rounded-full text-xs font-medium bg-success/20 text-success">Verified</span>
            ) : (
              <span className="px-3 py-1 rounded-full text-xs font-medium bg-bg-elevated text-text-muted">When Needed</span>
            )}
          </div>
        </div>
      </Card>

      <Card className="bg-bg-tertiary/30">
        <div className="text-center space-y-3">
          <p className="text-text-secondary text-sm">
            Verification happens automatically when you withdraw. No action needed until then.
          </p>
          <Button onClick={() => router.push('/winnings')}>Go to Prizes</Button>
        </div>
      </Card>
    </div>
  );
}
