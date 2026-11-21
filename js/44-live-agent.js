'use strict';
/* ============================== LIVE AGENT: real-time NSE + BSE stream · market agent ==============================
   Talks to the bridge's push WebSocket /ws/live (bridge/live_feed.py → your broker's market-data socket) and the
   agent endpoints (/agent/*, bridge/agent.py). Symbols: RELIANCE = NSE, BSE:RELIANCE = BSE, index names as usual. */
S.lv = Object.assign({ syms: ['NIFTY 50', 'NIFTY BANK', 'SENSEX', 'RELIANCE', 'BSE:RELIANCE', 'HDFCBANK', 'BSE:HDFCBANK', 'INFY', 'TCS'], push: true, sound: false, notify: false },
  LS.get('dq_live', {}), { ws: null, on: false, q: {}, prev: {}, flash: {}, ev: [], notes: [], st: null, feed: null, chat: [], busy: false, dirty: false, params: null, tickN: 0, lastPush: 0, filter: '' });
function saveLv() { LS.set('dq_live', { syms: S.lv.syms, push: S.lv.push, sound: S.lv.sound, notify: S.lv.notify }) }
const lvKey = s => { s = String(s || '').trim().toUpperCase(); if (!s) return ''; if (s.startsWith('NSE:')) s = s.slice(4); return s };
const lvEx = k => k.startsWith('BSE:') || k === 'SENSEX' || k === 'BANKEX' ? 'BSE' : 'NSE';
const lvRoot = k => k.startsWith('BSE:') ? k.slice(4) : k;

function lvUrl() { const B = S.bridge; return B.url.replace(/^http/, 'ws').replace(/\/$/, '') + '/ws/live?throttle=250&symbols=' + encodeURIComponent(S.lv.syms.join(',')) + (B.token ? '&token=' + encodeURIComponent(B.token) : '') }

function lvConnect() {
  const L = S.lv; lvClose();
  if (!S.bridge.ok) { toast('Connect the bridge first (Algo & Brokers)'); return }
  let ws; try { ws = new WebSocket(lvUrl()) } catch (e) { toast(esc(e.message)); return }
  L.ws = ws; L.on = true; L.err = null;
  ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data) } catch (e) { return } lvMsg(m) };
  ws.onerror = () => { L.err = 'WebSocket error — is the bridge updated (needs /ws/live) and running?'; lvDraw() };
  ws.onclose = e => { if (L.ws !== ws) return; L.ws = null; if (e.code === 4401) L.err = 'Bridge token rejected'; if (L.on) { L.retry = setTimeout(lvConnect, 3000) } lvDraw() };
  lvDraw();
}
function lvClose() { const L = S.lv; clearTimeout(L.retry); if (L.ws) { const w = L.ws; L.ws = null; try { w.close() } catch (e) { } } }
function lvStop() { S.lv.on = false; lvClose(); lvDraw() }
function lvSend(o) { const w = S.lv.ws; if (w && w.readyState === 1) w.send(JSON.stringify(o)) }

function lvMsg(m) {
  const L = S.lv;
  if (m.type === 'hello') { L.feed = m.feed; L.st = m.status; L.params = m.params; (m.events || []).forEach(e => lvEvent(e, true)); if (S.tab === 'live') renderLive() }
  else if (m.type === 'subscribed') { Object.assign(L.q, m.snapshot || {}); L.dirty = true }
  else if (m.type === 'ticks') { for (const [k, t] of Object.entries(m.d)) { const p = L.q[k]; if (p && p.ltp !== t.ltp) L.flash[k] = t.ltp > p.ltp ? 'up' : 'dn'; L.prev[k] = p && p.ltp; L.q[k] = t; L.tickN++ } L.dirty = true; lvPushTerminal() }
  else if (m.type === 'event') lvEvent(m.e)
  else if (m.type === 'note') { L.notes.unshift(m); L.notes = L.notes.slice(0, 20); L.dirty = true }
  else if (m.type === 'status') { L.st = Object.assign({}, L.st, m); L.dirty = true }
  else if (m.type === 'error') { L.err = m.error; toast('Live feed: ' + esc(m.error), 6000); L.dirty = true }
}
function lvEvent(e, quiet) {
  const L = S.lv; if (!e || L.ev.some(x => x.id === e.id)) return; L.ev.unshift(e); L.ev = L.ev.slice(0, 300); L.dirty = true;
  if (quiet) return;
  if (e.sev === 'alert') { if (L.sound) lvBeep(); if (L.notify && typeof dqNotify === 'function') dqNotify('DalalQuant · ' + e.k, e.msg, S.bySym[lvRoot(e.k)] ? lvRoot(e.k) : null) }
}
function lvBeep() { try { const a = new (window.AudioContext || window.webkitAudioContext)(); const o = a.createOscillator(), g = a.createGain(); o.frequency.value = 880; g.gain.value = 0.05; o.connect(g); g.connect(a.destination); o.start(); setTimeout(() => { o.stop(); a.close() }, 160) } catch (e) { } }

