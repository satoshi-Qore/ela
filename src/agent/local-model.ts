import { createModelClassifier, MODEL_BUDGET, verifyModelArtifact } from './model-contract.ts';
import { ruleClassifier } from './lexicon.ts';
import manifest from './assets/ela-intent-v1.json' with { type: 'json' };
import type { IntentCandidate } from './intent.ts';

/** Rules retain every existing known decision. Only unresolved, filtered text reaches the model. */
export function createLocalClassifier() {
  let workerStopped = false;
  const model = createModelClassifier({
    expectedSha256: manifest.sha256,
    async load() {
      if (typeof Worker === 'undefined') throw new Error('Module workers unavailable');
      const controller = new AbortController();
      let worker: Worker | undefined;
      let serial = 0;
      const pending = new Map<number, { resolve: (result: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
      const stop = () => {
        workerStopped = true;
        worker?.terminate();
        for (const call of pending.values()) { clearTimeout(call.timer); call.reject(new Error('Local worker stopped')); }
        pending.clear();
      };
      const deadline = setTimeout(() => { controller.abort(); stop(); }, MODEL_BUDGET.maxLoadMs - 100);
      try {
        const response = await fetch(new URL('./assets/ela-intent-v1.bin', import.meta.url), { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
        if (!response.ok || !response.body) throw new Error('Model unavailable');
        const reader = response.body.getReader();
        const bytes = new Uint8Array(manifest.bytes);
        let size = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > bytes.length || size > MODEL_BUDGET.maxArtifactBytes) { await reader.cancel(); throw new Error('Model too large'); }
          bytes.set(value, size - value.length);
        }
        if (size !== bytes.length || !(await verifyModelArtifact(bytes, manifest.sha256)) || controller.signal.aborted) throw new Error('Model integrity failed');
        // Only verified data enters a worker. No eval, remote code, RPC, context, or tool hooks.
        worker = new Worker(new URL('./local-model-worker.ts', import.meta.url), { type: 'module', name: 'ela-local-intent' });
        const call = (message: object, ms: number): Promise<unknown> => new Promise((resolve, reject) => {
          const id = ++serial;
          const timer = setTimeout(stop, ms);
          pending.set(id, { resolve, reject, timer });
          worker!.postMessage({ ...message, id });
        });
        worker.onmessage = ({ data }) => {
          const request = pending.get(data?.id);
          if (!request) return;
          clearTimeout(request.timer);
          pending.delete(data.id);
          if (data.error) request.reject(new Error('Local inference failed'));
          else request.resolve(data.result);
        };
        worker.onerror = stop;
        worker.onmessageerror = stop;
        await call({ kind: 'load', bytes }, MODEL_BUDGET.maxLoadMs - 100);
        return { bytes, model: { classify: (text: string) => call({ kind: 'classify', text }, MODEL_BUDGET.maxInferenceMs - 10) } };
      } catch (error) {
        controller.abort(); stop(); throw error;
      } finally { clearTimeout(deadline); }
    },
  });
  return Object.freeze({
    classify(text: string) {
      const rule = ruleClassifier.classify(text) as IntentCandidate[];
      return rule[0].label === 'unknown' && !workerStopped ? model.classify(text) : rule;
    },
    stats: () => workerStopped
      ? { ...model.stats(), state: 'fallback' as const, fallbackReason: 'worker_stopped' as const }
      : model.stats(),
  });
}

export const localClassifier = createLocalClassifier();
