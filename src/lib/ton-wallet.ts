import { TonClient, WalletContractV4, internal, fromNano, toNano, Address } from '@ton/ton';
import { mnemonicToPrivateKey } from '@ton/crypto';
import { logger } from '@/lib/logger';

/**
 * Custody wallet wrapper around @ton/ton. The master wallet's mnemonic
 * lives only in the server environment variable TON_WALLET_MNEMONIC —
 * it is never sent to the client, never logged, and never stored in
 * the database. Anyone with that mnemonic can drain the wallet, so:
 *
 *   - Set it only in Vercel's encrypted environment variable store.
 *   - Never print it, never include it in error messages.
 *   - Rotate it immediately if you suspect any exposure.
 *   - Consider a hardware-backed signer (Fireblocks, etc.) before
 *     real volume — this mnemonic-in-env approach is a reasonable
 *     starting point but is still a hot wallet with all the risk
 *     that implies. Keep float low, sweep profits to cold storage
 *     regularly.
 */

let cachedClient: TonClient | null = null;

function getClient(): TonClient {
  if (cachedClient) return cachedClient;

  const endpoint = process.env.TON_API_ENDPOINT || 'https://toncenter.com/api/v2/jsonRPC';
  const apiKey = process.env.TON_API_KEY; // TonCenter rate-limits hard without a key

  cachedClient = new TonClient({ endpoint, apiKey });
  return cachedClient;
}

async function getMasterWallet() {
  const mnemonic = process.env.TON_WALLET_MNEMONIC;
  if (!mnemonic) {
    throw new Error('TON_WALLET_MNEMONIC is not configured');
  }

  const words = mnemonic.trim().split(/\s+/);
  if (words.length !== 24) {
    throw new Error('TON_WALLET_MNEMONIC must be a 24-word mnemonic');
  }

  const keyPair = await mnemonicToPrivateKey(words);
  const wallet = WalletContractV4.create({ workchain: 0, publicKey: keyPair.publicKey });

  return { keyPair, wallet };
}

/** Returns the master wallet's address (safe to expose publicly — it's the deposit address). */
export async function getMasterWalletAddress(): Promise<string> {
  const { wallet } = await getMasterWallet();
  return wallet.address.toString({ bounceable: false });
}

export interface IncomingTx {
  hash: string;
  lt: string;
  fromAddress: string;
  amountNanoTon: string;
  memo: string | null;
  utime: number;
}

/**
 * Fetches recent incoming transactions to the master wallet. Used by
 * the deposit-scanning cron job. Returns only inbound transfers
 * (outgoing transfers, like our own withdrawals, are filtered out).
 */
export async function fetchIncomingTransactions(limit = 50): Promise<IncomingTx[]> {
  const client = getClient();
  const { wallet } = await getMasterWallet();

  const transactions = await client.getTransactions(wallet.address, { limit });

  const incoming: IncomingTx[] = [];

  for (const tx of transactions) {
    const inMsg = tx.inMessage;
    if (!inMsg || inMsg.info.type !== 'internal') continue; // skip external/outgoing

    const info = inMsg.info;
    const value = info.value.coins;
    if (value <= 0n) continue;

    let memo: string | null = null;
    try {
      if (inMsg.body) {
        const slice = inMsg.body.beginParse();
        if (slice.remainingBits >= 32) {
          const op = slice.loadUint(32);
          if (op === 0) {
            // op == 0 means a plain text comment per TON convention
            memo = slice.loadStringTail().trim();
          }
        }
      }
    } catch {
      memo = null;
    }

    incoming.push({
      hash: tx.hash().toString('hex'),
      lt: tx.lt.toString(),
      fromAddress: info.src.toString(),
      amountNanoTon: value.toString(),
      memo,
      utime: tx.now,
    });
  }

  return incoming;
}

/**
 * Sends TON from the master wallet to a destination address. Returns
 * the transaction's seqno-based identifier used to confirm inclusion.
 * Throws on any failure — caller is responsible for marking the
 * withdrawal failed and refunding the user's GRAM balance.
 */
export async function sendTon(toAddress: string, amountTon: number, comment?: string): Promise<{ seqno: number }> {
  const client = getClient();
  const { keyPair, wallet } = await getMasterWallet();
  const contract = client.open(wallet);

  const seqno = await contract.getSeqno();

  const destination = Address.parse(toAddress);

  await contract.sendTransfer({
    secretKey: keyPair.secretKey,
    seqno,
    messages: [
      internal({
        to: destination,
        value: toNano(amountTon.toFixed(9)),
        body: comment ?? 'KingsHill withdrawal',
        bounce: false,
      }),
    ],
  });

  logger.info('ton_withdrawal_broadcast', { toAddress, amountTon, seqno });

  return { seqno };
}

/** Polls until the wallet's seqno advances past the given value, confirming the tx landed. */
export async function waitForSeqno(targetSeqno: number, timeoutMs = 60000): Promise<boolean> {
  const client = getClient();
  const { wallet } = await getMasterWallet();
  const contract = client.open(wallet);

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const seqno = await contract.getSeqno();
    if (seqno > targetSeqno) return true;
    await new Promise(r => setTimeout(r, 3000));
  }
  return false;
}

export async function getMasterWalletBalance(): Promise<number> {
  const client = getClient();
  const { wallet } = await getMasterWallet();
  const balance = await client.getBalance(wallet.address);
  return Number(fromNano(balance));
}

export function isValidTonAddress(address: string): boolean {
  try {
    Address.parse(address);
    return true;
  } catch {
    return false;
  }
}
