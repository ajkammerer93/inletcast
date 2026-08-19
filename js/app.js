'use strict';
/* app.js — global state, boot sequence, and event wiring (tabs, theme, filters, routing, staleness). */

const state = {
  mode: 'demo',            // 'live' | 'demo' | 'mixed'
  liveNote: '',
  boatFactor: 1.0,
  boatKey: '1.0',
  area: 'all',
  layers: { sst:true, wind:true },
  view: 'inlets',
  detailInlet: null,
  lastCardInlet: null,     // card that opened the current detail view — refocused on back
  showTable: {},
  armedMarker: null,       // two-tap map markers on touch: which marker's info is showing
  data: { inlets:{}, zones:{}, tides:{} },  // filled incrementally by loadData
  scored: null,
  fetchedAt: null,
  refreshing: false,
};

/* staleness thresholds: refetch quietly past the soft limit when the tab comes back,
   turn the badge amber past the hard limit */
const STALE_SOFT_MS=60*60e3;
const STALE_HARD_MS=90*60e3;
const THEME_KEY='inletcast_theme'; // also read by the pre-paint inline script in index.html

/* a settled source re-scores and re-renders whatever view is on screen */
function onSourceSettled(){
  scoreAll();
  renderActiveView();
}
async function refreshData(){
  if(state.refreshing) return;
  state.refreshing=true;
  const t=$('#modeText'); if(t) t.textContent='Refreshing…';
  try{
    await loadData(onSourceSettled,true); // user asked for a refresh — bypass the fresh cache
    updateModeBadge();
    renderAll();
  } finally { state.refreshing=false; }
}
function onBadgeClick(){
  // stale badge is a refresh button; otherwise it opens the source breakdown (which
  // itself carries a refresh button, so refresh is always reachable here)
  if(state.fetchedAt&&Date.now()-state.fetchedAt.getTime()>STALE_HARD_MS){ refreshData(); return; }
  toggleModeSources();
}
function maybeRefresh(){
  if(document.visibilityState&&document.visibilityState!=='visible') return;
  if(state.fetchedAt&&Date.now()-state.fetchedAt.getTime()>STALE_SOFT_MS) refreshData();
}

/* ---------- boot ---------- */
async function boot(){
  $('#appVer').textContent='v'+APP_VERSION;
  $$('nav.tabs button').forEach(btn=>btn.addEventListener('click',()=>setView(btn.dataset.view)));
  // roving tabindex: Left/Right arrows move focus through the tablist; Enter/Space activates
  const tabBtns=$$('nav.tabs button');
  $('nav.tabs').addEventListener('keydown',e=>{
    if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight') return;
    const i=tabBtns.indexOf(document.activeElement); if(i<0) return;
    e.preventDefault();
    const j=(i+(e.key==='ArrowRight'?1:-1)+tabBtns.length)%tabBtns.length;
    tabBtns.forEach((b,k)=>b.tabIndex=k===j?0:-1);
    tabBtns[j].focus();
  });
  $('#themeBtn').addEventListener('click',()=>{
    const r=document.documentElement;
    const cur=r.getAttribute('data-theme');
    const dark=window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark=cur?cur==='dark':dark;
    const next=isDark?'light':'dark';
    r.setAttribute('data-theme',next);
    try{ localStorage.setItem(THEME_KEY,next); }catch(e){}
    renderActiveView(); // restyle only — scores are theme-independent, so no scoreAll here
  });
  // the banner doubles as the Terms acknowledgment: dismissal is remembered per device
  const ACK_KEY='inletcast_ack_v1';
  let acked=false;
  try{ acked=localStorage.getItem(ACK_KEY)==='1'; }catch(e){}
  if(acked){ const bn=$('#banner'); if(bn) bn.remove(); }
  else $('#bannerClose').addEventListener('click',()=>{
    try{ localStorage.setItem(ACK_KEY,'1'); }catch(e){}
    $('#banner').remove();
  });
  // terms links switch views in-app; without JS the #view-terms fragment still works via CSS :target
  $$('a[href="#view-terms"]').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();setView('terms');}));
  $('#modeBadge').addEventListener('click',onBadgeClick);
  $('#boatSel').addEventListener('change',e=>{state.boatKey=e.target.value;state.boatFactor=parseFloat(e.target.value);renderAll();});
  $('#areaSel').addEventListener('change',e=>{state.area=e.target.value;renderInletCards();});
  // hash routing: back button and shared per-inlet links drive the view
  window.addEventListener('hashchange',applyRoute);
  // hidden-at-boot views render lazily; the active one re-renders on viewport changes
  let resizeT=null;
  const queueRerender=()=>{ clearTimeout(resizeT); resizeT=setTimeout(()=>{ renderActiveView(); },200); };
  window.addEventListener('resize',queueRerender);
  window.addEventListener('orientationchange',queueRerender);
  // staleness: refetch when the tab returns to an old forecast; flip the badge amber over time
  document.addEventListener('visibilitychange',maybeRefresh);
  window.addEventListener('focus',maybeRefresh);
  setInterval(()=>{ if(state.fetchedAt&&!state.refreshing) updateModeBadge(); },60e3);
  // offline app shell: precached by the service worker (guarded — jsdom and older browsers lack it)
  if('serviceWorker' in navigator){
    try{ navigator.serviceWorker.register('sw.js').catch(()=>{}); }catch(e){}
  }

  // first paint: skeleton cards from CONFIG, before any fetch resolves
  scoreAll();
  applyRoute();
  // then hydrate card-by-card as sources settle
  await loadData(onSourceSettled);
  updateModeBadge();
  renderAll();
}
boot();
