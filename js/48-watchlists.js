'use strict';
/* ============================== WATCHLISTS: as many named lists as you like ==============================
   The active list is always mirrored into S.watch, so every existing feature (stars, dashboard widget,
   "watchlist only" filters, alerts, sharing) keeps working and simply follows whichever list is active. */
const WL = (() => { let st = LS.get('dq_lists', null);
  if (!st || !Array.isArray(st.lists) || !st.lists.length) st = { active: 'w1', lists: [{ id: 'w1', name: 'My Watchlist', syms: LS.get('dq_watch', []), color: '#3b82f6', created: Date.now() }] };
  st.sort = st.sort || { k: 'add', dir: 1 }; st.notes = st.notes || {}; st.meta = st.meta || {}; return st })();
const WL_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a78bfa', '#22d3ee', '#f472b6', '#94a3b8'];
const WL_PRESETS = [['Long-term investments', '#22c55e'], ['Swing trades', '#f59e0b'], ['F&O watch', '#a78bfa'], ['Results this week', '#22d3ee'], ['Dividend stocks', '#3b82f6'], ['US & global', '#f472b6']];
function wlSave() { LS.set('dq_lists', WL) }
function wlActive() { return WL.lists.find(l => l.id === WL.active) || WL.lists[0] }
// keep S.watch <-> active list in sync, whichever side changes
const _lsSet = LS.set; LS.set = function (k, v) { _lsSet.call(LS, k, v); if (k === 'dq_watch' && Array.isArray(v)) { const a = wlActive(); if (a && a.syms !== v) { a.syms = v.slice(); _lsSet.call(LS, 'dq_lists', WL) } } };
function wlUse(id) { WL.active = id; const a = wlActive(); S.watch = a.syms.slice(); _lsSet.call(LS, 'dq_watch', S.watch); wlSave() }
wlUse(WL.active);
function wlSet(list, syms) { list.syms = [...new Set(syms)]; if (list.id === WL.active) { S.watch = list.syms.slice(); _lsSet.call(LS, 'dq_watch', S.watch) } wlSave() }
function wlNew(name, color, syms) { const id = 'w' + Date.now().toString(36); WL.lists.push({ id, name: name || 'New list', syms: syms || [], color: color || WL_COLORS[WL.lists.length % WL_COLORS.length], created: Date.now() }); wlUse(id); return id }
function wlMember(sym) { return WL.lists.filter(l => l.syms.includes(sym)) }

function wlMcap(sym) { const m = S.M[sym], d = S.D[sym]; if (m && m.mcap && d && d.src && d.src.f !== 'sim') return m.mcap; const x = WL.meta[sym]; if (x && x.mcap) return x.mcap; return m && m.mcap ? m.mcap : null }
function wlMcapReal(sym) { const d = S.D[sym]; return (d && d.src && d.src.f !== 'sim' && S.M[sym] && S.M[sym].mcap) || (WL.meta[sym] && WL.meta[sym].mcap) }
/* Entry / exit call for one stock: the terminal's verdict + trend, RSI and volatility turned into a plain instruction,
   with a stop 2×ATR away and a position size that risks ~1% of capital at that stop. */
