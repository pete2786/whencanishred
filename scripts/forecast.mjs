// Pulls the 16-day wet-bulb forecast for every hill into data/forecast.json.
//
//   node scripts/forecast.mjs
//
// The page used to claim "live wet-bulb readings" over three numbers typed
// into the template by hand. On a static site rebuilt now and then, "right
// now" cannot be true. A forecast can be: it is a statement about the future
// made at a stated moment, so it stays honest as it ages as long as the page
// says when it was made. That is why every record here carries generatedAt.
//
// Open-Meteo serves wet_bulb_temperature_2m directly, so the 28°F snowmaking
// threshold needs no conversion from temperature and humidity. Same provider
// as the ERA5 climatology, same CC BY 4.0 credit already in the footer.

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const API = "https://api.open-meteo.com/v1/forecast";
const OUT = "data/forecast.json";
const THRESHOLD = 28;          // °F wet bulb: snow guns can run below this
const HORIZON = 16;            // days; the most Open-Meteo forecasts
const NIGHT = 8;               // hours in a row: what the climatology counts as a window

// The same points through four models, so a cold snap one model invents at
// day twelve can be checked against the others. Open-Meteo's best_match is
// GFS for these coordinates, which is the model behind every other field in
// this file. Each runs out at its own horizon: GEM near day ten, ICON near
// day seven. Past that a model has no opinion, and the file says null rather
// than letting silence read as warm.
const MODELS = {
  gfs:   { id: "gfs_seamless",  name: "GFS",   who: "American" },
  ecmwf: { id: "ecmwf_ifs025",  name: "ECMWF", who: "European" },
  gem:   { id: "gem_seamless",  name: "GEM",   who: "Canadian" },
  icon:  { id: "icon_seamless", name: "ICON",  who: "German" },
};

