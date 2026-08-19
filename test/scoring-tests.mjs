// Unit tests for the scoring model: loads config/utils/scoring as classic scripts
// into one vm context (the same layering the browser uses) and drives scoreHour /
// zoneScoreHour with constructed conditions.
// Run: node scoring-tests.mjs   (from the test/ directory; plain Node, no deps)
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ctx = createContext({ console });
for (const f of ['js/config.js', 'js/utils.js', 'js/scoring.js']) {
  runInContext(readFileSync(join(root, f), 'utf8'), ctx, { filename: f });
}
const inCtx = (expr) => runInContext(expr, ctx);

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail != null ? ' — got ' + detail : '')); }
}

// ---- fixtures: constant-conditions series in the shape data.js normalizes to ----
const start = new Date('2026-08-18T00:00:00');
const N = 48;
const times = Array.from({ length: N }, (_, i) => new Date(start.getTime() + i * 36e5));
const arr = (v) => Array(N).fill(v);
function point(c) {
  const g = { hs: arr(c.hs), tp: arr(c.tp), dir: arr(c.dir),
              shs: arr(c.shs ?? c.hs), stp: arr(c.stp ?? c.tp), sdir: arr(c.sdir ?? c.dir) };
  const wg = { spd: arr(c.wind), dir: arr(c.wdir), gst: arr(c.gst ?? +(c.wind * 1.3).toFixed(1)) };
  return { marine: { t: times, gfs: g, ecmwf: JSON.parse(JSON.stringify(g)) },
           wind: { t: times, gfs: wg, ecmwf: JSON.parse(JSON.stringify(wg)) }, live: true };
}
function tidePts(mode) { // 'ebb': falling 1 ft/h everywhere; 'flood': rising 1 ft/h
  return times.map((t, i) => ({ t, v: mode === 'ebb' ? 48 - i : i }));
}
const carolina = inCtx('CONFIG.inlets.find(i=>i.id==="carolinabeach")'); // shoal 1.50, bearing 120
const masonboro = inCtx('CONFIG.inlets.find(i=>i.id==="masonboro")');    // shoal 1.00, bearing 112
const bigrock = inCtx('CONFIG.zones.find(z=>z.id==="bigrock")');
const when = new Date(start.getTime() + 6 * 36e5);
function setState(pt, tideMode) {
  ctx.state = { data: {
    inlets: { carolinabeach: pt, masonboro: pt },
    zones: { bigrock: pt },
    tides: tideMode ? { 8658163: { pts: tidePts(tideMode), live: true } } : {},
  } };
}
const rank = (c) => inCtx('clsRank("' + c + '")');

// (a) 3.5 ft @ 13 s, light wind, max ebb, opposed swell, Carolina Beach (shoal 1.5) => at least Rough
setState(point({ hs: 3.5, tp: 13, dir: 120, wind: 6, wdir: 300 }), 'ebb');
const a = ctx.scoreHour(carolina, when, 1.0);
check('(a) 3.5 ft @ 13 s on max ebb, opposed, shoal 1.5 → at least Rough', a && rank(a.cls) >= rank('serious'), a && a.cls);
check('(a) ebb term reads max ebb', a && a.ebb > 0.7, a && a.ebb);
check('(a) opposition term reads opposed', a && a.opp > 0.6, a && a.opp);

// (b) 9 ft @ 12 s, any boat factor, flood => Hazardous (raw-height override, not scaled by boat class)
setState(point({ hs: 9, tp: 12, dir: 120, wind: 8, wdir: 300 }), 'flood');
for (const bf of [0.8, 1.0, 1.25]) {
  const b = ctx.scoreHour(carolina, when, bf);
  check('(b) 9 ft @ 12 s on flood → Hazardous at boat factor ' + bf, b && b.cls === 'critical', b && b.cls);
}

// (c) 1.5 ft @ 8 s, 8 kn, flood => Favorable — even at the shoaliest inlet
setState(point({ hs: 1.5, tp: 8, dir: 120, wind: 8, wdir: 300 }), 'flood');
const c1 = ctx.scoreHour(carolina, when, 1.0);
check('(c) 1.5 ft @ 8 s, 8 kn, flood → Favorable', c1 && c1.cls === 'good', c1 && c1.cls + ' ' + c1.score);

// (d) zone path and inlet path score identically when the tide term is disabled
const pd = point({ hs: 3, tp: 9, dir: 120, wind: 10, wdir: 270 });
ctx.state = { data: { inlets: { masonboro: pd }, zones: { bigrock: pd }, tides: {} } }; // no tide record → tide term off
const di = ctx.scoreHour(masonboro, when, 1.0);
const dz = ctx.zoneScoreHour(bigrock, when, 1.0);
check('(d) zone and inlet paths agree with the tide term disabled',
  di && dz && di.score === dz.score && di.cls === dz.cls && di.conf === dz.conf,
  di && dz && di.score + '/' + di.cls + ' vs ' + dz.score + '/' + dz.cls);

