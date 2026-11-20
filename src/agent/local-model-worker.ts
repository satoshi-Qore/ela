import { createStaticModel } from './local-model-runtime.ts';

let model: ReturnType<typeof createStaticModel> | undefined;
const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent) => void;
  postMessage: (value: unknown) => void;
};
scope.onmessage = ({ data }) => {
  const { id } = data;
  try {
    if (data.kind === 'load' && !model && data.bytes instanceof Uint8Array) {
      model = createStaticModel(data.bytes);
      scope.postMessage({ id, result: 'ready' });
    } else if (data.kind === 'classify' && model) {
      scope.postMessage({ id, result: model.classify(data.text) });
    } else throw new Error('Invalid worker message');
  } catch {
    scope.postMessage({ id, error: 'Local inference failed' });
  }
};
