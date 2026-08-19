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
  // browser back (hash restored) returns to the inlets view
  window.location.hash = '#/inlets';
  window.dispatchEvent(new window.Event('hashchange'));
  assert(document.getElementById('view-inlets').classList.contains('active'), 'back to #/inlets reactivates the list');
  assert(!detail.classList.contains('active'), 'detail view deactivates on back');
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
  window.close();
});

const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\n${failed.length}/${results.length} scenarios FAILED` : `\nAll ${results.length} scenarios passed`);
process.exit(failed.length ? 1 : 0);
