// A second wet-bulb forecast, from Xweather, into data/forecast-xweather.json.
//
//   XWEATHER_CLIENT_ID=... XWEATHER_CLIENT_SECRET=... node scripts/forecast-xweather.mjs
//
// Same points and same shape as forecast.mjs, so the build can set the two side
// by side. Kept as its own script, like powder.mjs: Xweather being down or the
// keys going missing must not be able to touch the Open-Meteo forecast.
//
// Xweather does not serve a psychrometric wet bulb. Its wetBulbGlobeTemp is
// WBGT, a heat-stress index that folds in sun and wind, and is not the number
// the 28°F snowmaking threshold is about. So the wet bulb is computed here from
// temperature and humidity with Stull (2011). Open-Meteo computes its own the
// same way (checked against its hourly output: within 0.1°C, the rounding of
// its inputs), so the two forecasts are compared on one formula.
//
// Free tier is 15,000 calls a month. One call per point, 34 points, twice a
// day is about 2,000.

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const API = "https://data.api.xweather.com/forecasts";
const OUT = "data/forecast-xweather.json";
const THRESHOLD = 28;          // °F wet bulb, as forecast.mjs
const HOURS = 360;             // 15 days; the most Xweather forecasts

const ID = process.env.XWEATHER_CLIENT_ID;
const SECRET = process.env.XWEATHER_CLIENT_SECRET;
if (!ID || !SECRET) {
  console.error("XWEATHER_CLIENT_ID and XWEATHER_CLIENT_SECRET must be set.");
  process.exit(1);
}

const resorts = JSON.parse(readFileSync("data/resorts.json", "utf8"));
const places = existsSync("data/places.json")
  ? JSON.parse(readFileSync("data/places.json", "utf8")) : {};
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Stull, R. (2011), "Wet-Bulb Temperature from Relative Humidity and Air
// Temperature", J. Appl. Meteor. Climatol. 50, 2267-2269. °C and % in, °C out.
function stull(t, rh) {
  return t * Math.atan(0.151977 * Math.sqrt(rh + 8.313659))
    + Math.atan(t + rh) - Math.atan(rh - 1.676331)
    + 0.00391838 * rh ** 1.5 * Math.atan(0.023101 * rh)
    - 4.686035;
}
const wetBulbF = (tempF, rh) => {
  if (tempF == null || rh == null) return null;
  const c = stull((tempF - 32) * 5 / 9, rh);
  return Math.round((c * 9 / 5 + 32) * 10) / 10;
};

// forecast.mjs asks Open-Meteo for America/Chicago wall time with no offset,
// "2026-10-06T05:00". Written the same way here so the build can compare the
// two strings directly.
const chicago = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Chicago", hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
});
const localTime = unix => {
  const p = Object.fromEntries(chicago.formatToParts(new Date(unix * 1000)).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
};

async function forecast(lat, lon) {
  const q = new URLSearchParams({
    filter: "1hr", from: "now", to: "+15days", limit: String(HOURS),
    fields: "periods.timestamp,periods.tempF,periods.humidity",
    client_id: ID, client_secret: SECRET,
  });
  const res = await fetch(`${API}/${lat},${lon}?${q}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const body = await res.json();
  if (!body.success) throw new Error(body.error?.description ?? body.error?.code ?? "request failed");
  const periods = body.response?.[0]?.periods;
  if (!periods?.length) throw new Error("no periods in response");
  return periods;
}

function summarise(periods) {
  const hours = periods.map(p => ({ t: p.timestamp, wb: wetBulbF(p.tempF, p.humidity) }));
  const known = hours.filter(h => h.wb !== null);
  if (!known.length) throw new Error("no temperature and humidity in response");
  const cold = known.filter(h => h.wb < THRESHOLD);
  return {
    min: Math.min(...known.map(h => h.wb)),
    hoursUnder: cold.length,
    firstWindow: cold.length ? localTime(cold[0].t) : null,
    hours: hours.length,
  };
}

const out = { source: "xweather", generatedAt: new Date().toISOString(), horizonDays: null,
              threshold: THRESHOLD, hills: {}, places: {} };

async function pull(group, id, { lat, lon }) {
  try {
    out[group][id] = summarise(await forecast(lat, lon));
    const f = out[group][id];
    process.stderr.write(`${id.padEnd(19)} min ${f.min.toFixed(1)}F  ${f.hoursUnder}h under ${THRESHOLD}  (${f.hours}h)\n`);
  } catch (e) {
    // Unknown, not zero: zero hours would read as "no snowmaking weather".
    out[group][id] = { min: null, hoursUnder: null, firstWindow: null, error: String(e.message) };
    process.stderr.write(`${id.padEnd(19)} ! ${e.message}\n`);
  }
  await sleep(600);
}

for (const [slug, r] of Object.entries(resorts)) await pull("hills", slug, r);
for (const [id, p] of Object.entries(places)) await pull("places", id, p);

// Horizon from what actually came back rather than what was asked for, so the
// page never claims more days than the numbers cover.
const got = [...Object.values(out.hills), ...Object.values(out.places)].map(f => f.hours).filter(Boolean);
if (!got.length) {
  console.error("\nNo point returned a forecast; leaving the previous file alone.");
  process.exit(1);
}
out.horizonDays = Math.floor(Math.min(...got) / 24);

writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
const ok = Object.values(out.hills).filter(h => h.min !== null).length;
console.log(`\nwrote ${OUT}: ${ok}/${Object.keys(resorts).length} hills, ${Object.keys(out.places).length} places, ${out.horizonDays}-day horizon`);
