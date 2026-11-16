'use strict';
/* ============================== SCREENER (query language) ============================== */
const pc_=x=>x==null?null:x*100;
const FIELDS=[
 ['Market Capitalization',['market capitalization','market cap','mcap'],m=>m.mcap,'₹ Cr'],
 ['Current price',['current price','price','cmp','ltp'],m=>m.price,'₹'],
 ['Price to earning',['price to earning','p/e','pe'],m=>m.pe,'x'],
 ['Price to book value',['price to book value','p/b','pb'],m=>m.pb,'x'],
 ['EV/EBITDA',['ev/ebitda','ev to ebitda'],m=>m.evEb,'x'],
 ['Return on equity',['return on equity','roe'],m=>pc_(m.roe),'%'],
 ['ROCE',['return on capital employed','roce'],m=>pc_(m.roce),'% (approx)'],
 ['Debt to equity',['debt to equity','d/e','de'],m=>m.de,'x'],
 ['Sales',['sales','revenue'],m=>m.revTTM,'₹ Cr TTM'],
 ['Net profit',['net profit','pat','profit'],m=>m.npTTM,'₹ Cr TTM'],
 ['EPS',['eps'],m=>m.epsTTM,'₹ TTM'],
 ['Sales growth 3Years',['sales growth 3years','sales growth 3 years','sales growth 3y'],m=>pc_(m.rev3y),'% CAGR'],
 ['Profit growth 3Years',['profit growth 3years','profit growth 3 years','profit growth 3y'],m=>pc_(m.np3y),'% CAGR'],
 ['Sales growth',['sales growth','yoy quarterly sales growth'],m=>pc_(m.rev1y),'% TTM YoY'],
 ['Profit growth',['profit growth','yoy quarterly profit growth'],m=>pc_(m.np1y),'% TTM YoY'],
 ['Quarterly sales growth',['quarterly sales growth','qoq sales growth'],m=>pc_(m.revYoY),'% latest Q YoY'],
 ['OPM',['opm','operating profit margin','ebitda margin'],m=>pc_(m.ebitdaM),'%'],
 ['NPM',['npm','net profit margin'],m=>pc_(m.npM),'%'],
 ['Dividend yield',['dividend yield'],m=>pc_(m.dy),'%'],
 ['Promoter holding',['promoter holding'],m=>m.promoter,'%'],
 ['FII holding',['fii holding'],m=>m.fii,'%'],
 ['DII holding',['dii holding'],m=>m.dii,'%'],
 ['Return over 1year',['return over 1year','return over 1 year','return 1y'],m=>pc_(m.r1y),'%'],
 ['Return over 6months',['return over 6months','return over 6 months','return 6m'],m=>pc_(m.r6m),'%'],
 ['Return over 3months',['return over 3months','return over 3 months','return 3m'],m=>pc_(m.r3m),'%'],
 ['Return over 1month',['return over 1month','return over 1 month','return 1m'],m=>pc_(m.r1m),'%'],
 ['Return over 1week',['return over 1week','return over 1 week','return 1w'],m=>pc_(m.r1w),'%'],
 ['Day change',['day change','change'],m=>pc_(m.chgp),'%'],
 ['Down from 52w high',['down from 52w high','down from high'],m=>pc_(-m.offH),'%'],
 ['Up from 52w low',['up from 52w low','up from low'],m=>pc_(m.offL),'%'],
 ['52w high',['52w high','high 52w'],m=>m.h52,'₹'],
 ['52w low',['52w low','low 52w'],m=>m.l52,'₹'],
 ['Volatility',['volatility'],m=>pc_(m.vol),'% ann.'],
 ['Beta',['beta'],m=>m.beta,''],
 ['Sharpe',['sharpe'],m=>m.sharpe,''],
 ['RSI',['rsi'],m=>m.rsi,''],
 ['DMA 50',['dma 50','dma50','sma50'],m=>m.sma50,'₹'],
 ['DMA 200',['dma 200','dma200','sma200'],m=>m.sma200,'₹'],
 ['Volume ratio',['volume ratio'],m=>m.volRatio,'× 20d avg'],
 ['DQ Score',['dq score','score'],m=>m.score,'0–100'],
 ['Quality score',['quality score'],m=>m.comp&&m.comp.qual,'0–100'],
 ['Growth score',['growth score'],m=>m.comp&&m.comp.growth,'0–100'],
 ['Intrinsic value',['intrinsic value'],m=>m.iv&&m.iv.avg,'₹'],
 ['Upside',['upside','margin of safety'],m=>pc_(m.ups),'% to IV'],
 ['Graham Number',['graham number'],m=>m.iv&&m.iv.gn,'₹'],
 ['Piotroski score',['piotroski score','f score','f-score'],m=>m.fscore,'0–8 (approx)'],
 ['Market share',['market share'],m=>pc_(m.mshare),'% of sector sales'],
];
const FNAMES=FIELDS.flatMap((f,i)=>f[1].map(n=>[n,i])).sort((a,b)=>b[0].length-a[0].length);
function tokenize(src){const s=src.toLowerCase();const T=[];let i=0;while(i<s.length){const ch=s[i];if(/\s/.test(ch)){i++;continue}
 if(/[0-9.]/.test(ch)){let j=i;while(j<s.length&&/[0-9._]/.test(s[j]))j++;T.push({t:'n',v:parseFloat(s.slice(i,j).replace(/_/g,''))});i=j;continue}
 const two=s.slice(i,i+2);if(['>=','<=','!=','==','<>'].includes(two)){T.push({t:'op',v:two==='<>'?'!=':two});i+=2;continue}
 if('<>='.includes(ch)){T.push({t:'op',v:ch==='='?'==':ch});i++;continue}
 if('+-*/'.includes(ch)&&!(ch==='/'&&false)){ // field names may contain '/', try fields first
  const fm=FNAMES.find(([n])=>s.startsWith(n,i)&&!/[a-z0-9]/.test(s[i+n.length]||' '));if(fm&&ch!=='-'&&ch!=='+'&&ch!=='*'){T.push({t:'f',v:fm[1]});i+=fm[0].length;continue}
  T.push({t:'ar',v:ch});i++;continue}
 if(ch==='('||ch===')'){T.push({t:ch});i++;continue}
 const kw=s.slice(i).match(/^(and|or|not)\b/);if(kw){T.push({t:kw[1]});i+=kw[1].length;continue}
 const fm=FNAMES.find(([n])=>s.startsWith(n,i)&&!/[a-z0-9]/.test(s[i+n.length]||' '));if(fm){T.push({t:'f',v:fm[1]});i+=fm[0].length;continue}
 const word=s.slice(i).match(/^[a-z0-9/ ]{1,30}/);throw new Error('Unknown field near "'+(word?word[0].trim():ch)+'"')}
 return T}
