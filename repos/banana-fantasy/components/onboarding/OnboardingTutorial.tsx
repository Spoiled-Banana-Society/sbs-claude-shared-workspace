'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Image from 'next/image';
import { usePrivy } from '@privy-io/react-auth';
import { useAuth } from '@/hooks/useAuth';
import { useOnboarding } from '@/hooks/useOnboarding';
import { useBadges } from '@/hooks/useBadges';
import { usernameErrorText } from '@/lib/usernameMessages';
import { BADGE_CATALOG } from '@/lib/badges/catalog';
import { BadgeIcon } from '@/components/badges/BadgeIcon';

interface OnboardingTutorialProps {
  onComplete?: () => void;
}

// Sections are full-screen immersive moments with blackness transitions
const sections = [
  { id: 'intro', type: 'intro' },
  { id: 'contest', type: 'section' },
  { id: 'best-ball', type: 'section' },
  { id: 'team-positions', type: 'section' },
  { id: 'injury-protection', type: 'section' },
  { id: 'draft-reveal', type: 'section' },
  { id: 'banana-wheel', type: 'section' },
  { id: 'marketplace', type: 'section' },
  { id: 'profile', type: 'profile' },
  { id: 'ready', type: 'ready' },
];

export function OnboardingTutorial({ onComplete }: OnboardingTutorialProps) {
  const { user, updateUser } = useAuth();
  const privy = usePrivy();
  const {
    completeOnboarding,
    setCurrentStep,
  } = useOnboarding();
  const [savingProfile, setSavingProfile] = useState(false);
  const [sectionIndex, setSectionIndex] = useState(-1); // -1 = initial black
  const [isVisible, setIsVisible] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // NFL team badge picker on the final "You're ready" slide. The team
  // flair badges are alwaysUnlocked cosmetics, so equipping one needs no
  // unlock check — equipBadge POSTs to /api/badges/equip and optimistically
  // updates the user, so the choice persists even if they hit "Let's Go"
  // immediately after. Options come from the static catalog (instant, no
  // wait on the /api/badges fetch); `equipped`/`equipBadge` drive state.
  const { equipped, equipBadge } = useBadges();
  const teamBadges = useMemo(
    () => BADGE_CATALOG.filter(b => b.category === 'team'),
    [],
  );
  const [equippingTeam, setEquippingTeam] = useState(false);

  const handlePickTeam = useCallback(async (badgeId: string) => {
    if (equippingTeam) return;
    // Click the equipped team again to clear it (toggle off).
    const next = equipped === badgeId ? null : badgeId;
    setEquippingTeam(true);
    try {
      await equipBadge(next);
    } finally {
      setEquippingTeam(false);
    }
  }, [equipped, equipBadge, equippingTeam]);

  const currentSection = sections[sectionIndex];

  const advanceSection = useCallback(() => {
    if (isTransitioning) return;

    if (sectionIndex < sections.length - 1) {
      // Fade to black, then advance
      setIsTransitioning(true);
      setIsVisible(false);
      setTimeout(() => {
        setSectionIndex(prev => prev + 1);
        setTimeout(() => {
          setIsVisible(true);
          setIsTransitioning(false);
        }, 150);
      }, 200);
    } else {
      completeOnboarding({ displayName, avatar: avatarPreview });
      onComplete?.();
    }
  }, [sectionIndex, onComplete, isTransitioning, completeOnboarding, displayName, avatarPreview]);

  const goBack = useCallback(() => {
    if (isTransitioning || sectionIndex <= 0) return;

    setIsTransitioning(true);
    setIsVisible(false);
    setTimeout(() => {
      setSectionIndex(prev => prev - 1);
      setTimeout(() => {
        setIsVisible(true);
        setIsTransitioning(false);
      }, 150);
    }, 200);
  }, [sectionIndex, isTransitioning]);

  // Start the sequence
  useEffect(() => {
    const timer = setTimeout(() => {
      setSectionIndex(0);
      setTimeout(() => setIsVisible(true), 100);
    }, 200);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!currentSection) return;
    setCurrentStep(currentSection.id === 'profile' ? 'profile' : 'tutorial');
  }, [currentSection, setCurrentStep]);

  // Seed Display Name / Avatar from the user ONCE, when the user first loads.
  // Re-seeding on every `user` change would wipe what the person typed/uploaded
  // the moment anything else updates the user object (e.g. picking a team badge
  // calls equipBadge, which optimistically updates `user`).
  const seededProfileRef = useRef(false);
  useEffect(() => {
    if (seededProfileRef.current) return;
    if (user?.username || user?.profilePicture) {
      if (user?.username) setDisplayName(user.username);
      if (user?.profilePicture) setAvatarPreview(user.profilePicture);
      seededProfileRef.current = true;
    }
  }, [user]);

  // Claim a unique display name before saving it. Returns true if the name is
  // free to use (unchanged from the user's current name, or successfully
  // reserved); false if it's taken/invalid, in which case nameError is set.
  // Mirrors EditProfileModal's hard gate — POST /api/username, 409 = taken.
  const reserveUsername = async (name: string): Promise<boolean> => {
    const changed = name.toLowerCase() !== (user?.username ?? '').toLowerCase();
    if (!changed) return true;
    // A brand-new web2 wallet takes a few seconds to resolve server-side (Privy
    // propagation). During that window POST /api/username 400s with
    // 'wallet required', which used to surface as a misleading "Username
    // unavailable." on a perfectly free name. Retry a few times so the claim
    // lands once the wallet propagates, instead of failing on the first beat.
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        let token: string | null = null;
        try { token = await privy.getAccessToken(); } catch { /* token not ready yet */ }
        const res = await fetch('/api/username', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ name, wallet: user?.walletAddress }),
        });
        if (res.ok) { setNameError(null); return true; }
        const data = (await res.json().catch(() => ({}))) as { reason?: string; error?: string };
        const notReady = res.status === 400 && /wallet required/i.test(data.error || '');
        if (notReady && attempt < 5) {
          setNameError('Finalizing your account…');
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        setNameError(notReady
          ? 'Still finalizing your account — try that name again in a moment.'
          : usernameErrorText(data.reason || data.error));
        return false;
      } catch {
        if (attempt < 5) { await new Promise((r) => setTimeout(r, 1500)); continue; }
        setNameError('Could not check username — try again.');
        return false;
      }
    }
    return false;
  };

  // Persist the typed name/avatar through useAuth.updateUser — the SAME path
  // the live EditProfileModal uses. updateUser (a) refreshes the in-memory user
  // so the home page reflects the change with no manual refresh, (b) writes
  // localStorage, and (c) syncs to the Go API's working endpoints
  // (POST /owner/{id}/update/displayName + /update/pfpImage).
  //
  // Do NOT route this through useOnboarding.createProfile/updateProfile: those
  // hit POST/PUT /api/owners → /owner/create and PUT /owner/{id}, routes the Go
  // API does not implement. The PUT failed with a raw "Owner update failed"
  // JSON shown to the user. Returns true on success, false if the name is taken.
  const persistProfile = async (trimmed: string): Promise<boolean> => {
    if (!(await reserveUsername(trimmed))) return false; // nameError set
    updateUser({ username: trimmed, profilePicture: avatarPreview || undefined });
    return true;
  };

  const handleProfileSubmit = async () => {
    const trimmed = displayName.trim();
    if (!trimmed) {
      setNameError('Display name is required.');
      return;
    }
    setNameError(null);
    setSavingProfile(true);
    try {
      if (!(await persistProfile(trimmed))) return;
      advanceSection();
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSkip = async () => {
    if (savingProfile) return;
    const trimmed = displayName.trim();
    setSavingProfile(true);
    try {
      // Persist any name/avatar the user entered before skipping, so the edit
      // isn't silently lost. Skipped only if the chosen name is taken;
      // reserveUsername no-ops when the name is unchanged from their current one.
      if (trimmed) await persistProfile(trimmed);
    } finally {
      setSavingProfile(false);
    }
    await completeOnboarding({ displayName, avatar: avatarPreview });
    onComplete?.();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setAvatarPreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const renderSection = () => {
    if (!currentSection) return null;

    // Content sections
    if (currentSection.type === 'section') {
      return (
        <div className="text-center max-w-2xl mx-auto px-6">
          {currentSection.id === 'contest' && (
            <div className="space-y-6">
              <h2 className="text-3xl md:text-4xl font-bold text-banana mb-2">Banana Best Ball IV</h2>
              <p className="text-xl text-white/90 leading-relaxed">
                The only fantasy football <span className="text-banana font-semibold">best ball contest with tradeable teams</span>.
              </p>

              {/* Prize Info */}
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6 my-6">
                <div className="space-y-4">
                  <div className="flex justify-between items-center py-3 border-b border-white/10">
                    <span className="text-white/60">Guaranteed Prize Pool</span>
                    <span className="text-banana font-bold text-2xl">$100,000</span>
                  </div>
                  <div className="flex justify-between items-center py-3 border-b border-white/10">
                    <span className="text-white/60">Entry</span>
                    <span className="text-white font-semibold text-xl">$25</span>
                  </div>
                  <div className="flex justify-between items-center py-3">
                    <span className="text-white/60">First Place</span>
                    <span className="text-green-400 font-bold text-2xl">$25,000</span>
                  </div>
                </div>
              </div>

              <p className="text-white/50 text-base">
                Prize pool is guaranteed and may increase based on total entries.
              </p>
            </div>
          )}

          {currentSection.id === 'best-ball' && (
            <div className="space-y-6">
              <h2 className="text-3xl md:text-4xl font-bold text-banana mb-2">What is Best Ball?</h2>
              <p className="text-xl text-white/90 leading-relaxed">
                Best Ball is a <span className="text-banana font-semibold">draft-and-done</span> fantasy format. No weekly lineups to set.
              </p>

              {/* How it works */}
              <div className="bg-white/5 border border-white/10 rounded-2xl p-5 my-6">
                <div className="space-y-4">
                  {/* Step 1 */}
                  <div className="flex items-start gap-4">
                    <div className="w-8 h-8 rounded-full bg-banana/20 border border-banana/40 flex items-center justify-center flex-shrink-0">
                      <span className="text-banana font-bold text-sm">1</span>
                    </div>
                    <div className="text-left">
                      <p className="text-white font-medium">10 players join → Draft starts instantly</p>
                      <p className="text-white/50 text-sm">No scheduled times. Ready when you are.</p>
                    </div>
                  </div>

                  {/* Step 2 */}
                  <div className="flex items-start gap-4">
                    <div className="w-8 h-8 rounded-full bg-banana/20 border border-banana/40 flex items-center justify-center flex-shrink-0">
                      <span className="text-banana font-bold text-sm">2</span>
                    </div>
                    <div className="text-left">
                      <p className="text-white font-medium">Draft your team, then you&apos;re done</p>
                      <p className="text-white/50 text-sm">No trades. No waivers. No stress.</p>
                    </div>
                  </div>

                  {/* Step 3 */}
                  <div className="flex items-start gap-4">
                    <div className="w-8 h-8 rounded-full bg-banana/20 border border-banana/40 flex items-center justify-center flex-shrink-0">
                      <span className="text-banana font-bold text-sm">3</span>
                    </div>
                    <div className="text-left">
                      <p className="text-white font-medium">System picks your best scorers each week</p>
                      <p className="text-white/50 text-sm">Your optimal lineup is set automatically.</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Visual */}
              <div className="flex items-center justify-center gap-3">
                <div className="text-center">
                  <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center mb-1">
                    <span className="text-xl">👥</span>
                  </div>
                  <span className="text-white/40 text-[10px]">10/10</span>
                </div>
                <span className="text-banana">→</span>
                <div className="text-center">
                  <div className="w-12 h-12 rounded-xl bg-banana/20 border border-banana/40 flex items-center justify-center mb-1">
                    <span className="text-xl">📋</span>
                  </div>
                  <span className="text-white/40 text-[10px]">Draft</span>
                </div>
                <span className="text-banana">→</span>
                <div className="text-center">
                  <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center mb-1">
                    <span className="text-xl">🏈</span>
                  </div>
                  <span className="text-white/40 text-[10px]">Season</span>
                </div>
                <span className="text-banana">→</span>
                <div className="text-center">
                  <div className="w-12 h-12 rounded-xl bg-green-500/20 border border-green-500/40 flex items-center justify-center mb-1">
                    <span className="text-xl">💰</span>
                  </div>
                  <span className="text-white/40 text-[10px]">Win</span>
                </div>
              </div>

              <p className="text-white/50 text-base">
                Draft as many teams as you want without having to manage any of them.
              </p>
            </div>
          )}

          {currentSection.id === 'team-positions' && (
            <div className="space-y-6">
              <h2 className="text-3xl md:text-4xl font-bold text-banana mb-2">Team Positions</h2>
              <p className="text-xl text-white/90 leading-relaxed">
                Forget drafting individual players. Here, you draft <span className="text-banana font-semibold">team positions</span>.
              </p>

              {/* Mini Draft Board Preview */}
              <div className="bg-white/5 border border-white/10 rounded-2xl p-4 my-6">
                <div className="text-xs text-white/40 mb-3 text-left">YOUR DRAFT PICKS</div>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { pos: 'DAL WR1', highlight: true },
                    { pos: 'KC QB', highlight: false },
                    { pos: 'SF RB1', highlight: false },
                    { pos: 'MIA WR1', highlight: false },
                  ].map((slot, i) => (
                    <div
                      key={i}
                      className={`rounded-xl p-3 text-center transition-all ${
                        slot.highlight
                          ? 'bg-banana/20 border-2 border-banana'
                          : 'bg-white/5 border border-white/10'
                      }`}
                    >
                      <span className={`text-sm font-bold ${slot.highlight ? 'text-banana' : 'text-white/60'}`}>
                        {slot.pos}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <p className="text-lg text-white/70 leading-relaxed">
                Draft &quot;DAL WR1&quot; and you get the <span className="text-white font-medium">highest scoring</span> Dallas wide receiver each week.
                CeeDee scores 22? You get 22. Pickens goes off for 30? You get 30.
              </p>
              <p className="text-white/50 text-base">
                You always get the top performer each week.
              </p>
            </div>
          )}

          {currentSection.id === 'injury-protection' && (
            <div className="space-y-6">
              <h2 className="text-3xl md:text-4xl font-bold text-banana mb-2">Never Out of It</h2>
              <p className="text-xl text-white/90 leading-relaxed">
                One injury can destroy your season —<span className="text-red-400 font-medium"> Not Here.</span>
              </p>

              {/* Comparison Cards */}
              <div className="grid grid-cols-2 gap-4 my-6">
                {/* Other Platforms */}
                <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-4">
                  <p className="text-red-400 text-xs font-bold mb-3">OTHER PLATFORMS</p>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">🤕</span>
                      <span className="text-white/60 text-sm">CeeDee injured</span>
                    </div>
                    <div className="text-red-400 text-2xl font-bold text-center py-2">
                      0 PTS
                    </div>
                    <p className="text-red-400/60 text-xs text-center">Season over</p>
                  </div>
                </div>

                {/* SBS */}
                <div className="bg-banana/10 border border-banana/30 rounded-2xl p-4">
                  <p className="text-banana text-xs font-bold mb-3">ON SBS</p>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">🤕</span>
                      <span className="text-white/60 text-sm line-through">CeeDee</span>
                      <span className="text-banana">→ Pickens</span>
                    </div>
                    <div className="text-banana text-2xl font-bold text-center py-2">
                      24 PTS
                    </div>
                    <p className="text-banana/80 text-xs text-center">Still competing!</p>
                  </div>
                </div>
              </div>

              <p className="text-lg text-white/70 leading-relaxed">
                Since you own the <span className="text-white font-medium">position slot</span>, the backup steps in automatically.
                Your team keeps scoring. You&apos;re always in contention.
              </p>
            </div>
          )}

          {currentSection.id === 'draft-reveal' && (
            <div className="space-y-6">
              <h2 className="text-3xl md:text-4xl font-bold text-banana mb-2">The Slot Machine Reveal</h2>
              <p className="text-xl text-white/90 leading-relaxed">
                When 10 players join, a <span className="text-banana font-semibold">slot machine</span> spins to reveal your draft type.
              </p>

              {/* Slot Machine - Jackpot Final State */}
              <div className="relative my-6">
                {/* Dark Cabinet */}
                <div
                  className="rounded-2xl overflow-hidden mx-auto"
                  style={{
                    background: '#000',
                    padding: '2px',
                    boxShadow: '0 20px 40px rgba(0,0,0,0.8)',
                    width: 'fit-content',
                  }}
                >
                  <div
                    className="rounded-2xl overflow-hidden"
                    style={{
                      background: 'linear-gradient(180deg, #1c1c1e 0%, #0a0a0a 100%)',
                      padding: '12px',
                    }}
                  >
                    <div
                      className="rounded-xl overflow-hidden"
                      style={{ background: '#000', padding: '12px' }}
                    >
                      {/* 3 Reels */}
                      <div className="flex gap-2">
                        {/* Reel 1 */}
                        <div
                          className="relative rounded-lg overflow-hidden"
                          style={{
                            width: '90px',
                            height: '220px',
                            background: 'linear-gradient(180deg, #a78bfa 0%, #8b5cf6 50%, #7c3aed 100%)',
                          }}
                        >
                          <div className="absolute inset-0 flex flex-col">
                            <div className="flex-1 flex items-center justify-center relative px-2">
                              <div className="absolute bottom-0 inset-x-2 h-[1px] bg-black/30" />
                              <span className="text-2xl">🍌</span>
                            </div>
                            <div className="flex-1 flex items-center justify-center relative px-2"
                              style={{ background: 'rgba(255,255,255,0.15)', borderTop: '2px solid rgba(255,255,255,0.5)', borderBottom: '2px solid rgba(255,255,255,0.5)' }}
                            >
                              <span className="text-[13px] font-black italic uppercase" style={{ color: '#e62222', textShadow: '1px 1px 0 #1a1a1a' }}>JACKPOT</span>
                            </div>
                            <div className="flex-1 flex items-center justify-center relative px-2">
                              <div className="absolute top-0 inset-x-2 h-[1px] bg-white/30" />
                              <span className="text-xl font-black" style={{ color: '#f5c400', textShadow: '1px 1px 0 #705a00' }}>HOF</span>
                            </div>
                          </div>
                          <div className="absolute inset-x-0 top-0 h-8 pointer-events-none" style={{ background: 'linear-gradient(180deg, #a78bfa 0%, transparent 100%)' }} />
                          <div className="absolute inset-x-0 bottom-0 h-6 pointer-events-none" style={{ background: 'linear-gradient(0deg, #7c3aed 0%, transparent 100%)' }} />
                        </div>
                        {/* Reel 2 */}
                        <div
                          className="relative rounded-lg overflow-hidden"
                          style={{
                            width: '90px',
                            height: '220px',
                            background: 'linear-gradient(180deg, #a78bfa 0%, #8b5cf6 50%, #7c3aed 100%)',
                          }}
                        >
                          <div className="absolute inset-0 flex flex-col">
                            <div className="flex-1 flex items-center justify-center relative px-2">
                              <div className="absolute bottom-0 inset-x-2 h-[1px] bg-black/30" />
                              <span className="text-xl font-black" style={{ color: '#f5c400', textShadow: '1px 1px 0 #705a00' }}>HOF</span>
                            </div>
                            <div className="flex-1 flex items-center justify-center relative px-2"
                              style={{ background: 'rgba(255,255,255,0.15)', borderTop: '2px solid rgba(255,255,255,0.5)', borderBottom: '2px solid rgba(255,255,255,0.5)' }}
                            >
                              <span className="text-[13px] font-black italic uppercase" style={{ color: '#e62222', textShadow: '1px 1px 0 #1a1a1a' }}>JACKPOT</span>
                            </div>
                            <div className="flex-1 flex items-center justify-center relative px-2">
                              <div className="absolute top-0 inset-x-2 h-[1px] bg-white/30" />
                              <span className="text-2xl">🍌</span>
                            </div>
                          </div>
                          <div className="absolute inset-x-0 top-0 h-8 pointer-events-none" style={{ background: 'linear-gradient(180deg, #a78bfa 0%, transparent 100%)' }} />
                          <div className="absolute inset-x-0 bottom-0 h-6 pointer-events-none" style={{ background: 'linear-gradient(0deg, #7c3aed 0%, transparent 100%)' }} />
                        </div>
                        {/* Reel 3 */}
                        <div
                          className="relative rounded-lg overflow-hidden"
                          style={{
                            width: '90px',
                            height: '220px',
                            background: 'linear-gradient(180deg, #a78bfa 0%, #8b5cf6 50%, #7c3aed 100%)',
                          }}
                        >
                          <div className="absolute inset-0 flex flex-col">
                            <div className="flex-1 flex items-center justify-center relative px-2">
                              <div className="absolute bottom-0 inset-x-2 h-[1px] bg-black/30" />
                              <span className="text-2xl">🍌</span>
                            </div>
                            <div className="flex-1 flex items-center justify-center relative px-2"
                              style={{ background: 'rgba(255,255,255,0.15)', borderTop: '2px solid rgba(255,255,255,0.5)', borderBottom: '2px solid rgba(255,255,255,0.5)' }}
                            >
                              <span className="text-[13px] font-black italic uppercase" style={{ color: '#e62222', textShadow: '1px 1px 0 #1a1a1a' }}>JACKPOT</span>
                            </div>
                            <div className="flex-1 flex items-center justify-center relative px-2">
                              <div className="absolute top-0 inset-x-2 h-[1px] bg-white/30" />
                              <span className="text-2xl">🍌</span>
                            </div>
                          </div>
                          <div className="absolute inset-x-0 top-0 h-8 pointer-events-none" style={{ background: 'linear-gradient(180deg, #a78bfa 0%, transparent 100%)' }} />
                          <div className="absolute inset-x-0 bottom-0 h-6 pointer-events-none" style={{ background: 'linear-gradient(0deg, #7c3aed 0%, transparent 100%)' }} />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                {/* Result */}
                <p className="text-red-400 font-bold mt-3 text-center animate-pulse">JACKPOT!</p>
              </div>

              {/* Draft Types Explained */}
              <div className="space-y-3">
                <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/30 rounded-xl p-3">
                  <div className="w-10 h-10 rounded-lg bg-red-500/20 flex items-center justify-center">
                    <span className="text-red-400 font-bold text-xs">1%</span>
                  </div>
                  <div className="text-left">
                    <p className="text-red-400 font-semibold text-sm">Jackpot</p>
                    <p className="text-white/50 text-xs">Win your league → Skip to the finals</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 bg-[#D4AF37]/10 border border-[#D4AF37]/30 rounded-xl p-3">
                  <div className="w-10 h-10 rounded-lg bg-[#D4AF37]/20 flex items-center justify-center">
                    <span className="text-[#D4AF37] font-bold text-xs">5%</span>
                  </div>
                  <div className="text-left">
                    <p className="text-[#D4AF37] font-semibold text-sm">Hall of Fame</p>
                    <p className="text-white/50 text-xs">Compete for bonus prizes on top of regular rewards</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 bg-purple-500/10 border border-purple-500/30 rounded-xl p-3">
                  <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
                    <span className="text-purple-400 font-bold text-xs">94%</span>
                  </div>
                  <div className="text-left">
                    <p className="text-purple-400 font-semibold text-sm">Pro</p>
                    <p className="text-white/50 text-xs">Standard draft</p>
                  </div>
                </div>
              </div>

              {/* Guaranteed Distribution */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-4 mt-4">
                <p className="text-white/70 text-sm text-center">
                  <span className="text-white font-medium">Guaranteed distribution:</span> Every 100 paid drafts contains exactly 1 Jackpot, 5 HOF, and 94 Pro drafts. The order is randomized, but the distribution is guaranteed. Players can also win Jackpot and HOF entries on the Banana Wheel — earn spins by completing promos.
                </p>
              </div>
            </div>
          )}

          {currentSection.id === 'banana-wheel' && (
            <div className="space-y-6">
              <h2 className="text-3xl md:text-4xl font-bold text-banana mb-2">Banana Wheel</h2>
              <p className="text-xl text-white/90 leading-relaxed">
                Spin the <span className="text-banana font-semibold">Banana Wheel</span> for free draft passes.
              </p>

              {/* Wheel Preview - Matching actual BananaWheel design */}
              <div className="relative w-56 h-56 mx-auto my-6">
                {/* Pointer */}
                <div className="absolute -top-1 left-1/2 -translate-x-1/2 z-20">
                  <div className="relative">
                    <div
                      className="w-0 h-0 border-l-[10px] border-r-[10px] border-t-[20px] border-l-transparent border-r-transparent border-t-[#fbbf24]"
                      style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))' }}
                    />
                  </div>
                </div>

                {/* Wheel */}
                <div
                  className="relative w-full h-full rounded-full overflow-hidden animate-[spin_12s_linear_infinite]"
                  style={{
                    boxShadow: '0 4px 30px rgba(0,0,0,0.4), inset 0 0 0 3px rgba(255,255,255,0.1)',
                    background: 'linear-gradient(145deg, rgba(30,30,40,1) 0%, rgba(15,15,20,1) 100%)',
                  }}
                >
                  <svg viewBox="0 0 100 100" className="w-full h-full">
                    {/* 12 wheel segments */}
                    {[
                      { color: '#94a3b8', label: '1' },
                      { color: '#22c55e', label: '5' },
                      { color: '#94a3b8', label: '1' },
                      { color: '#ef4444', label: 'JP' },
                      { color: '#94a3b8', label: '1' },
                      { color: '#a78bfa', label: '10' },
                      { color: '#94a3b8', label: '1' },
                      { color: '#d4af37', label: 'HOF' },
                      { color: '#94a3b8', label: '1' },
                      { color: '#22c55e', label: '5' },
                      { color: '#94a3b8', label: '1' },
                      { color: '#f59e0b', label: '20' },
                    ].map((segment, index) => {
                      const segmentAngle = 30;
                      const startAngle = index * segmentAngle;
                      const endAngle = (index + 1) * segmentAngle;
                      const startRad = (startAngle - 90) * (Math.PI / 180);
                      const endRad = (endAngle - 90) * (Math.PI / 180);
                      const x1 = 50 + 50 * Math.cos(startRad);
                      const y1 = 50 + 50 * Math.sin(startRad);
                      const x2 = 50 + 50 * Math.cos(endRad);
                      const y2 = 50 + 50 * Math.sin(endRad);
                      const path = `M 50 50 L ${x1} ${y1} A 50 50 0 0 1 ${x2} ${y2} Z`;
                      const midAngle = (startAngle + endAngle) / 2 - 90;
                      const midRad = midAngle * (Math.PI / 180);
                      const textX = 50 + 35 * Math.cos(midRad);
                      const textY = 50 + 35 * Math.sin(midRad);

                      return (
                        <g key={index}>
                          <path d={path} fill={segment.color} stroke="rgba(255,255,255,0.08)" strokeWidth="0.3" />
                          <text
                            x={textX}
                            y={textY}
                            fill="white"
                            fontSize="5"
                            fontWeight="600"
                            textAnchor="middle"
                            dominantBaseline="middle"
                            transform={`rotate(${midAngle + 90}, ${textX}, ${textY})`}
                            style={{ textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}
                          >
                            {segment.label}
                          </text>
                        </g>
                      );
                    })}
                    {/* Center circle */}
                    <circle cx="50" cy="50" r="10" fill="#1a1a25" />
                    <circle cx="50" cy="50" r="10" fill="none" stroke="rgba(251,191,36,0.5)" strokeWidth="1" />
                    <image href="/sbs-logo.png" x="43" y="43" width="14" height="14" />
                  </svg>
                </div>

                {/* Border */}
                <div
                  className="absolute inset-0 rounded-full pointer-events-none"
                  style={{
                    border: '3px solid rgba(251,191,36,0.8)',
                  }}
                />
              </div>

              {/* Prizes */}
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="bg-white/5 rounded-xl p-3 border border-white/10">
                  <div className="text-2xl mb-1">🎟️</div>
                  <span className="text-banana font-bold text-sm">Free Drafts</span>
                  <p className="text-white/40 text-[10px] mt-1">1, 5, 10, or 20</p>
                </div>
                <div className="bg-red-500/10 rounded-xl p-3 border border-red-500/30">
                  <div className="text-2xl mb-1">🔥</div>
                  <span className="text-red-400 font-bold text-sm">Jackpot Entry</span>
                  <p className="text-white/40 text-[10px] mt-1">Skip to finals</p>
                </div>
                <div className="bg-[#d4af37]/10 rounded-xl p-3 border border-[#d4af37]/30">
                  <div className="text-2xl mb-1">🏆</div>
                  <span className="text-[#d4af37] font-bold text-sm">HOF Entry</span>
                  <p className="text-white/40 text-[10px] mt-1">Bonus prizes</p>
                </div>
              </div>

              {/* How to earn spins */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-4 mt-2">
                <p className="text-white font-medium text-sm mb-2 text-center">Earn spins by completing promos</p>
                <div className="space-y-1.5 text-xs text-white/60">
                  <div className="flex justify-between"><span>New user bonus</span><span className="text-banana">1 spin</span></div>
                  <div className="flex justify-between"><span>Complete 4 drafts in 24hrs</span><span className="text-banana">1 spin</span></div>
                  <div className="flex justify-between"><span>Get the 10th pick</span><span className="text-banana">1 spin</span></div>
                  <div className="flex justify-between"><span>Refer a friend</span><span className="text-banana">1 spin</span></div>
                  <div className="flex justify-between"><span>Friend buys drafts</span><span className="text-banana">+2 spins</span></div>
                  <div className="flex justify-between"><span>Hit a Jackpot early</span><span className="text-banana">5-10 spins</span></div>
                </div>
              </div>
            </div>
          )}

          {currentSection.id === 'marketplace' && (
            <div className="space-y-6">
              <h2 className="text-3xl md:text-4xl font-bold text-banana mb-2">Your Team, Your Asset</h2>
              <p className="text-xl text-white/90 leading-relaxed">
                Your drafted team has <span className="text-banana font-semibold">real value</span> you can trade anytime.
              </p>

              {/* Simple team card */}
              <div className="bg-white/5 border border-white/10 rounded-2xl p-5 my-6 max-w-sm mx-auto">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-14 h-14 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center">
                    <span className="text-2xl">🍌</span>
                  </div>
                  <div className="text-left">
                    <p className="text-white font-semibold">Your Team</p>
                    <p className="text-white/40 text-sm">League #4,521</p>
                  </div>
                  <div className="ml-auto text-right">
                    <p className="text-banana font-bold text-xl">$45</p>
                    <p className="text-green-400 text-xs">↑ tradeable</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="flex-1 py-2.5 rounded-xl bg-white/10 text-white/70 text-sm font-medium text-center">Sell</div>
                  <div className="flex-1 py-2.5 rounded-xl bg-banana/20 text-banana text-sm font-medium text-center border border-banana/30">Buy Teams</div>
                </div>
              </div>

              <p className="text-lg text-white/70 leading-relaxed">
                Bad draft? <span className="text-white font-medium">Sell it.</span> See a contender mid-season? <span className="text-white font-medium">Buy it.</span>
              </p>
              <p className="text-white/50 text-base">
                No other platform lets you do this.
              </p>
            </div>
          )}

          {/* Back/Next live in the fixed bottom bar (always visible, no
              scroll) — see the footer below. */}
        </div>
      );
    }

    if (currentSection.type === 'profile') {
      return (
        <div className="text-center max-w-xl mx-auto px-6">
          <div className="space-y-6">
            <div className="text-6xl">🧢</div>
            <h2 className="text-3xl md:text-4xl font-bold text-white">Set Up Your Profile</h2>
            <p className="text-white/60 text-lg">
              Pick a display name and optional avatar so others recognize your teams.
            </p>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 text-left space-y-5">
              <div>
                <label className="block text-sm text-white/60 mb-2">Display Name</label>
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="BananaBaller"
                  className="w-full rounded-xl bg-black/40 border border-white/10 px-4 py-3 text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-banana/60"
                />
                {nameError && (
                  <p className="text-sm text-red-400 mt-2">{nameError}</p>
                )}
              </div>

              <div>
                <label className="block text-sm text-white/60 mb-3">Avatar (Optional)</label>
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-full overflow-hidden bg-white/10 border border-white/20 flex items-center justify-center">
                    {avatarPreview ? (
                      <Image
                        src={avatarPreview}
                        alt="Avatar preview"
                        width={64}
                        height={64}
                        className="w-full h-full object-cover"
                        unoptimized
                      />
                    ) : (
                      <span className="text-2xl">🍌</span>
                    )}
                  </div>
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    accept="image/*"
                    className="hidden"
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="px-4 py-2 rounded-xl bg-white/10 text-white/80 hover:text-white hover:bg-white/20 transition-all"
                  >
                    Upload
                  </button>
                  {avatarPreview && (
                    <button
                      onClick={() => setAvatarPreview(null)}
                      className="px-3 py-2 text-white/50 hover:text-white/80"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>

              {/* Optional NFL team badge — reps on the user's profile and teams. */}
              <div>
                <label className="block text-sm text-white/60 mb-1">
                  Rep Your Team <span className="text-white/40">(Optional)</span>
                </label>
                <p className="text-white/40 text-xs mb-3">
                  Pick a badge for your profile. You can change it anytime.
                </p>
                <div className="grid grid-cols-6 gap-2.5 max-h-40 overflow-y-auto px-1 py-1">
                  {teamBadges.map(badge => {
                    const isSelected = equipped === badge.id;
                    return (
                      <button
                        key={badge.id}
                        type="button"
                        onClick={() => handlePickTeam(badge.id)}
                        disabled={equippingTeam}
                        title={badge.label}
                        aria-label={badge.label}
                        aria-pressed={isSelected}
                        className={`relative flex items-center justify-center rounded-full transition-all hover:scale-110 active:scale-95 disabled:opacity-60 ${
                          isSelected
                            ? 'ring-2 ring-banana ring-offset-2 ring-offset-black scale-105'
                            : 'opacity-70 hover:opacity-100'
                        }`}
                      >
                        <BadgeIcon badge={badge} size={36} showTooltip={false} />
                      </button>
                    );
                  })}
                </div>
                {equipped && teamBadges.some(b => b.id === equipped) && (
                  <p className="text-banana/80 text-xs mt-3">
                    Repping the {teamBadges.find(b => b.id === equipped)?.label}.
                    <button
                      type="button"
                      onClick={() => handlePickTeam(equipped)}
                      disabled={equippingTeam}
                      className="ml-2 underline text-white/50 hover:text-white"
                    >
                      Clear
                    </button>
                  </p>
                )}
              </div>
            </div>
            {/* Back/Continue live in the fixed bottom bar — see the footer below. */}
          </div>
        </div>
      );
    }

    // Intro section
    if (currentSection.type === 'intro') {
      return (
        <div className="text-center">
          <div className="relative inline-block mb-10">
            <div className="absolute inset-0 bg-banana/30 rounded-full blur-3xl scale-150" />
            <Image
              src="/sbs-logo.png"
              alt="Banana Fantasy"
              width={80}
              height={80}
              className="relative z-10"
            />
          </div>

          <h1 className="text-5xl md:text-6xl font-bold text-white mb-6 tracking-tight">
            Fantasy Football<br />
            <span className="text-banana">Evolved</span>
          </h1>

          <div className="flex items-center justify-center gap-2 text-white/40 text-sm mb-10">
            <span>Team Positions</span>
            <span className="text-banana/60">·</span>
            <span>Tradeable Teams</span>
            <span className="text-banana/60">·</span>
            <span>Jackpot Drafts</span>
          </div>

          <button
            onClick={advanceSection}
            className="px-10 py-4 bg-banana text-black font-bold rounded-full transition-all hover:scale-105 active:scale-95"
          >
            Learn More
          </button>
        </div>
      );
    }

    // Ready section
    if (currentSection.type === 'ready') {
      return (
        <div className="text-center">
          <div className="text-7xl mb-6 animate-bounce">🍌</div>
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-4">You&apos;re ready.</h2>
          <p className="text-white/50 text-xl mb-8">Draft smart. Win big.</p>

          <button
            onClick={handleSkip}
            className="px-8 py-4 bg-banana text-black font-bold text-lg rounded-2xl hover:bg-banana/90 transition-all hover:scale-105 active:scale-95"
          >
            Let&apos;s Go
          </button>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Subtle background glow */}
      <div
        className={`absolute inset-0 transition-opacity duration-300 pointer-events-none ${
          isVisible ? 'opacity-100' : 'opacity-0'
        }`}
        style={{
          background: 'radial-gradient(ellipse 60% 40% at center 40%, rgba(251,191,36,0.05) 0%, transparent 70%)',
        }}
      />

      {/* Black overlay for transitions */}
      <div
        className={`absolute inset-0 bg-black transition-opacity duration-200 pointer-events-none ${
          !isVisible ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Skip button — offset below the iOS notch/safe-area so it's reachable
          and tappable on the mobile/PWA app (top-5 alone sat under the notch). */}
      <button
        onClick={handleSkip}
        style={{ top: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' }}
        className="absolute right-5 flex items-center gap-2 px-4 py-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-all z-20 text-sm"
      >
        Skip
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>

      {/* Scrollable content area */}
      {/* Outer scrolls; inner min-h-full centers short slides but grows
          (top-aligned, fully scrollable) for tall slides so the heading
          above tall content like the slot-machine slide is never clipped. */}
      <div className="flex-1 overflow-y-auto">
        <div className="min-h-full flex items-center justify-center px-6 pt-24 pb-12">
          <div
            className={`relative z-10 w-full max-w-2xl transition-all duration-300 ${
              isVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
            }`}
          >
            {renderSection()}
          </div>
        </div>
      </div>

      {/* Fixed bottom bar — always visible regardless of scroll. On content
          sections, Back/Next flank the progress dots (left/right of the
          "yellow things"). Intro/profile/ready keep their own primary CTAs. */}
      <div className="flex-shrink-0 py-5 px-6 flex items-center justify-center gap-4 sm:gap-6 z-20">
        {(currentSection?.type === 'section' || currentSection?.type === 'profile') && sectionIndex > 0 && (
          <button
            onClick={goBack}
            className="px-4 sm:px-6 py-2.5 text-white/60 hover:text-white font-semibold rounded-xl transition-all hover:scale-105 active:scale-95"
          >
            ← Back
          </button>
        )}

        <div className="flex gap-2">
          {sections.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-500 ${
                i === sectionIndex
                  ? 'bg-banana w-8'
                  : i < sectionIndex
                  ? 'bg-banana/50 w-3'
                  : 'bg-white/10 w-3'
              }`}
            />
          ))}
        </div>

        {currentSection?.type === 'section' && (
          <button
            onClick={advanceSection}
            className="px-5 sm:px-8 py-2.5 bg-white/10 hover:bg-white/20 text-white font-semibold rounded-xl transition-all hover:scale-105 active:scale-95 border border-white/20"
          >
            Next →
          </button>
        )}

        {currentSection?.type === 'profile' && (
          <button
            onClick={handleProfileSubmit}
            disabled={savingProfile}
            className="px-5 sm:px-8 py-2.5 bg-banana text-black font-semibold rounded-xl transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
          >
            {savingProfile ? 'Saving…' : 'Continue'}
          </button>
        )}
      </div>
    </div>
  );
}
