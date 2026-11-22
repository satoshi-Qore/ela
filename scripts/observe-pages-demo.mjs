// Read-only observation of the EXISTING deployed site, separate from PR fixture tests.
// External availability is a reported observation, not fabricated CI success.
import {spawn} from 'node:child_process';
import {existsSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
const url='https://satoshi-qore.github.io/ela/';
const result={checkedAt:new Date().toISOString(),url,status:'unavailable',http:null,initial:null,core:null,payment:null,requests:[],failures:[],modelDownloads:0};
const chrome=[process.env.CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/chromium','C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(p=>p&&existsSync(p));
let child,socket,work;
try{
  const http=await fetch(url,{signal:AbortSignal.timeout(15000),redirect:'error'});
  result.http={status:http.status,lastModified:http.headers.get('last-modified'),etag:http.headers.get('etag')};
  await http.body?.cancel();if(!http.ok)throw Error('Pages HTTP '+http.status);
  if(!chrome)throw Error('Chrome unavailable');
  work=mkdtempSync(join(tmpdir(),'ela-pages-observe-'));
  child=spawn(chrome,['--headless','--remote-debugging-port=0','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-background-networking','--user-data-dir='+join(work,'profile'),'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  const browserUrl=await new Promise((ok,fail)=>{let text='';const timer=setTimeout(()=>fail(Error('Chrome start timeout')),20000);child.stderr.on('data',b=>{text+=b;const m=text.match(/DevTools listening on (ws:\/\/\S+)/);if(m){clearTimeout(timer);ok(m[1]);}});child.once('error',e=>{clearTimeout(timer);fail(e);});child.once('exit',()=>{clearTimeout(timer);fail(Error('Chrome exited before connection'));});});
  const port=new URL(browserUrl).port;
  const targets=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((ok,fail)=>{socket.addEventListener('open',ok,{once:true});socket.addEventListener('error',fail,{once:true});});
  let next=0;const pending=new Map();
  const send=(method,params={})=>new Promise((ok,fail)=>{const id=++next;const timer=setTimeout(()=>{pending.delete(id);fail(Error('CDP timeout: '+method));},30000);pending.set(id,{ok,fail,timer});socket.send(JSON.stringify({id,method,params}));});
  socket.addEventListener('message',({data})=>{const m=JSON.parse(data);if(m.id){const w=pending.get(m.id);if(w){clearTimeout(w.timer);pending.delete(m.id);m.error?w.fail(Error(m.error.message)):w.ok(m.result);}}else{
    if(m.method==='Network.requestWillBeSent'){
      const r=m.params.request;if(r.url.includes('/models/'))result.modelDownloads++;
      if(new URL(r.url).hostname.endsWith('qore.host')&&r.postData){try{result.requests.push({method:JSON.parse(r.postData).method});}catch{result.failures.push({type:'invalid_request'});}}
    }
    if(m.method==='Network.responseReceived'&&new URL(m.params.response.url).hostname.endsWith('qore.host'))result.requests.push({httpStatus:m.params.response.status});
    if(m.method==='Network.loadingFailed')result.failures.push({error:m.params.errorText,cors:m.params.corsErrorStatus??null});
  }});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
  await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
  const loaded=new Promise((ok,fail)=>{const timer=setTimeout(()=>{socket.removeEventListener('message',listen);fail(Error('Pages load timeout'));},20000);const listen=({data})=>{if(JSON.parse(data).method==='Page.loadEventFired'){clearTimeout(timer);socket.removeEventListener('message',listen);ok();}};socket.addEventListener('message',listen);});
  await send('Page.navigate',{url});
  await loaded;
  await evaluate(`(async()=>{const end=Date.now()+15000;while(!document.getElementById('ai-model')?.textContent||document.querySelectorAll('#payment-history>li').length!==3){if(Date.now()>end)throw Error('Pages modules did not mount');await new Promise(r=>setTimeout(r,100));}})()`);
  result.initial=await evaluate(`({title:document.title,lang:document.documentElement.lang,ai:document.getElementById('ai-panel-state').dataset.state,archiveCount:document.querySelectorAll('#payment-history>li').length,contract:document.getElementById('payment-contract').textContent,archive:document.querySelector('.payment-archive').textContent,guidePresent:!!document.getElementById('guided-demo')})`);
  if(result.initial.ai!=='disabled')throw Error('Invariant violation: deployed AI default is not disabled');
  result.core=await evaluate(`(async()=>{document.getElementById('command').value='Check Diana network.';document.getElementById('command-form').requestSubmit();await new Promise(r=>setTimeout(r,0));const end=Date.now()+18000;while(document.getElementById('run').disabled){if(Date.now()>end)throw Error('Live CORE did not settle');await new Promise(r=>setTimeout(r,50));}return {state:document.getElementById('query-state').dataset.state,message:document.getElementById('query-message').textContent,chain:document.getElementById('evm-chain-id').textContent,block:document.getElementById('block-number').textContent};})()`);
  result.payment=await evaluate(`(async()=>{const b=document.getElementById('payment-recheck');b.click();await new Promise(r=>setTimeout(r,0));const end=Date.now()+20000;while(b.disabled){if(Date.now()>end)throw Error('Live payment recheck did not settle');await new Promise(r=>setTimeout(r,50));}return {text:document.getElementById('payment-current-status').textContent,archive:document.querySelector('.payment-archive').textContent,archiveCount:document.querySelectorAll('#payment-history>li').length};})()`);
  if(result.payment.archive!==result.initial.archive||result.payment.archiveCount!==3)throw Error('Invariant violation: dated archive changed during live recheck');
  result.status='observed';
}catch(e){result.error=String(e.message).slice(0,500);if(/^[A-Z0-9_]{2,40}$/.test(e.cause?.code??''))result.causeCode=e.cause.code;}finally{
  try{socket?.close();}catch{}
  if(child&&child.exitCode===null){const stopped=new Promise(ok=>child.once('exit',ok));child.kill();await Promise.race([stopped,new Promise(ok=>setTimeout(ok,3000))]);}
  if(work&&resolve(work).startsWith(resolve(tmpdir())+sep)){try{rmSync(work,{recursive:true,force:true,maxRetries:5,retryDelay:100});}catch{}}
}
const allowed=new Set(['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_getBlockByHash','eth_getCode','eth_getBalance','eth_getTransactionReceipt','eth_call']);
if(result.requests.some(r=>r.method&&!allowed.has(r.method))||result.modelDownloads>0||result.error?.startsWith('Invariant violation'))process.exitCode=1;
console.log('ELA_DEPLOYED_PAGES '+JSON.stringify(result));
