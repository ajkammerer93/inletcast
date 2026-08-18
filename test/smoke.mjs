// Smoke tests: three data scenarios (live / offline / mixed) against the real app.
// Run: node smoke.mjs   (from the test/ directory)
import { loadApp, assert, text } from './harness.mjs';
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
  // single APP_VERSION drives both the footer and the Method tab
  const fv = (text(document, 'footer.disc') || '').match(/prototype v(\d+\.\d+)/);
  assert(fv, 'footer shows a version string');
  assert(fv[1] === '0.6', `footer version is v${fv && fv[1]}, want v0.6`);
  const mv = (text(document, '#methodBody') || '').match(/prototype v(\d+\.\d+)/);
  assert(mv && mv[1] === fv[1], `Method tab version (${mv && mv[1]}) should match footer (${fv[1]})`);
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

await scenario('mixed: one inlet source down -> mixed mode surfaced, failed card labeled SIMULATED', async () => {
  let pointMarineCalls = 0;
  const stub = makeFetchStub((url) => {
    if (url.includes('marine-api') && url.includes('wave_height')) {
      pointMarineCalls++;
      return pointMarineCalls === 1; // fail exactly the first inlet's wave fetch (New Topsail)
    }
    return false;
  });
  const { window, document, errors } = await loadApp({ fetchStub: stub });
  noFatal(errors);
  const badge = document.getElementById('modeBadge') || document.querySelector('.mode-badge');
  assert(badge && /partial/i.test(badge.textContent), `badge says "${badge && badge.textContent}"`);
  assert(badge.getAttribute('aria-live') === 'polite', 'mode badge has aria-live="polite"');
  // the failed inlet's card carries the simulated label and no window claim
  const cards = [...document.querySelectorAll('#inletCards .card')];
  assert(cards.length >= 7, `found ${cards.length} inlet cards, want >= 7`);
  const failedCard = cards.find((c) => /New Topsail/.test(c.textContent));
  assert(failedCard, 'New Topsail card exists');
  assert(/SIMULATED/.test(failedCard.textContent), 'failed card shows SIMULATED chip');
  assert(/Data unavailable — check official NWS forecasts/.test(failedCard.textContent), 'failed card points to official NWS forecasts');
  assert(!/Next window|In a window now/.test(failedCard.textContent), 'failed card must not claim a window');
  // live cards must NOT carry the simulated label
  const liveCards = cards.filter((c) => c !== failedCard);
  for (const c of liveCards) assert(!/SIMULATED/.test(c.textContent), 'live card wrongly labeled SIMULATED');
  // detail view of the failed inlet repeats the label in its header
  failedCard.click();
  const detail = document.getElementById('view-detail');
  assert(/SIMULATED/.test(detail.querySelector('.detailhead').textContent), 'detail header shows SIMULATED chip');
  // badge expands to list exactly which source fell back
  badge.click();
  const src = document.getElementById('modeSources');
  assert(src && !src.hasAttribute('hidden'), 'badge click opens the source list');
  assert(badge.getAttribute('aria-expanded') === 'true', 'aria-expanded reflects open state');
  assert(/New Topsail/.test(src.textContent), 'source list names the failed inlet');
  assert(!/Masonboro/.test(src.textContent), 'source list does not name live inlets');
  window.close();
});

await scenario('tides down: synthetic tide labeled, excluded from score, stations listed in badge', async () => {
  const stub = makeFetchStub((url) => url.includes('tidesandcurrents.noaa.gov'));
  const { window, document, errors } = await loadApp({ fetchStub: stub });
  noFatal(errors);
  const badge = document.getElementById('modeBadge');
  assert(badge && /partial/i.test(badge.textContent), `badge says "${badge && badge.textContent}"`);
  // every card's tide stat reports no data instead of a fabricated phase
  const cards = [...document.querySelectorAll('#inletCards .card')];
  assert(cards.length >= 7, `found ${cards.length} inlet cards, want >= 7`);
  for (const c of cards) assert(/No data/.test(c.textContent), 'card tide stat shows "No data"');
  // every inlet's tide panel is labeled simulated and never claims CO-OPS
  for (const c of cards) {
    c.click();
    const detail = document.getElementById('view-detail');
    assert(/SIMULATED TIDE — do not use for timing/.test(detail.textContent), 'tide panel labeled SIMULATED TIDE');
    assert(!/NOAA CO-OPS predictions/.test(detail.textContent), 'synthetic tide must not be labeled NOAA CO-OPS');
    assert(/tide unavailable — excluded/.test(detail.textContent), 'tide term shown as excluded from the score');
  }
  // badge lists all three fallen-back tide stations
  badge.click();
  const src = document.getElementById('modeSources');
  assert(src && !src.hasAttribute('hidden'), 'badge click opens the source list');
  for (const sta of ['8658163', '8659084', '8656483']) {
    assert(src.textContent.includes(sta), `source list names tide station ${sta}`);
  }
  window.close();
});

const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\n${failed.length}/${results.length} scenarios FAILED` : `\nAll ${results.length} scenarios passed`);
process.exit(failed.length ? 1 : 0);
