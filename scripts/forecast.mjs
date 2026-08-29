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

const resorts = JSON.parse(readFileSync("data/resorts.json", "utf8"));
// Regions with no tracked hills still get a forecast, taken at reference towns.
const places = existsSync("data/places.json")
  ? JSON.parse(readFileSync("data/places.json", "utf8")) : {};
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function forecast(lat, lon) {
  const q = new URLSearchParams({
    latitude: String(lat), longitude: String(lon),
    hourly: "wet_bulb_temperature_2m",
    temperature_unit: "fahrenheit",
    forecast_days: String(HORIZON),
    timezone: "America/Chicago",
  });
  const res = await fetch(`${API}?${q}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const h = (await res.json()).hourly;
  if (!h?.wet_bulb_temperature_2m) throw new Error("no wet bulb in response");
  return h;
}

const out = { generatedAt: new Date().toISOString(), horizonDays: HORIZON, threshold: THRESHOLD, hills: {}, places: {} };

for (const [slug, r] of Object.entries(resorts)) {
  try {
    const h = await forecast(r.lat, r.lon);
    const wb = h.wet_bulb_temperature_2m;
    const cold = wb.map((v, i) => [v, i]).filter(([v]) => v !== null && v < THRESHOLD);
    out.hills[slug] = {
      min: Math.min(...wb.filter(v => v !== null)),
      hoursUnder: cold.length,
      // The first hour the guns could run, which is the fact anyone waiting
      // on the season actually wants.
      firstWindow: cold.length ? h.time[cold[0][1]] : null,
    };
    process.stderr.write(`${slug.padEnd(19)} min ${out.hills[slug].min.toFixed(1)}F  ${cold.length}h under ${THRESHOLD}\n`);
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
    const wb = h.wet_bulb_temperature_2m;
    const cold = wb.map((v, i) => [v, i]).filter(([v]) => v !== null && v < THRESHOLD);
    out.places[id] = {
      min: Math.min(...wb.filter(v => v !== null)),
      hoursUnder: cold.length,
      firstWindow: cold.length ? h.time[cold[0][1]] : null,
    };
    process.stderr.write(`${id.padEnd(19)} min ${out.places[id].min.toFixed(1)}F  ${cold.length}h under ${THRESHOLD}\n`);
  } catch (e) {
    out.places[id] = { min: null, hoursUnder: null, firstWindow: null, error: String(e.message) };
    process.stderr.write(`${id.padEnd(19)} ! ${e.message}\n`);
  }
  await sleep(600);
}

writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
const ok = Object.values(out.hills).filter(h => h.min !== null).length;
console.log(`\nwrote ${OUT} — ${ok}/${Object.keys(resorts).length} hills, ${Object.keys(out.places).length} places, ${HORIZON}-day horizon`);
