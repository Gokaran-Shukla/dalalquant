'use strict';
/* ============================== SIGNAL TRACK RECORD · point-in-time replay · survivorship-free membership · forward test ============================== */
S.tr = Object.assign({ ledger: [], fwdStart: null }, LS.get('dq_track', {}), { replay: null, busy: false, idx: 'ALL' });
S.memHist = LS.get('dq_memhist', {});   // {index: [{sym, from, to}]}
function saveTr() { LS.set('dq_track', { ledger: S.tr.ledger.slice(-60000), fwdStart: S.tr.fwdStart }) }

// --- point-in-time fundamentals: a quarter is known only after its results date (SEBI LODR: 45 days, 60 for Q4)
function qEnd(q) { const y = q.qn === 4 ? q.fy : q.fy - 1; const m = { 1: 5, 2: 8, 3: 11, 4: 2 }[q.qn]; return new Date(Date.UTC(y, m + 1, 0)) }
function qKnownBy(q) { if (!q.fy || !q.qn) return null; return new Date(qEnd(q).getTime() + (q.qn === 4 ? 60 : 45) * 86400000).toISOString().slice(0, 10) }
function pitQuarters(qs, date) { return (qs || []).filter(q => { const k = qKnownBy(q); return k ? k <= date : true }) }

// --- survivorship-free membership (import historical constituents)
function membersAt(index, date) { const H = S.memHist[index]; if (!H || !H.length) return null; return H.filter(r => r.from <= date && (!r.to || r.to > date)).map(r => r.sym) }
function importMembership(text) { const rows = parseCSV(text); const h = rows[0].map(x => x.trim().toLowerCase()); const g = (r, k) => r[h.indexOf(k)]; let n = 0; const M = {};
  rows.slice(1).forEach(r => { const idx = (g(r, 'index') || '').trim(), sym = (g(r, 'symbol') || '').trim().toUpperCase(); if (!idx || !sym) return; (M[idx] = M[idx] || []).push({ sym, from: normDate(g(r, 'from')) || '1990-01-01', to: g(r, 'to') ? normDate(g(r, 'to')) : null }); n++ });
  Object.assign(S.memHist, M); LS.set('dq_memhist', S.memHist); return `${n} membership rows for ${Object.keys(M).join(', ')}` }

// --- metrics at a past date, using only data available then
function metricsAt(date) { const out = {}; const sec = {};
  for (const s of S.uni.filter(x => x.mkt === 'IN')) { const D = S.D[s.sym]; if (!D) continue; const i = D.bars.findIndex(b => b.t > date); const bars = i < 0 ? D.bars : D.bars.slice(0, i); if (bars.length < 210) continue;
    const d = Object.assign({}, D, { bars, q: pitQuarters(D.q, date) }); let m; try { m = baseMetrics(s, d) } catch (e) { continue } out[s.sym] = { m, s, d }; const a = sec[s.sector] || (sec[s.sector] = { rev: 0, pes: [] }); if (m.revTTM > 0) a.rev += m.revTTM; if (m.pe > 0 && m.pe < 250) a.pes.push(m.pe) }
  for (const k in sec) sec[k].medPE = median(sec[k].pes);
  for (const k in out) { const { m, s } = out[k]; try { valuation(s, m, sec[s.sector]); scoreIt(s, m, sec[s.sector]) } catch (e) { } }
  return out }
function fwdRet(sym, date, h) { const b = S.D[sym].bars; const i = b.findIndex(x => x.t >= date); if (i < 0 || i + h >= b.length) return null; return b[i + h].c / b[i].c - 1 }

