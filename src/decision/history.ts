import evidence from '../payment/evidence.json' with { type: 'json' };
import { evaluatePayment } from './engine.ts';
import type { Input, Policy } from './engine.ts';

export const archivedPolicy: Readonly<Policy> = Object.freeze({chainId:9800,contract:evidence.contract,
  recipient:evidence.policy.recipient,startsAt:Number(evidence.policy.startsAt),endsAt:Number(evidence.policy.endsAt),
  maxPerPayment:evidence.policy.maxPerPayment,spendingLimit:evidence.policy.spendingLimit,maxPayments:evidence.policy.maxPayments,maxAgeSeconds:60});

/** Replays only a documented post-receipt state. Never reconstructs an unobserved pre-send balance. */
export function explainHistoricalPayment(index: number) {
  const p=evidence.payments[index];
  if (!Number.isInteger(index) || !p) throw new RangeError('Expected one of the three archived payments');
  const input: Input = {mode:'historical',at:p.confirmedAt,observedAt:p.confirmedAt,
    source:`docs/evidence/diana-live-20261121/payment-${index}-verification-final.json; payment-${index}-receipt-balance.json`,
    block:p.blockNumber,evidence:evidence.verified && p.receiptStatus==='0x1'?'verified':'conflicting',
    facts:{chainId:9800,contract:evidence.contract,recipient:p.event.recipient,amount:p.event.amount,
      nonce:p.event.nonce,nextNonce:p.nextNonce,invoiceId:p.invoiceId,invoicePaid:true,totalSpent:p.totalSpent,balance:p.balanceWei,
      // This is a post-receipt replay: the just-confirmed payment is the previous transaction.
      previous: p.receiptStatus==='0x1'?'confirmed':'unknown'}};
  return Object.freeze({txHash:p.txHash,invoiceId:p.invoiceId,result:evaluatePayment(input,archivedPolicy)});
}
