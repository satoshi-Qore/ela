import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { openSync, closeSync, fstatSync, writeFileSync } from 'node:fs';
import { win32 as path } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveUnifiedAccount, generateMnemonic, qoreAddresses } from '@qorechain/sdk';
import { canonicalPqcSummary } from './diana-canonical-pqc.mjs';
import { makeKeystore } from './diana-keystore.mjs';

const roles = ['deployer', 'invoice-owner', 'executor', 'recipient'];
const batch = 'E:\\ELA-PRIVATE-VAULT\\Diana-9800-accounts';

function writeReservedFile(role, kind, value) {
  const file = openSync(path.join(batch, role + '.' + kind + '.json'), 'r+');
  try {
    const stat = fstatSync(file);
    if (!stat.isFile() || stat.size !== 0) throw new Error('Unusable destination');
    writeFileSync(file, JSON.stringify(value) + '\n', { flush: true });
  } finally {
    closeSync(file);
  }
}

async function main() {
  if (process.platform !== 'win32' || !process.stdin.isTTY || !process.stdout.isTTY || process.execArgv.length || process.env.NODE_OPTIONS) {
    throw new Error('Interactive Windows terminal required');
  }
  const powerShell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const guard = fileURLToPath(new URL('./prepare-diana-vault.ps1', import.meta.url));
  const result = spawnSync(powerShell, ['-NoProfile', '-ExecutionPolicy', 'RemoteSigned', '-File', guard], { stdio: 'inherit' });
  if (result.status !== 0 || result.error) throw new Error('Vault gate failed');

  const addresses = [];
  const seen = new Set();
  for (const role of roles) {
    const mnemonic = generateMnemonic(256);
    const account = await deriveUnifiedAccount(mnemonic, 0);
    const publicAddresses = qoreAddresses({ evm: account.evm });
    const address = account.evm.toLowerCase();
    if (publicAddresses.cosmos !== account.cosmos || seen.has(address)) throw new Error('Address mismatch');
    seen.add(address);
    const privateKey = Buffer.from(account.privateKey.slice(2), 'hex');
    const password = randomBytes(32).toString('base64url');
    try {
      // The ML-DSA-87 key is the SDK's canonical, address-bound key: re-derivable from the mnemonic,
      // so no separate PQC key file is written. Only its public fingerprint is recorded and shown.
      const pqc = canonicalPqcSummary(account, mnemonic);
      const keystore = makeKeystore(privateKey, password, {
        salt: randomBytes(32), iv: randomBytes(16), id: randomUUID(), iterations: 600000,
      });
      if ('0x' + keystore.address !== address) throw new Error('Keystore address mismatch');
      writeReservedFile(role, 'recovery', { mnemonic, password, index: 0, sdkVersion: '0.14.0', pqc: { derivation: 'canonical', ...pqc } });
      writeReservedFile(role, 'v3', keystore);
      addresses.push({ role, evm: account.evm, native: account.cosmos, pqcPublicKeySha256: pqc.pqcPublicKeySha256 });
    } finally {
      privateKey.fill(0);
      account.pqc.secretKey.fill(0);
    }
  }
  process.stdout.write(JSON.stringify(addresses, null, 2) + '\n');
}

main().catch(() => {
  process.stderr.write('Diana account creation stopped. If batch files exist, inspect them only inside your Windows session. No automatic retry.\n');
  process.exitCode = 1;
});
