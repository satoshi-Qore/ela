import { Tokenizer } from '@huggingface/tokenizers';
import type { IntentCandidate, IntentLabel } from './intent.ts';

/** Data-only static embeddings and trained softmax head. No tools, network, or session context. */
export function createStaticModel(bytes: Uint8Array) {
  if (bytes.byteLength < 8) throw new Error('Truncated model');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = view.getUint32(4, true);
  if (view.getUint32(0, true) !== 0x31414c45 || length > 2_000_000 || length + 8 > bytes.length) throw new Error('Invalid model header');
  const { version, config, tokenizer: definition, head } = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(8, 8 + length)));
  const labels: IntentLabel[] = ['network_check', 'block_number', 'follow_up_repeat', 'follow_up_current', 'unsupported', 'unknown'];
  if (version !== 1 || config.vocab !== 16000 || config.dim !== 256 || config.unkId !== 1 || config.dtype !== 'int8'
    || JSON.stringify(head.labels) !== JSON.stringify(labels) || JSON.stringify(config.labels) !== JSON.stringify(labels)
    || bytes.length !== 8 + length + 16000 * 260
    || head.weights.length !== 256 || head.weights.some((row: number[]) => row.length !== 6 || row.some(n => !Number.isFinite(n)))
    || head.bias.length !== 6 || head.bias.some((n: number) => !Number.isFinite(n))) throw new Error('Invalid model shape');
  const tokenizer = new Tokenizer(definition, {});
  const offset = 8 + length;
  const embeddings = new Int8Array(bytes.buffer, bytes.byteOffset + offset, 16000 * 256);
  // DataView permits unaligned package offsets, with explicit little-endian decoding.
  const scales = new Float32Array(16000);
  for (let i = 0; i < scales.length; i++) {
    scales[i] = view.getFloat32(offset + embeddings.length + i * 4, true);
    if (!(scales[i] > 0 && Number.isFinite(scales[i]))) throw new Error('Invalid scale');
  }
  function tokenIds(text: string): number[] {
    if (typeof text !== 'string' || text.length > 500) throw new Error('Invalid input');
    return tokenizer.encode(text, { add_special_tokens: false }).ids.filter(id => id !== 1);
  }
  return Object.freeze({
    tokenIds,
    classify(text: string): IntentCandidate[] {
      const ids = tokenIds(text);
      const vector = new Float64Array(256);
      for (const id of ids) {
        if (!Number.isInteger(id) || id < 0 || id >= 16000) throw new Error('Invalid token');
        for (let d = 0; d < 256; d++) vector[d] += embeddings[id * 256 + d] * scales[id];
      }
      const norm = Math.hypot(...vector) || 1;
      const logits: number[] = labels.map((_, k) => {
        let value = head.bias[k];
        for (let d = 0; d < 256; d++) value += vector[d] / norm * head.weights[d][k];
        return value;
      });
      const maximum = Math.max(...logits);
      const exps = logits.map(x => Math.exp(x - maximum));
      // Keep sum <= 1 even under floating point roundoff, as required by decideIntent.
      const total = exps.reduce((a, b) => a + b, 0) * (1 + Number.EPSILON);
      return labels.map((label, k) => ({ label, score: exps[k] / total }));
    },
  });
}
