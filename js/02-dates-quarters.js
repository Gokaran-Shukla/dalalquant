'use strict';
/* ============================== Dates & quarters ============================== */
function genDates(n){const out=[];const d=new Date();d.setHours(12,0,0,0);while(out.length<n){const wd=d.getDay();if(wd!==0&&wd!==6)out.push(d.toISOString().slice(0,10));d.setDate(d.getDate()-1)}return out.reverse()}
function fyq(d){const m=d.getMonth()+1,y=d.getFullYear();return m>=4?{q:Math.floor((m-4)/3)+1,fy:y+1}:{q:4,fy:y}}
function quarterLabels(n){let {q,fy}=fyq(new Date());q--;if(q===0){q=4;fy--}const out=[];for(let i=0;i<n;i++){out.push({q,fy,label:`Q${q} FY${String(fy).slice(2)}`});q--;if(q===0){q=4;fy--}}return out.reverse()}
