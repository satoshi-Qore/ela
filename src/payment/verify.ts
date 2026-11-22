import evidence from './evidence.json' with { type: 'json' };
import { createDianaPaymentReader, sha256Data } from '../qorechain/diana-payment-reader.ts';
import { evmEndpoint } from '../qorechain/get-evm-block-number.ts';
import { isRecord, readJson } from '../qorechain/read-client.ts';
import type { ReadOptions } from '../qorechain/read-client.ts';

const same = (a: unknown, b: string): boolean => typeof a === 'string' && a.toLowerCase() === b.toLowerCase();
const word = (s: string) => '0x' + BigInt(s).toString(16).padStart(64, '0');
function requireMatch(ok: boolean): asserts ok { if (!ok) throw Error('Diana evidence mismatch or unavailable history'); }

/** Fixed public reads only. No signer, scheduler, wallet, key input or transaction submission. */
export async function verifyPayments(options: ReadOptions = {}) {
  let id = 0;
  const rpc = async (method: 'eth_getTransactionReceipt' | 'eth_getBlockByNumber', params: unknown[]) => {
    const serial = ++id;
    const body = await readJson(new URL(evmEndpoint), options, JSON.stringify({jsonrpc:'2.0', id:serial, method, params}));
    requireMatch(isRecord(body) && body.jsonrpc === '2.0' && body.id === serial && !('error' in body));
    requireMatch(isRecord(body.result));
    return body.result;
  };
  const reader = await createDianaPaymentReader(options);
  const code = await reader.code(evidence.contract);
  requireMatch(await sha256Data(code) === 'dde7b91ee1570fc0b22b323f956058d3cc35e182a176c45b837d549ca0478c19');
  const policy = await reader.policy(evidence.contract);
  for (const [key, value] of Object.entries(evidence.policy)) {
    requireMatch(same(policy[key as keyof typeof policy], value));
  }
  const balanceWei = await reader.balance(evidence.contract);
  // A later donation may change the balance. Report the actual current value separately.
  for (const payment of evidence.payments) {
    const r = await rpc('eth_getTransactionReceipt', [payment.txHash]);
    requireMatch(r.status === '0x1' && same(r.transactionHash, payment.txHash) && same(r.to, evidence.contract)
      && same(r.from, evidence.policy.executor) && same(r.blockHash, payment.blockHash)
      && r.blockNumber === '0x' + BigInt(payment.blockNumber).toString(16));
    const block = await rpc('eth_getBlockByNumber', [r.blockNumber, false]);
    requireMatch(same(block.hash, payment.blockHash) && block.number === r.blockNumber
      && block.timestamp === '0x' + payment.confirmedAt.toString(16));
    requireMatch(Array.isArray(r.logs));
    const logs = r.logs.filter((l: unknown) => isRecord(l) && same(l.address, evidence.contract));
    requireMatch(logs.length === 1);
    const log = logs[0];
    const topics = ['0xe84e2e482b6d67220bbd44f8300664dc126a9677b1b39ad90746451279073f59',
      word(payment.event.nonce), word(payment.event.recipient), payment.invoiceId];
    requireMatch(isRecord(log) && log.removed === false && same(log.transactionHash, payment.txHash)
      && same(log.blockHash, payment.blockHash) && log.blockNumber === r.blockNumber
      && same(log.data, word(payment.event.amount)) && Array.isArray(log.topics)
      && log.topics.length === 4 && topics.every((t, i) => same((log.topics as unknown[])[i], t)));
  }
  await reader.finish();
  return { checkedAt: new Date().toISOString(), block: reader.snapshot.number, balanceWei };
}
