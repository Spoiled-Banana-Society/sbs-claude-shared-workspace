'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useAuth } from '@/hooks/useAuth';
import { AvatarWithBadge } from '@/components/badges/AvatarWithBadge';
import { BadgeCatalogGrid } from '@/components/badges/BadgeCatalogGrid';

interface EditProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function EditProfileModal({ isOpen, onClose }: EditProfileModalProps) {
  const { user, updateUser } = useAuth();
  const [username, setUsername] = useState('');
  const [profilePicturePreview, setProfilePicturePreview] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (user) {
      setUsername(user.username);
      setProfilePicturePreview(user.profilePicture || null);
      setPendingFile(null);
    }
  }, [user]);

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
    let pic = profilePicturePreview || undefined;

    // Upload custom image to Firebase Storage if user selected a file
    if (pendingFile && user?.walletAddress) {
      try {
        const formData = new FormData();
        formData.append('file', pendingFile);
        formData.append('wallet', user.walletAddress);
        const res = await fetch('/api/upload', { method: 'POST', body: formData });
        if (res.ok) {
          const data = await res.json();
          pic = data.url;
        }
      } catch {
        // Upload failed — keep local preview for desktop, won't sync to mobile
      }
    }

    updateUser({
      username,
      profilePicture: pic,
    });
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
            onChange={(e) => setUsername(e.target.value)}
            className="w-full input"
            placeholder="Enter username"
          />
        </div>

        {/* X (Twitter) Connection */}
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-2">
            X (Twitter)
          </label>
          {user.xHandle ? (
            <div className="flex items-center justify-between p-3 bg-bg-tertiary rounded-lg">
              <div className="flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="text-text-primary">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                </svg>
                <span className="text-text-primary font-medium">{user.xHandle}</span>
              </div>
              <span className="text-xs text-success font-medium">Connected</span>
            </div>
          ) : (
            <Button
              variant="secondary"
              onClick={() => alert('X OAuth would open here')}
              className="w-full flex items-center justify-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
              </svg>
              Connect X Account
            </Button>
          )}
        </div>

        {/* Badges — pick which badge to show next to your avatar */}
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-2">
            Badges
          </label>
          <p className="text-xs text-text-muted mb-3">
            Earn badges by drafting, winning leagues, hitting JP/HOF on the wheel, and more. Click an
            unlocked badge to show it next to your avatar everywhere.
          </p>
          <div className="max-h-[420px] overflow-y-auto p-3 bg-bg-tertiary rounded-lg border border-white/10">
            <BadgeCatalogGrid />
          </div>
        </div>

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
          <Button onClick={handleSave} className="flex-1" disabled={saving}>
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
