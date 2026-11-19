import { createHash } from 'node:crypto';
import { AvemError } from './avem.mjs';

const fail = (code, message) => { throw new AvemError(code, message, 400); };
const digits = value => String(value || '').replace(/\D/g, '');

export function validCpf(cpf) {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  for (let length = 9; length < 11; length++) {
    let sum = 0;
    for (let i = 0; i < length; i++) sum += Number(cpf[i]) * (length + 1 - i);
    if (((sum * 10) % 11) % 10 !== Number(cpf[length])) return false;
  }
  return true;
}

export function parseOrder(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('invalid_payment_data', 'Confira os dados do pedido.');
  if (!/^[a-f0-9-]{32,64}$/i.test(body.requestId || '')) fail('invalid_request_id', 'Atualize a página e tente novamente.');
  const product = body.products?.[0];
  if (body.products?.length !== 1 || product?.name !== 'GRAND_THEFT_AUTO_VI') fail('invalid_product', 'Produto indisponível neste pagamento.');
  const qty = Number(product.quantity);
  const format = product.variant;
  const platform = product.platform;
  if (!Number.isInteger(qty) || qty < 1 || qty > 20 || !['Fisica','Digital'].includes(format) || !['PS5','XBOX'].includes(platform)) fail('invalid_product', 'Confira a plataforma, quantidade e formato.');
  const catalog = {
    'camiseta-gta-vi': { name: 'Camiseta GTA VI', priceInCents: 1990, format: 'Fisica' },
    'bone-gta-vi': { name: 'Boné GTA VI', priceInCents: 2990, format: 'Fisica' },
    'gta-plus-mes-1': { name: '1º mês de GTA+', priceInCents: 2990, format: 'Digital' },
    'pacote-vintage-vice-city': { name: 'Pacote Vintage Vice City', priceInCents: 6990, format: 'Digital' }
  };
  const bumpIds = body.bumpIds || [];
  if (!Array.isArray(bumpIds) || bumpIds.length > 2 || new Set(bumpIds).size !== bumpIds.length ||
    bumpIds.some(id => typeof id !== 'string' || !Object.hasOwn(catalog,id) || catalog[id].format !== format)) fail('invalid_product', 'Confira as ofertas do pedido.');
  const physicalPrices = { PAC: 0, 'PAC - FRETE GRÁTIS': 0, JADLOG: 1847, 'SEDEX 12': 3340 };
  const digital = format === 'Digital';
  const prices = digital ? { 'Envio imediato': 0 } : physicalPrices;
  if (typeof body.shippingMethod !== 'string' || !Object.hasOwn(prices,body.shippingMethod)) fail('invalid_shipping', 'Selecione uma opção de frete.');
  const products = [{ id: 'GRAND_THEFT_AUTO_VI', name: 'Grand Theft Auto VI para '+platform+' - '+format, quantity: qty, priceInCents: 24700, variant: format, platform },
    ...bumpIds.map(id => ({ id, ...catalog[id], quantity: 1 }))];
  const amountInCents = products.reduce((total,p) => total+p.priceInCents*p.quantity,prices[body.shippingMethod]);
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || Math.abs(amount*100-amountInCents)>0.000001) fail('invalid_amount', 'O total foi alterado. Confira o pedido antes de gerar o Pix.');
  const input=body.client||{};
  const client={name:String(input.name||'').trim().slice(0,160),email:String(input.email||'').trim().toLowerCase().slice(0,254),
    document:digits(input.document),phone:digits(input.phone)};
  if (!validCpf(client.document)) fail('invalid_document','Informe um CPF válido.');
  if (client.name.split(/\s+/).length<2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(client.email) || !/^\d{10,11}$/.test(client.phone)) fail('invalid_payment_data','Confira nome, e-mail e telefone do pagador.');
  const address={};
  for(const field of ['cep','logradouro','numero','complemento','bairro','cidade','uf']) address[field]=String(body.shipping?.[field]||'').trim().slice(0,200);
  address.cep=digits(address.cep); address.uf=address.uf.toUpperCase();
  const needsAddress = !digital || bumpIds.length > 0;
  if(needsAddress && (address.cep.length!==8 || !address.logradouro || !address.numero || !address.bairro || !address.cidade || !/^[A-Z]{2}$/.test(address.uf))) fail('invalid_shipping','Confira o endereço de entrega.');
  const tracking={};
  for(const key of ['source','medium','campaign','content','term','src','sck','fbclid','gclid','ttclid','xcod']) tracking[key]=String(body.utm?.[key]||'').slice(0,2000);
  return {amountInCents,client,shipping:{...address,method:body.shippingMethod,priceInCents:prices[body.shippingMethod]},products,tracking};
}

export function orderFingerprint(order) {
  const {tracking,meta,...payment}=order;
  return createHash('sha256').update(JSON.stringify(payment)).digest('hex');
}
