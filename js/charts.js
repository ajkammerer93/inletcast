'use strict';
/* charts.js — tooltip machinery, multi-series line chart, status strip, tide chart. */

const tooltip=$('#tooltip');

/* tap-to-pin: pointerdown on a chart/strip/map value pins the tooltip until the next
   tap elsewhere — touch users get the same readouts hover users do. */
let tipPinned=false, tipPinEvent=null;
function pinTip(ev){ tipPinned=true; tipPinEvent=ev; }
function unpinTip(){ tipPinned=false; tipPinEvent=null; tooltip.style.display='none'; }
document.addEventListener('pointerdown',ev=>{
  if(ev===tipPinEvent) return;               // the tap that just pinned this tip
  if(tipPinned) unpinTip();
  if(typeof state!=='undefined') state.armedMarker=null;   // two-tap map markers disarm on any other tap
  // pinned map cursor readouts clear when the tap lands outside their map
  $$('.mapreadout').forEach(r=>{
    if(r.dataset.pin==='1'&&!(r.parentElement&&r.parentElement.contains(ev.target))){ r.dataset.pin=''; r.style.display='none'; }
  });
  // status-class popover dismisses on any tap outside it
  const cp=document.querySelector('.clspop');
  if(cp&&cp.style.display==='block'&&!cp.contains(ev.target)) cp.style.display='none';
});

function showTip(x,y,title,rows){
  tooltip.textContent='';
  el('div','tt-title',tooltip,title);
  for(const r of rows){
    const row=el('div','tt-row',tooltip);
    const key=el('span','tt-key',row); key.style.background=r.color||'transparent';
    el('span','tt-val',row,r.val);
    el('span','tt-lbl',row,r.lbl);
  }
  tooltip.style.display='block';
  const w=tooltip.offsetWidth,hgt=tooltip.offsetHeight;
  let left=x+14, top=y-hgt-10;
  if(left+w>window.innerWidth-8) left=x-w-14;
  if(top<8) top=y+14;
  tooltip.style.left=left+'px'; tooltip.style.top=top+'px';
}
function hideTip(force){ if(tipPinned&&!force) return; tooltip.style.display='none'; }

