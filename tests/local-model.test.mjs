import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createStaticModel } from '../src/agent/local-model-runtime.ts';
import { INTENT_LABELS } from '../src/agent/intent.ts';
import { sha256Hex } from '../src/agent/model-contract.ts';
import { createLocalClassifier } from '../src/agent/local-model.ts';

const bytes = new Uint8Array(readFileSync(new URL('../src/agent/assets/ela-intent-v1.bin', import.meta.url)));
const manifest = JSON.parse(readFileSync(new URL('../src/agent/assets/ela-intent-v1.json', import.meta.url)));
test('real, pinned Model2Vec artifact classifies TR/EN with closed probabilities', async () => {
  assert.equal(await sha256Hex(bytes), manifest.sha256);
  const model = createStaticModel(bytes);
  for (const [text, label] of [['diana testnet çalışıyor mu, check et.', 'network_check'], ['what is the latest block?', 'block_number']]) {
    const candidates = model.classify(text);
    assert.deepEqual(candidates.map(c => c.label), INTENT_LABELS);
    assert.ok(candidates.every(c => Number.isFinite(c.score) && c.score >= 0 && c.score <= 1));
    assert.ok(Math.abs(candidates.reduce((sum, c) => sum + c.score, 0) - 1) < 1e-9);
    assert.equal([...candidates].sort((a,b) => b.score-a.score)[0].label, label);
  }
});
test('malformed model artifacts fail closed', () => {
  for (const bad of [new Uint8Array(), bytes.slice(0, 100), new Uint8Array(bytes.length)]) assert.throws(() => createStaticModel(bad));
});
test('unsupported module workers fall back to rules without loading model bytes', async () => {
  const classifier = createLocalClassifier();
  assert.deepEqual(await classifier.classify('check diana network'), [{label:'network_check',score:1}]);
  assert.equal(classifier.stats().state, 'not_loaded');
  assert.deepEqual(await classifier.classify('an unrelated harmless question'), [{label:'unknown',score:1}]);
  assert.equal(classifier.stats().state, 'fallback');
  assert.equal(classifier.stats().fallbackReason, 'load_failed');
});
