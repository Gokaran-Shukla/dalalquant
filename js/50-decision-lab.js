'use strict';
/* ============================== DECISION LAB: run every quant engine, get one entry / exit flag ==============================
   For each stock in the chosen list it runs, one after another:
     1 DQ multi-factor score   2 trend (50/200-DMA, Supertrend)   3 momentum (RSI, MACD, 3-month return)
     4 16-model forecast ensemble (10-day horizon)   5 ML cross-sectional rank (if trained)   6 valuation vs intrinsic value
     7 market regime (Hurst exponent)   8 risk & liquidity (volatility, drawdown, ATR stop, traded value)
     9 event filters (results blackout, F&O ban)
   Each engine casts a vote from −2 to +2; the weighted consensus becomes ENTER / ENTER IN PARTS / BUY ON DIP / WAIT / EXIT,
   with a confidence, stop-loss, target and position size. Results are kept and also drive My Radar's "Entry / exit call". */
const LAB = Object.assign({ src: 'active', run: null, res: {}, t: 0 }, LS.get('dq_lab', {}), { busy: false, stop: false });
function labSave() { LS.set('dq_lab', { src: LAB.src, res: LAB.res, t: LAB.t }) }
const LAB_ENGINES = [['dq', 'DQ score', 1.4], ['trend', 'Trend', 1.2], ['mom', 'Momentum', 1.0], ['fc', '16-model forecast', 1.3], ['ml', 'ML rank', 0.8], ['val', 'Valuation', 0.8], ['regime', 'Regime', 0.5], ['risk', 'Risk & liquidity', 0.9], ['event', 'Events', 0.6]];
const LAB_FLAGS = { enter: ['ENTER', 'enter'], parts: ['ENTER IN PARTS', 'enter2'], dip: ['BUY ON DIP', 'dip'], wait: ['WAIT', 'wait'], exit: ['EXIT / AVOID', 'exit'] };
const clamp2 = v => Math.max(-2, Math.min(2, v));
function labSyms() { if (LAB.src === 'all') return S.uni.filter(s => s.mkt === 'IN').map(s => s.sym); if (LAB.src === 'active') return wlActive().syms.slice(); const L = WL.lists.find(l => l.id === LAB.src); return L ? L.syms.slice() : wlActive().syms.slice() }
function labEngines(sym) {
  const m = S.M[sym], d = S.D[sym]; if (!m || !d || !d.bars || d.bars.length < 120) return null; const b = d.bars, c = b.map(x => x.c), out = {};
  const V = { 'BUY ZONE': 2, HOLD: 1, WAIT: -1, EXIT: -2 };
  out.dq = { v: m.hardExit ? -2 : (V[m.verdict] ?? 0), t: `${m.verdict} · score ${fN(m.score, 0)}` };
  let tv = 0; const tt = []; if (m.sma200) { tv += m.price > m.sma200 ? 1 : -1; tt.push(m.price > m.sma200 ? 'above 200-DMA' : 'below 200-DMA') } if (m.sma50) { tv += m.price > m.sma50 ? 0.6 : -0.6; tt.push(m.price > m.sma50 ? 'above 50-DMA' : 'below 50-DMA') } if (m.stDir != null) { tv += m.stDir > 0 ? 0.6 : -0.6; tt.push('Supertrend ' + (m.stDir > 0 ? 'up' : 'down')) }
  out.trend = { v: clamp2(tv), t: tt.join(', ') };
  let mv = 0; if (m.rsi != null) mv += m.rsi > 75 ? -0.8 : m.rsi > 55 ? 0.7 : m.rsi < 30 ? 0.3 : m.rsi < 45 ? -0.7 : 0; if (m.macdH != null) mv += m.macdH > 0 ? 0.6 : -0.6; if (m.r3m != null) mv += m.r3m > 0.1 ? 0.7 : m.r3m < -0.1 ? -0.7 : 0;
  out.mom = { v: clamp2(mv), t: `RSI ${m.rsi != null ? m.rsi.toFixed(0) : '—'} · MACD ${m.macdH > 0 ? '+' : '−'} · 3M ${fP(m.r3m)}` };
  try { const r = runModels(b, 10, sym); const ks = Object.keys(r).filter(k => k !== 'naive'); if (ks.length) { const pUp = mean(ks.map(k => r[k].pUp)), exp = mean(ks.map(k => r[k].exp)), bull = ks.filter(k => r[k].exp > 0).length;
    out.fc = { v: clamp2((pUp - 0.5) * 8 + exp * 20), t: `${bull}/${ks.length} models up · P(up) ${(pUp * 100).toFixed(0)}% · exp ${fP(exp)} in 10d`, exp, pUp } } } catch (e) { }
  if (!out.fc) out.fc = { v: 0, t: 'forecast unavailable' };
  const xs = S.xs && S.xs.res && S.xs.res.now; if (xs && xs.length) { const i = xs.findIndex(z => z.sym === sym); if (i >= 0) { const pct = 1 - i / (xs.length - 1 || 1); out.ml = { v: clamp2((pct - 0.5) * 4), t: `ML rank top ${Math.max(1, Math.round((1 - pct) * 100))}%` } } }
  if (!out.ml) out.ml = { v: 0, t: 'ML model not trained (Quant → ML Ranking Model)', skip: 1 };
  out.val = m.ups != null ? { v: clamp2(m.ups * 5), t: `${m.ups >= 0 ? 'upside' : 'downside'} ${fP(Math.abs(m.ups), 0)} to intrinsic value${m.pe ? ' · P/E ' + fN(m.pe, 1) : ''}` } : { v: 0, t: 'no fundamentals', skip: 1 };
  const lr = c.slice(-253).map((x, i, a) => i ? Math.log(x / a[i - 1]) : null).slice(1); let H = null; try { H = hurst(lr) } catch (e) { }
  out.regime = H != null ? { v: H > 0.55 ? (tv > 0 ? 0.8 : -0.8) : H < 0.45 ? (m.rsi < 40 ? 0.5 : m.rsi > 65 ? -0.5 : 0) : 0, t: `Hurst ${H.toFixed(2)} · ${H > 0.55 ? 'trending — follow the trend' : H < 0.45 ? 'mean-reverting — fade extremes' : 'random walk'}` } : { v: 0, t: '—' };
  const vol = m.vol || std(lr) * Math.sqrt(252), adv = mean(b.slice(-20).map(x => x.v * x.c)) / 1e7; let rv = 0; if (vol > 0.6) rv -= 0.8; else if (vol > 0.4) rv -= 0.3; if (m.mdd != null && m.mdd < -0.5) rv -= 0.4; if (adv < 1) rv -= 1.2; else if (adv < 5) rv -= 0.4; else rv += 0.2;
  out.risk = { v: clamp2(rv), t: `vol ${(vol * 100).toFixed(0)}% · max DD ${fP(m.mdd, 0)} · trades ₹${fN(adv, adv < 10 ? 1 : 0)} Cr/day`, vol, adv };
  let ev = 0; const et = []; const bo = typeof inBlackout === 'function' ? inBlackout(sym) : null; if (bo) { ev -= 1.2; et.push(`results ${bo.d} — blackout`) } const ban = S.ev && S.ev.ban && (S.ev.ban.symbols || []); if (Array.isArray(ban) && ban.includes(sym)) { ev -= 1; et.push('in F&O ban') }
  out.event = { v: ev, t: et.join(' · ') || 'no event risk' };
  return out }
