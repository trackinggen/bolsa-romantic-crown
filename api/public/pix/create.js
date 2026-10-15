import ironpay from '../../../lib/ironpay-create.mjs';
import { createPayment } from '../../../lib/avem-routes.mjs';
export const config = { maxDuration: 30 };
export default function handler(req,res){return process.env.PAYMENT_GATEWAY==='avem' ? createPayment(req,res) : ironpay(req,res);}
