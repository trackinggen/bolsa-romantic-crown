import { createAvemPix, validateAvemWebhook } from './avem.mjs';
import { parseOrder, orderFingerprint } from './payment-order.mjs';
import { readRecord, saveRecord, storeReady, orderKey, paidKey, validTransactionId, resolveStatus } from './payment-store.mjs';

export async function createPayment(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'method_not_allowed'});}
  if(!process.env.AVEM_API_KEY || !process.env.AVEM_WEBHOOK_SECRET || !process.env.AVEM_CALLBACK_URL || !storeReady())
    return res.status(503).json({code:'payment_gateway_not_configured',retryable:false,error:'O pagamento ainda não está configurado.'});
  try { var callback = new URL(process.env.AVEM_CALLBACK_URL); if(callback.protocol!=='https:' || callback.username || callback.password)throw new Error(); } catch { return res.status(503).json({code:'invalid_callback',retryable:false,error:'Confirmação do pagamento não configurada.'}); }
  let order;
  try{order=parseOrder(req.body);}catch(error){return res.status(error.status||400).json({code:error.code,retryable:false,error:error.message});}
  const fingerprint=orderFingerprint(order);
  const key='avem:request:'+req.body.requestId;
  try{
    // A stable request ID plus atomic NX prevents parallel/retried creates from
    // producing duplicate charges. Keep ambiguous outcomes blocked for 24 hours.
    const lock=await saveRecord(key,{state:'creating',fingerprint},{onlyIfNew:true,ttl:86400});
    if(!lock){
      const previous=await readRecord(key);
      if(previous?.fingerprint!==fingerprint)return res.status(409).json({code:'request_changed',retryable:false,error:'O pedido foi alterado. Atualize a página antes de gerar outro Pix.'});
      if(previous?.result)return res.status(200).json(previous.result);
      return res.status(409).json({code:'payment_creation_pending',retryable:false,error:'A cobrança está em processamento. Aguarde antes de tentar novamente.'});
    }
    const result=await createAvemPix({apiKey:process.env.AVEM_API_KEY,amount:order.amountInCents/100,client:order.client,callbackUrl:process.env.AVEM_CALLBACK_URL});
    // The webhook receipt uses an independent key: a fast payment cannot be
    // overwritten by this initial order write.
    await saveRecord(orderKey(result.transactionId),{...order,transactionId:result.transactionId,createdAt:new Date().toISOString()});
    await saveRecord(key,{state:'created',fingerprint,result},{ttl:86400});
    return res.status(201).json(result);
  }catch(error){
    return res.status(error.status||503).json({code:error.code||'payment_unavailable',retryable:false,
      error:error.code?error.message:'Não foi possível confirmar a criação do Pix. Consulte o atendimento antes de gerar outra cobrança.'});
  }
}

export async function getPaymentStatus(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'method_not_allowed'});}
  const id=req.query?.id;
  if(!validTransactionId(id))return res.status(400).json({error:'transaction_id_required'});
  try{
    const [order,paid]=await Promise.all([readRecord(orderKey(id)),readRecord(paidKey(id))]);
    if(!order)return res.status(404).json({error:'transaction_not_found'});
    return res.status(200).json(resolveStatus(order,paid));
  }catch{return res.status(503).json({error:'Não foi possível consultar o pagamento.'});}
}

export async function receiveWebhook(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'method_not_allowed'});}
  let event;
  try{event=validateAvemWebhook({secret:process.env.AVEM_WEBHOOK_SECRET,headers:req.headers,body:req.body});}
  catch(error){return res.status(error.status||400).json({error:error.code||'invalid_webhook'});}
  if(event.ignored)return res.status(200).json({received:true,ignored:true});
  try{
    const order=await readRecord(orderKey(event.transactionId));
    if(order && order.amountInCents!==event.amountInCents)return res.status(400).json({error:'amount_mismatch'});
    // Preserve the first receipt and paidAt; authenticated early callbacks can
    // arrive before create finishes. Status validates them against the order.
    const saved=await saveRecord(paidKey(event.transactionId),{...event,paidAt:new Date().toISOString()},{onlyIfNew:true});
    if(!saved){
      const existing=await readRecord(paidKey(event.transactionId));
      if(existing?.amountInCents!==event.amountInCents)return res.status(400).json({error:'amount_mismatch'});
    }
    return res.status(200).json({received:true});
  }catch{
    console.error('avem_webhook_storage_unavailable');
    return res.status(503).json({error:'webhook_storage_unavailable'});
  }
}
