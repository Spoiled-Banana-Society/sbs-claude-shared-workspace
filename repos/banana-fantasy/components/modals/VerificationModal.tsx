'use client';

import React, { useState, useRef, useCallback } from 'react';
import { Modal } from '../ui/Modal';
import { usePrivy } from '@privy-io/react-auth';

interface VerificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  onComplete: () => void;
}

// Single combined input step (form fields + ID upload visible together) — was
// previously split into 'form' then 'upload' but Boris asked for everything on
// one screen. Submission/success/error stays separate.
type Step = 'form' | 'submitting' | 'success' | 'error';

// US states + DC. Used for the State dropdown when country is US.
const US_STATES = [
  { code: 'AL', name: 'Alabama' }, { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' }, { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' }, { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' }, { code: 'DE', name: 'Delaware' },
  { code: 'DC', name: 'District of Columbia' }, { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' }, { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' }, { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' }, { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' }, { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' }, { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' }, { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' }, { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' }, { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' }, { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' }, { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' }, { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' }, { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' }, { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' }, { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' }, { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' }, { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' }, { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' }, { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' }, { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' }, { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
];

// Canadian provinces + territories.
const CA_PROVINCES = [
  { code: 'AB', name: 'Alberta' }, { code: 'BC', name: 'British Columbia' },
  { code: 'MB', name: 'Manitoba' }, { code: 'NB', name: 'New Brunswick' },
  { code: 'NL', name: 'Newfoundland and Labrador' },
  { code: 'NS', name: 'Nova Scotia' }, { code: 'NT', name: 'Northwest Territories' },
  { code: 'NU', name: 'Nunavut' }, { code: 'ON', name: 'Ontario' },
  { code: 'PE', name: 'Prince Edward Island' }, { code: 'QC', name: 'Quebec' },
  { code: 'SK', name: 'Saskatchewan' }, { code: 'YT', name: 'Yukon' },
];

const MAX_ID_FILE_SIZE_MB = 10;
const ALLOWED_ID_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/webp'];

interface FormData {
  firstName: string;
  lastName: string;
  dobYear: string;
  dobMonth: string;
  dobDay: string;
  country: 'US' | 'CA';
  street: string;
  city: string;
  state: string;
  zip: string;
}

const EMPTY_FORM: FormData = {
  firstName: '',
  lastName: '',
  dobYear: '',
  dobMonth: '',
  dobDay: '',
  country: 'US',
  street: '',
  city: '',
  state: '',
  zip: '',
};

export function VerificationModal({ isOpen, onClose, userId: _userId, onComplete }: VerificationModalProps) {
  const { getAccessToken } = usePrivy();
  const [step, setStep] = useState<Step>('form');
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [idFile, setIdFile] = useState<File | null>(null);
  const [idPreview, setIdPreview] = useState<string | null>(null);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Year range for DOB picker: 18+ today (max year = current - 18)
  // We don't enforce 18+ here — backend block rules + Didit do final check —
  // but the picker shouldn't suggest under-18 years.
  const currentYear = new Date().getFullYear();
  const maxYear = currentYear - 18;
  const minYear = currentYear - 100;

  const stateOptions = form.country === 'CA' ? CA_PROVINCES : US_STATES;

  const formValid = (
    form.firstName.trim().length > 0 &&
    form.lastName.trim().length > 0 &&
    form.dobYear && form.dobMonth && form.dobDay &&
    form.street.trim().length > 0 &&
    form.city.trim().length > 0 &&
    form.state.length > 0 &&
    form.zip.trim().length > 0
  );

  const reset = () => {
    setStep('form');
    setForm(EMPTY_FORM);
    setIdFile(null);
    setIdPreview(null);
    setError('');
  };

  // Compress an image client-side before upload. Modern phone cameras shoot
  // 3-8 MB photos (JPEG @ 12MP+), but our upload endpoint caps the request
  // body at ~1 MB. Without compression users hit "request body too large"
  // and have to manually resize — terrible UX. We downscale to max 2000px
  // wide at JPEG quality 0.82, which puts a typical passport photo under
  // 500 KB while keeping it sharp enough for OCR/document validation.
  const compressImage = async (file: File): Promise<File> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const MAX_DIMENSION = 2000;
        let { width, height } = img;
        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
          if (width > height) {
            height = Math.round((MAX_DIMENSION / width) * height);
            width = MAX_DIMENSION;
          } else {
            width = Math.round((MAX_DIMENSION / height) * width);
            height = MAX_DIMENSION;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas not supported'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Image compression failed'));
              return;
            }
            const compressed = new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), {
              type: 'image/jpeg',
              lastModified: Date.now(),
            });
            resolve(compressed);
          },
          'image/jpeg',
          0.82,
        );
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to read image. Please try a different photo.'));
      };
      img.src = url;
    });
  };

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!ALLOWED_ID_TYPES.includes(file.type) && !/\.(jpg|jpeg|png|heic|webp)$/i.test(file.name)) {
      setError('Please upload a JPG, PNG, HEIC, or WEBP image of your ID.');
      return;
    }
    const sizeMb = file.size / (1024 * 1024);
    if (sizeMb > MAX_ID_FILE_SIZE_MB) {
      setError(`Image is ${sizeMb.toFixed(1)}MB. Max allowed is ${MAX_ID_FILE_SIZE_MB}MB.`);
      return;
    }
    setError('');

    // Compress (and convert to JPEG) so the upload fits the request limit AND is
    // a format Didit accepts. HEIC (iPhone default) can only be decoded here by
    // Safari; Chrome can't, so compression fails. Didit REJECTS HEIC, so we must
    // NOT fall back to uploading the original HEIC (that produced a misleading
    // "try a clearer photo" loop) — tell the user how to fix it instead. A
    // JPEG/PNG that fails compression is already a supported format, so for
    // those the original is a safe fallback.
    const isHeic = /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
    let toUpload = file;
    try {
      toUpload = await compressImage(file);
    } catch (err) {
      console.warn('[Verification] Image compression failed:', err);
      if (isHeic) {
        setError("That looks like an iPhone (HEIC) photo your browser can't process here. Please upload a JPG or PNG instead — a screenshot of your ID works, or on iPhone set Camera → Formats → Most Compatible.");
        return;
      }
      toUpload = file; // non-HEIC: original is already a supported format
    }
    setIdFile(toUpload);

    // Show preview so user knows the right photo got picked.
    const reader = new FileReader();
    reader.onload = () => setIdPreview(reader.result as string);
    reader.readAsDataURL(toUpload);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!idFile) {
      setError('Please upload a photo of your ID first.');
      return;
    }
    setStep('submitting');
    setError('');

    try {
      const token = await getAccessToken();
      const dob = `${form.dobYear}-${form.dobMonth.padStart(2, '0')}-${form.dobDay.padStart(2, '0')}`;
      // Multipart so we can ship the image alongside the form data without
      // base64 inflation. Fits cleanly behind Vercel's 4.5MB request limit
      // for our 10MB file cap (backend will compress server-side if needed).
      const fd = new FormData();
      fd.append('firstName', form.firstName.trim());
      fd.append('lastName', form.lastName.trim());
      fd.append('dateOfBirth', dob);
      fd.append('country', form.country);
      fd.append('street', form.street.trim());
      fd.append('city', form.city.trim());
      fd.append('state', form.state);
      fd.append('zip', form.zip.trim());
      fd.append('idImage', idFile);

      const res = await fetch('/api/verify/submit', {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: fd,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Verification failed (${res.status})`);
      }

      const data = await res.json();
      if (data.approved) {
        setStep('success');
        // Give the user a beat to see the success screen, then call onComplete
        // so the parent CashOutModal can retry the cashout flow.
        setTimeout(() => onComplete(), 1500);
      } else {
        setError(data.reason || 'Verification was not approved.');
        setStep('error');
      }
    } catch (err) {
      console.error('[Verification] Submit error:', err);
      setError(err instanceof Error ? err.message : 'Verification failed');
      setStep('error');
    }
  }, [form, idFile, getAccessToken, onComplete]);

  const handleClose = () => {
    if (step === 'submitting') return; // don't allow close mid-submission
    reset();
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Verify your identity" size="md">
      {step === 'form' && (
        // base text-base on inputs prevents iOS Safari from auto-zooming
        // on focus (which it does for any input <16px font-size).
        <div className="space-y-6">
          <p className="text-text-secondary text-sm leading-relaxed">
            One-time verification. Required by law for crypto-to-cash payouts.
            Usually takes under 30 seconds.
          </p>

          {/* ── Section: Personal info ── */}
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-text-secondary block mb-1.5">First name</label>
                <input
                  type="text"
                  value={form.firstName}
                  onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                  placeholder="As on your ID"
                  className="w-full px-3.5 py-3 rounded-xl bg-bg-tertiary border border-bg-elevated text-text-primary text-base focus:outline-none focus:border-banana/60 transition-colors"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-text-secondary block mb-1.5">Last name</label>
                <input
                  type="text"
                  value={form.lastName}
                  onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                  placeholder="As on your ID"
                  className="w-full px-3.5 py-3 rounded-xl bg-bg-tertiary border border-bg-elevated text-text-primary text-base focus:outline-none focus:border-banana/60 transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-text-secondary block mb-1.5">Date of birth</label>
              <div className="grid grid-cols-3 gap-2">
                <select
                  value={form.dobMonth}
                  onChange={(e) => setForm({ ...form, dobMonth: e.target.value })}
                  className="px-3 py-3 rounded-xl bg-bg-tertiary border border-bg-elevated text-text-primary text-base focus:outline-none focus:border-banana/60 transition-colors"
                >
                  <option value="">Month</option>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={String(m)}>{new Date(0, m - 1).toLocaleString('en', { month: 'long' })}</option>
                  ))}
                </select>
                <select
                  value={form.dobDay}
                  onChange={(e) => setForm({ ...form, dobDay: e.target.value })}
                  className="px-3 py-3 rounded-xl bg-bg-tertiary border border-bg-elevated text-text-primary text-base focus:outline-none focus:border-banana/60 transition-colors"
                >
                  <option value="">Day</option>
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={String(d)}>{d}</option>
                  ))}
                </select>
                <select
                  value={form.dobYear}
                  onChange={(e) => setForm({ ...form, dobYear: e.target.value })}
                  className="px-3 py-3 rounded-xl bg-bg-tertiary border border-bg-elevated text-text-primary text-base focus:outline-none focus:border-banana/60 transition-colors"
                >
                  <option value="">Year</option>
                  {Array.from({ length: maxYear - minYear + 1 }, (_, i) => maxYear - i).map((y) => (
                    <option key={y} value={String(y)}>{y}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* ── Section: Address ── */}
          <div className="space-y-3 pt-1">
            <div>
              <label className="text-sm font-medium text-text-secondary block mb-1.5">Country</label>
              <select
                value={form.country}
                onChange={(e) => setForm({ ...form, country: e.target.value as 'US' | 'CA', state: '' })}
                className="w-full px-3.5 py-3 rounded-xl bg-bg-tertiary border border-bg-elevated text-text-primary text-base focus:outline-none focus:border-banana/60 transition-colors"
              >
                <option value="US">United States</option>
                <option value="CA">Canada</option>
              </select>
            </div>

            <div>
              <label className="text-sm font-medium text-text-secondary block mb-1.5">Street address</label>
              <input
                type="text"
                value={form.street}
                onChange={(e) => setForm({ ...form, street: e.target.value })}
                placeholder="123 Main St"
                className="w-full px-3.5 py-3 rounded-xl bg-bg-tertiary border border-bg-elevated text-text-primary text-base focus:outline-none focus:border-banana/60 transition-colors"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-text-secondary block mb-1.5">City</label>
                <input
                  type="text"
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                  className="w-full px-3.5 py-3 rounded-xl bg-bg-tertiary border border-bg-elevated text-text-primary text-base focus:outline-none focus:border-banana/60 transition-colors"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-text-secondary block mb-1.5">
                  {form.country === 'CA' ? 'Province' : 'State'}
                </label>
                <select
                  value={form.state}
                  onChange={(e) => setForm({ ...form, state: e.target.value })}
                  className="w-full px-3.5 py-3 rounded-xl bg-bg-tertiary border border-bg-elevated text-text-primary text-base focus:outline-none focus:border-banana/60 transition-colors"
                >
                  <option value="">Select…</option>
                  {stateOptions.map((s) => (
                    <option key={s.code} value={s.code}>{s.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-text-secondary block mb-1.5">
                {form.country === 'CA' ? 'Postal code' : 'ZIP code'}
              </label>
              <input
                type="text"
                value={form.zip}
                onChange={(e) => setForm({ ...form, zip: e.target.value })}
                className="w-full px-3.5 py-3 rounded-xl bg-bg-tertiary border border-bg-elevated text-text-primary text-base focus:outline-none focus:border-banana/60 transition-colors"
              />
            </div>
          </div>

          {/* ── Section: ID photo ── */}
          <div className="space-y-2 pt-3 border-t border-bg-tertiary">
            <label className="text-sm font-medium text-text-secondary block">ID photo</label>
            <p className="text-text-muted text-xs">
              Driver&apos;s license, passport, or state ID. Must match the name and date of birth above.
            </p>

            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept="image/jpeg,image/png,image/heic,image/webp,image/*"
              className="hidden"
            />

            {idPreview ? (
              <div className="rounded-xl overflow-hidden border border-bg-elevated bg-bg-tertiary mt-2">
                <img src={idPreview} alt="ID preview" className="w-full max-h-56 object-contain bg-black/20" />
                <div className="px-4 py-2.5 flex items-center justify-between border-t border-bg-elevated">
                  <span className="text-xs text-text-muted truncate">{idFile?.name}</span>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="text-xs font-medium text-banana hover:underline ml-3 flex-shrink-0"
                  >
                    Change
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full border-2 border-dashed border-bg-elevated rounded-xl py-7 px-4 text-center hover:border-banana/60 hover:bg-bg-tertiary/30 active:scale-[0.99] transition-all mt-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-text-muted mx-auto mb-2">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="9" cy="9" r="2" />
                  <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                </svg>
                <p className="text-text-primary text-sm font-medium">Upload ID photo</p>
                <p className="text-text-muted text-xs mt-0.5">JPG, PNG, HEIC, or WEBP</p>
              </button>
            )}
          </div>

          {error && (
            <p className="text-error text-sm">{error}</p>
          )}

          <button
            onClick={handleSubmit}
            disabled={!formValid || !idFile}
            className={`w-full py-3.5 rounded-xl font-semibold text-base transition-all ${
              formValid && idFile
                ? 'bg-banana text-black hover:brightness-110 active:scale-[0.99]'
                : 'bg-bg-tertiary text-text-muted cursor-not-allowed'
            }`}
          >
            Submit
          </button>
        </div>
      )}

      {step === 'submitting' && (
        <div className="flex flex-col items-center py-12 space-y-3">
          <div className="w-10 h-10 border-2 border-banana border-t-transparent rounded-full animate-spin" />
          <p className="text-text-primary font-medium text-sm">Verifying your ID…</p>
          <p className="text-text-muted text-xs">This usually takes under 30 seconds.</p>
        </div>
      )}

      {step === 'success' && (
        <div className="flex flex-col items-center py-8 space-y-4">
          <div className="w-16 h-16 rounded-full bg-success/20 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-success">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <h3 className="text-xl font-bold text-text-primary">Verified!</h3>
          <p className="text-text-secondary text-center text-sm">You&apos;re all set. You can now withdraw your winnings.</p>
        </div>
      )}

      {step === 'error' && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-error/10 border border-error/30">
            <p className="text-error font-semibold mb-1">Verification not approved</p>
            <p className="text-text-secondary text-sm">{error || 'Please try again.'}</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setStep('form')}
              className="flex-1 py-3 rounded-xl font-semibold text-sm bg-bg-tertiary text-text-primary hover:bg-bg-elevated active:scale-[0.99] transition-all"
            >
              Try again
            </button>
            <button
              onClick={handleClose}
              className="flex-1 py-3 rounded-xl font-semibold text-sm bg-banana text-black hover:brightness-110 active:scale-[0.99] transition-all"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