function dqCall(sym) { const m = S.M[sym], d = S.D[sym]; if (!m || !m.price) return { k: 'na', t: '—', s: '' };
  if (d && d.src && d.src.px === 'sim') return { k: 'na', t: 'NO REAL DATA', s: 'Demo prices — connect the bridge and load live history to get a call' };
  const atr = m.atr || m.price * 0.03, stop = Math.max(0.01, m.price - 2 * atr), sp = 1 - stop / m.price, size = Math.min(100, 1 / Math.max(sp, 0.005));
  const up = (m.sma50 ? m.price > m.sma50 : true) && (m.stDir == null || m.stDir > 0), above200 = m.sma200 ? m.price > m.sma200 : null;
  const sl = `SL ${fN(stop)} (−${(sp * 100).toFixed(1)}%) · size ≤${size >= 100 ? '100' : size.toFixed(0)}%`;
  let c;
  if (m.hardExit || m.verdict === 'EXIT') c = { k: 'exit', t: 'EXIT / AVOID', s: `Downtrend${above200 === false ? ', below 200-DMA' : ''} — don't buy; holders exit${m.stLine && m.stLine > m.price ? ` or reclaim ${fN(m.stLine)} to re-check` : ''}` };
  else if (m.verdict === 'BUY ZONE' && up && (m.rsi == null || m.rsi < 72)) c = { k: 'enter', t: 'ENTER', s: `Buy zone, trend up · ${sl}` };
  else if (m.verdict === 'BUY ZONE') c = { k: 'enter2', t: 'ENTER IN PARTS', s: `Buy zone but ${m.rsi >= 72 ? 'overbought (RSI ' + m.rsi.toFixed(0) + ')' : 'trend not confirmed'} — ⅓ now, rest on dips · ${sl}` };
  else if (m.verdict === 'HOLD' && m.rsi != null && m.rsi >= 70) c = { k: 'wait', t: 'WAIT (HOT)', s: `Overbought (RSI ${m.rsi.toFixed(0)}) — let it cool; holders trail SL ${fN(stop)}` };
  else if (m.verdict === 'HOLD') { const dip = Math.max(m.ema20 || 0, m.price - atr); c = { k: 'dip', t: 'BUY ON DIP', s: `Good stock, no fresh signal — accumulate near ${fN(dip)} · holders keep SL ${fN(stop)}` } }
  else c = { k: 'wait', t: 'WAIT', s: `${above200 === false ? 'Below 200-DMA' : 'Momentum weak'} — no entry yet; watch for a close above ${fN(m.sma50 || m.price * 1.05)}` };
  return c }
function dqCallHtml(sym) { const c = dqCall(sym); return `<div class="dqc"><span class="dqf dqf-${c.k}">${c.t}</span><div class="dqs">${esc(c.s)}</div></div>` }
function wlRows(list) { const rows = list.syms.map((s, i) => ({ s, i, m: S.M[s], u: S.bySym[s] })).filter(x => x.u); const { k, dir } = list.sort || WL.sort;
  const ord = { enter: 0, enter2: 1, dip: 2, wait: 3, exit: 4, na: 5 }; const val = x => k === 'add' ? x.i : k === 'sym' ? x.s : k === 'mcap' ? wlMcap(x.s) : k === 'call' ? ord[dqCall(x.s).k] : x.m ? (k === 'score' ? x.m.score : x.m[k]) : null;
  if (k !== 'add') rows.sort((a, b) => { const va = val(a), vb = val(b); if (va == null) return 1; if (vb == null) return -1; return (typeof va === 'string' ? va.localeCompare(vb) : va - vb) * dir }); else if (dir < 0) rows.reverse();
  return rows }
function wlStats(rows) { const m = rows.map(r => r.m).filter(Boolean); if (!m.length) return null; const up = m.filter(x => x.chgp > 0).length; const best = m.reduce((a, b) => b.chgp > a.chgp ? b : a), worst = m.reduce((a, b) => b.chgp < a.chgp ? b : a);
  return { n: m.length, avg: mean(m.map(x => x.chgp)), up, dn: m.filter(x => x.chgp < 0).length, best, worst, r1m: mean(m.map(x => x.r1m).filter(v => v != null)), buy: m.filter(x => x.verdict === 'BUY ZONE').length, exit: m.filter(x => x.verdict === 'EXIT').length } }
