# 👑 KingsHill — Digital Times Square

> *"Buy, bid, and conquer ad space in real time. Your influence, measured in GRAM."*

A Telegram Mini App where users claim advertising slots, get displaced for profit, and compete for visibility in a real-time financial ad auction. All balances are denominated in **GRAM**, which is simply the in-app name for **TON** — there is no separate token, no conversion, and no peg. Depositing TON credits your GRAM balance directly; withdrawing GRAM sends out the same TON.

---

## 🎯 How It Works

| Phase | Description |
|-------|-------------|
| **Occupy** | Pay GRAM to claim an ad slot for a chosen duration |
| **Challenge** | Anyone can outbid you by paying ≥X% above your current bid |
| **Profit** | When displaced: you receive your original stake + 80% of the premium |
| **Reset** | After your time expires un-challenged, the slot resets to base price |

**Platform earns:** 20% of each displacement premium + 5% fee on fresh slot claims.

**GRAM is TON.** It's not a separate coin pegged to TON — it's just what the app calls your TON balance. Deposit TON to a personal custody address to top up your balance; withdraw at any time back to any TON wallet.

---

## 🚀 Deployment Guide

### Step 1 — Set up Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** → run each file in `supabase/migrations/` **in order** (001 through 007)
3. Copy your **Project URL**, **anon key**, and **service role key** from Settings → API

### Step 2 — Create a Telegram Bot