function labConsensus(sym, E) {
  const m = S.M[sym]; let s = 0, w = 0; LAB_ENGINES.forEach(([k, , wt]) => { const e = E[k]; if (!e || e.skip) return; s += e.v * wt; w += 2 * wt });
  const score = w ? s / w : 0; const agree = LAB_ENGINES.filter(([k]) => E[k] && !E[k].skip && Math.sign(E[k].v) === Math.sign(score) && E[k].v !== 0).length, used = LAB_ENGINES.filter(([k]) => E[k] && !E[k].skip).length;
  let f; if (score >= 0.35 && E.trend.v > 0 && (m.rsi == null || m.rsi < 72) && E.event.v > -1) f = 'enter'; else if (score >= 0.2) f = 'parts'; else if (score >= 0.05) f = 'dip'; else if (score > -0.3) f = 'wait'; else f = 'exit';
  if (E.dq.v === -2 && f !== 'exit') f = score > 0.2 ? 'wait' : 'exit';
  const atr = m.atr || m.price * 0.03, stop = m.price - 2 * atr, sp = 1 - stop / m.price, tgt = Math.max(m.price + 3 * atr, E.fc.exp ? m.price * (1 + Math.max(E.fc.exp, 0) * 2) : 0), size = Math.min(100, 1 / Math.max(sp, 0.005));
  const conf = Math.round(Math.min(99, Math.abs(score) * 120 + agree / Math.max(used, 1) * 35));
  return { f, score, conf, agree, used, stop, sp, tgt, size, dip: Math.max(m.ema20 || 0, m.price - atr), price: m.price, t: Date.now(), sim: S.D[sym].src && S.D[sym].src.px === 'sim', E };
}
async function labRun() {
  if (LAB.busy) { LAB.stop = true; return } const syms = labSyms().filter(s => S.M[s]); if (!syms.length) { toast('The selected list is empty — add stocks in My Radar first'); return }
  LAB.busy = true; LAB.stop = false; LAB.res = {}; LAB.t = Date.now(); renderLab();
  for (let i = 0; i < syms.length && !LAB.stop; i++) { const sym = syms[i]; const row = document.querySelector(`#tab-lab [data-labrow="${CSS.escape(sym)}"]`); if (row) { row.classList.add('running'); row.scrollIntoView({ block: 'nearest' }) }
    await new Promise(r => setTimeout(r, 0)); let E = null; try { E = labEngines(sym) } catch (e) { }
    if (row) { const chips = row.querySelectorAll('.labChip'); for (let j = 0; j < LAB_ENGINES.length; j++) { const e = E && E[LAB_ENGINES[j][0]]; if (chips[j]) { chips[j].className = 'labChip ' + (!e || e.skip ? 'na' : e.v > 0.25 ? 'pos' : e.v < -0.25 ? 'neg' : 'neu'); chips[j].title = LAB_ENGINES[j][1] + ': ' + (e ? e.t : '—') } await new Promise(r => setTimeout(r, 22)) } }
    if (E) LAB.res[sym] = labConsensus(sym, E); if (row) { row.classList.remove('running'); labPaintRow(row, sym, true) }
    const pr = $('#labProg'); if (pr) { pr.style.width = ((i + 1) / syms.length * 100) + '%'; $('#labProgT').textContent = `${i + 1} / ${syms.length} · ${sym}` } }
  LAB.busy = false; labSave(); renderLab(); if (S.tab !== 'lab') toast('Decision Lab finished — open the tab to see the flags');
  if (typeof dqNotify === 'function') { const n = Object.values(LAB.res).filter(r => r.f === 'enter').length; if (n) dqNotify('DalalQuant · Decision Lab', `${n} stock(s) flagged ENTER`) } }
