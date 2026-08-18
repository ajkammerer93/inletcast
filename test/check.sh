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
# also check any inline scripts remaining in index.html
node - <<'EOF' || fail=1
const fs = require('fs');
const html = fs.readFileSync('../index.html', 'utf8');
const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
let m, i = 0, bad = 0;
while ((m = re.exec(html))) {
  i++;
  if (!m[1].trim()) continue;
  fs.writeFileSync(`/tmp/inline_script_${i}.js`, m[1]);
  const { spawnSync } = require('child_process');
  const r = spawnSync('node', ['--check', `/tmp/inline_script_${i}.js`], { encoding: 'utf8' });
  if (r.status !== 0) { console.log(`  inline script #${i} FAILS: ${r.stderr}`); bad++; }
  else console.log(`  ok inline script #${i}`);
}
if (!i) console.log('  (no inline scripts)');
process.exit(bad ? 1 : 0);
EOF

echo "== smoke tests =="
node smoke.mjs || fail=1

if [ $fail -ne 0 ]; then echo "GATE: FAIL"; exit 1; fi
echo "GATE: PASS"