1. Message [@BotFather](https://t.me/BotFather) → `/newbot` → copy the **bot token**
2. `/newapp` → set your Vercel URL as the Mini App URL (after deploying)
3. **Important:** users must press "Start" on your bot at least once before it can push them notifications — Telegram requires this.

### Step 2.5 — Make yourself an admin

Get your numeric Telegram ID (message [@userinfobot](https://t.me/userinfobot)) and run in Supabase SQL Editor:

```sql
insert into admins (telegram_id, label) values (123456789, 'Founder');
```

Admins see an extra **🛡 Admin** tab to review reports and remove any live ad.

### Step 3 — Set up the TON custody wallet

1. Generate a fresh 24-word mnemonic for a **new** wallet dedicated to this app — don't reuse a personal wallet (e.g. install Tonkeeper, create a new wallet, back up the seed phrase).
2. Fund it with a small operating float — keep most reserves elsewhere in cold storage and top up the hot wallet manually as needed.
3. Get a free API key at [toncenter.com](https://toncenter.com) — the public endpoint rate-limits hard without one.
4. Set `TON_WALLET_MNEMONIC` and `TON_API_KEY` in Vercel's environment variables only.

⚠️ **This is a hot wallet.** Anyone with the mnemonic can drain it. Treat Vercel's environment variable store as the single source of truth, restrict dashboard access, and consider a hardware-backed signer before meaningful volume.

### Step 4 — Deploy to Vercel

```bash
npm i -g vercel
cd kingshill
vercel
```

Set all variables from `.env.example` in Vercel → Settings → Environment Variables, including a freshly generated `CRON_SECRET` (`openssl rand -hex 32`).

### Step 5 — Wire up cron-job.org

Create three cron jobs at [cron-job.org](https://cron-job.org) (free tier is sufficient):

| Job | URL | Schedule |
|-----|-----|----------|
| Scan deposits | `https://your-app.vercel.app/api/cron/scan-deposits?secret=YOUR_CRON_SECRET` | every 2–5 min |
| Process withdrawals | `https://your-app.vercel.app/api/cron/process-withdrawals?secret=YOUR_CRON_SECRET` | every 5 min |
| Cleanup | `https://your-app.vercel.app/api/cron/cleanup?secret=YOUR_CRON_SECRET` | every 5 min |

All three are plain `GET` requests, so the query-param form of the secret shown above works on cron-job.org's free tier without custom headers.

### Step 6 — Wire up the Mini App in Telegram

```
BotFather → /mybots → [your bot] → Bot Settings → Menu Button → Configure Menu Button
URL: https://your-app.vercel.app
```

---

## 💰 TON Custody Wallet — How Deposits & Withdrawals Work

**Deposits:**
1. Each user gets a unique memo (`ensure_deposit_memo()`), shown in the Wallet tab's Deposit screen alongside the master wallet address.
2. User sends TON to that address with the memo as the transaction comment.
3. `scan-deposits` cron polls recent incoming transactions via TonCenter, matches the memo, and credits the deposited amount to the user's balance (`credit_deposit()` — idempotent on `tx_hash`, so re-scanning never double-credits).
4. Deposits sent without a matching memo are recorded as `unmatched` for manual admin reconciliation, surfaced in the cleanup cron's logs after 24h.

**Withdrawals:**
1. User requests a withdrawal in-app; `request_withdrawal()` immediately debits GRAM and queues the request.
2. `process-withdrawals` cron picks up pending requests, checks the master wallet's balance, and broadcasts the transfer via `sendTon()`.
3. On confirmation, `complete_withdrawal()` marks it done and a push notification is sent.
4. On failure, `fail_withdrawal()` refunds the user's GRAM balance automatically.
5. If confirmation times out, the withdrawal is left `processing` rather than retried blindly, and flagged after 10 minutes for manual review — this avoids the double-pay risk of retrying ambiguous on-chain state.

---

## 🔔 Push Notifications

Sent via the Telegram Bot API (`src/lib/notify.ts`) — no separate bot server process required, just a plain HTTPS call from inside the relevant API route:

- **Displaced from a slot** — fired when `place_bid` returns a `displaced_user_id`
- **Content removed by admin** — fired from `/api/admin/remove`
- **Deposit credited** — fired from the `scan-deposits` cron
- **Withdrawal completed / failed** — fired from the `process-withdrawals` cron

All sends are fire-and-forget so a Telegram API hiccup never blocks the underlying transaction.

---

## ⚡ Realtime

The board subscribes to Postgres changes on `occupancies` via Supabase Realtime (websocket) — bids, displacements, and admin removals appear instantly, no polling delay. A 30-second fallback poll remains as a safety net for dropped connections.

---

## 📸 Image Uploads

- Stored in a public Supabase Storage bucket (`ad-images`), 5MB limit, JPEG/PNG/WebP/GIF only
- All uploads go through `/api/upload`, which re-validates size, MIME type, **and** the actual file bytes (magic-number check) server-side
- Rate-limited per user (10 uploads/minute)
- Subject to the same content policy and admin takedown system as text ads

---

## 🚩 Content Moderation

- Every bid requires checking a content-policy agreement box before submitting
- Persistent warning: content infringing others' rights or otherwise illegal is removed immediately, the stake forfeited, and the user may bear personal legal liability
- Any user can report a live ad (🚩 button) — rate-limited, creates a row in `reports`
- Admins get a dedicated panel to review reports and remove any live ad with one tap; reason required; refund optional (default 0)
- Removals are flagged `removed_by_admin = true` with a `removal_reason`, kept in the `bid_history` audit trail
- Affected users get a push notification explaining what was removed and why

---

## 🛡 Operational Hardening

- **Rate limiting** — Postgres-backed fixed-window limiter, correct across concurrent serverless instances. Applied to bidding, reporting, auth, image upload, withdrawals, admin actions.
- **Structured logging** — every API route emits JSON log lines with route, status, timing, full error detail on failures. Captured by Vercel's log dashboard automatically.
- **Centralized error handling** — `withApiHandler()` wraps every route so unexpected errors are logged in detail server-side but never leak internals to the client.
- **Input validation** — shared helpers guard every route against malformed/missing/oversized input before it touches the database.
- **Idempotency where it matters** — deposit crediting is idempotent on `tx_hash`; withdrawal failures auto-refund instead of risking silent fund loss.
- **Cron-secret protection** — all `/api/cron/*` endpoints require a shared secret.
- **Stuck-state monitoring** — the cleanup cron flags stale unmatched deposits and stuck withdrawals in the logs for manual review rather than retrying blindly.

---

## 🪙 Currency

All in-app amounts are denominated in **GRAM** — this is purely a display name for **TON**, not a separate token. There is no conversion, no exchange rate, and no peg to manage: depositing TON increases your GRAM balance by the exact same amount, and withdrawing GRAM sends out that same TON. The custody wallet (`src/lib/ton-wallet.ts`) holds real TON throughout; "GRAM" only exists as a label in the UI and database column names.

---

## 🛠 Local Development

```bash
npm install
cp .env.example .env.local   # fill in values
npm run dev
```

For Telegram auth in dev, `initData = 'dev'` is accepted and creates a mock user. TON deposit/withdrawal testing requires real `TON_WALLET_MNEMONIC` + `TON_API_KEY`; consider TON **testnet** (`https://testnet.toncenter.com/api/v2/jsonRPC`) while developing this part.

---

## ⚠️ Known Limitations / Next Steps

- The hot-wallet-in-env approach is a reasonable starting point but not institutional-grade custody — migrate to a hardware-backed signer before meaningful volume.
- No automated test suite yet — recommend adding before scaling traffic materially.
- No external error-monitoring integration (Sentry, etc.) configured by default — the structured logger output is ready to pipe into one.
- Admins are managed by direct SQL insert only — no in-app admin management UI yet.
- No user ban/suspension system — repeated violators can have individual ads removed but not be blocked from bidding again.
