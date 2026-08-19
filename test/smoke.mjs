// Smoke tests: three data scenarios (live / offline / mixed) against the real app.
// Run: node smoke.mjs   (from the test/ directory)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadApp, assert, text } from './harness.mjs';
import { makeFetchStub } from './fixtures.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// copy a window's localStorage into a seed object for the next loadApp
function snapshotStorage(win) {
  const seed = {};
  const ls = win.localStorage;
  for (let i = 0; i < ls.length; i++) { const k = ls.key(i); seed[k] = ls.getItem(k); }
  return seed;
}

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
  assert(fv[1] === '0.7', `footer version is v${fv && fv[1]}, want v0.7`);
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
  // no satellite value pitch when the SST layer is not actually the satellite analysis
  assert(!document.querySelector('#coastPanel .mapvalue'), 'satellite-SST pitch absent when MUR is unreachable');
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
  // the privacy note must count ALL local storage the app actually uses, not just the banner flag
  assert(!/single localStorage flag/i.test(terms.textContent), 'privacy note no longer undercounts storage');
  assert(/theme choice/i.test(terms.textContent), 'privacy note discloses the persisted theme choice');
  assert(/notice banner/i.test(terms.textContent), 'privacy note discloses the banner-dismissal flag');
  assert(/forecast responses/i.test(terms.textContent), 'privacy note discloses the forecast response cache');
  assert(/service worker/i.test(terms.textContent), 'privacy note discloses the service-worker file cache');
  assert(/stays on your device/i.test(terms.textContent), 'privacy note states storage never leaves the device');
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

await scenario('skeleton: fetches never settle -> skeleton cards render immediately', async () => {
  // a fetch that returns a forever-pending promise: nothing settles, nothing hydrates
  const { window, document, errors } = await loadApp({ fetchStub: () => new Promise(() => {}), settleMs: 600 });
  noFatal(errors);
  const skels = document.querySelectorAll('#inletCards .card.skeleton');
  assert(skels.length >= 7, `found ${skels.length} skeleton cards, want >= 7`);
  assert(/Loading forecast/.test(skels[0].textContent), 'skeleton card carries a loading note');
  const badge = document.getElementById('modeBadge');
  assert(/loading/i.test(badge.textContent), 'badge still says Loading while nothing settles');
  window.close();
});

await scenario('incremental hydration: cards fill in while the slow grid fetch is still pending', async () => {
  const base = makeFetchStub();
  const stub = (url) => {
    const s = String(url);
    // hold the map-overlay grid + MUR requests open forever; point + tide fetches resolve
    if (s.includes('sea_surface_temperature') || s.includes('coastwatch')) return new Promise(() => {});
    return base(url);
  };
  const { window, document, errors } = await loadApp({ fetchStub: stub, settleMs: 2000 });
  noFatal(errors);
  const skels = document.querySelectorAll('#inletCards .card.skeleton');
  assert(skels.length === 0, `${skels.length} cards still skeleton after point sources settled`);
  const cards = [...document.querySelectorAll('#inletCards .card')];
  assert(cards.length >= 7, `found ${cards.length} hydrated cards, want >= 7`);
  for (const c of cards.slice(0, 3)) assert(/Seas/.test(c.textContent), 'hydrated card shows current seas');
  // load has NOT finished — cards must not have waited on the slowest request
  const badge = document.getElementById('modeBadge');
  assert(/loading/i.test(badge.textContent), 'badge still loading while the grid fetch hangs');
  window.close();
});

