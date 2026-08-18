'use strict';
/* data.js — fetch layer (Open-Meteo, NOAA CO-OPS, MUR SST), synthetic demo fallbacks, and loadData. */

/* ---------------- live data ---------------- */
async function fetchJSON(url, timeoutMs=9000){
  const ctrl=new AbortController();
  const to=setTimeout(()=>ctrl.abort(),timeoutMs);
  try{
    const r=await fetch(url,{signal:ctrl.signal});
    if(!r.ok) throw new Error('HTTP '+r.status);
    return await r.json();
  } finally { clearTimeout(to); }
}

// Marine API with two wave models -> suffixed keys. We normalize to {t[], gfs:{hs,tp,dir}, ecmwf:{hs,tp,dir}}
async function fetchMarine(lat,lon){
  const url='https://marine-api.open-meteo.com/v1/marine?latitude='+lat+'&longitude='+lon
    +'&hourly=wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period,swell_wave_direction'
    +'&models=gfs_wave025,ecmwf_wam025&length_unit=imperial&timezone=America%2FNew_York&forecast_days=8';
  const j=await fetchJSON(url);
  const h=j.hourly||{};
  const pick=(base,model)=>h[base+'_'+model]||h[base]||[];
  return {
    t:(h.time||[]).map(s=>new Date(s)),
    gfs:{ hs:pick('wave_height','gfs_wave025'), tp:pick('wave_period','gfs_wave025'), dir:pick('wave_direction','gfs_wave025'),
          shs:pick('swell_wave_height','gfs_wave025'), stp:pick('swell_wave_period','gfs_wave025'), sdir:pick('swell_wave_direction','gfs_wave025') },
    ecmwf:{ hs:pick('wave_height','ecmwf_wam025'), tp:pick('wave_period','ecmwf_wam025'), dir:pick('wave_direction','ecmwf_wam025'),
            shs:pick('swell_wave_height','ecmwf_wam025'), stp:pick('swell_wave_period','ecmwf_wam025'), sdir:pick('swell_wave_direction','ecmwf_wam025') },
  };
}
async function fetchWind(lat,lon){
  const url='https://api.open-meteo.com/v1/forecast?latitude='+lat+'&longitude='+lon
    +'&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m'
    +'&models=gfs_seamless,ecmwf_ifs025&wind_speed_unit=kn&timezone=America%2FNew_York&forecast_days=8';
  const j=await fetchJSON(url);
  const h=j.hourly||{};
  const pick=(base,model)=>h[base+'_'+model]||h[base]||[];
  return {
    t:(h.time||[]).map(s=>new Date(s)),
    gfs:{ spd:pick('wind_speed_10m','gfs_seamless'), dir:pick('wind_direction_10m','gfs_seamless'), gst:pick('wind_gusts_10m','gfs_seamless') },
    ecmwf:{ spd:pick('wind_speed_10m','ecmwf_ifs025'), dir:pick('wind_direction_10m','ecmwf_ifs025'), gst:pick('wind_gusts_10m','ecmwf_ifs025') },
  };
}
async function fetchTides(sta){
  const now=new Date(); const end=new Date(now.getTime()+8*864e5);
  const url='https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&application=inletcast_prototype'
    +'&begin_date='+ymd(now)+'&end_date='+ymd(end)+'&datum=MLLW&station='+sta
    +'&time_zone=lst_ldt&units=english&interval=h&format=json';
  const j=await fetchJSON(url);
  if(!j.predictions) throw new Error('no predictions');
  return j.predictions.map(p=>({t:new Date(p.t.replace(' ','T')), v:parseFloat(p.v)}));
}
function makeDemoSST(){
  // demo: logistic front along a meandering reference line from SW to NE
  const rnd=mulberry32(hashCode('gulfstream'+new Date().getDate()));
  const ph=rnd()*Math.PI*2, meander=0.10+rnd()*0.08;
  const A={lon:-77.45,lat:33.48}, B={lon:-75.75,lat:34.55};
  const dx=B.lon-A.lon, dy=B.lat-A.lat, L=Math.hypot(dx,dy);
  const nx=-dy/L, ny=dx/L; // normal (offshore-positive-ish)
  return function(lon,lat){
    const t=((lon-A.lon)*dx+(lat-A.lat)*dy)/(L*L);
    const wig=meander*Math.sin(t*5+ph);
    const d=((lon-A.lon)*nx+(lat-A.lat)*ny)-wig;
    return +(26.6+2.6/(1+Math.exp(d/0.11))+0.15*Math.sin(lon*9+ph)).toFixed(2);
  };
}

