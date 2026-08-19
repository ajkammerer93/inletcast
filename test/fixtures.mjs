// Canned API responses shaped like the real services the app calls.

function hourlyTimes(days = 8) {
  const out = [];
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(0);
  for (let h = 0; h < days * 24; h++) {
    const d = new Date(start.getTime() + h * 3600e3);
    const p = (n) => String(n).padStart(2, '0');
    out.push(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:00`);
  }
  return out;
}

function series(n, base, amp, period, phase = 0) {
  return Array.from({ length: n }, (_, i) => +(base + amp * Math.sin((i / period) * 2 * Math.PI + phase)).toFixed(2));
}

export function marinePoint() {
  const t = hourlyTimes();
  const n = t.length;
  const mk = (b, a, p, ph) => series(n, b, a, p, ph);
  const h = { time: t };
  for (const m of ['ncep_gfswave025', 'ecmwf_wam025']) {
    const ph = m.startsWith('gfs') ? 0 : 0.3;
    h['wave_height_' + m] = mk(2.4, 1.1, 36, ph);
    h['wave_period_' + m] = mk(8.5, 2.5, 48, ph);
    h['wave_direction_' + m] = mk(120, 30, 60, ph).map(Math.round);
    h['swell_wave_height_' + m] = mk(1.8, 0.8, 36, ph);
    h['swell_wave_period_' + m] = mk(10, 2, 48, ph);
    h['swell_wave_direction_' + m] = mk(130, 20, 60, ph).map(Math.round);
  }
  return { hourly: h };
}

export function windPoint() {
  const t = hourlyTimes();
  const n = t.length;
  const h = { time: t };
  for (const m of ['gfs_seamless', 'ecmwf_ifs025']) {
    const ph = m.startsWith('gfs') ? 0 : 0.4;
    h['wind_speed_10m_' + m] = series(n, 11, 6, 24, ph);
    h['wind_direction_10m_' + m] = series(n, 200, 60, 48, ph).map(Math.round);
    h['wind_gusts_10m_' + m] = series(n, 16, 8, 24, ph);
  }
  return { hourly: h };
}

export function tides() {
  const t = hourlyTimes();
  return {
    predictions: t.map((s, i) => ({
      t: s.replace('T', ' '),
      v: (2.2 + 2 * Math.sin((i / 12.42) * 2 * Math.PI)).toFixed(3),
    })),
  };
}

// Multi-location responses: array with one entry per requested lat.
export function gridMarine(count) {
  const t = hourlyTimes(1);
  return Array.from({ length: count }, (_, k) => ({
    hourly: { time: t, sea_surface_temperature: series(t.length, 26 + (k % 9) * 0.3, 0.4, 24) },
  }));
}

export function gridWind(count) {
  const t = hourlyTimes(1);
  return Array.from({ length: count }, (_, k) => ({
    hourly: {
      time: t,
      wind_speed_10m: series(t.length, 10 + (k % 5), 3, 24),
      wind_direction_10m: series(t.length, 210, 40, 24).map(Math.round),
    },
  }));
}

export function murGrid() {
  const rows = [];
  const latMin = 33.52, latMax = 34.95, lonMin = -78.25, lonMax = -75.6;
  const nLat = 13, nLon = 23;
  for (let i = 0; i < nLat; i++) {
    for (let j = 0; j < nLon; j++) {
      const lat = +(latMin + (i * (latMax - latMin)) / (nLat - 1)).toFixed(3);
      const lon = +(lonMin + (j * (lonMax - lonMin)) / (nLon - 1)).toFixed(3);
      // warm offshore (east), cool inshore, with a front
      const sst = 25 + 4 / (1 + Math.exp(-(lon + 76.6) * 6)) + 0.2 * Math.sin(lat * 7);
      rows.push(['2026-08-17T09:00:00Z', lat, lon, +sst.toFixed(2)]);
    }
  }
  return { table: { columnNames: ['time', 'latitude', 'longitude', 'analysed_sst'], rows } };
}

function countLocs(url) {
  const m = url.match(/latitude=([^&]*)/);
  return m ? m[1].split(',').length : 1;
}

// Returns a fetch-stub function. `failFn(url, callCounts)` returning true makes that request fail.
export function makeFetchStub(failFn = () => false) {
  const calls = [];
  const stub = async (url) => {
    url = String(url);
    calls.push(url);
    if (failFn(url, calls)) {
      return { ok: false, status: 503, json: async () => ({}) };
    }
    let body;
    if (url.includes('marine-api.open-meteo.com') && url.includes('wave_height')) {
      body = marinePoint();
    } else if (url.includes('marine-api.open-meteo.com') && url.includes('sea_surface_temperature')) {
      const n = countLocs(url);
      body = n > 1 ? gridMarine(n) : gridMarine(1)[0];
    } else if (url.includes('api.open-meteo.com') && url.includes('wind_gusts_10m')) {
      body = windPoint();
    } else if (url.includes('api.open-meteo.com') && url.includes('wind_speed_10m')) {
      const n = countLocs(url);
      body = n > 1 ? gridWind(n) : gridWind(1)[0];
    } else if (url.includes('tidesandcurrents.noaa.gov')) {
      body = tides();
    } else if (url.includes('coastwatch')) {
      body = murGrid();
    } else {
      return { ok: false, status: 404, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => body };
  };
  stub.calls = calls;
  return stub;
}
