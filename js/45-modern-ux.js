'use strict';
/* ============================== Modern UX: command palette, shortcuts, recents, chart export ============================== */
const UX = { recent: [], cmdSel: 0, cmdItems: [], gPending: 0 };
UX.recent = LS.get('dq_recent', []);

/* ---- recently viewed stocks ---- */
function pushRecent(sym) { if (!sym) return; UX.recent = [sym, ...UX.recent.filter(s => s !== sym)].slice(0, 8); LS.set("dq_recent", UX.recent) }
const _openSym = openSym;
openSym = function (sym) { _openSym(sym); if (S.bySym[sym]) pushRecent(sym) };

/* ---- fuzzy match: subsequence with bonuses for prefix and word starts ---- */
function fuzzy(q, text) {
  q = q.toLowerCase(); const t = text.toLowerCase(); if (!q) return 1;
  if (t.startsWith(q)) return 1000 - t.length;
  const i = t.indexOf(q); if (i >= 0) return 600 - i - t.length * 0.1;
  let ti = 0, score = 0, run = 0;
  for (const ch of q) { const j = t.indexOf(ch, ti); if (j < 0) return -1; run = j === ti ? run + 1 : 0; score += 10 + run * 5 + (j === 0 || /[\s·\-&/]/.test(t[j - 1]) ? 15 : 0); ti = j + 1 }
  return Math.min(300, score) - t.length * 0.2;
}

/* ---- command palette ---- */
const CMD_ACTIONS = [
  ['Connect broker / bridge', 'algo', 'Setup'], ['Create an alert', 'alerts', 'Setup'], ['Import CSV data', 'data', 'Setup'],
  ['Install app · sync devices', 'app', 'Setup'], ['Build an option strategy', 'options', 'F&O'], ['Run a backtest', 'backtest', 'Backtest'],
  ['Ask about a company', 'enquiry', 'Charts'], ['Morning brief', 'ai', 'Charts']];
