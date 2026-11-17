import { MAX_MESSAGE_BYTES, ML_DSA_87_PUBLIC_KEY_BYTES, ML_DSA_87_SIGNATURE_BYTES, verifyMlDsa87 } from './verify-ml-dsa-87.ts';
import type { VerificationFailure, VerificationResult } from './verify-ml-dsa-87.ts';
import { OFFICIAL_VECTOR } from './demo/official-vector.ts';

// Post-quantum verification panel of the ELA interface. This module is loaded only when the panel
// is opened (a dynamic import in web.ts), so it and the ML-DSA-87 code form a separate chunk.
// It verifies public values in this browser with the existing verifier: no signing, no secret key
// input, and no network code.

const REASONS: Record<VerificationFailure, string> = {
  signature_mismatch: 'The signature does not match this public key and message.',
  invalid_encoding: 'A field is not valid hexadecimal text. Use 0–9 and a–f only, without a 0x prefix or spaces.',
  invalid_public_key_length: `The public key must be exactly ${ML_DSA_87_PUBLIC_KEY_BYTES} bytes (${ML_DSA_87_PUBLIC_KEY_BYTES * 2} hex characters).`,
  invalid_signature_length: `The signature must be exactly ${ML_DSA_87_SIGNATURE_BYTES} bytes (${ML_DSA_87_SIGNATURE_BYTES * 2} hex characters).`,
  message_too_large: `The message is larger than ${MAX_MESSAGE_BYTES / 1024} KiB, so it was refused before decoding.`,
  invalid_input: 'The input could not be read.',
  verification_error: 'Verification stopped unexpectedly. The signature is treated as not valid.',
};
const MISSING = 'Fill in the public key and the signature, or load the official test vector.';
const HEX_PAIRS = /^(?:[0-9a-fA-F]{2})*$/;

let mounted = false;

/** Wires the panel's controls inside `root`. Safe to call more than once. */
export function mountPanel(root: HTMLElement): void {
  if (mounted) return;
  mounted = true;
  const element = <T extends HTMLElement>(id: string): T => root.querySelector<T>('#' + id)!;
  const publicKey = element<HTMLTextAreaElement>('pqc-public-key');
  const message = element<HTMLTextAreaElement>('pqc-message');
  const signature = element<HTMLTextAreaElement>('pqc-signature');
  const result = element<HTMLElement>('pqc-result');
  const title = element<HTMLElement>('pqc-result-title');
  const detail = element<HTMLElement>('pqc-result-detail');
  const meta = element<HTMLElement>('pqc-result-meta');

  const size = (text: string): string => {
    const value = text.trim();
    return HEX_PAIRS.test(value) ? value.length / 2 + ' bytes' : 'not hexadecimal';
  };
  // Length gauges: the entered byte length against the fixed ML-DSA-87 size. They show only length,
  // never validity; validity comes from the verifier result alone.
  const gauge = (id: string, text: string, need: number): void => {
    const value = text.trim();
    const bytes = HEX_PAIRS.test(value) ? value.length / 2 : 0;
    const meter = element(id + '-meter');
    meter.style.setProperty('--fill', String(Math.min(1, bytes / need)));
    meter.dataset.fit = bytes === need ? 'exact' : bytes > need ? 'over' : 'under';
  };
  const updateCounts = (): void => {
    element('pqc-public-key-count').textContent = 'hex · ' + size(publicKey.value) + ' · needs ' + ML_DSA_87_PUBLIC_KEY_BYTES;
    element('pqc-message-count').textContent = 'hex · ' + size(message.value) + ' · at most 64 KiB';
    element('pqc-signature-count').textContent = 'hex · ' + size(signature.value) + ' · needs ' + ML_DSA_87_SIGNATURE_BYTES;
    gauge('pqc-public-key', publicKey.value, ML_DSA_87_PUBLIC_KEY_BYTES);
    gauge('pqc-signature', signature.value, ML_DSA_87_SIGNATURE_BYTES);
  };

  const show = (state: 'idle' | 'valid' | 'invalid', heading: string, text: string, reason = '', note = ''): void => {
    result.dataset.state = state;
    result.dataset.reason = reason;
    title.textContent = heading;
    detail.textContent = text;
    meta.textContent = note;
  };

  const record = (id: string, outcome: VerificationResult): void => {
    const cell = element(id);
    cell.textContent = outcome.valid ? 'Valid' : 'Not valid (' + outcome.reason + ')';
    cell.dataset.valid = String(outcome.valid);
  };

  /** Verifies the three fields in this browser and shows the outcome. Outer whitespace is ignored. */
  const verify = (): VerificationResult | undefined => {
    // The counts and gauges always describe the exact values being verified.
    updateCounts();
    const key = publicKey.value.trim();
    const sig = signature.value.trim();
    if (key === '' || sig === '') {
      show('invalid', '✗ Not verified', MISSING, 'missing_input');
      return undefined;
    }
    const before = performance.getEntriesByType('resource').length;
    const started = performance.now();
    const outcome = verifyMlDsa87({ publicKey: key, message: message.value.trim(), signature: sig });
    const elapsed = performance.now() - started;
    const requests = performance.getEntriesByType('resource').length - before;
    const note = `Checked in this browser in ${elapsed.toFixed(1)} ms · network requests during the check: ${requests}`;
    if (outcome.valid) show('valid', '✓ Valid signature', 'The signature matches this public key and message under ML-DSA-87 (FIPS 204).', '', note);
    else show('invalid', '✗ Not valid', REASONS[outcome.reason], outcome.reason, note);
    return outcome;
  };

  element('pqc-load').addEventListener('click', () => {
    publicKey.value = OFFICIAL_VECTOR.publicKey;
    message.value = OFFICIAL_VECTOR.message;
    signature.value = OFFICIAL_VECTOR.signature;
    updateCounts();
    const outcome = verify();
    if (outcome) record('pqc-cmp-original', outcome);
  });

  element('pqc-verify').addEventListener('click', () => { verify(); });

  element('pqc-flip').addEventListener('click', () => {
    const value = message.value.trim();
    if (!/^(?:[0-9a-fA-F]{2})+$/.test(value) || value.length > MAX_MESSAGE_BYTES * 2) {
      show('invalid', '✗ Not verified', 'Load the official test vector or enter a hexadecimal message first.', 'no_message');
      return;
    }
    const last = (Number.parseInt(value.slice(-2), 16) ^ 0x01).toString(16).padStart(2, '0');
    message.value = value.slice(0, -2) + last;
    updateCounts();
    const outcome = verify();
    if (outcome) record('pqc-cmp-changed', outcome);
  });

  element('pqc-oversized').addEventListener('click', () => {
    message.value = '00'.repeat(MAX_MESSAGE_BYTES + 1);
    updateCounts();
    verify();
  });

  element('pqc-clear').addEventListener('click', () => {
    publicKey.value = '';
    message.value = '';
    signature.value = '';
    updateCounts();
    show('idle', 'No verification yet', 'Load the official test vector or paste your own public values, then verify.');
  });

  for (const field of [publicKey, message, signature]) field.addEventListener('input', updateCounts);
  updateCounts();
  element('pqc-loading').hidden = true;
  element('pqc-form').hidden = false;
  root.dataset.ready = 'true';
}
