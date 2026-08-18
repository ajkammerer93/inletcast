'use strict';
/* app.js — global state, boot sequence, and event wiring (tabs, theme, filters). */

const state = {
  mode: 'demo',            // 'live' | 'demo' | 'mixed'
  liveNote: '',
  boatFactor: 1.0,
  boatKey: '1.0',
  area: 'all',
  layers: { sst:true, wind:true },
  view: 'inlets',
  detailInlet: null,
  showTable: {},
  data: null,              // { inlets:{id:{hours:[...]}}, zones:{id:{hours}}, tides:{sta:[{t,v}]} }
  scored: null,
  fetchedAt: null,
};

/* ---------- boot ---------- */
async function boot(){
  $('#appVer').textContent='v'+APP_VERSION;
  $$('nav.tabs button').forEach(btn=>btn.addEventListener('click',()=>setView(btn.dataset.view)));
  $('#themeBtn').addEventListener('click',()=>{
    const r=document.documentElement;
    const cur=r.getAttribute('data-theme');
    const dark=window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark=cur?cur==='dark':dark;
    r.setAttribute('data-theme',isDark?'light':'dark');
    renderAll(); // re-render for chart chrome colors baked into SVG attrs via CSS vars (vars resolve live, but re-render keeps layout fresh)
  });
  $('#bannerClose').addEventListener('click',()=>$('#banner').remove());
  $('#boatSel').addEventListener('change',e=>{state.boatKey=e.target.value;state.boatFactor=parseFloat(e.target.value);renderAll();});
  $('#areaSel').addEventListener('change',e=>{state.area=e.target.value;renderInletCards();});
  await loadData();
  updateModeBadge();
  renderAll();
}
boot();
