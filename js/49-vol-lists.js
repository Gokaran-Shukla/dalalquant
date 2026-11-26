'use strict';
/* ============================== SMART LISTS: every high-volatility stock, by market-cap pool ==============================
   Source A — whole NSE: the bridge scans every listed equity from NSE's own end-of-day files (split/bonus-adjusted
              previous close) and attaches AMFI's official market cap and Large / Mid / Small category.
   Source B — the stocks already in this terminal (works offline, uses each stock's loaded daily history).
   A stock qualifies if it is volatile on an absolute yardstick (annualised volatility, or how often it moves ≥10% in a
   day) and liquid enough to trade. Lists are exhaustive (no top-N cut) and ordered by market cap, largest first. */
const VL = Object.assign({ src: 'nse', years: 2, level: 'high', minTurn: 5 }, LS.get('dq_vl3', {}));
const VL_LEVELS = { extreme: ['Extreme', 0.55, 6], high: ['High', 0.40, 3], elevated: ['Elevated', 0.32, 1] };   // [label, annual vol ≥, days ≥10% per year ≥]
const VL_NAMES = { Large: '⚡ High volatility · Large caps', Mid: '⚡ High volatility · Mid caps', Small: '⚡ High volatility · Small caps' };
const VL_COL = { Large: '#3b82f6', Mid: '#f59e0b', Small: '#ef4444' };
const SPLIT_R = [2, 3, 4, 5, 10, 1.5, 2.5, 1.25];
let VL_CACHE = null;
function vlLocalStats(s, years) {
  const d = S.D[s.sym]; if (!d || !d.bars || d.bars.length < 60) return null; const b = d.bars.slice(-Math.round(years * 248) - 1);
  const rets = [], rng = []; let d5 = 0, d10 = 0, maxU = 0, maxD = 0, last10 = null, turn = 0;
  for (let i = 1; i < b.length; i++) { const p = b[i - 1].c, c = b[i].c; if (!(p > 0 && c > 0)) continue; const r = c / p - 1;
    if (r < -0.18 && SPLIT_R.some(k => Math.abs(p / c / k - 1) < 0.025)) continue;
    rets.push(r); maxU = Math.max(maxU, r); maxD = Math.min(maxD, r); const hi = b[i].h > 0 ? b[i].h : c, lo = b[i].l > 0 ? b[i].l : c;
    const sw = Math.max(Math.abs(r), hi / p - 1, 1 - lo / p); rng.push((hi - lo) / p); if (sw >= 0.05) d5++; if (sw >= 0.10) { d10++; last10 = b[i].t } }
  if (rets.length < 40) return null; const yrs = rets.length / 248; b.slice(-60).forEach(x => turn += (x.v || 0) * x.c / 1e7); turn /= Math.min(60, b.length);
  const m = S.M[s.sym]; const real = d.src && d.src.f !== 'sim' && m && m.mcap;
  return { sym: s.sym, name: s.name, price: b[b.length - 1].c, vol: std(rets) * Math.sqrt(248), adr: mean(rng), f5: d5 / yrs, f10: d10 / yrs, d5, d10, maxU, maxD, last10, turnover_cr: turn,
    mcap_cr: real ? m.mcap : (WL.meta[s.sym] && WL.meta[s.sym].mcap) || (m && m.mcap) || null, cat: (WL.meta[s.sym] && WL.meta[s.sym].cat) || capClass(s.sym), inTerm: 1, sim: d.src && d.src.px === 'sim' } }
function vlScore(rows) { const pr = k => { const v = rows.map(r => r[k]).sort((a, b) => a - b); rows.forEach(r => { const i = v.indexOf(r[k]), j = v.lastIndexOf(r[k]); r['p_' + k] = v.length > 1 ? (i + (j - i) / 2) / (v.length - 1) : 1 }) };
  ['vol', 'adr', 'f5', 'f10'].forEach(pr); rows.forEach(r => { r.score = 100 * (0.3 * r.p_vol + 0.3 * r.p_adr + 0.25 * r.p_f5 + 0.15 * r.p_f10) }); return rows }
function vlQualify(rows) { const [, v, f] = VL_LEVELS[VL.level]; return rows.filter(r => (r.vol >= v || r.f10 >= f) && (r.turnover_cr == null || r.turnover_cr >= VL.minTurn)).map(r => Object.assign(r, { cat: String(r.cat || 'Small').replace(/ ?cap/i, '') }))
  .sort((a, b) => (b.mcap_cr || 0) - (a.mcap_cr || 0) || b.score - a.score) }
