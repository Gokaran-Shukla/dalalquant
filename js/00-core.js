'use strict';
/* ==========================================================================
   DalalQuant — single-file Indian markets terminal
   Data sources (per symbol, shown as badges): SIM (simulated demo), CSV (imported), LIVE (broker bridge)
   ========================================================================== */
const EXTRA_ACTS={},EXTRA_CHANGE=[],EXTRA_CLICK=[],RENDERERS={},AFTER_COMPUTE=[];
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const clamp=(x,a=0,b=100)=>Math.max(a,Math.min(b,x));
const r2=x=>Math.round(x*100)/100;
const last=a=>{for(let i=a.length-1;i>=0;i--) if(a[i]!=null) return a[i]; return null};
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
const std=a=>{if(a.length<2)return null;const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)*(x-m),0)/(a.length-1))};
const median=a=>{const b=a.filter(x=>x!=null&&isFinite(x)).sort((x,y)=>x-y);if(!b.length)return null;const k=b.length>>1;return b.length%2?b[k]:(b[k-1]+b[k])/2};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const LS={get(k,d){try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v)}catch(e){return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}};
const SS={get(k,d){try{const v=sessionStorage.getItem(k);return v==null?d:JSON.parse(v)}catch(e){return d}},set(k,v){try{sessionStorage.setItem(k,JSON.stringify(v))}catch(e){}}};
function hash(s){let h=2166136261>>>0;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}
function rng(seed){let a=seed>>>0;return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function gauss(R){let u=0,v=0;while(u===0)u=R();while(v===0)v=R();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v)}
function fN(x,d=2){if(x==null||!isFinite(x))return '—';return Number(x).toLocaleString('en-IN',{minimumFractionDigits:d,maximumFractionDigits:d})}
function fCr(x){if(x==null||!isFinite(x))return '—';if(Math.abs(x)>=1e5)return '₹'+fN(x/1e5,2)+' L Cr';return '₹'+fN(x,0)+' Cr'}
function CUR(sym){const s=S.bySym&&S.bySym[sym];return s&&s.mkt==='US'?'$':'₹'}
function fMoney(x,sym){if(x==null||!isFinite(x))return '—';const s=S.bySym&&S.bySym[sym];if(s&&s.mkt==='US')return Math.abs(x)>=1e6?'$'+fN(x/1e6,2)+' T':Math.abs(x)>=1000?'$'+fN(x/1000,1)+' B':'$'+fN(x,0)+' M';return fCr(x)}
function fP(x,d=1){if(x==null||!isFinite(x))return '<span class="mu">—</span>';return `<span class="${x>=0?'up':'dn'}">${x>=0?'+':''}${(x*100).toFixed(d)}%</span>`}
function fPp(x,d=1){if(x==null||!isFinite(x))return '—';return (x*100).toFixed(d)+'%'}
function fPt(x,d=1){if(x==null||!isFinite(x))return '—';return (x>=0?'+':'')+(x*100).toFixed(d)+'%'}
function toast(msg,ms=2600){const t=$('#toast');t.innerHTML=msg;t.style.display='block';clearTimeout(t._h);t._h=setTimeout(()=>t.style.display='none',ms)}
function modal(html){$('#modalBox').innerHTML=html+'<div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn s" data-act="closeModal">Close</button></div>';$('#modal').style.display='flex'}
function closeModal(){$('#modal').style.display='none'}
function askConfirm(html,onYes){$('#modalBox').innerHTML=html+'<div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn s" data-act="closeModal">Cancel</button><button class="btn r" id="cfYes">Confirm</button></div>';$('#modal').style.display='flex';$('#cfYes').onclick=()=>{closeModal();onYes()}}
async function copyText(text){try{await navigator.clipboard.writeText(text);toast('Copied to clipboard')}catch(e){modal('<div class="h3">Copy manually</div><textarea rows="14" readonly>'+esc(text)+'</textarea>')}}
function download(name,text,type='text/csv'){try{const b=new Blob([text],{type});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=name;document.body.appendChild(a);a.click();a.remove();toast('Download started — if nothing happened, use Copy')}catch(e){copyText(text)}}

/* ===================== Universe (index constituents) =====================
   codes: 5=NIFTY 50, S=SENSEX, B=NIFTY BANK, N=NIFTY NEXT 50, I=NIFTY IT, M=NIFTY MIDCAP (select)
   Constituent lists change at NSE/BSE semi-annual reviews — verify and edit in Data & Settings. */
