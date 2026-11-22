'use strict';
/* ============================== State ============================== */
const DEF_CFG={rf:6.5,disc:12,tg:5,aaa:7.5,atrK:2,rr:2,capital:500000,riskPct:1,
 ch:{brokDel:0,brokIntra:0.03,brokCap:20,sttDel:0.1,sttIntra:0.025,exch:0.00297,sebi:0.0001,stampDel:0.015,stampIntra:0.003,gst:18},
 tax:{stcg:20,ltcg:12.5,exempt:125000},
 w:{trend:20,mom:10,val:25,qual:20,growth:15,risk:10},
 lots:{'NIFTY 50':75,'NIFTY BANK':35,'NIFTY FIN SERVICE':65,'SENSEX':20}};
const S={uni:[],D:{},M:{},IDX:{},VIX:[],SEC:{},dates:[],cfg:Object.assign(JSON.parse(JSON.stringify(DEF_CFG)),LS.get('dq_cfg',{})),
 sel:'RELIANCE',tab:'markets',
 rk:{index:'ALL',sector:'ALL',mkt:'ALL',sort:'score',dir:-1,f:{},watch:false},
 an:{tf:252,agg:'D',ov:{sma50:true,sma200:true,bb:false,st:false,ema20:false},sub:'rsi',ftab:'quarterly'},
 watch:LS.get('dq_watch',[]),
 screens:LS.get('dq_screens',[]),
 holdings:LS.get('dq_hold',[]),
 paper:LS.get('dq_paper',{orders:[],pos:{},cash:1000000}),
 bridge:Object.assign({url:'http://127.0.0.1:8765',broker:'yahoo',token:'',ok:false},SS.get('dq_bridge',{}),{ok:false}),
 liveIdx:{},liveMode:false,tick:false,
};
['ch','tax','w','lots'].forEach(k=>{S.cfg[k]=Object.assign({},DEF_CFG[k],S.cfg[k]||{})});
function saveCfg(){LS.set('dq_cfg',S.cfg)}
