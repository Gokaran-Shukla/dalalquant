'use strict';
/* ============================== RANKINGS ============================== */
const RK_COLS=[['rank','#',null],['sym','Symbol',s=>s.sym],['sector','Sector',s=>s.sector],['price','LTP',(s,m)=>m.price],['chgp','1D',(s,m)=>m.chgp],['r1m','1M',(s,m)=>m.r1m],['r1y','1Y',(s,m)=>m.r1y],['score','Score',(s,m)=>m.score],['verdict','Signal',(s,m)=>({'BUY ZONE':4,HOLD:3,WAIT:2,EXIT:1})[m.verdict]],['mcap','M.Cap',(s,m)=>m.mcap],['pe','P/E',(s,m)=>m.pe],['roe','ROE',(s,m)=>m.roe],['rev3y','Sales 3Y',(s,m)=>m.rev3y],['np3y','Profit 3Y',(s,m)=>m.np3y],['ups','Upside to IV',(s,m)=>m.ups],['offH','From 52wH',(s,m)=>m.offH],['vol','Vol',(s,m)=>m.vol],['rsi','RSI',(s,m)=>m.rsi]];
function rankList(){const R=S.rk,f=R.f;let list=S.uni.filter(s=>S.M[s.sym]);
 if(R.mkt!=='ALL')list=list.filter(s=>s.mkt===R.mkt);if(R.cap&&R.cap!=='ALL')list=list.filter(s=>capClass(s.sym)===R.cap);if(R.index!=='ALL')list=list.filter(s=>s.idx.includes(R.index));if(R.sector!=='ALL')list=list.filter(s=>s.sector===R.sector);if(R.watch)list=list.filter(s=>S.watch.includes(s.sym));
 const num=k=>f[k]!==undefined&&f[k]!==''&&!isNaN(+f[k]);
 list=list.filter(s=>{const m=S.M[s.sym];if(num('minScore')&&!(m.score>=+f.minScore))return false;if(num('maxPE')&&!(m.pe>0&&m.pe<=+f.maxPE))return false;if(num('minROE')&&!(m.roe*100>=+f.minROE))return false;if(num('minG')&&!(m.rev3y*100>=+f.minG))return false;if(num('maxDE')&&!m.fin&&!(m.de<=+f.maxDE))return false;if(f.ab200&&!(m.sma200&&m.price>m.sma200))return false;if(f.verdict&&f.verdict!=='ALL'&&m.verdict!==f.verdict)return false;if(f.opp&&!m.opp)return false;return true});
 const col=RK_COLS.find(c=>c[0]===R.sort)||RK_COLS[7];const get=col[2]||((s,m)=>m.score);
 list.sort((a,b)=>{const x=get(a,S.M[a.sym]),y=get(b,S.M[b.sym]);if(x==null&&y==null)return 0;if(x==null)return 1;if(y==null)return -1;return (x>y?1:x<y?-1:0)*R.dir});return list}
