import {readFileSync,statSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {inspectDianaPaymentAccount} from '../src/agent/diana-payment-readiness.ts';

export function parseReadinessArgs(args) {
  if(args.length===1&&args[0]==='--help')return {help:true};
  const parsed={};
  for(let i=0;i<args.length;i+=2){
    const key=args[i]==='--config'?'config':args[i]==='--out'?'out':undefined;
    if(!key||parsed[key]||!args[i+1]||args[i+1].startsWith('--'))throw new Error('Only --config <public.json> and --out <new-report.json> are accepted. No execution flags are supported.');
    parsed[key]=args[i+1];
  }
  if(!parsed.config)throw new Error('A public configuration file is required: --config <public.json>.');
  return parsed;
}
export async function main(args=process.argv.slice(2)) {
  const parsed=parseReadinessArgs(args);
  if(parsed.help){console.log('Read-only Diana Payment Account prerequisites. No signing or execution.\nUsage: npm run payment:readiness -- --config <public.json> [--out <new-report.json>]');return;}
  if(statSync(parsed.config).size>16384)throw new Error('Public readiness configuration is too large.');
  const config=JSON.parse(readFileSync(parsed.config,'utf8'));
  const report=await inspectDianaPaymentAccount(config);
  const output=JSON.stringify(report,null,2)+'\n';
  if(parsed.out)writeFileSync(parsed.out,output,{flag:'wx'});
  console.log(output);
  // A blocked prerequisite is a useful report, but cannot be mistaken for success by automation.
  if(report.status!=='ready_for_review')process.exitCode=2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  main().catch(()=>{console.error('Readiness check failed. Use --help; provide only public configuration and a new output filename.');process.exitCode=1;});
}
