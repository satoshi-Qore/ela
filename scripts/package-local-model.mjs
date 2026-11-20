// Repackage existing, measured lab weights without training or modifying the lab.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
const source = resolve(process.argv[2] ?? 'E:/ELA/ela-model-lab/model2vec/runs/v16k-train-int8');
const names = ['config.json', 'head.json', 'tokenizer.json', 'embeddings.int8.bin', 'scales.f32.bin'];
const files = Object.fromEntries(names.map(name => [name, readFileSync(join(source, name))]));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const config = JSON.parse(files['config.json']);
const metadata = Buffer.from(JSON.stringify({
  version: 1, config, head: JSON.parse(files['head.json']), tokenizer: JSON.parse(files['tokenizer.json']),
}));
const prefix = Buffer.alloc(8);
prefix.writeUInt32LE(0x31414c45, 0); // ELA1
prefix.writeUInt32LE(metadata.length, 4);
const bytes = Buffer.concat([prefix, metadata, files['embeddings.int8.bin'], files['scales.f32.bin']]);
const dir = new URL('../src/agent/assets/', import.meta.url);
if (process.argv.includes('--check')) {
  const manifest = JSON.parse(readFileSync(new URL('ela-intent-v1.json', dir)));
  if (sha(bytes) !== manifest.sha256 || !bytes.equals(readFileSync(new URL('ela-intent-v1.bin', dir)))) throw new Error('Artifact differs from pinned package');
  for (const name of names) if (sha(files[name]) !== manifest.sources[name].sha256) throw new Error('Source differs: '+name);
  console.log('Existing package and all five source hashes match');
  process.exit(0);
}
mkdirSync(dir, { recursive: true });
// Exclusive writes protect prior artifacts and experiment outputs.
writeFileSync(new URL('ela-intent-v1.bin', dir), bytes, { flag: 'wx' });
writeFileSync(new URL('ela-intent-v1.json', dir), JSON.stringify({
  version: 1, variant: 'v16k-train-int8', teacher: config.teacher,
  bytes: bytes.length, sha256: sha(bytes),
  sources: Object.fromEntries(names.map(name => [name, { bytes: files[name].length, sha256: sha(files[name]) }])),
}, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ bytes: bytes.length, sha256: sha(bytes) }));
