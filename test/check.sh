#!/usr/bin/env bash
# Full test gate: JS syntax check on every script (inline or js/*.js) + jsdom smoke tests.
set -u
cd "$(dirname "$0")"
fail=0

echo "== syntax check =="
if ls ../js/*.js >/dev/null 2>&1; then
  for f in ../js/*.js; do
    if node --check "$f" 2>&1; then echo "  ok $f"; else fail=1; fi
  done
fi
# the service worker is a root-level classic script — check it too
if [ -f ../sw.js ]; then
  if node --check ../sw.js 2>&1; then echo "  ok ../sw.js"; else fail=1; fi
fi
# manifest.json must stay valid JSON
node -e 'JSON.parse(require("fs").readFileSync("../manifest.json","utf8"))' \
  && echo "  ok ../manifest.json" || fail=1
# also check any inline scripts remaining in index.html
node - <<'EOF' || fail=1
const fs = require('fs');
const html = fs.readFileSync('../index.html', 'utf8');
const re = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi;
let m, i = 0, bad = 0;
while ((m = re.exec(html))) {
  i++;
  if (!m[2].trim()) continue;
  // non-JS blocks (JSON-LD structured data) must be valid JSON, not valid JS
  if (/type\s*=\s*"application\/ld\+json"/i.test(m[1])) {
    try { JSON.parse(m[2]); console.log(`  ok inline script #${i} (ld+json)`); }
    catch (e) { console.log(`  inline script #${i} (ld+json) FAILS: ${e.message}`); bad++; }
    continue;
  }
  fs.writeFileSync(`/tmp/inline_script_${i}.js`, m[2]);
  const { spawnSync } = require('child_process');
  const r = spawnSync('node', ['--check', `/tmp/inline_script_${i}.js`], { encoding: 'utf8' });
  if (r.status !== 0) { console.log(`  inline script #${i} FAILS: ${r.stderr}`); bad++; }
  else console.log(`  ok inline script #${i}`);
}
if (!i) console.log('  (no inline scripts)');
process.exit(bad ? 1 : 0);
EOF

echo "== scoring tests =="
node scoring-tests.mjs || fail=1

echo "== front-line tests =="
node front-tests.mjs || fail=1

echo "== smoke tests =="
node smoke.mjs || fail=1

echo "== accessibility tests =="
node a11y-tests.mjs || fail=1

if [ $fail -ne 0 ]; then echo "GATE: FAIL"; exit 1; fi
echo "GATE: PASS"
