'use strict';
/* views.js — all render* functions and view plumbing. */

/* ---------- views & routing ----------
   Hash routes: #/inlets, #/offshore, #/models, #/method, #/inlet/<id> (plus the
   no-JS #view-terms fragment). setView applies the view, renders it lazily (hidden
   views have zero width — charts must only draw while visible), and syncs the hash
   so browser back works and per-inlet links are shareable. */
function hashFor(v){
  return v==='detail' ? '#/inlet/'+state.detailInlet : v==='terms' ? '#view-terms' : '#/'+v;
}
function titleFor(v){
  const base='InletCast';
  if(v==='detail'){ const inl=CONFIG.inlets.find(i=>i.id===state.detailInlet); if(inl) return inl.name+' — '+base; }
  const t={offshore:'Offshore planner',models:'Model agreement',method:'How InletCast works',terms:'Terms of Use'}[v];
  return t?t+' — '+base:base+' — NC Inlet Condition Windows (Prototype)';
}
function setView(v){
  state.view=v;
  $$('.view').forEach(x=>x.classList.remove('active'));
  $('#view-'+(v==='detail'?'detail':v)).classList.add('active');
  $$('nav.tabs button').forEach(b=>b.classList.toggle('active',b.dataset.view===v||(v==='detail'&&b.dataset.view==='inlets')));
  renderActiveView();           // after the class flip, so charts measure a visible container
  document.title=titleFor(v);
  const h=hashFor(v);
  // don't force '#/inlets' onto a clean URL — keeps the first back press from being a no-op
  if(location.hash!==h&&!(h==='#/inlets'&&location.hash==='')){ try{ location.hash=h; }catch(e){} }
  window.scrollTo({top:0});
}
// parse the current hash and apply it (boot, hashchange, browser back)
function applyRoute(){
  const h=location.hash||'';
  const m=h.match(/^#\/inlet\/([\w-]+)$/);
  if(m&&CONFIG.inlets.some(i=>i.id===m[1])){ state.detailInlet=m[1]; setView('detail'); }
  else if(h==='#/offshore') setView('offshore');
  else if(h==='#/models') setView('models');
  else if(h==='#/method') setView('method');
  else if(h==='#view-terms'||h==='#/terms') setView('terms');
  else setView('inlets');
}
// render only what is on screen; hidden views re-render on their next activation
function renderActiveView(){
  const v=state.view;
  if(v==='inlets') renderInletCards();
  else if(v==='detail') renderDetail();
  else if(v==='offshore') renderOffshore();
  else if(v==='models') renderModels();
  else if(v==='method') renderMethod();
}

function chipFor(cls, extra){
  const m=CLS_META[cls];
  const c=document.createElement('span');
  c.className='chip '+cls;
  c.textContent=m.ic+' '+m.label+(extra?(' '+extra):'');
  // every status chip explains itself: tap for the four class definitions
  c.title='What do these classes mean? Tap for definitions';
  c.style.cursor='pointer';
  c.addEventListener('click',e=>{e.stopPropagation();showClassPopover(e.clientX,e.clientY);});
  return c;
}
// point-of-use definitions of the four classes — same wording the Method tab uses (CLS_META)
function showClassPopover(x,y){
  let pop=document.querySelector('.clspop');
  if(!pop) pop=el('div','clspop',document.body);
  pop.textContent='';
  el('h5','',pop,'What the classes mean');
  for(const k of ['good','warn','serious','critical']){
    const m=CLS_META[k];
    const row=el('div','clsrow',pop);
    el('span','chip '+k,row,m.ic+' '+m.label);
    el('span','clsdef',row,m.desc);
  }
  el('p','clsnote',pop,CLS_NOTE+' Scored for a '+(CONFIG.boats[state.boatKey]||'')+' boat.');
  pop.style.display='block';
  const w=pop.offsetWidth||280, hgt=pop.offsetHeight||200;
  const iw=window.innerWidth||800, ih=window.innerHeight||600;
  pop.style.left=Math.max(8,Math.min(x-20,iw-w-8))+'px';
  pop.style.top=Math.max(8,(y+hgt+20>ih?y-hgt-12:y+12))+'px';
}
// "scored for [boat class] — change" microcopy under the view title
function updateBoatNote(){
  const n=$('#boatNote'); if(!n) return;
  n.textContent='';
  n.append('Scored for a '+(CONFIG.boats[state.boatKey]||'')+' boat — ');
  const b=el('button','linkbtn',n,'change');
  b.addEventListener('click',()=>{const s=$('#boatSel'); if(s){s.focus(); s.scrollIntoView&&s.scrollIntoView({block:'nearest'});}});
}
// unmissable per-source synthetic-data marker (rendered wherever a live:false source feeds the UI)
function simChip(parent){
  const c=el('span','chip sim',parent,'⚠ SIMULATED — source unreachable');
  return c;
}
// which sources fell back to synthetic data (drives the mode-badge breakdown)
function failedSources(){
  const out=[];
  const d=state.data; if(!d) return out;
  CONFIG.inlets.forEach(i=>{const s=d.inlets[i.id]; if(s&&s.live===false) out.push(i.name+' — inlet forecast');});
  CONFIG.zones.forEach(z=>{const s=d.zones[z.id]; if(s&&s.live===false) out.push(z.name+' — offshore zone');});
  const seen=new Set();
  CONFIG.inlets.forEach(i=>{
    const t=d.tides[i.tideSta];
    if(t&&t.live===false&&!seen.has(i.tideSta)){ seen.add(i.tideSta); out.push('Tide station '+i.tideSta+' ('+i.tideName+')'); }
  });
  if(d.grid&&d.grid.live===false) out.push('Map SST / wind grid layers');
  return out;
}

function renderInletCards(){
  const mp=$('#coastPanel');
  if(mp){
    mp.textContent='';
    const mh=el('div','maphead',mp); el('h4','',mh,'The coast at a glance');
    el('span','',mh,'markers show current conditions — tap one to open the inlet');
    const sp=el('span','spacer',mh); layerToggles(mh);
    coastMap(mp);
    stripLegend(mp).style.padding='6px 4px 4px';
  }
  updateBoatNote();
  const grid=$('#inletCards'); grid.textContent='';
  const inlets=CONFIG.inlets.filter(i=>state.area==='all'||i.area===state.area);
  for(const inl of inlets){
    const hours=state.scored.inlets[inl.id];
    // skeleton card until this inlet's sources settle — the grid appears instantly at boot
    if(!hours||!hours.length){
      const sk=el('div','card skeleton',grid);
      const h3s=el('h3','',sk); h3s.textContent=inl.name; el('span','area',h3s,inl.area);
      el('div','skelbar w60',sk);
      el('div','skelbar strip',sk);
      el('div','skelnote',sk,'Loading forecast…');
      continue;
    }
    const now=hours[0];
    const card=el('div','card',grid);
    card.setAttribute('role','button'); card.tabIndex=0;
    const h3=el('h3','',card); h3.textContent=inl.name; el('span','area',h3,inl.area);
    const dLive=state.data.inlets[inl.id].live!==false;
    const chiprow=el('div','',card); chiprow.style.margin='6px 0 2px';
    chiprow.appendChild(chipFor(now.cls));
    if(!dLive){const s=simChip(chiprow);s.style.marginLeft='6px';}
    if(now.conf==='low'){const g=el('span','chip ghost',chiprow,'models disagree');g.style.marginLeft='6px';}
    const stats=el('div','statrow',card);
    const s1=el('div','stat',stats); el('div','lbl',s1,'Seas'); el('div','val',s1,now.hs+' ft'); el('div','sub',s1,'@ '+now.tp+' s '+compass(now.dir));
    const s2=el('div','stat',stats); el('div','lbl',s2,'Wind'); el('div','val',s2,now.wind+' kn'); el('div','sub',s2,compass(now.wdir??0)+(now.gst?' G'+now.gst:''));
    const s3=el('div','stat',stats); el('div','lbl',s3,'Tide');
    el('div','val',s3, now.tideLive?(now.ebb>0.45?'Ebb':now.ebb>0.05?'Falling':'Flood/slack'):'No data');
    el('div','sub',s3, now.tideLive&&now.tideH!=null?now.tideH.toFixed(1)+' ft MLLW':'');
    statusStrip(card,hours.slice(0,CONFIG.hoursDetail),{compact:true});
    const wins=findWindows(hours,CONFIG.hoursDetail);
    const nw=el('div','nextwin',card);
    if(!dLive) nw.textContent='Data unavailable — check official NWS forecasts.';
    else if(now.cls==='good'&&wins.length){ nw.textContent='Scores favorable now — holds until '; const b=el('strong','',nw,timeRangeLabel(wins[0].from,new Date(wins[0].to.getTime()+36e5)).split('–').pop()); }
    else if(wins.length){ nw.textContent='Next window: '; el('strong','',nw,timeRangeLabel(wins[0].from,new Date(wins[0].to.getTime()+36e5))); }
    else nw.textContent='No favorable window in the next 72 h for this boat size.';
    const open=()=>{state.detailInlet=inl.id; setView('detail');};
    card.addEventListener('click',open);
    card.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}});
  }
}