await scenario('hash routing: #/inlet/<id> deep link, back to #/inlets, lazy #/offshore render', async () => {
  const { window, document, errors } = await loadApp({ fetchStub: makeFetchStub() });
  noFatal(errors);
  const firstId = 'newtopsail';
  window.location.hash = '#/inlet/' + firstId;
  window.dispatchEvent(new window.Event('hashchange'));
  const detail = document.getElementById('view-detail');
  assert(detail.classList.contains('active'), 'hash #/inlet/<id> activates the detail view');
  assert(/New Topsail/.test(detail.textContent), 'detail view shows the routed inlet');
  assert(/New Topsail Inlet — InletCast/.test(document.title), `document.title is share-worthy, got "${document.title}"`);
  // tab pattern stays coherent in the detail drill-down: the selected tab controls the VISIBLE panel
  const tabInlets = document.getElementById('tab-inlets');
  assert(tabInlets.getAttribute('aria-selected') === 'true', 'Inlets tab stays selected for the detail view');
  assert(tabInlets.getAttribute('aria-controls') === 'view-detail', 'selected tab points at the visible detail panel');
  assert(detail.getAttribute('role') === 'tabpanel' && detail.getAttribute('aria-labelledby') === 'tab-inlets',
    'detail panel completes the tab pattern');
  // browser back (hash restored) returns to the inlets view
  window.location.hash = '#/inlets';
  window.dispatchEvent(new window.Event('hashchange'));
  assert(document.getElementById('view-inlets').classList.contains('active'), 'back to #/inlets reactivates the list');
  assert(!detail.classList.contains('active'), 'detail view deactivates on back');
  assert(tabInlets.getAttribute('aria-controls') === 'view-inlets', 'tab controls return to the list panel on back');
  // hidden-at-boot views render on first activation via the hash
  window.location.hash = '#/offshore';
  window.dispatchEvent(new window.Event('hashchange'));
  assert(document.getElementById('view-offshore').classList.contains('active'), '#/offshore activates the planner');
  assert(document.getElementById('offshoreBody').textContent.trim().length > 0, 'planner rendered on first activation');
  window.close();
});

await scenario('staleness: old data flips the badge amber; tapping it refreshes', async () => {
  const { window, document, errors } = await loadApp({ fetchStub: makeFetchStub() });
  noFatal(errors);
  window.eval('state.fetchedAt = new Date(Date.now() - 2 * 3600e3);');
  window.eval('updateModeBadge();');
  const badge = document.getElementById('modeBadge');
  assert(badge.classList.contains('stale'), 'badge carries the stale class');
  assert(/stale/i.test(badge.textContent) && /tap to refresh/i.test(badge.textContent), `badge says "${badge.textContent}"`);
  badge.click(); // stale badge is a refresh button
  await new Promise((r) => setTimeout(r, 500));
  assert(/live data/i.test(badge.textContent), `badge after refresh says "${badge.textContent}"`);
  assert(!badge.classList.contains('stale'), 'stale class clears after refresh');
  // fresh badge click opens the source list, which always carries a refresh button
  badge.click();
  const src = document.getElementById('modeSources');
  assert(src && !src.hasAttribute('hidden'), 'fresh badge click opens the source list');
  assert(/Refresh data now/.test(src.textContent), 'source list carries the always-available refresh button');
  window.close();
});

await scenario('theme: choice persists to localStorage and applies before first paint', async () => {
  const first = await loadApp({ fetchStub: makeFetchStub() });
  noFatal(first.errors);
  first.document.getElementById('themeBtn').click();
  const chosen = first.document.documentElement.getAttribute('data-theme');
  assert(chosen === 'dark' || chosen === 'light', `toggle set data-theme="${chosen}"`);
  assert(first.window.localStorage.getItem('inletcast_theme') === chosen, 'theme choice written to localStorage');
  first.window.close();
  // returning visitor: the inline pre-paint script applies the stored theme
  const second = await loadApp({ fetchStub: makeFetchStub(), localStorageSeed: { inletcast_theme: chosen } });
  assert(second.document.documentElement.getAttribute('data-theme') === chosen, 'stored theme applied on reload');
  second.window.close();
});

await scenario('point-of-use help: status chip opens the class-definition popover; boat microcopy shown', async () => {
  const { window, document, errors } = await loadApp({ fetchStub: makeFetchStub() });
  noFatal(errors);
  const note = document.getElementById('boatNote');
  assert(note && /Scored for a 23–27 ft boat/.test(note.textContent), `boat note says "${note && note.textContent}"`);
  assert(note.querySelector('button'), 'boat note carries a change control');
  const chip = document.querySelector('#inletCards .card .chip');
  assert(chip, 'card carries a status chip');
  chip.click();
  const pop = document.querySelector('.clspop');
  assert(pop && pop.style.display === 'block', 'chip click opens the class popover');
  for (const word of ['Favorable', 'Marginal', 'Rough', 'Hazardous']) {
    assert(pop.textContent.includes(word), `popover defines ${word}`);
  }
  assert(/never a statement/.test(pop.textContent), 'popover carries the no-go-signal caveat');
  // the chip click must not have navigated into the detail view
  assert(document.getElementById('view-inlets').classList.contains('active'), 'chip click does not open the card');
  // chips are real controls: keyboard users open the same point-of-use definitions
  assert(chip.getAttribute('role') === 'button', 'status chip has role=button');
  assert(chip.tabIndex === 0, 'status chip is keyboard-focusable');
  assert(chip.getAttribute('aria-label'), 'status chip carries an accessible name');
  pop.style.display = 'none';
  chip.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  assert(pop.style.display === 'block', 'Enter on a chip reopens the popover');
  assert(document.getElementById('view-inlets').classList.contains('active'), 'chip Enter does not open the card');
  window.close();
});

