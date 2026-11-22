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