function renderDetail(){
  const view=$('#view-detail'); view.textContent='';
  const inl=CONFIG.inlets.find(i=>i.id===state.detailInlet); if(!inl) return;
  const hours=state.scored.inlets[inl.id];
  const back=el('button','backbtn',view,'← All inlets');
  back.addEventListener('click',()=>setView('inlets'));
  // deep link opened before this inlet's sources settled — hold a skeleton, hydration re-renders
  if(!state.data.inlets[inl.id]||!hours||!hours.length){
    const headL=el('div','detailhead',view);
    el('h2','',headL,inl.name);
    const pl=el('div','panel',view);
    el('div','skelbar w60',pl); el('div','skelbar strip',pl);
    el('p','skelnote',pl,'Loading forecast…');
    return;
  }
  const head=el('div','detailhead',view);
  const h2=el('h2','',head,inl.name);
  head.appendChild(chipFor(hours[0].cls));
  const dLive=state.data.inlets[inl.id].live!==false;
  if(!dLive) simChip(head);
  if(hours[0].conf==='low') el('span','chip ghost',head,'models disagree');
  el('p','inletnote',view,inl.note);

  // windows
  const p0=el('div','panel',view);
  el('h4','',p0,'Condition windows — next 72 h');
  el('p','psub',p0,'Boat class: '+(CONFIG.boats[state.boatKey]||'')+' · tide station: '+inl.tideName);
  if(!dLive) el('p','psub simnote',p0,'Forecast source unreachable — the strip and windows below are simulated samples. Check official NWS marine forecasts before planning.');
  statusStrip(p0,hours.slice(0,CONFIG.hoursDetail),{});
  stripLegend(p0);
  const wins=findWindows(hours,CONFIG.hoursDetail);
  const wl=el('div','windowlist',p0);
  if(!wins.length) el('div','windowrow',wl,'No favorable windows in the next 72 h at this boat size — check the Marginal periods in the strip above and the hourly table.');
  wins.slice(0,5).forEach(w=>{
    const row=el('div','windowrow',wl);
    el('span','when',row,timeRangeLabel(w.from,new Date(w.to.getTime()+36e5)));
    const mid=hours.find(h=>h.t>=w.from);
    el('span','why',row,mid?whyText(mid):'');
    if(w.conf==='low') row.appendChild(chipFor('warn')); // shouldn't happen for good runs; guard
  });

  // why now
  const now=hours[0];
  const p1=el('div','panel',view);
  el('h4','',p1,'Why it’s scored this way right now');
  const fc=el('div','factorchips',p1);
  const f1=el('span','fchip',fc); f1.append('Sea state '); el('b','',f1,'−'+now.pSea); f1.append(' · '+now.hs+' ft @ '+now.tp+' s '+compass(now.dir));
  const f2=el('span','fchip',fc); f2.append('Wind '); el('b','',f2,'−'+now.pWind); f2.append(' · '+now.wind+' kn '+compass(now.wdir??0));
  const f3=el('span','fchip',fc); f3.append('Tide × bar '); el('b','',f3,'−'+now.pTide);
  f3.append(' · '+(now.tideLive?(now.ebb>0.45?'ebb':now.ebb>0.05?'falling':'flood/slack')+(now.opp>0.5?' against the swell':''):'tide unavailable — excluded'));
  const f5=el('span','fchip',fc); f5.append('Bar break '); el('b','',f5,'−'+now.pBar);
  f5.append(' · shoaled-height proxy '+now.hb+' ft');
  const f4=el('span','fchip',fc); f4.append('Score '); el('b','',f4,String(now.score)+' / 100');

  // wave chart
  const p2=el('div','panel',view);
  const ph2=el('div','panelhead',p2); el('h4','',ph2,'Significant wave height — model comparison'); el('span','spacer',ph2);
  el('p','psub',p2,'Nearshore point off the inlet. Two independent wave models; divergence = lower confidence.');
  const d=state.data.inlets[inl.id];
  const n=CONFIG.hoursDetail;
  const mt=d.marine.t.filter(t=>t>=state.scored.start).slice(0,n);
  const i0=d.marine.t.findIndex(t=>t>=state.scored.start);
  lineChart(p2,{series:[
    {name:'GFS-Wave',color:'var(--series-1)',t:mt,v:d.marine.gfs.hs.slice(i0,i0+n)},
    {name:'ECMWF-WAM',color:'var(--series-2)',t:mt,v:d.marine.ecmwf.hs.slice(i0,i0+n)},
  ],unit:'ft',height:190});
  const lg=el('div','legend',p2);
  [['GFS-Wave','var(--series-1)'],['ECMWF-WAM','var(--series-2)']].forEach(([nm,c])=>{
    const k=el('span','key',lg); const lk=el('span','lk',k); lk.style.background=c; el('span','',k,nm);
  });

  // wind chart
  const p3=el('div','panel',view);
  el('h4','',p3,'Wind — model comparison');
  el('p','psub',p3,'10 m wind at the nearshore point, knots.');
  const wt=d.wind.t.filter(t=>t>=state.scored.start).slice(0,n);
  const wi0=d.wind.t.findIndex(t=>t>=state.scored.start);
  lineChart(p3,{series:[
    {name:'GFS',color:'var(--series-1)',t:wt,v:d.wind.gfs.spd.slice(wi0,wi0+n)},
    {name:'ECMWF',color:'var(--series-2)',t:wt,v:d.wind.ecmwf.spd.slice(wi0,wi0+n)},
  ],unit:'kn',height:170});
  const lg3=el('div','legend',p3);
  [['GFS','var(--series-1)'],['ECMWF','var(--series-2)']].forEach(([nm,c])=>{
    const k=el('span','key',lg3); const lk=el('span','lk',k); lk.style.background=c; el('span','',k,nm);
  });

  // tide chart — never claim CO-OPS for a synthetic tide
  const tRec=state.data.tides[inl.tideSta];
  const p4=el('div','panel',view);
  if(tRec&&tRec.live){
    el('h4','',p4,'Predicted tide — '+inl.tideName);
    el('p','psub',p4,'NOAA CO-OPS predictions, ft MLLW. Falling limb = ebb over the bar.');
    el('p','psub',p4,'Timing from '+inl.tideName+'; slack at the mouth can lag the station by an hour or more — the ebb term is widened to cover that.');
  }else{
    const th=el('h4','',p4,'SIMULATED TIDE — do not use for timing');
    simChip(th).style.marginLeft='8px';
    el('p','psub simnote',p4,'The tide station was unreachable; this curve is a synthetic sample with a random phase. It is excluded from the score. Get real tides from NOAA CO-OPS before timing a crossing.');
  }
  if(tRec) tideChart(p4,tRec.pts,CONFIG.hoursDetail);

  // hourly table (a11y twin)
  const p5=el('div','panel',view);
  const ph5=el('div','panelhead',p5); el('h4','',ph5,'Hourly detail');
  el('span','spacer',ph5);
  // touch devices default the table open — it is the no-hover twin of every chart value
  const showT=state.showTable[inl.id]!=null?state.showTable[inl.id]:isCoarse();
  const tbtn=el('button','iconbtn',ph5, showT?'Hide table':'Show table');
  tbtn.addEventListener('click',()=>{state.showTable[inl.id]=!showT;renderDetail();});
  if(showT){
    const wrapT=el('div','tablewrap',p5);
    const tb=el('table','data',wrapT);
    const thr=el('tr','',el('thead','',tb));
    ['Time','Seas ft','Period s','Swell dir','Wind kn','Tide','Score','Class','Agreement'].forEach(h=>el('th','',thr,h));
    const tbody=el('tbody','',tb);
    hours.slice(0,CONFIG.hoursDetail).forEach(h=>{
      const tr=el('tr','',tbody);
      el('td','',tr,dayLabel(h.t)+' '+hourLabel(h.t));
      el('td','',tr,String(h.hs)); el('td','',tr,String(h.tp)); el('td','',tr,compass(h.dir));
      el('td','',tr,h.wind+' '+compass(h.wdir??0));
      el('td','',tr,h.ebb>0.45?'ebb':h.ebb>0.05?'falling':'flood/slack');
      el('td','',tr,String(h.score));
      el('td','',tr,CLS_META[h.cls].ic+' '+CLS_META[h.cls].label);
      el('td','',tr,h.conf);
    });
  } else el('p','psub',p5,'Every value in the charts above, hour by hour, without hovering.');

  // sample outlook — canned illustration of the planned paid-tier note; muted styling + tag so it never reads as current guidance
  const p6=el('div','panel sample',view);
  const ph6=el('div','panelhead',p6);
  el('h4','',ph6,'The written outlook');
  el('span','chip ghost sampletag',ph6,'SAMPLE — illustrative, not a current forecast');
  const ol=el('div','outlook',p6);
  el('div','byline',ol,'Illustrative sample of the weekly forecaster note planned for the paid tier · AJ Kammerer');
  el('p','',ol,'Long-period SE energy hangs around while the pressure gradient stays slack — mornings look like the play, with light land breezes early and a building seabreeze chop after lunch. The inlets that care about period (Carolina Beach, New River) will be sportier than the raw heights suggest on the afternoon ebbs.');
  el('p','',ol,'Watch the next trough: the models split on how fast it digs in. GFS is faster and windier; the ECMWF holds the ridge another day. If the ECMWF verifies, a legitimate Gulf Stream window opens before the wind returns.');
}

