'use client';

import { useState, useEffect } from 'react';
import type { SlotWithOccupancy } from '@/types/database';
import { useApp } from '@/lib/store';
import { formatGramsShort, timeLeft, adImageUrl } from '@/lib/telegram';
import clsx from 'clsx';

const EMOJIS = ['🔥', '⚡', '🚀', '💎', '👑', '🌟', '💰', '🎯', '🏆', '✨', '🦁', '🎪', '🌈', '🎸', '🍀'];
const COLORS  = ['#FFD700', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4', '#10B981', '#EC4899', '#F97316'];
const DURATIONS = [1, 6, 12, 24, 48, 72];

interface Props {
  slot:    SlotWithOccupancy;
  onClose: () => void;
}

export function BidModal({ slot, onClose }: Props) {
  const { state, dispatch, refreshSlots, refreshWallet, showToast } = useApp();
  const [bidAmount, setBidAmount] = useState('');
  const [adText,    setAdText]    = useState('');
  const [adUrl,     setAdUrl]     = useState('');
  const [adEmoji,   setAdEmoji]   = useState('🔥');
  const [adColor,   setAdColor]   = useState('#FFD700');
  const [duration,  setDuration]  = useState(1);
  const [loading,   setLoading]   = useState(false);
  const [timeStr,   setTimeStr]   = useState('');
  const [agreed,    setAgreed]    = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reportSending, setReportSending] = useState(false);
  const [imageFile,  setImageFile]  = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imagePath,  setImagePath]  = useState<string | null>(null);
  const [uploading,  setUploading]  = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const occ = slot.current_occupancy;
  const minBid = slot.min_bid;
  const amount = parseFloat(bidAmount) || 0;
  const isValid = amount >= minBid && adText.trim().length > 0 && agreed && !uploading;
  const isOwner = occ?.user_id === state.user?.id;

  useEffect(() => {
    setBidAmount(minBid.toFixed(4));
  }, [minBid]);

  useEffect(() => {
    if (!occ) return;
    const u = () => setTimeStr(timeLeft(occ.expires_at));
    u();
    const i = setInterval(u, 1000);
    return () => clearInterval(i);
  }, [occ]);

  async function handleReport() {
    if (!occ || !reportReason.trim()) return;
    setReportSending(true);
    try {
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          occupancyId: occ.id,
          reporterId:  state.user?.id ?? null,
          reason:      reportReason.trim(),
        }),
      });
      if (res.ok) {
        showToast('Report sent. Our team will review it shortly.', 'success');
        setShowReport(false);
        setReportReason('');
      } else {
        showToast('Failed to send report', 'error');
      }
    } finally {
      setReportSending(false);
    }
  }

  async function handleImageSelect(file: File) {
    setUploadError(null);

    if (file.size > 5 * 1024 * 1024) {
      setUploadError('Image must be under 5MB');
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
      setUploadError('Use JPEG, PNG, WebP, or GIF');
      return;
    }

    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    setImagePath(null);

    if (!state.user) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('userId', state.user.id);
      formData.append('file', file);

      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();

      if (!res.ok) {
        setUploadError(data.error ?? 'Upload failed');
        setImageFile(null);
        setImagePreview(null);
      } else {
        setImagePath(data.path);
      }
    } catch {
      setUploadError('Upload failed — check your connection');
      setImageFile(null);
      setImagePreview(null);
    } finally {
      setUploading(false);
    }
  }

  function clearImage() {
    setImageFile(null);
    setImagePreview(null);
    setImagePath(null);
    setUploadError(null);
  }

  async function handleBid() {
    if (!state.user || !isValid) return;
    setLoading(true);
    try {
      const res = await fetch('/api/bid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId:        state.user.id,
          slotId:        slot.id,
          bidAmount:     amount,
          durationHours: duration,
          adText:        adText.trim(),
          adUrl:         adUrl.trim() || null,
          adEmoji,
          adColor,
          adImagePath: imagePath,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        showToast(data.error ?? 'Bid failed', 'error');
      } else {
        showToast(
          occ
            ? `You seized "${slot.name}"! ${occ ? 'Previous holder gets their refund.' : ''}`
            : `You claimed "${slot.name}"! Your ad is live.`,
          'success'
        );
        if (data.user) {
          dispatch({ type: 'UPDATE_USER_WALLET', wallet: data.user.wallet, withdrawable_balance: data.user.withdrawable_balance, total_earned: data.user.total_earned, total_spent: data.user.total_spent });
        }
        await refreshSlots();
        await refreshWallet();
        onClose();
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full bg-brand-card rounded-t-2xl border-t border-brand-border max-h-[90vh] overflow-y-auto">
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-brand-border rounded-full" />
        </div>

        <div className="px-4 pb-6">
          {/* Header */}
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="font-bold text-lg text-brand-text">{slot.name}</h2>
              <span className={clsx('text-xs font-bold px-2 py-0.5 rounded', `tier-${slot.tier}`)}>
                {slot.tier.toUpperCase()}
              </span>
            </div>
            <button onClick={onClose} className="text-brand-muted text-xl p-1">×</button>
          </div>

          {/* Current state */}
          {occ ? (
            <div className="rounded-xl border border-brand-border bg-brand-surface p-3 mb-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-brand-muted">Currently held by</span>
                {isOwner && <span className="text-xs text-brand-gold font-bold">← That's YOU</span>}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xl">{occ.ad_emoji}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-brand-text">{occ.ad_text ?? '—'}</p>
                  <p className="text-xs text-brand-muted font-mono">
                    {formatGramsShort(occ.bid_amount)} GRAM bid · {timeStr} left
                  </p>
                </div>
                {occ.ad_image_path && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={adImageUrl(occ.ad_image_path) ?? ''}
                    alt=""
                    className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
                  />
                )}
              </div>
              {!isOwner && (
                <div className="mt-2 text-xs text-green-400 bg-green-950/40 rounded-lg p-2 border border-green-900/40">
                  💡 Displace them → they get refund + profit. You get the spotlight.
                </div>
              )}
              {!isOwner && (
                <button
                  onClick={() => setShowReport(true)}
                  className="mt-2 text-xs text-red-400/80 hover:text-red-300 underline"
                >
                  🚩 Report this ad for illegal or rights-infringing content
                </button>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-brand-gold/20 bg-brand-gold/5 p-3 mb-4 text-center">
              <p className="text-sm text-brand-gold font-medium">✦ This slot is unclaimed</p>
              <p className="text-xs text-brand-muted mt-0.5">Be the first to plant your flag</p>
            </div>
          )}

          {/* Bid amount */}
          <div className="mb-4">
            <label className="text-xs font-bold text-brand-muted uppercase tracking-wider block mb-1.5">
              Your Bid (GRAM)
            </label>
            <div className="relative">
              <input
                type="number"
                value={bidAmount}
                onChange={e => setBidAmount(e.target.value)}
                step="0.0001"
                min={minBid}
                className={clsx(
                  'w-full bg-brand-surface border rounded-xl px-4 py-3 text-lg font-bold font-mono text-brand-text outline-none',
                  amount >= minBid ? 'border-brand-gold/40 focus:border-brand-gold' : 'border-red-500/40',
                )}
                placeholder={minBid.toFixed(4)}
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-brand-gold font-bold text-sm">GRAM</span>
            </div>
            <div className="flex items-center justify-between mt-1">
              <p className="text-xs text-brand-muted">
                Min: <span className="text-brand-gold font-mono">{minBid.toFixed(4)} GRAM</span>
                {occ && <span className="ml-1 text-brand-muted">({slot.min_increment_pct}% above current)</span>}
              </p>
              <p className="text-xs text-brand-muted">
                Balance: <span className="text-brand-text font-mono">{formatGramsShort(state.user?.wallet ?? 0)} GRAM</span>
              </p>
            </div>
            {/* Quick add buttons */}
            <div className="flex gap-2 mt-2">
              {['+0.01', '+0.1', '+1', '×2'].map(label => (
                <button
                  key={label}
                  onClick={() => {
                    const cur = parseFloat(bidAmount) || minBid;
                    if (label === '×2') setBidAmount((cur * 2).toFixed(4));
                    else setBidAmount((cur + parseFloat(label.slice(1))).toFixed(4));
                  }}
                  className="flex-1 text-xs py-1.5 bg-brand-surface border border-brand-border rounded-lg text-brand-muted hover:text-brand-gold hover:border-brand-gold/40 transition-colors"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Duration */}
          <div className="mb-4">
            <label className="text-xs font-bold text-brand-muted uppercase tracking-wider block mb-1.5">
              Occupancy Duration
            </label>
            <div className="grid grid-cols-6 gap-1.5">
              {DURATIONS.map(h => (
                <button
                  key={h}
                  onClick={() => setDuration(h)}
                  className={clsx(
                    'py-2 rounded-lg text-xs font-bold transition-all',
                    duration === h
                      ? 'bg-brand-gold text-brand-dark'
                      : 'bg-brand-surface border border-brand-border text-brand-muted'
                  )}
                >
                  {h}h
                </button>
              ))}
            </div>
          </div>

          {/* Ad text */}
          <div className="mb-4">
            <label className="text-xs font-bold text-brand-muted uppercase tracking-wider block mb-1.5">
              Ad Message <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={adText}
              onChange={e => setAdText(e.target.value.slice(0, 60))}
              maxLength={60}
              placeholder="Your message (60 chars max)"
              className="w-full bg-brand-surface border border-brand-border focus:border-brand-gold/40 rounded-xl px-4 py-3 text-sm text-brand-text outline-none"
            />
            <p className="text-xs text-brand-muted mt-1 text-right">{adText.length}/60</p>
          </div>

          {/* Ad URL */}
          <div className="mb-4">
            <label className="text-xs font-bold text-brand-muted uppercase tracking-wider block mb-1.5">
              Link (optional)
            </label>
            <input
              type="url"
              value={adUrl}
              onChange={e => setAdUrl(e.target.value)}
              placeholder="https://t.me/yourchannel"
              className="w-full bg-brand-surface border border-brand-border focus:border-brand-gold/40 rounded-xl px-4 py-3 text-sm text-brand-text outline-none"
            />
          </div>

          {/* Image upload */}
          <div className="mb-4">
            <label className="text-xs font-bold text-brand-muted uppercase tracking-wider block mb-1.5">
              Image (optional)
            </label>
            {imagePreview ? (
              <div className="relative rounded-xl overflow-hidden border border-brand-border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imagePreview} alt="Ad preview" className="w-full h-32 object-cover" />
                {uploading && (
                  <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                    <span className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  </div>
                )}
                <button
                  onClick={clearImage}
                  className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/70 text-white text-sm flex items-center justify-center"
                >
                  ×
                </button>
                {imagePath && (
                  <span className="absolute bottom-2 left-2 text-[10px] bg-green-900/80 text-green-300 px-2 py-0.5 rounded-full">
                    ✓ Uploaded
                  </span>
                )}
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center gap-1.5 h-24 rounded-xl border border-dashed border-brand-border bg-brand-surface cursor-pointer">
                <span className="text-xl opacity-50">📷</span>
                <span className="text-xs text-brand-muted">Tap to upload (max 5MB)</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) handleImageSelect(f);
                  }}
                />
              </label>
            )}
            {uploadError && <p className="text-xs text-red-400 mt-1.5">{uploadError}</p>}
            <p className="text-[10px] text-brand-muted mt-1.5">
              Images are public and subject to the content policy below — illegal or rights-infringing
              images are removed immediately.
            </p>
          </div>

          {/* Emoji picker */}
          <div className="mb-4">
            <label className="text-xs font-bold text-brand-muted uppercase tracking-wider block mb-1.5">
              Icon
            </label>
            <div className="flex flex-wrap gap-2">
              {EMOJIS.map(e => (
                <button
                  key={e}
                  onClick={() => setAdEmoji(e)}
                  className={clsx(
                    'w-9 h-9 rounded-lg text-xl transition-all',
                    adEmoji === e ? 'bg-brand-gold/20 ring-1 ring-brand-gold' : 'bg-brand-surface'
                  )}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          {/* Color picker */}
          <div className="mb-6">
            <label className="text-xs font-bold text-brand-muted uppercase tracking-wider block mb-1.5">
              Brand Color
            </label>
            <div className="flex gap-2 flex-wrap">
              {COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setAdColor(c)}
                  className={clsx(
                    'w-8 h-8 rounded-full transition-all border-2',
                    adColor === c ? 'border-white scale-110' : 'border-transparent'
                  )}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>

          {/* Preview */}
          {adText && (
            <div className="mb-4 rounded-xl p-3 border" style={{ borderColor: `${adColor}44`, background: `${adColor}11` }}>
              <p className="text-xs text-brand-muted mb-1.5">Preview</p>
              <div className="flex items-center gap-2">
                <span className="text-2xl">{adEmoji}</span>
                <div>
                  <p className="font-bold text-sm" style={{ color: adColor }}>{adText}</p>
                  {adUrl && <p className="text-xs text-brand-muted truncate">{adUrl}</p>}
                </div>
              </div>
            </div>
          )}

          {/* Legal notice */}
          <div className="mb-3 rounded-xl border border-red-900/40 bg-red-950/20 p-3">
            <p className="text-xs font-bold text-red-300 mb-1">⚠️ Content Policy</p>
            <p className="text-[11px] text-red-200/80 leading-relaxed">
              Do not upload content that infringes on someone else's rights (copyright, trademark, likeness, privacy)
              or that is illegal under applicable law. Violating content is removed immediately without warning,
              and your stake for that slot is forfeited — not refunded. Depending on jurisdiction, you may also
              face legal liability for content you publish here. By bidding, you confirm the content is yours to use
              and lawful to display.
            </p>
          </div>

          <label className="flex items-start gap-2.5 mb-4 cursor-pointer">
            <input
              type="checkbox"
              checked={agreed}
              onChange={e => setAgreed(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded accent-brand-gold flex-shrink-0"
            />
            <span className="text-xs text-brand-muted leading-relaxed">
              I confirm this content does not violate anyone's rights and is lawful. I understand it may be
              removed immediately and my stake forfeited if it isn't.
            </span>
          </label>

          {/* CTA */}
          <button
            onClick={handleBid}
            disabled={!isValid || loading || (state.user?.wallet ?? 0) < amount}
            className={clsx(
              'w-full py-4 rounded-xl font-bold text-base transition-all',
              isValid && !loading && (state.user?.wallet ?? 0) >= amount
                ? 'bg-brand-gold text-brand-dark hover:bg-yellow-400 active:scale-[0.98]'
                : 'bg-brand-surface text-brand-muted cursor-not-allowed'
            )}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-brand-dark/30 border-t-brand-dark rounded-full animate-spin" />
                Placing Bid...
              </span>
            ) : (state.user?.wallet ?? 0) < amount ? (
              'Insufficient Balance'
            ) : !adText ? (
              'Enter Ad Message'
            ) : !agreed ? (
              'Confirm Content Policy Above'
            ) : amount < minBid ? (
              `Minimum bid: ${minBid.toFixed(4)} GRAM`
            ) : occ ? (
              `⚔️ Seize for ${amount.toFixed(4)} GRAM`
            ) : (
              `🚀 Claim for ${amount.toFixed(4)} GRAM`
            )}
          </button>

          <p className="text-[10px] text-center text-brand-muted mt-2">
            20% platform fee on premium earned when you're displaced
          </p>
        </div>
      </div>

      {/* Report sub-modal */}
      {showReport && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center modal-backdrop p-4" onClick={(e) => e.target === e.currentTarget && setShowReport(false)}>
          <div className="w-full max-w-sm bg-brand-card rounded-2xl border border-brand-border p-4">
            <p className="font-bold text-sm text-brand-text mb-1">🚩 Report this ad</p>
            <p className="text-xs text-brand-muted mb-3">
              Tell us why this content may infringe rights or break the law. Our team reviews reports
              and removes violating content immediately.
            </p>
            <textarea
              value={reportReason}
              onChange={e => setReportReason(e.target.value.slice(0, 300))}
              placeholder="e.g. uses my copyrighted image without permission..."
              rows={3}
              className="w-full bg-brand-surface border border-brand-border rounded-xl px-3 py-2.5 text-sm text-brand-text outline-none resize-none"
            />
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => setShowReport(false)}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-brand-surface text-brand-muted"
              >
                Cancel
              </button>
              <button
                onClick={handleReport}
                disabled={!reportReason.trim() || reportSending}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-red-600 text-white disabled:opacity-40"
              >
                {reportSending ? 'Sending...' : 'Submit Report'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