await scenario('cache: a second visit within the TTL serves everything from cache with zero fetches', async () => {
  const stub1 = makeFetchStub();
  const first = await loadApp({ fetchStub: stub1 });
  noFatal(first.errors);
  assert(stub1.calls.length >= 20, `first load made ${stub1.calls.length} fetches, want the full burst`);
  const seed = snapshotStorage(first.window);
  assert(Object.keys(seed).some((k) => k.startsWith('inletcast_api_v1:')), 'first load wrote API responses to the cache');
  first.window.close();
  const stub2 = makeFetchStub();
  const second = await loadApp({ fetchStub: stub2, localStorageSeed: seed });
  noFatal(second.errors);
  assert(stub2.calls.length === 0, `second load made ${stub2.calls.length} fetches, want 0 (everything fresh in cache)`);
  const cards = second.document.querySelectorAll('#inletCards .card');
  assert(cards.length >= 7, `found ${cards.length} cards hydrated from cache, want >= 7`);
  const badge = second.document.getElementById('modeBadge');
  assert(/live data/i.test(badge.textContent), `fresh-cache badge says "${badge.textContent}"`);
  assert(!/SIMULATED/.test(second.document.body.textContent), 'no SIMULATED labels on a fresh-cache load');
  second.window.close();
});

await scenario('offline with a warm (expired) cache: real data labeled CACHED, never SIMULATED', async () => {
  const first = await loadApp({ fetchStub: makeFetchStub() });
  noFatal(first.errors);
  const seed = snapshotStorage(first.window);
  first.window.close();
  // age every cached response past all TTLs (13 h), then go fully offline
  for (const k of Object.keys(seed)) {
    if (!k.startsWith('inletcast_api_v1:')) continue;
    const rec = JSON.parse(seed[k]);
    rec.t = Date.now() - 13 * 3600e3;
    seed[k] = JSON.stringify(rec);
  }
  const offline = await loadApp({ fetchStub: makeFetchStub(() => true), localStorageSeed: seed });
  noFatal(offline.errors);
  const badge = offline.document.getElementById('modeBadge');
  assert(/cached data/i.test(badge.textContent), `badge says "${badge.textContent}"`);
  const cards = [...offline.document.querySelectorAll('#inletCards .card')];
  assert(cards.length >= 7, `found ${cards.length} cards, want >= 7`);
  for (const c of cards) {
    assert(!/SIMULATED/.test(c.textContent), 'card wrongly labeled SIMULATED with a warm cache');
    assert(/CACHED/.test(c.textContent), 'card carries the CACHED chip');
  }
  // cached is real data — no demo watermark, and the detail view explains the state
  const watermarks = [...offline.document.querySelectorAll('svg text')].filter((t) => t.textContent === 'DEMO DATA');
  assert(watermarks.length === 0, 'no DEMO watermark when the cache holds real data');
  cards[0].click();
  const detail = offline.document.getElementById('view-detail');
  assert(/CACHED/.test(detail.querySelector('.detailhead').textContent), 'detail header carries the CACHED chip');
  assert(/last real forecast/.test(detail.textContent), 'detail explains the cached fallback');
  // badge dropdown lists the cached sources
  badge.click();
  const src = offline.document.getElementById('modeSources');
  assert(src && /Cached sources/.test(src.textContent), 'source list explains the cached state');
  offline.window.close();
});

await scenario('cache: first-ever visit offline still lands on clearly-labeled demo mode', async () => {
  // fresh localStorage + dead network: synthetic demo remains the first-visit fallback
  const { window, document, errors } = await loadApp({ fetchStub: makeFetchStub(() => true) });
  noFatal(errors);
  const badge = document.getElementById('modeBadge');
  assert(/demo/i.test(badge.textContent), `badge says "${badge.textContent}"`);
  window.close();
});

