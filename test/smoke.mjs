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
  // Method honesty list names the offshore-planner gaps
  const method = text(document, '#methodBody') || '';
  assert(/wind against the Stream/i.test(method), 'Method lists the wind-against-the-Stream limitation');
  assert(/thunderstorm/i.test(method), 'Method lists the missing convection/thunderstorm input');
  // detail view: bar-breaking factor chip and tide-timing caveat are user-visible
  cards[0].click();
  const detail = document.getElementById('view-detail');
  assert(/Bar break/.test(detail.textContent), 'detail "why" panel shows the bar-breaking penalty chip');
  assert(/slack at the mouth can lag/.test(detail.textContent), 'detail tide panel carries the station-timing caveat');
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

await scenario('terms & copy: footer terms link, binding language, attribution, no go-signal or stale-outlook copy', async () => {
  const { window, document, errors } = await loadApp({ fetchStub: makeFetchStub() });
  noFatal(errors);
  // footer links to the terms section; the section carries the binding language
  const link = document.querySelector('footer.disc a[href="#view-terms"]');
  assert(link, 'footer carries a Terms of Use link');
  const terms = document.getElementById('view-terms');
  assert(terms, '#view-terms section exists');
  assert(/as is/i.test(terms.textContent), 'terms contain AS-IS language');
  assert(/assumption of risk/i.test(terms.textContent), 'terms contain assumption-of-risk language');
  assert(/maximum extent permitted/i.test(terms.textContent), 'terms contain limitation-of-liability language');
  assert(/North Carolina/.test(terms.textContent), 'terms name NC governing law');
  assert(/no cookies, no analytics, no tracking/i.test(terms.textContent), 'terms carry the privacy note');
  // clicking the footer link opens the terms view in-app
  link.click();
  assert(terms.classList.contains('active'), 'terms link activates the terms view');
  // footer: NOAA non-affiliation + live Open-Meteo attribution link
  const footer = document.querySelector('footer.disc');
  assert(/not affiliated with, operated by, or endorsed by NOAA/.test(footer.textContent), 'footer disclaims NOAA affiliation');
  const om = footer.querySelector('a[href="https://open-meteo.com/"]');
  assert(om && /CC BY 4.0/.test(footer.textContent), 'footer carries the Open-Meteo CC BY 4.0 attribution link');
  // banner is the acknowledgment and links to the terms
  const banner = document.getElementById('banner');
  assert(banner && /accept the/.test(banner.textContent) && banner.querySelector('a[href="#view-terms"]'), 'banner carries the Terms acknowledgment link');
  // Method copy: condition-descriptive classes, no NOAA-insider claim, LLC named consistently
  const method = text(document, '#methodBody') || '';
  assert(!/handles comfortably/.test(method), 'class definitions no longer warrant boat suitability');
  assert(/below the thresholds this tool uses/.test(method), 'Favorable is defined by thresholds, not suitability');
  assert(!/we verify NOAA operational models/.test(method), 'Method drops the NOAA-insider verification claim');
  assert(/standard way operational marine models are verified/.test(method), 'Method keeps the verification promise, reworded');
  assert(!/paid SST chart services sell/.test(method), 'MUR claim softened');
  assert(!/Ghosttree Technical Solutions —/.test(method), 'Method names the LLC in full');
  // detail view: sample outlook is tagged and carries no weekday advice or update-cadence claim
  const cards = document.querySelectorAll('#inletCards .card');
  cards[0].click();
  const detail = document.getElementById('view-detail').textContent;
  assert(/SAMPLE — illustrative, not a current forecast/.test(detail), 'outlook panel tagged as a sample');
  assert(!/Monday and Thursday/.test(detail), 'outlook drops the false update-cadence claim');
  assert(!/Thursday is a legitimate Gulf Stream day/.test(detail), 'outlook drops weekday-specific advice');
  assert(!/In a window now/.test(detail), 'go-signal window phrasing removed');
  // map SST legend shows the MUR analysis date (from the fixture time)
  const legend = document.querySelector('.sstlegend');
  assert(legend && /analysis 2026-08-17/.test(legend.textContent), 'SST legend shows the MUR analysis date');
  window.close();
});

await scenario('banner: dismissal persists across reloads via localStorage', async () => {
  const first = await loadApp({ fetchStub: makeFetchStub() });
  noFatal(first.errors);
  assert(first.document.getElementById('banner'), 'banner shows on a first visit');
  first.document.getElementById('bannerClose').click();
  assert(!first.document.getElementById('banner'), 'banner is removed after dismissal');
  // carry the first window's localStorage into a fresh load, like a returning visitor
  const seed = {};
  const ls = first.window.localStorage;
  for (let i = 0; i < ls.length; i++) { const k = ls.key(i); seed[k] = ls.getItem(k); }
  assert(Object.keys(seed).length > 0, 'dismissal wrote a localStorage flag');
  first.window.close();
  const second = await loadApp({ fetchStub: makeFetchStub(), localStorageSeed: seed });
  noFatal(second.errors);
  assert(!second.document.getElementById('banner'), 'banner stays dismissed on the next load');
  // a clean visitor still gets the banner
  const third = await loadApp({ fetchStub: makeFetchStub() });
  assert(third.document.getElementById('banner'), 'banner still shows without the stored flag');
  second.window.close(); third.window.close();
});

const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\n${failed.length}/${results.length} scenarios FAILED` : `\nAll ${results.length} scenarios passed`);
process.exit(failed.length ? 1 : 0);