/* ---------- offshore planner ---------- */
function segScore(zoneHours, inletHours, dayStart, fromH, toH, useInlet){
  // average over local hours [fromH,toH) on that day
  let worst=null, arr=[];
  const src=useInlet?inletHours:zoneHours;
  for(const h of src){
    const local=h.t;
    if(local>=dayStart&&local<new Date(dayStart.getTime()+864e5)){
      const hr=local.getHours();
      if(hr>=fromH&&hr<toH){ arr.push(h); if(!worst||clsRank(h.cls)>clsRank(worst.cls)) worst=h; }
    }
  }
  if(!arr.length) return null;
  const avg=Math.round(arr.reduce((s,h)=>s+h.score,0)/arr.length);
  return {avg, cls:worst.cls, sample:arr[Math.floor(arr.length/2)]};
}

function renderOffshore(){
  const body=$('#offshoreBody'); body.textContent='';
  const depSel=$('#depSel'), zoneSel=$('#zoneSel');
  if(!depSel.options.length){
    CONFIG.inlets.forEach(i=>{const o=document.createElement('option');o.value=i.id;o.textContent=i.name;depSel.appendChild(o);});
    depSel.value='newtopsail';
    CONFIG.zones.forEach(z=>{const o=document.createElement('option');o.value=z.id;o.textContent=z.name;zoneSel.appendChild(o);});
    depSel.addEventListener('change',renderOffshore);
    zoneSel.addEventListener('change',renderOffshore);
  }
  const inl=CONFIG.inlets.find(i=>i.id===depSel.value);
  const zone=CONFIG.zones.find(z=>z.id===zoneSel.value);
  const zd=state.data.zones[zone.id];
  // sources still settling (view opened mid-load) — hydration re-renders when they land
  if(!zd||!state.data.inlets[inl.id]){ el('p','viewsub',body,'Loading forecast data…'); return; }
  // score the zone point hours through the shared core (tide/bar terms off, wind-against-Stream on)
  const zoneHours=[];
  for(let i=0;i<CONFIG.hoursPlanner;i++){
    const h=zoneScoreHour(zone,new Date(state.scored.start.getTime()+i*36e5),state.boatFactor);
    if(h) zoneHours.push(h);
  }
  const inletHours=state.scored.inlets[inl.id];

  el('p','viewsub',body,zone.note+' Run ≈ '+zone.run_nm+' nm each way from '+inl.name+'. Segments: run out 4–8 am (inlet + open water), on the grounds 8 am–2 pm, run home 2–6 pm.');
  const zLive=zd.live!==false, depLive=state.data.inlets[inl.id].live!==false;
  if(!zLive||!depLive){
    const sr=el('div','',body); sr.style.margin='2px 0 8px';
    if(!zLive){const c=simChip(sr); c.textContent='⚠ SIMULATED — '+zone.name+' source unreachable'; c.style.marginRight='6px';}
    if(!depLive){const c=simChip(sr); c.textContent='⚠ SIMULATED — '+inl.name+' source unreachable';}
    el('p','psub simnote',sr,'Day plans below include simulated segments — check official NWS offshore forecasts.');
  }

  const mapP=el('div','panel mappanel',body);
  const mh=el('div','maphead',mapP); el('h4','',mh,'The run');
  el('span','',mh,'tap an inlet or a zone to change the plan');
  const sp2=el('span','spacer',mh); layerToggles(mh);
  coastMap(mapP,{route:{inletId:inl.id, zoneId:zone.id}});

  const cards=el('div','daycards',body);
  for(let dIdx=0;dIdx<7;dIdx++){
    const dayStart=new Date(state.scored.start); dayStart.setHours(0,0,0,0); dayStart.setDate(dayStart.getDate()+dIdx);
    if(dIdx===0&&state.scored.start.getHours()>=14) continue;
    const segOutInlet=segScore(zoneHours,inletHours,dayStart,4,8,true);
    const segOutSea=segScore(zoneHours,inletHours,dayStart,5,9,false);
    const segFish=segScore(zoneHours,inletHours,dayStart,8,14,false);
    const segHomeSea=segScore(zoneHours,inletHours,dayStart,13,18,false);
    const segHomeInlet=segScore(zoneHours,inletHours,dayStart,14,19,true);
    const segs=[
      ['Inlet at first light',segOutInlet],['Run out',segOutSea],['On the grounds',segFish],['Run home',segHomeSea],['Inlet on return',segHomeInlet],
    ].filter(s=>s[1]);
    if(!segs.length) continue;
    let worst='good', avg=0;
    segs.forEach(([,s])=>{if(clsRank(s.cls)>clsRank(worst))worst=s.cls;avg+=s.avg;});
    avg=Math.round(avg/segs.length);
    const card=el('div','daycard',cards);
    const h5=el('h5','',card);
    el('span','',h5,dayLabel(dayStart)+' '+(dayStart.getMonth()+1)+'/'+dayStart.getDate());
    h5.appendChild(chipFor(worst));
    const lowConf=segs.some(([,s])=>s.sample.conf==='low');
    if(lowConf){const g=el('div','',card);g.style.margin='4px 0';el('span','chip ghost',g,'models disagree');}
    for(const [name,s] of segs){
      const row=el('div','segrow',card);
      el('span','segname',row,name);
      const val=el('span','segval',row);
      const dot=el('span','segdot',val); dot.style.background=CLS_META[s.cls].color;
      val.append(CLS_META[s.cls].ic+' '+s.sample.hs+' ft · '+s.sample.wind+' kn');
    }
  }

  // 7-day offshore wave chart
  const p=el('div','panel',body);
  const ph=el('h4','',p,'Offshore seas at the grounds — 7 days, model comparison');
  if(!zLive) simChip(ph).style.marginLeft='8px';
  el('p','psub',p,'Significant wave height at '+zone.name+(zLive?'.':' — simulated sample, source unreachable.'));
  const mt=zd.marine.t.filter(t=>t>=state.scored.start).slice(0,CONFIG.hoursPlanner);
  const i0=zd.marine.t.findIndex(t=>t>=state.scored.start);
  lineChart(p,{series:[
    {name:'GFS-Wave',color:'var(--series-1)',t:mt,v:zd.marine.gfs.hs.slice(i0,i0+CONFIG.hoursPlanner)},
    {name:'ECMWF-WAM',color:'var(--series-2)',t:mt,v:zd.marine.ecmwf.hs.slice(i0,i0+CONFIG.hoursPlanner)},
  ],unit:'ft',height:190});
  const lg=el('div','legend',p);
  [['GFS-Wave','var(--series-1)'],['ECMWF-WAM','var(--series-2)']].forEach(([nm,c])=>{
    const k=el('span','key',lg); const lk=el('span','lk',k); lk.style.background=c; el('span','',k,nm);
  });
}

