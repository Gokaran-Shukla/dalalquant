'use strict';
/* ============================== SMART LISTS: every high-volatility stock, by market-cap pool ==============================
   Source A — whole NSE: the bridge scans every listed equity from NSE's own end-of-day files (split/bonus-adjusted
              previous close) and attaches AMFI's official market cap and Large / Mid / Small category.
   Source B — the stocks already in this terminal (works offline, uses each stock's loaded daily history).
   A stock qualifies if it is volatile on an absolute yardstick (annualised volatility, or how often it moves ≥10% in a
   day) and liquid enough to trade. Lists are exhaustive (no top-N cut) and ordered by market cap, largest first. */
const VL = Object.assign({ src: 'nse', years: 2, level: 'high', minTurn: 5 }, LS.get('dq_vl3', {}));
const VL_LEVELS = { extreme: ['Extreme', 0.15, 1.25, 4], high: ['High', 0.30, 1, 2], elevated: ['Elevated', 0.50, 0.85, 1] };   // [label, top share of pool, threshold multiplier, big-move days a year]
// what counts as a big mover differs by size: a 6% day is a big day for a large cap, small caps need 10%
const VL_RULES = { Large: { vol: 0.24, mv: 0.06, k: 'd6' }, Mid: { vol: 0.30, mv: 0.08, k: 'd8' }, Small: { vol: 0.38, mv: 0.10, k: 'd10' } };
function vlRule(c) { const L = VL_LEVELS[VL.level], R = VL_RULES[c] || VL_RULES.Small; return { vol: R.vol * L[2], mv: R.mv, k: R.k, days: L[3] } }
function vlWhy(r) { const R = vlRule(r.cat), yrs = r.yrs || (r.n ? r.n / 248 : VL.years), big = (r[R.k] != null ? r[R.k] : r.d10) / yrs; const ok = [];
  if (r.vol >= R.vol) ok.push(`annual vol ${(r.vol * 100).toFixed(0)}% ≥ ${(R.vol * 100).toFixed(0)}%`);
  if (big >= R.days) ok.push(`${big.toFixed(1)} days/yr moving ≥${R.mv * 100}% (needs ${R.days})`);
  if (r.poolRank && r.poolRank <= Math.ceil(r.poolN * VL_LEVELS[VL.level][1])) ok.push(`#${r.poolRank} most volatile of ${r.poolN} ${r.cat} caps`);
  if (r.vol >= 0.55 || r.f10 >= 6) ok.push('extreme mover');
  const liq = r.turnover_cr == null || r.turnover_cr >= VL.minTurn;
  return { ok: ok.length > 0 && liq, why: ok, liq, big, R } }
const VL_NAMES = { Large: '⚡ High volatility · Large caps', Mid: '⚡ High volatility · Mid caps', Small: '⚡ High volatility · Small caps' };
const VL_COL = { Large: '#3b82f6', Mid: '#f59e0b', Small: '#ef4444' };
const SPLIT_R = [2, 3, 4, 5, 10, 1.5, 2.5, 1.25];
let VL_CACHE = null;
function vlLocalStats(s, years) {
  const d = S.D[s.sym]; if (!d || !d.bars || d.bars.length < 60) return null; const b = d.bars.slice(-Math.round(years * 248) - 1);
  const rets = [], rng = []; let d5 = 0, d6 = 0, d8 = 0, d10 = 0, maxU = 0, maxD = 0, last10 = null, turn = 0;
  for (let i = 1; i < b.length; i++) { const p = b[i - 1].c, c = b[i].c; if (!(p > 0 && c > 0)) continue; const r = c / p - 1;
    if (r < -0.18 && SPLIT_R.some(k => Math.abs(p / c / k - 1) < 0.025)) continue;
    rets.push(r); maxU = Math.max(maxU, r); maxD = Math.min(maxD, r); const hi = b[i].h > 0 ? b[i].h : c, lo = b[i].l > 0 ? b[i].l : c;
    const sw = Math.max(Math.abs(r), hi / p - 1, 1 - lo / p); rng.push((hi - lo) / p); if (sw >= 0.05) d5++; if (sw >= 0.06) d6++; if (sw >= 0.08) d8++; if (sw >= 0.10) { d10++; last10 = b[i].t } }
  if (rets.length < 40) return null; const yrs = rets.length / 248; b.slice(-60).forEach(x => turn += (x.v || 0) * x.c / 1e7); turn /= Math.min(60, b.length);
  const m = S.M[s.sym]; const real = d.src && d.src.f !== 'sim' && m && m.mcap;
  return { sym: s.sym, name: s.name, price: b[b.length - 1].c, vol: std(rets) * Math.sqrt(248), adr: mean(rng), f5: d5 / yrs, f10: d10 / yrs, d5, d6, d8, d10, yrs, maxU, maxD, last10, turnover_cr: turn,
    mcap_cr: real ? m.mcap : (WL.meta[s.sym] && WL.meta[s.sym].mcap) || (m && m.mcap) || null, cat: (WL.meta[s.sym] && WL.meta[s.sym].cat) || capClass(s.sym), inTerm: 1, sim: d.src && d.src.px === 'sim' } }
