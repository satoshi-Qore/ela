// Reuse the real-browser characterization harness and its explicitly scripted RPC fixture.
// No fixture is included in the application build, and qore.host is blocked in this browser.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const testFile = new URL('../tests/ui-characterization.test.mjs', import.meta.url);
let harness = readFileSync(testFile, 'utf8').split('// --- Expected texts')[0];
harness = harness.replaceAll(/from '(\.\/[^']+)'/g, (_, p) => `from '${new URL(p, testFile).href}'`)
  .replace("fileURLToPath(new URL('..', import.meta.url))", JSON.stringify(root))
  .replace("import('vite')", `import('${import.meta.resolve('vite')}')`);
const live = process.env.ELA_AUDIT_LIVE === '1';
if (live) {
  // A separately requested read-only live smoke check. Record requests without substituting replies.
  harness = harness.replace("urls: ['*qore.host*']", 'urls: []').replace('source: RPC_STUB', `source: ${JSON.stringify(`(() => { window.__rpc = { mode: 'live', calls: [] }; const original = window.fetch; window.fetch = (input, init) => { let body; try { body = JSON.parse(init?.body); } catch {} window.__rpc.calls.push({ method: body?.method }); return original(input, init); }; })();`)}`);
}
const api = await import('data:text/javascript;base64,' + Buffer.from(harness + '\nexport { startBrowser, stopBrowser, openPage, submit, evaluate, env };').toString('base64'));
const out = resolve(root, process.env.ELA_AUDIT_DIR || 'docs/screenshots/sapphire');
mkdirSync(out, { recursive: true });
const report = [];
try {
  await api.startBrowser();
  const metrics = async (width, scale = 1) => {
    await api.env.page.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 768 });
    await api.evaluate(`document.documentElement.style.fontSize = '${scale * 100}%'`);
  };
  const settle = () => api.evaluate(`(async () => {
    const start = Date.now();
    while (!document.querySelector('#core-viz svg') || document.querySelector('#core-viz').dataset.pending) {
      if (Date.now() - start > 5000) throw new Error('Core did not settle for capture');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  })()`);
  const shot = async (name, selector) => {
    await settle();
    if (name.includes('fixture')) await api.evaluate(`(() => {
      const label = document.createElement('div'); label.id = 'audit-fixture-label';
      label.textContent = 'TEST FIXTURE · Scripted RPC · Not live chain data';
      label.style.cssText = 'position:fixed;top:8px;right:8px;z-index:99999;max-width:95%;padding:10px 14px;background:#fff0b5;color:#352500;border:1px solid #9b7000;border-radius:5px;font:600 13px/1.4 Arial,sans-serif';
      document.body.append(label);
    })()`);
    const clip = selector ? await api.evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height, scale: 1 }; })()`) : undefined;
    const { data } = await api.env.page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, ...(clip ? { clip } : {}) });
    writeFileSync(resolve(out, name + '.png'), Buffer.from(data, 'base64'));
    await api.evaluate(`document.getElementById('audit-fixture-label')?.remove()`);
  };
  await api.openPage();
  await metrics(1440);
  if (live) {
    const result = await api.submit('Check Diana network.');
    await shot('live-diana-' + result.stateKey);
    writeFileSync(resolve(out, 'live.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ live: true, state: result.stateKey, message: result.message, rpc: result.rpc }));
    process.exitCode = result.stateKey === 'success' ? 0 : 1;
  } else {
  await shot('desktop-waiting');
  await shot('desktop-core', '.core');
  if (process.env.ELA_AUDIT_BASELINE !== '1') {
    for (const [name, command, mode] of [
      ['success-fixture', 'Check Diana network.', 'ok'],
      ['blocked', 'Send 10 QOR.', 'ok'],
      ['network-error-fixture', 'Check Diana network.', 'http_500'],
    ]) {
      await api.openPage(mode);
      const result = await api.submit(command);
      await shot(name);
      report.push({ name, state: result.stateKey, rpc: result.rpc });
    }
    for (const width of [320, 360, 390, 430, 768, 1440]) {
      for (const scale of [1, 1.5, 2]) {
        for (const lang of ['en', 'tr']) {
          for (const theme of ['light', 'dark', 'blue']) {
            await metrics(width, scale);
            await api.evaluate(`document.querySelector('[data-lang="${lang}"]').click(); document.querySelector('#theme-switch [data-theme="${theme}"]').click()`);
            await settle();
            const result = await api.evaluate(`(() => {
              const width = document.documentElement.clientWidth;
              const outside = [...document.querySelectorAll('body *')].filter(e => {
                const b = e.getBoundingClientRect(); const s = getComputedStyle(e);
                return s.visibility !== 'hidden' && b.width > 0 && (b.right > width + 1 || b.left < -1);
              }).map(e => e.id || e.tagName + '.' + (e.className.baseVal ?? e.className));
              const wide = [...document.querySelectorAll('body *')].filter(e => e.clientWidth > 0 && e.scrollWidth > e.clientWidth + 1).map(e => [e.id || e.tagName + '.' + e.className, e.clientWidth, e.scrollWidth]);
              const squeezed = [];
              const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
              while (walker.nextNode()) {
                const node = walker.currentNode, e = node.parentElement;
                if (!e || ['SCRIPT','STYLE'].includes(e.tagName) || !e.getBoundingClientRect().height) continue;
                const text = node.textContent.trim(); if (text.length < 8) continue;
                const range = document.createRange(); range.selectNodeContents(node);
                const lines = new Set([...range.getClientRects()].filter(r => r.width > 0).map(r => Math.round(r.top))).size;
                if (lines >= 3 && text.length / lines < 6) squeezed.push(e.className + ': ' + text.slice(0, 30));
              }
              return { scrollWidth: document.documentElement.scrollWidth, outside, wide, squeezed };
            })()`);
            report.push({ width, scale, lang, theme, ...result });
          }
        }
      }
    }
    await api.openPage();
    await metrics(390, 2);
    await api.evaluate(`document.querySelector('[data-lang="tr"]').click()`);
    await shot('mobile-200-tr');
    await shot('mobile-200-core', '.core');
    await api.openPage(); await metrics(390);
    await shot('mobile-waiting');
    await api.evaluate(`document.querySelector('#pqc-toggle').click()`);
    await shot('mobile-verifier');
    for (const theme of ['light', 'dark']) {
      await api.openPage(); await metrics(1440);
      await api.evaluate(`document.querySelector('#theme-switch [data-theme="${theme}"]').click()`);
      await shot('desktop-' + theme);
    }
  }
  writeFileSync(resolve(out, 'audit.json'), JSON.stringify(report, null, 2));
  const failures = report.filter(r => r.outside?.length || r.squeezed?.length || r.scrollWidth > r.width + 1);
  console.log(JSON.stringify({ out, cases: report.length, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
  }
} finally { await api.stopBrowser(); }
