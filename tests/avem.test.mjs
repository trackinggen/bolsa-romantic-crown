import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAvemPix, validateAvemWebhook } from '../lib/avem.mjs';

// These fixtures are sent only to local mocks, never to a real gateway.
const input = () => ({apiKey:'local-test-key',amount:34.99,callbackUrl:'https://example.com/webhook',
 client:{name:'Teste Local',email:'teste@example.com',document:'123.456.789-09',phone:'(11) 99999-9999'}});
const paid={idTransaction:'test_transaction_123',status:'paid',amount:34.99};
const event=body=>({secret:'test-secret',headers:{'x-webhook-secret':'test-secret'},body});

test('v1 request uses reais, telefone, callback and normalizes the response',async()=>{
 const result=await createAvemPix(input(),async(url,options)=>{
  assert.equal(url,'https://api.avempay.com/v1/gateway/');
  assert.equal(options.method,'POST');
  const body=JSON.parse(options.body);
  assert.equal(body.amount,34.99);
  assert.equal(body.client.telefone,'11999999999');
  assert.equal(body.client.document,'12345678909');
  assert.equal(body.client.phone,undefined);
  assert.equal(body.callbackUrl,input().callbackUrl);
  assert.equal(body['api-key'],'local-test-key');
  return Response.json({status:'success',paymentCode:'000201test',idTransaction:paid.idTransaction,
   paymentCodeBase64:'data:image/png;base64,dGVzdA=='});
 });
 assert.equal(result.transactionId,paid.idTransaction);
 assert.equal(result.gatewayTransactionId,result.transactionId);
 assert.equal(result.copyPaste,'000201test');
 assert.equal(result.qrCode,'data:image/png;base64,dGVzdA==');
 assert.ok(!JSON.stringify(result).includes('local-test-key'));
});

test('invalid payer, amount and callback fail before any gateway call',async()=>{
 for(const request of [{...input(),amount:0},{...input(),amount:0.001},
  {...input(),client:{}},{...input(),callbackUrl:'http://example.com'}]){
  await assert.rejects(createAvemPix(request,()=>assert.fail('must not call gateway')));
 }
});

test('ambiguous timeout is not retried and secrets are never exposed',async()=>{
 let calls=0;
 await assert.rejects(createAvemPix(input(),async()=>{calls++;throw new Error('sensitive upstream message')}),
  error=>error.code==='payment_outcome_unknown'&&!error.message.includes('sensitive'));
 assert.equal(calls,1);
 await assert.rejects(createAvemPix(input(),async()=>Response.json({message:'sensitive'},{status:401})),
  error=>error.code==='avem_transaction_failed'&&!error.message.includes('sensitive'));
});

test('incomplete success response is rejected',async()=>{
 await assert.rejects(createAvemPix(input(),async()=>Response.json({status:'success',paymentCode:'000201test'})),
  error=>error.code==='avem_invalid_response');
});

test('paid webhook requires exact secret and correct amount and transaction fields',()=>{
 assert.deepEqual(validateAvemWebhook(event(paid)),{transactionId:paid.idTransaction,status:'paid',amountInCents:3499});
 for(const headers of [{},{'x-webhook-secret':'bad'},{'x-webhook-secret':['test-secret']}]){
  assert.throws(()=>validateAvemWebhook({...event(paid),headers}),error=>error.status===401);
 }
 assert.throws(()=>validateAvemWebhook({...event(paid),secret:''}),error=>error.status===503);
 assert.throws(()=>validateAvemWebhook(event({...paid,amount:0})),error=>error.status===400);
 assert.throws(()=>validateAvemWebhook(event({...paid,idTransaction:'../test'})),error=>error.status===400);
 assert.deepEqual(validateAvemWebhook(event({...paid,status:'pending'})),{ignored:true});
});