const WL_COLS = [['sym', 'Stock'], ['call', 'Entry / exit call'], ['mcap', 'M.Cap', 1], ['price', 'Price', 1], ['chgp', '1D', 1], ['r1w', '1W', 1], ['r1m', '1M', 1], ['r1y', '1Y', 1], ['offH', 'From 52W high', 1], ['score', 'DQ score', 1]];
function renderLists() {
  const el = $('#tab-lists'); const A = wlActive(); const rows = wlRows(A); const st = wlStats(rows); const sk = A.sort || WL.sort;
  const th = ([k, l, n]) => `<th class="${n ? 'n' : ''} wlTh" data-wlsort="${k}">${l}${sk.k === k ? (sk.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`;
  el.innerHTML = `<div class="wlWrap"><aside class="card wlSide"><h3>My lists <span class="r"><button class="btn xs g" data-wlact="new">+ New list</button></span></h3>
   <div class="wlNav">${WL.lists.map(l => `<button class="wlItem${l.id === A.id ? ' on' : ''}" data-wluse="${l.id}"><span class="wlDot" style="background:${l.color}"></span><span class="wlNm">${esc(l.name)}</span><span class="wlCt">${l.syms.length}</span></button>`).join('')}</div>
   <div class="note" style="margin-top:10px">The highlighted list is your <b>active watchlist</b>: stars ☆ anywhere in the terminal, the dashboard widget and “watchlist only” filters use it.</div>
   ${WL.lists.length < 3 ? `<div class="h3" style="margin-top:12px">Quick start</div><div class="wlPre">${WL_PRESETS.filter(p => !WL.lists.some(l => l.name === p[0])).slice(0, 4).map(p => `<button class="chip" data-wlpreset="${esc(p[0])}" data-c="${p[1]}">+ ${esc(p[0])}</button>`).join('')}</div>` : ''}</aside>
  <div class="wlMainCol"><div class="card"><div class="wlHead"><span class="wlDot big" style="background:${A.color}"></span><input class="wlTitle" id="wlName" value="${esc(A.name)}" aria-label="List name" maxlength="40">
    <div class="wlColors">${WL_COLORS.map(c => `<button class="wlSw${c === A.color ? ' on' : ''}" style="background:${c}" data-wlcolor="${c}" aria-label="Colour ${c}"></button>`).join('')}</div>
    <span class="spacer"></span><button class="btn g" data-wlact="add">⌕ Add symbols</button>
    <div class="wlMore"><button class="btn s" data-wlact="menu" aria-label="More actions">⋯</button><div class="wlMenu" id="wlMenu">
     <button data-wlact="share">Share link</button><button data-wlact="csv">Export CSV</button><button data-wlact="paste">Paste symbols…</button><button data-wlact="dup">Duplicate list</button><button data-wlact="clear">Remove all symbols</button>${WL.lists.length > 1 ? '<button data-wlact="del" class="dn">Delete list</button>' : ''}</div></div></div>
   ${st ? `<div class="wlStats"><div><span class="mu">Stocks</span><b>${st.n}</b></div><div><span class="mu">Avg today</span><b class="${st.avg >= 0 ? 'up' : 'dn'}">${fP(st.avg)}</b></div><div><span class="mu">Up / down</span><b><span class="up">${st.up}</span> / <span class="dn">${st.dn}</span></b></div><div><span class="mu">Avg 1M</span><b class="${st.r1m >= 0 ? 'up' : 'dn'}">${fP(st.r1m)}</b></div><div><span class="mu">Best today</span><b class="cl" data-open="${esc(st.best.sym)}">${esc(st.best.sym)} <span class="up">${fP(st.best.chgp)}</span></b></div><div><span class="mu">Worst today</span><b class="cl" data-open="${esc(st.worst.sym)}">${esc(st.worst.sym)} <span class="dn">${fP(st.worst.chgp)}</span></b></div><div><span class="mu">Signals</span><b><span class="up">${st.buy} buy zone</span> · <span class="dn">${st.exit} exit</span></b></div></div>` : ''}
   ${rows.length ? `<div class="tw"><table class="t wlT"><thead><tr><th class="n">#</th>${th(WL_COLS[0])}${th(WL_COLS[1])}${th(WL_COLS[2])}<th>30D</th>${WL_COLS.slice(3).map(th).join('')}<th>Signal</th><th>Note</th><th></th></tr></thead><tbody>
    ${rows.map((r, ix) => { const m = r.m; const mc = wlMcap(r.s); const other = wlMember(r.s).filter(l => l.id !== A.id); return `<tr data-wlrow="${esc(r.s)}" draggable="${sk.k === 'add' ? 'true' : 'false'}"><td class="n mu">${ix + 1}</td><td><span class="wlGrip" title="Drag to reorder">⋮⋮</span><b class="sym cl" data-open="${esc(r.s)}">${esc(r.s)}</b><div class="mu wlSub">${esc((r.u.name || '').slice(0, 28))}${other.length ? ' · ' + other.map(l => `<span class="wlDot sm" style="background:${l.color}" title="Also in ${esc(l.name)}"></span>`).join('') : ''}</div></td>
     <td class="wlCallTd">${dqCallHtml(r.s)}</td><td class="n" title="${WL.meta[r.s] && WL.meta[r.s].cat ? esc(WL.meta[r.s].cat + ' cap · AMFI rank ' + (WL.meta[r.s].rank || '?')) : ''}">${mc ? fCr(mc) + (wlMcapReal(r.s) ? '' : '<span class="mu" title="estimate from simulated data">*</span>') : '—'}</td>
     <td><canvas class="wlSp" data-sp="${esc(r.s)}" data-spark="1" width="90" height="26"></canvas></td>
     <td class="n">${m ? fN(m.price) : '—'}${S.D[r.s] && S.D[r.s].src && S.D[r.s].src.px === 'sim' ? ' <span class="badge b-sim">SIM</span>' : ''}</td>${['chgp', 'r1w', 'r1m', 'r1y', 'offH'].map(k => `<td class="n ${m && m[k] != null ? (m[k] >= 0 ? 'up' : 'dn') : ''}">${m && m[k] != null ? fP(m[k]) : '—'}</td>`).join('')}<td class="n">${m ? fN(m.score, 0) : '—'}</td><td>${m ? vpill(m.verdict) : ''}</td>
     <td><input class="wlNote" data-wlnote="${esc(r.s)}" value="${esc(WL.notes[A.id + ':' + r.s] || '')}" placeholder="target, reason…" maxlength="80"></td>
     <td class="wlAct"><select class="wlMove" data-wlmove="${esc(r.s)}" aria-label="Copy to another list"><option value="">Copy to…</option>${WL.lists.filter(l => l.id !== A.id).map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}<option value="__new">New list…</option></select><button class="btn xs s" data-wlrm="${esc(r.s)}" aria-label="Remove ${esc(r.s)}">✕</button></td></tr>` }).join('')}</tbody></table></div>`
     : `<div class="wlEmpty"><div style="font-size:30px">☆</div><div><b>${esc(A.name)}</b> is empty.</div><div class="mu">Add stocks with <b>⌕ Add symbols</b>, the ☆ star on any stock, or paste a list of symbols.</div><div class="row" style="justify-content:center;margin-top:10px"><button class="btn g" data-wlact="add">⌕ Add symbols</button><button class="btn s" data-wlact="paste">Paste symbols…</button></div></div>`}
   </div></div></div>`;
  rows.forEach(r => { const d = S.D[r.s]; const cv = el.querySelector(`canvas[data-sp="${CSS.escape(r.s)}"]`); if (cv && d && d.bars) { const c = d.bars.slice(-30).map(b => b.c); sparkline(cv, c, c[c.length - 1] >= c[0] ? '#22c55e' : '#ef4444') } });
}
addTab('lists', '◎', 'My Radar', 'search', renderLists);
(function () { const g = GROUPS.find(g => g[0] === 'markets'); if (g && !g[3].includes('lists')) { const i = g[3].indexOf('search'); g[3].splice(i < 0 ? 1 : i + 1, 0, 'lists') } if (typeof SUBS === 'object') SUBS.lists = 'Every stock on your radar — as many named watchlists as you like, with prices, returns, signals and notes' })();

