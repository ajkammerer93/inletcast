'use strict';
/* utils.js — pure helpers: PRNG, math, compass/date/format utilities, DOM element builders. */

function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;}}
function hashCode(s){let h=0;for(let i=0;i<s.length;i++){h=(h<<5)-h+s.charCodeAt(i)|0;}return h>>>0;}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function compass(deg){const d=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];return d[Math.round(((deg%360)+360)%360/22.5)%16];}
function angDiff(a,b){let d=Math.abs(a-b)%360;return d>180?360-d:d;}
function ft(v){return v==null?'–':v.toFixed(1);}
function pad2(n){return String(n).padStart(2,'0');}
function hourLabel(d){let h=d.getHours();const ap=h>=12?'p':'a';h=h%12;if(h===0)h=12;return h+ap;}
function dayLabel(d){return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];}
function timeRangeLabel(a,b){
  const sameDay=a.getDate()===b.getDate();
  const f=(d)=>{let h=d.getHours();const ap=h>=12?'pm':'am';h=h%12;if(h===0)h=12;return h+(d.getMinutes()?':'+pad2(d.getMinutes()):'')+ap;};
  return dayLabel(a)+' '+f(a)+'–'+(sameDay?'':dayLabel(b)+' ')+f(b);
}
function ymd(d){return d.getFullYear()+''+pad2(d.getMonth()+1)+pad2(d.getDate());}

const $=(s,el)=>(el||document).querySelector(s);
const $$=(s,el)=>[...(el||document).querySelectorAll(s)];
const SVGNS='http://www.w3.org/2000/svg';
function svgEl(tag,attrs,parent){const e=document.createElementNS(SVGNS,tag);for(const k in attrs)e.setAttribute(k,attrs[k]);if(parent)parent.appendChild(e);return e;}
function el(tag,cls,parent,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;if(parent)parent.appendChild(e);return e;}