/* ---------- generic multi-series line chart (one axis) ---------- */
function lineChart(parent, opt){
  // opt: {series:[{name,color,t:[],v:[]}], unit, height, yMin, area, dayTicks, thresholds:[{y,label}]}
  const H=opt.height||180, padL=34, padR=14, padT=12, padB=22;
  const wrap=el('div','chart',parent);
  const W=Math.max(320, wrap.clientWidth||parent.clientWidth||640);
  const svg=svgEl('svg',{viewBox:`0 0 ${W} ${H}`,width:'100%',height:H,role:'img'},wrap);
  const plotW=W-padL-padR, plotH=H-padT-padB;
  const t0=opt.series[0].t[0], t1=opt.series[0].t[opt.series[0].t.length-1];
  const xOf=t=>padL+plotW*(t-t0)/(t1-t0);
  let vAll=[]; opt.series.forEach(s=>vAll=vAll.concat(s.v.filter(v=>v!=null)));
  let yMax=Math.max(...vAll)*1.15, yMin=opt.yMin!=null?opt.yMin:0;
  yMax=Math.max(yMax,yMin+1);
  // clean ticks
  const span=yMax-yMin, step=span>20?10:span>10?5:span>5?2:1;
  yMax=yMin+Math.ceil(span/step)*step;
  const yOf=v=>padT+plotH*(1-(v-yMin)/(yMax-yMin));
  // grid + y ticks
  for(let v=yMin;v<=yMax+0.001;v+=step){
    svgEl('line',{x1:padL,x2:W-padR,y1:yOf(v),y2:yOf(v),stroke:'var(--grid)','stroke-width':1},svg);
    const tx=svgEl('text',{x:padL-6,y:yOf(v)+3.5,'text-anchor':'end','font-size':10,fill:'var(--ink-3)'},svg);
    tx.textContent=String(Math.round(v)); tx.style.fontVariantNumeric='tabular-nums';
  }
  // x day ticks
  const dayStart=new Date(t0); dayStart.setHours(0,0,0,0);
  for(let d=new Date(dayStart);d<=t1;d.setDate(d.getDate()+1)){
    if(d<t0) continue;
    const x=xOf(d);
    svgEl('line',{x1:x,x2:x,y1:padT,y2:H-padB,stroke:'var(--grid)','stroke-width':1},svg);
    const tx=svgEl('text',{x:x+3,y:H-8,'font-size':10,fill:'var(--ink-3)'},svg);
    tx.textContent=dayLabel(d);
  }
  svgEl('line',{x1:padL,x2:W-padR,y1:H-padB,y2:H-padB,stroke:'var(--axis)','stroke-width':1},svg);
  // series
  for(const s of opt.series){
    const pts=s.t.map((t,i)=>s.v[i]==null?null:[xOf(t),yOf(s.v[i])]);
    const dStr=pts.map((p,i)=>p==null?'':(i===0||pts[i-1]==null?'M':'L')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join('');
    if(opt.area){
      const first=pts.find(p=>p), last=[...pts].reverse().find(p=>p);
      if(first&&last){
        const a=svgEl('path',{d:dStr+'L'+last[0].toFixed(1)+' '+(H-padB)+'L'+first[0].toFixed(1)+' '+(H-padB)+'Z',fill:s.color,'fill-opacity':0.1,stroke:'none'},svg);
      }
    }
    svgEl('path',{d:dStr,fill:'none',stroke:s.color,'stroke-width':2,'stroke-linejoin':'round','stroke-linecap':'round'},svg);
  }
  // direct end labels (selective; nudge apart if colliding)
  const ends=opt.series.map(s=>{
    const i=s.v.length-1; return {name:s.name,color:s.color,y:yOf(s.v[i]??yMin),v:s.v[i]};
  }).filter(e=>e.v!=null).sort((a,b)=>a.y-b.y);
  for(let i=1;i<ends.length;i++) if(ends[i].y-ends[i-1].y<12) ends[i].y=ends[i-1].y+12;
  for(const e of ends){
    svgEl('circle',{cx:W-padR,cy:e.y,r:4,fill:e.color,stroke:'var(--surface-1)','stroke-width':2},svg);
    const tx=svgEl('text',{x:W-padR-8,y:e.y-6,'text-anchor':'end','font-size':10,'font-weight':600,fill:'var(--ink-2)'},svg);
    tx.textContent=(Math.round(e.v*10)/10)+(opt.unit?' '+opt.unit:'');
  }
  // crosshair + tooltip
  const cross=svgEl('line',{x1:0,x2:0,y1:padT,y2:H-padB,stroke:'var(--axis)','stroke-width':1,visibility:'hidden'},svg);
  const dots=opt.series.map(s=>svgEl('circle',{r:4,fill:s.color,stroke:'var(--surface-1)','stroke-width':2,visibility:'hidden'},svg));
  const onMove=(ev,pin)=>{
    if(tipPinned&&!pin) return;              // a pinned readout holds until the next tap
    const r=svg.getBoundingClientRect();
    const px=(ev.clientX-r.left)*(W/r.width);
    if(px<padL||px>W-padR){if(pin)unpinTip();hideTip();cross.setAttribute('visibility','hidden');dots.forEach(d=>d.setAttribute('visibility','hidden'));return;}
    const frac=(px-padL)/plotW; const tt=new Date(t0.getTime()+frac*(t1-t0));
    const s0=opt.series[0];
    const idx=clamp(Math.round((tt-s0.t[0])/(s0.t[1]-s0.t[0])),0,s0.t.length-1);
    const snapX=xOf(s0.t[idx]);
    cross.setAttribute('x1',snapX);cross.setAttribute('x2',snapX);cross.setAttribute('visibility','visible');
    const rows=[];
    opt.series.forEach((s,si)=>{
      const v=s.v[idx];
      if(v!=null){ dots[si].setAttribute('cx',snapX); dots[si].setAttribute('cy',yOf(v)); dots[si].setAttribute('visibility','visible');
        rows.push({color:s.color,val:(Math.round(v*10)/10)+(opt.unit?' '+opt.unit:''),lbl:s.name}); }
      else dots[si].setAttribute('visibility','hidden');
    });
    const d=s0.t[idx];
    showTip(ev.clientX,ev.clientY,dayLabel(d)+' '+hourLabel(d),rows);
    if(pin) pinTip(ev);
  };
  svg.addEventListener('pointermove',ev=>onMove(ev,false));
  svg.addEventListener('pointerdown',ev=>onMove(ev,true));   // tap pins the crosshair + values
  svg.addEventListener('pointerleave',()=>{if(tipPinned)return;hideTip();cross.setAttribute('visibility','hidden');dots.forEach(d=>d.setAttribute('visibility','hidden'));});
  return wrap;
}

/* ---------- status strip (runs of condition classes) ---------- */
function statusStrip(parent, hours, opts){
  const compact=opts&&opts.compact;
  const H=compact?34:46, padB=compact?12:16, W=Math.max(300,parent.clientWidth||640);
  const wrap=el('div','strip',parent);
  const svg=svgEl('svg',{viewBox:`0 0 ${W} ${H}`,width:'100%',height:H},wrap);
  if(!hours.length) return wrap;
  const t0=hours[0].t, t1=hours[hours.length-1].t;
  const xOf=t=>W*((t-t0)/(t1-t0||1));
  // runs
  const runs=[]; let cur=null;
  for(const h of hours){
    if(cur&&cur.cls===h.cls){cur.to=h.t;cur.hrs.push(h);}
    else {if(cur)runs.push(cur); cur={cls:h.cls,from:h.t,to:h.t,hrs:[h]};}
  }
  if(cur)runs.push(cur);
  const barH=H-padB;
  runs.forEach((r,i)=>{
    const x=xOf(r.from), x2=(i===runs.length-1)?W:xOf(new Date(r.to.getTime()+36e5));
    const w=Math.max(1,x2-x-2); // 2px surface gap between runs
    const meta=CLS_META[r.cls];
    const rect=svgEl('rect',{x:x+1,y:0,width:w,height:barH,rx:4,fill:meta.color},svg);
    if(!compact&&w>58){
      const tx=svgEl('text',{x:x+1+w/2,y:barH/2+3.5,'text-anchor':'middle','font-size':10,'font-weight':700,
        fill:(r.cls==='warn'||r.cls==='serious')?'#3a2a00':'#fff'},svg);
      tx.textContent=meta.ic+' '+meta.label;
    }
    const showRun=(ev,pin)=>{
      if(tipPinned&&!pin) return;
      const mid=r.hrs[Math.floor(r.hrs.length/2)];
      showTip(ev.clientX,ev.clientY,timeRangeLabel(r.from,new Date(r.to.getTime()+36e5)),[
        {color:meta.color,val:meta.ic+' '+meta.label,lbl:''},
        {val:mid.hs+' ft @ '+mid.tp+' s',lbl:'seas'},
        {val:mid.wind+' kn',lbl:'wind '+compass(mid.wdir??0)},
        {val:mid.conf,lbl:'model agreement'},
      ]);
      if(pin) pinTip(ev);
    };
    rect.addEventListener('pointermove',ev=>showRun(ev,false));
    rect.addEventListener('pointerdown',ev=>showRun(ev,true));  // tap pins the run details
    rect.addEventListener('click',ev=>ev.stopPropagation());    // a strip tap reads values; it never opens the card
    rect.addEventListener('pointerleave',()=>hideTip());
  });
  // day labels
  const dayStart=new Date(t0); dayStart.setHours(0,0,0,0);
  for(let d=new Date(dayStart);d<=t1;d.setDate(d.getDate()+1)){
    if(d<t0)continue;
    const tx=svgEl('text',{x:xOf(d)+2,y:H-2,'font-size':9.5,fill:'var(--ink-3)'},svg);
    tx.textContent=dayLabel(d);
    svgEl('line',{x1:xOf(d),x2:xOf(d),y1:0,y2:barH,stroke:'var(--surface-1)','stroke-width':2},svg);
  }
  return wrap;
}
function stripLegend(parent){
  const lg=el('div','legend',parent);
  for(const k of ['good','warn','serious','critical']){
    const m=CLS_META[k]; const key=el('span','key',lg);
    const sw=el('span','sw',key); sw.style.background=m.color;
    el('span','',key,m.ic+' '+m.label);
  }
  return lg;
}

/* ---------- tide chart with ebb shading ---------- */
function tideChart(parent, tides, nHours){
  const start=state.scored.start;
  const sub=tides.filter(p=>p.t>=start&&p.t<=new Date(start.getTime()+nHours*36e5));
  const wrap=lineChart(parent,{series:[{name:'Predicted tide',color:'var(--seq-450)',t:sub.map(p=>p.t),v:sub.map(p=>p.v)}],unit:'ft',height:150,area:true,yMin:0});
  return wrap;
}
