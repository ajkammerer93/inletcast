'use strict';
/* config.js — constants: app version, inlet/zone/station definitions, boat classes, map data, overlay grid spec. */

const APP_VERSION='0.6';

const CONFIG = {
  hoursDetail: 72,
  hoursPlanner: 168,
  inlets: [
    { id:'newtopsail', name:'New Topsail Inlet', short:'New Topsail', area:'Topsail',
      lat:34.342, lon:-77.645, wLat:34.30, wLon:-77.58, tideSta:'8658163', tideName:'Wrightsville Beach (proxy)',
      bearing:140, shoal:1.30,
      note:'Unjettied and migrating; the outer bar shifts after every blow. Ebb against a SE ground swell stacks it up fast on the bar.' },
    { id:'newriver', name:'New River Inlet', short:'New River', area:'Topsail',
      lat:34.527, lon:-77.336, wLat:34.48, wLon:-77.28, tideSta:'8658163', tideName:'Wrightsville Beach (proxy)',
      bearing:138, shoal:1.35,
      note:'Shoaly and narrow; local knowledge matters more than anywhere else on this stretch. Short-period wind swell closes it out quickly.' },
    { id:'masonboro', name:'Masonboro Inlet', short:'Masonboro', area:'Wilmington',
      lat:34.182, lon:-77.801, wLat:34.14, wLon:-77.74, tideSta:'8658163', tideName:'Wrightsville Beach',
      bearing:112, shoal:1.00,
      note:'Dual-jettied and maintained — the most forgiving inlet on this coast, but a strong ebb against an E–SE swell still makes the entrance sloppy.' },
    { id:'carolinabeach', name:'Carolina Beach Inlet', short:'Carolina Bch', area:'Wilmington',
      lat:34.076, lon:-77.876, wLat:34.04, wLon:-77.82, tideSta:'8658163', tideName:'Wrightsville Beach (proxy)',
      bearing:120, shoal:1.50,
      note:'Notoriously shoal, unjettied, and dredge-dependent. Breaks across the channel in a modest ESE swell — the classic "looked fine from inside" inlet.' },
    { id:'capefear', name:'Cape Fear River Entrance', short:'Cape Fear', area:'Wilmington',
      lat:33.843, lon:-78.011, wLat:33.78, wLon:-77.97, tideSta:'8659084', tideName:'Southport',
      bearing:172, shoal:0.95,
      note:'Big, deep shipping channel — but a long-period S swell against max ebb over Frying Pan Shoals rips. Watch commercial traffic.' },
    { id:'bogue', name:'Bogue Inlet', short:'Bogue', area:'Crystal Coast',
      lat:34.641, lon:-77.105, wLat:34.58, wLon:-77.07, tideSta:'8656483', tideName:'Beaufort (proxy)',
      bearing:158, shoal:1.35,
      note:'Channel wanders between dredge cycles. S–SE swell over the bar on the ebb is the hazard pattern.' },
    { id:'beaufort', name:'Beaufort Inlet', short:'Beaufort', area:'Crystal Coast',
      lat:34.662, lon:-76.674, wLat:34.60, wLon:-76.64, tideSta:'8656483', tideName:'Beaufort, Duke Marine Lab',
      bearing:175, shoal:0.90,
      note:'Deep, marked shipping channel to Morehead City — the standard Big Rock departure. Ebb chop at the sea buoy in a S blow, but rarely closes.' },
  ],
  zones: [
    { id:'bigrock', name:'The Big Rock zone (off Beaufort)', lat:34.20, lon:-75.90, run_nm:50,
      note:'~50 nm SSE of Beaufort Inlet toward the 100-fathom curve.' },
    { id:'sameole', name:'Gulf Stream — Same Ole / Steeples (off Masonboro)', lat:33.70, lon:-77.05, run_nm:55,
      note:'~55 nm SE of Masonboro Inlet.' },
  ],
  boats: { '1.25':'18–22 ft', '1.0':'23–27 ft', '0.8':'28 ft +' },
};

/* ---------------- schematic coast map data ---------------- */
const MAPDATA = {
  bounds: { lonMin:-78.32, lonMax:-75.55, latMin:33.48, latMax:34.99 },
  // simplified shoreline, SW → NE (lon, lat)
  coast: [
    [-78.32,33.92],[-78.10,33.91],[-78.02,33.90],[-77.99,33.87],[-77.963,33.843],
    [-77.93,33.95],[-77.90,34.02],[-77.876,34.076],[-77.84,34.13],[-77.80,34.18],
    [-77.79,34.22],[-77.74,34.29],[-77.645,34.34],[-77.54,34.43],[-77.42,34.50],
    [-77.336,34.53],[-77.24,34.58],[-77.15,34.62],[-77.105,34.64],[-76.95,34.67],
    [-76.80,34.695],[-76.674,34.695],[-76.60,34.67],[-76.53,34.60],[-76.51,34.63],[-76.52,34.72]
  ],
  // gulf stream band control points (lon,lat): start, quadratic control, end
  gulfstream: { a:[-77.75,33.36], c:[-76.65,33.95], b:[-75.63,34.62] },
  bayLabel: { lon:-77.35, lat:34.22, text:'Onslow Bay' },
  labels: {
    newtopsail:   {dx:9,  dy:3,  anchor:'start'},
    newriver:     {dx:9,  dy:0,  anchor:'start'},
    masonboro:    {dx:9,  dy:1,  anchor:'start'},
    carolinabeach:{dx:9,  dy:11, anchor:'start'},
    capefear:     {dx:2,  dy:16, anchor:'middle'},
    bogue:        {dx:-2, dy:17, anchor:'middle'},
    beaufort:     {dx:9,  dy:13, anchor:'start'},
  },
  zoneLabels: { bigrock:{dx:0,dy:18,anchor:'middle',text:'Big Rock'}, sameole:{dx:0,dy:18,anchor:'middle',text:'Same Ole / Steeples'} },
  // cross-shelf SST transects (inshore → offshore) for Gulf Stream west-wall detection
  transects: [
    { name:'Cape Fear',  lon0:-77.95, lat0:33.80, dLon:0.085, dLat:-0.062, n:10 },
    { name:'Masonboro',  lon0:-77.75, lat0:34.12, dLon:0.090, dLat:-0.058, n:10 },
    { name:'Topsail',    lon0:-77.58, lat0:34.30, dLon:0.095, dLat:-0.055, n:10 },
    { name:'Bogue',      lon0:-77.05, lat0:34.58, dLon:0.085, dLat:-0.065, n:10 },
    { name:'Lookout',    lon0:-76.55, lat0:34.55, dLon:0.075, dLat:-0.070, n:10 },
  ],
};
function transectPoints(){
  const pts=[];
  MAPDATA.transects.forEach((tr,ti)=>{
    for(let i=0;i<tr.n;i++) pts.push({ti, i, lon:tr.lon0+tr.dLon*i, lat:tr.lat0+tr.dLat*i});
  });
  return pts;
}

/* overlay grid spec for the SST / wind map fields */
const GRID={lonMin:-78.25, lonMax:-75.60, latMin:33.52, latMax:34.95, dLon:0.20, dLat:0.18};