const UNI_RAW=`ADANIENT|Adani Enterprises|Infra|5
ADANIPORTS|Adani Ports & SEZ|Infra|5S
APOLLOHOSP|Apollo Hospitals|Healthcare|5
ASIANPAINT|Asian Paints|Consumer|5S
AXISBANK|Axis Bank|Banks|5SB
BAJAJ-AUTO|Bajaj Auto|Auto|5
BAJFINANCE|Bajaj Finance|Financials|5S
BAJAJFINSV|Bajaj Finserv|Financials|5S
BEL|Bharat Electronics|Defence|5S
BHARTIARTL|Bharti Airtel|Telecom|5S
CIPLA|Cipla|Pharma|5
COALINDIA|Coal India|Energy|5
DRREDDY|Dr. Reddy's Labs|Pharma|5
EICHERMOT|Eicher Motors|Auto|5
ETERNAL|Eternal (Zomato)|Consumer|5S
GRASIM|Grasim Industries|Cement|5
HCLTECH|HCL Technologies|IT|5SI
HDFCBANK|HDFC Bank|Banks|5SB
HDFCLIFE|HDFC Life Insurance|Insurance|5
HINDALCO|Hindalco Industries|Metals|5
HINDUNILVR|Hindustan Unilever|FMCG|5S
ICICIBANK|ICICI Bank|Banks|5SB
INDIGO|InterGlobe Aviation|Services|5
INFY|Infosys|IT|5SI
ITC|ITC|FMCG|5S
JIOFIN|Jio Financial Services|Financials|5
JSWSTEEL|JSW Steel|Metals|5
KOTAKBANK|Kotak Mahindra Bank|Banks|5SB
LT|Larsen & Toubro|Infra|5S
M&M|Mahindra & Mahindra|Auto|5S
MARUTI|Maruti Suzuki|Auto|5S
MAXHEALTH|Max Healthcare|Healthcare|5
NESTLEIND|Nestle India|FMCG|5
NTPC|NTPC|Power|5S
ONGC|ONGC|Energy|5
POWERGRID|Power Grid Corp|Power|5S
RELIANCE|Reliance Industries|Energy|5S
SBILIFE|SBI Life Insurance|Insurance|5
SBIN|State Bank of India|Banks|5SB
SHRIRAMFIN|Shriram Finance|Financials|5
SUNPHARMA|Sun Pharmaceutical|Pharma|5S
TATACONSUM|Tata Consumer Products|FMCG|5
TMPV|Tata Motors (PV)|Auto|5S
TATASTEEL|Tata Steel|Metals|5S
TCS|Tata Consultancy Services|IT|5SI
TECHM|Tech Mahindra|IT|5SI
TITAN|Titan Company|Consumer|5S
TRENT|Trent|Consumer|5S
ULTRACEMCO|UltraTech Cement|Cement|5S
WIPRO|Wipro|IT|5I
ABB|ABB India|CapGoods|N
ADANIENSOL|Adani Energy Solutions|Power|N
ADANIGREEN|Adani Green Energy|Power|N
ADANIPOWER|Adani Power|Power|N
AMBUJACEM|Ambuja Cements|Cement|N
BAJAJHLDNG|Bajaj Holdings|Financials|N
BANKBARODA|Bank of Baroda|Banks|NB
BPCL|Bharat Petroleum|Energy|N
BOSCHLTD|Bosch|Auto|N
BRITANNIA|Britannia Industries|FMCG|N
CANBK|Canara Bank|Banks|NB
CGPOWER|CG Power|CapGoods|N
CHOLAFIN|Cholamandalam Investment|Financials|N
DIVISLAB|Divi's Laboratories|Pharma|N
DLF|DLF|Realty|N
DMART|Avenue Supermarts|Consumer|N
GAIL|GAIL (India)|Energy|N
GODREJCP|Godrej Consumer|FMCG|N
HAL|Hindustan Aeronautics|Defence|N
HAVELLS|Havells India|CapGoods|N
HEROMOTOCO|Hero MotoCorp|Auto|N
HINDZINC|Hindustan Zinc|Metals|N
HYUNDAI|Hyundai Motor India|Auto|N
ICICIGI|ICICI Lombard|Insurance|N
INDHOTEL|Indian Hotels|Services|N
INDUSINDBK|IndusInd Bank|Banks|NB
IOC|Indian Oil Corp|Energy|N
IRFC|Indian Railway Finance|Financials|N
JINDALSTEL|Jindal Steel|Metals|N
JSWENERGY|JSW Energy|Power|N
LICI|Life Insurance Corp|Insurance|N
LODHA|Lodha Developers|Realty|N
LTIM|LTIMindtree|IT|NI
MOTHERSON|Samvardhana Motherson|Auto|N
NAUKRI|Info Edge|Services|N
PFC|Power Finance Corp|Financials|N
PIDILITIND|Pidilite Industries|Chemicals|N
PNB|Punjab National Bank|Banks|NB
RECLTD|REC|Financials|N
SHREECEM|Shree Cement|Cement|N
SIEMENS|Siemens|CapGoods|N
SOLARINDS|Solar Industries|Defence|N
TATAPOWER|Tata Power|Power|N
TORNTPHARM|Torrent Pharma|Pharma|N
TVSMOTOR|TVS Motor|Auto|N
UNITDSPR|United Spirits|FMCG|N
VBL|Varun Beverages|FMCG|N
VEDL|Vedanta|Metals|N
ZYDUSLIFE|Zydus Lifesciences|Pharma|N
AUBANK|AU Small Finance Bank|Banks|MB
FEDERALBNK|Federal Bank|Banks|MB
IDFCFIRSTB|IDFC First Bank|Banks|MB
PERSISTENT|Persistent Systems|IT|MI
COFORGE|Coforge|IT|MI
MPHASIS|Mphasis|IT|MI
OFSS|Oracle Financial Services|IT|MI
KPITTECH|KPIT Technologies|IT|M
TATAELXSI|Tata Elxsi|IT|M
POLYCAB|Polycab India|CapGoods|M
DIXON|Dixon Technologies|CapGoods|M
CUMMINSIND|Cummins India|CapGoods|M
BHEL|BHEL|CapGoods|M
ASHOKLEY|Ashok Leyland|Auto|M
BHARATFORG|Bharat Forge|Auto|M
MRF|MRF|Auto|M
LUPIN|Lupin|Pharma|M
AUROPHARMA|Aurobindo Pharma|Pharma|M
ALKEM|Alkem Laboratories|Pharma|M
SRF|SRF|Chemicals|M
PIIND|PI Industries|Chemicals|M
SAIL|Steel Authority of India|Metals|M
NMDC|NMDC|Metals|M
NHPC|NHPC|Power|M
PETRONET|Petronet LNG|Energy|M
GODREJPROP|Godrej Properties|Realty|M
OBEROIRLTY|Oberoi Realty|Realty|M
PRESTIGE|Prestige Estates|Realty|M
PHOENIXLTD|Phoenix Mills|Realty|M
INDUSTOWER|Indus Towers|Telecom|M
MUTHOOTFIN|Muthoot Finance|Financials|M
VOLTAS|Voltas|Consumer|M
PAGEIND|Page Industries|Consumer|M
ASTRAL|Astral|CapGoods|M
CONCOR|Container Corp of India|Services|M
KAYNES|Kaynes Technology|CapGoods|X
AMBER|Amber Enterprises|CapGoods|X
DATAPATTNS|Data Patterns|Defence|X
GRSE|Garden Reach Shipbuilders|Defence|X
BEML|BEML|Defence|X
COCHINSHIP|Cochin Shipyard|Defence|X
KEC|KEC International|Infra|X
KPIL|Kalpataru Projects|Infra|X
IRCON|IRCON International|Infra|X
NBCC|NBCC (India)|Infra|X
ENGINERSIN|Engineers India|Infra|X
ELECON|Elecon Engineering|CapGoods|X
TRITURBINE|Triveni Turbine|CapGoods|X
CESC|CESC|Power|X
HUDCO|HUDCO|Financials|X
MANAPPURAM|Manappuram Finance|Financials|X
CREDITACC|CreditAccess Grameen|Financials|X
ANGELONE|Angel One|Financials|X
CDSL|CDSL|Financials|X
CAMS|Computer Age Mgmt Services|Financials|X
PNBHOUSING|PNB Housing Finance|Financials|X
RBLBANK|RBL Bank|Banks|X
KARURVYSYA|Karur Vysya Bank|Banks|X
CUB|City Union Bank|Banks|X
CYIENT|Cyient|IT|X
BIRLASOFT|Birlasoft|IT|X
SONATSOFTW|Sonata Software|IT|X
ZENSARTECH|Zensar Technologies|IT|X
NATCOPHARM|Natco Pharma|Pharma|X
GRANULES|Granules India|Pharma|X
JBCHEPHARM|JB Chemicals & Pharma|Pharma|X
NH|Narayana Hrudayalaya|Healthcare|X
METROPOLIS|Metropolis Healthcare|Healthcare|X
CHAMBLFERT|Chambal Fertilisers|Chemicals|X
DEEPAKFERT|Deepak Fertilisers|Chemicals|X
RADICO|Radico Khaitan|FMCG|X
CROMPTON|Crompton Greaves Consumer|Consumer|X
BLUESTARCO|Blue Star|Consumer|X
CENTURYPLY|Century Plyboards|Consumer|X
KPRMILL|KPR Mill|Consumer|X
AAPL|Apple|US Tech|UQ
MSFT|Microsoft|US Tech|UQ
NVDA|NVIDIA|US Tech|UQ
AMZN|Amazon|US Consumer|UQ
GOOGL|Alphabet|US Comm|UQ
META|Meta Platforms|US Comm|UQ
AVGO|Broadcom|US Tech|UQ
TSLA|Tesla|US Consumer|UQ
BRK.B|Berkshire Hathaway|US Financials|U
JPM|JPMorgan Chase|US Financials|U
LLY|Eli Lilly|US Healthcare|U
V|Visa|US Financials|U
UNH|UnitedHealth|US Healthcare|U
XOM|Exxon Mobil|US Energy|U
MA|Mastercard|US Financials|U
COST|Costco|US Staples|UQ
WMT|Walmart|US Staples|U
JNJ|Johnson & Johnson|US Healthcare|U
PG|Procter & Gamble|US Staples|U
HD|Home Depot|US Consumer|U
NFLX|Netflix|US Comm|UQ
ORCL|Oracle|US Tech|U
BAC|Bank of America|US Financials|U
ABBV|AbbVie|US Healthcare|U
KO|Coca-Cola|US Staples|U
CVX|Chevron|US Energy|U
MRK|Merck|US Healthcare|U
AMD|Advanced Micro Devices|US Tech|UQ
PEP|PepsiCo|US Staples|UQ
ADBE|Adobe|US Tech|UQ
CRM|Salesforce|US Tech|U
CSCO|Cisco|US Tech|UQ
TMO|Thermo Fisher|US Healthcare|U
MCD|McDonald's|US Consumer|U
INTC|Intel|US Tech|UQ
QCOM|Qualcomm|US Tech|UQ
GS|Goldman Sachs|US Financials|U
CAT|Caterpillar|US Industrials|U
IBM|IBM|US Tech|U
PLTR|Palantir|US Tech|UQ`;
const FIN=new Set(['Banks','Financials','Insurance','US Financials']);
const has=(s,c)=>s.codes.includes(c);
const INDEX_DEFS=[
 {id:'NIFTY 50',base:24500,f:s=>has(s,'5')},
 {id:'SENSEX',base:80800,f:s=>has(s,'S')},
 {id:'NIFTY BANK',base:52000,f:s=>has(s,'B')},
 {id:'NIFTY NEXT 50',base:66000,f:s=>has(s,'N')},
 {id:'NIFTY 100',base:25300,f:s=>has(s,'5')||has(s,'N')},
 {id:'NIFTY IT',base:37000,f:s=>has(s,'I')},
 {id:'NIFTY FIN SERVICE',base:24000,f:s=>FIN.has(s.sector)&&(has(s,'5')||has(s,'N'))},
 {id:'NIFTY AUTO',base:23000,f:s=>s.sector==='Auto'},
 {id:'NIFTY PHARMA',base:22000,f:s=>s.sector==='Pharma'},
 {id:'NIFTY HEALTHCARE',base:14000,f:s=>s.sector==='Pharma'||s.sector==='Healthcare'},
 {id:'NIFTY FMCG',base:56000,f:s=>s.sector==='FMCG'},
 {id:'NIFTY METAL',base:9000,f:s=>s.sector==='Metals'},
 {id:'NIFTY ENERGY',base:35000,f:s=>s.sector==='Energy'||s.sector==='Power'},
 {id:'NIFTY REALTY',base:900,f:s=>s.sector==='Realty'},
 {id:'NIFTY MIDCAP (select)',base:57000,f:s=>has(s,'M')},
 {id:'NIFTY SMALLCAP (select)',base:17000,f:s=>has(s,'X')},
 {id:'S&P 500 (leaders)',base:6000,us:1,f:s=>has(s,'U')},
 {id:'NASDAQ 100 (leaders)',base:21000,us:1,f:s=>has(s,'Q')},
];
