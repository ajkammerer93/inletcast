// Accessibility tests: WCAG contrast on the light-theme tokens, ARIA tabs pattern,
// named/labelled SVGs, keyboard-operable map markers, focus management, Escape dismissal.
// Run: node a11y-tests.mjs   (from the test/ directory)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadApp, assert, text } from './harness.mjs';
import { makeFetchStub } from './fixtures.mjs';

const CSS_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'css', 'styles.css');

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

/* ---------- WCAG relative-luminance contrast ---------- */
function lum(hex) {
  const h = hex.replace('#', '').trim();
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(n.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// parse the FIRST bare :root block — that is the light theme
function lightTokens() {
  const css = readFileSync(CSS_PATH, 'utf8');
  const m = css.match(/:root\s*\{([^}]*)\}/);
  assert(m, 'styles.css has a bare :root token block');
  const toks = {};
  for (const t of m[1].matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) toks[t[1]] = t[2].trim();
  return toks;
}

await scenario('contrast: light-theme small-text tokens all reach 4.5:1', async () => {
  const tok = lightTokens();
  for (const k of ['ink-3', 'page', 'surface-1', 'accent-ink', 'st-good-deep', 'accent-btn']) {
    assert(tok[k] && tok[k].startsWith('#'), `light :root defines --${k} as a hex color (got ${tok[k]})`);
  }
  const checks = [
    ['--ink-3 on --page', ratio(tok['ink-3'], tok['page'])],
    ['--ink-3 on --surface-1', ratio(tok['ink-3'], tok['surface-1'])],
    ['--accent-ink (links/back button) on --page', ratio(tok['accent-ink'], tok['page'])],
    ['white chip text on --st-good-deep (Favorable chip)', ratio('#ffffff', tok['st-good-deep'])],
    ['white text on --accent-btn (laybtn.on / betabtn)', ratio('#ffffff', tok['accent-btn'])],
  ];
  for (const [name, r] of checks) {
    assert(r >= 4.5, `${name} is ${r.toFixed(2)}:1, needs >= 4.5:1`);
  }
});

await scenario('css: text-bearing selectors use the contrast-safe tokens', async () => {
  const css = readFileSync(CSS_PATH, 'utf8');
  assert(/a \{ color:var\(--accent-ink\)/.test(css), 'links use --accent-ink');
  assert(/\.backbtn[^}]*var\(--accent-ink\)/.test(css), 'back button uses --accent-ink');
  assert(/\.chip\.good \{ background:var\(--st-good-deep\)/.test(css), 'Favorable chip uses the darker green');
  assert(/\.laybtn\.on \{ background:var\(--accent-btn\)/.test(css), 'active layer button uses --accent-btn');
  assert(/prefers-reduced-motion/.test(css), 'stylesheet carries a reduced-motion block');
});

await scenario('dom: exactly one h1 and no headings above h3 inside views', async () => {
  const { window, document, errors } = await loadApp({ fetchStub: makeFetchStub() });
  assert(errors.length === 0 || !errors.some((e) => !/AbortError|aborted/i.test(e)), 'page errors: ' + errors.slice(0, 2).join(' | '));
  const h1s = document.querySelectorAll('h1');
  assert(h1s.length === 1, `found ${h1s.length} h1 elements, want exactly 1`);
  assert(/InletCast/.test(h1s[0].textContent), 'the h1 is the InletCast logo');
  assert(document.querySelectorAll('h4, h5, h6').length === 0, 'no h4/h5/h6 skip-level headings remain');
  window.close();
});

await scenario('tabs: complete ARIA pattern with roving tabindex and arrow keys', async () => {
  const { window, document } = await loadApp({ fetchStub: makeFetchStub() });
  const tabs = [...document.querySelectorAll('nav.tabs button')];
  assert(tabs.length === 4, `found ${tabs.length} tabs, want 4`);
  for (const t of tabs) {
    assert(t.getAttribute('role') === 'tab', `tab "${t.textContent}" has role=tab`);
    assert(/^(true|false)$/.test(t.getAttribute('aria-selected') || ''), `tab "${t.textContent}" has aria-selected`);
    const panel = document.getElementById(t.getAttribute('aria-controls') || '');
    assert(panel && panel.getAttribute('role') === 'tabpanel', `tab "${t.textContent}" controls a tabpanel`);
    assert(panel.getAttribute('aria-labelledby') === t.id, 'tabpanel is labelled by its tab');
  }
  assert(tabs.filter((t) => t.getAttribute('aria-selected') === 'true').length === 1, 'exactly one tab selected');
  assert(tabs.filter((t) => t.tabIndex === 0).length === 1, 'roving tabindex: exactly one tab in the tab order');
  // activating a tab moves aria-selected with it
  tabs[2].click();
  assert(tabs[2].getAttribute('aria-selected') === 'true', 'clicked tab becomes selected');
  assert(tabs[0].getAttribute('aria-selected') === 'false', 'previous tab deselected');
  // arrow keys move focus through the tablist
  tabs[2].focus();
  tabs[2].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert(document.activeElement === tabs[3], 'ArrowRight moves focus to the next tab');
  assert(tabs[3].tabIndex === 0 && tabs[2].tabIndex === -1, 'tabindex roves with arrow focus');
  tabs[3].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert(document.activeElement === tabs[0], 'ArrowRight wraps to the first tab');
  window.close();
});

await scenario('svg: every role=img SVG carries an aria-label (map, strips, charts)', async () => {
  const { window, document } = await loadApp({ fetchStub: makeFetchStub() });
  // open a detail view so the line charts exist too
  document.querySelector('#inletCards .card').click();
  // and the models view for its 7-day charts
  window.eval('setView("models"); setView("detail");');
  const svgs = [...document.querySelectorAll('svg[role="img"]')];
  assert(svgs.length >= 3, `found ${svgs.length} role=img svgs, want map + strips + charts`);
  for (const s of svgs) {
    const l = s.getAttribute('aria-label') || '';
    assert(l.trim().length > 0, 'svg[role=img] missing aria-label');
  }
  // status strips describe their runs in words
  const strip = document.querySelector('.strip svg');
  assert(strip && /^Conditions: /.test(strip.getAttribute('aria-label') || ''), 'strip aria-label summarizes runs');
  assert(/Favorable|Marginal|Rough|Hazardous/.test(strip.getAttribute('aria-label')), 'strip summary names condition classes');
  window.close();
});

await scenario('map: marker hit targets are focusable buttons with real names', async () => {
  const { window, document } = await loadApp({ fetchStub: makeFetchStub() });
  const foci = [...document.querySelectorAll('#coastPanel svg circle[tabindex="0"]')];
  assert(foci.length >= 9, `found ${foci.length} focusable marker circles, want 7 inlets + 2 zones`);
  for (const c of foci) {
    assert(c.getAttribute('role') === 'button', 'marker circle has role=button');
    assert((c.getAttribute('aria-label') || '').trim().length > 0, 'marker circle has an aria-label');
  }
  const inletLabels = foci.map((c) => c.getAttribute('aria-label')).filter((l) => /ft at [\d.]+ s/.test(l));
  assert(inletLabels.length >= 7, `inlet marker labels carry conditions (got ${inletLabels.length})`);
  assert(inletLabels.some((l) => /Masonboro Inlet — \w+, [\d.]+ ft at [\d.]+ s, \d+ kn/.test(l)), 'label reads like "Masonboro Inlet — Favorable, 2.1 ft at 9 s, 12 kn SE"');
  // Enter on an inlet marker opens its detail view
  const inletHit = foci.find((c) => /Inlet — /.test(c.getAttribute('aria-label')));
  inletHit.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert(document.getElementById('view-detail').classList.contains('active'), 'Enter on a marker opens the detail view');
  window.close();
});

await scenario('map: west-wall overlay has a visible text alternative under the map', async () => {
  const { window, document } = await loadApp({ fetchStub: makeFetchStub() });
  const note = document.querySelector('#coastPanel .wallnote');
  assert(note, 'map panel carries the west-wall text line');
  assert(/west wall|SST front/i.test(note.textContent), `wallnote says "${note.textContent}"`);
  window.close();
});

await scenario('focus: view transitions land on the heading; back returns to the card', async () => {
  const { window, document } = await loadApp({ fetchStub: makeFetchStub() });
  const card = document.querySelector('#inletCards .card');
  const cardId = card.dataset.inlet;
  card.click();
  const ae = document.activeElement;
  assert(ae && document.getElementById('view-detail').contains(ae), 'focus moved into the detail view');
  assert(ae.tagName === 'H2', `focus is on the detail heading, got ${ae && ae.tagName}`);
  // back button restores focus to the originating card
  document.querySelector('#view-detail .backbtn').click();
  const back = document.activeElement;
  assert(back && back.classList.contains('card') && back.dataset.inlet === cardId, 'focus returned to the originating card');
  window.close();
});

await scenario('focus: hourly-table toggle keeps focus across the detail re-render', async () => {
  const { window, document } = await loadApp({ fetchStub: makeFetchStub() });
  document.querySelector('#inletCards .card').click();
  const tbtn = document.querySelector('#view-detail .tablebtn');
  assert(tbtn, 'detail view has the table toggle');
  const before = tbtn.textContent;
  tbtn.click();
  const after = document.querySelector('#view-detail .tablebtn');
  assert(after && after.textContent !== before, 'toggle re-rendered with the flipped label');
  assert(document.activeElement === after, 'focus restored to the toggle after re-render');
  window.close();
});

await scenario('models & offshore: charts have table twins with scoped headers', async () => {
  const { window, document } = await loadApp({ fetchStub: makeFetchStub() });
  window.eval('setView("models");');
  let tables = [...document.querySelectorAll('#modelsBody table.data')];
  assert(tables.length >= 2, `models view has ${tables.length} chart tables, want wave + wind`);
  window.eval('setView("offshore");');
  tables = tables.concat([...document.querySelectorAll('#offshoreBody table.data')]);
  assert(document.querySelectorAll('#offshoreBody table.data').length >= 1, 'offshore view has a chart table');
  for (const tb of tables) {
    const ths = [...tb.querySelectorAll('th')];
    assert(ths.length > 0 && ths.every((h) => h.getAttribute('scope') === 'col'), 'every th has scope=col');
    assert(tb.querySelectorAll('tbody tr').length > 0, 'chart table has data rows');
  }
  // the toggle shows/hides in place without a re-render
  const btn = document.querySelector('#offshoreBody .tablebtn');
  const wrap = document.querySelector('#offshoreBody .tablewrap');
  assert(btn && wrap, 'offshore chart table has its toggle');
  const was = wrap.hidden;
  btn.click();
  assert(wrap.hidden === !was, 'toggle flips table visibility');
  window.close();
});

await scenario('detail: hourly table headers carry scope=col', async () => {
  const { window, document } = await loadApp({ fetchStub: makeFetchStub() });
  document.querySelector('#inletCards .card').click();
  window.eval('state.showTable[state.detailInlet]=true; renderDetail();');
  const ths = [...document.querySelectorAll('#view-detail table.data th')];
  assert(ths.length >= 9, `hourly table has ${ths.length} headers`);
  assert(ths.every((h) => h.getAttribute('scope') === 'col'), 'every hourly th has scope=col');
  window.close();
});

await scenario('tooltip: no live-region role; Escape dismisses it and pinned readouts', async () => {
  const { window, document } = await loadApp({ fetchStub: makeFetchStub() });
  const tip = document.getElementById('tooltip');
  assert(!tip.hasAttribute('role'), 'follow-cursor tooltip must not be a live region');
  window.eval('pinTip({}); showTip(100,100,"test",[]);');
  assert(tip.style.display === 'block', 'tooltip shown and pinned');
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert(tip.style.display === 'none', 'Escape hides the pinned tooltip');
  assert(window.eval('tipPinned') === false, 'Escape unpins the tooltip');
  window.close();
});

await scenario('non-color encoding: map markers carry the class glyph; long strip runs keep glyphs in compact mode', async () => {
  const { window, document } = await loadApp({ fetchStub: makeFetchStub() });
  const mapTexts = [...document.querySelectorAll('#coastPanel svg text')].map((t) => t.textContent);
  const glyphs = mapTexts.filter((t) => /^[✓!✕⚠…]$/.test(t));
  assert(glyphs.length >= 7, `map has ${glyphs.length} marker class glyphs, want one per inlet`);
  // compact card strips: any run of >= 3 hours must carry its glyph
  const cardStrip = document.querySelector('#inletCards .card .strip svg');
  assert(cardStrip, 'card carries a compact status strip');
  const stripGlyphs = [...cardStrip.querySelectorAll('text')].filter((t) => /^[✓!✕⚠]/.test(t.textContent));
  assert(stripGlyphs.length >= 1, 'compact strip overlays class glyphs on its runs');
  window.close();
});

const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\n${failed.length}/${results.length} a11y scenarios FAILED` : `\nAll ${results.length} a11y scenarios passed`);
process.exit(failed.length ? 1 : 0);
