'use strict';
/* ============================== Boot ============================== */
function showOpportunities(){const list=oppList(6);if(!list.length)return;
 modal(`<div class="h3" style="color:#4ade80;font-size:13px">▲ ${list.length} opportunit${list.length>1?'ies':'y'} flagged today — strong businesses trading well below their highs</div>
 <div class="sub" style="margin-bottom:10px">Quality ≥ 60, growth ≥ 50, profitable, ≥15% off the 52-week high (or −8% in 3 months) and below intrinsic value. ${dataMode().sim?'<b class="wa">Demo mode: based on simulated data.</b>':''}</div>${oppCards(list)}
 <div class="note">Click a card to open the company. A fall can reflect real problems — read the results and filings before acting. Not investment advice.</div>`)}
function boot(){buildNav();initUniverse();S.dates=genDates(756);S.uni.forEach(s=>{S.D[s.sym]=genSim(s)});genGlobal();fillDatalist();computeAll();updateMode();buildTape();clock();setInterval(clock,20000);
 const h=location.hash.slice(1);go(TABS.find(t=>t[0]===h)?h:'home',false);
 if(!SS.get('dq_opp_seen',false)){SS.set('dq_opp_seen',true);setTimeout(showOpportunities,350)}
 if(S.bridge.url&&SS.get('dq_bridge',null)&&SS.get('dq_bridge',{}).token!==undefined){/* user reconnects manually */}}
boot();
