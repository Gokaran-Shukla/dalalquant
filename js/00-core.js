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
MAZDOCK|Mazagon Dock Shipbuilders|Defence|M
BDL|Bharat Dynamics|Defence|M
MIDHANI|Mishra Dhatu Nigam|Defence|X
IREDA|Indian Renewable Energy Dev Agency|Financials|M
RVNL|Rail Vikas Nigam|Infra|M
IRCTC|IRCTC|Services|M
RAILTEL|RailTel Corporation|Telecom|X
RITES|RITES|Infra|X
PAYTM|One 97 Communications (Paytm)|Financials|M
NYKAA|FSN E-Commerce (Nykaa)|Consumer|M
POLICYBZR|PB Fintech (PolicyBazaar)|Financials|M
SWIGGY|Swiggy|Services|M
OLAELEC|Ola Electric Mobility|Auto|X
SUZLON|Suzlon Energy|Power|M
INOXWIND|Inox Wind|Power|X
WAAREEENER|Waaree Energies|Power|M
PREMIERENE|Premier Energies|Power|X
SJVN|SJVN|Power|M
NLCINDIA|NLC India|Power|X
TORNTPOWER|Torrent Power|Power|M
YESBANK|Yes Bank|Banks|M
IDEA|Vodafone Idea|Telecom|M
TATACOMM|Tata Communications|Telecom|M
HFCL|HFCL|Telecom|X
TEJASNET|Tejas Networks|Telecom|X
ITI|ITI|Telecom|X
BSE|BSE Ltd|Financials|M
MCX|Multi Commodity Exchange|Financials|M
HDFCAMC|HDFC AMC|Financials|M
NUVAMA|Nuvama Wealth|Financials|X
ANANDRATHI|Anand Rathi Wealth|Financials|X
ABCAPITAL|Aditya Birla Capital|Financials|M
LICHSGFIN|LIC Housing Finance|Financials|M
BAJAJHFL|Bajaj Housing Finance|Financials|M
SBICARD|SBI Cards|Financials|M
M&MFIN|Mahindra & Mahindra Financial|Financials|M
LTF|L&T Finance|Financials|M
POONAWALLA|Poonawalla Fincorp|Financials|X
PIRAMALENT|Piramal Enterprises|Financials|X
IOB|Indian Overseas Bank|Banks|M
UCOBANK|UCO Bank|Banks|X
CENTRALBK|Central Bank of India|Banks|X
BANDHANBNK|Bandhan Bank|Banks|M
ICICIPRULI|ICICI Prudential Life|Insurance|M
MFSL|Max Financial Services|Insurance|M
STARHEALTH|Star Health Insurance|Insurance|M
NIACL|New India Assurance|Insurance|X
GICRE|GIC Re|Insurance|X
TATACHEM|Tata Chemicals|Chemicals|M
NAVINFLUOR|Navin Fluorine|Chemicals|X
AARTIIND|Aarti Industries|Chemicals|X
ATUL|Atul|Chemicals|X
UPL|UPL|Chemicals|M
COROMANDEL|Coromandel International|Chemicals|M
HINDCOPPER|Hindustan Copper|Metals|M
NATIONALUM|National Aluminium|Metals|M
MOIL|MOIL|Metals|X
APLAPOLLO|APL Apollo Tubes|Metals|M
JSWINFRA|JSW Infrastructure|Infra|M
GMRAIRPORT|GMR Airports|Infra|M
IRB|IRB Infrastructure|Infra|X
NCC|NCC|Infra|X
SUPREMEIND|Supreme Industries|CapGoods|M
KEI|KEI Industries|CapGoods|M
HONAUT|Honeywell Automation|CapGoods|M
3MINDIA|3M India|CapGoods|X
AIAENG|AIA Engineering|CapGoods|M
THERMAX|Thermax|CapGoods|M
SCHAEFFLER|Schaeffler India|Auto|M
TIMKEN|Timken India|CapGoods|X
GRINDWELL|Grindwell Norton|CapGoods|X
CARBORUNIV|Carborundum Universal|CapGoods|X
ABBOTINDIA|Abbott India|Pharma|M
GLAXO|GlaxoSmithKline Pharma|Pharma|X
PFIZER|Pfizer|Pharma|X
BIOCON|Biocon|Pharma|M
LAURUSLABS|Laurus Labs|Pharma|M
IPCALAB|IPCA Laboratories|Pharma|M
MANKIND|Mankind Pharma|Pharma|M
GLENMARK|Glenmark Pharma|Pharma|M
FORTIS|Fortis Healthcare|Healthcare|M
ASTERDM|Aster DM Healthcare|Healthcare|X
APOLLOTYRE|Apollo Tyres|Auto|M
BALKRISIND|Balkrishna Industries|Auto|M
EXIDEIND|Exide Industries|Auto|M
ESCORTS|Escorts Kubota|Auto|M
SONACOMS|Sona BLW Precision|Auto|M
UNOMINDA|Uno Minda|Auto|M
TIINDIA|Tube Investments|Auto|M
ZFCVINDIA|ZF Commercial Vehicle|Auto|X
MARICO|Marico|FMCG|M
DABUR|Dabur India|FMCG|M
COLPAL|Colgate-Palmolive India|FMCG|M
EMAMILTD|Emami|FMCG|X
JYOTHYLAB|Jyothy Labs|FMCG|X
PATANJALI|Patanjali Foods|FMCG|M
JUBLFOOD|Jubilant FoodWorks|Consumer|M
DEVYANI|Devyani International|Consumer|X
KALYANKJIL|Kalyan Jewellers|Consumer|M
TRIDENT|Trident|Consumer|X
RAYMOND|Raymond|Consumer|X
PVRINOX|PVR INOX|Services|X
ZEEL|Zee Entertainment|Services|X
SUNTV|Sun TV Network|Services|X
NETWORK18|Network18 Media|Services|X
GUJGASLTD|Gujarat Gas|Energy|M
IGL|Indraprastha Gas|Energy|M
MGL|Mahanagar Gas|Energy|X
OIL|Oil India|Energy|M
HINDPETRO|Hindustan Petroleum|Energy|M
ATGL|Adani Total Gas|Energy|M
TATATECH|Tata Technologies|IT|M
LTTS|L&T Technology Services|IT|M
JKCEMENT|JK Cement|Cement|M
DALBHARAT|Dalmia Bharat|Cement|M
RAMCOCEM|Ramco Cements|Cement|X
ACC|ACC|Cement|M
NSDL|National Securities Depository|Financials|X
HDBFS|HDB Financial Services|Financials|M
ATHERENERG|Ather Energy|Auto|X
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