// ---- actions
function wlPrompt(title, val, ok) { modal(`<div class="h3" style="font-size:13px">${title}</div><input id="wlPr" value="${esc(val || '')}" maxlength="40" style="width:100%;margin:8px 0"><div class="row" style="justify-content:flex-end"><button class="btn s" data-act="closeModal">Cancel</button><button class="btn g" id="wlPrOk">OK</button></div>`);
  const i = $('#wlPr'); setTimeout(() => { i.focus(); i.select() }, 0); const go2 = () => { const v = i.value.trim(); if (!v) return; closeModal(); ok(v) }; $('#wlPrOk').onclick = go2; i.onkeydown = e => { if (e.key === 'Enter') go2() } }
function wlPaste() { const A = wlActive(); modal(`<div class="h3" style="font-size:13px">Paste symbols into ${esc(A.name)}</div><textarea id="wlPaste" rows="6" style="width:100%;margin:8px 0" placeholder="RELIANCE, TCS, INFY&#10;or one per line — from Excel, Zerodha, TradingView exports…"></textarea><div class="note">Unknown symbols are looked up and added to the terminal when the bridge is connected.</div><div class="row" style="justify-content:flex-end;margin-top:8px"><button class="btn s" data-act="closeModal">Cancel</button><button class="btn g" id="wlPasteOk">Add</button></div>`);
  setTimeout(() => $('#wlPaste').focus(), 0);
  $('#wlPasteOk').onclick = async () => { const raw = $('#wlPaste').value.toUpperCase().split(/[\s,;|\t]+/).map(x => x.replace(/^(NSE|BSE):/, '').replace(/-EQ$/, '').trim()).filter(x => /^[A-Z0-9&.\-^]{1,20}$/.test(x)); closeModal(); let add = [], miss = [];
    for (const s of raw) { if (S.bySym[s]) add.push(s); else if (S.bridge.ok) { try { const r = await bridgeFetch(`/symbols/search?q=${encodeURIComponent(s)}&limit=5`); const hit = (r.rows || []).find(x => x.sym === s); if (hit) { await ssEnsure(hit); add.push(s) } else miss.push(s) } catch (e) { miss.push(s) } } else miss.push(s) }
    wlSet(A, [...A.syms, ...add]); toast(`${add.length} added${miss.length ? ` · not found: ${esc(miss.slice(0, 8).join(', '))}` : ''}`, 6000); renderLists() } }
