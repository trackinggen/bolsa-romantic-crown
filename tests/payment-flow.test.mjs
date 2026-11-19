import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPayment, getPaymentStatus, receiveWebhook } from '../lib/avem-routes.mjs';
import { parseOrder, validCpf } from '../lib/payment-order.mjs';

const transaction='test_transaction_123';
const body=()=>({
 requestId:'1234567890abcdef1234567890abcdef',amount:247.00,
 client:{name:'Teste Local',email:'teste@example.com',document:'12345678909',phone:'11999999999'},
 products:[{name:'GRAND_THEFT_AUTO_VI',quantity:1,variant:'Fisica',platform:'PS5'}],
 shippingMethod:'PAC - FRETE GRÁTIS',bumpIds:[],
 shipping:{cep:'01001000',logradouro:'Rua de teste',numero:'1',bairro:'Centro',cidade:'Teste',uf:'SP'},
 utm:{source:'FB',campaign:'test-campaign'}
});
function response(){
 return {code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(value){this.body=value;return this;}};
}
function setup(t){
 const names=['AVEM_API_KEY','AVEM_WEBHOOK_SECRET','AVEM_CALLBACK_URL','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN'];
 const previous=names.map(k=>process.env[k]);
 const values=['test-key','test-secret','https://example.com/webhook','https://redis.example.com','test-redis-token'];
 names.forEach((k,i)=>process.env[k]=values[i]);
 t.after(()=>names.forEach((k,i)=>previous[i]===undefined?delete process.env[k]:process.env[k]=previous[i]));
 const records=new Map();
 const state={records,creates:0,storeFailed:false,earlyWebhook:false,gate:null,metaCalls:0,metaReject:false};
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  if(url==='https://redis.example.com'){
   if(state.storeFailed)throw new Error('storage offline');
   const [cmd,key,value,...flags]=JSON.parse(options.body);
   if(cmd==='ZADD'||cmd==='ZREM')return Response.json({result:1});
   if(cmd==='GET')return Response.json({result:records.get(key)||null});
   if(cmd==='SET'){
    if(flags.includes('NX')&&records.has(key))return Response.json({result:null});
    records.set(key,value);return Response.json({result:'OK'});
   }
   assert.fail('unexpected redis command '+cmd);
  }
  if(String(url).startsWith('https://graph.facebook.com/')){
   state.metaCalls++;
   return state.metaReject?Response.json({error:{code:190}},{status:400}):Response.json({events_received:1});
  }
  assert.equal(url,'https://api.avempay.com/v1/gateway/');
  state.creates++;
  const sent=JSON.parse(options.body);
  assert.equal(sent.amount,247.00);
  assert.equal(sent['api-key'],'test-key');
  assert.equal(sent.client.telefone,'11999999999');
  if(state.gate)await state.gate;
  if(state.earlyWebhook){
   const receipt=response();await receiveWebhook({method:'POST',headers:{'x-webhook-secret':'test-secret'},
    body:{idTransaction:transaction,status:'paid',amount:247.00}},receipt);
   assert.equal(receipt.code,200);
  }
  return Response.json({status:'success',paymentCode:'000201mocked-only',idTransaction:transaction});
 });
 return state;
}
const create=()=>({method:'POST',body:body()});
const hook=(overrides={})=>({method:'POST',headers:{'x-webhook-secret':'test-secret'},
 body:{idTransaction:transaction,status:'paid',amount:247.00,...overrides}});

test('server computes real basket and rejects changed totals, unknown offers and fee upsells',()=>{
 assert.ok(validCpf('12345678909'));
 assert.ok(!validCpf('00000000000'));
 assert.equal(parseOrder(body()).amountInCents,24700);
 const basket=body();basket.products[0].quantity=2;basket.bumpIds=['camiseta-gta-vi','bone-gta-vi'];
 basket.shippingMethod='JADLOG';basket.amount=562.27;
 assert.equal(parseOrder(basket).amountInCents,56227);
 for(const change of [
  b=>b.amount=0.70,
  b=>b.products[0].name='Sacola para Presentes',
  b=>b.products[0].variant='Outro',
  b=>b.products[0].platform='Nintendo',
  b=>b.products[0].quantity=-1,
  b=>b.bumpIds=['unknown'],
  b=>b.bumpIds=['camiseta-gta-vi','camiseta-gta-vi'],
  b=>b.client.document='11111111111',
  b=>b.shipping={}
 ]){
  const invalid=body();change(invalid);assert.throws(()=>parseOrder(invalid));
 }
});

test('Xbox platform is retained in the order product',()=>{ const xbox=body();xbox.products[0].platform='XBOX';const parsed=parseOrder(xbox);assert.equal(parsed.products[0].name,'Grand Theft Auto VI para XBOX - Fisica');assert.equal(parsed.products[0].platform,'XBOX'); });

