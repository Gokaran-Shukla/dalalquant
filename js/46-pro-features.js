'use strict';
/* ============================== Pro features: theme, alert centre, dashboard, compare ============================== */

/* ---------- light / dark theme ---------- */
const THEMES = {
  dark: { GRID: '#1C2433', AX: '#6b7a89', LEG: '#cbd5e1', ZERO: '#475569', meta: '#0B0F17' },
  light: { GRID: '#E3E8F0', AX: '#5B6472', LEG: '#1F2937', ZERO: '#94A3B8', meta: '#F5F7FB' }
};
const SUN = '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON = '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';
function applyTheme(t, rerender) {
  t = THEMES[t] ? t : 'dark'; const T = THEMES[t];
  document.documentElement.dataset.theme = t; GRID = T.GRID; AX = T.AX; LEG = T.LEG; ZERO = T.ZERO;
  const mt = document.querySelector('meta[name="theme-color"]'); if (mt) mt.setAttribute('content', T.meta);
  const b = $('#themeBtn'); if (b) { b.innerHTML = t === 'dark' ? SUN : MOON; b.setAttribute('aria-label', t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme') }
  LS.set('dq_theme', t); if (rerender && S.tab) render(S.tab);
}
applyTheme(LS.get('dq_theme', 'dark'), false);

/* ---------- notification toasts + alert centre ---------- */
function dqNotice(title, body, sym) {
  let box = $('#notices'); if (!box) { box = document.createElement('div'); box.id = 'notices'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box) }
  const n = document.createElement('div'); n.className = 'notice';
  n.innerHTML = `<span class="nic" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg></span><div class="nb"><b>${esc(title)}</b><span>${esc(body)}</span></div>${sym ? `<button type="button" class="btn xs s" data-open="${esc(sym)}">Open</button>` : ''}<button type="button" class="nx" aria-label="Dismiss">×</button>`;
  n.querySelector('.nx').addEventListener('click', () => n.remove());
  box.prepend(n); while (box.children.length > 4) box.lastChild.remove();
  setTimeout(() => { n.classList.add('out'); setTimeout(() => n.remove(), 300) }, 7000);
}
function bellUnread() { const seen = LS.get('dq_bell_seen', 0); return (S.al.log || []).filter(x => x.t > seen).length }
function bellUpdate() {
  const b = $('#bell'); if (!b) return; let badge = b.querySelector('.bdg'); const n = bellUnread();
  if (!badge) { badge = document.createElement('span'); badge.className = 'bdg'; b.appendChild(badge) }
  badge.textContent = n > 9 ? '9+' : String(n); badge.style.display = n ? '' : 'none';
  b.setAttribute('aria-label', n ? `Alerts — ${n} unread` : 'Alerts and notifications');
}
function bellPanel(open) {
  let p = $('#bellPanel'); const b = $('#bell');
  if (open === undefined) open = !(p && p.style.display === 'block');
  if (!open) { if (p) p.style.display = 'none'; if (b) b.setAttribute('aria-expanded', 'false'); return }
  if (!p) { p = document.createElement('div'); p.id = 'bellPanel'; p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', 'Recent alerts'); document.body.appendChild(p) }
  const log = (S.al.log || []).slice(0, 12), seen = LS.get('dq_bell_seen', 0), rules = (S.al.rules || []).filter(r => r.on).length;
  p.innerHTML = `<div class="bph"><b>Alerts</b><span class="mu">${rules} active rule${rules === 1 ? '' : 's'}</span></div>
  <ul>${log.map(x => `<li class="${x.t > seen ? 'new' : ''}"><div>${esc(x.msg)}</div><span class="mu">${new Date(x.t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>${x.sym ? ` <button type="button" class="lnk" data-open="${esc(x.sym)}">Open ${esc(x.sym)}</button>` : ''}</li>`).join('') || '<li class="mu">No alerts yet. Set one from a company page (+ Alert) or the Alerts section.</li>'}</ul>
  <div class="bpf"><button type="button" class="btn s xs" data-tab="alerts">Manage alerts</button>${S.sel ? `<button type="button" class="btn xs" data-qalert="${esc(S.sel)}">+ Alert for ${esc(S.sel)}</button>` : ''}</div>`;
  p.style.display = 'block'; if (b) b.setAttribute('aria-expanded', 'true');
  LS.set('dq_bell_seen', Date.now()); bellUpdate();
}
function quickAlert(sym) {
  const m = S.M[sym]; if (!m) return;
  modal(`<div class="h3">New alert · ${esc(sym)}</div><p class="sub">Last price ${fN(m.price)} (${fPt(m.chgp, 2)} today). Alerts show here, in the bell, and — through the bridge — on Telegram, email or WhatsApp.</p>
  <div class="row" style="margin-top:10px"><label class="f">When<select id="qaT"><option value="price_above">Price crosses above</option><option value="price_below">Price falls below</option><option value="pct_up">Day gain ≥ %</option><option value="pct_down">Day loss ≥ %</option><option value="rsi_below">RSI falls below</option><option value="rsi_above">RSI rises above</option></select></label>
  <label class="f">Value<input type="number" id="qaV" class="w120" step="0.05" value="${(m.price * 1.05).toFixed(2)}"></label><button type="button" class="btn" id="qaSave">Create alert</button></div>`);
  const T = $('#qaT'), V = $('#qaV');
  T.addEventListener('change', () => { V.value = { price_above: (m.price * 1.05).toFixed(2), price_below: (m.price * 0.95).toFixed(2), pct_up: 3, pct_down: 3, rsi_below: 30, rsi_above: 70 }[T.value] });
  $('#qaSave').addEventListener('click', () => { const r = { id: 'q' + Date.now().toString(36), sym, type: T.value, value: +V.value, on: true }; S.al.rules.push(r); saveAl(); closeModal(); dqNotice('Alert created', alertLabel(r), null); if (typeof runAlerts === 'function') runAlerts() });
}
document.addEventListener('click', e => {
  const t = e.target; if (!t.closest) return;
  if (t.closest('#themeBtn')) { e.preventDefault(); applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true); return }
  if (t.closest('#bell')) { e.preventDefault(); bellPanel(); return }
  const qa = t.closest('[data-qalert]'); if (qa) { e.preventDefault(); bellPanel(false); quickAlert(qa.dataset.qalert); return }
  const p = $('#bellPanel'); if (p && p.style.display === 'block' && !t.closest('#bellPanel')) bellPanel(false);
  else if (p && t.closest('#bellPanel [data-tab], #bellPanel [data-open]')) bellPanel(false);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') bellPanel(false) });
setTimeout(bellUpdate, 0);

/* ---------- customisable dashboard ---------- */
const WIDGETS = {
  indices: { t: 'Indices', f() { const ids = INDEX_DEFS.filter(d => !d.us).map(d => d.id).filter(id => S.IDX[id]).slice(0, 6); return `<div class="wl">${ids.map(id => { const st = idxStat(id); return `<div class="wrow" data-idx="${esc(id)}"><span class="wn">${esc(id)}</span><canvas class="wsp" data-spark="${esc(id)}" data-col="${st.chgp >= 0 ? '#34D399' : '#F87171'}"></canvas><span class="n">${fN(st.lv)}</span><span class="n wc">${fP(st.chgp, 2)}</span></div>` }).join('')}</div>` } },
  watchlist: { t: 'Watchlist', f() { const w = (S.watch || []).map(s => S.M[s]).filter(Boolean).slice(0, 8); return w.length ? `<div class="wl">${w.map(m => `<div class="wrow cl" data-open="${esc(m.sym)}"><span class="wn"><b>${esc(m.sym)}</b></span><span class="n">${fN(m.price)}</span><span class="n wc">${fP(m.chgp, 2)}</span>${vpill(m.verdict)}</div>`).join('')}</div>` : '<p class="mu">Star ☆ any stock to add it here.</p>' } },
  movers: { t: 'Top movers', f() { const a = S.uni.filter(s => s.mkt === 'IN').map(s => S.M[s.sym]).filter(Boolean).sort((x, y) => y.chgp - x.chgp); const row = m => `<div class="wrow cl" data-open="${esc(m.sym)}"><span class="wn"><b>${esc(m.sym)}</b></span><span class="n">${fN(m.price)}</span><span class="n wc">${fP(m.chgp, 2)}</span></div>`; return `<div class="g2e"><div><div class="wsub">Gainers</div>${a.slice(0, 5).map(row).join('')}</div><div><div class="wsub">Losers</div>${a.slice(-5).reverse().map(row).join('')}</div></div>` } },
  heatmap: { t: 'Sector heatmap', f() { const secs = Object.entries(S.SEC).filter(([k]) => !k.startsWith('US ')).sort((a, b) => b[1].avgChg - a[1].avgChg).slice(0, 12); return `<div class="hm">${secs.map(([k, v]) => { const x = v.avgChg || 0, a = Math.min(1, Math.abs(x) / 0.02); return `<div style="background:${x >= 0 ? `rgba(52,211,153,${0.15 + a * 0.45})` : `rgba(248,113,113,${0.15 + a * 0.45})`}" data-sector="${esc(k)}">${esc(k)}<b class="n">${fPt(x, 2)}</b></div>` }).join('')}</div>` } },
  breadth: { t: 'Market breadth · NIFTY 100', f() { const n = S.uni.filter(s => s.idx.includes('NIFTY 100')).map(s => S.M[s.sym]).filter(Boolean); const a = n.filter(m => m.chgp > 0).length, d = n.filter(m => m.chgp < 0).length, u = n.length - a - d; return `<div class="wbar" role="img" aria-label="${a} advances, ${d} declines"><i style="flex:${a};background:var(--up)"></i><i style="flex:${Math.max(u, 0)};background:#64748b"></i><i style="flex:${d};background:var(--dn)"></i></div><div class="row" style="justify-content:space-between;margin-top:8px"><span class="up">Advances ${a}</span><span class="mu">A/D ${fN(a / Math.max(1, d))}</span><span class="dn">Declines ${d}</span></div>` } },
  portfolio: { t: 'Portfolio', f() { const H = S.holdings.filter(h => S.M[h.sym]); if (!H.length) return '<p class="mu">No holdings yet — add them in Portfolio or sync from your broker.</p>'; let inv = 0, cur = 0, day = 0; H.forEach(h => { const m = S.M[h.sym]; inv += h.qty * h.avg; cur += h.qty * m.price; day += h.qty * m.chg }); return `<div class="wkpi"><div><span>Current value</span><b>₹${fN(cur, 0)}</b></div><div><span>Total P&amp;L</span><b class="${cur >= inv ? 'up' : 'dn'}">${cur >= inv ? '+' : '−'}₹${fN(Math.abs(cur - inv), 0)}</b></div><div><span>Today</span><b class="${day >= 0 ? 'up' : 'dn'}">${day >= 0 ? '+' : '−'}₹${fN(Math.abs(day), 0)}</b></div><div><span>Return</span><b>${fPt(inv ? cur / inv - 1 : null)}</b></div></div>` } },
  opps: { t: 'Opportunities', f() { return oppCards(oppList(4)) } },
  news: { t: 'Headlines', f() { const n = (S.news || []).slice(0, 6); return n.length ? `<ul class="wnews">${n.map(x => `<li class="${x.imp || ''}"><a href="${esc(x.link)}" target="_blank" rel="noopener">${esc(x.title)}</a><span class="mu">${(x.tags || []).slice(0, 2).map(esc).join(' · ')}</span></li>`).join('')}</ul>` : '<p class="mu">Live headlines appear when the bridge is connected (Setup → Algo &amp; Brokers).</p>' } },
  alerts: { t: 'Recent alerts', f() { const l = (S.al.log || []).slice(0, 6); return l.length ? `<ul class="wnews">${l.map(x => `<li><span>${esc(x.msg)}</span></li>`).join('')}</ul>` : '<p class="mu">No alerts have fired yet.</p>' } }
};
const DASH_DEFAULT = ['indices', 'watchlist', 'movers', 'heatmap', 'portfolio', 'breadth', 'opps', 'news'];
S.dash = { order: LS.get('dq_dash', DASH_DEFAULT).filter(k => WIDGETS[k]), edit: false };
function dashSave() { LS.set('dq_dash', S.dash.order) }
function renderHome() {
  const el = $('#tab-home'); const D = S.dash; const hidden = Object.keys(WIDGETS).filter(k => !D.order.includes(k));
  const now = new Date(); const hr = (now.getUTCHours() * 60 + now.getUTCMinutes() + 330) / 60 % 24; const hello = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  el.innerHTML = `<div class="phead"><div><h1>${hello}</h1><p class="sub">Your dashboard. ${D.edit ? 'Drag widgets to reorder, or use the arrows. Changes are saved on this device.' : 'Tap Customise to add, remove or reorder widgets.'}</p></div>
  <div class="row"><button type="button" class="btn s" data-dash="reset" ${D.edit ? '' : 'hidden'}>Reset</button><button type="button" class="btn ${D.edit ? '' : 's'}" data-dash="edit" aria-pressed="${D.edit}">${D.edit ? 'Done' : 'Customise'}</button></div></div>
  ${D.edit && hidden.length ? `<div class="chips"><span class="mu" style="align-self:center">Add widget:</span>${hidden.map(k => `<button type="button" class="btn s xs" data-dash="add" data-w="${k}">+ ${esc(WIDGETS[k].t)}</button>`).join('')}</div>` : ''}
  <div class="dgrid${D.edit ? ' editing' : ''}" id="dgrid">${D.order.map((k, i) => `<section class="card dw" data-w="${k}" ${D.edit ? 'draggable="true"' : ''} aria-label="${esc(WIDGETS[k].t)}"><h3>${D.edit ? '<span class="dh" aria-hidden="true">⠿</span>' : ''}${esc(WIDGETS[k].t)}${D.edit ? `<span class="r row"><button type="button" class="btn s xs" data-dash="up" data-w="${k}" aria-label="Move ${esc(WIDGETS[k].t)} earlier" ${i === 0 ? 'disabled' : ''}>←</button><button type="button" class="btn s xs" data-dash="down" data-w="${k}" aria-label="Move ${esc(WIDGETS[k].t)} later" ${i === D.order.length - 1 ? 'disabled' : ''}>→</button><button type="button" class="btn s xs" data-dash="rm" data-w="${k}" aria-label="Remove ${esc(WIDGETS[k].t)}">×</button></span>` : ''}</h3><div class="dwb">${(() => { try { return WIDGETS[k].f() } catch (e) { return '<p class="mu">Not available yet.</p>' } })()}</div></section>`).join('')}</div>`;
  $$('canvas.wsp', el).forEach(cv => { const st = idxStat(cv.dataset.spark); if (st) sparkline(cv, st.spark, cv.dataset.col) });
  if (D.edit) dashDnD();
}
function dashDnD() {
  const g = $('#dgrid'); let drag = null;
  g.addEventListener('dragstart', e => { const c = e.target.closest('.dw'); if (!c) return; drag = c.dataset.w; c.classList.add('dragging'); try { e.dataTransfer.setData('text/plain', drag); e.dataTransfer.effectAllowed = 'move' } catch (x) { } });
  g.addEventListener('dragend', e => { const c = e.target.closest('.dw'); if (c) c.classList.remove('dragging'); $$('.dw', g).forEach(x => x.classList.remove('over')) });
  g.addEventListener('dragover', e => { e.preventDefault(); const c = e.target.closest('.dw'); $$('.dw', g).forEach(x => x.classList.toggle('over', x === c && x.dataset.w !== drag)) });
  g.addEventListener('drop', e => { e.preventDefault(); const c = e.target.closest('.dw'); if (!c || !drag || c.dataset.w === drag) return; const o = S.dash.order.filter(k => k !== drag); o.splice(o.indexOf(c.dataset.w), 0, drag); S.dash.order = o; dashSave(); renderHome() });
}
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-dash]'); if (!b) return; e.preventDefault();
  const D = S.dash, k = b.dataset.w, i = D.order.indexOf(k);
  switch (b.dataset.dash) {
    case 'edit': D.edit = !D.edit; break;
    case 'reset': D.order = DASH_DEFAULT.slice(); break;
    case 'add': D.order.push(k); break;
    case 'rm': D.order = D.order.filter(x => x !== k); break;
    case 'up': if (i > 0) [D.order[i - 1], D.order[i]] = [D.order[i], D.order[i - 1]]; break;
    case 'down': if (i < D.order.length - 1) [D.order[i + 1], D.order[i]] = [D.order[i], D.order[i + 1]]; break;
  }
  dashSave(); renderHome();
  const again = b.dataset.w && $(`[data-dash="${b.dataset.dash}"][data-w="${b.dataset.w}"]`); if (again && !again.disabled) again.focus();
});
addTab('home', '⌂', 'My Dashboard', 'markets', renderHome);
{ const i = TABS.findIndex(t => t[0] === 'home'); const [h] = TABS.splice(i, 1); TABS.unshift(h) }

/* ---------- compare 2–4 stocks ---------- */
const CMP_COL = ['#F5A524', '#4F8CFF', '#E879F9', '#22D3EE'];
S.cmp = { syms: LS.get('dq_cmp', null), per: 252 };
function cmpDefault() { return S.uni.filter(s => s.mkt === 'IN' && S.M[s.sym] && S.M[s.sym].mcap).sort((a, b) => S.M[b.sym].mcap - S.M[a.sym].mcap).slice(0, 3).map(s => s.sym) }
const num = v => v == null || !isFinite(v) ? null : v;
/* [label, display, value for ranking, +1 higher is better / -1 lower is better] grouped like a research note */
const CMP_GROUPS = [
  ['Performance', [['Today', m => fPt(m.chgp, 2), m => m.chgp, 1], ['3 months', m => fPt(m.r3m), m => m.r3m, 1], ['1 year', m => fPt(m.r1y), m => m.r1y, 1], ['Max drawdown', m => fPt(m.mdd), m => m.mdd, 1]]],
  ['Valuation', [['Market cap (₹ Cr)', m => m.mcap ? fN(m.mcap, 0) : '—', m => m.mcap, 1], ['P/E', m => m.pe > 0 ? fN(m.pe, 1) : '—', m => m.pe > 0 ? m.pe : null, -1], ['P/B', m => m.pb ? fN(m.pb, 1) : '—', m => m.pb > 0 ? m.pb : null, -1], ['Upside to fair value', m => fPt(m.ups), m => m.ups, 1]]],
  ['Quality', [['ROE', m => fPp(m.roe), m => m.roe, 1], ['ROCE', m => fPp(m.roce), m => m.roce, 1], ['Debt / equity', m => m.de != null ? fN(m.de, 2) : '—', m => m.de, -1]]],
  ['Growth', [['Revenue growth 1Y', m => fPp(m.rev1y), m => m.rev1y, 1], ['Profit growth 1Y', m => fPp(m.np1y), m => m.np1y, 1]]],
  ['Signals', [['RSI 14', m => m.rsi != null ? fN(m.rsi, 0) : '—', null, 0], ['DQ score', m => m.score != null ? fN(m.score, 0) + '<small>/100</small>' : '—', m => m.score, 1], ['Signal', m => vpill(m.verdict), null, 0]]]];
const STAR = '<svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7-6.2-3.7-6.2 3.7 1.6-7L2 9.2l7.1-.6z"/></svg>';
const CROWN = '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 7l4.5 4L12 4l4.5 7L21 7l-2 12H5z"/></svg>';
function renderCompare() {
  const el = $('#tab-compare'); const C = S.cmp; if (!C.syms || !C.syms.filter(s => S.M[s]).length) C.syms = cmpDefault();
  const syms = C.syms.filter(s => S.M[s]).slice(0, 4); const ms = syms.map(s => S.M[s]); const k = ms.length;
  const n = Math.min(C.per, ...syms.map(s => S.D[s].bars.length));
  const series = syms.map((s, i) => { const b = S.D[s].bars.slice(-n); const b0 = b[0].c; return { data: b.map(x => x.c / b0 * 100), color: CMP_COL[i], label: s, w: 2.2 } });
  const ret = series.map(s => s.data.at(-1) / 100 - 1);
  const wins = new Array(k).fill(0); let measured = 0;
  const body = CMP_GROUPS.map(([g, rows]) => `<tr class="cgh"><th colspan="${k + 1}" scope="rowgroup">${g}</th></tr>` + rows.map(([lab, f, val, dir]) => {
    let best = -1, sc = null;
    if (val && k > 1) { const vs = ms.map(m => num(val(m))); const ok = vs.filter(v => v != null); if (ok.length > 1) { const hi = Math.max(...ok), lo = Math.min(...ok), t = dir > 0 ? hi : lo; best = vs.indexOf(t); if (hi !== lo) { measured++; wins[best]++ } else best = -1; sc = vs.map(v => v == null ? null : hi === lo ? 1 : (dir > 0 ? (v - lo) : (hi - v)) / (hi - lo)) } }
    return `<tr><th scope="row">${lab}</th>${ms.map((m, i) => `<td class="${i === best ? 'best' : ''}" style="--c:${CMP_COL[i]}"><div class="cv">${i === best ? `<span class="bst" title="Best of ${k}">${STAR}</span>` : ''}<span class="n">${f(m)}</span></div>${sc && sc[i] != null ? `<div class="cbar" aria-hidden="true"><i style="width:${Math.max(6, sc[i] * 100).toFixed(0)}%"></i></div>` : ''}</td>`).join('')}</tr>` }).join('')).join('');
  const lead = wins.indexOf(Math.max(...wins));
  const head = ms.map((m, i) => `<th scope="col" class="chd" style="--c:${CMP_COL[i]}">${i === lead && k > 1 ? `<span class="lead">${CROWN} Leader</span>` : ''}<button type="button" class="symchip" data-open="${esc(syms[i])}" title="Open ${esc(S.bySym[syms[i]].name)}">${esc(syms[i])}</button><div class="cname">${esc(S.bySym[syms[i]].name)}</div><div class="cpx n">₹${fN(m.price)} <span class="${m.chgp >= 0 ? 'up' : 'dn'}">${fPt(m.chgp, 2)}</span></div><div class="csec">${esc(S.bySym[syms[i]].sector)} · ${vpill(m.verdict)}</div><div class="cwins"><b>${wins[i]}</b> / ${measured} best</div></th>`).join('');
  el.innerHTML = `<div class="phead"><div><h1>Compare stocks</h1><p class="sub">Up to four stocks side by side. A star marks the best value in each row; the bars show where each stock sits from worst to best.</p></div></div>
  <div class="card"><div class="row cmpin">${[0, 1, 2, 3].map(i => `<label class="f"><span><i class="cdot" style="background:${CMP_COL[i]}"></i>Stock ${i + 1}</span><input list="symlist" class="w120" data-cmp="${i}" value="${esc(C.syms[i] || '')}" placeholder="${i < 2 ? 'Symbol' : 'Optional'}"></label>`).join('')}
  <div class="seg" role="group" aria-label="Period">${[[63, '3M'], [126, '6M'], [252, '1Y'], [504, '2Y'], [99999, 'Max']].map(([v, l]) => `<button type="button" class="btn xs ${C.per === v ? 'on' : 's'}" data-cmpper="${v}" aria-pressed="${C.per === v}">${l}</button>`).join('')}</div></div></div>
  ${k > 1 ? `<div class="cverdict" style="--c:${CMP_COL[lead]}">${CROWN}<div><b>${esc(syms[lead])}</b> leads on <b>${wins[lead]} of ${measured}</b> measures${ret[lead] != null ? ` and returned <b class="${ret[lead] >= 0 ? 'up' : 'dn'}">${fPt(ret[lead])}</b> over the period` : ''}.<span class="mu"> Based on the data shown — not investment advice.</span></div></div>` : ''}
  <div class="stiles">${syms.map((s, i) => `<div class="stile cmpcard" style="--c:${CMP_COL[i]}"><div class="cmphd"><span class="symchip">${esc(s)}</span><span class="cname">${esc(S.bySym[s].name)}</span></div><div class="v ${ret[i] >= 0 ? 'up' : 'dn'}">${fPt(ret[i])}</div><div class="s">over the period</div></div>`).join('')}</div>
  <div class="card"><h3>Relative performance <span class="r mu">Indexed to 100 at the start</span></h3><canvas class="chart" id="cmpCh" style="height:360px"></canvas></div>
  <div class="card cmpwrap"><h3>Side by side</h3><div class="tw"><table class="t cmpt" style="--k:${k}"><thead><tr><th class="corner"></th>${head}</tr></thead><tbody>${body}</tbody></table></div></div>`;
  const lab = (S.dates || []).length >= n ? S.dates.slice(-n).map(d => String(d).slice(0, 10)) : null;
  lineChart($('#cmpCh'), series, { labels: lab, yfmt: v => fN(v, 0) });
}
document.addEventListener('change', e => { const t = e.target; if (t.dataset && t.dataset.cmp != null) { const v = t.value.trim().toUpperCase(); const a = S.cmp.syms.slice(); const i = +t.dataset.cmp; if (v && !S.bySym[v]) { toast('Unknown symbol ' + esc(v)); return } a[i] = v || undefined; S.cmp.syms = a.filter(Boolean); LS.set('dq_cmp', S.cmp.syms); renderCompare() } });
document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-cmpper]'); if (b) { e.preventDefault(); S.cmp.per = +b.dataset.cmpper; renderCompare() } });
addTab('compare', '⇋', 'Compare Stocks', 'analyze', renderCompare);

/* ---------- company page: quick alert + compare buttons ---------- */
const _renderPro = render;
render = function (tab = S.tab) {
  _renderPro(tab);
  if (tab === 'analyze' && S.sel) {
    const bar = $('#tab-analyze .hero .spacer + .row'); if (bar && !bar.querySelector('[data-qalert]')) {
      bar.insertAdjacentHTML('afterbegin', `<button type="button" class="btn s xs" data-qalert="${esc(S.sel)}">+ Alert</button><button type="button" class="btn s xs" data-cmpadd="${esc(S.sel)}">Compare</button>`);
    }
  }
};
document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-cmpadd]'); if (!b) return; e.preventDefault(); const s = b.dataset.cmpadd; const a = (S.cmp.syms || cmpDefault()).filter(x => x !== s); S.cmp.syms = [s, ...a].slice(0, 4); LS.set('dq_cmp', S.cmp.syms); go('compare') });
