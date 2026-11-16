import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { openSync, closeSync, fstatSync, writeFileSync, writeSync, fsyncSync } from 'node:fs';
import { win32 as path } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatePqcKeypair, pqcSign, pqcVerify } from '@qorechain/sdk';
import { NATIVE_CHAIN, promptForInvoiceOwner } from './diana-invoice-pqc.mjs';

const destination = 'E:\\ELA-PRIVATE-VAULT\\invoice-owner.diana-9800.mldsa87';

function saveKey(metadata, secretKey) {
  const file = openSync(destination, 'r+');
  try {
    const stat = fstatSync(file);
    if (!stat.isFile() || stat.size !== 0) throw new Error('Unusable destination');
    writeFileSync(file, JSON.stringify(metadata) + '\n');
    if (writeSync(file, secretKey) !== secretKey.length) throw new Error('Incomplete PQC write');
    fsyncSync(file);
  } finally {
    closeSync(file);
  }
}

async function run() {
  if (process.platform !== 'win32' || !process.stdin.isTTY || !process.stdout.isTTY ||
      process.env.NODE_OPTIONS || process.execArgv.length) {
    throw new Error('Interactive Windows terminal required');
  }

  const { owner, approval } = await promptForInvoiceOwner(process.stdin, process.stdout);
  const powerShell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const guard = fileURLToPath(new URL('./prepare-diana-vault.ps1', import.meta.url));
  const result = spawnSync(powerShell, ['-NoProfile', '-ExecutionPolicy', 'RemoteSigned', '-File', guard, '-InvoicePqc', '-InvoiceApproval', approval], {
    stdio: 'inherit',
  });
  if (result.status !== 0 || result.error) throw new Error('Vault gate failed');

  const seed = randomBytes(32);
  let keypair;
  try {
    keypair = generatePqcKeypair(seed);
    const message = Buffer.from('ELA-DIANA-9800-MLDSA87-LOCAL-SELF-TEST-V1');
    const signature = pqcSign(keypair.secretKey, message);
    if (keypair.publicKey.length !== 2592 || keypair.secretKey.length !== 4896 || signature.length !== 4627 ||
        !pqcVerify(keypair.publicKey, message, signature) ||
        pqcVerify(keypair.publicKey, Buffer.concat([message, Buffer.from([0])]), signature)) {
      throw new Error('PQC self-test failed');
    }
    const metadata = {
      format: 'ela-diana-invoice-mldsa87-v1',
      nativeChainId: NATIVE_CHAIN,
      evmChainId: 9800,
      ...owner,
      algorithmId: 1,
      publicKey: Buffer.from(keypair.publicKey).toString('hex'),
      publicKeySha256: createHash('sha256').update(keypair.publicKey).digest('hex'),
    };
    saveKey(metadata, keypair.secretKey);
    process.stdout.write(JSON.stringify(metadata, null, 2) + '\n');
  } finally {
    seed.fill(0);
    keypair?.secretKey.fill(0);
  }
}

run().catch(() => {
  process.stderr.write('Diana Invoice Owner PQC preparation stopped. No automatic retry.\n');
  process.exitCode = 1;
});