/* Live NSE prices feed the rest of the terminal (rankings, portfolio, signals) every 15 s. */
function lvPushTerminal() {
  const L = S.lv; if (!L.push || Date.now() - L.lastPush < 15000) return; L.lastPush = Date.now();
  const Q = {}; for (const [k, t] of Object.entries(L.q)) { if (t.sim) continue; if (S.liveIdx && ['NIFTY 50', 'NIFTY BANK', 'SENSEX', 'NIFTY IT', 'NIFTY FIN SERVICE', 'NIFTY NEXT 50', 'INDIA VIX'].includes(k)) { S.liveIdx[k] = { ltp: +t.ltp, chg: t.pc ? t.ltp - t.pc : 0, chgp: t.pc ? t.ltp / t.pc - 1 : 0 }; continue } if (!k.startsWith('BSE:') && S.D[k]) Q[k] = { ltp: t.ltp, open: t.o, high: t.h, low: t.l, volume: t.v } }
  if (!Object.keys(Q).length) return;
  try { applyQuotes(Q); computeAll(); updateMode(); if (['markets', 'rankings', 'portfolio'].includes(S.tab)) render() } catch (e) { console.warn(e) }
}

/* ---- rendering (full on open, then light redraws at most ~4×/s) */
function lvStatus() {
  const L = S.lv, st = L.st || {}; const conn = L.ws && L.ws.readyState === 1;
  const anySim = Object.values(L.q).some(t => t.sim), anyPoll = Object.values(L.q).some(t => t.poll || t.delayed);
  let b = conn ? `<span class="badge b-live">● STREAMING</span>` : L.on ? `<span class="badge b-csv">CONNECTING…</span>` : `<span class="badge b-sim">OFF</span>`;
  if (anySim) b += ' <span class="badge b-sim" title="live.feed is \'sim\' in bridge config">SIMULATED FEED</span>';
  if (anyPoll) b += ' <span class="badge b-csv" title="This feed has no streaming API; quotes are polled and may be delayed">POLLED / DELAYED</span>';
  if (st.stale) b += ' <span class="badge b-sim">FEED STALE</span>';
  return `${b} <span class="mu">feed <b>${esc(L.feed || st.feed || '—')}</b> · ${st.connected ? 'broker socket up' : 'broker socket down'} · ${fN(st.ticks_per_sec || 0, 1)} ticks/s · ${st.market_open ? '<span class="up">market open</span>' : 'market closed'}${st.last_error ? ' · <span class="err">' + esc(String(st.last_error).slice(0, 120)) + '</span>' : ''}${L.err ? ' · <span class="err">' + esc(L.err) + '</span>' : ''}</span>`;
}
function lvRows() {
  const L = S.lv, f = L.filter.toUpperCase(); const now = Date.now() / 1000;
  const keys = L.syms.filter(k => !f || k.includes(f));
  return keys.map(k => {
    const t = L.q[k]; const fl = L.flash[k]; delete L.flash[k];
    if (!t) return `<tr><td><b>${esc(k)}</b></td><td>${lvEx(k)}</td><td class="n mu" colspan="8">waiting for first tick…</td><td><button class="btn xs s" data-act="lvRm" data-k="${esc(k)}">✕</button></td></tr>`;
    const chg = t.chg != null ? t.chg : (t.pc ? t.ltp / t.pc - 1 : null); const age = t.rx ? now - t.rx : null;
    const twin = k.startsWith('BSE:') ? L.q[lvRoot(k)] : L.q['BSE:' + k]; const bps = twin && twin.ltp ? (k.startsWith('BSE:') ? (t.ltp / twin.ltp - 1) : (twin.ltp / t.ltp - 1)) * 1e4 : null;
    return `<tr><td><b ${S.bySym[lvRoot(k)] ? `data-open="${esc(lvRoot(k))}" style="cursor:pointer" title="Open company"` : ''}>${esc(k)}</b></td><td><span class="tag">${lvEx(k)}</span></td>
      <td class="n" style="${fl ? `background:${fl === 'up' ? '#06301a' : '#3a0f0f'}` : ''}">${fN(t.ltp)}</td><td class="n">${fP(chg, 2)}</td>
      <td class="n">${t.bid ? fN(t.bid) : '—'}</td><td class="n">${t.ask ? fN(t.ask) : '—'}</td><td class="n">${t.v ? fN(t.v, 0) : '—'}</td><td class="n">${t.oi ? fN(t.oi, 0) : '—'}</td>
      <td class="n">${bps == null ? '<span class="mu">—</span>' : `<span class="${Math.abs(bps) >= 20 ? 'wa' : 'mu'}">${bps >= 0 ? '+' : ''}${bps.toFixed(1)}</span>`}</td>
      <td class="n ${age != null && age > 10 ? 'err' : 'mu'}">${age == null ? '—' : age < 1 ? 'now' : age.toFixed(0) + 's'}</td><td><button class="btn xs s" data-act="lvRm" data-k="${esc(k)}">✕</button></td></tr>`
  }).join('')
}
function lvEvRows() {
  const L = S.lv; const icon = { orb: '⇱', vwap: '≋', fast: '⚡', dayhi: '▲', daylo: '▼', volume: '▮', spread: '⇄', stale: '⚠' };
  if (!L.ev.length) return '<div class="mu">No events yet. The agent flags opening-range breaks, VWAP stretches, fast moves, volume surges, new day highs/lows and NSE–BSE price gaps as they happen.</div>';
  return L.ev.slice(0, 80).map(e => `<div class="lvev ${e.sev}"><span class="mono mu">${esc(e.t)}</span> <b>${icon[e.type] || '•'} ${esc(e.k)}</b> ${esc(e.msg.replace(e.k + ': ', '').replace(e.k + ' ', ''))}${e.sim ? ' <span class="badge b-sim">SIM</span>' : ''}</div>`).join('')
}
function lvChat() {
  const L = S.lv;
  return L.chat.map(c => c.role === 'user' ? `<div class="lvq">▸ ${esc(c.content)}</div>` : `<div class="lva">${esc(c.content).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>')}${c.tools && c.tools.length ? `<div class="note">tools: ${c.tools.map(t => esc(t.tool)).join(' → ')}</div>` : ''}</div>`).join('') + (L.busy ? '<div class="mu">Agent is reading the tape…</div>' : '')
}
function lvDraw() { if (S.tab !== 'live') return; const st = $('#lvStatus'); if (!st) { renderLive(); return } st.innerHTML = lvStatus(); $('#lvBody').innerHTML = lvRows(); $('#lvEv').innerHTML = lvEvRows(); $('#lvNotes').innerHTML = lvNotes(); S.lv.dirty = false }
function lvNotes() { const n = S.lv.notes; return n.length ? n.map(x => `<div class="lva"><span class="mono mu">${esc(x.t)}</span><br>${esc(x.text).replace(/\n/g, '<br>')}</div>`).join('') : '<div class="mu">Turn on <b>AI commentary</b> (needs your Anthropic key in the bridge) to get a short desk note every few minutes while events are arriving.</div>' }
setInterval(() => { if (S.lv.dirty && S.tab === 'live') lvDraw() }, 250);
setInterval(() => { if (S.tab === 'live' && S.lv.ws && S.bridge.ok) bridgeFetch('/live/status').then(s => { S.lv.st = s; S.lv.dirty = true }).catch(() => { }) }, 5000);

