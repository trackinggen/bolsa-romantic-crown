const RETENTION = 90 * 86400;
export const validTransactionId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{8,160}$/.test(value);
export const orderKey = id => 'avem:order:' + id;
export const paidKey = id => 'avem:paid:' + id;

class PaymentStoreError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.code = code;
    this.status = 503;
    this.details = details;
  }
}

const supabaseUrl = () => process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';
const usingSupabase = () => Boolean(supabaseUrl() && supabaseKey());
const TABLE = 'payment_records';
const QUEUE = 'payment_queue';

async function supabaseRequest(path, options = {}) {
  const key = supabaseKey();
  let response;
  try {
    response = await fetch(supabaseUrl().replace(/\/$/, '') + '/rest/v1/' + path, {
      ...options,
      headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', ...(options.headers || {}) },
      signal: AbortSignal.timeout(5000)
    });
  } catch (error) {
    throw new PaymentStoreError('supabase_network_error', { networkError: error?.name || 'unknown' });
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new PaymentStoreError('supabase_unavailable', { upstreamStatus: response.status });
  return data;
}

async function supabaseCommand(args) {
  const [operation, queue, score, id, ...tail] = args;
  if (operation === 'ZADD') {
    await supabaseRequest(QUEUE + '?on_conflict=queue,record_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ queue, record_id: id, due_at: new Date(Number(score)).toISOString() }) });
    return 1;
  }
  if (operation === 'ZREM') {
    await supabaseRequest(QUEUE + '?queue=eq.' + encodeURIComponent(queue) + '&record_id=eq.' + encodeURIComponent(score), { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    return 1;
  }
  if (operation === 'ZRANGEBYSCORE') {
    const at = tail.indexOf('LIMIT');
    const limit = at >= 0 ? Number(tail[at + 2]) : 25;
    const rows = await supabaseRequest(QUEUE + '?queue=eq.' + encodeURIComponent(queue) + '&due_at=lte.' + encodeURIComponent(new Date(Number(id)).toISOString()) + '&select=record_id&order=due_at.asc&limit=' + Math.min(Math.max(limit, 1), 100));
    return Array.isArray(rows) ? rows.map(row => row.record_id) : [];
  }
  throw new PaymentStoreError('unsupported_store_command');
}

export function storeReady() {
  return usingSupabase() || Boolean((process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL) &&
    (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN));
}

export async function command(args) {
  if (usingSupabase()) return supabaseCommand(args);
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new PaymentStoreError('store_not_configured');
  let response;
  try {
    response = await fetch(url.replace(/\/$/, ''), {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(3000)
    });
  } catch (error) {
    throw new PaymentStoreError('store_network_error', { networkError: error?.name || 'unknown' });
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.error) {
    throw new PaymentStoreError('store_unavailable', {
      upstreamStatus: response.status,
      upstreamError: typeof data?.error === 'string' ? data.error.slice(0, 80) : 'missing'
    });
  }
  return data.result;
}

export async function readRecord(key) {
  if (usingSupabase()) {
    const rows = await supabaseRequest(TABLE + '?key=eq.' + encodeURIComponent(key) + '&select=value,expires_at&limit=1');
    const row = Array.isArray(rows) ? rows[0] : null;
    return row && Date.parse(row.expires_at) > Date.now() ? row.value : null;
  }
  const value = await command(['GET', key]);
  return value ? JSON.parse(value) : null;
}

export async function saveRecord(key, value, { onlyIfNew = false, ttl = RETENTION } = {}) {
  if (usingSupabase()) {
    const rows = await supabaseRequest(TABLE + '?on_conflict=key', {
      method: 'POST',
      headers: { Prefer: (onlyIfNew ? 'resolution=ignore-duplicates' : 'resolution=merge-duplicates') + ',return=representation' },
      body: JSON.stringify({ key, value, expires_at: new Date(Date.now() + ttl * 1000).toISOString() })
    });
    return onlyIfNew ? Array.isArray(rows) && rows.length === 1 : true;
  }
  return command(['SET', key, JSON.stringify(value), ...(onlyIfNew ? ['NX'] : []), 'EX', ttl]);
}

export function resolveStatus(order, receipt) {
  if (receipt?.status === 'paid' && receipt.amountInCents === order.amountInCents) {
    return { status: 'paid', transactionId: order.transactionId, paidAt: receipt.paidAt };
  }
  return { status: 'pending', transactionId: order.transactionId, paidAt: null };
}