await scenario('animation: leaving a view stops its wind-particle canvas', async () => {
  const { window, document, errors } = await loadApp({ fetchStub: makeFetchStub() });
  noFatal(errors);
  window.eval('setView("offshore");');
  const offCv = document.querySelector('#view-offshore canvas');
  assert(offCv, 'offshore map renders a particle canvas');
  window.eval('setView("inlets");');
  assert(offCv.dataset.stop === '1', 'hidden offshore canvas is flagged to stop');
  const inCv = document.querySelector('#view-inlets canvas');
  assert(inCv && inCv.dataset.stop !== '1', 'active-view canvas keeps running');
  window.close();
});

await scenario('pwa & seo: manifest linked, versioned sw precaches the shell, sitemap lists the site', async () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  assert(/<link rel="manifest" href="manifest.json">/.test(html), 'index.html links the manifest');
  const man = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
  assert(man.name && man.short_name === 'InletCast' && man.start_url, 'manifest carries name/short_name/start_url');
  const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
  for (const f of ['index.html', 'css/styles.css', 'js/app.js', 'js/config.js', 'og.png']) {
    assert(sw.includes(`'${f}'`), `sw.js precaches ${f}`);
  }
  assert(/importScripts\('js\/config\.js'\)/.test(sw) && /APP_VERSION/.test(sw), 'sw cache name is versioned from APP_VERSION');
  const sm = readFileSync(join(ROOT, 'sitemap.xml'), 'utf8');
  assert(/<loc>https:\/\/inletcast\.com\/<\/loc>/.test(sm), 'sitemap lists the canonical URL');
  // registration is guarded: jsdom has no navigator.serviceWorker and the app must still boot
  const { window, errors } = await loadApp({ fetchStub: makeFetchStub() });
  noFatal(errors);
  assert(typeof window.navigator.serviceWorker === 'undefined', 'jsdom really lacks serviceWorker (guard exercised)');
  window.close();
});