function cmdBuild(q) {
  const items = [];
  if (!q) {
    UX.recent.filter(s => S.bySym[s]).forEach(s => items.push({ kind: 'Recent', label: s, sub: S.bySym[s].name, run: () => openSym(s), score: 0 }));
  }
  TABS.forEach(([id, , label]) => { const sc = Math.max(fuzzy(q, label) + 30, fuzzy(q, label + ' ' + (SUBS[id] || '').replace(/&amp;/g, '&'))); if (sc >= 0) items.push({ kind: 'Section', label, sub: (GROUPS.find(g => gTabs(g[0]).includes(id)) || [, ''])[1].replace('&amp;', '&'), run: () => go(id), score: sc + 50 }) });
  CMD_ACTIONS.forEach(([label, tab, grp]) => { const sc = fuzzy(q, label); if (sc >= 0) items.push({ kind: 'Action', label, sub: grp, run: () => go(tab), score: sc + 20 }) });
  if (q) S.uni.forEach(s => { const a = fuzzy(q, s.sym), b = fuzzy(q, s.name); const sc = Math.max(a >= 0 ? a + 100 : -1, b); if (sc >= 0) { const m = S.M[s.sym]; items.push({ kind: 'Stock', label: s.sym, sub: s.name + (m ? ' · ' + fN(m.price) : ''), chg: m ? m.chgp : null, run: () => openSym(s.sym), score: sc } ) } });
  if (q) items.sort((a, b) => b.score - a.score);
  return items.slice(0, 40);
}
function cmdRender() {
  const q = $('#cmdQ').value.trim(); UX.cmdItems = cmdBuild(q); UX.cmdSel = Math.min(UX.cmdSel, Math.max(0, UX.cmdItems.length - 1));
  let last = '';
  $('#cmdList').innerHTML = UX.cmdItems.map((it, i) => { const head = it.kind !== last ? `<li class="cmdh" role="presentation">${it.kind === 'Recent' ? 'Recently viewed' : it.kind + 's'}</li>` : ''; last = it.kind;
    const chg = it.chg != null ? `<span class="n cc">${fP(it.chg, 2)}</span>` : '';
    return `${head}<li role="option" id="cmdo${i}" aria-selected="${i === UX.cmdSel}" class="cmdi${i === UX.cmdSel ? ' sel' : ''}" data-cmdi="${i}"><span class="cl">${esc(it.label)}</span><span class="cs">${esc(it.sub || '')}</span>${chg}</li>` }).join('') || '<li class="cmdh">No matches</li>';
  $('#cmdQ').setAttribute('aria-activedescendant', UX.cmdItems.length ? 'cmdo' + UX.cmdSel : '');
  const sel = $('#cmdList .sel'); if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest' });
}
function cmdOpen() {
  let o = $('#cmdk');
  if (!o) {
    o = document.createElement('div'); o.id = 'cmdk'; o.setAttribute('role', 'dialog'); o.setAttribute('aria-modal', 'true'); o.setAttribute('aria-label', 'Command palette');
    o.innerHTML = `<div class="cmdbox"><div class="cmdin"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20 L16.5 16.5"/></svg><input id="cmdQ" role="combobox" aria-expanded="true" aria-controls="cmdList" aria-label="Search sections, stocks and actions" placeholder="Jump to a section, stock or action…" autocomplete="off"><kbd>Esc</kbd></div><ul id="cmdList" role="listbox"></ul><div class="cmdft"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>?</kbd> all shortcuts</span></div></div>`;
    document.body.appendChild(o);
    o.addEventListener('click', e => { if (e.target === o) cmdClose(); const li = e.target.closest('[data-cmdi]'); if (li) cmdRun(+li.dataset.cmdi) });
    $('#cmdQ').addEventListener('input', () => { UX.cmdSel = 0; cmdRender() });
    $('#cmdQ').addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); UX.cmdSel = Math.min(UX.cmdItems.length - 1, UX.cmdSel + 1); cmdRender() }
      else if (e.key === 'ArrowUp') { e.preventDefault(); UX.cmdSel = Math.max(0, UX.cmdSel - 1); cmdRender() }
      else if (e.key === 'Enter') { e.preventDefault(); cmdRun(UX.cmdSel) }
      else if (e.key === 'Escape') { e.preventDefault(); cmdClose() }
    });
  }
  UX.lastFocus = document.activeElement; o.style.display = 'flex'; $('#cmdQ').value = ''; UX.cmdSel = 0; cmdRender(); $('#cmdQ').focus();
}
function cmdClose() { const o = $('#cmdk'); if (o) o.style.display = 'none'; if (UX.lastFocus && UX.lastFocus.focus) UX.lastFocus.focus() }
function cmdRun(i) { const it = UX.cmdItems[i]; if (!it) return; cmdClose(); it.run() }