function labFlag(r, flash) { const [t, k] = LAB_FLAGS[r.f]; return `<span class="dqf dqf-${k}${flash ? ' flash' : ''}">${t}</span>` }
function labPaintRow(row, sym, flash) { const r = LAB.res[sym]; const cell = row.querySelector('.labDec'); if (!cell) return; if (!r) { cell.innerHTML = '<span class="mu">—</span>'; return }
  cell.innerHTML = `${labFlag(r, flash)}<div class="dqs">${r.conf}% confidence · ${r.agree}/${r.used} engines agree${r.sim ? ' · <b class="dn">simulated data</b>' : ''}</div>`;
  const plan = row.querySelector('.labPlan'); if (plan) plan.innerHTML = r.f === 'exit' ? `<span class="dn">Avoid new buys · holders exit / SL ${fN(r.stop)}</span>` : r.f === 'wait' ? `<span class="mu">No entry yet · re-run later</span>` : `<div>${r.f === 'dip' ? `Buy near <b>${fN(r.dip)}</b>` : `Entry <b>${fN(r.price)}</b>`} · SL <b class="dn">${fN(r.stop)}</b> (−${(r.sp * 100).toFixed(1)}%)</div><div>Target <b class="up">${fN(r.tgt)}</b> · R:R ${((r.tgt - r.price) / (r.price - r.stop)).toFixed(1)} · size ≤${r.size >= 100 ? 100 : r.size.toFixed(0)}%</div>` }