/* ---------- model agreement view ---------- */
function renderModels(){
  const body=$('#modelsBody'); body.textContent='';
  const sel=$('#modelInletSel');
  if(!sel.options.length){
    CONFIG.inlets.forEach(i=>{const o=document.createElement('option');o.value=i.id;o.textContent=i.name;sel.appendChild(o);});
    sel.addEventListener('change',renderModels);
  }
  const inl=CONFIG.inlets.find(i=>i.id===sel.value)||CONFIG.inlets[0];
  const d=state.data.inlets[inl.id];
  // source still settling (view opened mid-load) — hydration re-renders when it lands
  if(!d){ el('p','viewsub',body,'Loading forecast data…'); return; }
  const n=CONFIG.hoursPlanner;
  const i0=d.marine.t.findIndex(t=>t>=state.scored.start);
  const mt=d.marine.t.slice(i0,i0+n);
  // agreement stat
  const hsG=d.marine.gfs.hs.slice(i0,i0+n), hsE=d.marine.ecmwf.hs.slice(i0,i0+n);
  let diffs=[]; for(let i=0;i<Math.min(hsG.length,hsE.length);i++){if(hsG[i]!=null&&hsE[i]!=null)diffs.push(Math.abs(hsG[i]-hsE[i]));}
  const mad=diffs.length?(diffs.reduce((a,b)=>a+b,0)/diffs.length):0;
  const agree= mad<0.6?'High':mad<1.2?'Moderate':'Low';

  const p0=el('div','panel',body);
  el('h4','',p0,'Agreement over the next 7 days — '+inl.name);
  const fc=el('div','factorchips',p0);
  const c1=el('span','fchip',fc); c1.append('Mean model spread '); el('b','',c1,mad.toFixed(1)+' ft');
  const c2=el('span','fchip',fc); c2.append('Agreement '); el('b','',c2,agree);
  el('p','psub',p0,'Spread is the average absolute difference in significant wave height between GFS-Wave and ECMWF-WAM. Rule of thumb: under 0.6 ft, plan on the consensus; over 1.2 ft, wait for the next model cycle before committing to a long run.');

  const p1=el('div','panel',body);
  el('h4','',p1,'Wave height — 7 days');
  lineChart(p1,{series:[
    {name:'GFS-Wave',color:'var(--series-1)',t:mt,v:hsG},
    {name:'ECMWF-WAM',color:'var(--series-2)',t:mt,v:hsE},
  ],unit:'ft',height:200});
  const lg=el('div','legend',p1);
  [['GFS-Wave','var(--series-1)'],['ECMWF-WAM','var(--series-2)']].forEach(([nm,c])=>{
    const k=el('span','key',lg); const lk=el('span','lk',k); lk.style.background=c; el('span','',k,nm);
  });

  const wi0=d.wind.t.findIndex(t=>t>=state.scored.start);
  const wt=d.wind.t.slice(wi0,wi0+n);
  const p2=el('div','panel',body);
  el('h4','',p2,'Wind — 7 days');
  lineChart(p2,{series:[
    {name:'GFS',color:'var(--series-1)',t:wt,v:d.wind.gfs.spd.slice(wi0,wi0+n)},
    {name:'ECMWF',color:'var(--series-2)',t:wt,v:d.wind.ecmwf.spd.slice(wi0,wi0+n)},
  ],unit:'kn',height:180});
  const lg2=el('div','legend',p2);
  [['GFS','var(--series-1)'],['ECMWF','var(--series-2)']].forEach(([nm,c])=>{
    const k=el('span','key',lg2); const lk=el('span','lk',k); lk.style.background=c; el('span','',k,nm);
  });
}

