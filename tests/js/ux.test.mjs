// Command palette, keyboard shortcuts, recently viewed stocks and chart export buttons.
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
const key = (k, o = {}, target = d.body) => target.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, ...o }));
after(() => w.close());

test('Ctrl+K opens the palette; typing finds sections and stocks; Enter opens', () => {
  assert.deepEqual(errors, []);
  key('k', { ctrlKey: true });
  assert.equal(d.querySelector('#cmdk').style.display, 'flex');
  const q = d.querySelector('#cmdQ');
  q.value = 'option chain'; q.dispatchEvent(new w.Event('input'));
  assert.match(d.querySelector('#cmdList .sel .cl').textContent, /F&O · Options/);
  key('Enter', {}, q);
  assert.equal(ev('S.tab'), 'options');
  assert.equal(d.querySelector('#cmdk').style.display, 'none');
  const sym = ev('S.uni[0].sym');
  key('k', { metaKey: true });
  q.value = sym; q.dispatchEvent(new w.Event('input'));
  const first = d.querySelector('#cmdList .sel .cl').textContent;
  assert.equal(first, sym);
  key('Enter', {}, q);
  assert.equal(ev('S.tab'), 'analyze');
  assert.equal(ev('S.sel'), sym);
});

test('recently viewed stocks persist and lead the empty palette', () => {
  const sym = ev('S.uni[0].sym');
  assert.equal(JSON.parse(w.localStorage.getItem('dq_recent'))[0], sym);
  key('k', { ctrlKey: true });
  assert.match(d.querySelector('#cmdList .cmdh').textContent, /Recently viewed/);
  key('Escape', {}, d.querySelector('#cmdQ'));
  assert.equal(d.querySelector('#cmdk').style.display, 'none');
});

test('g-shortcuts, brackets and ? help', () => {
  key('g'); key('p'); assert.equal(ev('S.tab'), 'portfolio');
  key('g'); key('m'); assert.equal(ev('S.tab'), 'markets');
  key(']'); assert.equal(ev('S.tab'), 'mood');
  key('['); assert.equal(ev('S.tab'), 'markets');
  key('?'); assert.ok(d.querySelector('#modal .kbgrid'));
  key('Escape'); assert.equal(d.querySelector('#modal').style.display, 'none');
});

test('shortcuts are ignored while typing', () => {
  const s = d.querySelector('#search'); s.focus();
  key('g', {}, s); key('p', {}, s);
  assert.equal(ev('S.tab'), 'markets');
});

test('chart-sized canvases get a Download PNG button; sparklines do not', () => {
  ev("go('backtest')");
  const sec = d.querySelector('#tab-backtest');
  assert.ok(sec.querySelectorAll('.cvdl').length >= 1);
  ev("go('markets')");
  const m = d.querySelector('#tab-markets');
  assert.equal(m.querySelectorAll('canvas[data-spark] + .cvdl').length, 0);
  assert.deepEqual(errors, []);
});
