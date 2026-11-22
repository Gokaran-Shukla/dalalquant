// Grouped tab navigation (v2 UI): every section belongs to exactly one feature tab and is reachable.
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
const w = dom.window, d = w.document, ev = c => w.eval(c);
after(() => w.close());

test('every section sits in exactly one group', () => {
  assert.deepEqual(errors, []);
  const ids = JSON.parse(ev('JSON.stringify(TABS.map(t=>t[0]))'));
  const groups = JSON.parse(ev('JSON.stringify(GROUPS.map(g=>gTabs(g[0])))'));
  const flat = groups.flat();
  assert.equal(new Set(flat).size, flat.length, 'no section in two groups');
  assert.deepEqual([...flat].sort(), [...ids].sort(), 'all sections grouped');
});

test('top bar shows 8 groups and the bottom bar 5 buttons', () => {
  assert.equal(d.querySelectorAll('#gnav button').length, 8);
  assert.equal(d.querySelectorAll('#bnav button').length, 5);
});

test('clicking a group opens its first section and remembers the last one', () => {
  d.querySelector('#gnav [data-group="fno"]').click();
  assert.equal(ev('S.tab'), 'options');
  assert.ok(d.querySelector('#tab-options').classList.contains('on'));
  assert.equal(d.querySelector('#gnav [data-group="fno"]').getAttribute('aria-current'), 'page');
  d.querySelector('#nav [data-tab="foa"]').click();
  assert.equal(ev('S.tab'), 'foa');
  d.querySelector('#gnav [data-group="markets"]').click();
  assert.equal(ev('S.tab'), 'markets');
  d.querySelector('#gnav [data-group="fno"]').click();
  assert.equal(ev('S.tab'), 'foa');
});

test('More sheet lists every section and closes on pick', () => {
  d.querySelector('#bnav [data-more]').click();
  const n = d.querySelectorAll('#modal .mgb').length;
  assert.equal(n, JSON.parse(ev('TABS.length')));
  d.querySelector('#modal .mgb[data-tab="journal"]').click();
  assert.equal(ev('S.tab'), 'journal');
  assert.equal(d.querySelector('#modal').style.display, 'none');
  assert.deepEqual(errors, []);
});

test('F&O tab: stat tiles, chain, and payoff + risk summary after a preset', () => {
  ev("go('options')");
  const t = d.querySelector('#tab-options');
  assert.ok(t.querySelectorAll('.stile').length >= 6);
  assert.ok(t.querySelector('.kp.atm'), 'ATM strike highlighted');
  const pre = t.querySelector('[data-optpreset]');
  pre.click();
  const t2 = d.querySelector('#tab-options');
  assert.ok(t2.querySelector('#payChart'), 'payoff chart');
  assert.ok(t2.querySelectorAll('.rsum > div').length === 5, 'risk summary rows');
  assert.ok(t2.querySelector('[data-act="legOrder"]'));
  assert.deepEqual(errors, []);
});

test('Markets tab: header, index cards, heatmap beside breadth, three mover lists', () => {
  ev("go('markets')");
  const t = d.querySelector('#tab-markets');
  assert.ok(t.querySelector('.phead h1'));
  assert.ok(t.querySelectorAll(':scope > .idxgrid .ic').length >= 4);
  assert.ok(t.querySelector('.frow .fmain .hm') && t.querySelector('.frow .fside #mkAD'));
  assert.equal(t.querySelectorAll('.g3 > .card').length, 3);
  assert.deepEqual(errors, []);
});

test('Portfolio tab: header and summary tiles', () => {
  ev("go('portfolio')");
  const t = d.querySelector('#tab-portfolio');
  assert.ok(t.querySelector('.phead h1'));
  assert.equal(t.querySelectorAll('.stiles .stile').length, 6);
  assert.ok(t.querySelector('#hSym') && t.querySelector('[data-act="hAdd"]'));
  assert.deepEqual(errors, []);
});
