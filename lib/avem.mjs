import { timingSafeEqual } from 'node:crypto';

const ENDPOINT = 'https://api.avempay.com/v1/gateway/';
const digits = value => String(value || '').replace(/\D/g, '');

export class AvemError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// No credentials are embedded here. The existing production gateway is kept
// active until confirmation of paid transactions can be implemented end to end.
export async function createAvemPix({ apiKey, amount, client, callbackUrl }, fetcher = fetch) {
  if (!apiKey) throw new AvemError('gateway_not_configured', 'Pagamento não configurado.', 503);
  const value = Number(amount);
  const payer = {
    name: String(client?.name || '').trim(),
    document: digits(client?.document),
    telefone: digits(client?.phone),
    email: String(client?.email || '').trim()
  };
  if (!Number.isFinite(value) || value <= 0 || Math.abs(value * 100 - Math.round(value * 100)) > 0.000001 ||
      payer.name.split(/\s+/).length < 2 || !/^\d{11}$/.test(payer.document) ||
      /^(\d)\1{10}$/.test(payer.document) || !/^\d{10,11}$/.test(payer.telefone) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payer.email)) {
    throw new AvemError('invalid_payment_data', 'Confira os dados do pagador e o valor do pedido.', 400);
  }
  let callback;
  try {
    callback = new URL(callbackUrl);
    if (callback.protocol !== 'https:' || callback.username || callback.password) throw new Error();
  } catch {
    throw new AvemError('invalid_callback', 'Confirmação do pagamento não configurada.', 503);
  }
  let response;
  try {
    response = await fetcher(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ 'api-key': apiKey, amount: value, client: payer, callbackUrl: callback.href }),
      signal: AbortSignal.timeout(15000)
    });
  } catch {
    // v1 documents no idempotency key. Retrying an ambiguous request can create
    // another charge; the caller must not automatically retry this failure.
    throw new AvemError('payment_outcome_unknown', 'Não foi possível confirmar a criação do Pix. Consulte o atendimento antes de gerar outro.');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.status !== 'success') {
    // Never forward upstream bodies: they may contain credentials or payer data.
    throw new AvemError('avem_transaction_failed', 'A Avem não confirmou a criação da cobrança Pix.');
  }
  if (typeof data.paymentCode !== 'string' || !data.paymentCode.startsWith('000201') ||
      !/^[A-Za-z0-9_-]{8,160}$/.test(data.idTransaction || '')) {
    throw new AvemError('avem_invalid_response', 'A Avem não retornou os dados completos do Pix.');
  }
  return {
    copyPaste: data.paymentCode,
    qrCode: /^data:image\/png;base64,/.test(data.paymentCodeBase64 || '') ? data.paymentCodeBase64 : '',
    transactionId: data.idTransaction,
    gatewayTransactionId: data.idTransaction,
    orderId: data.idTransaction
  };
}

export function validateAvemWebhook({ secret, headers, body }) {
  if (!secret) throw new AvemError('webhook_not_configured', 'Webhook não configurado.', 503);
  const received = headers?.['x-webhook-secret'];
  const expected = Buffer.from(secret);
  const supplied = Buffer.from(typeof received === 'string' && received.length <= 512 ? received : '');
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    throw new AvemError('invalid_webhook_secret', 'Webhook não autorizado.', 401);
  }
  if (!body || !/^[A-Za-z0-9_-]{8,160}$/.test(body.idTransaction || '') || typeof body.status !== 'string') {
    throw new AvemError('invalid_webhook', 'Dados de webhook inválidos.', 400);
  }
  if (body.status !== 'paid') return { ignored: true };
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001) {
    throw new AvemError('invalid_amount', 'Valor inválido.', 400);
  }
  return { transactionId: body.idTransaction, status: 'paid', amountInCents: Math.round(amount * 100) };
}
