'use client';

import { useApp } from '@/lib/store';
import { formatGramsShort } from '@/lib/telegram';
import type { SlotWithOccupancy } from '@/types/database';
import { useCountdown } from '@/hooks/useCountdown';

function OwnedSlotRow({ slot }: { slot: SlotWithOccupancy }) {
  const { label: tl } = useCountdown(slot.current_occupancy?.expires_at);
  const occ = slot.current_occupancy!;
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-brand-surface border border-brand-border"
      style={{ borderColor: `${occ.ad_color ?? '#FFD700'}30` }}>
      <span className="text-2xl">{occ.ad_emoji}</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold text-brand-text truncate">{occ.ad_text}</p>
        <p className="text-[10px] text-brand-muted">{slot.name} · ⏱ {tl}</p>
      </div>
      <div className="text-right">
        <p className="text-xs font-bold text-brand-gold font-mono">{formatGramsShort(occ.bid_amount)} GRAM</p>
      </div>
    </div>
  );
}

export function ProfileTab() {
  const { state, showToast } = useApp();
  const { user, slots } = state;

  const ownedSlots = slots.filter(s => s.current_occupancy?.user_id === user?.id);
  const initials   = `${user?.first_name?.[0] ?? '?'}${user?.last_name?.[0] ?? ''}`.toUpperCase();

  const botUsername = process.env.NEXT_PUBLIC_BOT_USERNAME ?? 'KingsHillBot';
  const referralLink = user ? `https://t.me/${botUsername}?start=ref_${user.telegram_id}` : '';

  function copyReferralLink() {
    if (!referralLink) return;
    navigator.clipboard.writeText(referralLink).then(() => {
      showToast('Referral link copied!', 'success');
    });
  }

  function shareReferralLink() {
    if (!referralLink) return;
    const text = encodeURIComponent('Join KingsHill — bid on ad slots, earn when outbid. Real TON profits! 🚀');
    const url  = encodeURIComponent(referralLink);
    const shareUrl = `https://t.me/share/url?url=${url}&text=${text}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tg = (window as any).Telegram?.WebApp;
    if (tg?.openTelegramLink) {
      tg.openTelegramLink(shareUrl);
    } else {
      window.open(shareUrl, '_blank');
    }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="m-3 rounded-2xl bg-brand-surface border border-brand-border p-4">
        <div className="flex items-center gap-4">
          {user?.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.photo_url} alt="avatar" className="w-16 h-16 rounded-full object-cover ring-2 ring-brand-gold/30" />
          ) : (
            <div className="w-16 h-16 rounded-full bg-brand-gold/20 flex items-center justify-center text-brand-gold text-xl font-bold ring-2 ring-brand-gold/30">
              {initials}
            </div>
          )}
          <div>
            <h2 className="font-bold text-lg text-brand-text">
              {user?.first_name ?? ''} {user?.last_name ?? ''}
            </h2>
            {user?.username && (
              <p className="text-sm text-brand-muted">@{user.username}</p>
            )}
            <p className="text-xs text-brand-muted mt-0.5">
              Telegram ID: {user?.telegram_id}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 mt-4">
          {[
            { label: 'Balance',  value: `${formatGramsShort(user?.wallet ?? 0)} GRAM`,       color: 'text-brand-gold' },
            { label: 'Earned',   value: `${formatGramsShort(user?.total_earned ?? 0)} GRAM`, color: 'text-green-400' },
            { label: 'Active',   value: `${ownedSlots.length}`,                              color: 'text-blue-400' },
          ].map(s => (
            <div key={s.label} className="bg-brand-card rounded-xl p-2.5 text-center">
              <p className="text-[10px] text-brand-muted uppercase">{s.label}</p>
              <p className={`text-sm font-bold font-mono ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="px-3 pb-3">
        <p className="text-xs font-bold text-brand-muted uppercase tracking-wider mb-2">
          Your Active Slots ({ownedSlots.length})
        </p>
        {ownedSlots.length === 0 ? (
          <div className="text-center py-10 rounded-xl border border-dashed border-brand-border">
            <p className="text-3xl mb-2">🏴</p>
            <p className="text-sm text-brand-muted">No slots claimed yet</p>
            <p className="text-xs text-brand-muted mt-1">Head to the board and seize your territory</p>
          </div>
        ) : (
          <div className="space-y-2">
            {ownedSlots.map(s => <OwnedSlotRow key={s.id} slot={s} />)}
          </div>
        )}
      </div>

      {/* Referral section */}
      <div className="mx-3 mb-3 rounded-2xl border border-brand-border bg-brand-surface overflow-hidden">
        <div className="p-4 border-b border-brand-border">
          <p className="text-xs font-bold text-brand-muted uppercase tracking-wider mb-1">👥 Invite Friends</p>
          <p className="text-xs text-brand-muted leading-relaxed">
            Earn <span className="text-brand-gold font-bold">3 GRAM</span> when a friend you invite places their first bid.
            Bonus is spend-only (not withdrawable).
          </p>
        </div>

        <div className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-brand-card rounded-xl p-3 text-center">
              <p className="text-[10px] text-brand-muted uppercase">Friends Invited</p>
              <p className="text-lg font-bold text-brand-gold">{(user as any)?.referral_count ?? 0}</p>
            </div>
            <div className="bg-brand-card rounded-xl p-3 text-center">
              <p className="text-[10px] text-brand-muted uppercase">Bonus Earned</p>
              <p className="text-lg font-bold text-green-400">
                {formatGramsShort(((user as any)?.referral_count ?? 0) * 3)} GRAM
              </p>
            </div>
          </div>

          <div className="rounded-xl bg-brand-card border border-brand-border px-3 py-2.5 flex items-center gap-2">
            <p className="text-[10px] font-mono text-brand-muted flex-1 truncate">{referralLink}</p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={copyReferralLink}
              className="py-3 rounded-xl text-xs font-bold bg-brand-surface border border-brand-border text-brand-text"
            >
              📋 Copy Link
            </button>
            <button
              onClick={shareReferralLink}
              className="py-3 rounded-xl text-xs font-bold bg-brand-gold text-brand-dark"
            >
              📢 Share
            </button>
          </div>
        </div>
      </div>

      <div className="mx-3 mb-3 rounded-xl border border-red-900/40 bg-red-950/20 p-4">
        <p className="text-xs font-bold text-red-300 uppercase tracking-wider mb-2">⚠️ Content Policy & Legal</p>
        <p className="text-xs text-red-200/80 leading-relaxed">
          Don't post ads that infringe on someone else's rights (copyright, trademark, likeness, privacy)
          or that are otherwise illegal. Violating content is taken down immediately, without warning, and the
          stake behind it is forfeited. You may also be personally liable under the law for what you publish.
          Anyone can report a live ad using the 🚩 button, and our admins can remove any slot's content at any time.
        </p>
      </div>

      <div className="mx-3 mb-3 rounded-xl border border-brand-border bg-brand-surface p-3">
        <p className="text-xs font-bold text-brand-muted uppercase tracking-wider mb-1">Currency</p>
        <p className="text-xs text-brand-muted">
          All amounts on KingsHill are denominated in <span className="text-brand-gold font-bold">GRAM</span> —
          GRAM is simply TON's name inside this app. 1 GRAM is 1 TON, always.
        </p>
      </div>

      <div className="mx-3 mb-3 rounded-xl border border-brand-border bg-brand-surface p-4">
        <p className="text-xs font-bold text-brand-muted uppercase tracking-wider mb-3">How It Works</p>
        {[
          { emoji: '⚔️', title: 'Claim a Slot',        desc: 'Bid Grams to occupy any ad position on the board.' },
          { emoji: '📢', title: 'Your Ad Goes Live',    desc: 'Everyone in the app sees your message immediately.' },
          { emoji: '💰', title: 'Get Displaced = Profit', desc: 'When someone outbids you, you get your stake back plus 80% of their premium.' },
          { emoji: '🔄', title: 'Slots Reset',          desc: 'After your time expires with no new bid, the slot resets to base price.' },
        ].map(step => (
          <div key={step.title} className="flex gap-3 mb-3 last:mb-0">
            <span className="text-xl flex-shrink-0">{step.emoji}</span>
            <div>
              <p className="text-xs font-bold text-brand-text">{step.title}</p>
              <p className="text-xs text-brand-muted mt-0.5">{step.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
