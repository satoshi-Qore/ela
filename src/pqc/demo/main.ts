import './demo.css';
import { MAX_MESSAGE_BYTES, ML_DSA_87_PUBLIC_KEY_BYTES, ML_DSA_87_SIGNATURE_BYTES, verifyMlDsa87 } from '../verify-ml-dsa-87.ts';
import type { VerificationFailure, VerificationResult } from '../verify-ml-dsa-87.ts';
import { OFFICIAL_VECTOR } from './official-vector.ts';

// Offline ML-DSA-87 verification demo. It reads three public values from the page, verifies them in
// this browser, and shows the result. It has no network code; the page's Content-Security-Policy
// also blocks every connection (connect-src 'none').

const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const publicKey = element<HTMLTextAreaElement>('public-key');
const message = element<HTMLTextAreaElement>('message');
const signature = element<HTMLTextAreaElement>('signature');
const messageText = element<HTMLParagraphElement>('message-text');
const result = element<HTMLElement>('result');
const resultTitle = element<HTMLElement>('result-title');
const resultDetail = element<HTMLElement>('result-detail');
const resultMeta = element<HTMLElement>('result-meta');
const vectorSource = element<HTMLElement>('vector-source');

const REASONS: Record<VerificationFailure, string> = {
  signature_mismatch: 'The signature does not match this public key and message.',
  invalid_encoding: 'A field is not valid hexadecimal text. Use the characters 0–9 and a–f only, without a 0x prefix or spaces.',
  invalid_public_key_length: `The public key must be exactly ${ML_DSA_87_PUBLIC_KEY_BYTES} bytes (${ML_DSA_87_PUBLIC_KEY_BYTES * 2} hex characters).`,
  invalid_signature_length: `The signature must be exactly ${ML_DSA_87_SIGNATURE_BYTES} bytes (${ML_DSA_87_SIGNATURE_BYTES * 2} hex characters).`,
  message_too_large: `The message is larger than ${MAX_MESSAGE_BYTES / 1024} KiB, so it was refused before decoding.`,
  invalid_input: 'The input could not be read.',
  verification_error: 'Verification stopped unexpectedly. The signature is treated as not valid.',
};

const resourceCount = (): number => performance.getEntriesByType('resource').length;

function describeSize(text: string, rule: string): string {
  const value = text.trim();
  const bytes = /^(?:[0-9a-fA-F]{2})*$/.test(value) ? `${value.length / 2} bytes` : 'not hexadecimal';
  return `${bytes} · ${rule}`;
}

function showMessageText(): void {
  const value = message.value.trim();
  messageText.hidden = true;
  if (value === '' || value.length > 512 || !/^(?:[0-9a-fA-F]{2})*$/.test(value)) return;
  const bytes = Uint8Array.from(value.match(/../g) ?? [], pair => Number.parseInt(pair, 16));
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (/^[\x20-\x7e]*$/.test(decoded)) {
      messageText.textContent = `As text: “${decoded}”`;
      messageText.hidden = false;
    }
  } catch {
    // Not UTF-8 text; only the hexadecimal form is shown.
  }
}

function updateCounts(): void {
  element('public-key-count').textContent = describeSize(publicKey.value, `needs ${ML_DSA_87_PUBLIC_KEY_BYTES}`);
  element('message-count').textContent = describeSize(message.value, `at most ${MAX_MESSAGE_BYTES / 1024} KiB`);
  element('signature-count').textContent = describeSize(signature.value, `needs ${ML_DSA_87_SIGNATURE_BYTES}`);
  showMessageText();
}

function lastByte(): string {
  const value = message.value.trim();
  return /^(?:[0-9a-fA-F]{2})+$/.test(value) && value.length <= MAX_MESSAGE_BYTES * 2 ? '0x' + value.slice(-2).toLowerCase() : '—';
}

function record(rowId: string, outcome: VerificationResult): void {
  const row = element<HTMLTableRowElement>(rowId);
  (row.querySelector('.byte') as HTMLElement).textContent = lastByte();
  const cell = row.querySelector('.outcome') as HTMLElement;
  cell.textContent = outcome.valid ? 'Valid' : `Not valid (${outcome.reason})`;
  cell.dataset.valid = String(outcome.valid);
}

/** Verifies the current fields and shows the result. Outer whitespace (a pasted newline) is ignored. */
function verify(): VerificationResult {
  const before = resourceCount();
  const started = performance.now();
  const outcome = verifyMlDsa87({ publicKey: publicKey.value.trim(), message: message.value.trim(), signature: signature.value.trim() });
  const elapsed = performance.now() - started;
  const requests = resourceCount() - before;

  result.dataset.state = outcome.valid ? 'valid' : 'invalid';
  result.dataset.reason = outcome.valid ? '' : outcome.reason;
  result.dataset.requests = String(requests);
  resultTitle.textContent = outcome.valid ? '✓ Signature is valid' : '✗ Signature is not valid';
  resultDetail.textContent = outcome.valid
    ? 'The signature matches this public key and message under ML-DSA-87.'
    : REASONS[outcome.reason];
  resultMeta.textContent = `Checked in this browser in ${elapsed.toFixed(1)} ms · network requests during the check: ${requests}`;
  return outcome;
}

function loadVector(): void {
  publicKey.value = OFFICIAL_VECTOR.publicKey;
  message.value = OFFICIAL_VECTOR.message;
  signature.value = OFFICIAL_VECTOR.signature;
  vectorSource.textContent = `Loaded from ${OFFICIAL_VECTOR.source}. Public values only.`;
  updateCounts();
  record('cmp-original', verify());
}

function flipByte(): void {
  const value = message.value.trim();
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(value) || value.length > MAX_MESSAGE_BYTES * 2) {
    record('cmp-changed', verify());
    return;
  }
  const last = Number.parseInt(value.slice(-2), 16) ^ 0x01;
  message.value = value.slice(0, -2) + last.toString(16).padStart(2, '0');
  updateCounts();
  record('cmp-changed', verify());
}

function tryOversized(): void {
  message.value = '00'.repeat(MAX_MESSAGE_BYTES + 1);
  updateCounts();
  verify();
}

function clearAll(): void {
  publicKey.value = '';
  message.value = '';
  signature.value = '';
  vectorSource.textContent = '';
  updateCounts();
  result.dataset.state = 'idle';
  result.dataset.reason = '';
  result.dataset.requests = '';
  resultTitle.textContent = 'No verification yet';
  resultDetail.textContent = 'Load the official test vector or paste your own values, then verify.';
  resultMeta.textContent = '';
}

element('load-vector').addEventListener('click', loadVector);
element('verify').addEventListener('click', () => { verify(); });
element('flip-byte').addEventListener('click', flipByte);
element('oversized').addEventListener('click', tryOversized);
element('clear').addEventListener('click', clearAll);
for (const field of [publicKey, message, signature]) field.addEventListener('input', updateCounts);
updateCounts();
document.documentElement.dataset.ready = 'true';
