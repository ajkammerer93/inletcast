// jsdom harness: loads index.html (inline or external classic scripts) with a
// stubbed fetch and fake canvas, waits for boot() to finish, and hands the
// window to scenario assertions.
// NOTE: jsdom does not run <script type="module"> — app scripts must stay
// classic scripts loaded in dependency order.
import { JSDOM, VirtualConsole } from 'jsdom';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HTML_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html');

function fakeCanvasContext(canvas) {
  const noop = () => {};
  return {
    canvas,
    fillStyle: '', strokeStyle: '', globalCompositeOperation: '', globalAlpha: 1,
    lineWidth: 1, lineCap: '', font: '', textAlign: '', textBaseline: '',
    fillRect: noop, clearRect: noop, strokeRect: noop,
    beginPath: noop, moveTo: noop, lineTo: noop, arc: noop, closePath: noop,
    stroke: noop, fill: noop, save: noop, restore: noop, translate: noop,
    rotate: noop, scale: noop, fillText: noop, strokeText: noop, rect: noop,
    setLineDash: noop, drawImage: noop,
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: noop,
    measureText: (s) => ({ width: (s || '').length * 6 }),
  };
}

// jsdom serves file: pages from an opaque origin, where its native localStorage throws.
// Install a seedable in-memory Storage shim instead so persistence code runs for real.
function makeStorage(seed = {}) {
  const m = new Map(Object.entries(seed).map(([k, v]) => [k, String(v)]));
  return {
    get length() { return m.size; },
    key(i) { return [...m.keys()][i] ?? null; },
    getItem(k) { return m.has(String(k)) ? m.get(String(k)) : null; },
    setItem(k, v) { m.set(String(k), String(v)); },
    removeItem(k) { m.delete(String(k)); },
    clear() { m.clear(); },
  };
}

// localStorageSeed: {key: value} entries present in the window's localStorage before
// the app scripts run — lets a scenario simulate a returning visitor.
export async function loadApp({ fetchStub, beforeBoot, localStorageSeed, settleMs = 6000 } = {}) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    const msg = String(e && e.detail && e.detail.stack || e);
    if (!/Could not load img|css parsing/i.test(msg)) errors.push(msg);
  });
  const dom = await JSDOM.fromFile(HTML_PATH, {
    resources: 'usable',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      window.fetch = fetchStub;
      window.HTMLCanvasElement.prototype.getContext = function () { return fakeCanvasContext(this); };
      window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
      // jsdom has no layout: give visible elements a plausible width for chart sizing
      Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {
        get() { return this.style && this.style.display === 'none' ? 0 : 800; },
        configurable: true,
      });
      window.addEventListener('error', (e) => errors.push(e.error ? String(e.error.stack || e.error) : String(e.message)));
      window.addEventListener('unhandledrejection', (e) => errors.push('unhandledrejection: ' + (e.reason && (e.reason.stack || e.reason))));
      Object.defineProperty(window, 'localStorage', { value: makeStorage(localStorageSeed), configurable: true });
      if (beforeBoot) beforeBoot(window);
    },
  });
  const { window } = dom;
  await new Promise((resolve) => {
    if (window.document.readyState === 'complete') resolve();
    else window.addEventListener('load', resolve);
  });
  // Wait for boot to settle: poll until the mode badge leaves its "Loading" state or timeout.
  const deadline = Date.now() + settleMs;
  while (Date.now() < deadline) {
    const badge = window.document.getElementById('modeBadge') || window.document.querySelector('.mode-badge');
    if (badge && badge.textContent.trim() && !/loading/i.test(badge.textContent)) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  await new Promise((r) => setTimeout(r, 250)); // let renderAll finish
  return { window, document: window.document, errors, dom };
}

export function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT FAILED: ' + msg);
}

export function text(document, sel) {
  const n = document.querySelector(sel);
  return n ? n.textContent : null;
}
