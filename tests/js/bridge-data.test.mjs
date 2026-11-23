// After "Connect", the app must check the broker really returns prices and switch to real data — or explain why not.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  .replace(/<link[^>]+fonts[^>]*>/g, '')
  .replace(/<script src="(js\/[^"]+)"><\/script>/g, (_, f) => `<script>${fs.readFileSync(path.join(root, f), 'utf8')}</script>`);
const vc = new VirtualConsole();
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://gokaran-shukla.github.io/dalalquant/', virtualConsole: vc,
  beforeParse(win) { win.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }); } });
const w = dom.window, d = w.document, ev = c => w.eval(c);
after(() => { ev('setLiveQuotes(false)'); w.close(); });
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

let mode = 'fail', calls = [];
ev('null'); // scripts loaded
w.bridgeFetch = async (p) => {
  calls.push(p);
  if (p === '/health') return { status: 'ok', broker: 'fyers' };
  if (p.startsWith('/quote')) {
    if (mode === 'fail') throw new Error('Fyers quotes: token expired (code -16)');
    const syms = decodeURIComponent(p.split('symbols=')[1].split('&')[0]).split(',');
    return { quotes: Object.fromEntries(syms.map(s => [s, { ltp: 1234.5, prev_close: 1200, open: 1210, high: 1240, low: 1205, volume: 1e6 }])) };
  }
  if (p.startsWith('/history')) {
    const bars = Array.from({ length: 60 }, (_, i) => ({ t: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`, o: 100 + i, h: 101 + i, l: 99 + i, c: 100.5 + i, v: 1000 }))
      .map((b, i) => ({ ...b, t: new Date(Date.UTC(2026, 6, 1 + i)).toISOString().slice(0, 10) }));
    return { bars };
  }
  return {};
};
// stop background refreshers that would hit other endpoints
for (const f of ['loadGlobal', 'loadNews', 'nseLoadCommon']) w[f] = () => {};

test('connected but broker returns no data: clear status + fix-it help with login link', async () => {
  ev("S.bridge.broker='fyers';S.bridge.url='http://127.0.0.1:8765';go('algo')");
  await ev('connectBridge()'); await tick(20);
  assert.equal(ev('S.bridge.ok'), true);
  assert.equal(ev('S.bridge.data'), 'fail');
  assert.match(d.querySelector('#tab-algo .dstat').textContent, /No real data.*token expired/);
  const m = d.querySelector('#modal');
  assert.equal(m.style.display, 'flex');
  assert.match(m.textContent, /no real prices yet/);
  assert.ok(m.querySelector('a[href="http://127.0.0.1:8765/login/fyers"]'), 'Fyers login link');
  assert.ok(!calls.some(c => c.startsWith('/history')), 'no history attempted when quotes fail');
});

test('Retry after login: verifies, loads real history for NIFTY 50 + watchlist, starts live quotes', async () => {
  mode = 'ok'; calls = [];
  d.querySelector('#modal [data-act2="retryData"]').click();
  for (let i = 0; i < 100 && ev('!S.liveMode'); i++) await tick(10);
  assert.equal(ev('S.bridge.data'), 'ok');
  assert.equal(ev('S.liveMode'), true);
  const n50 = ev("(S.IDX['NIFTY 50']||{members:[]}).members.length");
  assert.ok(calls.filter(c => c.startsWith('/history')).length >= n50);
  const sym = ev("S.IDX['NIFTY 50'].members[0]");
  assert.equal(ev(`S.D['${sym}'].src.px`), 'live');
  assert.match(d.querySelector('#tab-algo .dstat').textContent, /Real data on.*fyers.*history \d+\/\d+ loaded/);
  assert.match(d.querySelector('#modeBadge').textContent, /LIVE/);
});
