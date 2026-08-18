'use strict';
/* scoring.js — hourly condition scoring, class metadata, window finding. Pure: no DOM, so Node can load it for unit tests. */

/* ---------------- scoring ---------------- */
function seriesAt(arrT, arrV, when){
  // nearest-hour lookup
  if(!arrT.length) return null;
  const i=clamp(Math.round((when-arrT[0])/36e5),0,arrT.length-1);
  const v=arrV[i];
  return (v==null||Number.isNaN(v))?null:v;
}
function tideSlope(tides, when){
  if(!tides||tides.length<2) return {slope:0, height:null};
  const i=clamp(Math.round((when-tides[0].t)/36e5),1,tides.length-1);
  const slope=tides[i].v-tides[i-1].v;   // ft per hour; negative = falling/ebb
  return {slope, height:tides[i].v};
}

function scoreHour(inl, when, boatFactor){
  const d=state.data.inlets[inl.id]; if(!d) return null;
  const m=d.marine, w=d.wind;
  const hsG=seriesAt(m.t,m.gfs.hs,when), hsE=seriesAt(m.t,m.ecmwf.hs,when);
  const tpG=seriesAt(m.t,m.gfs.tp,when), tpE=seriesAt(m.t,m.ecmwf.tp,when);
  const dirG=seriesAt(m.t,m.gfs.dir,when);
  const spdG=seriesAt(w.t,w.gfs.spd,when), spdE=seriesAt(w.t,w.ecmwf.spd,when);
  const gst=seriesAt(w.t,w.gfs.gst,when);
  const wdir=seriesAt(w.t,w.gfs.dir,when);
  if(hsG==null||spdG==null) return null;

  const hs=hsE!=null?(hsG+hsE)/2:hsG;                 // consensus estimate
  const tp=(tpG!=null&&tpE!=null)?(tpG+tpE)/2:(tpG??tpE??9);
  const wind=spdE!=null?(spdG+spdE)/2:spdG;
  const dir=dirG??120;

  const hsEff=hs*boatFactor;
  // sea state: height + short-period steepness
  let pSea=clamp((hsEff-2)*9,0,42);
  if(tp<9) pSea+=clamp((9-tp)*2.2,0,14)*clamp(hsEff/3,0.4,1.6);
  pSea=clamp(pSea,0,55);
  // wind
  const onshore=Math.cos((angDiff(wdir??200,inl.bearing))*Math.PI/180); // >0 blowing in from sea
  let pWind=clamp((wind-11)*2.1,0,26)+clamp(((gst??wind*1.3)-18)*0.7,0,8);
  if(onshore>0.3&&wind>12) pWind+=4;
  pWind=clamp(pWind,0,34);
  // ebb opposition over the bar — only from a live tide; a synthetic
  // (random-phase) tide must never shape a real inlet's score
  const tRec=state.data.tides[inl.tideSta];
  const tideLive=!!(tRec&&tRec.live);
  const td=tideLive?tideSlope(tRec.pts,when):{slope:0, height:null};
  const ebb=clamp(-td.slope/0.9,0,1);                  // 0..1 ebb strength
  const opp=clamp(1-angDiff(dir,inl.bearing)/75,0,1);  // swell arriving straight up the channel
  let pTide=ebb*(0.35+0.65*opp)*inl.shoal*(5+hsEff*3.4+clamp(9-tp,0,4)*1.6);
  pTide=clamp(pTide,0,38);

  const score=Math.round(clamp(100-pSea-pWind-pTide,0,100));
  // hazard override
  let cls;
  if(hsEff>=8||wind>=25||score<25) cls='critical';
  else if(score>=70) cls='good';
  else if(score>=45) cls='warn';
  else cls='serious';
  // model spread → confidence
  const spreadHs=(hsG!=null&&hsE!=null)?Math.abs(hsG-hsE):0;
  const spreadW=(spdG!=null&&spdE!=null)?Math.abs(spdG-spdE):0;
  const conf=(spreadHs>1.6||spreadW>7)?'low':(spreadHs>0.9||spreadW>4.5)?'med':'high';
  return { t:when, score, cls, conf, tideLive,
    hs:+hs.toFixed(1), tp:+tp.toFixed(1), dir, wind:+wind.toFixed(0), wdir, gst:gst==null?null:+gst.toFixed(0),
    tideH:td.height, ebb:+ebb.toFixed(2), opp:+opp.toFixed(2),
    pSea:Math.round(pSea), pWind:Math.round(pWind), pTide:Math.round(pTide) };
}

function scoreAll(){
  const start=new Date(); start.setMinutes(0,0,0);
  const scored={inlets:{}, start};
  for(const inl of CONFIG.inlets){
    const hours=[];
    for(let i=0;i<CONFIG.hoursPlanner;i++){
      const h=scoreHour(inl,new Date(start.getTime()+i*36e5),state.boatFactor);
      if(h) hours.push(h);
    }
    scored.inlets[inl.id]=hours;
  }
  state.scored=scored;
}

const CLS_META={
  good:{label:'Favorable', ic:'✓', color:'var(--st-good)'},
  warn:{label:'Marginal', ic:'!', color:'var(--st-warn)'},
  serious:{label:'Rough', ic:'✕', color:'var(--st-serious)'},
  critical:{label:'Hazardous', ic:'⚠', color:'var(--st-critical)'},
};
function clsRank(c){return {good:0,warn:1,serious:2,critical:3}[c];}

function findWindows(hours, horizon){
  // contiguous 'good' runs >=2h within horizon
  const wins=[]; let run=null;
  for(let i=0;i<Math.min(hours.length,horizon);i++){
    const h=hours[i];
    if(h.cls==='good'){ if(!run) run={from:h.t, to:h.t, minScore:h.score, conf:h.conf}; else { run.to=h.t; run.minScore=Math.min(run.minScore,h.score); if(h.conf==='low') run.conf='low'; } }
    else if(run){ if((run.to-run.from)/36e5>=1) wins.push(run); run=null; }
  }
  if(run&&(run.to-run.from)/36e5>=1) wins.push(run);
  return wins;
}

function whyText(h){
  const parts=[];
  parts.push(h.hs+' ft @ '+h.tp+' s from '+compass(h.dir));
  parts.push(h.wind+' kn '+compass(h.wdir??200));
  if(h.ebb>0.45&&h.opp>0.4) parts.push('ebb against the swell');
  else if(h.ebb>0.45) parts.push('ebbing');
  else if(h.ebb<0.05) parts.push('flooding/slack');
  return parts.join(' · ');
}