EXTRA_CLICK.push(t => { if (!t || !t.closest || !t.closest('#tab-lists, .modal, #modal')) return false;
  const menu = $('#wlMenu'); if (menu && !t.closest('.wlMore')) menu.classList.remove('on');
  const u = t.closest('[data-wluse]'); if (u) { wlUse(u.dataset.wluse); renderLists(); return true }
  const sw = t.closest('[data-wlcolor]'); if (sw) { wlActive().color = sw.dataset.wlcolor; wlSave(); renderLists(); return true }
  const so = t.closest('[data-wlsort]'); if (so) { const A0 = wlActive(); const k = so.dataset.wlsort; const cur = A0.sort || WL.sort; A0.sort = cur.k === k ? { k, dir: -cur.dir } : { k, dir: k === 'sym' || k === 'add' || k === 'call' ? 1 : -1 }; wlSave(); renderLists(); return true }
  const rm = t.closest('[data-wlrm]'); if (rm) { const A = wlActive(); wlSet(A, A.syms.filter(x => x !== rm.dataset.wlrm)); renderLists(); return true }
  const pr = t.closest('[data-wlpreset]'); if (pr) { wlNew(pr.dataset.wlpreset, pr.dataset.c); renderLists(); return true }
  const a = t.closest('[data-wlact]'); if (!a) return false; const A = wlActive(); const act = a.dataset.wlact;
  if (act === 'menu') { $('#wlMenu').classList.toggle('on'); return true }
  if (act === 'new') wlPrompt('Name the new list', '', v => { wlNew(v); renderLists() });
  else if (act === 'add') ssOpen('');
  else if (act === 'paste') wlPaste();
  else if (act === 'dup') { wlNew(A.name + ' (copy)', A.color, A.syms.slice()); renderLists() }
  else if (act === 'clear') askConfirm(`<h3>Remove all ${A.syms.length} symbols from ${esc(A.name)}?</h3>`, () => { wlSet(A, []); renderLists() });
  else if (act === 'del') askConfirm(`<h3>Delete the list “${esc(A.name)}”?</h3><div class="note">Its ${A.syms.length} symbols stay in the terminal and in your other lists.</div>`, () => { WL.lists = WL.lists.filter(l => l.id !== A.id); wlUse(WL.lists[0].id); renderLists() });
  else if (act === 'share') { if (!A.syms.length) { toast('The list is empty'); return true } copyText(shareLink(A.syms, A.name)) }
  else if (act === 'csv') { const rows = wlRows(A); const csv = 'Symbol,Name,Call,Call detail,MCap Cr,Price,1D %,1W %,1M %,1Y %,DQ score,Signal,Note\n' + rows.map(r => { const m = r.m || {}; const p = v => v == null ? '' : (v * 100).toFixed(2); const c = dqCall(r.s); const mc = wlMcap(r.s); return [r.s, '"' + (r.u.name || '').replace(/"/g, "'") + '"', c.t, '"' + c.s.replace(/"/g, "'") + '"', mc ? mc.toFixed(0) : '', m.price ? m.price.toFixed(2) : '', p(m.chgp), p(m.r1w), p(m.r1m), p(m.r1y), m.score != null ? m.score.toFixed(0) : '', m.verdict || '', '"' + (WL.notes[A.id + ':' + r.s] || '').replace(/"/g, "'") + '"'].join(',') }).join('\n');
    const b = new Blob([csv], { type: 'text/csv' }); const l = document.createElement('a'); l.href = URL.createObjectURL(b); l.download = A.name.replace(/[^\w-]+/g, '_') + '.csv'; l.click(); setTimeout(() => URL.revokeObjectURL(l.href), 1500) }
  const m = $('#wlMenu'); if (m) m.classList.remove('on'); return true });
