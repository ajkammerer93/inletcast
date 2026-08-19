'use strict';
/* scoring.js — hourly condition scoring, class metadata, window finding. Pure: no DOM, so Node can load it for unit tests.
   All tunable numbers live in SCORING (config.js); scoreCore is the single formula shared by the inlet and offshore-zone paths. */

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
function ebbStrength(tides, when){
  // 0..1 ebb strength, widened over roughly ±90 min: the reference stations are distant
  // proxies and slack at the mouth can lag the station, so take the strongest ebb nearby
  let e=0;
  for(let k=-SCORING.ebbSmearHours;k<=SCORING.ebbSmearHours;k++){
    const s=tideSlope(tides,new Date(when.getTime()+k*36e5)).slope;
    e=Math.max(e,clamp(-s/SCORING.ebbFullSlope,0,1));
  }
  return e;
}

// consensus conditions for one hour from a point's marine + wind series (shared by inlets and zones)
function sampleEnv(m, w, when){
  const hsG=seriesAt(m.t,m.gfs.hs,when), hsE=seriesAt(m.t,m.ecmwf.hs,when);
  const tpG=seriesAt(m.t,m.gfs.tp,when), tpE=seriesAt(m.t,m.ecmwf.tp,when);
  const dirG=seriesAt(m.t,m.gfs.dir,when);
  const shsG=m.gfs.shs?seriesAt(m.t,m.gfs.shs,when):null, shsE=m.ecmwf.shs?seriesAt(m.t,m.ecmwf.shs,when):null;
  const stpG=m.gfs.stp?seriesAt(m.t,m.gfs.stp,when):null, stpE=m.ecmwf.stp?seriesAt(m.t,m.ecmwf.stp,when):null;
  const sdirG=m.gfs.sdir?seriesAt(m.t,m.gfs.sdir,when):null;
  const spdG=seriesAt(w.t,w.gfs.spd,when), spdE=seriesAt(w.t,w.ecmwf.spd,when);
  const gst=seriesAt(w.t,w.gfs.gst,when);
  const wdir=seriesAt(w.t,w.gfs.dir,when);
  if(hsG==null||spdG==null) return null;
  return {
    hs:hsE!=null?(hsG+hsE)/2:hsG,                        // consensus estimate
    tp:(tpG!=null&&tpE!=null)?(tpG+tpE)/2:(tpG??tpE??9),
    dir:dirG??120,
    shs:(shsG!=null&&shsE!=null)?(shsG+shsE)/2:(shsG??shsE),  // swell partition, when the model provides it
    stp:(stpG!=null&&stpE!=null)?(stpG+stpE)/2:(stpG??stpE),
    sdir:sdirG,
    wind:spdE!=null?(spdG+spdE)/2:spdG,
    wdir, gst,
    spreadHs:(hsG!=null&&hsE!=null)?Math.abs(hsG-hsE):0,
    spreadW:(spdG!=null&&spdE!=null)?Math.abs(spdG-spdE):0,
  };
}

/* Shared scoring core. env: one hour of consensus conditions (sampleEnv). opts:
   boatFactor plus the geometry terms — bearing/shoal/ebb for an inlet bar, or
   bearing:null, shoal:0, ebb:0 with streamDir set for an open-water offshore zone. */
