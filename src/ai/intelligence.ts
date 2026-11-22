import {modelInfo,setEnabled,stats,subscribe} from './controller.ts';
import type {Put,Format} from '../web.ts';

export function mountIntelligence(put:Put,F:Format){
  const get=(id:string)=>document.getElementById(id)!;
  const button=get('ai-enable') as HTMLButtonElement;
  put(get('ai-model'),`${modelInfo.id} ${modelInfo.version}`);
  put(get('ai-artifact'),`${modelInfo.artifactBytes} bytes · MIT · SHA-256 ${modelInfo.sha256}`);
  const render=()=>{
    const s=stats();
    get('ai-panel-state').dataset.state=s.enabled?s.state:'disabled';
    put(get('ai-panel-state'),'ai.state.'+(s.enabled?s.state:'disabled'));
    put(button,s.enabled?'ai.disable':'ai.enable');button.setAttribute('aria-pressed',String(s.enabled));
    put(get('ai-latency'),()=>F('ai.timing',{load:s.loadMs===undefined?'—':s.loadMs,inference:s.lastInferenceMs===undefined?'—':s.lastInferenceMs}));
    put(get('ai-result'),s.last?()=>F('ai.comparison',{source:F('ai.source.'+s.last!.source),label:s.last!.label,score:s.last!.score.toFixed(3),rule:s.last!.ruleLabel==='not_evaluated'?F('ai.not_evaluated'):s.last!.ruleLabel}):'ai.no_result');
  };
  button.addEventListener('click',()=>setEnabled(!stats().enabled));subscribe(render);render();
}
