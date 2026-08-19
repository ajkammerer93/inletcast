'use strict';
/* utils.js — pure helpers: PRNG, math, compass/date/format utilities, DOM element builders. */

function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;}}
function hashCode(s){let h=0;for(let i=0;i<s.length;i++){h=(h<<5)-h+s.charCodeAt(i)|0;}return h>>>0;}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function compass(deg){const d=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];return d[Math.round(((deg%360)+360)%360/22.5)%16];}
function angDiff(a,b){let d=Math.abs(a-b)%360;return d>180?360-d:d;}
function ft(v){return v==null?'–':v.toFixed(1);}
function pad2(n){return String(n).padStart(2,'0');}

/* ---------- America/New_York time handling ----------
   Every API is asked for NY times but returns offset-less strings, and the forecasts
   are about the NC coast — so parse those strings as NY wall time (DST-aware) into
   true instants, and format every displayed time back in NY. A viewer in another
   timezone then sees the same site a viewer at the dock does. */
const NY_TZ='America/New_York';
const _nyClock=new Intl.DateTimeFormat('en-US',{timeZone:NY_TZ,hour12:false,
  year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
const _nyDay=new Intl.DateTimeFormat('en-US',{timeZone:NY_TZ,weekday:'short'});
function nyClockParts(d){
  const p={};
  for(const q of _nyClock.formatToParts(d)) p[q.type]=q.value;
  return {y:+p.year, mo:+p.month, day:+p.day, h:(+p.hour)%24, min:+p.minute};
}
function nyOffsetMs(atMs){
  // NY wall-clock reading of the instant, re-encoded as UTC, minus the instant = zone offset
  const p=nyClockParts(new Date(atMs));
  return Date.UTC(p.y,p.mo-1,p.day,p.h,p.min)-Math.floor(atMs/6e4)*6e4;
}
function nyParse(s){
  // 'YYYY-MM-DD[T ]HH:mm[:ss]' as NY wall time → Date instant; second pass covers DST edges
  const m=String(s).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if(!m) return new Date(s);
  const wall=Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5]);
  return new Date(wall-nyOffsetMs(wall-nyOffsetMs(wall)));
}
function nyHour(d){return nyClockParts(d).h;}
function nyStartOfDay(d,addDays){
  // instant of NY midnight, addDays days after the NY day containing d
  const p=nyClockParts(d);
  const wall=Date.UTC(p.y,p.mo-1,p.day+(addDays||0));
  return new Date(wall-nyOffsetMs(wall-nyOffsetMs(wall)));
}
function startOfHour(d){return new Date(Math.floor((d?d.getTime():Date.now())/36e5)*36e5);}
function hourIndexFor(times, nowMs){
  // index of the hour containing nowMs in an hourly time array (strings or Dates) —
  // derived from the API's own axis, never from the viewer's wall clock
  if(!times||!times.length) return 0;
  const t0=times[0] instanceof Date?times[0].getTime():nyParse(times[0]).getTime();
  return clamp(Math.floor((nowMs-t0)/36e5),0,times.length-1);
}
function nyTimeLabel(d){
  return new Intl.DateTimeFormat('en-US',{timeZone:NY_TZ,hour:'numeric',minute:'2-digit'}).format(d);
}
function hourLabel(d){let h=nyHour(d);const ap=h>=12?'p':'a';h=h%12;if(h===0)h=12;return h+ap;}
function dayLabel(d){return _nyDay.format(d);}
function timeRangeLabel(a,b){
  const pa=nyClockParts(a), pb=nyClockParts(b);
  const sameDay=pa.day===pb.day&&pa.mo===pb.mo;
  const f=(p)=>{let h=p.h;const ap=h>=12?'pm':'am';h=h%12;if(h===0)h=12;return h+(p.min?':'+pad2(p.min):'')+ap;};
  return dayLabel(a)+' '+f(pa)+'–'+(sameDay?'':dayLabel(b)+' ')+f(pb);
}
function ymd(d){const p=nyClockParts(d);return p.y+''+pad2(p.mo)+pad2(p.day);}

// touch-first environment? drives tap-to-pin defaults (table visible, two-tap markers)
function isCoarse(){ try{ return !!(window.matchMedia&&window.matchMedia('(pointer: coarse)').matches); }catch(e){ return false; } }
// vestibular safety: decorative animation (wind particles) is skipped when this matches
function prefersReduced(){ try{ return !!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches); }catch(e){ return false; } }

const $=(s,el)=>(el||document).querySelector(s);
const $$=(s,el)=>[...(el||document).querySelectorAll(s)];
const SVGNS='http://www.w3.org/2000/svg';
function svgEl(tag,attrs,parent){const e=document.createElementNS(SVGNS,tag);for(const k in attrs)e.setAttribute(k,attrs[k]);if(parent)parent.appendChild(e);return e;}
function el(tag,cls,parent,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;if(parent)parent.appendChild(e);return e;}
