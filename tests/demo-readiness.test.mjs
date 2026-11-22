import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync,existsSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const html=read('index.html');
const guide=html.match(/<details id="guided-demo"[\s\S]*?<\/details>/)[0];
const catalog=JSON.parse(html.match(/<script\b[^>]*id="ela-i18n"[^>]*>([\s\S]*?)<\/script>/)[1]);
test('guide is a seven-step reading aid with complete bilingual text and existing module targets',()=>{
  assert.equal((guide.match(/<li\b/g)??[]).length,7);
  assert.doesNotMatch(guide,/<script|<button|<form|\son\w+=|\sopen(?:\s|>)/i);
  for(const [,key]of guide.matchAll(/data-i18n="([^"]+)"/g))for(const lang of ['en','tr'])assert.ok(catalog[lang][key],lang+' '+key);
  for(const [,id]of guide.matchAll(/href="#([^"]+)"/g))assert.ok(html.includes('id="'+id+'"'),id);
  for(const [,path]of guide.matchAll(/https:\/\/github.com\/satoshi-Qore\/ela\/blob\/main\/([^"#]+)/g))assert.ok(existsSync(new URL('../'+path,import.meta.url)),path);
  for(const term of ['266/307','10 false accepts','historical','OFF','failed live read','zero classifier','No video']){
    assert.ok((guide+' '+read('docs/DEVELOPER-FEST.md')).includes(term),term);
  }
});
test('submission pack pins actual payment identities and keeps pending items explicit',()=>{
  const pack=read('docs/DEVELOPER-FEST.md'),evidence=JSON.parse(read('src/payment/evidence.json'));
  assert.ok(pack.includes(evidence.contract));for(const p of evidence.payments)assert.ok(pack.includes(p.txHash),p.txHash);
  for(const word of ['23:59 UTC','No recording','no separate submit button','not established','## Architecture','## Demo runbook','## English video script'])assert.ok(pack.includes(word),word);
  assert.ok(pack.includes('https://build.qorechain.io/rules'));assert.ok(pack.includes('https://build.qorechain.io/prizes'));
});
