'use strict';
/* ============================== Charts (canvas) ============================== */
function setupCanvas(cv){const r=cv.getBoundingClientRect();const w=Math.max(50,r.width),h=Math.max(30,r.height);const dpr=window.devicePixelRatio||1;cv.width=Math.round(w*dpr);cv.height=Math.round(h*dpr);const g=cv.getContext&&cv.getContext('2d');if(!g)return null;g.setTransform(dpr,0,0,dpr,0,0);g.clearRect(0,0,w,h);return {g,w,h}}
const GRID='#1C2433',AX='#6b7a89';
function yTicks(lo,hi,n=5){const step=(hi-lo)/n;return Array.from({length:n+1},(_,i)=>lo+i*step)}
function fAx(v){const a=Math.abs(v);if(a>=1e7)return (v/1e7).toFixed(1)+'Cr';if(a>=1e5)return (v/1e5).toFixed(1)+'L';if(a>=1e3)return v.toFixed(0);if(a>=10)return v.toFixed(1);return v.toFixed(2)}
function priceChart(cv,bars,o={}){
 const C=setupCanvas(cv);if(!C||!bars.length)return;const {g,w,h}=C;const n=bars.length;
 const padR=62,padB=18,padT=6;const hasSub=!!o.sub;const mainH=hasSub?(h-padB-padT)*0.72:h-padB-padT;const subTop=padT+mainH+10,subH=hasSub?h-padB-subTop:0;
 let lo=Infinity,hi=-Infinity;bars.forEach(b=>{lo=Math.min(lo,b.l);hi=Math.max(hi,b.h)});(o.overlays||[]).forEach(ov=>ov.data.forEach(v=>{if(v!=null){lo=Math.min(lo,v);hi=Math.max(hi,v)}}));
 const pd=(hi-lo)*0.05||1;lo-=pd;hi+=pd;const cw=(w-padR)/n;const X=i=>i*cw+cw/2,Y=v=>padT+(hi-v)/(hi-lo)*mainH;
 g.font='10.5px JetBrains Mono, monospace';g.textBaseline='middle';
 yTicks(lo,hi).forEach(v=>{const y=Y(v);g.strokeStyle=GRID;g.beginPath();g.moveTo(0,y);g.lineTo(w-padR,y);g.stroke();g.fillStyle=AX;g.fillText(fAx(v),w-padR+6,y)});
 if(o.bands){g.fillStyle='rgba(79,140,255,0.07)';g.beginPath();let st=false;for(let i=0;i<n;i++){if(o.bands.up[i]==null)continue;const x=X(i),y=Y(o.bands.up[i]);if(!st){g.moveTo(x,y);st=true}else g.lineTo(x,y)}for(let i=n-1;i>=0;i--){if(o.bands.lo[i]==null)continue;g.lineTo(X(i),Y(o.bands.lo[i]))}g.closePath();g.fill()}
 if(cw>=2.2){for(let i=0;i<n;i++){const b=bars[i],up=b.c>=b.o;g.strokeStyle=g.fillStyle=up?'#34D399':'#F87171';const x=X(i);g.beginPath();g.moveTo(x,Y(b.h));g.lineTo(x,Y(b.l));g.stroke();const bw=Math.max(1,cw*0.66);const y1=Y(Math.max(b.o,b.c)),y2=Y(Math.min(b.o,b.c));g.fillRect(x-bw/2,y1,bw,Math.max(1,y2-y1))}}
 else{g.strokeStyle='#60a5fa';g.lineWidth=1.4;g.beginPath();bars.forEach((b,i)=>{i?g.lineTo(X(i),Y(b.c)):g.moveTo(X(i),Y(b.c))});g.stroke();g.lineWidth=1}
 (o.overlays||[]).forEach(ov=>{g.strokeStyle=ov.color;g.lineWidth=ov.w||1.3;g.setLineDash(ov.dash||[]);g.beginPath();let st=false;ov.data.forEach((v,i)=>{if(v==null){st=false;return}if(!st){g.moveTo(X(i),Y(v));st=true}else g.lineTo(X(i),Y(v))});g.stroke();g.setLineDash([]);g.lineWidth=1});
 (o.markers||[]).forEach(mk=>{if(mk.i<0||mk.i>=n)return;const x=X(mk.i);g.fillStyle=mk.buy?'#34D399':'#f97316';g.beginPath();if(mk.buy){const y=Y(bars[mk.i].l)+10;g.moveTo(x,y-6);g.lineTo(x-5,y+3);g.lineTo(x+5,y+3)}else{const y=Y(bars[mk.i].h)-10;g.moveTo(x,y+6);g.lineTo(x-5,y-3);g.lineTo(x+5,y-3)}g.fill()});
 if(o.hlines)o.hlines.forEach(hl=>{const y=Y(hl.v);if(y<padT||y>padT+mainH)return;g.strokeStyle=hl.color;g.setLineDash([4,4]);g.beginPath();g.moveTo(0,y);g.lineTo(w-padR,y);g.stroke();g.setLineDash([]);g.fillStyle=hl.color;g.fillText(hl.label||fAx(hl.v),w-padR+6,y)});
 if(hasSub){const sb=o.sub;let slo,shi;const vals=(sb.series||[]).flatMap(s=>s.data).concat(sb.hist||[]).filter(v=>v!=null);slo=sb.lo!=null?sb.lo:Math.min(...vals,0);shi=sb.hi!=null?sb.hi:Math.max(...vals,0);if(shi===slo)shi=slo+1;
  const SY=v=>subTop+(shi-v)/(shi-slo)*subH;g.strokeStyle=GRID;g.strokeRect(0,subTop,w-padR,subH);g.fillStyle=AX;g.fillText(sb.label||'',4,subTop+8);
  (sb.levels||[]).forEach(l=>{g.strokeStyle='#334155';g.setLineDash([3,3]);g.beginPath();g.moveTo(0,SY(l));g.lineTo(w-padR,SY(l));g.stroke();g.setLineDash([]);g.fillStyle=AX;g.fillText(String(l),w-padR+6,SY(l))});
  if(sb.hist){const z=SY(0);sb.hist.forEach((v,i)=>{if(v==null)return;g.fillStyle=sb.histColor?sb.histColor(i,v):(v>=0?'rgba(52,211,153,.6)':'rgba(248,113,113,.6)');const y=SY(Math.max(v,0)),y2=SY(Math.min(v,0));g.fillRect(X(i)-Math.max(1,cw*0.33),Math.min(y,z),Math.max(1,cw*0.66),Math.max(1,Math.abs(y2-y)))})}
  (sb.series||[]).forEach(s=>{g.strokeStyle=s.color;g.beginPath();let st=false;s.data.forEach((v,i)=>{if(v==null){st=false;return}if(!st){g.moveTo(X(i),SY(v));st=true}else g.lineTo(X(i),SY(v))});g.stroke()})}
 g.fillStyle=AX;g.textBaseline='alphabetic';const lbN=Math.min(7,n);for(let k=0;k<lbN;k++){const i=Math.floor(k*(n-1)/Math.max(1,lbN-1));const t=bars[i].t;g.fillText(t.slice(2),Math.min(Math.max(0,X(i)-22),w-padR-50),h-4)}
 if(o.hover!=null&&o.hover>=0&&o.hover<n){const x=X(o.hover);g.strokeStyle='#475569';g.setLineDash([3,3]);g.beginPath();g.moveTo(x,padT);g.lineTo(x,h-padB);g.stroke();g.setLineDash([])}
 cv.onmousemove=e=>{const r=cv.getBoundingClientRect();const i=Math.floor((e.clientX-r.left)/cw);if(i>=0&&i<n&&i!==o.hover){o.hover=i;priceChart(cv,bars,o);o.onHover&&o.onHover(i)}};
 cv.onmouseleave=()=>{o.hover=null;priceChart(cv,bars,o);o.onHover&&o.onHover(null)};
}
function lineChart(cv,series,o={}){
 const C=setupCanvas(cv);if(!C)return;const {g,w,h}=C;const padR=58,padB=18,padT=8,ph=h-padB-padT;
 const n=Math.max(...series.map(s=>s.data.length));if(!n)return;let lo=Infinity,hi=-Infinity;series.forEach(s=>s.data.forEach(v=>{if(v!=null&&isFinite(v)){lo=Math.min(lo,v);hi=Math.max(hi,v)}}));if(o.zero){lo=Math.min(lo,0);hi=Math.max(hi,0)}if(!isFinite(lo))return;if(hi===lo){hi+=1;lo-=1}const pd=(hi-lo)*0.06;lo-=pd;hi+=pd;
 const X=i=>(n<=1?0:i/(n-1))*(w-padR),Y=v=>padT+(hi-v)/(hi-lo)*ph;g.font='10.5px JetBrains Mono, monospace';g.textBaseline='middle';
 yTicks(lo,hi,4).forEach(v=>{const y=Y(v);g.strokeStyle=GRID;g.beginPath();g.moveTo(0,y);g.lineTo(w-padR,y);g.stroke();g.fillStyle=AX;g.fillText((o.yfmt||fAx)(v),w-padR+6,y)});
 if(o.zero){g.strokeStyle='#475569';g.beginPath();g.moveTo(0,Y(0));g.lineTo(w-padR,Y(0));g.stroke()}
 if(o.pnlFill&&series[0]){const d=series[0].data,z=Y(0);for(let i=1;i<d.length;i++){if(d[i]==null||d[i-1]==null)continue;const mid=(d[i]+d[i-1])/2;g.fillStyle=mid>=0?'rgba(52,211,153,.18)':'rgba(248,113,113,.18)';g.beginPath();g.moveTo(X(i-1),z);g.lineTo(X(i-1),Y(d[i-1]));g.lineTo(X(i),Y(d[i]));g.lineTo(X(i),z);g.closePath();g.fill()}}
 series.forEach(s=>{g.strokeStyle=s.color;g.lineWidth=s.w||1.6;g.setLineDash(s.dash||[]);g.beginPath();let st=false;s.data.forEach((v,i)=>{if(v==null||!isFinite(v)){st=false;return}if(!st){g.moveTo(X(i),Y(v));st=true}else g.lineTo(X(i),Y(v))});g.stroke();g.setLineDash([]);
  if(s.fill){g.globalAlpha=.12;g.fillStyle=s.color;g.lineTo(X(n-1),Y(lo));g.lineTo(X(0),Y(lo));g.closePath();g.fill();g.globalAlpha=1}});g.lineWidth=1;
 (o.vlines||[]).forEach(vl=>{const x=X(vl.i);g.strokeStyle=vl.color||'#64748b';g.setLineDash([4,4]);g.beginPath();g.moveTo(x,padT);g.lineTo(x,h-padB);g.stroke();g.setLineDash([]);if(vl.label){g.fillStyle=vl.color||AX;g.fillText(vl.label,Math.min(x+4,w-padR-60),padT+8)}});
 if(o.labels){g.fillStyle=AX;g.textBaseline='alphabetic';const k=Math.min(6,o.labels.length);for(let j=0;j<k;j++){const i=Math.floor(j*(o.labels.length-1)/Math.max(1,k-1));g.fillText(String(o.labels[i]),Math.min(Math.max(0,X(i)-20),w-padR-44),h-4)}}
 if(series.some(s=>s.label)){let x=6;g.textBaseline='middle';series.forEach(s=>{if(!s.label)return;g.fillStyle=s.color;g.fillRect(x,padT+2,10,3);g.fillStyle='#cbd5e1';g.fillText(s.label,x+14,padT+4);x+=g.measureText(s.label).width+30})}
}
function sparkline(cv,data,color){const C=setupCanvas(cv);if(!C)return;const {g,w,h}=C;const v=data.filter(x=>x!=null);if(v.length<2)return;const lo=Math.min(...v),hi=Math.max(...v);const X=i=>i/(v.length-1)*w,Y=x=>2+(hi-x)/((hi-lo)||1)*(h-4);g.strokeStyle=color;g.lineWidth=1.3;g.beginPath();v.forEach((x,i)=>i?g.lineTo(X(i),Y(x)):g.moveTo(0,Y(x)));g.stroke();g.globalAlpha=.12;g.fillStyle=color;g.lineTo(w,h);g.lineTo(0,h);g.closePath();g.fill();g.globalAlpha=1}
function barChart(cv,labels,sets,o={}){
 const C=setupCanvas(cv);if(!C)return;const {g,w,h}=C;const padR=58,padB=20,padT=16,ph=h-padB-padT;const vals=sets.flatMap(s=>s.data).filter(v=>v!=null);if(!vals.length)return;
 let lo=Math.min(0,...vals),hi=Math.max(0,...vals);if(hi===lo)hi=lo+1;const pd=(hi-lo)*0.06;hi+=pd;if(lo<0)lo-=pd;const Y=v=>padT+(hi-v)/(hi-lo)*ph;const n=labels.length,gw=(w-padR)/n,bw=gw*0.75/sets.length;
 g.font='10.5px JetBrains Mono, monospace';g.textBaseline='middle';yTicks(lo,hi,4).forEach(v=>{const y=Y(v);g.strokeStyle=GRID;g.beginPath();g.moveTo(0,y);g.lineTo(w-padR,y);g.stroke();g.fillStyle=AX;g.fillText((o.yfmt||fAx)(v),w-padR+6,y)});
 sets.forEach((s,k)=>s.data.forEach((v,i)=>{if(v==null)return;g.fillStyle=typeof s.color==='function'?s.color(v,i):s.color;const x=i*gw+gw*0.125+k*bw;const y1=Y(Math.max(v,0)),y2=Y(Math.min(v,0));g.fillRect(x,y1,bw-1,Math.max(1,y2-y1))}));
 g.fillStyle=AX;g.textBaseline='alphabetic';const step=Math.ceil(n/12);labels.forEach((l,i)=>{if(i%step)return;g.fillText(String(l).slice(0,o.lblLen||9),i*gw+2,h-5)});
 if(sets.length>1||sets[0].label){let x=6;g.textBaseline='middle';sets.forEach(s=>{if(!s.label)return;g.fillStyle=typeof s.color==='function'?'#94a3b8':s.color;g.fillRect(x,4,10,6);g.fillStyle='#cbd5e1';g.fillText(s.label,x+14,7);x+=g.measureText(s.label).width+30})}
}