function vlScore(rows) { const pr = k => { const v = rows.map(r => r[k]).sort((a, b) => a - b); rows.forEach(r => { const i = v.indexOf(r[k]), j = v.lastIndexOf(r[k]); r['p_' + k] = v.length > 1 ? (i + (j - i) / 2) / (v.length - 1) : 1 }) };
  ['vol', 'adr', 'f5', 'f10'].forEach(pr); rows.forEach(r => { r.score = 100 * (0.3 * r.p_vol + 0.3 * r.p_adr + 0.25 * r.p_f5 + 0.15 * r.p_f10) }); return rows }
/* Volatility is judged inside each market-cap pool (a 35%-vol large cap is wild for a large cap), so all three lists fill.
   A stock that is extreme on an absolute yardstick (≥55% annual vol or ≥6 days a year of 10% moves) is always included. */
function vlQualify(rows) { const out = [];
  rows.forEach(r => { r.cat = String(r.cat || 'Small').replace(/ ?cap/i, '') });
  ['Large', 'Mid', 'Small'].forEach(c => { const pool = rows.filter(r => r.cat === c).sort((a, b) => b.score - a.score);
    pool.forEach((r, i) => { r.poolRank = i + 1; r.poolN = pool.length; if (vlWhy(r).ok) out.push(r) }) });
  return out.sort((a, b) => (b.mcap_cr || 0) - (a.mcap_cr || 0) || b.score - a.score) }
async function vlLoad() {
  if (VL.src === 'nse') { if (!S.bridge.ok) throw new Error('Connect the bridge (Algo & Brokers) to scan the whole NSE, or switch the source to “Stocks in this terminal”.');
    const r = await bridgeFetch(`/scan/volatility?years=${VL.years}&min_turnover_cr=${Math.min(VL.minTurn, 1)}`, { timeout: 180000 });
    VL_CACHE = { src: 'nse', years: VL.years, rows: vlScore(r.rows.map(x => Object.assign(x, { inTerm: !!S.bySym[x.sym] }))), amfi: r.amfi_period, amfiN: r.amfi_n, days: r.cached_days } }
  else VL_CACHE = { src: 'term', years: VL.years, rows: vlScore(S.uni.filter(s => s.mkt === 'IN').map(s => vlLocalStats(s, VL.years)).filter(Boolean)) } }