// --- historical replay: re-score every stock every 5 trading days, then measure what happened next
async function runReplay() { if (S.tr.busy) return; S.tr.busy = true; renderTrack(); await new Promise(r => setTimeout(r, 20));
  const dates = S.dates.slice(-320, -21).filter((_, i) => i % 5 === 0); const rows = [];
  for (let k = 0; k < dates.length; k++) { const t = dates[k]; const M = metricsAt(t); const syms = Object.keys(M);
    const ew = {}; for (const h of [1, 5, 21]) ew[h] = mean(syms.map(x => fwdRet(x, t, h)).filter(v => v != null));
    for (const sym of syms) { const m = M[sym].m; rows.push({ t, sym, v: m.verdict, sc: m.score, opp: !!m.opp, r1: fwdRet(sym, t, 1), r5: fwdRet(sym, t, 5), r21: fwdRet(sym, t, 21), x5: fwdRet(sym, t, 5) - ew[5], x21: fwdRet(sym, t, 21) - ew[21] }) }
    if (k % 6 === 0) { const el = $('#trProg'); if (el) el.textContent = `replaying ${t} (${k + 1}/${dates.length})`; await new Promise(r => setTimeout(r, 0)) } }
  S.tr.replay = { rows, dates, survivors: !Object.keys(S.memHist).length }; S.tr.busy = false; renderTrack() }

// --- live ledger: one entry per stock per trading day, scored as the future arrives
function trLog() { const day = S.dates[S.dates.length - 1]; if (S.tr._loggedFor === day) return; S.tr._loggedFor = day; const have = new Set(S.tr.ledger.filter(e => e.t === day).map(e => e.sym)); let n = 0;
  for (const s of S.uni.filter(x => x.mkt === 'IN')) { const m = S.M[s.sym]; if (!m || have.has(s.sym)) continue; S.tr.ledger.push({ t: day, sym: s.sym, v: m.verdict, sc: m.score != null ? Math.round(m.score) : null, opp: m.opp ? 1 : 0, p: m.price, src: S.D[s.sym].src.px }); n++ }
  if (n) saveTr() }
AFTER_COMPUTE.push(trLog);
function scoreLedger() { return S.tr.ledger.map(e => Object.assign({}, e, { r1: fwdRet(e.sym, e.t, 1), r5: fwdRet(e.sym, e.t, 5), r21: fwdRet(e.sym, e.t, 21) })) }

function bucketStats(rows, key) { const g = {}; rows.forEach(r => { const k = typeof key === 'function' ? key(r) : r[key]; (g[k] = g[k] || []).push(r) });
  return Object.entries(g).map(([k, a]) => { const s = h => { const v = a.map(r => r['r' + h]).filter(x => x != null); const x = a.map(r => r['x' + h]).filter(x => x != null); return { n: v.length, avg: mean(v), hit: v.length ? v.filter(y => y > 0).length / v.length : null, ex: mean(x), t: x.length > 2 ? mean(x) / (std(x) / Math.sqrt(x.length)) : null } }; return { k, n: a.length, h5: s(5), h21: s(21) } }) }
function signalEquity(rows, dates, pick) { let eq = 1, ew = 1; const E = [1], W = [1]; dates.forEach(t => { const day = rows.filter(r => r.t === t && r.r5 != null); const sel = day.filter(pick); if (!day.length) return; const rs = sel.length ? mean(sel.map(r => r.r5)) : 0; eq *= 1 + rs; ew *= 1 + mean(day.map(r => r.r5)); E.push(eq); W.push(ew) }); return { E, W } }
function forwardBook() { if (!S.tr.fwdStart) return null; const L = scoreLedger().filter(e => e.t >= S.tr.fwdStart); const days = [...new Set(L.map(e => e.t))].sort(); let eq = 1, ew = 1; const E = [1], W = [1], T = [S.tr.fwdStart];
  days.forEach(t => { const d = L.filter(e => e.t === t && e.r1 != null); if (!d.length) return; const b = d.filter(e => e.v === 'BUY ZONE'); eq *= 1 + (b.length ? mean(b.map(e => e.r1)) : 0); ew *= 1 + mean(d.map(e => e.r1)); E.push(eq); W.push(ew); T.push(t) }); return { E, W, T, days: days.length } }

