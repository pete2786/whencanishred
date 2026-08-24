// Second metric: how many snowmaking hours actually accumulate, rather than
// when the first one shows up. Caches raw pulls so reruns are free.

import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { wetBulbC } from "./climatology.mjs";

const THRESHOLD_C = (28 - 32) * 5 / 9;
const CACHE = "data/cache";
mkdirSync(CACHE, { recursive: true });

const HILLS = [
  { name: "Lutsen",      lat: 47.6683, lon: -90.7175 },
  { name: "Giants Ridge", lat: 47.5583, lon: -92.2830 },
  { name: "Hyland Hills", lat: 44.8297, lon: -93.3672 },
  { name: "Coffee Mill",  lat: 44.3819, lon: -92.0413 },
];

async function hourly(h) {
  const f = `${CACHE}/${h.name.replace(/\s+/g, "-")}.json`;
  if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8"));

  const url = "https://archive-api.open-meteo.com/v1/archive"
    + `?latitude=${h.lat}&longitude=${h.lon}`
    + "&start_date=1995-09-01&end_date=2025-12-31"
    + "&hourly=temperature_2m,relative_humidity_2m&timezone=America%2FChicago";

  for (let a = 0; a < 6; a++) {
    const res = await fetch(url);
    if (res.ok) {
      const data = (await res.json()).hourly;
      writeFileSync(f, JSON.stringify(data));
      return data;
    }
    if (res.status !== 429) throw new Error(`${h.name}: HTTP ${res.status}`);
    await new Promise(r => setTimeout(r, 20000 * (a + 1)));
  }
  throw new Error(`${h.name}: rate-limited`);
}

// Snowmaking hours accumulated between Oct 1 and Nov 30 of each year.
function hoursByYear({ time, temperature_2m: T, relative_humidity_2m: RH }) {
  const acc = new Map();
  for (let i = 0; i < time.length; i++) {
    const m = +time[i].slice(5, 7);
    if (m !== 10 && m !== 11) continue;
    if (T[i] == null || RH[i] == null) continue;
    if (wetBulbC(T[i], RH[i]) < THRESHOLD_C) {
      const y = +time[i].slice(0, 4);
      acc.set(y, (acc.get(y) ?? 0) + 1);
    }
  }
  return acc;
}

const rows = [];
for (const h of HILLS) {
  const acc = hoursByYear(await hourly(h));
  const vals = [...acc.values()].sort((a, b) => a - b);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
  rows.push({
    hill: h.name,
    meanHours: Math.round(mean),
    leanest: vals[0],
    fattest: vals[vals.length - 1],
    sd: Math.round(sd),
    cv: +(sd / mean).toFixed(2),      // spread relative to size
  });
  process.stderr.write(".");
}
process.stderr.write("\n\n");
console.table(rows);

console.log("Oct 1 - Nov 30 hours with wet-bulb under 28F. 1995-2025.");
console.log("north vs metro gap:",
  Math.round(rows[0].meanHours - rows[2].meanHours), "hours");
