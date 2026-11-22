import evidence from './evidence.json' with { type: 'json' };
import type { Put, Format } from '../web.ts';

const explorer = 'https://explore.qore.network';
const source = 'https://github.com/satoshi-Qore/ela/blob/21483883ea2d25e3aeef1f7a26f9843dc2d4c45f';
const deployment = '0x3a2722d545b635e92023e1740897d414d3ccf1ba1e56865db97137e30c1e91e4';
const funding = '0x478f47a7c713eb4cd54915f01ecfb59e6fc6b40d1d1aacab7908f1c77fffef7f';
const time = (n: number) => new Date(n * 1000).toLocaleTimeString('en-GB', {timeZone:'Europe/Istanbul', hour12:false});

export function mountPayment(put: Put, F: Format) {
  const get = (id: string) => document.getElementById(id)!;
  const link = (id: string, href: string, label?: string) => {
    const a = get(id) as HTMLAnchorElement; a.href = href; if (label) a.textContent = label;
  };
  link('payment-contract', `${explorer}/address/${evidence.contract}`, evidence.contract);
  link('payment-deployment', `${explorer}/tx/${deployment}`, deployment);
  link('payment-funding', `${explorer}/tx/${funding}`, funding);
  link('payment-source', `${source}/docs/DIANA-LIVE-20261121.md`);
  link('payment-snapshot', `${source}/docs/evidence/diana-live-20261121/final-chain-state.json`);
  put(get('payment-total'), () => document.documentElement.lang === 'tr' ? '0,003 QOR' : '0.003 QOR');
  for (const p of evidence.payments) {
    const item = document.createElement('li');
    item.dataset.nonce = String(p.index);
    const title = document.createElement('h4'); title.textContent = `${String(p.index + 1).padStart(2, '0')} · 0.001 QOR`;
    put(title, () => `${String(p.index + 1).padStart(2, '0')} · ${document.documentElement.lang === 'tr' ? '0,001' : '0.001'} QOR`);
    const proof = document.createElement('p'); proof.className = 'payment-proof'; put(proof, 'pay.proof');
    const times = document.createElement('dl'); times.className = 'payment-times';
    for (const [label, value] of [['target', p.targetAt], ['sent', p.sentAt], ['blockTime', p.confirmedAt]] as const) {
      const pair = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd');
      put(dt, 'pay.' + label);
      const stamp = document.createElement('time'); stamp.dateTime = new Date(value * 1000).toISOString(); stamp.textContent = time(value);
      dd.append(stamp); pair.append(dt, dd); times.append(pair);
    }
    const tx = document.createElement('a'); tx.href = `${explorer}/tx/${p.txHash}`; tx.textContent = p.txHash;
    for (const part of [p.txHash.slice(0,34),p.txHash.slice(34)]) { const span=document.createElement('span'); span.textContent=part; span.className='payment-hash-part'; if(tx.childElementCount===0)tx.textContent=''; tx.append(span); }
    tx.target = '_blank'; tx.rel = 'noopener noreferrer';
    item.append(title, proof, times, tx); get('payment-history').append(item);
  }
  const status = get('payment-current-status'); put(status, 'pay.unchecked');
  const button = get('payment-recheck') as HTMLButtonElement;
  button.addEventListener('click', async () => {
    button.disabled = true; status.dataset.state = 'reading'; put(status, 'pay.checking');
    try {
      const { verifyPayments } = await import('./verify.ts');
      const result = await verifyPayments();
      status.dataset.state = 'verified';
      put(status, () => F('pay.ok', {time:result.checkedAt, block:result.block, balance:result.balanceWei}));
    } catch {
      const checkedAt = new Date().toISOString(); status.dataset.state = 'unavailable';
      put(status, () => F('pay.failed', {time:checkedAt}));
    } finally { button.disabled = false; }
  });
}
