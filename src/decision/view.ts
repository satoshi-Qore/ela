import { explainHistoricalPayment } from './history.ts';
import type { Put, Format } from '../web.ts';

export function mountDecision(put: Put, F: Format) {
  const get=(id:string)=>document.getElementById(id)!;
  const select=get('decision-payment') as HTMLSelectElement;
  const render=()=>{
    const {result,txHash,invoiceId}=explainHistoricalPayment(Number(select.value));
    get('decision-result').dataset.state=result.outcome;
    put(get('decision-outcome'),result.outcome);
    put(get('decision-reason'),()=>F('dec.reason.'+result.decisive));
    put(get('decision-decisive'),()=>F('dec.check.'+result.decisive));
    put(get('decision-time'),new Date(result.at*1000).toISOString());
    put(get('decision-block'),result.block);
    put(get('decision-source'),result.source);
    put(get('decision-hash'),txHash);
    put(get('decision-invoice'),invoiceId);
    const list=get('decision-checks'); list.replaceChildren();
    for(const c of result.checks){
      const item=document.createElement('li');item.dataset.status=c.status;
      const heading=document.createElement('h4');put(heading,()=>F('dec.check.'+c.id));
      const status=document.createElement('span');status.className='decision-check-state';put(status,'dec.status.'+c.status);
      const reason=document.createElement('p');put(reason,()=>F('dec.reason.'+c.id));
      const values=document.createElement('p');values.className='decision-values';put(values,()=>F('dec.values',{actual:c.actual,expected:c.expected}));
      item.append(heading,status,reason,values);list.append(item);
    }
  };
  select.addEventListener('change',render);render();
}
