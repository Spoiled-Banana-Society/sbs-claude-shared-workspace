'use client';

// TEMP PREVIEW ROUTE — delete before deploy. Renders ContestCard with mock data.
import { ContestCard } from '@/components/home/ContestCard';
import { Contest } from '@/types';

const mockContest: Contest = {
  id: 'preview',
  name: 'Big Banana Brawl IV',
  type: 'pro' as Contest['type'],
  prizePool: 250000,
  topPrize: 25000,
  entryFee: 25,
  jpPercent: 1,
  hofPercent: 5,
  jpHits: 0,
  hofHits: 0,
  maxEntries: 10000,
  currentEntries: 4200,
  startDate: '',
  endDate: '',
  status: 'active',
  rosterFormat: [],
  scoringRules: [],
  prizeBreakdown: [],
};

export default function PreviewContestCard() {
  return (
    <div className="min-h-screen bg-bg-primary px-4 py-10">
      <div className="w-full max-w-3xl mx-auto">
        <ContestCard
          contest={mockContest}
          draftCount={3}
          onEnter={() => {}}
          onDetails={() => {}}
        />
      </div>

      {/* Button-treatment comparison */}
      <div className="max-w-3xl mx-auto mt-16">
        <p className="text-white/40 text-xs uppercase tracking-widest mb-6 text-center">
          Rim options — hover each
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 place-items-center">
          <div className="flex flex-col items-center gap-3">
            <button className="btn-3d btn-obsidian rim-chromatic w-[200px] py-4 text-xl font-bold tracking-wide">
              <span>Enter</span>
            </button>
            <span className="text-white/40 text-xs">A · rainbow rim</span>
          </div>
          <div className="flex flex-col items-center gap-3">
            <button className="btn-3d btn-obsidian rim-banana w-[200px] py-4 text-xl font-bold tracking-wide">
              <span>Enter</span>
            </button>
            <span className="text-white/40 text-xs">B · gold rim</span>
          </div>
          <div className="flex flex-col items-center gap-3">
            <button className="btn-3d btn-obsidian w-[200px] py-4 text-xl font-bold tracking-wide">
              <span>Enter</span>
            </button>
            <span className="text-white/40 text-xs">C · no rim</span>
          </div>
        </div>
      </div>
    </div>
  );
}
