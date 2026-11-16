'use strict';
/* ============================== Universe & index build ============================== */
function initUniverse(){
 const extra=LS.get('dq_uni_extra',[]);
 const base=UNI_RAW.trim().split('\n').map(l=>{const [sym,name,sector,codes='']=l.split('|').map(x=>x.trim());return {sym,name,sector,codes}});
 const seen=new Set(base.map(s=>s.sym));
 extra.forEach(e=>{if(e.sym&&!seen.has(e.sym)){base.push(e);seen.add(e.sym)}});
 S.uni=base;S.uni.forEach(s=>s.mkt=/[UQ]/.test(s.codes)?'US':'IN');S.uni.forEach(s=>s.idx=INDEX_DEFS.filter(d=>d.f(s)).map(d=>d.id));
 S.bySym=Object.fromEntries(S.uni.map(s=>[s.sym,s]));
}
function computeIndices(){
 S.IDX={};
 for(const def of INDEX_DEFS){
  const mem=S.uni.filter(s=>s.idx.includes(def.id)&&S.D[s.sym]&&S.D[s.sym].bars.length>30);if(!mem.length)continue;
  const ms=mem.map(s=>{const d=S.D[s.sym],b=d.bars,lc=b[b.length-1].c;return {mp:new Map(b.map(x=>[x.t,x])),lc,w:d.shares?lc*d.shares:1,prev:null}});
  const bars=[];
  for(const t of S.dates){let o=0,h=0,l=0,c=0,W=0;for(const m of ms){const x=m.mp.get(t)||m.prev;if(!x)continue;m.prev=x;o+=m.w*x.o/m.lc;h+=m.w*x.h/m.lc;l+=m.w*x.l/m.lc;c+=m.w*x.c/m.lc;W+=m.w}
   if(W>0)bars.push({t,o:def.base*o/W,h:def.base*h/W,l:def.base*l/W,c:def.base*c/W,v:0})}
  // renormalise so the last close equals full-weight level
  S.IDX[def.id]={bars,members:mem.map(s=>s.sym),base:def.base};
  if(mem.every(s=>S.D[s.sym].src.px==='sim')){const k=0.95+rng(hash(def.id))()*0.1;bars.forEach(b=>{b.o*=k;b.h*=k;b.l*=k;b.c*=k})}
 }
 const nb=S.IDX['NIFTY 50']?S.IDX['NIFTY 50'].bars:[];const c=nb.map(b=>b.c);const v=[];
 for(let i=0;i<c.length;i++){if(i<21){v.push(null);continue}const r=[];for(let j=i-20;j<=i;j++)r.push(Math.log(c[j]/c[j-1]));v.push(std(r)*Math.sqrt(252)*100*1.05+5)}
 S.VIX=v;
}
