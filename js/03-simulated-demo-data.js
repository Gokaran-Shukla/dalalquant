'use strict';
/* ============================== Simulated demo data ============================== */
function genSim(s){
 const R=rng(hash(s.sym)),g=()=>gauss(R),n=S.dates.length,fin=FIN.has(s.sector);
 const sc_=has(s,'X');const vol=0.17+R()*0.21+(sc_?0.08:0);let mu=-0.03+R()*0.27;const us=s.mkt==='US';let p=us?Math.exp(Math.log(25)+R()*Math.log(900/25)):Math.exp(Math.log(90)+R()*Math.log(6000/90));
 const baseVol=Math.round(2e5+R()*8e6);const dt=1/252;const bars=[];let regime=mu;
 for(let i=0;i<n;i++){
  if(i%120===0) regime=mu+0.2*g();
  const o=p*(1+g()*vol*0.12*Math.sqrt(dt));
  const ret=(regime-0.5*vol*vol)*dt+vol*Math.sqrt(dt)*g();
  const c=o*Math.exp(ret);
  const hi=Math.max(o,c)*(1+Math.abs(g())*vol*0.35*Math.sqrt(dt));
  const lo=Math.min(o,c)*(1-Math.abs(g())*vol*0.35*Math.sqrt(dt));
  bars.push({t:S.dates[i],o:r2(o),h:r2(hi),l:r2(lo),c:r2(c),v:Math.round(baseVol*(0.6+R()*0.8)*(1+Math.abs(ret)*25))});p=c;
 }
 {const L=Math.log(bars[n-1].c/bars[0].c),lo=Math.log(0.45),hi=Math.log(3.2);const tgt=Math.min(hi,Math.max(lo,L));if(tgt!==L){const adj=tgt-L;bars.forEach((b,i)=>{const f=Math.exp(adj*i/(n-1));b.o=r2(b.o*f);b.h=r2(b.h*f);b.l=r2(b.l*f);b.c=r2(b.c*f)})}}
 const QL=quarterLabels(20);const revL=sc_?Math.exp(Math.log(150)+R()*Math.log(2500/150)):us?Math.exp(Math.log(3000)+R()*Math.log(150000/3000)):Math.exp(Math.log(600)+R()*Math.log(80000/600));
 const ga=-0.03+R()*0.33;const em=fin?0.30+R()*0.25:0.08+R()*0.27;const nm=em*(0.42+R()*0.25);const fcfr=0.45+R()*0.65;
 const q=QL.map((L,k)=>{const yrsBack=(QL.length-1-k)/4;const seas=1+0.035*Math.sin((L.q)*1.7+R());const rev=revL/Math.pow(1+ga,yrsBack)*seas*(1+0.035*g());
  const e=Math.max(0.01,em+0.015*g());const npm=Math.max(-0.08,nm+0.012*g());const np=rev*npm;
  return {p:L.label,fy:L.fy,qn:L.q,rev:r2(rev),ebitda:r2(rev*e),np:r2(np),fcf:fin?null:r2(np*(fcfr+0.25*g()))}});
 const npTTM=q.slice(-4).reduce((a,x)=>a+x.np,0);const peT=Math.max(6,9+R()*50+ga*40);
 const shares=Math.max(0.5,npTTM*peT/mean(bars.slice(0,60).map(b=>b.c)));// shares fixed from early prices so demo fundamentals never "know" future returns
 q.forEach(x=>x.eps=r2(x.np/shares));
 const roeT=fin?0.08+R()*0.14:0.07+R()*0.25;const equity=Math.max(npTTM/roeT,1);
 const debt=fin?equity*(4+R()*6):equity*R()*R()*1.6;const cash=equity*(0.04+R()*0.3);
 const promoter=R()<0.15?0:r2(28+R()*47);const fii=r2(Math.min(95-promoter,5+R()*38));const dii=r2(Math.min(97-promoter-fii,3+R()*25));
 const sh=QL.slice(-8).map((L,k)=>{const d=(7-k);return {p:L.label,prom:r2(Math.max(0,promoter-d*0.15*g())),fii:r2(Math.max(0,fii+d*0.3*g())),dii:r2(Math.max(0,dii-d*0.25*g()))}});
 sh.forEach(x=>x.pub=r2(Math.max(0,100-x.prom-x.fii-x.dii)));sh[sh.length-1]={p:sh[sh.length-1].p,prom:promoter,fii,dii,pub:r2(100-promoter-fii-dii)};
 return {bars,q,shares,debt,cash,equity,promoter,fii,dii,sh,dy:r2((0.002+R()*0.035)*100)/100,src:{px:'sim',f:'sim'}};
}
