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

UTMify reporting remains deferred. Meta Purchase is sent directly by the server after an authenticated paid receipt; see configuration below.

## Verification

npm test runs local gateway/Redis mocks without creating a real charge. It checks the request/response mapping, authentication, order values, idempotency, webhook timing, failures and pending-to-paid confirmation.

A real Pix test requires the real details of an authorized payer; local fixtures must never be sent to the live gateway. No payment is made by the implementation or tests.

If Avem fails to deliver a webhook, automatic status can remain pending: its documentation says there is no automatic retry. Investigate in the gateway and obtain an official redelivery or transaction-status route; never approve an order from a customer-supplied claim.


## Meta Purchase

O webhook autenticado agenda `Purchase` somente para recibos `paid` cujo valor e ID correspondem ao pedido persistido. O pixel é 1096982006197307. O envio usa a API de Conversões v24.0, valor em reais e BRL. E-mail, telefone e campos de nome/endereço são normalizados e SHA-256; CPF não é enviado. IP e navegador são capturados na criação, nunca do servidor da Avem. Cookies fbp/fbc disponíveis seguem sem hash.

Configure META_ACCESS_TOKEN, META_PIXEL_ID e CRON_SECRET exclusivamente nas variáveis protegidas da Vercel. O token não é incluído no HTML, retorno da API ou Git.

A fila Redis é criada antes de confirmar o recebimento do callback. Envios aceitos têm marcador persistente e event_id estável `avem:purchase:<idTransaction>`; erros ou timeout conservam o mesmo ID e horário nas retentativas. O checkout, callbacks duplicados e o cron diário autenticado tentam novamente. A Meta é independente da confirmação financeira. Eventos de mais de seis dias não são reenviados. Não configure um segundo Purchase via UTMify/IronPay para a mesma compra sem compartilhar esse event_id.

Pix avulso de teste sem pedido não é convertido em compra atribuída a cliente. Os testes são simulados e não geram conversões reais no pixel.

Validation: 20 automated tests pass, including confirmed payments, duplicate callbacks, Meta timeouts and retries.
