import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildPurchaseEvent,captureMetaContext,deliverPurchase,retryPurchases} from '../lib/meta-purchase.mjs';
const id='real_order_for_local_test';
const hash=s=>createHash('sha256').update(s).digest('hex');
const order=()=>({transactionId:id,amountInCents:24700,client:{name:'Maria Teste',email:'MARIA@example.com',phone:'11999999999'},
 shipping:{cidade:'São Paulo',uf:'SP',cep:'01001000'},products:[{id:'GRAND_THEFT_AUTO_VI',quantity:1,priceInCents:24700}],
 meta:{clientIp:'192.0.2.1',userAgent:'Local test browser',fbp:'fb.1.1700000000000.1234',fbc:'fb.1.1700000000000.click-id'}});
const receipt=()=>({transactionId:id,amountInCents:24700,status:'paid',paidAt:new Date().toISOString()});
function response(){return{code:200,setHeader(){},status(v){this.code=v;return this;},json(v){this.body=v;return this;}};}
function setup(t){
 const names=['META_ACCESS_TOKEN','META_PIXEL_ID','CRON_SECRET','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN'];
 const previous=names.map(k=>process.env[k]);
 const values=['secret-for-local-test','1096982006197307','cron-local-test','https://redis.example.com','redis-local-test'];
 names.forEach((k,i)=>process.env[k]=values[i]);
 t.after(()=>names.forEach((k,i)=>previous[i]===undefined?delete process.env[k]:process.env[k]=previous[i]));
 const records=new Map([['avem:order:'+id,JSON.stringify(order())],['avem:paid:'+id,JSON.stringify(receipt())]]),queue=new Map([[id,Date.now()]]);
 const state={records,queue,calls:[],reject:false,timeout:false,markerFailure:false};
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  if(url==='https://redis.example.com'){
   const [cmd,key,value,...flags]=JSON.parse(options.body);
   if(cmd==='GET')return Response.json({result:records.get(key)||null});
   if(cmd==='SET'){
    if(state.markerFailure&&key.startsWith('meta:purchase:sent:'))throw Error('storage failure after Meta accepted');
    if(flags.includes('NX')&&records.has(key))return Response.json({result:null});
    records.set(key,value);return Response.json({result:'OK'});
   }
   if(cmd==='ZADD'){queue.set(flags[0],Number(value));return Response.json({result:1});}
   if(cmd==='ZREM'){queue.delete(value);return Response.json({result:1});}
   if(cmd==='ZRANGEBYSCORE')return Response.json({result:[...queue].filter(([k,v])=>v<=Number(flags[0])).map(([k])=>k).slice(0,5)});
   assert.fail(cmd);
  }
  assert.equal(url,'https://graph.facebook.com/v24.0/1096982006197307/events');
  assert.equal(options.headers.Authorization,'Bearer secret-for-local-test');
  state.calls.push(JSON.parse(options.body));
  if(state.timeout)throw Error('ambiguous Meta timeout');
  return state.reject?Response.json({error:{code:190,message:'never expose this'}},{status:400}):Response.json({events_received:1});
 });
 return state;
}

test('only matched paid receipts produce Purchase; personal fields are hashed and value is reais',()=>{
 const o=order(),r=receipt(),event=buildPurchaseEvent(o,r);
 assert.equal(event.event_name,'Purchase');assert.equal(event.custom_data.value,247.00);assert.equal(event.custom_data.currency,'BRL');
 assert.equal(event.event_id,'avem:purchase:'+id);assert.equal(event.user_data.em[0],hash('maria@example.com'));
 assert.equal(event.user_data.ph[0],hash('5511999999999'));assert.equal(event.user_data.ct[0],hash('saopaulo'));
 assert.equal(event.user_data.fbp,o.meta.fbp);assert.equal(event.user_data.client_ip_address,'192.0.2.1');
 for(const bad of [null,{...r,status:'pending'},{...r,amountInCents:100},{...r,transactionId:'other_transaction'},{...r,paidAt:'invalid'}])assert.equal(buildPurchaseEvent(o,bad),null);
 assert.equal(buildPurchaseEvent(null,r),null);
});

test('browser context uses the actual checkout request, never the webhook sender',()=>{
 const meta=captureMetaContext({headers:{'x-vercel-forwarded-for':'192.0.2.4','user-agent':'Customer browser'},body:{meta:{fbp:'fb.1.1700000000000.1234',fbc:'bad'}}});
 assert.equal(meta.clientIp,'192.0.2.4');assert.equal(meta.userAgent,'Customer browser');assert.equal(meta.fbc,undefined);
});

test('repeated and concurrent deliveries send once after an accepted response',async t=>{
 const s=setup(t);await Promise.all([deliverPurchase(id),deliverPurchase(id)]);
 assert.equal(s.calls.length,1);assert.equal((await deliverPurchase(id)).state,'already_sent');assert.equal(s.queue.size,0);
});

test('Meta errors do not mark delivery and retries retain the same event id and time',async t=>{
 const s=setup(t);s.reject=true;assert.equal((await deliverPurchase(id)).state,'retry_pending');
 assert.ok(!s.records.has('meta:purchase:sent:1096982006197307:'+id));assert.ok(s.queue.has(id));
 const first=s.calls[0].data[0];s.records.delete('meta:purchase:lock:'+id);s.reject=false;
 assert.equal((await deliverPurchase(id)).state,'sent');assert.deepEqual(s.calls[1].data[0],first);
});

test('timeout and persistence failure after Meta accepts preserve the stable event for safe retry',async t=>{
 const s=setup(t);s.timeout=true;assert.equal((await deliverPurchase(id)).state,'retry_pending');
 s.timeout=false;s.markerFailure=true;s.records.delete('meta:purchase:lock:'+id);
 assert.equal((await deliverPurchase(id)).state,'retry_pending');
 s.markerFailure=false;s.records.delete('meta:purchase:lock:'+id);assert.equal((await deliverPurchase(id)).state,'sent');
 assert.equal(new Set(s.calls.map(c=>c.data[0].event_id)).size,1);
});

test('unknown orders, unpaid and expired receipts never generate conversions',async t=>{
 const s=setup(t);s.records.delete('avem:order:'+id);assert.equal((await deliverPurchase(id)).state,'missing_order');
 s.records.set('avem:order:'+id,JSON.stringify(order()));s.records.set('avem:paid:'+id,JSON.stringify({...receipt(),status:'pending'}));
 assert.equal((await deliverPurchase(id)).state,'not_paid');
 s.records.set('avem:paid:'+id,JSON.stringify({...receipt(),paidAt:new Date(Date.now()-7*86400000).toISOString()}));
 assert.equal((await deliverPurchase(id)).state,'expired');assert.equal(s.calls.length,0);
});

test('retry endpoint requires the cron secret and retries queued receipts',async t=>{
 const s=setup(t),bad=response();await retryPurchases({method:'GET',headers:{}},bad);assert.equal(bad.code,401);assert.equal(s.calls.length,0);
 const ok=response();await retryPurchases({method:'GET',headers:{authorization:'Bearer cron-local-test'}},ok);
 assert.equal(ok.code,200);assert.deepEqual(ok.body,{processed:1,sent:1});
});
