import { MAX_MESSAGE_BYTES, ML_DSA_87_PUBLIC_KEY_BYTES, ML_DSA_87_SIGNATURE_BYTES, verifyMlDsa87 } from './verify-ml-dsa-87.ts';
import type { VerificationResult } from './verify-ml-dsa-87.ts';
import { OFFICIAL_VECTOR } from './demo/official-vector.ts';
import type { Format, Put } from '../web.ts';

// Post-quantum verification panel of the ELA interface. This module is loaded only when the panel
// is opened (a dynamic import in web.ts), so it and the ML-DSA-87 code form a separate chunk.
// It verifies public values in this browser with the existing verifier: no signing, no secret key
// input, and no network code.
//
// Its text comes from the page's #ela-i18n catalog ("pqc.*" keys) through `put` and `format` from
// web.ts, so a language switch rewrites the shown result without verifying again. Failure reason
// codes (for example signature_mismatch) are technical and stay as they are in both languages.

const SIZES = {
  pk: ML_DSA_87_PUBLIC_KEY_BYTES, pkHex: ML_DSA_87_PUBLIC_KEY_BYTES * 2,
  sig: ML_DSA_87_SIGNATURE_BYTES, sigHex: ML_DSA_87_SIGNATURE_BYTES * 2,
  kib: MAX_MESSAGE_BYTES / 1024,
};
const REASONS = new Set(['signature_mismatch', 'invalid_encoding', 'invalid_public_key_length', 'invalid_signature_length', 'message_too_large', 'invalid_input', 'verification_error']);
const HEX_PAIRS = /^(?:[0-9a-fA-F]{2})*$/;

let mounted = false;

/** Wires the panel's controls inside `root`. Safe to call more than once. */
export function mountPanel(root: HTMLElement, put: Put, format: Format): void {
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
    return HEX_PAIRS.test(value) ? format('pqc.bytes', { n: value.length / 2 }) : format('pqc.notHex');
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
  const count = (id: string, key: string, value: string, need?: number): void =>
    put(element(id + '-count'), () => format(key, { size: size(value), need: need! }));
  const updateCounts = (): void => {
    count('pqc-public-key', 'pqc.count', publicKey.value, ML_DSA_87_PUBLIC_KEY_BYTES);
    count('pqc-message', 'pqc.countMsg', message.value);
    count('pqc-signature', 'pqc.count', signature.value, ML_DSA_87_SIGNATURE_BYTES);
    gauge('pqc-public-key', publicKey.value, ML_DSA_87_PUBLIC_KEY_BYTES);
    gauge('pqc-signature', signature.value, ML_DSA_87_SIGNATURE_BYTES);
  };

  const show = (state: 'idle' | 'valid' | 'invalid', heading: string, text: string, reason = '', note: Partial<Record<'ms' | 'n', string | number>> = {}): void => {
    result.dataset.state = state;
    result.dataset.reason = reason;
    put(title, heading);
    put(detail, () => format(text, SIZES));
    put(meta, () => (note.ms === undefined ? '' : format('pqc.meta', note)));
  };

  const record = (id: string, outcome: VerificationResult): void => {
    const cell = element(id);
    put(cell, outcome.valid ? 'pqc.cmp.valid' : () => format('pqc.cmp.invalid', { reason: outcome.reason }));
    cell.dataset.valid = String(outcome.valid);
  };

  /** Verifies the three fields in this browser and shows the outcome. Outer whitespace is ignored. */
  const verify = (): VerificationResult | undefined => {
    // The counts and gauges always describe the exact values being verified.
    updateCounts();
    const key = publicKey.value.trim();
    const sig = signature.value.trim();
    if (key === '' || sig === '') {
      show('invalid', 'pqc.r.notVerified', 'pqc.r.missing', 'missing_input');
      return undefined;
    }
    const before = performance.getEntriesByType('resource').length;
    const started = performance.now();
    const outcome = verifyMlDsa87({ publicKey: key, message: message.value.trim(), signature: sig });
    const elapsed = performance.now() - started;
    const requests = performance.getEntriesByType('resource').length - before;
    const note = { ms: elapsed.toFixed(1), n: requests };
    if (outcome.valid) show('valid', 'pqc.r.valid', 'pqc.r.validD', '', note);
    // A reason without its own text gets the generic "not valid" explanation, never a guess.
    else show('invalid', 'pqc.r.notValid', 'pqc.why.' + (REASONS.has(outcome.reason) ? outcome.reason : 'verification_error'), outcome.reason, note);
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
      show('invalid', 'pqc.r.notVerified', 'pqc.r.noMessage', 'no_message');
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
    show('idle', 'pqc.r.idleT', 'pqc.r.idleD');
  });

  for (const field of [publicKey, message, signature]) field.addEventListener('input', updateCounts);
  updateCounts();
  show('idle', 'pqc.r.idleT', 'pqc.r.idleD');
  for (const id of ['pqc-cmp-original', 'pqc-cmp-changed']) put(element(id), 'fs.idle');
  element('pqc-loading').hidden = true;
  element('pqc-form').hidden = false;
  root.dataset.ready = 'true';
}
