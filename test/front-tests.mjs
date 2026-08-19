// Unit tests for the Gulf Stream front-line decision (js/map.js frontLine):
// strong field -> solid line, weak-but-coherent August field -> dashed line,
// no signal -> no line. Run: node front-tests.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = { console, Math, Array, Object, JSON, Number, isNaN, Date, Set };
vm.createContext(ctx);
for (const f of ['../js/config.js', '../js/utils.js', '../js/map.js']) {
  vm.runInContext(readFileSync(new URL(f, import.meta.url), 'utf8'), ctx, { filename: f });
}
const frontLine = (pts) => vm.runInContext('frontLine(PTS)', Object.assign(ctx, { PTS: pts }));

const mk = (gs) => gs.map((g, i) => ({ g, lon: -77 + i * 0.3, lat: 33.7 + i * 0.25, name: 't' + i, weak: g < 0.5 }));
let fail = 0;
function check(name, cond) {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}`);
  if (!cond) fail++;
}

const strong = frontLine(mk([0.7, 0.5, 0.6, 0.2, 0.4]));
check('strong field draws a solid line', strong && strong.weak === false && strong.pts.length === 4);

const august = frontLine(mk([0.32, 0.3, 0.2, 0.33, 0.18])); // real Aug 2026 NWP-like field
check('weak-but-coherent field draws a dashed orientation line', august && august.weak === true && august.pts.length === 5);

const mixed = frontLine(mk([0.7, 0.6, 0.1, 0.05, 0.08]));
check('two strong steps alone are not a line', mixed === null || mixed.weak === true);

check('no signal draws nothing', frontLine(mk([0.05, 0.1, 0.02, 0.08, 0.11])) === null);
check('empty field draws nothing', frontLine([]) === null);

console.log(fail ? `\n${fail} front-line checks FAILED` : '\nAll front-line checks passed');
process.exit(fail ? 1 : 0);
