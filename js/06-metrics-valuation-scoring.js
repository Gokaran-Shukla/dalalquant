'use strict';
/* ============================== Metrics, valuation, scoring ============================== */
function ttm(q,k,off=0){const L=q.length;if(L-off<4)return null;let s=0;for(let i=0;i<4;i++){const v=q[L-1-off-i][k];if(v==null)return null;s+=v}return s}
function baseMetrics(s,d){
 const b=d.bars,c=b.map(x=>x.c),n=c.length,p=c[n-1],pv=n>1?c[n-2]:p,fin=FIN.has(s.sector);
 const look=k=>n>k?p/c[n-1-k]-1:null;const yr=b.slice(-252);
 const h52=Math.max(...yr.map(x=>x.h)),l52=Math.min(...yr.map(x=>x.l));
 const rets=[];for(let i=Math.max(1,n-252);i<n;i++)rets.push(c[i]/c[i-1]-1);
 const vol=std(rets)*Math.sqrt(252);let pk=-Infinity,mdd=0;for(let i=Math.max(0,n-252);i<n;i++){pk=Math.max(pk,c[i]);mdd=Math.min(mdd,c[i]/pk-1)}
 const rf=S.cfg.rf/100;const sharpe=vol>0?(mean(rets)*252-rf)/vol:null;
 let beta=null;const nm=s.mkt==='US'?S._spMap:S._niftyMap;if(nm){const xs=[],ys=[];for(let i=Math.max(1,n-252);i<n;i++){const a=nm.get(b[i].t),a0=nm.get(b[i-1].t);if(a&&a0){xs.push(a/a0-1);ys.push(c[i]/c[i-1]-1)}}if(xs.length>30){const mx=mean(xs),my=mean(ys);let cv=0,vx=0;for(let i=0;i<xs.length;i++){cv+=(xs[i]-mx)*(ys[i]-my);vx+=(xs[i]-mx)**2}beta=vx>0?cv/vx:null}}
 const mc=macdA(c),st=stA(b);
 const m={sym:s.sym,price:p,chg:p-pv,chgp:p/pv-1,h52,l52,offH:p/h52-1,offL:p/l52-1,r1w:look(5),r1m:look(21),r3m:look(63),r6m:look(126),r1y:look(252),r3y:look(750),vol,mdd,sharpe,beta,
  sma20:last(sma(c,20)),sma50:last(sma(c,50)),sma200:n>=200?last(sma(c,200)):null,ema20:last(ema(c,20)),rsi:last(rsiA(c)),macdH:last(mc.hist),atr:last(atrA(b)),stDir:last(st.dir),stLine:last(st.line),
  avgVol:mean(b.slice(-20).map(x=>x.v)),volRatio:b[n-1].v/(mean(b.slice(-20).map(x=>x.v))||1),fin,src:d.src,hasF:false};
 const q=d.q;
 if(q&&q.length>=4){
  const L=q.length;m.hasF=true;
  m.revTTM=ttm(q,'rev');m.npTTM=ttm(q,'np');m.ebitdaTTM=ttm(q,'ebitda');m.fcfTTM=ttm(q,'fcf');
  m.epsTTM=d.shares?m.npTTM/d.shares:ttm(q,'eps');
  m.revQoQ=q[L-1].rev/q[L-2].rev-1;m.npQoQ=q[L-2].np>0?q[L-1].np/q[L-2].np-1:null;
  if(L>=5){m.revYoY=q[L-1].rev/q[L-5].rev-1;m.npYoY=q[L-5].np>0?q[L-1].np/q[L-5].np-1:null}
  if(L>=8){m.rev1y=m.revTTM/ttm(q,'rev',4)-1;const np4=ttm(q,'np',4);m.np1y=np4>0?m.npTTM/np4-1:null;m.ebitdaMprev=ttm(q,'ebitda',4)/ttm(q,'rev',4);m.npPrev=np4}
  if(L>=16){const r0=ttm(q,'rev',12),n0=ttm(q,'np',12);m.rev3y=r0>0?Math.pow(m.revTTM/r0,1/3)-1:null;m.np3y=(n0>0&&m.npTTM>0)?Math.pow(m.npTTM/n0,1/3)-1:null}
  m.ebitdaM=m.ebitdaTTM/m.revTTM;m.npM=m.npTTM/m.revTTM;
  if(d.shares){m.mcap=p*d.shares;m.pe=m.npTTM>0?m.mcap/m.npTTM:null;
   if(d.equity){m.pb=m.mcap/d.equity;m.roe=m.npTTM/d.equity;m.bvps=d.equity/d.shares;m.de=d.debt!=null?d.debt/d.equity:null;
    m.roce=fin?null:(m.ebitdaTTM*0.85)/(d.equity+(d.debt||0));m.roePrev=m.npPrev!=null?m.npPrev/d.equity:null}
   m.ev=m.mcap+(d.debt||0)-(d.cash||0);m.evEb=(!fin&&m.ebitdaTTM>0)?m.ev/m.ebitdaTTM:null}
  m.promoter=d.promoter;m.fii=d.fii;m.dii=d.dii;m.dy=d.dy;
  let f=0;if(m.npTTM>0)f++;if(fin||m.fcfTTM>0)f++;if(fin||(m.fcfTTM>m.npTTM))f++;if(m.roePrev!=null&&m.roe>m.roePrev)f++;if(m.ebitdaMprev!=null&&m.ebitdaM>m.ebitdaMprev)f++;if(m.rev1y>0)f++;if(m.np1y>0)f++;if(fin||(m.de!=null&&m.de<1))f++;m.fscore=f;
 }
 return m;
}
function dcfValue(f0,g1,g2,gt,r){let pv=0,f=f0;for(let t=1;t<=10;t++){f*=1+(t<=5?g1:g2);pv+=f/Math.pow(1+r,t)}pv+=f*(1+gt)/(r-gt)/Math.pow(1+r,10);return pv}
function valuation(s,m,sec,ov){
 const d=S.D[s.sym];m.iv={};if(!m.hasF||!d.shares)return;
 const r=(ov&&ov.disc!=null?ov.disc:S.cfg.disc)/100,gt=(ov&&ov.tg!=null?ov.tg:S.cfg.tg)/100;
 const gDef=clamp(m.rev3y!=null?m.rev3y:(m.rev1y!=null?m.rev1y:0.08),-0.05,0.25);
 const g1=ov&&ov.g1!=null?ov.g1/100:gDef,g2=ov&&ov.g2!=null?ov.g2/100:gDef/2;
 m.mshare=sec&&sec.rev>0&&m.revTTM>0?m.revTTM/sec.rev:null;
 if(!m.fin&&m.fcfTTM>0){const eq=dcfValue(m.fcfTTM,g1,g2,gt,r)-(d.debt||0)+(d.cash||0);m.iv.dcf=eq>0?eq/d.shares:null}
 if(m.epsTTM>0&&m.bvps>0)m.iv.gn=Math.sqrt(22.5*m.epsTTM*m.bvps);
 if(m.epsTTM>0){const gp=clamp((m.np3y!=null?m.np3y:gDef)*100,0,20);m.iv.gf=m.epsTTM*(8.5+2*gp)*4.4/S.cfg.aaa}
 if(m.epsTTM>0&&sec&&sec.medPE)m.iv.pef=sec.medPE*m.epsTTM;
 if(m.fin&&m.roe!=null&&m.bvps){const g=Math.min(clamp(gDef,0,0.2),r-0.02);m.iv.jpb=m.bvps*Math.max(0,(m.roe-g)/(r-g))}
 m.iv.avg=median(Object.values(m.iv).filter(x=>x>0));m.ups=m.iv.avg?m.iv.avg/m.price-1:null;m.g1=g1;m.g2=g2;
}
function scoreIt(s,m,sec){
 const W=S.cfg.w,R=[];const C={};
 if(m.sma200!=null){C.trend=(m.price>m.sma200?40:0)+(m.sma50>m.sma200?30:0)+(m.price>m.sma50?30:0)}else C.trend=(m.price>m.sma50?60:20);
 const rs=m.rsi;const rsS=rs>=50&&rs<=70?100:((rs>=40&&rs<50)||(rs>70&&rs<=80))?60:20;C.mom=0.6*rsS+0.4*(m.macdH>0?100:0);
 if(m.hasF){
  const parts=[];if(m.ups!=null)parts.push([clamp(50+m.ups*125),0.6]);if(m.pe&&sec&&sec.medPE)parts.push([clamp(sec.medPE/m.pe*50),0.4]);
  if(parts.length){const ws=parts.reduce((a,x)=>a+x[1],0);C.val=parts.reduce((a,x)=>a+x[0]*x[1],0)/ws}
  if(m.roe!=null){const roeS=clamp((m.roe-0.05)/0.20*100);C.qual=m.fin?roeS:0.55*roeS+0.30*clamp(100-(m.de||0)*60)+0.15*clamp(m.npM/0.15*100)}
  C.growth=0.5*clamp(((m.rev3y??m.rev1y??0))/0.20*100)+0.3*clamp(((m.np3y??m.np1y??0))/0.25*100)+0.2*clamp(((m.revYoY??0)+0.05)/0.25*100);
 }
 C.risk=0.6*clamp(100-(m.vol-0.15)/0.30*100)+0.4*clamp(100+m.mdd/0.4*100);
 let tw=0,ts=0;for(const k in W){if(C[k]!=null){ts+=C[k]*W[k];tw+=W[k]}}
 m.comp=C;m.score=tw?ts/tw:null;
 const ok=(c,t)=>R.push({ok:c,t});
 if(m.sma200!=null)ok(m.price>m.sma200,`Price ${m.price>m.sma200?'above':'below'} 200-DMA (${fN(m.sma200)})`);
 if(m.sma200!=null)ok(m.sma50>m.sma200,m.sma50>m.sma200?'50-DMA above 200-DMA (golden-cross regime)':'50-DMA below 200-DMA (death-cross regime)');
 ok(rs>=45&&rs<=72,`RSI(14) ${fN(rs,1)} — ${rs>72?'overbought':rs<30?'oversold':rs<45?'weak':'healthy momentum'}`);
 ok(m.macdH>0,`MACD histogram ${m.macdH>0?'positive':'negative'}`);
 ok(m.stDir===1,`Supertrend(10,3) ${m.stDir===1?'bullish':'bearish'} · line ${fN(m.stLine)}`);
 if(m.ups!=null)ok(m.ups>0.1,`Intrinsic value ${fN(m.iv.avg)} → ${fPt(m.ups)} ${m.ups>0?'upside':'downside'}`);
 if(m.roe!=null)ok(m.roe>0.15,`ROE ${fPp(m.roe)}`);
 if(m.de!=null&&!m.fin)ok(m.de<0.8,`Debt/Equity ${fN(m.de)}`);
 if(m.rev3y!=null)ok(m.rev3y>0.10,`Revenue 3Y CAGR ${fPp(m.rev3y)}`);
 if(m.np3y!=null)ok(m.np3y>0.12,`Profit 3Y CAGR ${fPp(m.np3y)}`);
 ok(m.vol<0.35,`Annualised volatility ${fPp(m.vol)}`);
 ok(m.offH>-0.25,`${fPt(m.offH)} from 52-week high`);
 m.reasons=R;
 const hardExit=(m.sma200!=null&&m.price<m.sma200&&m.sma50<m.sma200&&m.stDir===-1);
 let v;if(hardExit)v='EXIT';else if(m.score>=68&&C.trend>=70)v='BUY ZONE';else if(m.score>=55)v='HOLD';else if(m.score>=42)v='WAIT';else v='EXIT';
 m.verdict=v;m.hardExit=hardExit;
 // Opportunity: fundamentally strong + materially down + undervalued
 const good=m.hasF&&(C.qual||0)>=60&&(C.growth||0)>=50&&(m.npTTM>0);
 const down=m.offH<=-0.15||(m.r3m!=null&&m.r3m<=-0.08);
 m.opp=good&&down&&(m.ups==null||m.ups>0.05)&&!hardExit;
 m.oppScore=m.opp?((C.qual+C.growth)/2+(-m.offH*100)+(m.ups||0)*60):null;
}
function computeAll(){
 computeIndices();
 const nb=S.IDX['NIFTY 50'];S._niftyMap=nb?new Map(nb.bars.map(b=>[b.t,b.c])):null;const sp=S.IDX['S&P 500 (leaders)'];S._spMap=sp?new Map(sp.bars.map(b=>[b.t,b.c])):null;
 const M={};for(const s of S.uni){const d=S.D[s.sym];if(!d||!d.bars||d.bars.length<30)continue;try{M[s.sym]=baseMetrics(s,d)}catch(e){console.warn(s.sym,e)}}
 const sec={};for(const s of S.uni){const m=M[s.sym];if(!m)continue;const a=sec[s.sector]||(sec[s.sector]={rev:0,pes:[],n:0,chg:[]});if(m.revTTM>0)a.rev+=m.revTTM;if(m.pe>0&&m.pe<250)a.pes.push(m.pe);a.chg.push(m.chgp);a.n++}
 for(const k in sec){sec[k].medPE=median(sec[k].pes);sec[k].avgChg=mean(sec[k].chg)}
 S.SEC=sec;
 for(const s of S.uni){const m=M[s.sym];if(!m)continue;valuation(s,m,sec[s.sector]);scoreIt(s,m,sec[s.sector])}
 S.M=M;
 try{if(S.al&&S.al.rules.length)setTimeout(runAlerts,0)}catch(e){}
}
function reScore(){for(const s of S.uni){const m=S.M[s.sym];if(m)scoreIt(s,m,S.SEC[s.sector])}}
