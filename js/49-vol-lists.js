'use strict';
/* ============================== SMART LISTS: most volatile stocks by market-cap pool ==============================
   Scores every Indian stock on how violently it actually moves, from its daily history:
     • annualised volatility of daily returns      • average daily range (high–low as % of previous close)
     • how often it moves ≥5% in a day             • how often it moves ≥10% in a day (close or intraday)
   Each is turned into a percentile rank and averaged into a 0–100 Volatility Score. The top stocks in each
   pool (Large 1–100, Mid 101–250, Small 251+ by market cap) go into three watchlists. Split/bonus days are ignored. */
const VL = Object.assign({ years: 2, top: 20, minScore: 0 }, LS.get('dq_vl2', {}));
const SPLIT_R = [2, 3, 4, 5, 10, 1.5, 2.5, 1.25];
function vlStats(s, years) {
  const d = S.D[s.sym]; if (!d || !d.bars || d.bars.length < 60) return null; const b = d.bars.slice(-Math.round(years * 248) - 1);
  const rets = [], rng = []; let d5 = 0, d10 = 0, maxU = 0, maxD = 0, last10 = null;
  for (let i = 1; i < b.length; i++) { const p = b[i - 1].c, c = b[i].c; if (!(p > 0 && c > 0)) continue; const r = c / p - 1;
    if (r < -0.18 && SPLIT_R.some(k => Math.abs(p / c / k - 1) < 0.025)) continue;   // split / bonus, not a real move
    rets.push(r); maxU = Math.max(maxU, r); maxD = Math.min(maxD, r);
    const hi = b[i].h > 0 ? b[i].h : c, lo = b[i].l > 0 ? b[i].l : c; const sw = Math.max(Math.abs(r), hi / p - 1, 1 - lo / p);
    rng.push((hi - lo) / p); if (sw >= 0.05) d5++; if (sw >= 0.10) { d10++; last10 = b[i].t } }
  if (rets.length < 40) return null; const yrs = rets.length / 248;
  return { sym: s.sym, cap: capClass(s.sym) || 'Small', vol: std(rets) * Math.sqrt(248), adr: mean(rng), f5: d5 / yrs, f10: d10 / yrs, d5, d10, maxU, maxD, last10, real: d.src && d.src.px === 'live' } }
function vlScan(o) {
  const rows = S.uni.filter(s => s.mkt === 'IN').map(s => vlStats(s, o.years)).filter(Boolean); if (!rows.length) return [];
  const pr = k => { const v = rows.map(r => r[k]).slice().sort((a, b) => a - b); rows.forEach(r => { r['p_' + k] = v.length > 1 ? (v.indexOf(r[k]) + (v.lastIndexOf(r[k]) - v.indexOf(r[k])) / 2) / (v.length - 1) : 1 }) };
  ['vol', 'adr', 'f5', 'f10'].forEach(pr); rows.forEach(r => { r.score = 100 * (0.3 * r.p_vol + 0.3 * r.p_adr + 0.25 * r.p_f5 + 0.15 * r.p_f10) });
  return rows.sort((a, b) => b.score - a.score) }
function vlPick(rows, o) { const out = []; ['Large', 'Mid', 'Small'].forEach(c => out.push(...rows.filter(r => r.cap === c && r.score >= o.minScore).slice(0, o.top))); return out }
function vlNote(x) { return `Vol score ${fN(x.score, 0)} · ${(x.vol * 100).toFixed(0)}% annual vol · avg day range ${(x.adr * 100).toFixed(1)}% · ${x.d5} days ≥5%, ${x.d10} days ≥10% in ${VL.years}y · max ${fP(x.maxU, 0)} / ${fP(x.maxD, 0)}` }
const VL_NAMES = { Large: '⚡ High volatility · Large caps', Mid: '⚡ High volatility · Mid caps', Small: '⚡ High volatility · Small caps' };
const VL_COL = { Large: '#3b82f6', Mid: '#f59e0b', Small: '#ef4444' };
function vlApply(pick) { const keep = WL.active; const made = {};
  ['Large', 'Mid', 'Small'].forEach(cap => { const rows = pick.filter(r => r.cap === cap);
    let L = WL.lists.find(l => l.auto === 'vol-' + cap); if (!L) { wlNew(VL_NAMES[cap], VL_COL[cap], []); L = wlActive(); L.auto = 'vol-' + cap }
    wlSet(L, rows.map(r => r.sym)); rows.forEach(r => { WL.notes[L.id + ':' + r.sym] = vlNote(r) }); made[cap] = rows.length; L.updated = Date.now() });
  wlUse(keep); wlSave(); return made }
