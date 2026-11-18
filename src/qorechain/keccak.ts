/**
 * Keccak-256 (the Ethereum variant, padding 0x01) for one short message, used only to check EIP-55
 * address checksums. No dependency. Single block: the message must be shorter than the 136-byte
 * rate, which a 40-character address always is.
 */

const MASK = (1n << 64n) - 1n;
const rotl = (v: bigint, n: number): bigint => n === 0 ? v : ((v << BigInt(n)) | (v >> BigInt(64 - n))) & MASK;

// Round constants from the standard LFSR.
const RC: bigint[] = [];
for (let round = 0, r = 1; round < 24; round++) {
  let rc = 0n;
  for (let j = 0; j < 7; j++) {
    r = ((r << 1) ^ ((r >> 7) * 0x71)) % 256;
    if (r & 2) rc ^= 1n << ((1n << BigInt(j)) - 1n);
  }
  RC.push(rc);
}

function permute(a: bigint[]): void {
  for (let round = 0; round < 24; round++) {
    // θ
    const c = [0, 1, 2, 3, 4].map(x => a[x]! ^ a[x + 5]! ^ a[x + 10]! ^ a[x + 15]! ^ a[x + 20]!);
    for (let x = 0; x < 5; x++) {
      const d = c[(x + 4) % 5]! ^ rotl(c[(x + 1) % 5]!, 1);
      for (let y = 0; y < 25; y += 5) a[x + y]! ^= d;
    }
    // ρ and π
    let x = 1, y = 0, current = a[1]!;
    for (let t = 0; t < 24; t++) {
      [x, y] = [y, (2 * x + 3 * y) % 5];
      const next = a[x + 5 * y]!;
      a[x + 5 * y] = rotl(current, ((t + 1) * (t + 2) / 2) % 64);
      current = next;
    }
    // χ
    for (let y5 = 0; y5 < 25; y5 += 5) {
      const row = a.slice(y5, y5 + 5);
      for (let i = 0; i < 5; i++) a[y5 + i] = row[i]! ^ (~row[(i + 1) % 5]! & MASK & row[(i + 2) % 5]!);
    }
    // ι
    a[0]! ^= RC[round]!;
  }
}

/** Keccak-256 of `message` (under 136 bytes) as 64 lower-case hex digits. */
export function keccak256(message: Uint8Array): string {
  if (message.length >= 136) throw new RangeError('keccak256 here takes one block of under 136 bytes.');
  const block = new Uint8Array(136);
  block.set(message);
  block[message.length]! ^= 0x01;
  block[135]! ^= 0x80;
  const a: bigint[] = new Array(25).fill(0n);
  for (let i = 0; i < 17; i++) {
    let lane = 0n;
    for (let b = 7; b >= 0; b--) lane = (lane << 8n) | BigInt(block[i * 8 + b]!);
    a[i] = lane;
  }
  permute(a);
  let out = '';
  for (let i = 0; i < 4; i++) for (let b = 0; b < 8; b++) out += Number((a[i]! >> BigInt(8 * b)) & 0xffn).toString(16).padStart(2, '0');
  return out;
}

/**
 * Checks a 0x address of 40 hex digits: all lower case and all upper case carry no checksum and are
 * accepted; mixed case must match its EIP-55 checksum. Returns the address in lower case, or
 * `undefined` when it is not a valid address.
 */
export function checkAddress(value: string): string | undefined {
  if (!/^0x[0-9a-fA-F]{40}$/u.test(value)) return undefined;
  const hex = value.slice(2);
  const lower = hex.toLowerCase();
  if (hex === lower || hex === hex.toUpperCase()) return '0x' + lower;
  const hash = keccak256(new TextEncoder().encode(lower));
  for (let i = 0; i < 40; i++) {
    const letter = lower[i]!;
    if (letter >= 'a' && (parseInt(hash[i]!, 16) >= 8 ? letter.toUpperCase() : letter) !== hex[i]) return undefined;
  }
  return '0x' + lower;
}