/* ---------- method ---------- */
function renderMethod(){
  const b=$('#methodBody'); if(b.childNodes.length) return;
  const add=(h,t)=>{if(h)el('h4','',b,h);el('p','',b,t);};
  add(null,'InletCast is a prototype by Ghosttree Technical Solutions, LLC — a working demonstration of inlet-scale condition guidance for the Southeast NC coast, built by a forecaster who runs these inlets.');
  add('Data','Wave guidance comes from two independent operational wave models (NOAA GFS-Wave and ECMWF WAM) at a nearshore point off each inlet, via the Open-Meteo API (weather data by Open-Meteo.com, CC BY 4.0 — link in the footer). Winds are GFS and ECMWF 10 m fields. Tides are NOAA CO-OPS harmonic predictions from the nearest reference station. When live sources are unreachable, the app runs on clearly-labeled synthetic demo data so you can still explore the interface.');
  add('The score','Each hour gets a 0–100 score built from four transparent penalties: sea state (height and short-period steepness), wind (speed, gusts, onshore component), a bar-breaking term — a shoaled-height proxy that grows with swell period and each inlet’s shoaling factor, because long-period energy is what shoals, jacks, and breaks on an ebb delta — and the tide term: ebb strength multiplied by how directly the swell opposes the channel, weighted by each inlet’s shoaling behavior. Swell direction and period come from the models’ swell partition when available, so wind chop cannot hide an opposed ground swell. The ebb strength is deliberately widened about ±90 minutes, since the tide stations are timing proxies. On top of the score, hard overrides force Hazardous whenever the raw sea height can break a shoal bar — regardless of boat class, which scales comfort, never a breaking bar — and a strong ebb against a long-period swell over a shoal bar forces at least Rough. Nothing is a black box: the "why" panel shows every penalty.');
  // single-sourced from CLS_META so the status-chip popover and this paragraph never drift
  add('What the classes mean',['good','warn','serious','critical'].map(k=>{const m=CLS_META[k];return m.label+' ('+m.ic+'): '+m.desc;}).join(' ')+' '+CLS_NOTE);
  add('What this prototype does not yet do','No inlet-specific bathymetry or surf-zone wave transformation (the production version applies a per-inlet shoaling model tuned against buoy and camera verification); no real-time buoy assimilation; no USACE survey ingestion; tide stations are nearest-reference proxies for some inlets; no current predictions at the inlet mouth; wind against the Stream is only a crude opposing-wind heuristic, not a current or eddy model; no convection or thunderstorm input for the afternoon return legs. Every one of these is on the roadmap — and the scoring will be verified publicly against buoy observations, the standard way operational marine models are verified.');
  add('Map layers','The SST fill prefers the MUR 1-km satellite-blended SST analysis (NASA/JPL, served by NOAA CoastWatch) — cloud-tolerant, because it blends many satellite passes, but smoother than single-pass imagery — and falls back to smoothed NWP-model SST, then labeled demo data, if unreachable. The legend shows the analysis date and age when available. Wind streamlines are sampled from NWP 10 m winds on a grid across Onslow Bay, bilinearly interpolated; the particle animation follows the interpolated wind exactly, in the style of the freesurfforecast swell map. Toggle layers with the SST / Wind buttons; the cursor readout at the bottom-left gives exact interpolated values. Note that in mid-summer the true SST contrast across the west wall is at its annual minimum — a faint August wall is the ocean, not a bug — which is why chlorophyll and altimetry are the planned complements.');
  add('The Gulf Stream line','The orange front line on the map is detected live from the same SST field the map displays — the MUR 1-km satellite-blended analysis when it is reachable, otherwise NWP-model SST. We sample that field along five cross-shelf transects, place a point at the strongest temperature step on each line, and connect them. When the steps are strong the line is a fair read on the west wall; when they are weak the map labels it "strongest SST front" instead, because a blended analysis can smear a faint summer wall. On the NWP fallback (~25 km analysis) it is good enough to see whether the stream is riding in or pushed offshore, not good enough to find a finger or an eddy edge. Production versions would blend single-pass satellite SST (GOES, VIIRS) and ocean model output (RTOFS) for chart-service-grade edges. Treat it as orientation, not navigation.');
  add('The honest caveat','A forecast cannot see today’s bar. Inlets shoal, channels move, and a model point a few miles offshore is not the standing wave on the ebb delta. Treat every window as a hypothesis to verify with your eyes, official NWS forecasts, and local knowledge.');
  el('p','sig',b,'Built by AJ Kammerer · Ghosttree Technical Solutions, LLC · Hampstead, NC — prototype v'+APP_VERSION+', August 2026.');
}

