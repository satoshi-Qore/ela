import { createCipheriv, pbkdf2Sync } from 'node:crypto';
import { keccak256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export function makeKeystore(privateKey, password, { salt, iv, id, iterations }) {
  const derived = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  try {
    const cipher = createCipheriv('aes-128-ctr', derived.subarray(0, 16), iv);
    const ciphertext = Buffer.concat([cipher.update(privateKey), cipher.final()]);
    const macInput = Buffer.concat([derived.subarray(16), ciphertext]);
    try {
      return {
        version: 3,
        id,
        address: privateKeyToAccount(toHex(privateKey)).address.slice(2).toLowerCase(),
        crypto: {
          cipher: 'aes-128-ctr',
          cipherparams: { iv: iv.toString('hex') },
          ciphertext: ciphertext.toString('hex'),
          kdf: 'pbkdf2',
          kdfparams: { c: iterations, dklen: 32, prf: 'hmac-sha256', salt: salt.toString('hex') },
          mac: keccak256(toHex(macInput)).slice(2),
        },
      };
    } finally {
      macInput.fill(0);
    }
  } finally {
    derived.fill(0);
  }
}