function scoreCore(env, opts){
  const S=SCORING;
  const {hs,tp,dir,wind,gst,wdir}=env;
  const shoal=opts.shoal||0;
  const hsEff=hs*opts.boatFactor;
  // swell partition drives the opposition and long-period terms; totals are the fallback —
  // wind chop must not rotate the total direction away from a dangerous ground swell
  const hasSwell=env.shs!=null&&env.shs>=S.swellMinHs;
  const swTp=(hasSwell&&env.stp!=null)?env.stp:tp;
  const swDir=(hasSwell&&env.sdir!=null)?env.sdir:dir;
  // sea state: height + short-period steepness
  let pSea=clamp((hsEff-S.seaBaseFt)*S.seaSlope,0,S.seaHeightMax);
  if(tp<S.steepTp) pSea+=clamp((S.steepTp-tp)*S.steepSlope,0,S.steepMax)*clamp(hsEff/S.steepHsRef,S.steepHsScaleMin,S.steepHsScaleMax);
  pSea=clamp(pSea,0,S.seaMax);
  // wind
  const onshore=opts.bearing!=null?Math.cos((angDiff(wdir??200,opts.bearing))*Math.PI/180):0; // >0 blowing in from sea
  let pWind=clamp((wind-S.windBaseKn)*S.windSlope,0,S.windSpdMax)+clamp(((gst??wind*S.gustFallback)-S.gustBaseKn)*S.gustSlope,0,S.gustMax);
  if(onshore>S.onshoreCos&&wind>S.onshoreMinKn) pWind+=S.onshoreBump;
  pWind=clamp(pWind,0,S.windMax);
  // wind against the Stream: wind from near the flow-toward azimuth stands the current up (zones only)
  let pStream=0;
  if(opts.streamDir!=null&&wind>S.streamMinKn&&angDiff(wdir??200,opts.streamDir)<=S.streamOppDeg)
    pStream=clamp((wind-S.streamMinKn)*S.streamSlope,0,S.streamMax);
  // bar breaking: shoaled-height proxy grows with swell period and shoal factor, on RAW height —
  // long period is what jacks and breaks on an ebb delta, so it must never read as benign
  const hb=hs*Math.sqrt(Math.max(swTp,S.hbTpFloor)/S.hbTpRef)*shoal;
  const pBar=clamp((hb-S.hbFreeFt)*S.hbSlope,0,S.hbMax);
  // ebb opposition over the bar
  const ebb=opts.ebb||0;
  const opp=opts.bearing!=null?clamp(1-angDiff(swDir,opts.bearing)/S.oppHalfWidthDeg,0,1):0; // swell arriving straight up the channel
  let pTide=ebb*(S.tideBaseW+S.tideOppW*opp)*shoal*(S.tideBasePts+hsEff*S.tideHsSlope+clamp(S.steepTp-tp,0,S.tideShortTpClamp)*S.tideShortTpSlope);
  pTide=clamp(pTide,0,S.tideMax);

  const score=Math.round(clamp(100-pSea-pWind-pTide-pBar-pStream,0,100));
  // class + hazard overrides
  let cls;
  if(hsEff>=S.critHsEff||wind>=S.critWindKn||score<S.critScoreBelow) cls='critical';
  else if(score>=S.goodMin) cls='good';
  else if(score>=S.warnMin) cls='warn';
  else cls='serious';
  // raw-height overrides on shoal bars: breaking is a depth/wave property — boat class must not scale it away
  if(shoal>=S.shoalBar&&(hs>=S.critRawHs||(hs>=S.critRawHsLong&&swTp>=S.critLongTp))) cls='critical';
  // compound ebb-against-swell override: the named hazard mechanism forces the class on its own
  if(ebb>S.compEbb&&opp>S.compOpp&&shoal>=S.shoalBar){
    const thr=swTp>=S.compTpHi?S.compHsHi:swTp>=S.compTpLo?S.compHsLo:Infinity;
    if(hs>=thr*S.compCritX) cls='critical';
    else if(hs>=thr&&clsRank(cls)<clsRank('serious')) cls='serious';
  }
  // model spread → confidence (same thresholds on the inlet and zone paths)
  const conf=(env.spreadHs>S.confHsLow||env.spreadW>S.confWLow)?'low':(env.spreadHs>S.confHsMed||env.spreadW>S.confWMed)?'med':'high';
  return {score, cls, conf, hb, ebb, opp, pSea, pWind, pTide, pBar, pStream};
}

function scoreHour(inl, when, boatFactor){
  const d=state.data.inlets[inl.id]; if(!d) return null;
  const env=sampleEnv(d.marine,d.wind,when); if(!env) return null;
  // ebb opposition over the bar — only from a live tide; a synthetic
  // (random-phase) tide must never shape a real inlet's score
  const tRec=state.data.tides[inl.tideSta];
  const tideLive=!!(tRec&&tRec.live);
  const td=tideLive?tideSlope(tRec.pts,when):{slope:0, height:null};
  const ebb=tideLive?ebbStrength(tRec.pts,when):0;
  const r=scoreCore(env,{boatFactor, bearing:inl.bearing, shoal:inl.shoal, ebb});
  return { t:when, score:r.score, cls:r.cls, conf:r.conf, tideLive,
    hs:+env.hs.toFixed(1), tp:+env.tp.toFixed(1), dir:env.dir, wind:+env.wind.toFixed(0), wdir:env.wdir, gst:env.gst==null?null:+env.gst.toFixed(0),
    tideH:td.height, ebb:+r.ebb.toFixed(2), opp:+r.opp.toFixed(2), hb:+r.hb.toFixed(1),
    pSea:Math.round(r.pSea), pWind:Math.round(r.pWind), pTide:Math.round(r.pTide), pBar:Math.round(r.pBar) };
}

/* Offshore-zone hourly score — the same core as the inlets with the tide × bar terms
   disabled (no bar geometry in open water) and the wind-against-the-Stream penalty on. */
function zoneScoreHour(zone, when, boatFactor){
  const zd=state.data.zones[zone.id]; if(!zd) return null;
  const env=sampleEnv(zd.marine,zd.wind,when); if(!env) return null;
  const r=scoreCore(env,{boatFactor, bearing:null, shoal:0, ebb:0, streamDir:zone.streamDir});
  return { t:when, score:r.score, cls:r.cls, conf:r.conf,
    hs:+env.hs.toFixed(1), tp:+env.tp.toFixed(1), dir:env.dir, wind:Math.round(env.wind), wdir:env.wdir,
    ebb:0, opp:0, pStream:Math.round(r.pStream) };
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

/* desc wording is shared verbatim by the Method tab and the status-chip popover */
const CLS_META={
  good:{label:'Favorable', ic:'✓', color:'var(--st-good)',
    desc:'modeled seas, wind, and tide below the thresholds this tool uses for this size class.'},
  warn:{label:'Marginal', ic:'!', color:'var(--st-warn)',
    desc:'one or more thresholds approached or exceeded — expect discomfort and timing sensitivity.'},
  serious:{label:'Rough', ic:'✕', color:'var(--st-serious)',
    desc:'thresholds clearly exceeded; most operators wait for the next window.'},
  critical:{label:'Hazardous', ic:'⚠', color:'var(--st-critical)',
    desc:'conditions at or beyond small-craft-advisory character at the inlet.'},
};
const CLS_NOTE='The labels describe modeled conditions against fixed thresholds — never a statement that any boat or operator should go.';
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
  if(h.pBar>=8) parts.push('long-period swell shoaling on the bar');
  return parts.join(' · ');
}