function renderLab() {
  const el = $('#tab-lab'); const syms = labSyms(); const R = LAB.res; const cnt = k => Object.values(R).filter(r => r.f === k).length; const done = Object.keys(R).length;
  const rows = syms.filter(s => S.bySym[s]).map(s => ({ s, r: R[s] })); const order = { enter: 0, parts: 1, dip: 2, wait: 3, exit: 4 };
  if (!LAB.busy && done) rows.sort((a, b) => (a.r ? order[a.r.f] : 9) - (b.r ? order[b.r.f] : 9) || (b.r ? b.r.score : 0) - (a.r ? a.r.score : 0));
  el.innerHTML = `<div class="card labHero"><div class="row" style="gap:14px;align-items:flex-end">
    <label class="f">Stocks to test<select id="labSrc"><option value="active" ${LAB.src === 'active' ? 'selected' : ''}>Active list · ${esc(wlActive().name)}</option>${WL.lists.map(l => `<option value="${l.id}" ${LAB.src === l.id ? 'selected' : ''}>${esc(l.name)} (${l.syms.length})</option>`).join('')}<option value="all" ${LAB.src === 'all' ? 'selected' : ''}>All Indian stocks in the terminal</option></select></label>
    <button class="btn g labGo" id="labGo">${LAB.busy ? '■ Stop' : '▶ Run all quant engines'}</button>
    <div class="labMeta">${LAB.t ? `Last run ${new Date(LAB.t).toLocaleString('en-IN')}` : 'Not run yet'} · ${syms.length} stocks · 9 engines each</div></div>
   <div class="labBar"><i id="labProg" style="width:${LAB.busy ? 0 : done ? 100 : 0}%"></i><span id="labProgT">${LAB.busy ? 'starting…' : ''}</span></div>
   <div class="labSum">${Object.entries(LAB_FLAGS).map(([k, [t, c]]) => `<div class="labTile t-${c}"><b>${cnt(k)}</b><span>${t}</span></div>`).join('')}</div>
   <div class="labEng">${LAB_ENGINES.map(([k, l, w], i) => `<span class="labLeg"><i>${i + 1}</i>${l}</span>`).join('')}</div></div>
  <div class="card"><div class="tw"><table class="t labT"><thead><tr><th>#</th><th>Stock</th><th>Decision</th><th>Engines (1–9)</th><th>Trade plan</th><th class="n">Price</th><th class="n">1D</th><th class="n">M.Cap</th></tr></thead><tbody>
   ${rows.map((x, i) => { const m = S.M[x.s]; const E = x.r && x.r.E; return `<tr data-labrow="${esc(x.s)}"><td class="mu">${i + 1}</td><td><b class="sym cl" data-open="${esc(x.s)}">${esc(x.s)}</b><div class="mu wlSub">${esc((S.bySym[x.s].name || '').slice(0, 26))}</div></td>
    <td class="labDec"></td><td><div class="labChips">${LAB_ENGINES.map(([k, l], j) => { const e = E && E[k]; return `<span class="labChip ${!e ? '' : e.skip ? 'na' : e.v > 0.25 ? 'pos' : e.v < -0.25 ? 'neg' : 'neu'}" title="${esc(l + ': ' + (e ? e.t : 'not run'))}">${j + 1}</span>` }).join('')}</div></td>
    <td class="labPlan"></td><td class="n">${m ? fN(m.price) : ''}</td><td class="n ${m && m.chgp >= 0 ? 'up' : 'dn'}">${m ? fP(m.chgp) : ''}</td><td class="n">${wlMcap(x.s) ? fCr(wlMcap(x.s)) : '—'}</td></tr>` }).join('') || '<tr><td colspan="8" class="mu">Pick a list with stocks, then press Run.</td></tr>'}</tbody></table></div>
   <div class="note">Hover the numbered chips to see what each engine found (green = bullish, red = bearish, grey = neutral, dashed = not available). Stop-loss is 2×ATR; size is the share of capital that risks about 1% at that stop. Signals are calculations on the data shown — not investment advice.</div></div>`;
  rows.forEach(x => { const tr = el.querySelector(`[data-labrow="${CSS.escape(x.s)}"]`); if (tr) labPaintRow(tr, x.s, false) });
  $('#labGo').onclick = labRun; $('#labSrc').onchange = e => { LAB.src = e.target.value; labSave(); renderLab() } }
addTab('lab', '⚡', 'Decision Lab', 'lists', renderLab);
(function () { const g = GROUPS.find(g => g[0] === 'markets'); if (g && !g[3].includes('lab')) { const i = g[3].indexOf('lists'); g[3].splice(i < 0 ? 1 : i + 1, 0, 'lab') } if (typeof SUBS === 'object') SUBS.lab = 'Press Run: every quant engine tests each stock and flashes an ENTER / WAIT / EXIT flag with stop, target and size' })();
// My Radar's call column prefers a fresh Decision Lab verdict (same day) over the quick rule-based call
(function () { const _h = dqCallHtml; dqCallHtml = function (sym) { const r = LAB.res[sym]; if (r && Date.now() - r.t < 20 * 3600e3) { return `<div class="dqc">${labFlag(r)}<div class="dqs">Lab: ${r.conf}% conf · ${r.f === 'exit' || r.f === 'wait' ? 'no entry' : `SL ${fN(r.stop)} · tgt ${fN(r.tgt)} · size ≤${r.size >= 100 ? 100 : r.size.toFixed(0)}%`}</div></div>` } return _h(sym) } })();