function renderAll(){
  scoreAll();
  renderActiveView();
  renderMethod(); // static text, no sizing — safe to build eagerly
}
function updateModeBadge(){
  const b=$('#modeBadge'), t=$('#modeText');
  b.classList.toggle('live',state.mode==='live');
  const time=state.fetchedAt?state.fetchedAt.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}):'';
  // past the hard threshold the badge turns amber and becomes a one-tap refresh
  const stale=state.fetchedAt&&(Date.now()-state.fetchedAt.getTime())>STALE_HARD_MS;
  b.classList.toggle('stale',!!stale);
  t.textContent = stale ? 'Stale · fetched '+time+' — tap to refresh'
    : state.mode==='live' ? 'Live data · '+time
    : state.mode==='mixed' ? 'Partial live · '+time
    : 'Demo data (offline sample)';
  // source breakdown dropdown (opened by clicking the badge)
  const p=$('#modeSources'); if(!p) return;
  p.textContent='';
  const fails=failedSources();
  if(fails.length){
    el('h5','',p,'Simulated sources — unreachable');
    const ul=el('ul','',p);
    fails.forEach(f=>el('li','sim',ul,f));
    el('p','',p,'Everything not listed is live. Verify against official NWS forecasts.');
  } else {
    el('h5','',p,'Data sources');
    el('p','',p,state.mode==='live'?'All sources live.':'Source status unavailable.');
  }
  // refresh is always one tap away via the badge dropdown
  const rb=el('button','iconbtn refreshbtn',p,'↻ Refresh data now');
  rb.addEventListener('click',()=>{toggleModeSources();refreshData();});
}
function toggleModeSources(){
  const b=$('#modeBadge'), p=$('#modeSources');
  const open=p.hasAttribute('hidden');
  if(open) p.removeAttribute('hidden'); else p.setAttribute('hidden','');
  b.setAttribute('aria-expanded',open?'true':'false');
}