test('digital format uses only Envio imediato and does not require a delivery address',()=>{
 const digital=body();digital.products[0].variant='Digital';digital.shippingMethod='Envio imediato';digital.shipping={};digital.amount=247.00;
 const parsed=parseOrder(digital);assert.equal(parsed.amountInCents,24700);assert.equal(parsed.shipping.method,'Envio imediato');assert.equal(parsed.shipping.cep,'');
 assert.throws(()=>parseOrder({...digital,shippingMethod:'JADLOG'}));
});
test('digital order with physical add-ons requires a delivery address',()=>{
 const digital=body();digital.products[0].variant='Digital';digital.shippingMethod='Envio imediato';digital.bumpIds=['gta-plus-mes-1'];digital.shipping={};digital.amount=276.90;
 const digitalParsed=parseOrder(digital);assert.equal(digitalParsed.amountInCents,27690);assert.equal(digitalParsed.products[1].name,'1º mês de GTA+');
 const digitalTwo={...digital,bumpIds:['gta-plus-mes-1','pacote-vintage-vice-city'],amount:346.80};assert.equal(parseOrder(digitalTwo).amountInCents,34680);
 assert.throws(()=>parseOrder({...digital,bumpIds:['camiseta-gta-vi'],amount:266.90}));
 assert.throws(()=>parseOrder(digital));
});

test('create, pending poll, paid webhook, duplicate webhook, paid poll',async(t)=>{
 const state=setup(t);
 const created=response();await createPayment(create(),created);assert.equal(created.code,201);
 assert.equal(state.creates,1);assert.equal(created.body.transactionId,transaction);
 const pending=response();await getPaymentStatus({method:'GET',query:{id:transaction}},pending);assert.equal(pending.body.status,'pending');
 const accepted=response();await receiveWebhook(hook(),accepted);assert.equal(accepted.code,200);
 const firstReceipt=state.records.get('avem:paid:'+transaction);
 const duplicate=response();await receiveWebhook(hook(),duplicate);assert.equal(duplicate.code,200);
 assert.equal(state.records.get('avem:paid:'+transaction),firstReceipt);
 const status=response();await getPaymentStatus({method:'GET',query:{id:transaction}},status);
 assert.equal(status.body.status,'paid');assert.equal(status.body.transactionId,transaction);
 assert.deepEqual(Object.keys(status.body).sort(),['paidAt','status','transactionId']);
 const replay=response();await createPayment(create(),replay);assert.equal(replay.code,200);
 assert.equal(state.creates,1);
});

test('a webhook arriving before create saves its record still confirms payment',async(t)=>{
 const state=setup(t);state.earlyWebhook=true;
 const created=response();await createPayment(create(),created);assert.equal(created.code,201);
 const status=response();await getPaymentStatus({method:'GET',query:{id:transaction}},status);assert.equal(status.body.status,'paid');
});

test('invalid authentication, wrong amount and non-paid callbacks never approve',async(t)=>{
 setup(t);
 const created=response();await createPayment(create(),created);
 const unauthorized=response();await receiveWebhook({...hook(),headers:{'x-webhook-secret':'wrong'}},unauthorized);
 assert.equal(unauthorized.code,401);
 const wrong=response();await receiveWebhook(hook({amount:100}),wrong);assert.equal(wrong.code,400);
 const ignored=response();await receiveWebhook(hook({status:'pending'}),ignored);assert.equal(ignored.code,200);
 const status=response();await getPaymentStatus({method:'GET',query:{id:transaction}},status);assert.equal(status.body.status,'pending');
});

test('unknown early webhook with a different amount cannot approve a future order',async(t)=>{
 setup(t);
 const event=response();await receiveWebhook(hook({amount:100}),event);assert.equal(event.code,200);
 const created=response();await createPayment(create(),created);
 const status=response();await getPaymentStatus({method:'GET',query:{id:transaction}},status);assert.equal(status.body.status,'pending');
});

test('storage failure cannot acknowledge paid or create a charge',async(t)=>{
 const state=setup(t);state.storeFailed=true;
 const original=console.error;t.mock.method(console,'error',()=>{});
 const event=response();await receiveWebhook(hook(),event);assert.equal(event.code,503);
 const created=response();await createPayment(create(),created);assert.equal(created.code,503);assert.equal(state.creates,0);
});

test('simultaneous create requests only call gateway once',async(t)=>{
 const state=setup(t);let release;state.gate=new Promise(resolve=>release=resolve);
 const first=response(),second=response();
 const firstRequest=createPayment(create(),first);
 // Resolve the first storage/fetch microtasks without a clock delay.
 await new Promise(resolve=>setImmediate(resolve));
 await createPayment(create(),second);assert.equal(second.code,409);
 release();await firstRequest;assert.equal(first.code,201);assert.equal(state.creates,1);
});


test('paid callbacks send one Meta Purchase and advertising failures never block financial confirmation',async t=>{
 const state=setup(t);const previous=process.env.META_ACCESS_TOKEN;process.env.META_ACCESS_TOKEN='local-test-token';
 t.after(()=>previous===undefined?delete process.env.META_ACCESS_TOKEN:process.env.META_ACCESS_TOKEN=previous);
 const created=response();await createPayment(create(),created);assert.equal(state.metaCalls,0);
 const accepted=response();await receiveWebhook(hook(),accepted);assert.equal(accepted.code,200);assert.equal(state.metaCalls,1);
 const duplicate=response();await receiveWebhook(hook(),duplicate);assert.equal(duplicate.code,200);assert.equal(state.metaCalls,1);
 state.records.delete('meta:purchase:sent:1096982006197307:'+transaction);state.records.delete('meta:purchase:lock:'+transaction);state.metaReject=true;
 const failedMeta=response();await receiveWebhook(hook(),failedMeta);assert.equal(failedMeta.code,200);
 const status=response();await getPaymentStatus({method:'GET',query:{id:transaction}},status);assert.equal(status.body.status,'paid');
});
