import ironpay from '../../../lib/ironpay-status.mjs';
import { getPaymentStatus } from '../../../lib/avem-routes.mjs';
export default function handler(req,res){return process.env.PAYMENT_GATEWAY==='avem' ? getPaymentStatus(req,res) : ironpay(req,res);}
