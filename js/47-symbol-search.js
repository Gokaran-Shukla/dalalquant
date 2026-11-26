'use strict';
/* ============================== SYMBOL SEARCH (TradingView-style) ==============================
   One search for everything: stocks already in the terminal, every NSE-listed equity and ETF,
   indices, BSE-only, US and global stocks, crypto (the last ones via the bridge's Yahoo search).
   Pick a result to open it, or press + to add it to your watchlist (it is added to the terminal
   and its real history is loaded through the bridge). */
const SS_KINDS = [['all', 'All'], ['stock', 'Stocks'], ['etf', 'ETFs'], ['index', 'Indices'], ['fno', 'F&amp;O'], ['global', 'US & Global'], ['crypto', 'Crypto']];
const SX = { q: '', kind: 'all', sel: 0, rows: [], remote: [], busy: false, seq: 0, err: '', recent: LS.get('dq_sym_recent', []) };
const FO_SET = () => new Set((S.cfg && S.cfg.lots ? Object.keys(S.cfg.lots) : []).concat(S.uni.filter(s => /[5NB]/.test(s.codes || '')).map(s => s.sym)));
function ssRank(q, sym, name) { q = q.toUpperCase(); sym = sym.toUpperCase(); name = (name || '').toUpperCase(); if (sym === q) return 0; if (sym.startsWith(q)) return 1; if (name.startsWith(q)) return 2; if (name.split(/\s+/).some(w => w.startsWith(q))) return 3; if (sym.includes(q)) return 4; if (name.includes(q)) return 5; return 99 }
function ssLocal(q, kind) {
  const fo = FO_SET(); const out = [];
  S.uni.forEach(s => { const t = s.etf ? 'etf' : 'stock'; const glob = s.mkt === 'US';
    if (kind === 'stock' && (t !== 'stock' || glob)) return; if (kind === 'etf' && t !== 'etf') return; if (kind === 'index' || kind === 'crypto') return; if (kind === 'global' && !glob) return; if (kind === 'fno' && !fo.has(s.sym)) return;
    const r = q ? ssRank(q, s.sym, s.name) : (S.watch.includes(s.sym) ? 0 : 9); if (r < 99) out.push({ sym: s.sym, name: s.name, exch: s.exch || (glob ? 'US' : 'NSE'), type: s.crypto ? 'crypto' : t, sector: s.sector, have: 1, rank: r }) });
  if (kind === 'all' || kind === 'index') Object.keys(S.IDX || {}).forEach(k => { const r = q ? ssRank(q, k, k) : 99; if (r < 99) out.push({ sym: k, name: k, exch: /SENSEX/.test(k) ? 'BSE' : /S&P|NASDAQ/.test(k) ? 'US' : 'NSE', type: 'index', idx: 1, have: 1, rank: r }) });
  return out.sort((a, b) => a.rank - b.rank || a.sym.length - b.sym.length) }
function ssMerge() { const loc = ssLocal(SX.q, SX.kind); const have = new Set(loc.map(r => r.sym)); const rem = SX.remote.filter(r => !have.has(r.sym) && (SX.kind === 'all' || SX.kind === r.type || (SX.kind === 'global' && r.route === 'yahoo') || (SX.kind === 'fno' && 0)));
  SX.rows = SX.q ? [...loc.slice(0, 30), ...rem] : (S.watch.length ? loc.filter(r => S.watch.includes(r.sym)) : loc.filter(r => !r.idx && S.M[r.sym]).sort((a, b) => (S.M[b.sym].score || 0) - (S.M[a.sym].score || 0)).slice(0, 12)); if (SX.sel >= SX.rows.length) SX.sel = 0 }
let _ssT = 0;
function ssQuery() { ssMerge(); ssDraw(); clearTimeout(_ssT); SX.remote = []; SX.err = ''; if (!SX.q || SX.q.length < 1 || !S.bridge.ok || SX.kind === 'fno') { ssDraw(); return }
  const seq = ++SX.seq; SX.busy = true; ssDraw();
  _ssT = setTimeout(async () => { try { const kind = SX.kind === 'global' ? 'global' : SX.kind; const r = await bridgeFetch(`/symbols/search?q=${encodeURIComponent(SX.q)}&kind=${kind}&limit=50`, { timeout: 15000 }); if (seq !== SX.seq) return; SX.remote = r.rows || []; SX.nse = r.nse_list } catch (e) { if (seq === SX.seq) SX.err = /404/.test(e.message) ? 'Update the bridge (git pull) to search all NSE stocks' : e.message } if (seq === SX.seq) { SX.busy = false; ssMerge(); ssDraw() } }, 220) }