/* ---------- gridded SST + wind fields for map overlays ---------- */
function landPolygon(){
  const last=MAPDATA.coast[MAPDATA.coast.length-1];
  return MAPDATA.coast.concat([[last[0],MAPDATA.bounds.latMax+0.1],[MAPDATA.bounds.lonMin-0.1,MAPDATA.bounds.latMax+0.1]]);
}
function pointInLand(lon,lat){
  const poly=landPolygon(); let inside=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const xi=poly[i][0],yi=poly[i][1],xj=poly[j][0],yj=poly[j][1];
    if(((yi>lat)!==(yj>lat)) && (lon < (xj-xi)*(lat-yi)/(yj-yi)+xi)) inside=!inside;
  }
  return inside;
}
function nearCoast(lon,lat,buf){
  return MAPDATA.coast.some(([clo,cla])=>Math.hypot(lon-clo,lat-cla)<buf);
}
function buildGrid(){
  const lons=[],lats=[];
  for(let lo=GRID.lonMin;lo<=GRID.lonMax+1e-9;lo+=GRID.dLon) lons.push(+lo.toFixed(3));
  for(let la=GRID.latMin;la<=GRID.latMax+1e-9;la+=GRID.dLat) lats.push(+la.toFixed(3));
  const ocean=[];
  lats.forEach((la,i)=>lons.forEach((lo,j)=>{
    if(!pointInLand(lo,la)&&!nearCoast(lo,la,0.09)) ocean.push({i,j,lon:lo,lat:la});
  }));
  return {lons,lats,ocean};
}
function emptyGrid2D(ny,nx){return Array.from({length:ny},()=>Array(nx).fill(null));}
async function fetchGridFields(g){
  const latQ=g.ocean.map(p=>p.lat.toFixed(3)).join(','), lonQ=g.ocean.map(p=>p.lon.toFixed(3)).join(',');
  const [mj,wj]=await Promise.all([
    fetchJSON('https://marine-api.open-meteo.com/v1/marine?latitude='+latQ+'&longitude='+lonQ
      +'&hourly=sea_surface_temperature&forecast_days=1&timezone=America%2FNew_York',14000),
    fetchJSON('https://api.open-meteo.com/v1/forecast?latitude='+latQ+'&longitude='+lonQ
      +'&hourly=wind_speed_10m,wind_direction_10m&wind_speed_unit=kn&forecast_days=1&timezone=America%2FNew_York',14000),
  ]);
  const mArr=Array.isArray(mj)?mj:[mj], wArr=Array.isArray(wj)?wj:[wj];
  if(mArr.length!==g.ocean.length||wArr.length!==g.ocean.length) throw new Error('grid count mismatch');
  const hr=new Date().getHours();
  const sst=emptyGrid2D(g.lats.length,g.lons.length), wspd=emptyGrid2D(g.lats.length,g.lons.length), wdir=emptyGrid2D(g.lats.length,g.lons.length);
  g.ocean.forEach((p,k)=>{
    const mh=(mArr[k].hourly||{}), wh=(wArr[k].hourly||{});
    const idxM=Math.min(hr,(mh.time||[]).length-1), idxW=Math.min(hr,(wh.time||[]).length-1);
    const s=(mh.sea_surface_temperature||[])[idxM];
    sst[p.i][p.j]=(s==null||Number.isNaN(s))?null:s;
    const ws=(wh.wind_speed_10m||[])[idxW], wd=(wh.wind_direction_10m||[])[idxW];
    wspd[p.i][p.j]=(ws==null||Number.isNaN(ws))?null:ws;
    wdir[p.i][p.j]=(wd==null||Number.isNaN(wd))?null:wd;
  });
  return {sst,wspd,wdir};
}
/* MUR 1-km satellite-blended SST analysis via NOAA CoastWatch ERDDAP (CORS-open).
   Preferred SST source — resolves real Gulf Stream structure that smoothed
   NWP-analysis SST misses, especially in summer when the wall contrast is weak. */
