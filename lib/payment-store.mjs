const RETENTION = 90 * 86400;
export const validTransactionId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{8,160}$/.test(value);
export const orderKey = id => 'avem:order:' + id;
export const paidKey = id => 'avem:paid:' + id;

export function storeReady() {
  return Boolean((process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL) &&
    (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN));
}

export async function command(args) {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('store_not_configured');
  const response = await fetch(url.replace(/\/$/, ''), {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(3000)
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error('store_unavailable');
  return data.result;
}

export async function readRecord(key) {
  const value = await command(['GET', key]);
  return value ? JSON.parse(value) : null;
}

export function saveRecord(key, value, { onlyIfNew = false, ttl = RETENTION } = {}) {
  return command(['SET', key, JSON.stringify(value), ...(onlyIfNew ? ['NX'] : []), 'EX', ttl]);
}

export function resolveStatus(order, receipt) {
  if (receipt?.status === 'paid' && receipt.amountInCents === order.amountInCents) {
    return { status: 'paid', transactionId: order.transactionId, paidAt: receipt.paidAt };
  }
  return { status: 'pending', transactionId: order.transactionId, paidAt: null };
}