function renderRankings(){
 const el=$('#tab-rankings');const R=S.rk,f=R.f,W=S.cfg.w;const secs=[...new Set(S.uni.map(s=>s.sector))].sort();
 const list=rankList();
 el.innerHTML=`<div class="card"><h3>Rankings — best first <span class="r mu" style="text-transform:none;letter-spacing:0">${list.length} stocks · click a column to sort · click a row to open</span></h3>
 <div class="row" style="margin-bottom:8px">
  <label class="f">Market<select id="rkMkt">${[['ALL','India + US'],['IN','India (NSE/BSE)'],['US','United States']].map(([k,l])=>`<option value="${k}" ${R.mkt===k?'selected':''}>${l}</option>`).join('')}</select></label>
  <label class="f">Cap pool<select id="rkCap">${[['ALL','All'],['Large','Large cap'],['Mid','Mid cap'],['Small','Small cap']].map(([k,l])=>`<option value="${k}" ${(R.cap||'ALL')===k?'selected':''}>${l}</option>`).join('')}</select></label>
  <label class="f">Index<select id="rkIdx"><option value="ALL">All indices (${S.uni.length})</option>${INDEX_DEFS.filter(d=>S.IDX[d.id]).map(d=>`<option ${R.index===d.id?'selected':''}>${esc(d.id)}</option>`).join('')}</select></label>
  <label class="f">Sector<select id="rkSec"><option value="ALL">All sectors</option>${secs.map(s=>`<option ${R.sector===s?'selected':''}>${esc(s)}</option>`).join('')}</select></label>
  <label class="f">Signal<select data-rkf="verdict">${['ALL','BUY ZONE','HOLD','WAIT','EXIT'].map(v=>`<option ${f.verdict===v?'selected':''}>${v}</option>`).join('')}</select></label>
  <label class="f">Min score<input type="number" class="w60" data-rkf="minScore" value="${esc(f.minScore??'')}"></label>
  <label class="f">Max P/E<input type="number" class="w60" data-rkf="maxPE" value="${esc(f.maxPE??'')}"></label>
  <label class="f">Min ROE %<input type="number" class="w60" data-rkf="minROE" value="${esc(f.minROE??'')}"></label>
  <label class="f">Min sales 3Y %<input type="number" class="w60" data-rkf="minG" value="${esc(f.minG??'')}"></label>
  <label class="f">Max D/E<input type="number" class="w60" step="0.1" data-rkf="maxDE" value="${esc(f.maxDE??'')}"></label>
  <label class="c"><input type="checkbox" data-rkf="ab200" ${f.ab200?'checked':''}> Above 200-DMA</label>
  <label class="c"><input type="checkbox" data-rkf="opp" ${f.opp?'checked':''}> Opportunities only</label>
  <label class="c"><input type="checkbox" id="rkWatch" ${R.watch?'checked':''}> Watchlist only</label>
  <button class="btn s xs" data-act="rkReset">Reset</button><button class="btn s xs" data-act="rkCsv">Export CSV</button><button class="btn s xs" data-act="rkCopy">Copy CSV</button>
 </div>
 <details><summary class="mu" style="cursor:pointer">Score weights (DQ Score = weighted Trend · Momentum · Valuation · Quality · Growth · Risk)</summary><div class="row" style="margin-top:8px">${Object.keys(W).map(k=>`<label class="f">${k}<input type="number" class="w60" min="0" max="100" data-w="${k}" value="${W[k]}"></label>`).join('')}<button class="btn xs s" data-act="wReset">Defaults</button></div></details>
 <div class="tw" style="max-height:70vh;margin-top:8px"><table class="t"><thead><tr><th></th>${RK_COLS.map(c=>`<th ${c[2]?`data-sort="${c[0]}"`:''} class="${['price','chgp','r1m','r1y','mcap','pe','roe','rev3y','np3y','ups','offH','vol','rsi'].includes(c[0])?'n':''}">${c[1]}${R.sort===c[0]?(R.dir<0?' ▼':' ▲'):''}</th>`).join('')}</tr></thead><tbody>
 ${list.map((s,i)=>{const m=S.M[s.sym];return `<tr class="cl" data-open="${esc(s.sym)}"><td>${star(s.sym)}</td><td class="mu">${i+1}</td><td><b>${esc(s.sym)}</b> ${m.opp?'<span class="badge b-live" title="Opportunity">OPP</span>':''} ${srcBadge(s.sym)}<div class="sub">${esc(s.name)}</div></td><td class="mu">${esc(s.sector)}</td><td class="n">${fN(m.price)}</td><td class="n">${fP(m.chgp)}</td><td class="n">${fP(m.r1m)}</td><td class="n">${fP(m.r1y)}</td><td>${sbar(m.score)}</td><td>${vpill(m.verdict)}</td><td class="n">${fMoney(m.mcap,s.sym)}</td><td class="n">${fN(m.pe,1)}</td><td class="n">${fPp(m.roe)}</td><td class="n">${fP(m.rev3y)}</td><td class="n">${fP(m.np3y)}</td><td class="n">${fP(m.ups)}</td><td class="n">${fP(m.offH)}</td><td class="n">${fPp(m.vol,0)}</td><td class="n">${fN(m.rsi,0)}</td></tr>`}).join('')}
 </tbody></table></div></div>`;
}
function rankCsv(){const list=rankList();const hdr='Rank,Symbol,Name,Sector,LTP,Chg1D%,Ret1M%,Ret1Y%,Score,Signal,MCapCr,PE,ROE%,Sales3Y%,Profit3Y%,UpsideIV%,From52wH%,Vol%,RSI,Source';
 const p=x=>x==null||!isFinite(x)?'':(x*100).toFixed(2),v=(x,d=2)=>x==null||!isFinite(x)?'':x.toFixed(d);
 return hdr+'\n'+list.map((s,i)=>{const m=S.M[s.sym];return [i+1,s.sym,'"'+s.name+'"',s.sector,v(m.price),p(m.chgp),p(m.r1m),p(m.r1y),v(m.score,1),m.verdict,v(m.mcap,0),v(m.pe,1),p(m.roe),p(m.rev3y),p(m.np3y),p(m.ups),p(m.offH),p(m.vol),v(m.rsi,1),S.D[s.sym].src.px].join(',')}).join('\n')}