EXTRA_CHANGE.push(t => {
  if (t.id === 'wlName') { const v = t.value.trim(); if (v) { wlActive().name = v; wlSave(); renderLists() } return true }
  if (t.dataset && t.dataset.wlnote != null) { const k = wlActive().id + ':' + t.dataset.wlnote; if (t.value.trim()) WL.notes[k] = t.value.trim(); else delete WL.notes[k]; wlSave(); return true }
  if (t.dataset && t.dataset.wlmove != null) { const sym = t.dataset.wlmove, to = t.value; t.value = ''; if (!to) return true;
    if (to === '__new') { wlPrompt('Name the new list', '', v => { const cur = WL.active; const id = wlNew(v, null, [sym]); wlUse(cur); toast(`${esc(sym)} copied to ${esc(v)}`); renderLists() }); return true }
    const L = WL.lists.find(l => l.id === to); if (L) { wlSet(L, [...L.syms, sym]); toast(`${esc(sym)} copied to ${esc(L.name)}`); renderLists() } return true }
  return false });
document.addEventListener('keydown', e => { if (e.target && e.target.id === 'wlName' && e.key === 'Enter') e.target.blur() });
// drag to reorder (in "as added" order)
let _wlDrag = null;
document.addEventListener('dragstart', e => { const r = e.target.closest && e.target.closest('[data-wlrow]'); if (r) { _wlDrag = r.dataset.wlrow; e.dataTransfer.effectAllowed = 'move' } });
document.addEventListener('dragover', e => { if (_wlDrag && e.target.closest && e.target.closest('[data-wlrow]')) e.preventDefault() });
document.addEventListener('drop', e => { const r = e.target.closest && e.target.closest('[data-wlrow]'); if (!_wlDrag || !r) return; e.preventDefault(); const A = wlActive(); const to = r.dataset.wlrow; if (to !== _wlDrag) { const s = A.syms.filter(x => x !== _wlDrag); s.splice(s.indexOf(to), 0, _wlDrag); wlSet(A, s); renderLists() } _wlDrag = null });

// ---- symbol search: show which list the + adds to, and let you switch it
(function () { const _draw = ssDraw; ssDraw = function () { _draw(); const f = $('#ssDlg .ssFoot'); if (!f) return; let s = $('#ssList'); if (!s) { s = document.createElement('label'); s.className = 'ssListSel'; f.appendChild(s) } const A = wlActive();
  s.innerHTML = `+ adds to <select id="ssListPick">${WL.lists.map(l => `<option value="${l.id}" ${l.id === A.id ? 'selected' : ''}>${esc(l.name)} (${l.syms.length})</option>`).join('')}</select>`; s.id = 'ssList' };
  document.addEventListener('change', e => { if (e.target.id === 'ssListPick') { wlUse(e.target.value); ssMerge(); ssDraw(); if (S.tab === 'lists') renderLists() } }) })();