/* ---- keyboard shortcuts ---- */
const GO_KEYS = { m: ['markets', 'Markets'], c: ['analyze', 'Company chart'], o: ['options', 'Option chain'], q: ['quant', 'Quant'], p: ['portfolio', 'Portfolio'], s: ['screener', 'Screener'], b: ['backtest', 'Strategy Lab'], r: ['rankings', 'Rankings'], n: ['news', 'News'], a: ['alerts', 'Alerts'], l: ['live', 'Live Agent'] };
function showShortcuts() {
  const row = (k, d) => `<div class="kbr"><span>${k}</span><span>${d}</span></div>`;
  modal(`<div class="h3">Keyboard shortcuts</div><div class="kbgrid">
  <div>${row('<kbd>Ctrl</kbd>/<kbd>⌘</kbd> <kbd>K</kbd>', 'Command palette')}${row('<kbd>/</kbd>', 'Search a stock')}${row('<kbd>?</kbd>', 'This help')}${row('<kbd>Esc</kbd>', 'Close dialogs')}${row('<kbd>[</kbd> <kbd>]</kbd>', 'Previous / next section in this tab')}</div>
  <div>${Object.entries(GO_KEYS).map(([k, [, l]]) => row(`<kbd>g</kbd> <kbd>${k}</kbd>`, l)).join('')}</div></div>`);
}
function typing(t) { return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) }
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); const o = $('#cmdk'); if (o && o.style.display === 'flex') cmdClose(); else cmdOpen(); return }
  if (e.key === 'Escape') { if ($('#cmdk') && $('#cmdk').style.display === 'flex') { cmdClose(); return } if ($('#modal').style.display === 'flex') closeModal(); return }
  if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
  if (UX.gPending && Date.now() - UX.gPending < 1200) { UX.gPending = 0; const g = GO_KEYS[e.key.toLowerCase()]; if (g) { e.preventDefault(); go(g[0]) } return }
  if (e.key === 'g') { UX.gPending = Date.now(); return }
  if (e.key === '/') { e.preventDefault(); $('#search').focus(); return }
  if (e.key === '?') { e.preventDefault(); showShortcuts(); return }
  if (e.key === '[' || e.key === ']') { const tabs = gTabs(groupOf(S.tab)); const i = tabs.indexOf(S.tab); const j = i + (e.key === ']' ? 1 : -1); if (j >= 0 && j < tabs.length) { e.preventDefault(); go(tabs[j]) } }
});
document.addEventListener('click', e => { if (e.target.closest && e.target.closest('#cmdBtn')) { e.preventDefault(); cmdOpen() } });

/* ---- chart export: every chart-sized canvas gets a PNG download button ---- */
function exportCanvas(cv, name) {
  const t = document.createElement('canvas'); t.width = cv.width; t.height = cv.height; const g = t.getContext('2d'); if (!g) return;
  g.fillStyle = '#121826'; g.fillRect(0, 0, t.width, t.height); g.drawImage(cv, 0, 0);
  g.fillStyle = 'rgba(154,164,181,.8)'; g.font = `${Math.round(11 * (window.devicePixelRatio || 1))}px Inter,sans-serif`; g.textAlign = 'right'; g.fillText('DalalQuant', t.width - 8, t.height - 8);
  const a = document.createElement('a'); a.download = name + '.png'; a.href = t.toDataURL('image/png'); document.body.appendChild(a); a.click(); a.remove();
}
function addChartTools(tab) {
  const sec = document.getElementById('tab-' + tab); if (!sec) return;
  sec.querySelectorAll('canvas').forEach((cv, i) => {
    if (cv.dataset.spark || cv.dataset.vix || cv.dataset.dl) return;
    const h = cv.getBoundingClientRect().height || cv.clientHeight || parseInt(getComputedStyle(cv).height) || 0; if (h && h < 100) return;
    cv.dataset.dl = '1';
    const b = document.createElement('button'); b.type = 'button'; b.className = 'cvdl'; b.textContent = 'Download PNG'; b.setAttribute('aria-label', 'Download this chart as an image');
    const card = cv.closest('.card'); const title = card && card.querySelector('h3') ? card.querySelector('h3').firstChild.textContent.trim() : tab;
    b.addEventListener('click', ev => { ev.preventDefault(); ev.stopPropagation(); exportCanvas(cv, ('dalalquant-' + tab + '-' + (title || i)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '')) });
    cv.insertAdjacentElement('afterend', b);
  });
}
const _render = render;
render = function (tab = S.tab) { _render(tab); try { addChartTools(tab) } catch (e) { console.error(e) } };

/* ---- header: palette button + recent chips ---- */
(function () {
  const s = $('#search'); if (!s || $('#cmdBtn')) return;
  const b = document.createElement('button'); b.type = 'button'; b.id = 'cmdBtn'; b.className = 'iconbtn cmdbtn'; b.setAttribute('aria-label', 'Open command palette (Ctrl+K)'); b.title = 'Command palette (Ctrl/⌘ K)';
  b.innerHTML = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z"/></svg><span>K</span>';
  s.insertAdjacentElement('afterend', b);
})();