const TYPE_LBL = { stock: 'stock', etf: 'ETF', index: 'index', crypto: 'crypto', futures: 'futures', fund: 'fund', forex: 'forex', other: '' };
function ssAvatar(sym, type) { const c = { index: '#a78bfa', etf: '#22d3ee', crypto: '#f59e0b', futures: '#f472b6' }[type] || '#3b82f6'; return `<span class="ssAv" style="background:${c}22;color:${c};border-color:${c}55">${esc((sym.replace(/^NIFTY\s?/, 'N')[0] || '?').toUpperCase())}</span>` }
function ssRowHtml(r, i) { const m = r.have && S.M[r.sym]; const star = S.watch.includes(r.sym);
  return `<div class="ssRow${i === SX.sel ? ' on' : ''}" data-ssi="${i}" role="option" aria-selected="${i === SX.sel}">${ssAvatar(r.sym, r.type)}
   <div class="ssMain"><div><b class="ssSym">${esc(r.sym)}</b>${r.have ? '' : ' <span class="ssNew">not in terminal</span>'}</div><div class="ssName">${esc(r.name || '')}${r.sector && r.sector !== 'Other' ? ' · ' + esc(r.sector) : ''}</div></div>
   ${m ? `<div class="ssPx"><span class="mono">${fN(m.price)}</span> <span class="mono ${m.chgp >= 0 ? 'up' : 'dn'}">${fP(m.chgp)}</span></div>` : '<div class="ssPx"></div>'}
   <div class="ssMeta">${TYPE_LBL[r.type] ? `<span class="ssType">${TYPE_LBL[r.type]}</span>` : ''}<span class="ssEx">${esc(r.exch || '')}</span></div>
   ${r.idx ? '<span class="ssAdd" style="visibility:hidden"></span>' : `<button class="ssAdd${star ? ' on' : ''}" data-ssadd="${i}" title="${star ? 'Remove from watchlist' : 'Add to watchlist'}" aria-label="${star ? 'Remove from watchlist' : 'Add to watchlist'}">${star ? '✓' : '+'}</button>`}</div>` }
function ssBodyHtml() {
  const head = !SX.q ? `<div class="ssSec">${S.watch.length ? 'Your watchlist' : 'Top-ranked in the terminal'}</div>` : '';
  const recent = !SX.q && SX.recent.length ? `<div class="ssRecent">Recent: ${SX.recent.slice(0, 8).map(q => `<button class="chip" data-ssq="${esc(q)}">${esc(q)}</button>`).join('')}</div>` : '';
  const status = SX.q ? `<div class="ssStat">${SX.busy ? 'Searching all NSE, BSE and global listings…' : SX.err ? `<span class="dn">${esc(SX.err)}</span>` : !S.bridge.ok ? 'Showing stocks already in the terminal. Connect the bridge (Algo &amp; Brokers) to search every NSE, BSE, US and crypto listing.' : `${SX.rows.length} results${SX.nse ? ` · searched ${fN(SX.nse, 0)} NSE listings + global` : ''}`}</div>` : '';
  let body = SX.rows.map(ssRowHtml).join('');
  if (SX.q && !SX.rows.length && !SX.busy) body = `<div class="ssEmpty">No match for <b>${esc(SX.q)}</b>.${/^[A-Z0-9&.\-]{2,20}$/i.test(SX.q) ? ` <button class="btn xs g" data-ssforce="${esc(SX.q.toUpperCase())}">Add ${esc(SX.q.toUpperCase())} as an NSE symbol anyway</button>` : ''}</div>`;
  return recent + head + `<div class="ssList" role="listbox">${body}</div>` + status }
