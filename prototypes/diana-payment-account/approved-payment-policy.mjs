/** Explicit user approval from ELA 7I-3. Public policy only, never transaction authority. */
export const APPROVED_PAYMENT_POLICY = Object.freeze({
  version: 1,
  approvalStatus: 'approved',
  approvalSource: 'Explicit user instruction ELA 7I-3, 2026-11-20',
  approvalScope: 'fixed policy and seven-day duration; exact timestamps excluded',
  executionAuthorized: false,
  network: Object.freeze({chainId:'qorechain-diana',evmChainId:9800}),
  parameters: Object.freeze({
    executor: '0x6a5d4D7B3357df968b2A3004071eCe98f015C794',
    invoiceIssuer: '0x6a5d4D7B3357df968b2A3004071eCe98f015C794',
    recipient: '0xc9Ab55FeC7c1fEe27F3AFc5DF99E6A09b4B2D875',
    maxPerPayment: 1000000000000000n,
    spendingLimit: 3000000000000000n,
    maxPayments: 3n,
  }),
  timing: Object.freeze({
    startRule: 'deployment-day',
    timeZone: 'Europe/Istanbul',
    approvalStatus: 'pending',
    approvalSource: null,
    durationSeconds: 604800n,
    startsAt: null,
    endsAt: null,
  }),
});
