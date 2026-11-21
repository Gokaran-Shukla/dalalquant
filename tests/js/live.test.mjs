// Drives the Live Agent tab with fake /ws/live messages (no bridge needed).
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
const w = dom.window, ev = c => w.eval(c);
after(() => w.close());

test('live tab is registered after Intraday and renders', () => {
  assert.deepEqual(errors, []);
  const ids = JSON.parse(ev('JSON.stringify(TABS.map(t=>t[0]))'));
  assert.equal(ids[ids.indexOf('intraday') + 1], 'live');
  ev("go('live')");
  assert.ok(w.document.querySelector('#lvBody'));
});
test('ticks, NSE–BSE spread and events render', () => {
  ev(`S.lv.syms=['RELIANCE','BSE:RELIANCE'];
      lvMsg({type:'hello',feed:'sim',status:{feed:'sim',connected:true,ticks_per_sec:4,market_open:false},params:{orb_minutes:15,vwap_z:2,fast_pct:0.8,fast_window:180,surge_mult:4,spread_bps:25,cooldown:600,notify_alerts:false,narrate:false},events:[]});
      lvMsg({type:'ticks',d:{'RELIANCE':{k:'RELIANCE',x:'NSE',ltp:1500,pc:1480,v:1000,rx:Date.now()/1000},'BSE:RELIANCE':{k:'BSE:RELIANCE',x:'BSE',ltp:1503,pc:1480,v:200,rx:Date.now()/1000}}});
      lvMsg({type:'event',e:{id:1,t:'10:01:02',k:'RELIANCE',type:'spread',sev:'watch',msg:'RELIANCE: BSE 1,503 vs NSE 1,500 = +20 bps.'}});
      renderLive()`);
  const body = w.document.querySelector('#lvBody').textContent;
  assert.match(body, /1,500\.00/); assert.match(body, /\+20\.0/);
  assert.match(w.document.querySelector('#lvEv').textContent, /BSE 1,503/);
  assert.deepEqual(errors, []);
});
test('symbol keys normalise', () => {
  assert.equal(ev("lvKey(' nse:infy ')"), 'INFY');
  assert.equal(ev("lvEx('BSE:INFY')+lvEx('SENSEX')+lvEx('INFY')"), 'BSEBSENSE');
});
