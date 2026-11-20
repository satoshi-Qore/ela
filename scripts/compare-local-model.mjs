// Cross-runtime parity and held-out validation. Never opens final-blind/sealed labels.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createStaticModel } from '../src/agent/local-model-runtime.ts';
const lab = resolve(process.argv[2] ?? 'E:/ELA/ela-model-lab');
const seal = spawnSync(process.execPath, [resolve(lab, 'tools/verify-seal.mjs')], { encoding: 'utf8' });
if (seal.status !== 0) throw new Error(seal.stdout + seal.stderr);
const readRows = name => readFileSync(resolve(lab, 'data', name + '.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const train = readRows('train').filter(r => !r.withheld);
const validation = readRows('validation').filter(r => !r.withheld);
const texts = [...new Set([...train, ...validation].map(r => r.input))];
const python = `
import json, sys
from pathlib import Path
import numpy as np
from tokenizers import Tokenizer
p=Path(sys.argv[1]); texts=json.load(sys.stdin)
t=Tokenizer.from_file(str(p/'tokenizer.json'))
h=json.loads((p/'head.json').read_text()); c=json.loads((p/'config.json').read_text())
e=np.frombuffer((p/'embeddings.int8.bin').read_bytes(),dtype=np.int8).reshape(c['vocab'],c['dim'])
s=np.frombuffer((p/'scales.f32.bin').read_bytes(),dtype='<f4')
w=np.asarray(h['weights'],dtype=np.float32); b=np.asarray(h['bias'],dtype=np.float32)
out=[]
for text in texts:
 ids=[i for i in t.encode(text,add_special_tokens=False).ids if i!=c['unkId']]
 v=np.zeros(c['dim'],dtype=np.float32)
 if ids:
  v=(e[ids].astype(np.float32)*s[ids,None]).mean(axis=0); v/=np.linalg.norm(v)+1e-32
 z=v@w+b; z=np.exp(z-z.max()); z/=z.sum()
 out.append({'ids':ids,'scores':z.tolist()})
json.dump(out,sys.stdout)
`;
const reference = spawnSync(resolve(lab, 'model2vec/venv/Scripts/python.exe'), ['-X', 'utf8', '-c', python, resolve(lab, 'model2vec/runs/v16k-train-int8')], { input: JSON.stringify(texts), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
if (reference.status !== 0) throw new Error(reference.stderr);
const expected = JSON.parse(reference.stdout);
const model = createStaticModel(new Uint8Array(readFileSync(new URL('../src/agent/assets/ela-intent-v1.bin', import.meta.url))));
let mismatches = 0, maxScoreError = 0;
for (let i = 0; i < texts.length; i++) {
  if (JSON.stringify(model.tokenIds(texts[i])) !== JSON.stringify(expected[i].ids)) {
    if (mismatches < 3) console.error(JSON.stringify({text:texts[i], js:model.tokenIds(texts[i]), python:expected[i].ids}));
    mismatches++;
  }
  model.classify(texts[i]).forEach((c,k) => { maxScoreError = Math.max(maxScoreError, Math.abs(c.score - expected[i].scores[k])); });
}
const accuracy = rows => Object.fromEntries(['all','tr','en','mixed'].map(lang => {
  const selected = rows.filter(r => lang === 'all' || r.lang === lang);
  return [lang, { total: selected.length, correct: selected.filter(r => [...model.classify(r.input)].sort((a,b)=>b.score-a.score)[0].label === r.label).length }];
}));
const report = { compared: texts.length, tokenMismatches: mismatches, maxScoreError, validationRawLabelAccuracy: accuracy(validation), trainingRows:train.length, validationRows:validation.length };
if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify(report,null,2)+'\n', {flag:'wx'});
console.log(JSON.stringify(report,null,2));
if (mismatches || maxScoreError > 2e-5) process.exitCode = 1;
