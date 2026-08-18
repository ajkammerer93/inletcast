'use strict';
/* map.js — schematic coast map, SST raster + ramp, wind particle layer, Gulf Stream front detection. */

function detectFront(field){
  // per transect: strongest along-transect SST step (warm side offshore = negative step inshore→offshore? here inshore cooler)
  const byT={};
  field.forEach(p=>{(byT[p.ti]=byT[p.ti]||[]).push(p);});
  const front=[];
  Object.keys(byT).sort((a,b)=>a-b).forEach(ti=>{
    const pts=byT[ti].sort((a,b)=>a.i-b.i);
    let best=null;
    for(let i=1;i<pts.length;i++){
      if(pts[i].sst==null||pts[i-1].sst==null) continue;
      const g=pts[i].sst-pts[i-1].sst; // warming offshore
      if(!best||g>best.g) best={g, lon:(pts[i].lon+pts[i-1].lon)/2, lat:(pts[i].lat+pts[i-1].lat)/2,
        inshore:pts[i-1].sst, offshore:pts[i].sst, name:MAPDATA.transects[ti].name};
    }
    if(best) front.push({...best, weak:best.g<0.5});
  });
  return front;
}

/* ---------- map overlay layers (SST raster + wind particles) ----------
   Raster interpolation + ramp approach ported from the freesurfforecast
   surf_dash repo (buildFieldRasterURL / rampColor / leaflet-velocity u,v math). */