// long period must not read as benign: same height, longer period scores no better on a shoal bar
setState(point({ hs: 5, tp: 14, dir: 120, wind: 6, wdir: 300 }), 'flood');
const lp = ctx.scoreHour(carolina, when, 1.0);
setState(point({ hs: 5, tp: 9, dir: 120, wind: 6, wdir: 300 }), 'flood');
const mp = ctx.scoreHour(carolina, when, 1.0);
check('long period scores worse than moderate period at the same height on a shoal bar', lp && mp && lp.score < mp.score, lp && mp && lp.score + ' vs ' + mp.score);
check('5 ft @ 14 s on a shoal bar → Hazardous (raw height + long period override)', lp && lp.cls === 'critical', lp && lp.cls);

// compound override escalates: 1.5× the period-dependent threshold forces Hazardous
setState(point({ hs: 4.5, tp: 13, dir: 120, wind: 6, wdir: 300 }), 'ebb');
const ce = ctx.scoreHour(carolina, when, 1.0);
check('4.5 ft @ 13 s on max ebb, opposed, shoal 1.5 → Hazardous', ce && ce.cls === 'critical', ce && ce.cls);

// swell partition drives the opposition term: chop-rotated total sea must not hide an opposed ground swell
setState(point({ hs: 3.5, tp: 8, dir: 60, shs: 3.0, stp: 13, sdir: 120, wind: 6, wdir: 300 }), 'ebb');
const sp = ctx.scoreHour(carolina, when, 1.0);
check('swell partition drives opposition despite rotated total direction', sp && sp.opp > 0.6, sp && sp.opp);
check('hidden opposed ground swell on max ebb still forces at least Rough', sp && rank(sp.cls) >= rank('serious'), sp && sp.cls);

// wind against the Stream: NE wind opposing the flow scores worse than the same wind running with it
ctx.state = { data: { inlets: {}, zones: { bigrock: point({ hs: 3, tp: 9, dir: 120, wind: 18, wdir: 55, gst: 20 }) }, tides: {} } };
const zOpp = ctx.zoneScoreHour(bigrock, when, 1.0);
ctx.state = { data: { inlets: {}, zones: { bigrock: point({ hs: 3, tp: 9, dir: 120, wind: 18, wdir: 235, gst: 20 }) }, tides: {} } };
const zFair = ctx.zoneScoreHour(bigrock, when, 1.0);
check('18 kn against the Stream scores worse than 18 kn with it', zOpp && zFair && zOpp.score < zFair.score && zOpp.pStream > 0,
  zOpp && zFair && zOpp.score + ' (pStream ' + zOpp.pStream + ') vs ' + zFair.score);

// ---- timezone plumbing: NY wall-time parsing and API-axis hour indexing ----
check('nyParse: August NY wall time is UTC-4', inCtx('nyParse("2026-08-18T12:00").toISOString()') === '2026-08-18T16:00:00.000Z',
  inCtx('nyParse("2026-08-18T12:00").toISOString()'));
check('nyParse: January NY wall time is UTC-5', inCtx('nyParse("2026-01-15T12:00").toISOString()') === '2026-01-15T17:00:00.000Z',
  inCtx('nyParse("2026-01-15T12:00").toISOString()'));
check('nyParse accepts the CO-OPS space-separated form', inCtx('nyParse("2026-08-18 12:00").toISOString()') === '2026-08-18T16:00:00.000Z',
  inCtx('nyParse("2026-08-18 12:00").toISOString()'));
// the current-hour index must come from the API's own time array, never the viewer's clock
ctx.hourTimes = Array.from({ length: 24 }, (_, h) => '2026-08-18T' + String(h).padStart(2, '0') + ':00');
const noonHalf = inCtx('nyParse("2026-08-18T12:30").getTime()');
check('hourIndexFor finds the hour containing now on the API axis', inCtx(`hourIndexFor(hourTimes, ${noonHalf})`) === 12,
  inCtx(`hourIndexFor(hourTimes, ${noonHalf})`));
check('hourIndexFor clamps before the axis start', inCtx('hourIndexFor(hourTimes, nyParse("2026-08-17T05:00").getTime())') === 0,
  inCtx('hourIndexFor(hourTimes, nyParse("2026-08-17T05:00").getTime())'));
check('hourIndexFor clamps past the axis end', inCtx('hourIndexFor(hourTimes, nyParse("2026-08-19T05:00").getTime())') === 23,
  inCtx('hourIndexFor(hourTimes, nyParse("2026-08-19T05:00").getTime())'));
check('hourIndexFor accepts Date arrays too', inCtx(`hourIndexFor(hourTimes.map(s=>nyParse(s)), ${noonHalf})`) === 12,
  inCtx(`hourIndexFor(hourTimes.map(s=>nyParse(s)), ${noonHalf})`));

console.log(fail ? `\n${fail}/${pass + fail} scoring checks FAILED` : `\nAll ${pass} scoring checks passed`);
process.exit(fail ? 1 : 0);