function vlNote(x) { return `#${x.poolRank || '?'} most volatile of ${x.poolN || '?'} ${x.cat} caps · vol score ${fN(x.score, 0)} · ${(x.vol * 100).toFixed(0)}% annual vol · avg day range ${(x.adr * 100).toFixed(1)}% · ${x.d5} days ≥5%, ${x.d10} days ≥10% in ${VL.years}y · max ${fP(x.maxU, 0)} / ${fP(x.maxD, 0)}` }
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
    try { await vlLoad() } catch (e) { const msg = String(e.message || e).replace(/^[^:]*?\d{3}[^:]*:\s*/, '').replace(/^\{?"?detail"?:\s*/, '').replace(/["{}]/g, '').trim(); const needSync = /cache has only|NSE sync/i.test(msg); const notConn = /Connect the bridge/i.test(msg);
      if (needSync || notConn) { const src = VL.src; VL.src = 'term'; await vlLoad(); VL.src = src; Object.assign(VL_CACHE, { src: 'nse', fallback: 1, needSync, notConn }) }   // show terminal results right away
      else VL_CACHE = { err: msg, src: VL.src, years: VL.years, rows: [] } } }
  const C = VL_CACHE, pick = vlQualify(C.rows), by = c => pick.filter(r => r.cat === c);
  const simN = C.src === 'term' ? C.rows.filter(r => r.sim).length : 0;
  modal(`<div class="h3" style="font-size:18px">⚡ High-volatility watchlists <span class="r mu" style="font-size:12.5px;font-weight:500">${C.fallback ? `${C.rows.length} terminal stocks scanned (whole-NSE scan not ready yet)` : C.src === 'nse' ? `whole NSE · ${fN(C.rows.length, 0)} liquid stocks scanned${C.amfi ? ` · market caps: AMFI ${esc(C.amfi)}` : ''}` : `${C.rows.length} terminal stocks scanned`}</span></div>
   <div class="row vlParams"><label class="f">Scan<select id="vlSrc"><option value="nse" ${VL.src === 'nse' ? 'selected' : ''}>Whole NSE (via bridge)</option><option value="term" ${VL.src === 'term' ? 'selected' : ''}>Stocks in this terminal</option></select></label>
    <label class="f">History<select id="vlYrs">${[[1, '1 year'], [2, '2 years'], [3, '3 years']].map(([v, l]) => `<option ${v === VL.years ? 'selected' : ''} value="${v}">${l}</option>`).join('')}</select></label>
    <label class="f">Volatility level<select id="vlLvl">${Object.entries(VL_LEVELS).map(([k, [l]]) => `<option value="${k}" ${k === VL.level ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="f">Worth trading: avg daily value ≥<select id="vlTurn">${[1, 2, 5, 10, 25, 50].map(v => `<option ${v === VL.minTurn ? 'selected' : ''} value="${v}">₹${v} Cr</option>`).join('')}</select></label></div>
   ${C.needSync ? `<div class="vlSync"><div><b>Showing the stocks already in the terminal. To scan all ~2,000 NSE stocks, download NSE's daily price files once.</b></div><div class="mu">The whole-NSE scan reads NSE's official end-of-day files, which the bridge downloads once and keeps on your computer (≈2 years of files, about 10–20 minutes; newest days first, so the scan unlocks after the first year). Leave the bridge running.</div><div class="row" style="margin-top:8px"><button class="btn g" id="vlSyncGo">⬇ Download NSE data now</button></div><div class="labBar" style="margin:10px 0 4px"><i id="vlSyncBar" style="width:0%"></i></div><div class="mu" id="vlSyncT"></div></div>` : C.err ? `<div class="vlWarn">${esc(C.err)}</div>` : ''}
   ${simN > C.rows.length * 0.2 ? `<div class="vlWarn vlBad">⚠ ${simN} of ${C.rows.length} stocks still use <b>simulated demo prices</b> — their volatility is made up, so real movers like ADANIENT or MAZDOCK can be missed. Load real history first. ${S.bridge.ok ? '<button class="btn xs g" id="vlLoadH">Load real history now</button>' : 'Connect the bridge and click <b>Load live history</b>.'}</div>` : ''}
   ${C.notConn ? `<div class="vlWarn">Showing stocks already in the terminal. Connect the bridge (Algo &amp; Brokers) to scan the whole NSE.</div>` : ''}${C.src === 'nse' && !C.err && !C.fallback && !C.amfi ? `<div class="vlWarn">AMFI's market-cap list could not be downloaded, so Large / Mid / Small use estimates. Download “Average Market Capitalisation” (.xlsx) from amfiindia.com and put it in <span class="mono">bridge/cache/</span>, then re-scan.</div>` : ''}
   <div class="vlCheck"><input id="vlQ" placeholder="Why is a stock in or out? e.g. APOLLOHOSP, ADANIENT, MAZDOCK, M&M, CDSL, NSDL" value="${esc(VL.q || '')}"><button class="btn s" id="vlQGo">Check</button></div><div id="vlQOut"></div>
   <div class="vlCols">${['Large', 'Mid', 'Small'].map(c => `<div class="vlCol"><div class="vlCap" style="color:${VL_COL[c]}">${c} caps <b>${by(c).length}</b></div>
     <div class="vlHd"><span>#  Stock</span><span title="₹ crore; L = lakh crore">M.Cap ₹Cr</span><span>Vol</span><span>10% days</span></div>
     <div class="vlList">${by(c).map((r, i) => `<div class="vlRow" title="${esc(vlNote(r))}"><span class="vlNm"><span class="mu">${i + 1}</span> <b class="sym">${esc(r.sym)}</b>${r.inTerm ? '' : '<i class="vlNew" title="will be added to the terminal">new</i>'}</span><span class="mono">${r.mcap_cr ? (r.mcap_cr >= 1e5 ? (r.mcap_cr / 1e5).toFixed(1) + ' L' : fN(r.mcap_cr, 0)) : '—'}</span><span class="mono">${(r.vol * 100).toFixed(0)}%</span><span class="mono">${r.d10}</span></div>`).join('') || '<div class="mu">none</div>'}</div></div>`).join('')}</div>
   <div class="note">A stock qualifies if <b>any</b> of these hold: annual volatility ≥ ${(vlRule('Large').vol * 100).toFixed(0)}% / ${(vlRule('Mid').vol * 100).toFixed(0)}% / ${(vlRule('Small').vol * 100).toFixed(0)}% (large / mid / small); at least ${vlRule('Large').days} days a year moving ≥6% / ≥8% / ≥10% in a day (close or intraday); it is in the most volatile ${VL_LEVELS[VL.level][1] * 100}% of its pool; or it is an extreme mover. Lists are ordered by market cap, largest first. Stocks marked <i class="vlNew">new</i> are added to the terminal and their real history and fundamentals load in the background, so each one gets an <b>Entry / exit call</b>. Hover a row for its full volatility numbers.</div>
   <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn s" id="vlRe">↻ Re-scan</button><button class="btn s" data-act="closeModal">Cancel</button><button class="btn g" id="vlGo" ${pick.length ? '' : 'disabled'}>${simN > C.rows.length * 0.5 ? `Create anyway — prices are simulated (${pick.length})` : `Create / update 3 lists (${pick.length} stocks)`}</button></div>`);
  const set = () => { VL.src = $('#vlSrc').value; VL.years = +$('#vlYrs').value; VL.level = $('#vlLvl').value; VL.minTurn = +$('#vlTurn').value; LS.set('dq_vl3', VL); vlDialog() };
  ['#vlSrc', '#vlYrs', '#vlLvl', '#vlTurn'].forEach(s => $(s).onchange = set); $('#vlRe').onclick = () => vlDialog(true);
  $('#vlGo').onclick = async () => { $('#vlGo').disabled = true; const r = await vlApply(pick); closeModal(); toast(`High-volatility lists ready — Large ${r.made.Large} · Mid ${r.made.Mid} · Small ${r.made.Small}${r.added ? ` · ${r.added} stocks added to the terminal` : ''}`, 7000); const L = WL.lists.find(l => l.auto === 'vol-Large'); if (L) wlUse(L.id); go('lists') };
  const chk = () => { VL.q = $('#vlQ').value; const qs = VL.q.toUpperCase().split(/[\s,;]+/).filter(Boolean); $('#vlQOut').innerHTML = qs.map(q => { const r = C.rows.find(x => x.sym === q);
      if (!r) return `<div class="vlQr"><b class="sym">${esc(q)}</b> <span class="dn">not scanned</span> — ${S.bySym[q] ? 'not enough history loaded (needs 60+ days of real prices)' : C.src === 'nse' && !C.fallback ? 'not an NSE equity in the downloaded files, or below the ₹1 Cr/day liquidity floor' : 'not in the terminal — add it with search (/), or download NSE data for the whole-market scan'}</div>`;
      const w = vlWhy(r); return `<div class="vlQr"><b class="sym">${esc(q)}</b> ${w.ok ? '<span class="up">✓ qualifies</span>' : '<span class="dn">✗ not included</span>'} · ${r.cat} cap · vol ${(r.vol * 100).toFixed(0)}% (rule ≥${(w.R.vol * 100).toFixed(0)}%) · ${w.big.toFixed(1)} days/yr ≥${w.R.mv * 100}% (rule ≥${w.R.days}) · rank ${r.poolRank}/${r.poolN} · ₹${fN(r.turnover_cr, 1)} Cr/day${w.liq ? '' : ` <span class="dn">(below ₹${VL.minTurn} Cr liquidity floor)</span>`}${r.sim ? ' · <span class="dn">simulated prices</span>' : ''}</div>` }).join('') };
  $('#vlQGo').onclick = chk; $('#vlQ').onkeydown = e => { if (e.key === 'Enter') chk() }; if (VL.q) chk();
  const ut = $('#vlUseTerm'); if (ut) ut.onclick = () => { VL.src = 'term'; LS.set('dq_vl3', VL); vlDialog(true) };
  const sg = $('#vlSyncGo'); if (sg) sg.onclick = () => vlSyncNse(sg);
  const lh = $('#vlLoadH'); if (lh) lh.onclick = async () => { lh.disabled = true; lh.textContent = 'Loading real history… (a few minutes)'; await loadLiveHistory('ALL'); vlDialog(true) } }
// entry point in My Radar's sidebar
(function () { const _r = renderLists; renderLists = function () { _r(); const side = $('#tab-lists .wlSide'); if (!side || $('#vlBtn')) return; const d = document.createElement('div'); d.className = 'vlBox';
  const auto = WL.lists.filter(l => /^vol-/.test(l.auto || ''));
  d.innerHTML = `<div class="h3" style="margin-top:14px">Smart lists</div><button class="btn g vlBtn" id="vlBtn">⚡ Build high-volatility lists</button><div class="note">Scans the whole NSE for stocks that move hard, files every one into Large / Mid / Small cap lists by market cap, with an entry / exit call for each.${auto.length && auto[0].updated ? ` Last built ${new Date(auto[0].updated).toLocaleDateString('en-IN')}.` : ''}</div>`;
  side.appendChild(d); $('#vlBtn').onclick = () => vlDialog() }; RENDERERS.lists = renderLists })();

// one-click NSE end-of-day download from inside the dialog, with progress; re-scans automatically once a year of data is in
async function vlSyncNse(btn) { btn.disabled = true; btn.textContent = 'Downloading…';
  try { await bridgeFetch('/nse/sync?days=520&fo_days=60', { method: 'POST' }) } catch (e) { $('#vlSyncT').innerHTML = `<span class="dn">Could not start: ${esc(e.message)}</span>`; btn.disabled = false; btn.textContent = '⬇ Retry'; return }
  const tick = async () => { let st; try { st = await bridgeFetch('/nse/status') } catch (e) { setTimeout(tick, 4000); return }
    const bar = $('#vlSyncBar'), t = $('#vlSyncT'); if (!bar) return;   // dialog closed: the download continues on the bridge
    const pct = st.total ? Math.min(100, st.done / st.total * 100) : 0; bar.style.width = pct.toFixed(1) + '%';
    t.innerHTML = `${st.eq_days_cached} trading days downloaded${st.errors ? ` · <span class="dn">${st.errors} days failed</span>` : ''}${st.syncing ? ' · still downloading…' : ' · done'}`;
    if (st.errors > 40 && st.eq_days_cached < 20) { t.innerHTML += '<br><span class="dn">NSE is refusing the downloads from this network. Try again later, or use “Scan terminal stocks instead”.</span>'; btn.disabled = false; btn.textContent = '⬇ Retry'; return }
    if (st.eq_days_cached >= 260 || (!st.syncing && st.eq_days_cached >= 120)) { t.innerHTML += ' — scanning now'; vlDialog(true); return }
    setTimeout(tick, 3000) };
  tick() }
