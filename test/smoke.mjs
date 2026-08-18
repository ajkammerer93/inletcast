// Smoke tests: three data scenarios (live / offline / mixed) against the real app.
// Run: node smoke.mjs   (from the test/ directory)
import { loadApp, assert } from './harness.mjs';
import { makeFetchStub } from './fixtures.mjs';

const results = [];
async function scenario(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  PASS ${name}`);
  } catch (e) {
    results.push({ name, ok: false, err: e });
    console.log(`  FAIL ${name}\n    ${String(e.stack || e).split('\n').slice(0, 6).join('\n    ')}`);
  }
}

function noFatal(errors) {
  const fatal = errors.filter((e) => !/AbortError|aborted/i.test(e));
  assert(fatal.length === 0, 'page errors: ' + fatal.slice(0, 3).join(' | '));
}

await scenario('live: all sources up -> live badge, 7 inlet cards, no page errors', async () => {
  const { window, document, errors } = await loadApp({ fetchStub: makeFetchStub() });
  noFatal(errors);
  const cards = document.querySelectorAll('#view-inlets .card, .cardgrid .card');
  assert(cards.length >= 7, `found ${cards.length} inlet cards, want >= 7`);
  const badge = document.getElementById('modeBadge') || document.querySelector('.mode-badge');
  assert(badge && /live data/i.test(badge.textContent), `badge says "${badge && badge.textContent}"`);
  const watermarks = [...document.querySelectorAll('svg text')].filter((t) => t.textContent === 'DEMO DATA');
  assert(watermarks.length === 0, 'DEMO watermark should not appear in live mode');
  window.close();
});

await scenario('offline: all sources down -> demo mode clearly labeled, app still renders', async () => {
  const { window, document, errors } = await loadApp({ fetchStub: makeFetchStub(() => true) });
  noFatal(errors);
  const cards = document.querySelectorAll('#view-inlets .card, .cardgrid .card');
  assert(cards.length >= 7, `found ${cards.length} inlet cards, want >= 7`);
  const badge = document.getElementById('modeBadge') || document.querySelector('.mode-badge');
  assert(badge && /demo/i.test(badge.textContent), `badge says "${badge && badge.textContent}"`);
  window.close();
});

await scenario('mixed: one inlet source down -> mixed mode surfaced', async () => {
  let pointMarineCalls = 0;
  const stub = makeFetchStub((url) => {
    if (url.includes('marine-api') && url.includes('wave_height')) {
      pointMarineCalls++;
      return pointMarineCalls === 1; // fail exactly the first inlet's wave fetch
    }
    return false;
  });
  const { window, document, errors } = await loadApp({ fetchStub: stub });
  noFatal(errors);
  const badge = document.getElementById('modeBadge') || document.querySelector('.mode-badge');
  assert(badge && /partial/i.test(badge.textContent), `badge says "${badge && badge.textContent}"`);
  window.close();
});

const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\n${failed.length}/${results.length} scenarios FAILED` : `\nAll ${results.length} scenarios passed`);
process.exit(failed.length ? 1 : 0);
