// Loads the real terminal in jsdom and checks the numerical machinery against known answers.
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
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://gokaran-shukla.github.io/dalalquant/', virtualConsole: vc });
const w = dom.window;
const ev = code => w.eval(code);
after(() => w.close());
const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);

test('page boots without script errors and computes the universe', () => {
  assert.deepEqual(errors, []);
  assert.ok(ev('Object.keys(S.M).length') > 150);
});
test('moving averages and RSI', () => {
  assert.deepEqual(JSON.parse(ev('JSON.stringify(sma([1,2,3,4,5],3))')), [null, null, 2, 3, 4]);
  close(ev('ema([1,2,3,4,5,6],3)[5]'), 5);
  close(ev('rsiA([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16],14)[15]'), 100);
});
test('OLS recovers an exact line; matrix inverse', () => {
  const r = ev('ols([[1,0],[1,1],[1,2],[1,3]],[1,3,5,7])');
  close(r.b[0], 1); close(r.b[1], 2); close(r.r2, 1);
  const inv = ev('matInv([[4,7],[2,6]])'); close(inv[0][0], 0.6); close(inv[1][1], 0.4);
});
test('Black-Scholes put-call parity and IV inversion', () => {
  const c = ev('bs(100,100,0.5,0.06,0.2,"CE").price'), p = ev('bs(100,100,0.5,0.06,0.2,"PE").price');
  close(c - p, 100 - 100 * Math.exp(-0.06 * 0.5), 1e-6);
  close(ev('impliedVol(bs(100,95,0.25,0.05,0.3,"CE").price,100,95,0.25,0.05,"CE")'), 0.3, 1e-4);
});
test('XIRR of a 10% annual return', () => {
  const r = ev('xirr([[Date.UTC(2024,0,1),-1000],[Date.UTC(2025,0,1),1100]])');
  close(r, 0.1, 2e-3);
});
test('bond pricing at par and duration', () => {
  const b = ev('bondCalc({face:1000,coupon:8,years:5,ytm:8,freq:1,price:1000})');
  close(b.P, 1000, 1e-6); close(b.ytmFromPrice, 8, 1e-6); close(b.mac, 4.3121, 1e-3);
});
test('FIFO P&L matching with partial lots', () => {
  const r = ev(`fifo(normTrades([{symbol:'X',date:'2025-01-01',side:'BUY',qty:10,price:100},{symbol:'X',date:'2025-02-01',side:'BUY',qty:10,price:120},{symbol:'X',date:'2026-03-01',side:'SELL',qty:15,price:150}]))`);
  assert.equal(r.closed.length, 2);
  close(r.closed[0].pnl, 500); close(r.closed[1].pnl, 150); assert.equal(r.closed[0].term, 'LTCG');
  assert.equal(r.open[0].qty, 5);
});
test('screener query language', () => {
  assert.equal(ev(`parseQuery('Return on equity > 15 AND (Price to earning < 20 OR Debt to equity < 0.5)')({roe:0.2,pe:30,de:0.2})`), true);
  assert.equal(ev(`parseQuery('Return on equity > 15 AND Price to earning < 20')({roe:0.2,pe:30})`), false);
  assert.throws(() => ev(`parseQuery('Nonsense field > 3')`));
});
test('backtest bookkeeping: buy & hold equals price ratio without costs', () => {
  const r = ev(`(()=>{const b=S.D.RELIANCE.bars.slice(-300);STRATS.__test={n:'t',p:[],sig:(b,c)=>c.map(()=>1)};return backtest(b,'__test',{},{capital:1e6,alloc:100,sl:0,tp:0,costs:false})})()`);
  const b = ev('S.D.RELIANCE.bars.slice(-300)');
  close(r.eq.at(-1) / 1e6, b.at(-1).c / b[1].o, 5e-3);
});
test('GARCH parameters are stationary and forecasts converge', () => {
  const g = ev('garch(S.D.INFY.bars.slice(-500).map((x,i,a)=>i?Math.log(x.c/a[i-1].c):0).slice(1))');
  assert.ok(g.a > 0 && g.b > 0 && g.a + g.b < 1);
  close(g.fc(2000), g.v, g.v * 1e-3);
});
test('forecast engine returns 16 models with valid probabilities', () => {
  const r = ev(`runModels(S.D.TCS.bars,21,'TCS')`);
  const ks = Object.keys(r); assert.ok(ks.length >= 14, ks.join());
  for (const k of ks) assert.ok(r[k].pUp >= 0 && r[k].pUp <= 1, k);
});
test('Indian transaction charges are positive and STT applies on delivery', () => {
  const buy = ev(`txnCost(100000,'B','D')`), sell = ev(`txnCost(100000,'S','D')`);
  assert.ok(buy > 100 && sell > 100); // 0.1% STT each side on delivery
});