await scenario('marketing & seo: share meta, JSON-LD, hero pitch, person byline, copy-email fallback', async () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  // <title> is the SERP/share headline — crossing-window framing, no prototype hedge
  const title = html.match(/<title>([^<]*)<\/title>/);
  assert(title && !/Prototype/i.test(title[1]), `<title> must not say Prototype, got "${title && title[1]}"`);
  assert(/InletCast — NC Inlet Crossing Windows &amp; Gulf Stream SST/.test(title[1]), `title framing wrong, got "${title[1]}"`);
  const desc = html.match(/<meta name="description" content="([^"]*)"/);
  assert(desc && /Free beta/.test(desc[1]) && !/prototype/i.test(desc[1]), 'meta description keeps "Free beta" and drops "prototype"');
  // share card: absolute og:image with dimensions, plus the twitter card pair
  assert(/<meta property="og:image" content="https:\/\/inletcast\.com\/og\.png">/.test(html), 'og:image absolute URL present');
  assert(/<meta property="og:image:width" content="1200">/.test(html), 'og:image:width present');
  assert(/<meta property="og:image:height" content="630">/.test(html), 'og:image:height present');
  assert(/<meta name="twitter:card" content="summary_large_image">/.test(html), 'twitter:card present');
  assert(/<meta name="twitter:image" content="https:\/\/inletcast\.com\/og\.png">/.test(html), 'twitter:image present');
  // JSON-LD block parses and describes the app
  const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert(ld, 'head carries a JSON-LD script');
  const data = JSON.parse(ld[1]);
  assert(data['@type'] === 'WebApplication' && data.name === 'InletCast', 'JSON-LD is a WebApplication named InletCast');
  // static crawlable copy: all seven inlets named in the raw HTML, before any JS runs
  for (const n of ['Masonboro', 'Carolina Beach', 'Cape Fear', 'New Topsail', 'New River', 'Bogue', 'Beaufort']) {
    assert(html.includes(n), `static HTML names ${n}`);
  }
  const { window, document, errors } = await loadApp({ fetchStub: makeFetchStub() });
  noFatal(errors);
  assert(!/Prototype/.test(document.title), `live document.title must not say Prototype, got "${document.title}"`);
  const h1 = document.querySelector('h1');
  assert(h1 && /InletCast/.test(h1.textContent), 'h1 present and names InletCast');
  // hero: value copy first, disclaimer banner second, Inlets view only
  const hero = document.getElementById('hero');
  assert(hero && !hero.hidden, 'hero visible on the Inlets view');
  assert(/When can you get out — and when can you get back in\?/.test(hero.textContent), 'hero carries the value headline');
  assert(/Free crossing-condition windows for North Carolina inlets, scored for your boat size\./.test(hero.textContent), 'hero carries the supporting sentence');
  const banner = document.getElementById('banner');
  assert(banner && (hero.compareDocumentPosition(banner) & 4), 'hero precedes the disclaimer banner in document order');
  window.eval('setView("method");');
  assert(hero.hidden, 'hero hidden on other views');
  window.eval('setView("inlets");');
  assert(!hero.hidden, 'hero returns with the Inlets view');
  // competitive frame on the map panel: honest satellite pitch, shown only while MUR renders,
  // never the "same class of data the paid services sell" oversell
  assert(/Free satellite-blended 1-km SST/.test(text(document, '#coastPanel') || ''), 'map panel carries the satellite-SST value pitch');
  assert(!/paid chart services sell/.test(document.body.textContent), 'MUR oversell absent everywhere on the page');
  assert(!/freesurfforecast/.test(text(document, '#methodBody') || ''), 'Method drops the freesurfforecast name-drop');
  // map header copy matches the actual pointer behavior (jsdom is a fine pointer: click-to-open)
  assert(/click one to open the inlet/.test(text(document, '#coastPanel') || ''), 'map copy describes click-to-open on non-touch');
  // person-first byline in Method and footer; the LLC stays in the copyright line only
  assert(/Built by AJ Kammerer, a marine forecaster who runs these inlets/.test(text(document, '#methodBody') || ''), 'Method leads with the person byline');
  assert(/Built by AJ Kammerer, a marine forecaster who runs these inlets/.test(text(document, 'footer.disc') || ''), 'footer carries the person byline');
  assert(!/Ghosttree/.test(text(document, '#methodBody') || ''), 'Method no longer names the LLC');
  assert(/© 2026 Ghosttree Technical Solutions, LLC/.test(text(document, 'footer.disc') || ''), 'LLC stays in the copyright line');
  assert(!/Monday and Thursday/.test(document.body.textContent), 'no update-cadence promise anywhere on the page');
  // hero frames the ask around the forecaster note, honestly (in the works — no cadence claim)
  assert(/weekly forecaster note/.test(hero.textContent) && /beta list/.test(hero.textContent), 'hero frames the beta ask around the forecaster note');
  assert(hero.querySelector('a[href^="mailto:"]'), 'hero beta-list link is actionable');
  // CTA: mailto keeps working, and a Copy email fallback reveals the address without a mail client
  const cta = document.querySelector('a.betabtn');
  assert(cta && /Join the beta list/.test(cta.textContent), `beta CTA says "${cta && cta.textContent}"`);
  const btn = document.getElementById('copyEmailBtn');
  assert(btn, 'Copy email fallback button present');
  const addrSpan = document.getElementById('copyAddr');
  assert(addrSpan && addrSpan.hidden, 'address stays hidden until the fallback fires');
  btn.click(); // jsdom has no Clipboard API — the click must degrade to the text reveal
  assert(!addrSpan.hidden && /@/.test(addrSpan.textContent), `fallback reveals the address, got "${addrSpan.textContent}"`);
  window.close();
});

await scenario('timezone: displayed times are Eastern regardless of the viewer clock', async () => {
  const { window, document, errors } = await loadApp({ fetchStub: makeFetchStub() });
  noFatal(errors);
  const badge = document.getElementById('modeBadge');
  assert(/ET/.test(badge.textContent), `badge stamps the timezone: "${badge.textContent}"`);
  // hour/day labels route through the NY formatter (spot-check a known instant: 16:00Z in August = 12p ET)
  const noonET = window.eval('hourLabel(new Date("2026-08-18T16:00:00Z"))');
  assert(noonET === '12p', `hourLabel(16:00Z) is "${noonET}", want "12p" (noon ET)`);
  const wd = window.eval('dayLabel(new Date("2026-08-19T02:00:00Z"))');
  assert(wd === 'Tue', `dayLabel(Wed 02:00Z) is "${wd}", want "Tue" (still Tuesday in NY)`);
  window.close();
});

const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\n${failed.length}/${results.length} scenarios FAILED` : `\nAll ${results.length} scenarios passed`);
process.exit(failed.length ? 1 : 0);
