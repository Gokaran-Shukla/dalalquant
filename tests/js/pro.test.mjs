// Theme switch, alert centre, customisable dashboard and stock comparison.
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

test('app lands on My Dashboard with default widgets', () => {
  assert.deepEqual(errors, []);
  assert.equal(ev('S.tab'), 'home');
  const ws = [...d.querySelectorAll('#dgrid .dw')].map(x => x.dataset.w);
  assert.deepEqual(ws, ['indices', 'watchlist', 'movers', 'heatmap', 'portfolio', 'breadth', 'opps', 'news']);
});

test('customise: remove, add, reorder and persist', () => {
  d.querySelector('[data-dash="edit"]').click();
  d.querySelector('[data-dash="rm"][data-w="news"]').click();
  assert.ok(!d.querySelector('#dgrid [data-w="news"]'));
  d.querySelector('[data-dash="add"][data-w="alerts"]').click();
  assert.equal([...d.querySelectorAll('#dgrid .dw')].at(-1).dataset.w, 'alerts');
  d.querySelector('[data-dash="up"][data-w="movers"]').click();
  assert.equal(d.querySelectorAll('#dgrid .dw')[1].dataset.w, 'movers');
  assert.deepEqual(JSON.parse(w.localStorage.getItem('dq_dash')).slice(0, 2), ['indices', 'movers']);
  d.querySelector('[data-dash="reset"]').click();
  d.querySelector('[data-dash="edit"]').click();
  assert.ok(!d.querySelector('#dgrid.editing'));
});

test('theme toggles to light and back, and is remembered', () => {
  assert.equal(d.documentElement.dataset.theme, 'dark');
  d.querySelector('#themeBtn').click();
  assert.equal(d.documentElement.dataset.theme, 'light');
  assert.equal(JSON.parse(w.localStorage.getItem('dq_theme')), 'light');
  assert.equal(ev('GRID'), '#E3E8F0');
  d.querySelector('#themeBtn').click();
  assert.equal(d.documentElement.dataset.theme, 'dark');
});

test('quick alert from a company page fires a notice and badges the bell', () => {
  const sym = ev('S.uni[0].sym');
  ev(`openSym('${sym}')`);
  d.querySelector('#tab-analyze [data-qalert]').click();
  d.querySelector('#qaT').value = 'price_below';
  d.querySelector('#qaV').value = '999999';
  d.querySelector('#qaSave').click();
  assert.ok(d.querySelectorAll('#notices .notice').length >= 2, 'created + fired notices');
  assert.equal(d.querySelector('#bell .bdg').textContent, '1');
  d.querySelector('#bell').click();
  assert.equal(d.querySelector('#bellPanel').style.display, 'block');
  assert.match(d.querySelector('#bellPanel li').textContent, new RegExp(sym));
  assert.equal(d.querySelector('#bell .bdg').style.display, 'none');
  d.body.click();
  assert.equal(d.querySelector('#bellPanel').style.display, 'none');
});

test('compare: defaults, add from company page, best-value highlight', () => {
  ev("go('compare')");
  const t = d.querySelector('#tab-compare');
  assert.ok(t.querySelectorAll('.cmpt thead th').length >= 3);
  assert.ok(t.querySelector('#cmpCh'));
  assert.ok(t.querySelector('td.best'));
  const sym = ev('S.uni[5].sym');
  ev(`openSym('${sym}')`);
  d.querySelector('#tab-analyze [data-cmpadd]').click();
  assert.equal(ev('S.tab'), 'compare');
  assert.equal(ev('S.cmp.syms[0]'), sym);
  d.querySelector('[data-cmpper="63"]').click();
  assert.equal(ev('S.cmp.per'), 63);
  assert.deepEqual(errors, []);
});
