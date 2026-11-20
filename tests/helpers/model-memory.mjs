import assert from 'node:assert/strict';

/** CDP samples cover JS used heap and ArrayBuffer backing storage, not process RSS. */
export function summarizeModelMemory(samples) {
  const size = heap => {
    for (const key of ['usedSize', 'backingStorageSize']) {
      assert.ok(typeof heap?.[key] === 'number' && Number.isFinite(heap[key]) && heap[key] >= 0,
        'invalid memory metric: ' + key);
    }
    return heap.usedSize + heap.backingStorageSize;
  };
  assert.ok(samples.length, 'memory samples required');
  const sizes = samples.map(s => ({page:size(s.page), worker:s.worker == null ? 0 : size(s.worker)}));
  assert.ok(samples.some(s => s.phase === 'loaded' && s.worker), 'loaded Worker measurement required');
  const timerSamplesByStage = Object.fromEntries([
    ['loading', s => s.phase === 'loading'],
    ['validation', s => s.phase === 'validation' && s.worker],
    ['repeats', s => s.phase.startsWith('repeat-') && s.worker],
  ].map(([stage, matches]) => {
    const count = samples.filter(s => s.source === 'timer' && matches(s)).length;
    assert.ok(count > 0, 'timer samples required: ' + stage);
    return [stage, count];
  }));
  const baselinePageBytes = sizes[0].page;
  return {baselinePageBytes, timerSamplesByStage,
    peakSampledExtraBytes:Math.max(...sizes.map(s => s.page + s.worker - baselinePageBytes))};
}
