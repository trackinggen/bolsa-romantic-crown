import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { command, readRecord, saveRecord, orderKey, paidKey, validTransactionId } from './payment-store.mjs';

const QUEUE='meta:purchase:pending';
const PIXEL='1096982006197307';
const hash=value=>createHash('sha256').update(value).digest('hex');
const normalized=value=>String(value||'').trim().toLowerCase();
const letters=value=>normalized(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z]/g,'');
const cookieId=value=>/^fb\.\d\.\d{10,16}\.[A-Za-z0-9._-]{1,1800}$/.test(value||'')?value:undefined;
const configured=()=>Boolean(process.env.META_ACCESS_TOKEN && (process.env.META_PIXEL_ID||PIXEL)===PIXEL);

export function captureMetaContext(req){
  const header=name=>typeof req.headers?.[name]==='string'?req.headers[name]:'';
  const meta=req.body?.meta||{};
  const ip=(header('x-vercel-forwarded-for')||header('x-forwarded-for')).split(',')[0].trim();
  return {fbp:cookieId(meta.fbp),fbc:cookieId(meta.fbc),clientIp:isIP(ip)?ip:undefined,
    userAgent:header('user-agent').slice(0,1000),
    eventSourceUrl:'https://bolsa-romantic-crown.vercel.app/pagamento/'};
}

export function buildPurchaseEvent(order,receipt){
  if(!order || receipt?.status!=='paid' || !validTransactionId(order.transactionId) ||
    receipt.transactionId!==order.transactionId || order.amountInCents!==receipt.amountInCents) return null;
  const eventTime=Math.floor(Date.parse(receipt.paidAt)/1000);
  if(!Number.isFinite(eventTime))return null;
  const client=order.client||{},address=order.shipping||{},context=order.meta||{};
  const userData={country:[hash('br')]};
  const email=normalized(client.email);
  if(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))userData.em=[hash(email)];
  let phone=String(client.phone||'').replace(/\D/g,'');
  if(/^\d{10,11}$/.test(phone))phone='55'+phone;
  if(/^55\d{10,11}$/.test(phone))userData.ph=[hash(phone)];
  if(!userData.em && !userData.ph)return null;
  const names=normalized(client.name).split(/\s+/);
  if(letters(names[0]))userData.fn=[hash(letters(names[0]))];
  if(names.length>1 && letters(names.at(-1)))userData.ln=[hash(letters(names.at(-1)))];
  if(letters(address.cidade))userData.ct=[hash(letters(address.cidade))];
  if(letters(address.uf))userData.st=[hash(letters(address.uf))];
  if(/^\d{8}$/.test(address.cep||''))userData.zp=[hash(address.cep)];
  if(context.clientIp && isIP(context.clientIp))userData.client_ip_address=context.clientIp;
  if(context.userAgent)userData.client_user_agent=context.userAgent;
  for(const key of ['fbp','fbc'])if(cookieId(context[key]))userData[key]=context[key];
  return {event_name:'Purchase',event_time:eventTime,event_id:'avem:purchase:'+order.transactionId,
    action_source:'website',event_source_url:'https://bolsa-romantic-crown.vercel.app/pagamento/',
    user_data:userData,custom_data:{currency:'BRL',value:receipt.amountInCents/100,
      order_id:order.transactionId,content_type:'product',
      content_ids:order.products.map(p=>p.id),
      contents:order.products.map(p=>({id:p.id,quantity:p.quantity,item_price:p.priceInCents/100})),
      num_items:order.products.reduce((sum,p)=>sum+p.quantity,0)}};
}

export async function enqueuePurchase(id){
  if(!validTransactionId(id))return;
  await command(['ZADD',QUEUE,Date.now(),id]);
}

// A durable outbox and a stable Meta event_id make ambiguous retries safe.
// Payment confirmation must not depend on the advertising service being online.
export async function deliverPurchase(id,fetcher=fetch){
  if(!validTransactionId(id))return {state:'invalid_transaction'};
  if(!configured())return {state:'not_configured'};
  const marker='meta:purchase:sent:'+PIXEL+':'+id;
  if(await readRecord(marker)){await command(['ZREM',QUEUE,id]);return {state:'already_sent'};}
  const [order,receipt]=await Promise.all([readRecord(orderKey(id)),readRecord(paidKey(id))]);
  if(receipt?.status!=='paid')return {state:'not_paid'};
  const age=Date.now()-Date.parse(receipt.paidAt);
  if(age>6*86400000){await command(['ZREM',QUEUE,id]);return {state:'expired'};}
  const event=buildPurchaseEvent(order,receipt);
  if(!event){await command(['ZADD',QUEUE,Date.now()+3600000,id]);return {state:'missing_order'};}
  const locked=await saveRecord('meta:purchase:lock:'+id,{at:Date.now()},{onlyIfNew:true,ttl:15});
  if(!locked)return {state:'in_progress'};
  try{
    const response=await fetcher('https://graph.facebook.com/v24.0/'+PIXEL+'/events',{
      method:'POST',headers:{Authorization:'Bearer '+process.env.META_ACCESS_TOKEN,'Content-Type':'application/json'},
      body:JSON.stringify({data:[event]}),signal:AbortSignal.timeout(2500)});
    const result=await response.json().catch(()=>null);
    if(!response.ok || result?.events_received!==1){
      await saveRecord('meta:purchase:last_error:'+id,{at:new Date().toISOString(),http:response.status,code:result?.error?.code||null});
      await command(['ZADD',QUEUE,Date.now()+60000,id]);
      return {state:'retry_pending'};
    }
    await saveRecord(marker,{eventId:event.event_id,sentAt:new Date().toISOString()});
    await command(['ZREM',QUEUE,id]);
    return {state:'sent'};
  }catch{
    await command(['ZADD',QUEUE,Date.now()+60000,id]);
    return {state:'retry_pending'};
  }
}

export async function schedulePurchase(id){
  try{await enqueuePurchase(id);return await deliverPurchase(id);}
  catch{console.error('meta_purchase_retry_pending');return {state:'retry_pending'};}
}

export async function retryPurchases(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'method_not_allowed'});}
  const expected=process.env.CRON_SECRET?'Bearer '+process.env.CRON_SECRET:'';
  const supplied=typeof req.headers?.authorization==='string'?req.headers.authorization:'';
  const expectedBytes=Buffer.from(expected),suppliedBytes=Buffer.from(supplied);
  if(!expected || expectedBytes.length!==suppliedBytes.length || !timingSafeEqual(expectedBytes,suppliedBytes))
    return res.status(401).json({error:'unauthorized'});
  if(!configured())return res.status(503).json({error:'meta_not_configured'});
  try{
    const ids=await command(['ZRANGEBYSCORE',QUEUE,'-inf',Date.now(),'LIMIT',0,25]);
    const results=await Promise.all(ids.map(id=>deliverPurchase(id)));
    return res.status(200).json({processed:results.length,sent:results.filter(r=>r.state==='sent').length});
  }catch{return res.status(503).json({error:'meta_retry_unavailable'});}
}