function parseQuery(src){const T=tokenize(src);let p=0;const peek=()=>T[p],eat=t=>{if(!T[p]||T[p].t!==t)throw new Error('Expected '+t);return T[p++]};
 const prim=()=>{const k=peek();if(!k)throw new Error('Unexpected end');if(k.t==='n'){p++;return ()=>k.v}if(k.t==='f'){p++;const g=FIELDS[k.v][2];return m=>{const v=g(m);return v==null||!isFinite(v)?null:v}}if(k.t==='('){p++;const e=orE();eat(')');return e}if(k.t==='ar'&&k.v==='-'){p++;const e=prim();return m=>{const v=e(m);return v==null?null:-v}}throw new Error('Unexpected token')};
 const prod=()=>{let a=prim();while(peek()&&peek().t==='ar'&&(peek().v==='*'||peek().v==='/')){const op=T[p++].v,b=prim(),A=a;a=m=>{const x=A(m),y=b(m);if(x==null||y==null)return null;return op==='*'?x*y:(y===0?null:x/y)}}return a};
 const sum=()=>{let a=prod();while(peek()&&peek().t==='ar'&&(peek().v==='+'||peek().v==='-')){const op=T[p++].v,b=prod(),A=a;a=m=>{const x=A(m),y=b(m);if(x==null||y==null)return null;return op==='+'?x+y:x-y}}return a};
 const cmp=()=>{const a=sum();if(peek()&&peek().t==='op'){const op=T[p++].v,b=sum();return m=>{const x=a(m),y=b(m);if(x==null||y==null)return false;switch(op){case '>':return x>y;case '<':return x<y;case '>=':return x>=y;case '<=':return x<=y;case '==':return Math.abs(x-y)<1e-9;case '!=':return x!==y}}}return m=>!!a(m)};
 const notE=()=>{if(peek()&&peek().t==='not'){p++;const e=notE();return m=>!e(m)}return cmp()};
 const andE=()=>{let a=notE();while(peek()&&peek().t==='and'){p++;const b=notE(),A=a;a=m=>A(m)&&b(m)}return a};
 const orE=()=>{let a=andE();while(peek()&&peek().t==='or'){p++;const b=andE(),A=a;a=m=>A(m)||b(m)}return a};
 const e=orE();if(p<T.length)throw new Error('Unexpected input after position '+p);return e}
