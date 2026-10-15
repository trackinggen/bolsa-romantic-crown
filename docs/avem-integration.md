# Avem Pay checkout

## Flow

- Set PAYMENT_GATEWAY=avem to enable the new backend. Omitting it keeps IronPay available as a rollback.
- The checkout sends the actual handbag quantity/color, selected optional add-ons and shipping method.
- The server recalculates the basket price, validates the payer and address, and obtains Pix with the documented v1 endpoint. Amounts sent to Avem are in reais; the phone field is client.telefone.
- A stable browser request ID and Redis SET NX prevent duplicate charges on retries and double-clicks. A timeout with an unknown result is not automatically resent to Avem.
- The callback URL is /api/public/pix/webhook. Only a POST with the exact X-Webhook-Secret can record paid.
- Authenticated receipts are stored independently so a webhook arriving before the creation response cannot be overwritten. Status compares the received value with the original order.
- The browser polls /api/public/pix/status and redirects an approved payment to /pedido-confirmado.
- Mandatory-fee upsells are not enabled for Avem.

## Protected Vercel configuration

PAYMENT_GATEWAY=avem
AVEM_API_KEY
AVEM_WEBHOOK_SECRET
AVEM_CALLBACK_URL=https://bolsa-romantic-crown.vercel.app/api/public/pix/webhook

Use UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN, or KV_REST_API_URL + KV_REST_API_TOKEN from the authorized free Upstash integration. Never commit real secrets.

Private order records include the buyer/contact, shipping address, actual basket, captured attribution, amount and timestamps. They expire after 90 days. Pix request deduplication records expire after 24 hours. The public status endpoint returns only status, transaction ID and paidAt; no customer fields.

The UTMify/Meta Purchase integration is deferred at the user's request. No direct Purchase sender is added.

## Verification

npm test runs local gateway/Redis mocks without creating a real charge. It checks the request/response mapping, authentication, order values, idempotency, webhook timing, failures and pending-to-paid confirmation.

A real Pix test requires the real details of an authorized payer; local fixtures must never be sent to the live gateway. No payment is made by the implementation or tests.

If Avem fails to deliver a webhook, automatic status can remain pending: its documentation says there is no automatic retry. Investigate in the gateway and obtain an official redelivery or transaction-status route; never approve an order from a customer-supplied claim.
