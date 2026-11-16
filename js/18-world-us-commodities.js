'use strict';
/* ============================== WORLD · US · COMMODITIES ============================== */
// [group, name, yahoo-style id used by bridge, sim base, sim vol, unit]
const GLOBAL=[
 ['United States','S&P 500','^GSPC',6000,0.16],['United States','Nasdaq Composite','^IXIC',19500,0.22],['United States','Dow Jones','^DJI',44000,0.15],['United States','Russell 2000','^RUT',2300,0.22],['United States','CBOE VIX','^VIX',16,0.9],
 ['Europe','FTSE 100','^FTSE',8300,0.13],['Europe','DAX','^GDAXI',20000,0.17],['Europe','CAC 40','^FCHI',7600,0.16],['Europe','Euro Stoxx 50','^STOXX50E',5000,0.16],
 ['Asia-Pacific','GIFT Nifty','GIFTNIFTY',24550,0.14],['Asia-Pacific','Nikkei 225','^N225',38000,0.2],['Asia-Pacific','Hang Seng','^HSI',20000,0.24],['Asia-Pacific','Shanghai Composite','000001.SS',3300,0.18],['Asia-Pacific','KOSPI','^KS11',2600,0.18],['Asia-Pacific','Taiwan Weighted','^TWII',22000,0.2],['Asia-Pacific','ASX 200','^AXJO',8200,0.13],
 ['Middle East','Tadawul TASI','^TASI.SR',12000,0.14],['Middle East','Dubai DFM','DFMGI.AE',5000,0.15],
 ['Commodities','Gold $/oz','GC=F',2600,0.15],['Commodities','Silver $/oz','SI=F',31,0.28],['Commodities','Crude WTI $/bbl','CL=F',70,0.32],['Commodities','Brent $/bbl','BZ=F',74,0.3],['Commodities','Natural gas $/MMBtu','NG=F',3,0.55],['Commodities','Copper $/lb','HG=F',4.3,0.22],['Commodities','Aluminium $/t','ALI=F',2500,0.2],['Commodities','Corn ¢/bu','ZC=F',430,0.22],
 ['Currencies','USD/INR','INR=X',84,0.04],['Currencies','EUR/INR','EURINR=X',90,0.07],['Currencies','GBP/INR','GBPINR=X',107,0.08],['Currencies','JPY/INR ×100','JPYINR=X',55,0.1],['Currencies','Dollar index DXY','DX-Y.NYB',104,0.07],
 ['Bonds','US 10Y yield %','^TNX',4.3,0.25],['Bonds','India 10Y G-sec %','IN10Y',6.6,0.08],
 ['Crypto','Bitcoin $','BTC-USD',80000,0.55],['Crypto','Ethereum $','ETH-USD',3000,0.7],
];
S.G={};S.news=[];S.newsAt=null;S.newsF={tag:'ALL',imp:'ALL',q:''};
function genGlobal(){S.G={};GLOBAL.forEach(([grp,name,id,base,vol])=>{const R=rng(hash('G'+id));const n=260;let p=base;const c=[];let mu=(R()-0.4)*0.25;for(let i=0;i<n;i++){if(i%60===0)mu=(R()-0.4)*0.3;p*=Math.exp((mu-0.5*vol*vol)/252+vol/Math.sqrt(252)*gauss(R));c.push(p)}const k=base*(0.95+R()*0.1)/c[n-1];S.G[id]={grp,name,id,c:c.map(x=>x*k),src:'sim'}})}
function gStat(id){const g=S.G[id];if(!g)return null;const c=g.c,n=c.length,L=c[n-1];const lk=k=>n>k?L/c[n-1-k]-1:null;const yStart=Math.max(0,n-1-Math.round((new Date()-new Date(new Date().getFullYear(),0,1))/86400000*252/365));return {ltp:g.ltp!=null?g.ltp:L,chgp:g.chgp!=null?g.chgp:L/c[n-2]-1,w:lk(5),m:lk(21),y:lk(252),ytd:L/c[yStart]-1,src:g.src}}
function fLv(v){if(v==null)return '—';const a=Math.abs(v);return fN(v,a>=1000?0:a>=10?2:3)}
function globalCues(){const C=[],ch=id=>{const s=gStat(id);return s?s.chgp:0};const add=(dir,txt,sec)=>C.push({dir,txt,sec});
 const sp=ch('^GSPC'),nq=ch('^IXIC'),br=ch('BZ=F'),inr=ch('INR=X'),dxy=ch('DX-Y.NYB'),us10=ch('^TNX'),gold=ch('GC=F'),vix=ch('^VIX'),gift=ch('GIFTNIFTY'),cu=ch('HG=F'),hsi=ch('^HSI');
 if(Math.abs(gift)>0.002)add(gift>0?1:-1,`GIFT Nifty ${fPt(gift,2)} → indicates a ${gift>0?'higher':'lower'} opening for NIFTY`,[]);
 if(Math.abs(sp)>0.004)add(sp>0?1:-1,`S&P 500 ${fPt(sp,2)} overnight — ${sp>0?'risk-on':'risk-off'} global sentiment`,[]);
 if(Math.abs(nq)>0.006)add(nq>0?1:-1,`Nasdaq ${fPt(nq,2)} — Indian IT tends to track US tech`,['IT']);
 if(Math.abs(br)>0.01)add(br>0?-1:1,`Brent ${fPt(br,2)} — India imports most of its crude: ${br>0?'negative for OMCs, paints, aviation, tyres; positive for ONGC/Oil India':'positive for OMCs, paints, aviation; eases inflation & rupee'}`,['Energy','Consumer','Services']);
 if(Math.abs(inr)>0.002)add(inr>0?-1:1,`Rupee ${inr>0?'weaker':'stronger'} (USD/INR ${fPt(inr,2)}) — ${inr>0?'helps IT & pharma exporters, hurts importers and FII returns':'helps importers, eases imported inflation'}`,['IT','Pharma']);
 if(Math.abs(dxy)>0.003)add(dxy>0?-1:1,`Dollar index ${fPt(dxy,2)} — a ${dxy>0?'stronger dollar usually pulls FII money out of':'weaker dollar usually supports flows into'} emerging markets`,[]);
 if(Math.abs(us10)>0.015)add(us10>0?-1:1,`US 10Y yield ${us10>0?'up':'down'} ${fPt(us10,1)} — ${us10>0?'tighter global liquidity; pressure on banks, realty, high-PE growth':'supports valuations of rate-sensitives'}`,['Banks','Realty']);
 if(Math.abs(vix)>0.05)add(vix>0?-1:1,`US VIX ${fPt(vix,1)} — ${vix>0?'fear rising':'fear easing'}`,[]);
 if(Math.abs(gold)>0.008)add(gold>0?-1:1,`Gold ${fPt(gold,2)} — ${gold>0?'safe-haven buying (risk-off signal); positive for gold financiers':'risk appetite returning'}`,['Financials']);
 if(Math.abs(cu)>0.01||Math.abs(hsi)>0.01)add((cu+hsi)>0?1:-1,`Copper ${fPt(cu,1)}, Hang Seng ${fPt(hsi,1)} — China demand cue for metals`,['Metals']);
 const sc=C.reduce((a,x)=>a+x.dir,0);return {cues:C,score:sc}}
