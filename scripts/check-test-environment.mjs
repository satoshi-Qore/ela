// Runs before `npm test` (npm's pretest hook) and stops with a clear message when the test
// environment cannot run the whole suite, instead of letting tests fail or skip later.
//
// - Node.js 24.6.0 or newer: node:crypto supports ML-DSA keys, signing, and verification from 24.6.0
//   (OpenSSL 3.5); tests/pqc-ml-dsa-87.test.mjs uses it as an independent ML-DSA-87 verifier.
// - Chrome or Chromium: required when ELA_REQUIRE_CHROME=1 or CI=true, so the browser tests in
//   tests/pqc-browser.test.mjs cannot be skipped silently in CI.
// The live Diana test stays skipped unless ELA_LIVE=1 is set; this script makes no network request.

import { generateKeyPairSync } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const MINIMUM = [24, 6, 0];
const problems = [];

const current = process.versions.node.split('.').map(Number);
const older = MINIMUM.findIndex((part, index) => current[index] !== part);
if (older !== -1 && current[older] < MINIMUM[older]) {
  problems.push(`Node.js ${process.versions.node} is too old: the tests need ${MINIMUM.join('.')} or newer (ML-DSA in node:crypto).`);
} else {
  try {
    generateKeyPairSync('ml-dsa-87');
  } catch {
    problems.push(`Node.js ${process.versions.node} (OpenSSL ${process.versions.openssl}) has no ML-DSA-87 support in node:crypto.`);
  }
}

const requireChrome = process.env.ELA_REQUIRE_CHROME === '1' || process.env.CI === 'true';
const chrome = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].find(path => path && existsSync(path));
if (requireChrome && !chrome) problems.push('Chrome or Chromium is required (ELA_REQUIRE_CHROME=1 or CI=true) but was not found. Set CHROME_PATH.');

if (problems.length > 0) {
  for (const problem of problems) console.error('Test environment: ' + problem);
  process.exit(1);
}
console.log(`Test environment: Node.js ${process.versions.node}, OpenSSL ${process.versions.openssl}, browser ${chrome ?? 'not found (browser tests will be skipped; set ELA_REQUIRE_CHROME=1 to require one)'}, live Diana test ${process.env.ELA_LIVE === '1' ? 'enabled' : 'skipped'}.`);