function vlDialog() {
  const tot = S.uni.filter(s => s.mkt === 'IN').length, live = S.uni.filter(s => s.mkt === 'IN' && S.D[s.sym].src && S.D[s.sym].src.px === 'live').length;
  const rows = vlScan(VL); const pick = vlPick(rows, VL); const by = c => pick.filter(r => r.cap === c); const pool = c => rows.filter(r => r.cap === c).length;
  modal(`<div class="h3" style="font-size:18px">⚡ Build high-volatility watchlists</div>
   <div class="note" style="margin-top:0">Every stock's daily history is scored on <b>annual volatility</b>, <b>average daily range</b>, and <b>how often it moves ≥5% and ≥10% in a day</b> (up or down, close or intraday). The most volatile in each market-cap pool go into three lists. Split and bonus days are ignored.</div>
   ${live < tot * 0.8 ? `<div class="vlWarn">${live ? `Only ${live} of ${tot} stocks have real history loaded — the rest are simulated.` : 'Prices are still <b>simulated</b>, so this ranking is not meaningful yet.'} ${S.bridge.ok ? '<button class="btn xs g" id="vlLoad">Load real history now</button>' : 'Connect the bridge in <b>Algo &amp; Brokers</b> and click <b>Load live history</b> first.'}</div>` : `<div class="vlOk">Using real daily history for ${live} of ${tot} stocks.</div>`}
   <div class="row vlParams"><label class="f">History<select id="vlYrs">${[[1, '1 year'], [2, '2 years'], [3, '3 years'], [4, '4 years']].map(([v, l]) => `<option ${v === VL.years ? 'selected' : ''} value="${v}">${l}</option>`).join('')}</select></label>
    <label class="f">Stocks per list<select id="vlTop">${[10, 15, 20, 25, 30, 50].map(v => `<option ${v === VL.top ? 'selected' : ''} value="${v}">top ${v}</option>`).join('')}</select></label>
    <label class="f">Minimum volatility score<select id="vlMin">${[[0, 'any'], [50, '50+'], [60, '60+'], [70, '70+'], [80, '80+']].map(([v, l]) => `<option ${v === VL.minScore ? 'selected' : ''} value="${v}">${l}</option>`).join('')}</select></label></div>
   <div class="vlCols">${['Large', 'Mid', 'Small'].map(c => `<div class="vlCol"><div class="vlCap" style="color:${VL_COL[c]}">${c} caps <b>${by(c).length}</b><span class="mu"> of ${pool(c)}</span></div>
     <div class="vlHd"><span>Stock</span><span>Score</span><span>Ann. vol</span><span>Days ≥10%</span></div>
     <div class="vlList">${by(c).map(r => `<div class="vlRow" title="${esc(vlNote(r))}"><b class="sym">${esc(r.sym)}</b><span class="mono">${fN(r.score, 0)}</span><span class="mono">${(r.vol * 100).toFixed(0)}%</span><span class="mono">${r.d10}</span></div>`).join('') || '<div class="mu">none</div>'}</div></div>`).join('')}</div>
   <div class="note">Hover a stock for its full numbers; the same details are saved as its note in My Radar. Re-run any time (e.g. weekly) to refresh the three lists — your other lists are not touched.</div>
   <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn s" data-act="closeModal">Cancel</button><button class="btn g" id="vlGo" ${pick.length ? '' : 'disabled'}>Create / update 3 lists (${pick.length} stocks)</button></div>`);
  const rerun = () => { VL.years = +$('#vlYrs').value; VL.top = +$('#vlTop').value; VL.minScore = +$('#vlMin').value; LS.set('dq_vl2', VL); vlDialog() };
  ['#vlYrs', '#vlTop', '#vlMin'].forEach(s => $(s).onchange = rerun);
  $('#vlGo').onclick = () => { const m = vlApply(pick); closeModal(); toast(`High-volatility lists updated — Large ${m.Large} · Mid ${m.Mid} · Small ${m.Small}`, 6000); if (S.tab === 'lists') renderLists() };
  const ld = $('#vlLoad'); if (ld) ld.onclick = async () => { ld.disabled = true; ld.textContent = 'Loading real history… (a few minutes)'; await loadLiveHistory('ALL'); vlDialog() } }
// entry point in My Radar's sidebar
(function () { const _r = renderLists; renderLists = function () { _r(); const side = $('#tab-lists .wlSide'); if (!side || $('#vlBtn')) return; const d = document.createElement('div'); d.className = 'vlBox';
  const auto = WL.lists.filter(l => /^vol-/.test(l.auto || ''));
  d.innerHTML = `<div class="h3" style="margin-top:14px">Smart lists</div><button class="btn g vlBtn" id="vlBtn">⚡ Build high-volatility lists</button><div class="note">Ranks every stock's history by how violently it moves and fills Large / Mid / Small cap lists.${auto.length && auto[0].updated ? ` Last built ${new Date(auto[0].updated).toLocaleDateString('en-IN')}.` : ''}</div>`;
  side.appendChild(d); $('#vlBtn').onclick = vlDialog }; RENDERERS.lists = renderLists })();
