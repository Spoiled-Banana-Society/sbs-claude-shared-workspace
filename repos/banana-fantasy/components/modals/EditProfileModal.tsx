'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useAuth } from '@/hooks/useAuth';
import { AvatarWithBadge } from '@/components/badges/AvatarWithBadge';
import { usernameErrorText } from '@/lib/usernameMessages';
import { publishIdentityChange } from '@/lib/identityBus';

interface EditProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function EditProfileModal({ isOpen, onClose }: EditProfileModalProps) {
  const { user, updateUser, walletAddress, linkTwitter, isTwitterLinking, isTwitterVerified, twitterError } = useAuth();
  const privy = usePrivy();
  const [username, setUsername] = useState('');
  const [profilePicturePreview, setProfilePicturePreview] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [checkingName, setCheckingName] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize the form when the modal OPENS (or the account changes) — NOT on
  // every background `user` refresh. The balance SSE swaps in a new `user`
  // object every few seconds; depending on the whole `user` here meant each
  // refresh reset the preview to the saved pfp, wiping an in-progress selection
  // (= nothing, for a user with no pfp yet) ~1s after they picked an image.
  useEffect(() => {
    if (isOpen && user) {
      setUsername(user.username);
      setProfilePicturePreview(user.profilePicture || null);
      setPendingFile(null);
      setNameError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, user?.id]);

  const authHeaders = useCallback(async (): Promise<HeadersInit> => {
    // Never throw on a not-yet-ready token — the wallet in the request body lets
    // the server fall back, so the call still goes through for a fresh web2 user.
    let token: string | null = null;
    try { token = await privy.getAccessToken(); } catch { /* token not ready yet */ }
    return { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' };
  }, [privy]);

  // Live "username taken" check while typing. Ref the header getter so the
  // effect's deps stay scalar (just the typed name) — Privy's hook identity
  // churns per render and listing it here would re-fire the fetch every render
  // (Rule #0 self-DDoS). Skips the check when the name is unchanged/empty.
  const authHeadersRef = useRef(authHeaders);
  useEffect(() => { authHeadersRef.current = authHeaders; }, [authHeaders]);
  const currentName = user?.username ?? '';
  useEffect(() => {
    const name = username.trim();
    if (!name || name.toLowerCase() === currentName.toLowerCase()) { setNameError(null); setCheckingName(false); return; }
    let cancelled = false;
    setCheckingName(true);
    const t = setTimeout(async () => {
      try {
        const headers = await authHeadersRef.current();
        const res = await fetch(`/api/username?name=${encodeURIComponent(name)}&wallet=${encodeURIComponent(user?.walletAddress ?? '')}`, { headers, cache: 'no-store' });
        const data = (await res.json()) as { available?: boolean; reason?: string };
        if (cancelled) return;
        setNameError(data.available ? null : usernameErrorText(data.reason));
      } catch { /* ignore — save-time check is the hard gate */ }
      finally { if (!cancelled) setCheckingName(false); }
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [username, currentName]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPendingFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setProfilePicturePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSave = async () => {
    setSaving(true);

    // Enforce unique usernames. Only when the name actually changed — claiming
    // your own current name is a no-op but the server would treat it as fine
    // anyway. A 409 means someone already has it.
    const nameChanged = username.trim().toLowerCase() !== (user?.username ?? '').toLowerCase();
    if (nameChanged) {
      // A brand-new web2 wallet resolves server-side a few seconds after login
      // (Privy propagation). In that window POST /api/username 400s with
      // 'wallet required' and used to surface as a misleading "Username
      // unavailable." Retry a few times so the claim lands once the wallet
      // propagates, rather than failing on the first beat.
      let claimed = false;
      for (let attempt = 0; attempt < 6 && !claimed; attempt++) {
        try {
          const headers = await authHeaders();
          const res = await fetch('/api/username', {
            method: 'POST', headers, body: JSON.stringify({ name: username.trim(), wallet: user?.walletAddress }),
          });
          if (res.ok) { setNameError(null); claimed = true; break; }
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
          setSaving(false);
          return;
        } catch {
          if (attempt < 5) { await new Promise((r) => setTimeout(r, 1500)); continue; }
          setNameError('Could not check username — try again.');
          setSaving(false);
          return;
        }
      }
      if (!claimed) { setSaving(false); return; }
    }

    let pic = profilePicturePreview || undefined;

    // Upload custom image to Firebase Storage if user selected a file
    if (pendingFile && user?.walletAddress) {
      let uploaded = false;
      try {
        const formData = new FormData();
        formData.append('file', pendingFile);
        let uploadToken = '';
        try { uploadToken = (await privy.getAccessToken()) || ''; } catch { /* token not ready */ }
        const res = await fetch('/api/upload', {
          method: 'POST',
          headers: uploadToken ? { Authorization: `Bearer ${uploadToken}` } : undefined,
          body: formData,
        });
        if (res.ok) {
          const data = await res.json();
          pic = data.url;
          uploaded = true;
        }
      } catch {
        // fall through to the failure handler below
      }
      if (!uploaded) {
        // NEVER save the raw base64 preview as the pfp — a multi-hundred-KB data
        // URL bloats Firestore, 500s the Go API pfp endpoint, and won't render in
        // the draft room. Surface the failure and let the user retry instead.
        setNameError('Couldn’t upload your image — please try again.');
        setSaving(false);
        return;
      }
    }

    updateUser({
      username: username.trim(),
      profilePicture: pic,
    });
    // Instantly refresh the editor's OTHER surfaces (e.g. their draft-room card,
    // which reads display-batch, not useAuth). Other users get it via the 30s poll.
    publishIdentityChange(user?.walletAddress);
    setSaving(false);
    onClose();
  };

  if (!user) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Edit Profile" size="md">
      <div className="space-y-6">
        {/* Profile Picture */}
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-2">
            Profile Picture
          </label>
          <div className="flex items-center gap-4">
            <AvatarWithBadge
              imageUrl={profilePicturePreview}
              alt={user.username}
              size={80}
              equippedBadge={user.equippedBadge}
              ripeness={user.ripeness}
            />
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept="image/*"
              className="hidden"
            />
            <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
              Change Picture
            </Button>
          </div>
        </div>

        {/* Username */}
        <div>
          <label htmlFor="username" className="block text-sm font-medium text-text-secondary mb-2">
            Username
          </label>
          <input
            type="text"
            id="username"
            value={username}
            onChange={(e) => { setUsername(e.target.value); setNameError(null); }}
            className="w-full input"
            placeholder="Enter username"
            maxLength={20}
          />
          {nameError ? (
            <p className="text-xs text-red-400 mt-1.5">{nameError}</p>
          ) : checkingName ? (
            <p className="text-xs text-text-muted mt-1.5">Checking availability…</p>
          ) : username.trim() && username.trim().toLowerCase() !== (user.username ?? '').toLowerCase() ? (
            <p className="text-xs text-success mt-1.5">Username available</p>
          ) : null}
        </div>

        {/* X (Twitter) Connection */}
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-2">
            X (Twitter)
          </label>
          {(user.xHandle || isTwitterVerified) ? (
            <div className="flex items-center justify-between p-3 bg-bg-tertiary rounded-lg">
              <div className="flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="text-text-primary">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                </svg>
                <span className="text-text-primary font-medium">{user.xHandle || 'Connected'}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-success font-medium">Connected</span>
                {/* Switch to a different X (AceJohn 2026-08-13) — the connect
                    flow unlinks the old account first, so one tap swaps. */}
                <button
                  type="button"
                  onClick={() => linkTwitter()}
                  className="text-xs text-text-secondary hover:text-banana underline underline-offset-2 transition-colors"
                >
                  Change
                </button>
              </div>
            </div>
          ) : (
            <>
              <Button
                variant="secondary"
                onClick={() => linkTwitter()}
                disabled={isTwitterLinking || !walletAddress}
                className="w-full flex items-center justify-center gap-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                </svg>
                {isTwitterLinking ? 'Connecting…' : !walletAddress ? 'Finishing sign-in…' : 'Connect X Account'}
              </Button>
              {twitterError && (
                <p className="text-xs text-error mt-1.5 leading-snug">⚠️ {twitterError}</p>
              )}
            </>
          )}
        </div>

        {/* Badges live on /profile so there's a single canonical source.
            This is just a deep link so users can still get there from
            the edit-profile modal without duplicating the catalog UI. */}
        <Link
          href="/profile?tab=badges"
          onClick={onClose}
          className="flex items-center justify-between p-3 bg-bg-tertiary rounded-lg border border-white/10 hover:border-banana/40 transition-colors"
        >
          <div>
            <p className="text-sm font-medium text-text-primary">Badges</p>
            <p className="text-xs text-text-muted mt-0.5">Manage equipped badge & see locked rewards</p>
          </div>
          <span className="text-text-muted">→</span>
        </Link>

        <div className="p-4 bg-bg-tertiary rounded-lg border border-white/10">
          <p className="text-sm font-medium text-text-primary">Wallet Address</p>
          <p className="text-xs text-text-muted mt-1">
            Use this address for prize withdrawals.
          </p>
          <div className="mt-3 p-2 bg-bg-primary rounded border border-white/10">
            <code className="text-xs text-text-primary break-all select-all">
              {user.walletAddress}
            </code>
          </div>
        </div>


        {/* Actions */}
        <div className="flex gap-3 pt-4">
          <Button variant="ghost" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button onClick={handleSave} className="flex-1" disabled={saving || checkingName || !!nameError}>
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
