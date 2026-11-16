// Read-only check of the existing Diana Invoice Owner recovery record, run by the user in their
// own interactive Windows terminal. It reads one vault file, derives the account in memory, and
// prints only public values: addresses, derivation index, algorithm id, and the PQC public key's
// SHA-256 fingerprint. It never writes, never prints the mnemonic, password, or any key, and sends
// no network request.
import { spawnSync } from 'node:child_process';
import { closeSync, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import { win32 as path } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { SAFE_FAILURES, verifyRecoveryRecord } from './diana-canonical-pqc.mjs';

export const INVOICE_OWNER = Object.freeze({
  role: 'invoice-owner',
  native: 'qor1dfw567en2l0edze2xqzqw8kwnrcpt3u5m9n88r',
  evm: '0x6a5d4D7B3357df968b2A3004071eCe98f015C794',
});
export const RECORD_PATH = 'E:\\ELA-PRIVATE-VAULT\\Diana-9800-accounts\\invoice-owner.recovery.json';
export const CONFIRMATION = 'VERIFY DIANA INVOICE OWNER';
const MAX_RECORD_BYTES = 4096;

/** Parses and verifies record bytes, then zeroes them, whatever the outcome. */
export async function verifyFromBytes(bytes, expected, deps = {}) {
  try {
    if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > MAX_RECORD_BYTES) throw new Error('Unreadable recovery record');
    let record;
    try {
      record = JSON.parse(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('utf8'));
    } catch {
      throw new Error('Unreadable recovery record');
    }
    return await verifyRecoveryRecord(record, expected, deps);
  } finally {
    if (bytes instanceof Uint8Array) bytes.fill(0);
  }
}

/** The public result the tool prints. */
export function publicReport(role, result) {
  return { role, status: 'MATCH', native: result.native, evm: result.evm, index: result.index, algorithmId: result.algorithmId, pqcPublicKeySha256: result.pqcPublicKeySha256 };
}

/** Only the verifier's own fixed messages are shown; anything else (including SDK errors) is generic. */
export function failureMessage(error) {
  return SAFE_FAILURES.includes(error?.message) ? error.message : 'Verification failed';
}

// Read-only file access: a regular, EFS-encrypted, small file, opened for reading only.
function readRecordBytes(file) {
  const before = lstatSync(file);
  if (!before.isFile() || before.isSymbolicLink() || before.size === 0 || before.size > MAX_RECORD_BYTES) throw new Error('Unreadable recovery record');
  const powerShell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const attributes = spawnSync(powerShell, ['-NoProfile', '-NonInteractive', '-Command', '[IO.File]::GetAttributes($env:ELA_RECORD_PATH).ToString()'], {
    env: { ...process.env, ELA_RECORD_PATH: file }, encoding: 'utf8',
  });
  if (attributes.status !== 0 || !/\bEncrypted\b/.test(attributes.stdout)) throw new Error('Record is not EFS-encrypted');
  const fd = openSync(file, 'r');
  try {
    const stat = fstatSync(fd);
    if (stat.ino !== before.ino || stat.size !== before.size) throw new Error('Unreadable recovery record');
    const bytes = Buffer.alloc(stat.size);
    if (readSync(fd, bytes, 0, stat.size, 0) !== stat.size) {
      bytes.fill(0);
      throw new Error('Unreadable recovery record');
    }
    return bytes;
  } finally {
    closeSync(fd);
  }
}

async function main() {
  if (process.platform !== 'win32' || !process.stdin.isTTY || !process.stdout.isTTY || process.execArgv.length || process.env.NODE_OPTIONS) {
    throw new Error('Interactive Windows terminal required');
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  let answer;
  try {
    process.stdout.write('Read-only check of the Diana Invoice Owner recovery record.\n'
      + 'Expected public account: ' + INVOICE_OWNER.native + ' / ' + INVOICE_OWNER.evm + '\n'
      + 'Nothing is written or sent; only public values are shown.\n');
    answer = await prompt.question('Type ' + CONFIRMATION + ' to continue: ');
  } finally {
    prompt.close();
  }
  if (answer.trim() !== CONFIRMATION) throw new Error('Not confirmed');
  const result = await verifyFromBytes(readRecordBytes(RECORD_PATH), INVOICE_OWNER);
  process.stdout.write(JSON.stringify(publicReport(INVOICE_OWNER.role, result), null, 2) + '\n');
}

// Runs only when started directly (`node .\diana-verify-recovery.mjs`), not when imported by tests.
if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === path.resolve(process.argv[1]).toLowerCase()) {
  main().catch(error => {
    const known = ['Interactive Windows terminal required', 'Not confirmed', 'Record is not EFS-encrypted'];
    process.stderr.write('Diana Invoice Owner verification stopped: ' + (known.includes(error?.message) ? error.message : failureMessage(error)) + '. Nothing was written.\n');
    process.exitCode = 1;
  });
}