async function fetchMURGrid(){
  const stride=12; // 0.01° native × 12 ≈ 0.12°
  const url='https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplMURSST41.json?analysed_sst'
    +'%5B(last)%5D'
    +'%5B('+GRID.latMin+'):'+stride+':('+GRID.latMax+')%5D'
    +'%5B('+GRID.lonMin+'):'+stride+':('+GRID.lonMax+')%5D';
  const j=await fetchJSON(url,15000);
  const t=j.table; if(!t||!t.rows||!t.rows.length) throw new Error('no rows');
  const ci={}; t.columnNames.forEach((c,k)=>ci[c]=k);
  const latSet=new Set(), lonSet=new Set();
  t.rows.forEach(r=>{latSet.add(r[ci.latitude]); lonSet.add(r[ci.longitude]);});
  const lats=[...latSet].sort((a,b)=>a-b), lons=[...lonSet].sort((a,b)=>a-b);
  const li={},lj={}; lats.forEach((v,k)=>li[v]=k); lons.forEach((v,k)=>lj[v]=k);
  const sst=emptyGrid2D(lats.length,lons.length);
  let n=0;
  t.rows.forEach(r=>{
    let v=r[ci.analysed_sst];
    if(v==null||Number.isNaN(v)) return;
    if(v>200) v-=273.15; // Kelvin-served variants
    sst[li[r[ci.latitude]]][lj[r[ci.longitude]]]=v; n++;
  });
  if(n<20) throw new Error('too few valid cells');
  return {lats,lons,sst,time:t.rows[0][ci.time]||null,source:'mur'};
}

function demoGridFields(g){
  const f=makeDemoSST();
  const rnd=mulberry32(hashCode('gridwind'+new Date().getDate()));
  const ph=rnd()*Math.PI*2;
  const sst=emptyGrid2D(g.lats.length,g.lons.length), wspd=emptyGrid2D(g.lats.length,g.lons.length), wdir=emptyGrid2D(g.lats.length,g.lons.length);
  g.ocean.forEach(p=>{
    sst[p.i][p.j]=f(p.lon,p.lat);
    wspd[p.i][p.j]=+(9+6*Math.sin(p.lon*2.2+ph)+4*Math.cos(p.lat*3.1+ph*1.3)).toFixed(1);
    wdir[p.i][p.j]=Math.round((215+45*Math.sin(p.lon*1.8+p.lat*1.2+ph)+360)%360);
  });
  return {sst,wspd,wdir};
}
function synthPoint(seedStr, start, nHours){
  const rnd=mulberry32(hashCode(seedStr));
  const p1=rnd()*Math.PI*2, p2=rnd()*Math.PI*2, p3=rnd()*Math.PI*2;
  const stormT=40+rnd()*70, stormMag=1.4+rnd()*2.2;
  const t=[], gfs={hs:[],tp:[],dir:[],shs:[],stp:[],sdir:[]}, ecmwf={hs:[],tp:[],dir:[],shs:[],stp:[],sdir:[]};
  const wg={spd:[],dir:[],gst:[]}, we={spd:[],dir:[],gst:[]};
  for(let i=0;i<nHours;i++){
    const d=new Date(start.getTime()+i*36e5); t.push(d);
    const hod=d.getHours();
    // synoptic wind: builds ahead of the "front", veers after
    const front=Math.exp(-Math.pow((i-stormT)/16,2));
    const synW=9+6*Math.sin(i/34+p1)+13*front;
    const seaBreeze=Math.max(0,5*Math.sin((hod-9)/10*Math.PI))*(i<stormT?1:0.5);
    const wspd=Math.max(3,synW+seaBreeze+2*Math.sin(i/7+p2));
    const wdir=(200+60*Math.sin(i/45+p3)+(i>stormT? -140:0)+360)%360;
    // swell: background SE + storm bump, period lengthens after event
    const shs=1.6+0.8*Math.sin(i/50+p2)+stormMag*Math.exp(-Math.pow((i-stormT-8)/20,2));
    const stp=8.5+2.2*Math.sin(i/60+p1)+3*Math.exp(-Math.pow((i-stormT-20)/26,2));
    const windsea=Math.pow(Math.max(0,wspd-8)/10,1.5)*1.6;
    const hs=Math.sqrt(shs*shs+windsea*windsea);
    const tp=windsea>shs?Math.max(4.5,4+wspd*0.14):stp;
    const dir=(115+25*Math.sin(i/70+p3)+360)%360;
    gfs.hs.push(+hs.toFixed(2)); gfs.tp.push(+tp.toFixed(1)); gfs.dir.push(Math.round(dir));
    gfs.shs.push(+shs.toFixed(2)); gfs.stp.push(+stp.toFixed(1)); gfs.sdir.push(Math.round(dir));
    // "second model": correlated but diverging with lead time
    const spread=(0.12+0.55*i/nHours);
    const e=hs*(1+spread*Math.sin(i/22+p1*2))+0.15*Math.sin(i/9+p3);
    ecmwf.hs.push(+Math.max(0.4,e).toFixed(2)); ecmwf.tp.push(+(tp*(1+0.1*Math.sin(i/30+p2))).toFixed(1)); ecmwf.dir.push(Math.round((dir+8*Math.sin(i/40))%360));
    ecmwf.shs.push(+Math.max(0.3,shs*(1+spread*0.6*Math.sin(i/25+p2))).toFixed(2)); ecmwf.stp.push(+(stp*(1+0.08*Math.sin(i/33))).toFixed(1)); ecmwf.sdir.push(Math.round(dir));
    wg.spd.push(+wspd.toFixed(1)); wg.dir.push(Math.round(wdir)); wg.gst.push(+(wspd*1.35).toFixed(1));
    const ew=wspd*(1+spread*0.5*Math.sin(i/18+p3));
    we.spd.push(+Math.max(2,ew).toFixed(1)); we.dir.push(Math.round((wdir+10*Math.sin(i/25))%360)); we.gst.push(+(ew*1.35).toFixed(1));
  }
  return { marine:{t,gfs,ecmwf}, wind:{t,gfs:wg,ecmwf:we} };
}
function synthTide(sta, start, nHours){
  const rnd=mulberry32(hashCode('tide'+sta));
  const phase=rnd()*12, amp=1.8+rnd()*0.5, msl=2.15;
  const out=[];
  for(let i=0;i<nHours;i++){
    const d=new Date(start.getTime()+i*36e5);
    const hrs=(d.getTime()/36e5);
    const v=msl+amp*Math.cos(2*Math.PI*(hrs-phase)/12.4206)+0.35*Math.cos(2*Math.PI*hrs/12+phase);
    out.push({t:d, v:+v.toFixed(2)});
  }
  return out;
}

