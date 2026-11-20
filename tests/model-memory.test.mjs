import assert from 'node:assert/strict';
import {test} from 'node:test';
import {summarizeModelMemory} from './helpers/model-memory.mjs';
const heap=(usedSize=10,backingStorageSize=20)=>({usedSize,backingStorageSize});
const samples=()=>[
 {phase:'before-load',source:'checkpoint',page:heap(),worker:null},
 {phase:'loading',source:'timer',page:heap(500),worker:null},
 {phase:'loading',source:'worker-baseline',page:heap(),worker:heap()},
 {phase:'loaded',source:'checkpoint',page:heap(),worker:heap()},
 {phase:'validation',source:'timer',page:heap(),worker:heap()},
 {phase:'repeat-1',source:'timer',page:heap(),worker:heap()},
];
test('memory audit includes page-only loading peak and real timer coverage',()=>{
 const result=summarizeModelMemory(samples());assert.equal(result.peakSampledExtraBytes,490);
 assert.deepEqual(result.timerSamplesByStage,{loading:1,validation:1,repeats:1});
});
test('memory audit rejects missing, invalid and negative page or Worker metrics',()=>{
 for(const scope of ['page','worker'])for(const key of ['usedSize','backingStorageSize'])for(const value of [undefined,NaN,Infinity,-1,'20']){
  const rows=samples();rows[3][scope][key]=value;
  assert.throws(()=>summarizeModelMemory(rows),/invalid memory metric/);
 }
});
test('memory audit cannot pass from batch checkpoints alone',()=>{
 const rows=samples().map(r=>({...r,source:'checkpoint'}));assert.throws(()=>summarizeModelMemory(rows),/timer samples/);
});
test('memory audit requires all three measured stages and a loaded Worker',()=>{
 for(const stage of ['loading','validation','repeat-1'])assert.throws(()=>summarizeModelMemory(samples().filter(r=>r.phase!==stage)),/timer samples/);
 assert.throws(()=>summarizeModelMemory(samples().map(r=>({...r,worker:null}))),/Worker/);
});