function ssChips() { return SS_KINDS.map(([k, l]) => `<button class="chip${SX.kind === k ? ' on' : ''}" data-sskind="${k}">${l}</button>`).join('') }
function ssDraw() { const b = $('#ssBody'); if (b) b.innerHTML = ssBodyHtml(); const c = $('#ssChips'); if (c) c.innerHTML = ssChips(); const t = $('#ssTabBody'); if (t) t.innerHTML = ssBodyHtml(); const tc = $('#ssTabChips'); if (tc) tc.innerHTML = ssChips(); const on = document.querySelector('.ssRow.on'); if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' }) }

// ---- adding a symbol to the terminal (and loading its real data)
async function ssEnsure(r) {
  if (S.bySym[r.sym]) return S.bySym[r.sym];
  const glob = r.route === 'yahoo' && !/Bombay|BSE/i.test(r.exch || '');
  const s = { sym: r.sym, name: r.name || r.sym, sector: r.sector || 'Other', codes: glob ? 'U' : '', exch: r.exch || (glob ? 'US' : 'NSE') };
  if (r.type === 'etf') s.etf = 1; if (r.type === 'crypto') s.crypto = 1;
  if (r.route === 'yahoo' && S.bridge.ok) { try { await bridgeFetch('/symbols/register', { method: 'POST', body: JSON.stringify({ sym: r.sym, yahoo: r.yahoo || r.sym }) }) } catch (e) { } }
  const extra = LS.get('dq_uni_extra', []); if (!extra.find(e => e.sym === s.sym)) { extra.push(s); LS.set('dq_uni_extra', extra) }
  addSymbol(s); computeAll();
  if (S.bridge.ok) await ssLoadOne(s.sym); else toast(`${esc(s.sym)} added with simulated prices — connect the bridge to load real data`, 5000);
  return S.bySym[s.sym] }
async function ssLoadOne(sym) { const d = S.D[sym]; try { const r = await bridgeFetch(`/history?symbol=${encodeURIComponent(sym)}&interval=day&days=1100`, { timeout: 60000 }); if (Array.isArray(r.bars) && r.bars.length > 5) { d.bars = r.bars.map(x => ({ t: String(x.t).slice(0, 10), o: +x.o, h: +x.h, l: +x.l, c: +x.c, v: +x.v || 0, d: x.d != null ? +x.d : null })); d.src.px = 'live' } } catch (e) { toast(`Could not load ${esc(sym)} history: ${esc(e.message)}`, 5000) }
  if (S.bySym[sym].mkt === 'IN') { try { const f = await bridgeFetch(`/fundamentals?symbol=${encodeURIComponent(sym)}`, { timeout: 30000 }); if (f && Array.isArray(f.q) && f.q.length >= 4) applyFund(sym, f) } catch (e) { } }
  mergeDates(); computeAll(); updateMode() }
function ssRemember(q) { q = (q || '').trim(); if (!q) return; SX.recent = [q, ...SX.recent.filter(x => x.toUpperCase() !== q.toUpperCase())].slice(0, 12); LS.set('dq_sym_recent', SX.recent) }
async function ssPick(i) { const r = SX.rows[i]; if (!r) return; ssRemember(SX.q || r.sym); if (r.idx) { ssClose(); go('markets'); return }
  if (!r.have) toast(`Adding ${esc(r.sym)} to the terminal…`); await ssEnsure(r); ssClose(); openSym(r.sym) }
async function ssToggleWatch(i) { const r = SX.rows[i]; if (!r || r.idx) return; ssRemember(SX.q || r.sym);
  if (!r.have) { toast(`Adding ${esc(r.sym)}…`); await ssEnsure(r); r.have = 1 }
  const on = S.watch.includes(r.sym); S.watch = on ? S.watch.filter(x => x !== r.sym) : [...S.watch, r.sym]; LS.set('dq_watch', S.watch); toast(on ? `${esc(r.sym)} removed from watchlist` : `${esc(r.sym)} added to watchlist`); ssMerge(); ssDraw(); if (S.tab === 'search') renderSearchTab() }

// ---- the pop-up dialog
function ssOpen(q) { let o = $('#ssDlg');
  if (!o) { o = document.createElement('div'); o.id = 'ssDlg'; o.setAttribute('role', 'dialog'); o.setAttribute('aria-modal', 'true'); o.setAttribute('aria-label', 'Symbol search');
    o.innerHTML = `<div class="ssBox"><div class="ssHead"><span class="ssIco">⌕</span><input id="ssIn" placeholder="Symbol, company or ISIN — e.g. RELIANCE, tata, NIFTYBEES, AAPL, BTC" autocomplete="off" spellcheck="false"><button class="ssX" data-ssclose aria-label="Close">✕</button></div><div class="ssChips" id="ssChips"></div><div id="ssBody" class="ssBody"></div><div class="ssFoot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>+</kbd> button adds to watchlist</span><span><kbd>Esc</kbd> close</span></div></div>`;
    document.body.appendChild(o); o.addEventListener('mousedown', e => { if (e.target === o) ssClose() }) }
  o.style.display = 'flex'; const inp = $('#ssIn'); SX.q = (q || '').trim(); inp.value = SX.q; SX.sel = 0; ssQuery(); setTimeout(() => inp.focus(), 0) }
function ssClose() { const o = $('#ssDlg'); if (o) o.style.display = 'none' }
function ssKeys(e) { if (e.key === 'ArrowDown') { e.preventDefault(); SX.sel = Math.min(SX.rows.length - 1, SX.sel + 1); ssDraw() } else if (e.key === 'ArrowUp') { e.preventDefault(); SX.sel = Math.max(0, SX.sel - 1); ssDraw() } else if (e.key === 'Enter') { e.preventDefault(); ssPick(SX.sel) } else if (e.key === 'Escape') { e.preventDefault(); ssClose() } }
document.addEventListener('input', e => { if (e.target.id === 'ssIn' || e.target.id === 'ssTabIn') { SX.q = e.target.value.trim(); SX.sel = 0; ssQuery() } });
document.addEventListener('keydown', e => { if (e.target.id === 'ssIn' || e.target.id === 'ssTabIn') ssKeys(e) }, true);
document.addEventListener('click', e => { const t = e.target; if (!t.closest) return;
  const a = t.closest('[data-ssadd]'); if (a) { e.preventDefault(); e.stopPropagation(); ssToggleWatch(+a.dataset.ssadd); return }
  const k = t.closest('[data-sskind]'); if (k) { SX.kind = k.dataset.sskind; SX.sel = 0; ssQuery(); return }
  const rq = t.closest('[data-ssq]'); if (rq) { SX.q = rq.dataset.ssq; ['#ssIn', '#ssTabIn'].forEach(s => { const i = $(s); if (i) i.value = SX.q }); ssQuery(); return }
  const fo = t.closest('[data-ssforce]'); if (fo) { const sym = fo.dataset.ssforce; ssEnsure({ sym, name: sym, exch: 'NSE', type: 'stock' }).then(() => { ssClose(); openSym(sym) }); return }
  if (t.closest('[data-ssclose]')) { ssClose(); return }
  const row = t.closest('[data-ssi]'); if (row) { ssPick(+row.dataset.ssi); return }
  if (t.closest('[data-ssopen]')) { ssOpen(''); return }
  const rm = t.closest('[data-ssrm]'); if (rm) { const sym = rm.dataset.ssrm; askConfirm(`<h3>Remove ${esc(sym)} from the terminal?</h3><div class="note">It disappears from rankings, screens and your watchlist. You can search and add it again any time.</div>`, () => { LS.set('dq_uni_extra', LS.get('dq_uni_extra', []).filter(x => x.sym !== sym)); S.watch = S.watch.filter(x => x !== sym); LS.set('dq_watch', S.watch); location.reload() }) } });

// header search box and "/" open the dialog (instead of the old datalist)
(function hookHeader() { const s = $('#search'); if (!s) return; s.removeAttribute('list'); s.setAttribute('readonly', ''); s.placeholder = 'Search stocks, ETFs, indices, US, crypto…  (/)';
  s.addEventListener('focus', () => { s.blur(); ssOpen('') }); s.addEventListener('mousedown', e => { e.preventDefault(); ssOpen('') }) })();
document.addEventListener('keydown', e => { const typing = /INPUT|TEXTAREA|SELECT/.test((e.target.tagName || '')) || e.target.isContentEditable; if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === '/') { e.preventDefault(); e.stopImmediatePropagation(); ssOpen('') }
  else if (/^[a-zA-Z]$/.test(e.key) && e.key !== 'g' && !(typeof UX === 'object' && UX.gPending && Date.now() - UX.gPending < 1200) && !$('#cmdk[style*="flex"]') && !($('#modal') && $('#modal').style.display === 'flex') && (!$('#ssDlg') || $('#ssDlg').style.display !== 'flex')) { e.preventDefault(); ssOpen(e.key) } }, true);