const PRESETS=[
 ['Quality on discount (opportunities)','Return on equity > 15 AND Sales growth 3Years > 8 AND Down from 52w high > 15 AND Upside > 0'],
 ['Coffee-can style compounders','Return on equity > 15 AND Sales growth 3Years > 10 AND Debt to equity < 0.5 AND Net profit > 0'],
 ['Magic-formula style','ROCE > 20 AND Price to earning < 25 AND Price to earning > 0'],
 ['GARP — growth at reasonable price','Price to earning < 22 AND Profit growth 3Years > 15 AND Return on equity > 12'],
 ['Momentum leaders','Return over 3months > 10 AND RSI > 55 AND Current price > DMA 200'],
 ['Golden-cross trend','DMA 50 > DMA 200 AND Current price > DMA 50 AND Volume ratio > 1'],
 ['Debt-free profitable','Debt to equity < 0.1 AND Net profit > 0 AND OPM > 15'],
 ['Near 52w low but strong','Up from 52w low < 12 AND DQ Score > 50'],
 ['High dividend yield','Dividend yield > 2.5 AND Net profit > 0'],
 ['Piotroski strong (approx)','Piotroski score >= 7'],
 ['Graham value','Current price < Graham Number AND Price to earning < 15 AND Price to book value < 2'],
 ['Promoter + FII confidence','Promoter holding > 50 AND FII holding > 15 AND Return on equity > 14'],
];
S.scr={q:PRESETS[0][1],res:null,err:null,sort:'score',dir:-1,cols:['Market Capitalization','Price to earning','Return on equity','Sales growth 3Years','Profit growth 3Years','Down from 52w high','Upside','DQ Score']};
function runScreen(){try{const fn=parseQuery(S.scr.q);S.scr.err=null;S.scr.res=S.uni.filter(s=>S.M[s.sym]&&fn(S.M[s.sym])).map(s=>s.sym)}catch(e){S.scr.err=e.message;S.scr.res=null}}
function renderScreener(){
 const el=$('#tab-screener');if(S.scr.res==null&&!S.scr.err)runScreen();const Sc=S.scr;
 const cols=Sc.cols.map(n=>FIELDS.find(f=>f[0]===n)).filter(Boolean);
 let res=(Sc.res||[]).map(sym=>({s:S.bySym[sym],m:S.M[sym]}));
 const sf=Sc.sort==='score'?(x=>x.m.score):(FIELDS.find(f=>f[0]===Sc.sort)?(x=>FIELDS.find(f=>f[0]===Sc.sort)[2](x.m)):(x=>x.m.score));
 res.sort((a,b)=>{const x=sf(a),y=sf(b);if(x==null)return 1;if(y==null)return -1;return (x-y)*Sc.dir});
 el.innerHTML=`<div class="g2"><div class="card"><h3>Query screener <span class="r mu" style="text-transform:none;letter-spacing:0">Screener.in-style: fields, AND / OR / NOT, + − × ÷, brackets</span></h3>
 <textarea id="scrQ" rows="4" spellcheck="false">${esc(Sc.q)}</textarea>
 <div class="row" style="margin-top:8px"><button class="btn" data-act="scrRun">Run query</button><button class="btn s" data-act="scrSave">Save screen</button><button class="btn s" data-act="scrCsv">Copy results CSV</button>
 <span class="${Sc.err?'err':'mu'}">${Sc.err?esc(Sc.err):`${(Sc.res||[]).length} matches of ${Object.keys(S.M).length}`}</span></div>
 <div class="note">Example: <span class="mono">Market Capitalization &gt; 20000 AND (Return on equity &gt; 18 OR ROCE &gt; 22) AND Price to earning &lt; Sales growth 3Years * 2</span></div></div>
 <div class="card"><h3>Preset & saved screens</h3><div class="row">${PRESETS.map((p,i)=>`<button class="btn s xs" data-preset="${i}">${esc(p[0])}</button>`).join('')}</div>
 ${S.screens.length?`<div class="h3" style="margin-top:10px">Saved</div><div class="row">${S.screens.map((p,i)=>`<span><button class="btn s xs" data-saved="${i}">${esc(p.name)}</button><span class="mu" data-delsaved="${i}" style="cursor:pointer;margin-left:2px">✕</span></span>`).join('')}</div>`:''}</div></div>
 <div class="card"><h3>Results <span class="r"><details style="display:inline"><summary class="mu" style="cursor:pointer;text-transform:none;letter-spacing:0">Columns</summary><div style="max-height:220px;overflow:auto;background:var(--p2);padding:8px;border-radius:6px;position:absolute;z-index:5;width:260px">${FIELDS.map(f=>`<label class="c" style="display:flex"><input type="checkbox" data-col="${esc(f[0])}" ${Sc.cols.includes(f[0])?'checked':''}>${esc(f[0])}</label>`).join('')}</div></details></span></h3>
 <div class="tw" style="max-height:66vh"><table class="t"><thead><tr><th></th><th>#</th><th>Name</th><th class="n">LTP</th>${cols.map(c=>`<th class="n" data-ssort="${esc(c[0])}" style="cursor:pointer">${esc(c[0])}${Sc.sort===c[0]?(Sc.dir<0?' ▼':' ▲'):''}<div class="mu" style="font-size:9.5px;text-transform:none">${esc(c[3])}</div></th>`).join('')}<th>Signal</th></tr></thead><tbody>
 ${res.map((x,i)=>`<tr class="cl" data-open="${esc(x.s.sym)}"><td>${star(x.s.sym)}</td><td class="mu">${i+1}</td><td><b>${esc(x.s.sym)}</b> ${srcBadge(x.s.sym)}<div class="sub">${esc(x.s.name)}</div></td><td class="n">${fN(x.m.price)}</td>${cols.map(c=>{const v=c[2](x.m);return `<td class="n">${v==null||!isFinite(v)?'—':fN(v,Math.abs(v)>=1000?0:2)}</td>`}).join('')}<td>${vpill(x.m.verdict)}</td></tr>`).join('')}
 </tbody></table></div></div>
 <div class="card"><h3>Field reference</h3><div class="tw" style="max-height:260px"><table class="t"><thead><tr><th>Field</th><th>Also accepts</th><th>Unit</th></tr></thead><tbody>${FIELDS.map(f=>`<tr><td>${esc(f[0])}</td><td class="mu">${esc(f[1].join(', '))}</td><td class="mu">${esc(f[3])}</td></tr>`).join('')}</tbody></table></div></div>`;
}