function renderLive() {
  const L = S.lv, el = $('#tab-live'); const P = L.params || {};
  el.innerHTML = `<div class="card"><h3>Live Agent · real-time NSE + BSE <span class="r" id="lvStatus">${lvStatus()}</span></h3>
   <div class="row">
    ${L.on ? '<button class="btn r" data-act="lvStop">Stop stream</button>' : '<button class="btn g" data-act="lvStart">Start stream</button>'}
    <input id="lvAdd" class="w120" style="width:260px" placeholder="Add: TATAMOTORS, BSE:TATAMOTORS, NIFTY 50">
    <button class="btn s" data-act="lvAddBtn">Add</button>
    <button class="btn s" data-act="lvBoth" title="Add the BSE leg of every NSE stock in the list">+ BSE legs</button>
    <button class="btn s" data-act="lvWatch" title="Keep the bridge streaming and alerting on these symbols even with this page closed">Agent: watch with page closed</button>
    <input id="lvFilter" placeholder="filter" style="width:110px" value="${esc(L.filter)}">
    <label><input type="checkbox" id="lvPush" ${L.push ? 'checked' : ''}> feed live prices into the terminal</label>
    <label><input type="checkbox" id="lvSound" ${L.sound ? 'checked' : ''}> beep on alerts</label>
    <label><input type="checkbox" id="lvNotify" ${L.notify ? 'checked' : ''}> desktop notifications</label>
   </div>
   <div class="tw" style="margin-top:10px"><table class="t"><thead><tr><th>Symbol</th><th>Exch</th><th class="n">LTP</th><th class="n">Chg</th><th class="n">Bid</th><th class="n">Ask</th><th class="n">Volume</th><th class="n">OI</th><th class="n" title="BSE minus NSE, basis points">NSE↔BSE bps</th><th class="n">Age</th><th></th></tr></thead><tbody id="lvBody">${lvRows()}</tbody></table></div>
   <div class="note">Ticks are pushed from your broker's market-data WebSocket through the bridge (Fyers, Zerodha or Angel One stream; other brokers fall back to polling). Retail access to NSE/BSE real-time data is through a broker or licensed vendor, so this uses yours. Daily login: open <span class="mono">/login/fyers</span> or <span class="mono">/login/zerodha</span> on the bridge.</div></div>
  <div class="g2">
   <div class="card"><h3>Agent events <span class="r"><button class="btn xs s" data-act="lvClearEv">Clear</button></span></h3><div id="lvEv" class="lvlist">${lvEvRows()}</div></div>
   <div class="card"><h3>Ask the agent</h3>
    <div id="lvChat" class="lvlist" style="max-height:330px">${lvChat()}</div>
    <div class="row" style="margin-top:8px"><input id="lvQ" style="flex:1" placeholder="e.g. Which of my symbols is stretched from VWAP? · Is RELIANCE cheaper on BSE right now? · Summarise the last 15 minutes"><button class="btn" data-act="lvAsk" ${L.busy ? 'disabled' : ''}>Ask</button></div>
    <div class="row" style="margin-top:6px">${['What is moving right now and why does it stand out?', 'Any NSE–BSE price gaps worth checking?', 'Which symbols broke their opening range today?'].map(q => `<button class="btn xs s" data-act="lvPreset" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
    <div class="note">The agent reads the live stream through tools (quotes, 1-minute bars, VWAP/opening range, events, NSE–BSE spread). It is read-only and cannot place orders. Needs <span class="mono">anthropic_api_key</span> in the bridge config.</div>
   </div></div>
  <div class="g2">
   <div class="card"><h3>Detector settings</h3>${L.params ? `<div class="row">
     ${[['orb_minutes', 'ORB minutes'], ['vwap_z', 'VWAP σ'], ['fast_pct', 'Fast move %'], ['fast_window', 'in seconds'], ['surge_mult', 'Volume × median'], ['spread_bps', 'NSE–BSE bps'], ['cooldown', 'Cooldown s']].map(([k, l]) => `<label class="f">${l}<input type="number" step="any" id="lvp_${k}" value="${P[k]}"></label>`).join('')}
     <label><input type="checkbox" id="lvp_notify_alerts" ${P.notify_alerts ? 'checked' : ''}> send alerts to Telegram/email</label>
     <label><input type="checkbox" id="lvp_narrate" ${P.narrate ? 'checked' : ''}> AI commentary</label></div>
     <button class="btn s" data-act="lvSaveP">Apply to bridge</button>` : '<div class="mu">Start the stream to load the bridge agent settings.</div>'}</div>
   <div class="card"><h3>AI desk commentary</h3><div id="lvNotes" class="lvlist">${lvNotes()}</div></div>
  </div>`;
  L.dirty = false;
}

function lvAddSyms(list) { const L = S.lv; const add = list.map(lvKey).filter(k => k && !L.syms.includes(k)); if (!add.length) return; L.syms.push(...add); saveLv(); lvSend({ op: 'sub', symbols: add }); renderLive() }
async function lvAsk(q) {
  const L = S.lv; q = (q || '').trim(); if (!q || L.busy) return; if (!S.bridge.ok) { toast('Connect the bridge first'); return }
  const history = L.chat.slice(-8).map(c => ({ role: c.role, content: c.content }));
  L.chat.push({ role: 'user', content: q }); L.busy = true; renderLive();
  try { const r = await bridgeFetch('/agent/ask', { method: 'POST', body: JSON.stringify({ question: q, history }), timeout: 180000 }); L.chat.push({ role: 'assistant', content: r.answer || '(no answer)', tools: r.tools }) }
  catch (e) { L.chat.push({ role: 'assistant', content: 'Error: ' + e.message }) }
  L.busy = false; renderLive(); const c = $('#lvChat'); if (c) c.scrollTop = c.scrollHeight;
}
Object.assign(EXTRA_ACTS, {
  lvStart: () => { lvConnect(); renderLive() }, lvStop: () => { lvStop(); renderLive() },
  lvAddBtn: () => lvAddSyms(($('#lvAdd').value || '').split(',')),
  lvBoth: () => lvAddSyms(S.lv.syms.filter(k => !k.startsWith('BSE:') && !['NIFTY 50', 'NIFTY BANK', 'SENSEX', 'NIFTY IT', 'NIFTY FIN SERVICE', 'NIFTY NEXT 50', 'INDIA VIX'].includes(k)).map(k => 'BSE:' + k)),
  lvRm: a => { const L = S.lv, k = a.dataset.k; L.syms = L.syms.filter(x => x !== k); delete L.q[k]; saveLv(); lvSend({ op: 'unsub', symbols: [k] }); renderLive() },
  lvWatch: async () => { try { const r = await bridgeFetch('/agent/watch', { method: 'POST', body: JSON.stringify({ symbols: S.lv.syms }) }); toast(`Agent watching ${r.watching.length} symbols on the bridge`) } catch (e) { toast(esc(e.message), 5000) } },
  lvClearEv: () => { S.lv.ev = []; lvDraw() },
  lvAsk: () => lvAsk($('#lvQ').value), lvPreset: a => lvAsk(a.dataset.q),
  lvSaveP: async () => { const upd = {}; ['orb_minutes', 'vwap_z', 'fast_pct', 'fast_window', 'surge_mult', 'spread_bps', 'cooldown'].forEach(k => { const v = parseFloat($('#lvp_' + k).value); if (isFinite(v)) upd[k] = v }); upd.notify_alerts = $('#lvp_notify_alerts').checked; upd.narrate = $('#lvp_narrate').checked;
    try { S.lv.params = await bridgeFetch('/agent/params', { method: 'POST', body: JSON.stringify(upd) }); toast('Agent settings applied') } catch (e) { toast(esc(e.message), 5000) } },
});
EXTRA_CHANGE.push(t => { const L = S.lv; if (t.id === 'lvPush') { L.push = t.checked; saveLv(); return true } if (t.id === 'lvSound') { L.sound = t.checked; saveLv(); return true }
  if (t.id === 'lvNotify') { L.notify = t.checked; saveLv(); if (t.checked && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission(); return true }
  if (t.id === 'lvFilter') { L.filter = t.value; lvDraw(); return true } return false });
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target && e.target.id === 'lvQ') lvAsk(e.target.value); if (e.key === 'Enter' && e.target && e.target.id === 'lvAdd') lvAddSyms(e.target.value.split(',')) });
addTab('live', '⚡', 'Live Agent · NSE/BSE stream', 'intraday', renderLive);