async function vlLoad() {
  if (VL.src === 'nse') { if (!S.bridge.ok) throw new Error('Connect the bridge (Algo & Brokers) to scan the whole NSE, or switch the source to “Stocks in this terminal”.');
    const r = await bridgeFetch(`/scan/volatility?years=${VL.years}&min_turnover_cr=${Math.min(VL.minTurn, 1)}`, { timeout: 180000 });
    VL_CACHE = { src: 'nse', years: VL.years, rows: vlScore(r.rows.map(x => Object.assign(x, { inTerm: !!S.bySym[x.sym] }))), amfi: r.amfi_period, amfiN: r.amfi_n, days: r.cached_days } }
  else VL_CACHE = { src: 'term', years: VL.years, rows: vlScore(S.uni.filter(s => s.mkt === 'IN').map(s => vlLocalStats(s, VL.years)).filter(Boolean)) } }
function vlNote(x) { return `Vol score ${fN(x.score, 0)} · ${(x.vol * 100).toFixed(0)}% annual vol · avg day range ${(x.adr * 100).toFixed(1)}% · ${x.d5} days ≥5%, ${x.d10} days ≥10% in ${VL.years}y · max ${fP(x.maxU, 0)} / ${fP(x.maxD, 0)}` }
async function vlApply(pick) { const keep = WL.active; const made = {}; const add = [];
  for (const x of pick) { WL.meta[x.sym] = { mcap: x.mcap_cr, cat: x.cat, rank: x.rank, t: Date.now() };
    if (!S.bySym[x.sym]) { const s = { sym: x.sym, name: x.name || x.sym, sector: 'Other', codes: '', exch: 'NSE' }; const ex = LS.get('dq_uni_extra', []); if (!ex.find(e => e.sym === s.sym)) { ex.push(s); LS.set('dq_uni_extra', ex) } addSymbol(s); add.push(x.sym) } }
  ['Large', 'Mid', 'Small'].forEach(cap => { const rows = pick.filter(r => r.cat === cap);
    let L = WL.lists.find(l => l.auto === 'vol-' + cap); if (!L) { wlNew(VL_NAMES[cap], VL_COL[cap], []); L = wlActive(); L.auto = 'vol-' + cap }
    wlSet(L, rows.map(r => r.sym)); L.sort = { k: 'mcap', dir: -1 }; rows.forEach(r => { WL.notes[L.id + ':' + r.sym] = vlNote(r) }); made[cap] = rows.length; L.updated = Date.now() });
  wlUse(keep); wlSave(); computeAll(); if (add.length && S.bridge.ok) vlBackfill(add); return { made, added: add.length } }
async function vlBackfill(syms) { let i = 0, ok = 0; const bar = document.createElement('div'); bar.className = 'vlProg'; document.body.appendChild(bar);
  const one = async sym => { try { await ssLoadOne(sym); ok++ } catch (e) { } bar.textContent = `Loading real history & fundamentals for new list stocks: ${ok} / ${syms.length}`; if (ok % 15 === 0 && S.tab === 'lists') renderLists() };
  const w = async () => { while (i < syms.length) await one(syms[i++]) }; await Promise.all([w(), w()]); bar.remove(); computeAll(); if (S.tab === 'lists') renderLists(); toast(`Loaded ${ok} new stocks — entry/exit calls are now based on real data`, 6000) }