// ---- the Search tab: same search inline + your watchlist and added stocks
function renderSearchTab() { ssMerge(); const el = $('#tab-search'); const extra = LS.get('dq_uni_extra', []); const W = S.watch.map(s => ({ s, m: S.M[s], u: S.bySym[s] })).filter(x => x.u);
  el.innerHTML = `<div class="card ssTabCard"><div class="ssHead big"><span class="ssIco">⌕</span><input id="ssTabIn" value="${esc(SX.q)}" placeholder="Search any NSE or BSE stock, ETF, index, US stock or crypto…" autocomplete="off" spellcheck="false"></div><div class="ssChips" id="ssTabChips">${ssChips()}</div><div id="ssTabBody" class="ssBody tab">${ssBodyHtml()}</div></div>
  <div class="g2e"><div class="card"><h3>Watchlist <span class="r mu" style="text-transform:none;letter-spacing:0">${W.length} stocks</span></h3>${W.length ? `<table class="t"><thead><tr><th>Symbol</th><th class="n">Price</th><th class="n">1D</th><th class="n">Score</th><th>Signal</th><th></th></tr></thead><tbody>${W.map(x => `<tr class="cl" data-open="${esc(x.s)}"><td><b class="sym">${esc(x.s)}</b> <span class="mu">${esc((x.u.name || '').slice(0, 26))}</span></td><td class="n">${x.m ? fN(x.m.price) : ''}</td><td class="n ${x.m && x.m.chgp >= 0 ? 'up' : 'dn'}">${x.m ? fP(x.m.chgp) : ''}</td><td class="n">${x.m ? fN(x.m.score, 0) : ''}</td><td>${x.m ? vpill(x.m.verdict) : ''}</td><td><button class="btn xs s" data-act="star" data-sym="${esc(x.s)}" title="Remove from watchlist">✕</button></td></tr>`).join('')}</tbody></table>` : '<div class="mu">Search above and press <b>+</b> to build your watchlist.</div>'}</div>
  <div class="card"><h3>Stocks you added to the terminal <span class="r mu" style="text-transform:none;letter-spacing:0">${extra.length}</span></h3>${extra.length ? `<table class="t"><thead><tr><th>Symbol</th><th>Exchange</th><th>Data</th><th></th></tr></thead><tbody>${extra.map(x => { const d = S.D[x.sym]; return `<tr><td><b class="sym cl" data-open="${esc(x.sym)}">${esc(x.sym)}</b> <span class="mu">${esc((x.name || '').slice(0, 30))}</span></td><td>${esc(x.exch || (x.codes === 'U' ? 'US' : 'NSE'))}</td><td>${d && d.src && d.src.px === 'live' ? '<span class="badge b-live">REAL</span>' : '<span class="badge b-sim">SIM</span>'}</td><td><button class="btn xs s" data-ssrm="${esc(x.sym)}">Remove</button></td></tr>` }).join('')}</tbody></table><div class="note">Added stocks join rankings, screener, alerts and the algo scanner like the built-in ones. Their real prices load through the bridge; reload them any time with <b>Load live history</b>.</div>` : '<div class="mu">The terminal starts with ~200 index stocks. Anything you add from search appears here.</div>'}</div></div>`;
  setTimeout(() => { const i = $('#ssTabIn'); if (i && S.tab === 'search') i.focus() }, 0) }
addTab('search', '⌕', 'Symbol Search', 'home', renderSearchTab);
(function () { const g = GROUPS.find(g => g[0] === 'markets'); if (g && !g[3].includes('search')) g[3].splice(1, 0, 'search'); if (typeof SUBS === 'object') SUBS.search = 'Find any NSE, BSE, US or crypto symbol and add it to your watchlist' })();
