// Climatology for a region that has no tracked hills yet.
//
// A region page cannot show a season record it does not have, but the weather is
// the weather: the wet-bulb curve, when snowmaking normally first becomes
// possible, and how many October-November hours sit under 28F are all computable
// from a coordinate alone. This does for a handful of reference towns what
// curve.mjs, climatology.mjs and allhours.mjs do for hills, and writes the lot
// to data/places.json.
//
//   node scripts/places.mjs
//
// Pulls cache to data/cache/ like everything else. Places that borrow a hill's
// coordinates reuse that hill's cache file and cost nothing.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const THRESHOLD_F = 28;
const MIN_HOURS = 8;              // one night of blowing
const START_YEAR = 1995, END_YEAR = 2025;
const FROM = "08-23", TO = "12-31";
const SMOOTH = 3;                 // +/- days, so a centred 7-day mean
const CACHE = "data/cache";

const wetBulbC = (T, RH) =>
  T * Math.atan(0.151977 * Math.sqrt(RH + 8.313659)) + Math.atan(T + RH) -
  Math.atan(RH - 1.676331) + 0.00391838 * Math.pow(RH, 1.5) * Math.atan(0.023101 * RH) - 4.686035;
const THRESHOLD_C = (THRESHOLD_F - 32) * 5 / 9;

// `cache` names an existing pull to reuse. Trollhaugen already has thirty years
// on disk and stands for the St Croix valley perfectly well.
// `label` heads the tile, `name` is the coordinate actually measured. Madison
// and Milwaukee are close enough in wet-bulb terms to share a point, and the
// hills trend towards Madison anyway, so one reading stands for both — but the
// card still says where it was taken.
const PLACES = [
  { id: "madison",  region: "wi", label: "Madison \u2013 Milwaukee", name: "Madison",
    note: "Madison", lat: 43.0731, lon: -89.4012, curve: true },
  { id: "wausau",   region: "wi", label: "Wausau",        name: "Wausau",
    note: "Wausau", lat: 44.9591, lon: -89.6301 },
  { id: "st-croix", region: "wi", label: "St Croix",      name: "St Croix",
    note: "the St Croix valley", lat: 45.3572, lon: -92.6349, cache: "Trollhaugen" },
];

async function hourly(p) {
  const f = `${CACHE}/${(p.cache ?? p.name).replace(/\s+/g, "-")}.json`;
  if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8"));
  const url = "https://archive-api.open-meteo.com/v1/archive" +
    `?latitude=${p.lat}&longitude=${p.lon}` +
    `&start_date=${START_YEAR}-09-01&end_date=${END_YEAR}-12-31` +
    "&hourly=temperature_2m,relative_humidity_2m&timezone=America%2FChicago";
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url);
    if (res.ok) {
      const h = (await res.json()).hourly;
      writeFileSync(f, JSON.stringify(h));
      return h;
    }
    if (res.status !== 429) throw new Error(`${p.name}: HTTP ${res.status}`);
    process.stderr.write(` rate-limited, waiting ${20 * (attempt + 1)}s…`);
    await new Promise(r => setTimeout(r, 20000 * (attempt + 1)));
  }
  throw new Error(`${p.name}: still rate-limited after 6 attempts`);
}

// The mean wet-bulb by calendar day, smoothed the same way curve.mjs smooths it:
// day-to-day wiggle in a thirty-year average is sampling noise.
function curveOf(h) {
  const sum = new Map();
  for (let i = 0; i < h.time.length; i++) {
    const md = h.time[i].slice(5, 10);
    const T = h.temperature_2m[i], RH = h.relative_humidity_2m[i];
    if (T == null || RH == null) continue;
    if (!sum.has(md)) sum.set(md, [0, 0]);
    const e = sum.get(md);
    e[0] += wetBulbC(T, RH) * 9 / 5 + 32;
    e[1]++;
  }
  const daily = [...sum.entries()]
    .filter(([md]) => md >= FROM && md <= TO)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([md, [s, n]]) => ({ md, v: s / n }));

  const series = daily.map((_, i) => {
    const lo = Math.max(0, i - SMOOTH), hi = Math.min(daily.length - 1, i + SMOOTH);
    const w = daily.slice(lo, hi + 1);
    return { md: daily[i].md, v: +(w.reduce((a, p) => a + p.v, 0) / w.length).toFixed(2) };
  });

  // Read the crossing off the raw means, never the smoothed line.
  let crossing = null;
  for (let i = 1; i < daily.length; i++)
    if (daily[i - 1].v >= 28 && daily[i].v < 28) { crossing = daily[i].md; break; }
  return { series, crossing };
}

// First run of MIN_HOURS consecutive sub-threshold hours each autumn, credited to
// the day the run began — the same definition climatology.mjs uses for hills.
function windowOf(h) {
  const byYear = new Map();
  let run = 0;
  for (let i = 0; i < h.time.length; i++) {
    const T = h.temperature_2m[i], RH = h.relative_humidity_2m[i];
    if (+h.time[i].slice(5, 7) < 9 || T == null || RH == null) { run = 0; continue; }
    if (wetBulbC(T, RH) < THRESHOLD_C) {
      if (++run >= MIN_HOURS) {
        const y = +h.time[i].slice(0, 4);
        if (!byYear.has(y)) byYear.set(y, h.time[i - MIN_HOURS + 1].slice(5, 10));
      }
    } else run = 0;
  }
  const md = [...byYear.values()].sort();
  if (!md.length) return null;
  return { normal: md[Math.floor(md.length / 2)], earliest: md[0], latest: md.at(-1),
           years: md.length };
}

// October-November hours under the threshold, by year.
function hoursOf(h) {
  const acc = new Map();
  for (let i = 0; i < h.time.length; i++) {
    const m = +h.time[i].slice(5, 7);
    if (m !== 10 && m !== 11) continue;
    const T = h.temperature_2m[i], RH = h.relative_humidity_2m[i];
    if (T == null || RH == null) continue;
    if (wetBulbC(T, RH) < THRESHOLD_C) {
      const y = +h.time[i].slice(0, 4);
      acc.set(y, (acc.get(y) ?? 0) + 1);
    }
  }
  const v = [...acc.values()].sort((a, b) => a - b);
  return { normal: Math.round(v.reduce((a, b) => a + b, 0) / v.length),
           lean: v[0], fat: v.at(-1) };
}

mkdirSync(CACHE, { recursive: true });
const out = {};
for (const p of PLACES) {
  process.stderr.write(`${p.name} … `);
  const h = await hourly(p);
  const rec = {
    region: p.region, label: p.label, name: p.name, note: p.note, lat: p.lat, lon: p.lon,
    years: `${START_YEAR}–${END_YEAR}`,
    window: windowOf(h),
    hours: hoursOf(h),
  };
  if (p.curve) rec.curve = curveOf(h);
  out[p.id] = rec;
  process.stderr.write(`window ${rec.window.normal}, ${rec.hours.normal}h Oct–Nov\n`);
}
writeFileSync("data/places.json", JSON.stringify(out, null, 1) + "\n");
console.error(`\nwrote data/places.json — ${Object.keys(out).length} places`);