function renderWorld(){
 const el=$('#tab-world');const groups=[...new Set(GLOBAL.map(g=>g[0]))];const G=globalCues();
 const usM=S.uni.filter(s=>s.mkt==='US').map(s=>S.M[s.sym]).filter(Boolean);const usTop=[...usM].sort((a,b)=>(b.score||0)-(a.score||0)).slice(0,12);
 const usSec={};usM.forEach(m=>{const k=S.bySym[m.sym].sector.replace('US ','');(usSec[k]=usSec[k]||[]).push(m.chgp)});
 const anySim=Object.values(S.G).some(g=>g.src==='sim');
 el.innerHTML=`<div class="card"><h3>Global cues for Indian markets ${anySim?'<span class="badge b-sim">SIM</span>':'<span class="badge b-live">LIVE</span>'}<span class="r mu" style="text-transform:none;letter-spacing:0">Rule-based read of today's moves</span></h3>
 <div class="row" style="margin-bottom:6px"><span class="pill ${G.score>1?'v-buy':G.score<-1?'v-exit':'v-hold'}">${G.score>1?'GLOBAL CUES POSITIVE':G.score<-1?'GLOBAL CUES NEGATIVE':'GLOBAL CUES MIXED'}</span><span class="sub">net ${G.score>0?'+':''}${G.score} from ${G.cues.length} signal(s)</span></div>
 ${G.cues.map(c=>`<div class="cue"><span class="d ${c.dir>0?'up':'dn'}">${c.dir>0?'▲':'▼'}</span><span>${esc(c.txt)}${c.sec.length?` <span class="mu">· sectors: ${c.sec.map(x=>`<span class="tag" data-sector="${esc(x)}" style="cursor:pointer">${esc(x)}</span>`).join('')}</span>`:''}</span></div>`).join('')||'<div class="mu">No large overnight moves — global cues neutral.</div>'}</div>
 ${groups.map(gr=>`<div class="card"><h3>${esc(gr)}</h3><div class="wgrid">${GLOBAL.filter(g=>g[0]===gr).map(g=>{const st=gStat(g[2]);return `<div class="ic"><div class="nm">${esc(g[1])} ${st.src==='live'?'<span class="badge b-live">LIVE</span>':''}</div><div class="lv n">${fLv(st.ltp)}</div><div class="n" style="font-size:12px">${fP(st.chgp,2)} <span class="mu">1D</span> · ${fP(st.m)} <span class="mu">1M</span> · ${fP(st.ytd)} <span class="mu">YTD</span></div><canvas data-gs="${esc(g[2])}"></canvas></div>`}).join('')}</div></div>`).join('')}
 <div class="g2"><div class="card"><h3>US stocks — top ranked <span class="r"><button class="btn xs s" data-act="usRank">All US rankings →</button></span></h3><div class="tw"><table class="t"><thead><tr><th>#</th><th>Symbol</th><th>Sector</th><th class="n">Price $</th><th class="n">1D</th><th class="n">1Y</th><th>Score</th><th>Signal</th></tr></thead><tbody>${usTop.map((m,i)=>`<tr class="cl" data-open="${esc(m.sym)}"><td class="mu">${i+1}</td><td><b>${esc(m.sym)}</b> ${srcBadge(m.sym)}<div class="sub">${esc(S.bySym[m.sym].name)}</div></td><td class="mu">${esc(S.bySym[m.sym].sector.replace('US ',''))}</td><td class="n">${fN(m.price)}</td><td class="n">${fP(m.chgp)}</td><td class="n">${fP(m.r1y)}</td><td>${sbar(m.score)}</td><td>${vpill(m.verdict)}</td></tr>`).join('')}</tbody></table></div></div>
 <div class="card"><h3>US sector heatmap (1D)</h3><div class="hm">${Object.entries(usSec).map(([k,v])=>{const x=mean(v);const a=Math.min(1,Math.abs(x)/0.02);return `<div style="background:${x>=0?`rgba(34,197,94,${0.15+a*0.5})`:`rgba(239,68,68,${0.15+a*0.5})`}" data-sector="US ${esc(k)}">${esc(k)}<b class="n">${fPt(x,2)}</b></div>`}).join('')}</div>
 <h3 style="margin-top:12px">US index proxies</h3><div class="kv">${['S&P 500 (leaders)','NASDAQ 100 (leaders)'].map(id=>{const st=idxStat(id);return st?kv(id,fN(st.lv)+' '+fPt(st.chgp,2),st.chgp):''}).join('')}</div><div class="note">Built from the US leaders in the universe; live index levels are in the United States card above.</div></div></div>`;
 $$('canvas[data-gs]',el).forEach(cv=>{const g=S.G[cv.dataset.gs];const st=gStat(g.id);sparkline(cv,g.c.slice(-90),st.chgp>=0?'#22c55e':'#ef4444')});
}