const resorts = JSON.parse(readFileSync("data/resorts.json", "utf8"));
// Regions with no tracked hills still get a forecast, taken at reference towns.
const places = existsSync("data/places.json")
  ? JSON.parse(readFileSync("data/places.json", "utf8")) : {};
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function forecast(lat, lon) {
  const q = new URLSearchParams({
    latitude: String(lat), longitude: String(lon),
    // Air temperature and humidity too, so the page can show what the wet bulb
    // at the coldest hour was worked out from.
    hourly: "wet_bulb_temperature_2m,temperature_2m,relative_humidity_2m",
    temperature_unit: "fahrenheit",
    forecast_days: String(HORIZON),
    timezone: "America/Chicago",
    models: ["best_match", ...Object.values(MODELS).map(m => m.id)].join(","),
  });
  const res = await fetch(`${API}?${q}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const raw = (await res.json()).hourly;
  // Asked for several models, every variable comes back suffixed with the
  // model's id. The best_match set goes back under the plain names, so
  // summarise reads it exactly as it did before there were models.
  const h = { time: raw.time, models: {} };
  for (const v of ["wet_bulb_temperature_2m", "temperature_2m", "relative_humidity_2m"]) {
    h[v] = raw[`${v}_best_match`];
  }
  for (const [key, m] of Object.entries(MODELS)) {
    h.models[key] = raw[`wet_bulb_temperature_2m_${m.id}`] ?? [];
  }
  if (!h.wet_bulb_temperature_2m) throw new Error("no wet bulb in response");
  return h;
}

// One model's run at one point: its coldest hour, how long the longest
// unbroken stretch under the threshold lasts, and the daily low for each day
// it reaches. The run length is what the climatology counts, eight hours or
// more, so it is what makes a cold hour a night of snowmaking.
function perModel(time, wb) {
  const days = [];
  let min = null, hoursUnder = 0, run = 0, longest = 0, lastHour = null, firstNight = null;
  for (let i = 0; i < time.length; i++) {
    const v = wb[i] ?? null;
    const day = time[i].slice(0, 10);
    if (!days.length || days.at(-1).date !== day) days.push({ date: day, low: null });
    if (v === null) { run = 0; continue; }
    lastHour = time[i];
    if (min === null || v < min) min = v;
    const d = days.at(-1);
    if (d.low === null || v < d.low) d.low = v;
    if (v < THRESHOLD) {
      hoursUnder++; longest = Math.max(longest, ++run);
      if (run === NIGHT && !firstNight) firstNight = time[i - NIGHT + 1];
    } else run = 0;
  }
  return { min, hoursUnder, longestRun: longest, firstNight, lastHour, daily: days.map(d => d.low) };
}

function summarise(h) {
  const wb = h.wet_bulb_temperature_2m;
  const cold = wb.map((v, i) => [v, i]).filter(([v]) => v !== null && v < THRESHOLD);
  const known = wb.map((v, i) => [v, i]).filter(([v]) => v !== null);
  if (!known.length) throw new Error("wet bulb all null");
  const [min, at] = known.reduce((a, b) => (b[0] < a[0] ? b : a));
  const models = Object.fromEntries(
    Object.keys(MODELS).map(k => [k, perModel(h.time, h.models[k])]));
  return {
    min,
    hoursUnder: cold.length,
    // The first hour the guns could run, which is the fact anyone waiting
    // on the season actually wants.
    firstWindow: cold.length ? h.time[cold[0][1]] : null,
    coldest: { time: h.time[at], temp: h.temperature_2m?.[at] ?? null,
               humidity: h.relative_humidity_2m?.[at] ?? null },
    models,
  };
}

const out = { generatedAt: new Date().toISOString(), horizonDays: HORIZON, threshold: THRESHOLD,
              models: Object.fromEntries(Object.entries(MODELS).map(([k, m]) => [k, { name: m.name, who: m.who }])),
              days: null, hills: {}, places: {} };

for (const [slug, r] of Object.entries(resorts)) {
  try {
    const h = await forecast(r.lat, r.lon);
    out.days ??= [...new Set(h.time.map(t => t.slice(0, 10)))];
    out.hills[slug] = summarise(h);
    process.stderr.write(`${slug.padEnd(19)} min ${out.hills[slug].min.toFixed(1)}F  ${out.hills[slug].hoursUnder}h under ${THRESHOLD}\n`);
  } catch (e) {
    // A hill that fails is recorded as unknown rather than as zero hours,
    // which would read as "no snowmaking weather" — a claim we did not earn.
    out.hills[slug] = { min: null, hoursUnder: null, firstWindow: null, error: String(e.message) };
    process.stderr.write(`${slug.padEnd(19)} ! ${e.message}\n`);
  }
  await sleep(600);
}

for (const [id, p] of Object.entries(places)) {
  try {
    const h = await forecast(p.lat, p.lon);
    out.days ??= [...new Set(h.time.map(t => t.slice(0, 10)))];
    out.places[id] = summarise(h);
    process.stderr.write(`${id.padEnd(19)} min ${out.places[id].min.toFixed(1)}F  ${out.places[id].hoursUnder}h under ${THRESHOLD}\n`);
  } catch (e) {
    out.places[id] = { min: null, hoursUnder: null, firstWindow: null, error: String(e.message) };
    process.stderr.write(`${id.padEnd(19)} ! ${e.message}\n`);
  }
  await sleep(600);
}

// --------------------------------------------------------- this season so far
//
// What has already happened at each hill since 1 September: the hours under the
// line, and the first full night, eight hours in a row. project.mjs pushes an
// opening back when the cold has not come, and needs to know whether it has.
//
// Open-Meteo serves the last 92 days alongside the forecast. A first night,
// once found, is kept: by mid-December a September night has fallen out of
// that window, and forgetting it would read as a fall that never got cold.
const SEASON_OUT = "data/this-season.json";
const nowCentral = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
}).format(new Date()).replace(" ", "T") + ":00";
const autumn = +nowCentral.slice(5, 7) >= 7 ? +nowCentral.slice(0, 4) : +nowCentral.slice(0, 4) - 1;
const seasonStart = `${autumn}-09-01T00:00`;
const kept = existsSync(SEASON_OUT) ? JSON.parse(readFileSync(SEASON_OUT, "utf8")) : null;
const keptHills = kept?.season === autumn ? kept.hills : {};

async function past(lat, lon) {
  const q = new URLSearchParams({
    latitude: String(lat), longitude: String(lon), hourly: "wet_bulb_temperature_2m",
    temperature_unit: "fahrenheit", past_days: "92", forecast_days: "1", timezone: "America/Chicago",
  });
  const res = await fetch(`${API}?${q}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()).hourly;
}

const season = { season: autumn, through: nowCentral, threshold: THRESHOLD, hills: {} };
for (const [slug, r] of Object.entries(resorts)) {
  const was = keptHills[slug] ?? {};
  try {
    const h = await past(r.lat, r.lon);
    let hours = 0, run = 0, firstNight = null;
    for (let i = 0; i < h.time.length; i++) {
      const t = h.time[i], v = h.wet_bulb_temperature_2m[i];
      if (t < seasonStart || t >= nowCentral) continue;
      if (v !== null && v < THRESHOLD) {
        hours++;
        if (++run === NIGHT && !firstNight) firstNight = h.time[i - NIGHT + 1];
      } else run = 0;
    }
    // The window only reaches back 92 days, so the hours count is a floor
    // once it stops covering September. The first night is not: it is kept.
    season.hills[slug] = {
      firstNight: was.firstNight ?? firstNight,
      hours: Math.max(hours, was.hours ?? 0),
    };
  } catch (e) {
    season.hills[slug] = { ...was, error: String(e.message) };
    process.stderr.write(`${slug.padEnd(19)} ! season: ${e.message}\n`);
  }
  await sleep(300);
}
writeFileSync(SEASON_OUT, JSON.stringify(season, null, 2) + "\n");

writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
const ok = Object.values(out.hills).filter(h => h.min !== null).length;
console.log(`\nwrote ${OUT} — ${ok}/${Object.keys(resorts).length} hills, ${Object.keys(out.places).length} places, ${HORIZON}-day horizon`);