async function vlDialog(reload) {
  if (reload || !VL_CACHE || VL_CACHE.src !== VL.src || VL_CACHE.years !== VL.years) {
    modal(`<div class="h3" style="font-size:18px">⚡ High-volatility watchlists</div><div class="vlBusy">${VL.src === 'nse' ? 'Scanning every NSE-listed stock from NSE end-of-day data…' : 'Scanning the stocks in this terminal…'}</div>`);
    try { await vlLoad() } catch (e) { VL_CACHE = { err: /409/.test(e.message) ? e.message.replace(/^.*?:\s*/, '') : e.message, src: VL.src, years: VL.years, rows: [] } } }
  const C = VL_CACHE, pick = vlQualify(C.rows), by = c => pick.filter(r => r.cat === c);
  const simN = C.src === 'term' ? C.rows.filter(r => r.sim).length : 0;
  modal(`<div class="h3" style="font-size:18px">⚡ High-volatility watchlists <span class="r mu" style="font-size:12.5px;font-weight:500">${C.src === 'nse' ? `whole NSE · ${fN(C.rows.length, 0)} liquid stocks scanned${C.amfi ? ` · market caps: AMFI ${esc(C.amfi)}` : ''}` : `${C.rows.length} terminal stocks scanned`}</span></div>
   <div class="row vlParams"><label class="f">Scan<select id="vlSrc"><option value="nse" ${VL.src === 'nse' ? 'selected' : ''}>Whole NSE (via bridge)</option><option value="term" ${VL.src === 'term' ? 'selected' : ''}>Stocks in this terminal</option></select></label>
    <label class="f">History<select id="vlYrs">${[[1, '1 year'], [2, '2 years'], [3, '3 years']].map(([v, l]) => `<option ${v === VL.years ? 'selected' : ''} value="${v}">${l}</option>`).join('')}</select></label>
    <label class="f">Volatility level<select id="vlLvl">${Object.entries(VL_LEVELS).map(([k, [l, v, f]]) => `<option value="${k}" ${k === VL.level ? 'selected' : ''}>${l} — vol ≥${v * 100}% or ≥${f} days of 10% moves a year</option>`).join('')}</select></label>
    <label class="f">Worth trading: avg daily value ≥<select id="vlTurn">${[1, 2, 5, 10, 25, 50].map(v => `<option ${v === VL.minTurn ? 'selected' : ''} value="${v}">₹${v} Cr</option>`).join('')}</select></label></div>
   ${C.err ? `<div class="vlWarn">${esc(C.err)}</div>` : ''}
   ${simN > C.rows.length * 0.2 ? `<div class="vlWarn">${simN} of ${C.rows.length} stocks still use <b>simulated</b> prices, so they are not ranked on real moves. ${S.bridge.ok ? '<button class="btn xs g" id="vlLoadH">Load real history now</button>' : 'Connect the bridge and click <b>Load live history</b>.'}</div>` : ''}
   ${C.src === 'nse' && !C.err && !C.amfi ? `<div class="vlWarn">AMFI's market-cap list could not be downloaded, so Large / Mid / Small use estimates. Download “Average Market Capitalisation” (.xlsx) from amfiindia.com and put it in <span class="mono">bridge/cache/</span>, then re-scan.</div>` : ''}
   <div class="vlCols">${['Large', 'Mid', 'Small'].map(c => `<div class="vlCol"><div class="vlCap" style="color:${VL_COL[c]}">${c} caps <b>${by(c).length}</b></div>
     <div class="vlHd"><span>#  Stock</span><span>M.Cap</span><span>Vol</span><span>10% days</span></div>
     <div class="vlList">${by(c).map((r, i) => `<div class="vlRow" title="${esc(vlNote(r))}"><span class="vlNm"><span class="mu">${i + 1}</span> <b class="sym">${esc(r.sym)}</b>${r.inTerm ? '' : '<i class="vlNew" title="will be added to the terminal">new</i>'}</span><span class="mono">${r.mcap_cr ? fCr(r.mcap_cr).replace('₹', '') : '—'}</span><span class="mono">${(r.vol * 100).toFixed(0)}%</span><span class="mono">${r.d10}</span></div>`).join('') || '<div class="mu">none</div>'}</div></div>`).join('')}</div>
   <div class="note">Every stock meeting the yardstick is included (no top-N cut), largest market cap first. Stocks marked <i class="vlNew">new</i> are added to the terminal and their real history and fundamentals load in the background, so each one gets an <b>Entry / exit call</b>. Hover a row for its full volatility numbers.</div>
   <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn s" id="vlRe">↻ Re-scan</button><button class="btn s" data-act="closeModal">Cancel</button><button class="btn g" id="vlGo" ${pick.length ? '' : 'disabled'}>Create / update 3 lists (${pick.length} stocks)</button></div>`);
  const set = () => { VL.src = $('#vlSrc').value; VL.years = +$('#vlYrs').value; VL.level = $('#vlLvl').value; VL.minTurn = +$('#vlTurn').value; LS.set('dq_vl3', VL); vlDialog() };
  ['#vlSrc', '#vlYrs', '#vlLvl', '#vlTurn'].forEach(s => $(s).onchange = set); $('#vlRe').onclick = () => vlDialog(true);
  $('#vlGo').onclick = async () => { $('#vlGo').disabled = true; const r = await vlApply(pick); closeModal(); toast(`High-volatility lists ready — Large ${r.made.Large} · Mid ${r.made.Mid} · Small ${r.made.Small}${r.added ? ` · ${r.added} stocks added to the terminal` : ''}`, 7000); const L = WL.lists.find(l => l.auto === 'vol-Large'); if (L) wlUse(L.id); go('lists') };
  const lh = $('#vlLoadH'); if (lh) lh.onclick = async () => { lh.disabled = true; lh.textContent = 'Loading real history… (a few minutes)'; await loadLiveHistory('ALL'); vlDialog(true) } }
// entry point in My Radar's sidebar
(function () { const _r = renderLists; renderLists = function () { _r(); const side = $('#tab-lists .wlSide'); if (!side || $('#vlBtn')) return; const d = document.createElement('div'); d.className = 'vlBox';
  const auto = WL.lists.filter(l => /^vol-/.test(l.auto || ''));
  d.innerHTML = `<div class="h3" style="margin-top:14px">Smart lists</div><button class="btn g vlBtn" id="vlBtn">⚡ Build high-volatility lists</button><div class="note">Scans the whole NSE for stocks that move hard, files every one into Large / Mid / Small cap lists by market cap, with an entry / exit call for each.${auto.length && auto[0].updated ? ` Last built ${new Date(auto[0].updated).toLocaleDateString('en-IN')}.` : ''}</div>`;
  side.appendChild(d); $('#vlBtn').onclick = () => vlDialog() }; RENDERERS.lists = renderLists })();