/* ---------------- load ---------------- */
async function loadData(){
  const start=new Date(); start.setMinutes(0,0,0);
  const n=CONFIG.hoursPlanner+24;
  const data={inlets:{}, zones:{}, tides:{}};
  let liveOK=0, liveFail=0;

  const jobs=[];
  for(const inl of CONFIG.inlets){
    jobs.push((async()=>{
      try{
        const [m,w]=await Promise.all([fetchMarine(inl.wLat,inl.wLon), fetchWind(inl.wLat,inl.wLon)]);
        if(!m.t.length||!w.t.length) throw new Error('empty');
        data.inlets[inl.id]={marine:m, wind:w, live:true}; liveOK++;
      }catch(e){ data.inlets[inl.id]={...synthPoint('inlet'+inl.id,start,n), live:false}; liveFail++; }
    })());
  }
  for(const z of CONFIG.zones){
    jobs.push((async()=>{
      try{
        const [m,w]=await Promise.all([fetchMarine(z.lat,z.lon), fetchWind(z.lat,z.lon)]);
        if(!m.t.length||!w.t.length) throw new Error('empty');
        data.zones[z.id]={marine:m, wind:w, live:true}; liveOK++;
      }catch(e){ data.zones[z.id]={...synthPoint('zone'+z.id,start,n), live:false}; liveFail++; }
    })());
  }
  jobs.push((async()=>{
    try{ data.murGrid=await fetchMURGrid(); liveOK++; }
    catch(e){ data.murGrid=null; } // silent enhancement — NWP grid is the fallback
  })());
  const grid=buildGrid();
  jobs.push((async()=>{
    try{
      const f=await fetchGridFields(grid);
      if(!f.sst.flat().some(v=>v!=null)) throw new Error('all null');
      data.grid={...grid, ...f, live:true}; liveOK++;
    }catch(e){ data.grid={...grid, ...demoGridFields(grid), live:false}; liveFail++; }
  })());
  const stations=[...new Set(CONFIG.inlets.map(i=>i.tideSta))];
  for(const sta of stations){
    jobs.push((async()=>{
      try{
        const t=await fetchTides(sta);
        if(!t.length) throw new Error('empty');
        data.tides[sta]=t; liveOK++;
      }catch(e){ data.tides[sta]=synthTide(sta,start,n); liveFail++; }
    })());
  }
  await Promise.allSettled(jobs);
  state.mode = liveFail===0 ? 'live' : (liveOK===0 ? 'demo' : 'mixed');
  state.fetchedAt=new Date();
  state.data=data;
}
