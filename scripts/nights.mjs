// The first full night of snowmaking each autumn, per hill, into data/nights.json.
//
//   node scripts/nights.mjs
//
// A full night is eight hours in a row under a 28°F wet bulb, the same test the
// climatology uses. Read from the ERA5 pulls in data/cache/, which only exist on
// a machine that has run allhours.mjs. The workflow has no cache, so the result
// is committed and project.mjs reads it from there.
//
// Two jobs downstream. It dates the first night of every season on record, so
// project.mjs can measure how soon after it each hill has opened. And it says
// when the first night came in every year, so a fall that has not had one yet
// can be compared with the falls that were just as late.

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const THRESHOLD_C = (28 - 32) * 5 / 9;
const NIGHT = 8;

// Stull (2011), as in climatology.mjs and allhours.mjs.
const wb = (T, RH) => T * Math.atan(0.151977 * Math.sqrt(RH + 8.313659)) + Math.atan(T + RH)
  - Math.atan(RH - 1.676331) + 0.00391838 * Math.pow(RH, 1.5) * Math.atan(0.023101 * RH) - 4.686035;

const resorts = JSON.parse(readFileSync("data/resorts.json", "utf8"));
// allhours.mjs names its cache files after the hill, and shortens one name.
const CACHE_NAME = { "lutsen-mountains": "Lutsen" };
const cacheFile = slug => `data/cache/${(CACHE_NAME[slug] ?? resorts[slug].name).replace(/\s+/g, "-")}.json`;

const out = { years: null, hills: {} };
let lo = Infinity, hi = -Infinity;

for (const slug of Object.keys(resorts)) {
  const f = cacheFile(slug);
  if (!existsSync(f)) { console.error(`${slug}: no cache at ${f}, run allhours.mjs`); continue; }
  const h = JSON.parse(readFileSync(f, "utf8"));
  const first = {};
  let run = 0;
  for (let i = 0; i < h.time.length; i++) {
    const t = h.time[i], m = +t.slice(5, 7);
    if (m < 9) { run = 0; continue; }
    const T = h.temperature_2m[i], R = h.relative_humidity_2m[i];
    if (T == null || R == null || wb(T, R) >= THRESHOLD_C) { run = 0; continue; }
    if (++run === NIGHT) {
      const y = t.slice(0, 4);
      first[y] ??= h.time[i - NIGHT + 1].slice(0, 10);
    }
  }
  // A year with no night by 31 December is recorded as null, not left out: it
  // is the latest possible answer, and dropping it would make late years look
  // rarer than they are.
  const years = [...new Set(h.time.map(t => t.slice(0, 4)))];
  out.hills[slug] = Object.fromEntries(years.map(y => [y, first[y] ?? null]));
  lo = Math.min(lo, +years[0]); hi = Math.max(hi, +years.at(-1));
  process.stderr.write(".");
}

out.years = `${lo}–${hi}`;
writeFileSync("data/nights.json", JSON.stringify(out, null, 1) + "\n");
console.error(`\nwrote data/nights.json, ${Object.keys(out.hills).length} hills, ${out.years}`);