const SST_RAMP=[
  [0.00,[103,169,240]],   // cool shelf water — blue
  [0.30,[157,206,178]],   // transitional green
  [0.55,[247,201,110]],   // warming — sand
  [0.78,[238,141,75]],    // warm — orange
  [1.00,[211,59,59]],     // stream core — red
];
function rampColor(t){
  if(!(t>=0))t=0; if(t>1)t=1;
  for(let k=0;k<SST_RAMP.length-1;k++){
    const a=SST_RAMP[k],b=SST_RAMP[k+1];
    if(t<=b[0]){const f=(t-a[0])/(b[0]-a[0]);
      return [Math.round(a[1][0]+(b[1][0]-a[1][0])*f),Math.round(a[1][1]+(b[1][1]-a[1][1])*f),Math.round(a[1][2]+(b[1][2]-a[1][2])*f)];}
  }
  return SST_RAMP[SST_RAMP.length-1][1];
}
function gridSample(g,field,lon,lat){
  // NaN-aware bilinear sample of a 2D grid field at (lon,lat); null when unsupported
  const fi=(lat-g.lats[0])/(g.lats[1]-g.lats[0]);
  const fj=(lon-g.lons[0])/(g.lons[1]-g.lons[0]);
  const i0=Math.floor(fi), j0=Math.floor(fj), fy=fi-i0, fx=fj-j0;
  let sum=0,wsum=0;
  for(let c=0;c<4;c++){
    const ii=c<2?i0:i0+1, jj=(c%2===0)?j0:j0+1;
    if(ii<0||jj<0||ii>=g.lats.length||jj>=g.lons.length) continue;
    const w=(c<2?(1-fy):fy)*(c%2===0?(1-fx):fx);
    if(w<=0) continue;
    const v=field[ii]?field[ii][jj]:null;
    if(v==null||v!==v) continue;
    sum+=v*w; wsum+=w;
  }
  return wsum<0.15?null:sum/wsum;
}
function gridWindUV(g,lon,lat){
  const spd=gridSample(g,g.wspd,lon,lat);
  const dir=gridSample(g,g.wdir,lon,lat);
  if(spd==null||dir==null) return null;
  const r=dir*Math.PI/180;
  return {u:-spd*Math.sin(r), v:-spd*Math.cos(r), spd};
}
function buildSSTRaster(g, vmin, vmax){
  // equirectangular raster over the grid's cell-edge extent → data URL
  const nx=g.lons.length, ny=g.lats.length, up=Math.max(4,Math.round(140/nx));
  const W=nx*up, H=ny*up;
  const cv=document.createElement('canvas'); cv.width=W; cv.height=H;
  const ctx=cv.getContext('2d');
  const img=ctx.createImageData(W,H); const d=img.data;
  const dLo=nx>1?g.lons[1]-g.lons[0]:0.2, dLa=ny>1?g.lats[1]-g.lats[0]:0.18;
  const lonLo=g.lons[0]-dLo/2, lonHi=g.lons[nx-1]+dLo/2;
  const latLo=g.lats[0]-dLa/2, latHi=g.lats[ny-1]+dLa/2;
  const range=(vmax-vmin)||1, alpha=Math.round(0.55*255);
  for(let py=0;py<H;py++){
    const lat=latHi-(py+0.5)/H*(latHi-latLo);
    for(let px=0;px<W;px++){
      const lon=lonLo+(px+0.5)/W*(lonHi-lonLo);
      const o=(py*W+px)*4;
      if(pointInLand(lon,lat)){d[o+3]=0;continue;}
      const v=gridSample(g,g.sst,lon,lat);
      if(v==null){d[o+3]=0;continue;}
      const rgb=rampColor((v-vmin)/range);
      d[o]=rgb[0];d[o+1]=rgb[1];d[o+2]=rgb[2];d[o+3]=alpha;
    }
  }
  ctx.putImageData(img,0,0);
  return {url:cv.toDataURL('image/png'), lonLo, lonHi, latLo, latHi};
}
function startWindParticles(canvas, g, proj){
  const ctx=canvas.getContext('2d');
  const W=canvas.width, H=canvas.height;
  const ink=getComputedStyle(document.documentElement).getPropertyValue('--ink-2').trim()||'#52514e';
  const N=280, parts=[];
  const spawn=p=>{
    for(let tries=0;tries<12;tries++){
      const x=Math.random()*W, y=Math.random()*H;
      const lon=proj.lonAt(x/W), lat=proj.latAt(y/H);
      if(gridWindUV(g,lon,lat)){p.x=x;p.y=y;p.life=30+Math.random()*70;return;}
    }
    p.life=0;
  };
  for(let i=0;i<N;i++){const p={};spawn(p);p.life*=Math.random();parts.push(p);}
  const step=()=>{
    if(!canvas.isConnected||canvas.dataset.stop==='1') return;
    ctx.globalCompositeOperation='destination-out';
    ctx.fillStyle='rgba(0,0,0,0.07)';
    ctx.fillRect(0,0,W,H);
    ctx.globalCompositeOperation='source-over';
    ctx.lineWidth=1.4; ctx.lineCap='round';
    for(const p of parts){
      if(--p.life<=0){spawn(p);continue;}
      const lon=proj.lonAt(p.x/W), lat=proj.latAt(p.y/H);
      const wv=gridWindUV(g,lon,lat);
      if(!wv){spawn(p);continue;}
      const k=0.09;
      const nx2=p.x+wv.u*k, ny2=p.y-wv.v*k;
      if(nx2<0||nx2>W||ny2<0||ny2>H){spawn(p);continue;}
      const a=Math.min(0.75,0.25+wv.spd/28);
      ctx.strokeStyle=ink; ctx.globalAlpha=a;
      ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineTo(nx2,ny2); ctx.stroke();
      p.x=nx2; p.y=ny2;
    }
    ctx.globalAlpha=1;
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ---------- schematic coast map ---------- */
function coastMap(parent, opts){
  // opts: {route:{inletId, zoneId}} — when set, draws departure→zone route and makes markers set the planner selects
  const B=MAPDATA.bounds;
  const W=640;
  const aspect=((B.lonMax-B.lonMin)*Math.cos(34.2*Math.PI/180))/(B.latMax-B.latMin);
  const H=Math.round(W/aspect);
  const wrap=el('div','chart',parent);
  const svg=svgEl('svg',{viewBox:`0 0 ${W} ${H}`,width:'100%',role:'img','aria-label':'Map of Southeast North Carolina inlets'},wrap);
  svg.style.overflow='hidden'; svg.style.borderRadius='10px';
  const X=lon=>(lon-B.lonMin)/(B.lonMax-B.lonMin)*W;
  const Y=lat=>(B.latMax-lat)/(B.latMax-B.latMin)*H;
  const P=(lon,lat)=>X(lon).toFixed(1)+' '+Y(lat).toFixed(1);

  // water wash
  svgEl('rect',{x:0,y:0,width:W,height:H,rx:10,fill:'var(--seq-100)','fill-opacity':0.16},svg);
  // gulf stream band
  const gs=MAPDATA.gulfstream;
  svgEl('path',{d:'M'+P(gs.a[0],gs.a[1])+' Q'+P(gs.c[0],gs.c[1])+' '+P(gs.b[0],gs.b[1]),
    fill:'none',stroke:'var(--seq-100)','stroke-width':30,'stroke-opacity':0.55,'stroke-linecap':'round'},svg);
  const gsMidX=X((gs.a[0]+2*gs.c[0]+gs.b[0])/4), gsMidY=Y((gs.a[1]+2*gs.c[1]+gs.b[1])/4);
  const gsAng=-Math.atan2(Y(gs.b[1])-Y(gs.a[1]),X(gs.b[0])-X(gs.a[0]))*-180/Math.PI;
  const gst=svgEl('text',{x:gsMidX,y:gsMidY+3,'text-anchor':'middle','font-size':10,fill:'var(--ink-3)',
    transform:`rotate(${gsAng.toFixed(1)} ${gsMidX.toFixed(1)} ${gsMidY.toFixed(1)})`,'letter-spacing':'2'},svg);
  gst.textContent='GULF STREAM →';

  // SST raster layer (toggleable) — prefer MUR satellite analysis, then NWP grid
  const grid=state.data.grid;
  const sstGrid=state.data.murGrid||grid;
  const sstSource=state.data.murGrid?'mur':(grid&&grid.live?'nwp':'demo');
  let sstMin=null,sstMax=null;
  if(sstGrid){
    const vals=sstGrid.sst.flat().filter(v=>v!=null);
    if(vals.length){ sstMin=Math.min(...vals)-0.2; sstMax=Math.max(...vals)+0.2; }
  }
  if(state.layers.sst&&sstGrid&&sstMin!=null){
    const r=buildSSTRaster(sstGrid,sstMin,sstMax);
    svgEl('image',{href:r.url,x:X(r.lonLo),y:Y(r.latHi),
      width:X(r.lonHi)-X(r.lonLo),height:Y(r.latLo)-Y(r.latHi),
      preserveAspectRatio:'none',opacity:1},svg);
  }
  // land
  const coastPts=MAPDATA.coast.map(([lo,la])=>P(lo,la)).join(' L');
  const first=MAPDATA.coast[0], last=MAPDATA.coast[MAPDATA.coast.length-1];
  svgEl('path',{d:'M'+coastPts+' L'+P(last[0],B.latMax)+' L'+P(B.lonMin,B.latMax)+' Z',
    fill:'var(--land)',stroke:'var(--axis)','stroke-width':1.2,'stroke-linejoin':'round'},svg);
  // bay label
  const bl=svgEl('text',{x:X(MAPDATA.bayLabel.lon),y:Y(MAPDATA.bayLabel.lat),'text-anchor':'middle','font-size':10,
    fill:'var(--ink-3)','font-style':'italic','letter-spacing':'1'},svg);
  bl.textContent=MAPDATA.bayLabel.text;

  // route (under markers)
  if(opts&&opts.route){
    const inl=CONFIG.inlets.find(i=>i.id===opts.route.inletId);
    const z=CONFIG.zones.find(z2=>z2.id===opts.route.zoneId);
    if(inl&&z){
      const x1=X(inl.lon),y1=Y(inl.lat),x2=X(z.lon),y2=Y(z.lat);
      svgEl('line',{x1,y1,x2,y2,stroke:'var(--accent)','stroke-width':2,'stroke-linecap':'round'},svg);
      const mx=(x1+x2)/2,my=(y1+y2)/2;
      const rt=svgEl('text',{x:mx,y:my-7,'text-anchor':'middle','font-size':10,'font-weight':600,fill:'var(--ink-2)',
        stroke:'var(--surface-1)','stroke-width':3,'paint-order':'stroke'},svg);
      rt.textContent='≈ '+z.run_nm+' nm';
    }
  }

  // Gulf Stream west wall — detected from the same SST field the map displays
  let front=[];
  if(sstGrid){
    const field=transectPoints().map(p=>({...p, sst:gridSample(sstGrid,sstGrid.sst,p.lon,p.lat)}));
    front=detectFront(field).filter(f=>f.g>=0.35); // drop noise-level gradients — no line beats a made-up line
    if(front.length>=3){
      const fp=front.map(f=>({x:X(f.lon),y:Y(f.lat)}));
      let d='M'+fp[0].x.toFixed(1)+' '+fp[0].y.toFixed(1);
      for(let i=1;i<fp.length;i++){
        const mx=((fp[i-1].x+fp[i].x)/2).toFixed(1), my=((fp[i-1].y+fp[i].y)/2).toFixed(1);
        d+=' Q'+fp[i-1].x.toFixed(1)+' '+fp[i-1].y.toFixed(1)+' '+mx+' '+my;
      }
      d+=' L'+fp[fp.length-1].x.toFixed(1)+' '+fp[fp.length-1].y.toFixed(1);
      svgEl('path',{d,fill:'none',stroke:'var(--series-2)','stroke-width':2.5,'stroke-linecap':'round','stroke-linejoin':'round'},svg);
      front.forEach(f=>{
        const x=X(f.lon),y=Y(f.lat);
        svgEl('circle',{cx:x,cy:y,r:4,fill:'var(--series-2)',stroke:'var(--surface-1)','stroke-width':2},svg);
        const hit=svgEl('circle',{cx:x,cy:y,r:13,fill:'transparent',cursor:'default'},svg);
        hit.addEventListener('pointermove',ev=>showTip(ev.clientX,ev.clientY,(f.weak?'Strongest SST front':'West wall')+' — off '+f.name,[
          {color:'var(--series-2)',val:'Δ '+f.g.toFixed(1)+' °C',lbl:'SST front strength'+(f.weak?' (weak)':'')},
          {val:(f.inshore*9/5+32).toFixed(0)+' °F',lbl:'inshore side'},
          {val:(f.offshore*9/5+32).toFixed(0)+' °F',lbl:'stream side'},
        ]));
        hit.addEventListener('pointerleave',hideTip);
      });
      const lp=fp[Math.min(1,fp.length-1)];
      const wl=svgEl('text',{x:lp.x+10,y:lp.y-8,'font-size':10,'font-weight':600,fill:'var(--ink-2)',
        stroke:'var(--surface-1)','stroke-width':3,'paint-order':'stroke'},svg);
      // only call it the west wall when most steps are strong; a weak line is just the strongest front we found
      const weakLine=front.filter(f=>f.weak).length>front.length/2;
      wl.textContent=(weakLine?'Strongest SST front':'West wall')+' · '+(sstSource==='mur'?'satellite SST':sstSource==='nwp'?'NWP SST':'demo SST');
    }
  }

  // offshore zone markers (diamonds)
  for(const z of CONFIG.zones){
    const x=X(z.lon),y=Y(z.lat);
    const sel=opts&&opts.route&&opts.route.zoneId===z.id;
    const g=svgEl('g',{transform:`rotate(45 ${x} ${y})`},svg);
    svgEl('rect',{x:x-5,y:y-5,width:10,height:10,rx:2,fill:sel?'var(--accent)':'var(--ink-3)',
      stroke:'var(--surface-1)','stroke-width':2},g);
    const zl=MAPDATA.zoneLabels[z.id];
    const zt=svgEl('text',{x:x+zl.dx,y:y+zl.dy,'text-anchor':zl.anchor,'font-size':10,'font-weight':600,fill:'var(--ink-2)',
      stroke:'var(--surface-1)','stroke-width':3,'paint-order':'stroke'},svg);
    zt.textContent=zl.text;
    const hit=svgEl('circle',{cx:x,cy:y,r:16,fill:'transparent',cursor:'pointer'},svg);
    hit.addEventListener('pointermove',ev=>{
      const rows=[{val:'≈ '+z.run_nm+' nm run',lbl:''}];
      if(sstGrid){
        const s=gridSample(sstGrid,sstGrid.sst,z.lon,z.lat);
        if(s!=null) rows.push({val:(s*9/5+32).toFixed(0)+' °F',lbl:'SST ('+(sstSource==='mur'?'satellite':sstSource.toUpperCase())+')'});
      }
      showTip(ev.clientX,ev.clientY,z.name,rows);
    });
    hit.addEventListener('pointerleave',hideTip);
    hit.addEventListener('click',()=>{
      if(opts&&opts.route){ $('#zoneSel').value=z.id; renderOffshore(); }
      else setView('offshore');
    });
  }

  // inlet markers, colored by current condition class
  for(const inl of CONFIG.inlets){
    const hours=state.scored.inlets[inl.id];
    const cls=hours&&hours.length?hours[0].cls:'warn';
    const meta=CLS_META[cls];
    const x=X(inl.lon),y=Y(inl.lat);
    const sel=opts&&opts.route&&opts.route.inletId===inl.id;
    if(sel) svgEl('circle',{cx:x,cy:y,r:11,fill:'none',stroke:'var(--accent)','stroke-width':2},svg);
    svgEl('circle',{cx:x,cy:y,r:6,fill:meta.color,stroke:'var(--surface-1)','stroke-width':2},svg);
    const lb=MAPDATA.labels[inl.id];
    const ldx=lb.dx+(sel&&lb.anchor==='start'?7:0);
    const tx=svgEl('text',{x:x+ldx,y:y+lb.dy+3,'text-anchor':lb.anchor,'font-size':10,'font-weight':600,fill:'var(--ink-2)',
      stroke:'var(--surface-1)','stroke-width':3,'paint-order':'stroke'},svg);
    tx.textContent=inl.short;
    const hit=svgEl('circle',{cx:x,cy:y,r:15,fill:'transparent',cursor:'pointer'},svg);
    hit.addEventListener('pointermove',ev=>{
      const now=hours&&hours[0];
      showTip(ev.clientX,ev.clientY,inl.name, now?[
        {color:meta.color,val:meta.ic+' '+meta.label,lbl:''},
        {val:now.hs+' ft @ '+now.tp+' s',lbl:'seas'},
        {val:now.wind+' kn '+compass(now.wdir??0),lbl:'wind'},
      ]:[]);
    });
    hit.addEventListener('pointerleave',hideTip);
    hit.addEventListener('click',()=>{
      hideTip();
      if(opts&&opts.route){ $('#depSel').value=inl.id; renderOffshore(); }
      else { state.detailInlet=inl.id; renderDetail(); setView('detail'); }
    });
  }

  // wind particle layer (toggleable) — canvas overlay, pointer-events none
  if(state.layers.wind&&grid){
    const cv=document.createElement('canvas');
    cv.width=W*2; cv.height=H*2;
    cv.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none;border-radius:10px;';
    wrap.appendChild(cv);
    startWindParticles(cv,grid,{
      lonAt:f=>B.lonMin+f*(B.lonMax-B.lonMin),
      latAt:f=>B.latMax-f*(B.latMax-B.latMin),
    });
  }

  // cursor readout — every overlay value reachable without tooltips
  if(grid&&(state.layers.sst||state.layers.wind)){
    const ro=el('div','mapreadout',wrap);
    svg.addEventListener('pointermove',ev=>{
      const r=svg.getBoundingClientRect();
      const lon=B.lonMin+(ev.clientX-r.left)/r.width*(B.lonMax-B.lonMin);
      const lat=B.latMax-(ev.clientY-r.top)/r.height*(B.latMax-B.latMin);
      const s=(state.layers.sst&&sstGrid)?gridSample(sstGrid,sstGrid.sst,lon,lat):null;
      const wv=state.layers.wind?gridWindUV(grid,lon,lat):null;
      const bits=[];
      if(s!=null) bits.push((s*9/5+32).toFixed(0)+' °F');
      if(wv) bits.push(wv.spd.toFixed(0)+' kn '+compass((Math.atan2(-wv.u,-wv.v)*180/Math.PI+360)%360));
      if(bits.length){ ro.textContent=bits.join(' · ')+(sstSource==='demo'&&!(grid&&grid.live)?' · demo':''); ro.style.display='block'; }
      else ro.style.display='none';
    });
    svg.addEventListener('pointerleave',()=>{ro.style.display='none';});
  }

  // SST scale legend (required for the semantic-heat ramp)
  if(state.layers.sst&&sstMin!=null){
    const lg=el('div','sstlegend',parent);
    const stops=SST_RAMP.map(s=>`rgb(${s[1][0]},${s[1][1]},${s[1][2]}) ${Math.round(s[0]*100)}%`).join(',');
    const bar=el('span','sstbar',lg); bar.style.background='linear-gradient(90deg,'+stops+')';
    const lo=el('span','',lg,(sstMin*9/5+32).toFixed(0)+' °F');
    lg.insertBefore(lo,bar);
    el('span','',lg,(sstMax*9/5+32).toFixed(0)+' °F');
    // MUR legend carries the analysis date + age — a blended analysis can lag real water by a day or more
    let murNote='';
    if(sstSource==='mur'&&sstGrid.time){
      murNote=' · analysis '+String(sstGrid.time).slice(0,10);
      const ageD=Math.round((Date.now()-new Date(sstGrid.time).getTime())/864e5);
      if(Number.isFinite(ageD)&&ageD>=0) murNote+=' ('+(ageD===0?'today':ageD+' d old')+')';
    }
    const srcTxt = sstSource==='mur'
      ? 'SST · MUR satellite analysis'+murNote
      : sstSource==='nwp' ? 'SST · NWP model analysis' : 'SST · demo';
    el('span','sstnote',lg,srcTxt);
  }

  // unmissable watermark when everything on this map is synthetic
  if(sstSource==='demo'&&!(grid&&grid.live)){
    const wm=svgEl('text',{x:W/2,y:H/2,'text-anchor':'middle','font-size':30,'font-weight':800,
      fill:'var(--ink-3)',opacity:0.32,'letter-spacing':'6',
      transform:`rotate(-16 ${W/2} ${H/2})`},svg);
    wm.textContent='DEMO DATA';
  }
  return wrap;
}

function layerToggles(head){
  const mk=(key,label)=>{
    const b=el('button','laybtn'+(state.layers[key]?' on':''),head,label);
    b.setAttribute('aria-pressed',String(state.layers[key]));
    b.addEventListener('click',()=>{
      state.layers[key]=!state.layers[key];
      renderInletCards(); renderOffshore();
    });
  };
  mk('sst','SST'); mk('wind','Wind');
}
