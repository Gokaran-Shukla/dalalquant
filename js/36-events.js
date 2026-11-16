'use strict';
/* ============================== Events ============================== */
function fillDatalist(){$('#symlist').innerHTML=S.uni.map(s=>`<option value="${esc(s.sym)}">${esc(s.name)}</option>`).join('')}
function recompute(){S._rm=null;S.inst.bl=null;computeAll();updateMode();render()}
document.addEventListener('click',e=>{const t=e.target;const tab=t.closest('[data-tab]');if(tab){e.preventDefault();go(tab.dataset.tab);return}
 const st=t.closest('[data-act="star"]');if(st){e.stopPropagation();const s=st.dataset.sym;S.watch=S.watch.includes(s)?S.watch.filter(x=>x!==s):[...S.watch,s];LS.set('dq_watch',S.watch);render();return}
 const op=t.closest('[data-open]');if(op&&!t.closest('input,select,button,a')){closeModal();openSym(op.dataset.open);return}
 const ix=t.closest('[data-idx]');if(ix){S.rk.index=ix.dataset.idx;S.rk.sector='ALL';go('rankings');return}
 const sc=t.closest('[data-sector]');if(sc){S.rk.sector=sc.dataset.sector;S.rk.index='ALL';go('rankings');return}
 const so=t.closest('th[data-sort]');if(so){const k=so.dataset.sort;if(S.rk.sort===k)S.rk.dir*=-1;else{S.rk.sort=k;S.rk.dir=['sym','sector','pe','vol','rsi'].includes(k)?1:-1}renderRankings();return}
 const ss=t.closest('th[data-ssort]');if(ss){const k=ss.dataset.ssort;if(S.scr.sort===k)S.scr.dir*=-1;else{S.scr.sort=k;S.scr.dir=-1}renderScreener();return}
 const pr=t.closest('[data-preset]');if(pr){S.scr.q=PRESETS[+pr.dataset.preset][1];runScreen();renderScreener();return}
 const sv=t.closest('[data-saved]');if(sv){S.scr.q=S.screens[+sv.dataset.saved].q;runScreen();renderScreener();return}
 const ds=t.closest('[data-delsaved]');if(ds){S.screens.splice(+ds.dataset.delsaved,1);LS.set('dq_screens',S.screens);renderScreener();return}
 const tf=t.closest('[data-tf]');if(tf){S.an.tf=+tf.dataset.tf;renderAnalyze();return}
 const ft=t.closest('[data-ftab]');if(ft){S.an.ftab=ft.dataset.ftab;$$('[data-ftab]').forEach(b=>b.classList.toggle('on',b===ft));renderFtab();return}
 const lg=t.closest('[data-leg]');if(lg){addLeg(S.op.mode,lg.dataset.leg,+lg.dataset.k);renderOptions();return}
 const om=t.closest('[data-opmode]');if(om){S.op.mode=om.dataset.opmode;renderOptions();return}
 const opp=t.closest('[data-optpreset]');if(opp){const O=S.op,ch=O.chain;O.legs=[];PRESET_OPT[opp.dataset.optpreset](ch.atm,ch.step).forEach(([sd,ty,K,lots])=>addLeg(sd,ty,K,lots||1));renderOptions();return}
 const dl=t.closest('[data-delleg]');if(dl){S.op.legs.splice(+dl.dataset.delleg,1);renderOptions();return}
 const dh=t.closest('[data-delhold]');if(dh){S.holdings.splice(+dh.dataset.delhold,1);saveHold();renderPortfolio();return}
 const dc=t.closest('[data-delcond]');if(dc){S.algo.conds.splice(+dc.dataset.delcond,1);saveAlgo();renderAlgo();return}
 const so2=t.closest('[data-sigorder]');if(so2){const sym=so2.dataset.sigorder,A=S.algo;const qty=A.sizing==='amt'?Math.floor(A.amt/S.M[sym].price):A.qty;placeOrder({sym,side:A.side,qty,type:'MARKET',product:A.product,sl:A.sl,tp:A.tp,strategy:A.name}).then(()=>renderAlgo());return}
 const cp=t.closest('[data-closepos]');if(cp){const k=cp.dataset.closepos,p=S.paper.pos[k];placeOrder({sym:k,side:p.qty>0?'SELL':'BUY',qty:Math.abs(p.qty),type:'MARKET',product:'MIS',strategy:'manual exit'}).then(()=>renderAlgo());return}
 const pr_=t.closest('[data-pair]');if(pr_){const [a,b]=pr_.dataset.pair.split('|');S.qp.pa=a;S.qp.pb=b;S.qp.pairRes=pairTest(a,b);renderQuantP();return}
 const pl=t.closest('[data-pool]');if(pl){S.cap.pool=pl.dataset.pool;renderCap();return}
 const eq=t.closest('[data-enq]');if(eq){S.enq.sym=eq.dataset.enq;S.enq.ans=null;S.enq.q='';renderEnquiry();return}
 const ep=t.closest('[data-enqprompt]');if(ep){S.enq.q=ep.dataset.enqprompt;const ta=$('#enqQ');if(ta)ta.value=S.enq.q;askAI();return}
 const ff=t.closest('[data-fofilter]');if(ff){S.foa.filter=ff.dataset.fofilter;renderFoa();return}
 const fa=t.closest('[data-fdadd]');if(fa){fdAdd(fa.dataset.fdadd,fa.dataset.fdname);return}
 const fdl=t.closest('[data-fddel]');if(fdl){S.fd.funds=S.fd.funds.filter(f=>f.code!==fdl.dataset.fddel);saveFunds();renderFunds();return}
 const jd=t.closest('[data-jdel]');if(jd){S.jr.entries.splice(+jd.dataset.jdel,1);saveJr();renderJournal();return}
 const gd=t.closest('[data-gdel]');if(gd){S.jr.goals.splice(+gd.dataset.gdel,1);saveJr();renderJournal();return}
 const aq=t.closest('[data-aiq]');if(aq){const i=$('#aiQ');if(i)i.value=aq.dataset.aiq;if(S.ai.docs.length)askDoc(aq.dataset.aiq);return}
 const ad=t.closest('[data-aidel]');if(ad){S.ai.docs.splice(+ad.dataset.aidel,1);renderAI();return}
 const ald=t.closest('[data-aldel]');if(ald){S.al.rules.splice(+ald.dataset.aldel,1);saveAl();renderAlerts();return}
 const bts=t.closest('[data-btsym]');if(bts){S.bt.sym=bts.dataset.btsym;runBT();renderBacktest();return}
 const a=t.closest('[data-act]');if(!a)return;const act=a.dataset.act;
 const acts={
  closeModal,
  rkReset(){S.rk.f={};S.rk.cap='ALL';S.rk.index='ALL';S.rk.sector='ALL';S.rk.watch=false;renderRankings()},
  rkCsv(){download('dalalquant_rankings.csv',rankCsv())},rkCopy(){copyText(rankCsv())},
  wReset(){S.cfg.w=Object.assign({},DEF_CFG.w);saveCfg();reScore();renderRankings()},
  scrRun(){S.scr.q=$('#scrQ').value;runScreen();renderScreener()},
  scrSave(){const q=$('#scrQ').value;$('#modalBox').innerHTML='<div class="h3">Save screen</div><input id="svName" style="width:100%" placeholder="Name"><div class="row" style="margin-top:10px;justify-content:flex-end"><button class="btn s" data-act="closeModal">Cancel</button><button class="btn" id="svOk">Save</button></div>';$('#modal').style.display='flex';$('#svOk').onclick=()=>{const n=$('#svName').value.trim()||('Screen '+(S.screens.length+1));S.screens.push({name:n,q});LS.set('dq_screens',S.screens);closeModal();renderScreener()}},
  scrCsv(){const cols=S.scr.cols.map(n=>FIELDS.find(f=>f[0]===n)).filter(Boolean);copyText(['Symbol,Name,LTP,'+cols.map(c=>c[0]).join(',')].concat((S.scr.res||[]).map(sym=>{const m=S.M[sym];return [sym,'"'+S.bySym[sym].name+'"',m.price.toFixed(2)].concat(cols.map(c=>{const v=c[2](m);return v==null||!isFinite(v)?'':v.toFixed(2)})).join(',')})).join('\n'))},
  toEnq(){S.enq.sym=S.sel;S.enq.ans=null;go('enquiry')},
  toBacktest(){S.bt.sym=S.sel;runBT();go('backtest')},
  toTicket(){S._tkSym=S.sel;go('algo');setTimeout(()=>{const tk=$('#ticket');tk&&tk.scrollIntoView({behavior:'smooth'})},50)},
  addHold(){go('portfolio');setTimeout(()=>{$('#hSym').value=S.sel;$('#hAvg').value=S.M[S.sel].price.toFixed(2);$('#hQty').focus()},30)},
  report(){const box=$('#reportBox');const txt=buildReport();box.style.display='block';box.innerHTML=`<h3>Report <span class="r"><button class="btn xs s" id="rpCopy">Copy</button> <button class="btn xs s" id="rpPrint">Print / PDF</button> <button class="btn xs s" id="rpDl">Download .txt</button></span></h3><pre class="code">${esc(txt)}</pre>`;$('#rpCopy').onclick=()=>copyText(txt);$('#rpPrint').onclick=()=>{try{window.print()}catch(e){toast('Printing is blocked in this preview — use the GitHub Pages copy')}};$('#rpDl').onclick=()=>download(S.sel+'_dalalquant.txt',txt,'text/plain');box.scrollIntoView({behavior:'smooth'})},
  ivReset(){S._ivov=null;const s=S.bySym[S.sel],m=S.M[S.sel];valuation(s,m,S.SEC[s.sector]);scoreIt(s,m,S.SEC[s.sector]);renderAnalyze()},
  btRun(){S.bt.sym=($('#btSym').value||S.bt.sym).toUpperCase().trim();S.bt.opt=null;runBT();renderBacktest()},
  btOpt(){S.bt.optMetric=$('#optMetric').value;if(!S.bt.bars)runBT();optRun();$('#optOut').innerHTML=optTable()},
  btBatch(){S.bt.bIdx=$('#bIdx').value;batchRun();$('#batchOut').innerHTML=batchTable()},
  bsCalc(){const O=S.op,ch=O.chain,type=$('#bsT').value,K=+$('#bsK').value,T=O.dte/365,r=O.r/100;const mp=+$('#bsP').value;const iv=mp>0?impliedVol(mp,ch.spot,K,T,r,type):O.iv/100;const b=bs(ch.spot,K,T,r,iv,type);$('#bsOut').innerHTML=`<div class="kv">${kv('Theoretical',fN(b.price))}${kv('IV used',fN(iv*100,2)+'%')}${kv('Delta',fN(b.delta,3))}${kv('Gamma',fN(b.gamma,5))}${kv('Theta/day',fN(b.theta,2))}${kv('Vega/1%',fN(b.vega,2))}${kv('Rho/1%',fN(b.rho,2))}${kv('Intrinsic',fN(type==='CE'?Math.max(0,ch.spot-K):Math.max(0,K-ch.spot)))}</div>`},
  legClear(){S.op.legs=[];renderOptions()},
  legOrder(){modal('<div class="h3">Option legs</div><pre class="code">'+esc(S.op.legs.map(L=>`${L.side==='B'?'BUY ':'SELL'} ${L.lots} lot(s) ${S.op.und} ${L.type==='FUT'?'FUT':fN(L.K,0)+' '+L.type} @ ${fN(L.prem)}`).join('\n'))+'</pre><div class="note">Multi-leg F&O orders are routed through the bridge (/order with exchange NFO). Paper F&O execution is not simulated — use the payoff view to plan, then place via your broker.</div>')},
  opLive:async()=>{try{const r=await bridgeFetch('/optionchain?underlying='+encodeURIComponent(S.op.und));S.op.live=Object.assign({sim:false},r);S.op.live.atm=S.op.live.atm||Math.round(r.spot/r.step)*r.step;toast('Live chain loaded');renderOptions()}catch(e){toast('Chain error: '+esc(e.message),5000)}},
  hAdd(){const sym=$('#hSym').value.trim().toUpperCase(),qty=+$('#hQty').value,avg=+$('#hAvg').value;if(!S.bySym[sym]||!(qty>0)||!(avg>0)){toast('Enter a valid symbol, qty and avg price');return}S.holdings.push({sym,qty,avg,date:$('#hDate').value});saveHold();renderPortfolio()},
  hSync:async()=>{try{const r=await bridgeFetch('/holdings');S.holdings=(r.holdings||[]).filter(h=>S.bySym[h.symbol]).map(h=>({sym:h.symbol,qty:+h.qty,avg:+h.avg_price,date:''}));saveHold();toast('Holdings synced: '+S.holdings.length);renderPortfolio()}catch(e){toast('Sync error: '+esc(e.message),5000)}},
  xirr(){const lines=$('#xirrIn').value.trim().split('\n');S.pf.xirr=$('#xirrIn').value;const fl=lines.map(l=>{const [d,v]=l.split(',');return [new Date(normDate(d)).getTime(),+v]}).filter(x=>isFinite(x[0])&&isFinite(x[1])).sort((a,b)=>a[0]-b[0]);const r=fl.length>1?xirr(fl):null;$('#xirrOut').innerHTML=r==null?'<span class="err">needs ≥1 negative and ≥1 positive flow</span>':fP(r,2)},
  brConnect(){S.bridge.url=$('#brUrl').value.trim();S.bridge.broker=$('#brBroker').value;S.bridge.token=$('#brTok').value;S.bridge.err=null;connectBridge()},
  liveHist(){loadLiveHistory(a.dataset.scope)},liveFund(){loadLiveFund(a.dataset.scope)},
  kill(){S.algo.risk.kill=!S.algo.risk.kill;if(S.algo.risk.kill){setAuto(false);alog('KILL SWITCH ON — all automated trading stopped')}saveAlgo();renderAlgo()},
  condAdd(){S.algo.conds.push({l:'rsi',lp:14,op:'<',rt:'num',r:30,rk:'sma',rp:50});saveAlgo();renderAlgo()},
  scan(){runScan()},
  newsRefresh(){loadNews()},
  enqGo(){const v=$('#enqSym').value.trim();const u=v.toUpperCase();const x=S.bySym[u]||S.uni.find(z=>z.name.toUpperCase().includes(u));if(!x){toast('Not in the universe — add it in Data & Settings');return}S.enq.sym=x.sym;S.enq.ans=null;S.enq.q='';renderEnquiry()},
  enqAsk(){askAI()},
  aiBrief(){aiBrief()},aiBriefCopy(){copyText(S.ai.brief.text)},
  aiBriefSend:async()=>{if(!S.bridge.ok){toast('Connect the bridge first');return}try{const r=await bridgeFetch('/notify',{method:'POST',body:JSON.stringify({title:'DalalQuant AI brief',text:S.ai.brief.text})});toast('Sent: '+esc(JSON.stringify(r.result)))}catch(e){toast(esc(e.message))}},
  aiAsk(){askDoc($('#aiQ').value.trim())},
  aiPaste(){$('#modalBox').innerHTML='<div class="h3">Paste document text</div><input id="apN" placeholder="Name (e.g. INFY Q2 FY27 concall)" style="width:100%;margin-bottom:6px"><textarea id="apT" rows="14"></textarea><div class="row" style="margin-top:10px;justify-content:flex-end"><button class="btn s" data-act="closeModal">Cancel</button><button class="btn" id="apOk">Add</button></div>';$('#modal').style.display='flex';$('#apOk').onclick=()=>{const t=$('#apT').value;if(t.trim())addText($('#apN').value.trim(),t);closeModal()}},
  jAdd(){const sym=$('#jSym').value.trim().toUpperCase();if(!sym||!+$('#jEn').value||!+$('#jQty').value){toast('Symbol, qty and entry are required');return}S.jr.entries.push({date:$('#jDate').value,sym,side:$('#jSide').value,qty:+$('#jQty').value,entry:+$('#jEn').value,stop:+$('#jSl').value||null,exit:+$('#jEx').value||null,setup:$('#jSetup').value,emo:$('#jEmo').value,plan:$('#jPlan').value,mist:$$('[data-jm]').filter(x=>x.checked).map(x=>x.dataset.jm),note:$('#jNote').value});saveJr();renderJournal()},
  jImport(){const {closed}=fifo(S.pnl.trades||[]);let n=0;closed.forEach(t=>{if(S.jr.entries.some(e=>e.sym===t.sym&&e.date===t.inDate&&e.entry===t.entry))return;S.jr.entries.push({date:t.inDate,sym:t.sym,side:t.long?'BUY':'SELL',qty:t.qty,entry:t.entry,stop:null,exit:t.exit,setup:'Other',emo:'Calm',plan:'Followed plan',mist:[],note:'imported from P&L ('+t.term+')'});n++});saveJr();toast(n+' trades imported — tag setups, emotions and mistakes to get insights');renderJournal()},
  gAdd(){S.jr.goals.push({name:'New goal',target:1000000,years:5,infl:6,corpus:0,sip:10000,ret:10,vol:14,step:0});saveJr();renderJournal()},
  fdSearch(){fdSearch($('#fdQ').value.trim())},
  fdRe(){S.fd.sipAmt=+$('#fdSip').value||10000;S.fd.sipYrs=Math.max(1,+$('#fdSipY').value||5);renderFunds()},
  ovRun(){S.fd.ovA=$('#ovA').value;S.fd.ovB=$('#ovB').value;renderFunds()},
  etfLoad(){etfLoad()},ipoLoad(){ipoLoad()},
  pyRun(){pyRun()},
  wfoRun(){S.res.folds=Math.max(2,Math.min(10,+$('#wfK').value||5));toast('Running walk-forward…');setTimeout(()=>{if(wfo())renderBacktest()},20)},
  mcRun(){if(mcTrades())renderBacktest()},
  portRun(){if(stratPortfolio())renderBacktest()},
  idLoad(){const I=S.id;const v=$('#idSym').value.trim().toUpperCase();if(!undBars(v)){toast('Unknown symbol');return}I.sym=v;I.iv=+$('#idIv').value;I.days=Math.max(1,Math.min(30,+$('#idDays').value||5));I.orb=Math.max(I.iv,+$('#idOrb').value||15);I.tape=[];streamTicks(false);loadIntraday()},
  idBT(){S.id.strat=$('#idStrat').value;S.id.rr=+$('#idRR').value||2;S.id.res=null;intradayBT();renderIntraday()},
  toIntra(){S.id.sym=S.sel;S.id.bars=null;go('intraday');loadIntraday()},
  foLoad(){toast('Loading NSE F&O data…');foLoad()},
  obRun(){const O=S.foa.bt;O.strat=$('#obS').value;O.width=+$('#obW').value||1;O.dte=Math.max(1,+$('#obD').value||5);O.sl=+$('#obSL').value||0;O.ivMult=+$('#obIV').value||1;O.lots=Math.max(1,+$('#obL').value||1);O.res=null;optionBT();renderFoa()},
  alAdd(){const sym=$('#alSym').value.trim().toUpperCase();if(!S.bySym[sym]){toast('Unknown symbol');return}const type=$('#alType').value;const v=$('#alVal')?$('#alVal').value:'';const t=ALERT_TYPES.find(x=>x[0]===type);if(t[2]===1&&v===''){toast('Enter a value');return}S.al.rules.push({id:Date.now().toString(36),sym,type,value:v,on:true});S._alSym=sym;saveAl();renderAlerts()},
  alAuto(){autoAlerts();renderAlerts();toast('Alerts created for holdings and watchlist')},
  alSync(){syncAlertsToBridge()},
  alTest:async()=>{if(!S.bridge.ok){toast('Connect the bridge first');return}try{const r=await bridgeFetch('/notify',{method:'POST',body:JSON.stringify({title:'DalalQuant test',text:'If you can read this, alerts are working.',channels:Object.keys(S.al.channels).filter(k=>S.al.channels[k])})});toast('Result: '+esc(JSON.stringify(r.result)),6000)}catch(e){toast(esc(e.message),6000)}},
  alBrief(){sendBrief()},
  nseSync(){nseSync()},
  inRun(){const I=S.inst;const v=$('#inSym').value.trim().toUpperCase();if(!S.M[v]||S.bySym[v].mkt!=='IN'){toast('Pick an Indian stock');return}I.sym=v;I.orderCr=+$('#inQ').value||10;I.aum=+$('#inAum').value||1000;I.days=Math.max(1,+$('#inDays').value||5);I.part=Math.max(1,+$('#inPart').value||15);I.lambda=+$('#inLam').value;I.pf=$('#inPf').value;renderInst()},
  toInst(){S.inst.sym=S.sel;go('inst')},
  plFetch(){S.pnl.from=$('#plFrom').value;S.pnl.to=$('#plTo').value;fetchBrokerPnl()},
  plSample(){sampleTrades();S.pnl.view='all';renderPnl()},
  plPaper(){S.pnl.trades=normTrades(S.paper.orders.filter(o=>o.status==='FILLED').map(o=>({symbol:o.sym,date:new Date(o.time).toISOString().slice(0,10),side:o.side,qty:o.qty,price:o.fill,segment:o.product==='MIS'?'INTRADAY':'EQ'})));S.pnl.src='Paper trades';savePnl();renderPnl()},
  plClear(){S.pnl.trades=[];S.pnl.src=null;savePnl();renderPnl()},
  qRun(){const v=$('#qSym').value.trim().toUpperCase();if(!S.bySym[v]){toast('Unknown symbol');return}S.q.sym=v;S.q.H=+$('#qH').value;S.q.res=null;renderQuant()},
  qpRun(){S.qp.uni=$('#qpUni').value;S.qp.look=+$('#qpLook').value;S.qp.res=null;S.qp.rot.res=null;optimise();renderQuantP()},
  pairRun(){const a=$('#pA').value.trim().toUpperCase(),b=$('#pB').value.trim().toUpperCase();if(!S.D[a]||!S.D[b]){toast('Unknown symbol');return}S.qp.pa=a;S.qp.pb=b;S.qp.pairRes=pairTest(a,b);renderQuantP()},
  pairScan(){toast('Scanning same-sector pairs…');setTimeout(()=>{scanPairs();renderQuantP()},30)},
  rotRun(){const O=S.qp.rot;O.factor=$('#roF').value;O.look=Math.max(21,+$('#roL').value||126);O.n=Math.max(1,+$('#roN').value||10);O.trend=$('#roT').checked;O.res=null;rotationBT();renderQuantP()},
  toQuant(){S.q.sym=S.sel;S.q.res=null;go('quant')},
  capRank(){S.rk.mkt='IN';S.rk.index='ALL';S.rk.sector='ALL';S.rk.f={};S.rk.cap=S.cap.pool;go('rankings')},
  enqCopy(){copyText(dossierText(S.enq.sym))},
  usRank(){S.rk.mkt='US';S.rk.index='ALL';go('rankings')},
  tkPlace(){const sym=$('#tkSym').value.trim().toUpperCase();if(!S.bySym[sym]){toast('Unknown symbol');return}const o={sym,side:$('#tkSide').value,qty:+$('#tkQty').value,type:$('#tkType').value,price:$('#tkPx').value,product:$('#tkProd').value,sl:+$('#tkSl').value,tp:+$('#tkTp').value,strategy:'manual'};S._tkSym=sym;
   const go_=()=>placeOrder(o).then(()=>renderAlgo());if(S.algo.live&&S.bridge.ok)askConfirm(`<div class="h3">Confirm LIVE order</div><div>${o.side} ${o.qty} × ${esc(sym)} ${o.type}${o.type==='LIMIT'?' @ '+esc(o.price):''} (${o.product}) via ${esc(S.bridge.broker)}</div>`,go_);else go_()},
  paperReset(){askConfirm('<div class="h3">Reset paper account?</div><div>Clears paper orders and positions.</div>',()=>{S.paper={orders:[],pos:{},cash:1000000};savePaper();renderAlgo()})},
  fundTpl(){copyText('Symbol,Period,Revenue,EBITDA,NetProfit,FCF,EPS,Shares,Debt,Cash,Equity,Promoter,FII,DII\nINFY,Q1 FY26,42279,10500,6921,6000,16.7,415,0,25000,90000,14.6,32,38\nINFY,Q2 FY26,44490,11200,7364,6500,17.7,,,,,,,')},
  resetDemo(){askConfirm('<div class="h3">Reset to demo data?</div><div>Replaces imported and live data with simulated data.</div>',()=>{S.dates=genDates(756);S.uni.forEach(s=>S.D[s.sym]=genSim(s));recompute();toast('Demo data restored')})},
  uniAdd(){const lines=$('#uniAdd').value.trim().split('\n').filter(Boolean);const extra=LS.get('dq_uni_extra',[]);let n=0;lines.forEach(l=>{const [sym,name,sector,codes='']=l.split('|').map(x=>(x||'').trim());if(!sym||S.bySym[sym.toUpperCase()])return;const s={sym:sym.toUpperCase(),name:name||sym,sector:sector||'Other',codes};extra.push(s);addSymbol(s);n++});LS.set('dq_uni_extra',extra);recompute();toast(n+' symbol(s) added (simulated until you import/load data)')},
  uniClear(){LS.set('dq_uni_extra',[]);location.reload()},
  cfgSave(){$$('[data-cfg]').forEach(i=>S.cfg[i.dataset.cfg]=+i.value);$$('[data-ch]').forEach(i=>S.cfg.ch[i.dataset.ch]=+i.value);$$('[data-tx]').forEach(i=>S.cfg.tax[i.dataset.tx]=+i.value);$$('[data-lot]').forEach(i=>S.cfg.lots[i.dataset.lot]=+i.value);saveCfg();recompute();toast('Settings saved')},
  cfgReset(){S.cfg=JSON.parse(JSON.stringify(DEF_CFG));saveCfg();recompute()},
 };
 if(acts[act])acts[act]();
});
document.addEventListener('change',e=>{const t=e.target;
 if(t.id==='rkMkt'){S.rk.mkt=t.value;renderRankings()}else if(t.id==='rkCap'){S.rk.cap=t.value;renderRankings()}else if(t.id==='rkIdx'){S.rk.index=t.value;renderRankings()}else if(t.id==='rkSec'){S.rk.sector=t.value;renderRankings()}else if(t.id==='rkWatch'){S.rk.watch=t.checked;renderRankings()}
 else if(t.dataset.rkf){S.rk.f[t.dataset.rkf]=t.type==='checkbox'?t.checked:t.value;renderRankings()}
 else if(t.dataset.w){S.cfg.w[t.dataset.w]=+t.value;saveCfg();reScore();renderRankings()}
 else if(t.dataset.col){const n=t.dataset.col;S.scr.cols=t.checked?[...S.scr.cols,n]:S.scr.cols.filter(x=>x!==n);renderScreener()}
 else if(t.dataset.ov){S.an.ov[t.dataset.ov]=t.checked;drawAnChart()}else if(t.id==='anSub'){S.an.sub=t.value;drawAnChart()}
 else if(t.dataset.iv){S._ivov=Object.assign({},S._ivov||{},{[t.dataset.iv]:+t.value});const s=S.bySym[S.sel],m=S.M[S.sel];valuation(s,m,S.SEC[s.sector],S._ivov);scoreIt(s,m,S.SEC[s.sector]);renderAnalyze()}
 else if(t.id==='btKey'){S.bt.key=t.value;S.bt.P={};S.bt.opt=null;S.bt.batch=null;runBT();renderBacktest()}
 else if(t.dataset.btp){S.bt.P[t.dataset.btp]=+t.value}else if(t.dataset.bt){const k=t.dataset.bt;S.bt[k]=t.type==='checkbox'?t.checked:+t.value}
 else if(t.id==='opUnd'){S.op.und=t.value;S.op.lot=null;S.op.step=null;S.op.legs=[];S.op.live=null;const m=S.M[t.value];if(m&&m.vol)S.op.iv=+(m.vol*100).toFixed(1);else if(t.value==='NIFTY BANK')S.op.iv=15;else S.op.iv=13;renderOptions()}
 else if(t.dataset.op){S.op[t.dataset.op]=+t.value||null;if(t.dataset.op==='dte')S.op.dte=+t.value;S.op.live=null;const keep=S.op.legs;renderOptions();S.op.legs=keep}
 else if(t.dataset.legI!=null){const L=S.op.legs[+t.dataset.legI];const f=t.dataset.legF;L[f]=(f==='side'||f==='type')?t.value:+t.value;renderOptions()}
 else if(t.dataset.sip){S.pf.sip[t.dataset.sip]=+t.value;renderPortfolio()}else if(t.dataset.tax){S.pf.tax[t.dataset.tax]=t.type==='date'?t.value:+t.value;renderPortfolio()}
 else if(t.dataset.risk){S.algo.risk[t.dataset.risk]=+t.value;saveAlgo()}
 else if(t.dataset.al){const k=t.dataset.al;S.algo[k]=t.type==='number'?+t.value:t.value;saveAlgo();if(k==='sizing')renderAlgo()}
 else if(t.dataset.cond!=null){const c=S.algo.conds[+t.dataset.cond],f=t.dataset.cf;c[f]=['lp','rp','r'].includes(f)?+t.value:t.value;saveAlgo();if(['l','rt','rk'].includes(f))renderAlgo()}
 else if(t.id==='autoRun'){S.algo.every=+$('#autoEvery').value||60;if(t.checked&&S.algo.live&&S.bridge.ok){t.checked=false;askConfirm('<div class="h3">Start LIVE auto-trading?</div><div>Matching signals will be sent to your broker as real orders, within your risk limits.</div>',()=>{setAuto(true);renderAlgo()})}else{setAuto(t.checked);renderAlgo()}}
 else if(t.id==='liveTrade'){if(t.checked){t.checked=false;askConfirm('<div class="h3">Enable LIVE trading?</div><div>Orders from the ticket and the strategy engine will go to your broker account through the bridge. Paper trading first is strongly recommended.</div>',()=>{S.algo.live=true;alog('LIVE trading enabled');renderAlgo()})}else{S.algo.live=false;alog('LIVE trading disabled → paper');renderAlgo()}}
 else if(t.id==='liveQ'){setLiveQuotes(t.checked,+$('#liveQs').value||5)}
 else if(t.id==='simTick'){S.tick=t.checked}
 else if(t.id==='aiPdf'){[...t.files].forEach(f=>addPdf(f))}
 else if(t.dataset.gl!=null){const g=S.jr.goals[+t.dataset.gl];g[t.dataset.gf]=t.dataset.gf==='name'?t.value:+t.value;saveJr();renderJournal()}
 else if(t.dataset.rbt){S.jr.targets[t.dataset.rbt]=+t.value;saveJr();renderJournal()}else if(t.dataset.rbo){S.jr.other[t.dataset.rbo]=+t.value;saveJr();renderJournal()}else if(t.id==='rbBand'){S.jr.band=+t.value;saveJr();renderJournal()}
 else if(t.dataset.bond){S.fd.bond[t.dataset.bond]=+t.value;renderFunds()}else if(t.dataset.sgb){S.fd.sgb[t.dataset.sgb]=+t.value;renderFunds()}
 else if(t.dataset.pst){const k=t.dataset.pst;S.res.portSel=t.checked?[...S.res.portSel,k]:S.res.portSel.filter(x=>x!==k)}
 else if(t.id==='idStream'){streamTicks(t.checked);renderIntraday()}
 else if(t.id==='foUnd'){S.foa.und=t.value;S.foa.bt.res=null;renderFoa();foLoad()}
 else if(t.id==='alType'){S._alType=t.value;S._alSym=$('#alSym').value;renderAlerts()}
 else if(t.dataset.alon!=null){S.al.rules[+t.dataset.alon].on=t.checked;saveAl()}
 else if(t.dataset.alch){S.al.channels[t.dataset.alch]=t.checked;saveAl()}
 else if(t.id==='alBrowser'){S.al.browser=t.checked;saveAl();if(t.checked&&'Notification' in window){try{Notification.requestPermission()}catch(e){}}}
 else if(t.id==='plFile'){const f=t.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{toast(importTradebook(r.result));S.pnl.view='all';renderPnl()};r.readAsText(f)}
 else if(t.id==='plFrom'||t.id==='plTo'){S.pnl[t.id==='plFrom'?'from':'to']=t.value;S.pnl.view='range';renderPnl()}
 else if(t.id==='nfTag'){S.newsF.tag=t.value;renderNews()}else if(t.id==='nfImp'){S.newsF.imp=t.value;renderNews()}else if(t.id==='nfQ'){S.newsF.q=t.value;renderNews()}
 else if(t.id==='fPx'){const fs=[...t.files];let msgs=[];let left=fs.length;fs.forEach(f=>{const r=new FileReader();r.onload=()=>{msgs.push(f.name+': '+importPrices(f.name,r.result));if(--left===0){computeAll();updateMode();$('#impMsg').textContent=msgs.join(' · ');fillDatalist()}};r.readAsText(f)})}
 else if(t.id==='fFund'){const f=t.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{const msg=importFund(r.result);computeAll();updateMode();$('#impMsg').textContent=msg};r.readAsText(f)}
});
$('#search').addEventListener('change',e=>{const v=e.target.value.trim().toUpperCase();const s=S.bySym[v]||S.uni.find(x=>x.name.toUpperCase().includes(v));if(s){openSym(s.sym);e.target.value=''}});
$('#enqQ')&&0;$('#search').addEventListener('keydown',e=>{if(e.key==='Enter'){e.target.dispatchEvent(new Event('change'))}});
$('#modal').addEventListener('click',e=>{if(e.target.id==='modal')closeModal()});
let rsT;window.addEventListener('resize',()=>{clearTimeout(rsT);rsT=setTimeout(()=>render(),150)});
window.addEventListener('hashchange',()=>{const h=location.hash.slice(1);if(h&&h!==S.tab)go(h,false)});
setInterval(()=>{if(!S.tick)return;Object.values(S.D).forEach(d=>{if(d.src.px!=='sim')return;const b=d.bars[d.bars.length-1];const R=Math.random;b.c=r2(b.c*(1+(R()+R()+R()-1.5)*0.004));b.h=Math.max(b.h,b.c);b.l=Math.min(b.l,b.c)});computeAll();checkPaper();if(['markets','rankings','algo','portfolio'].includes(S.tab))render()},3000);