function renderTrack() {
  const el = $('#tab-track'); const R = S.tr.replay; const L = scoreLedger(); const FB = forwardBook(); const memIdx = Object.keys(S.memHist);
  const tbl = (st, lab) => `<div class="tw"><table class="t"><thead><tr><th>${lab}</th><th class="n">Signals</th><th class="n">Hit 5d</th><th class="n">Avg 5d</th><th class="n">Excess 5d</th><th class="n">Hit 21d</th><th class="n">Avg 21d</th><th class="n">Excess 21d</th><th class="n">t-stat (21d excess)</th></tr></thead><tbody>${st.map(b => `<tr><td><b>${esc(b.k)}</b></td><td class="n">${b.n}</td><td class="n">${fPp(b.h5.hit, 0)}</td><td class="n">${fP(b.h5.avg, 2)}</td><td class="n">${fP(b.h5.ex, 2)}</td><td class="n">${fPp(b.h21.hit, 0)}</td><td class="n">${fP(b.h21.avg, 2)}</td><td class="n">${fP(b.h21.ex, 2)}</td><td class="n ${Math.abs(b.h21.t || 0) > 2 ? (b.h21.t > 0 ? 'up' : 'dn') : 'mu'}">${fN(b.h21.t, 2)}</td></tr>`).join('')}</tbody></table></div>`;
  const order = ['BUY ZONE', 'HOLD', 'WAIT', 'EXIT'];
  el.innerHTML = `<div class="card"><div class="row"><b style="font-size:15px">Signal track record</b><span class="sub">Does the DQ signal actually work? Every call is scored on what happened 1, 5 and 21 trading days later.</span>${dataMode().sim ? '<span class="badge b-sim">SIM DATA — run on real data before trusting</span>' : ''}</div></div>
 <div class="card"><h3>Historical replay (point-in-time) <span class="r"><button class="btn" data-act="trReplay" ${S.tr.busy ? 'disabled' : ''}>${S.tr.busy ? 'Replaying…' : R ? 'Re-run replay' : 'Run replay (~60 dates × all stocks)'}</button></span></h3><div id="trProg" class="sub"></div>
  ${R ? `<div class="kv">${kv('Signals scored', R.rows.length)}${kv('Dates', R.dates.length)}${kv('Fundamentals', 'point-in-time (results date)')}${kv('Universe', R.survivors ? '<span class="wa">today\'s members (survivorship bias)</span>' : 'historical membership')}</div>
  ${tbl(bucketStats(R.rows, 'v').sort((a, b) => order.indexOf(a.k) - order.indexOf(b.k)), 'Signal')}
  <div class="g2e" style="margin-top:8px"><div><div class="h3">Average 21-day excess return by score decile</div><canvas id="trDec" style="height:190px"></canvas><div class="note">A working score shows a rising staircase from decile 1 (lowest scores) to 10. Note: replay dates are 5 days apart, so 21-day windows overlap and t-stats overstate significance (divide by ≈2).</div></div><div><div class="h3">Equity: long every BUY ZONE call (5-day hold) vs equal-weight universe</div><canvas id="trEq" style="height:190px"></canvas></div></div>
  <div class="h3" style="margin-top:8px">Opportunity flag</div>${tbl(bucketStats(R.rows, r => r.opp ? 'Flagged opportunity' : 'Not flagged'), 'Group')}` : '<div class="mu">Re-scores every stock every 5 trading days over the last ~300 days using only the prices and results that were public on each date, then measures forward returns and excess over the equal-weight universe.</div>'}</div>
 <div class="g2e"><div class="card"><h3>Live ledger <span class="r mu" style="text-transform:none;letter-spacing:0">${L.length} calls logged since ${esc(L[0] ? L[0].t : '—')}</span></h3>${L.filter(e => e.r5 != null).length ? tbl(bucketStats(L.filter(e => e.r5 != null), 'v').sort((a, b) => order.indexOf(a.k) - order.indexOf(b.k)), 'Signal') : '<div class="mu">Every trading day the terminal logs each stock\'s signal and price. Results appear here once 5 and 21 trading days have passed — this is the honest, out-of-sample record.</div>'}
  <div class="row" style="margin-top:6px"><button class="btn s xs" data-act="trCsv">Copy ledger CSV</button><button class="btn s xs" data-act="trClear">Clear ledger</button></div></div>
 <div class="card"><h3>Forward paper test</h3>${S.tr.fwdStart ? `<div class="kv">${kv('Started', esc(S.tr.fwdStart))}${kv('Trading days', FB.days)}${kv('BUY ZONE book', fPt(FB.E.at(-1) - 1), FB.E.at(-1) - 1)}${kv('Equal-weight universe', fPt(FB.W.at(-1) - 1), FB.W.at(-1) - 1)}</div><canvas id="trFwd" style="height:170px;margin-top:6px"></canvas><div class="note">Holds every BUY ZONE stock equally, rebalanced daily from the ledger. Run it for ~3 months on real data before putting money behind the signals.</div><button class="btn s xs" data-act="trFwdStop">Stop</button>` : `<div class="mu">Starts a virtual book today that follows the signals day by day — no look-ahead, no optimisation.</div><button class="btn" data-act="trFwd" style="margin-top:6px">Start forward test today</button>`}</div></div>
 <div class="card"><h3>Survivorship-free index membership</h3><div class="sub">Import historical constituents (CSV: <span class="mono">index,symbol,from,to</span>) — NSE publishes index change notices on niftyindices.com. Replays and the factor-rotation backtest then use the members as they were on each date, instead of today's survivors.</div><div class="row" style="margin-top:6px"><input type="file" id="memFile" accept=".csv,.txt"><span class="sub">${memIdx.length ? 'Loaded: ' + memIdx.map(k => `${esc(k)} (${S.memHist[k].length})`).join(', ') : 'None loaded.'}</span></div></div>`;
  if (R) { const rs = R.rows.filter(r => r.sc != null && r.x21 != null).sort((a, b) => a.sc - b.sc); const dq = Array.from({ length: 10 }, (_, i) => mean(rs.slice(Math.floor(i * rs.length / 10), Math.floor((i + 1) * rs.length / 10)).map(r => r.x21)) * 100); barChart($('#trDec'), dq.map((_, i) => 'D' + (i + 1)), [{ data: dq, color: v => v >= 0 ? '#22c55e' : '#ef4444' }], { yfmt: v => v.toFixed(2) + '%' });
    const se = signalEquity(R.rows, R.dates, r => r.v === 'BUY ZONE'); lineChart($('#trEq'), [{ data: se.E, color: '#22c55e', label: 'BUY ZONE calls' }, { data: se.W, color: '#64748b', dash: [4, 3], label: 'Universe' }], { labels: ['start'].concat(R.dates) }) }
  if (FB && $('#trFwd')) lineChart($('#trFwd'), [{ data: FB.E, color: '#22c55e', label: 'BUY ZONE book' }, { data: FB.W, color: '#64748b', dash: [4, 3], label: 'Universe' }], { labels: FB.T });
}
addTab('track', '✔', 'Signal Track Record', 'rankings', renderTrack);
Object.assign(EXTRA_ACTS, {
  trReplay() { runReplay() },
  trFwd() { S.tr.fwdStart = S.dates[S.dates.length - 1]; saveTr(); renderTrack() },
  trFwdStop() { S.tr.fwdStart = null; saveTr(); renderTrack() },
  trClear() { askConfirm('<div class="h3">Clear the signal ledger?</div>', () => { S.tr.ledger = []; S.tr._loggedFor = null; saveTr(); renderTrack() }) },
  trCsv() { copyText('date,symbol,signal,score,opportunity,price,source,ret1d,ret5d,ret21d\n' + scoreLedger().map(e => [e.t, e.sym, e.v, e.sc, e.opp, e.p, e.src, e.r1 ?? '', e.r5 ?? '', e.r21 ?? ''].join(',')).join('\n')) },
});
EXTRA_CHANGE.push(t => { if (t.id === 'memFile') { const f = t.files[0]; if (!f) return true; const r = new FileReader(); r.onload = () => { toast(esc(importMembership(r.result))); renderTrack() }; r.readAsText(f); return true } return false });
