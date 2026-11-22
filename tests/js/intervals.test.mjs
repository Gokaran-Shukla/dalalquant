// Chart intervals: 1s..4h intraday candles, client-side resampling, live candle roll-over, 1D/1W/1M on the company chart.
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
const vc = new VirtualConsole(); const errors = [];
vc.on('jsdomError', e => { if (!/getContext|Not implemented/.test(e.message)) errors.push(e.message); });
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://gokaran-shukla.github.io/dalalquant/', virtualConsole: vc,
  beforeParse(win) { win.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }); } });
const w = dom.window, d = w.document, ev = c => w.eval(c);
after(() => w.close());

test('toolbar lists every interval from 1s to 1M', () => {
  ev("go('intraday')");
  const ks = [...d.querySelectorAll('#tab-intraday .tfb')].map(b => b.textContent);
  assert.deepEqual(ks, ['1s','5s','10s','15s','30s','1m','2m','3m','5m','10m','15m','30m','45m','1h','2h','4h','1D','1W','1M']);
  assert.equal(d.querySelector('#tab-intraday .tfb.on').textContent, '5m');
});

for (const [k, sec, perDay] of [['1s', 1, 22500], ['30s', 30, 750], ['2m', 120, 187], ['10m', 600, 37], ['45m', 2700, 8], ['1h', 3600, 6], ['4h', 14400, 1]]) {
  test(`${k} candles: spacing ${sec}s, ${perDay} per session`, () => {
    d.querySelector(`#tab-intraday [data-ivk="${sec}"]`).click();
    assert.equal(ev('S.id.ivs'), sec);
    const bars = JSON.parse(ev('JSON.stringify(Object.values(byDay(S.id.bars)).at(-1).map(b=>b.t))'));
    assert.equal(bars.length, perDay);
    const toS = t => { const [h, m, s = 0] = t.slice(11).split(':').map(Number); return h * 3600 + m * 60 + s; };
    assert.equal(toS(bars[0]), 33300, 'first candle at 09:15');
    if (bars.length > 1) assert.equal(toS(bars[1]) - toS(bars[0]), sec);
    assert.equal(d.querySelector('#tab-intraday .tfb.on').textContent, k);
    assert.match(d.querySelector('#tab-intraday h3').textContent, new RegExp(' · ' + k + ' · '));
  });
}

test('1s view shows a 360-candle window', () => {
  d.querySelector('#tab-intraday [data-ivk="1"]').click();
  assert.match(d.querySelector('#tab-intraday h3').textContent, /last 360 candles/);
});

test('resampling 1m bars into 3m keeps OHLCV', () => {
  const r = JSON.parse(ev(`JSON.stringify(resampleIntraday([
    {t:'2026-11-20 09:15',o:10,h:11,l:9,c:10.5,v:100},{t:'2026-11-20 09:16',o:10.5,h:12,l:10,c:11,v:50},{t:'2026-11-20 09:17',o:11,h:11.5,l:8,c:9,v:25},
    {t:'2026-11-20 09:18',o:9,h:9.5,l:8.5,c:9.2,v:10}],180))`));
  assert.deepEqual(r, [{ t: '2026-11-20 09:15', o: 10, h: 12, l: 8, c: 9, v: 175 }, { t: '2026-11-20 09:18', o: 9, h: 9.5, l: 8.5, c: 9.2, v: 10 }]);
});

test('live ticks roll into a new candle when the interval bucket changes', () => {
  ev("S.id.ivs=5;S.id.bars=[{t:'2026-11-23 10:00:00',o:100,h:100,l:100,c:100,v:0}]");
  const ts = Date.UTC(2026, 10, 23, 4, 30, 3) / 1000;   // 10:00:03 IST
  ev(`liveBar(S.id,101,5,${ts})`);
  ev(`liveBar(S.id,99,7,${ts + 4})`);                    // 10:00:07 -> next 5s candle
  const b = JSON.parse(ev('JSON.stringify(S.id.bars)'));
  assert.equal(b.length, 2);
  assert.deepEqual(b[0], { t: '2026-11-23 10:00:00', o: 100, h: 101, l: 100, c: 101, v: 5 });
  assert.equal(b[1].t, '2026-11-23 10:00:05'); assert.equal(b[1].c, 99); assert.equal(b[1].o, 101);
});

test('1W and 1M aggregate the company chart; chips sit on the company page too', () => {
  const sym = ev('S.uni[0].sym');
  ev(`openSym('${sym}')`);
  const t = d.querySelector('#tab-analyze');
  assert.ok(t.querySelectorAll('.tfb').length === 19);
  t.querySelector('[data-ivk="W"]').click();
  assert.equal(ev('S.an.agg'), 'W');
  const wk = JSON.parse(ev(`JSON.stringify(aggBars(S.D['${sym}'].bars,'W').length)`)), dy = ev(`S.D['${sym}'].bars.length`);
  assert.ok(wk < dy / 4 && wk > dy / 6, `weeks ${wk} vs days ${dy}`);
  const mo = JSON.parse(ev(`JSON.stringify(aggBars(S.D['${sym}'].bars,'M').length)`));
  assert.ok(mo < wk / 4 && mo > wk / 5.5);
  assert.equal(d.querySelector('#tab-analyze .tfb.on').textContent, '1W');
  d.querySelector('#tab-analyze [data-ivk="60"]').click();
  assert.equal(ev('S.tab'), 'intraday'); assert.equal(ev('S.id.sym'), sym); assert.equal(ev('S.id.ivs'), 60);
  assert.deepEqual(errors, []);
});
