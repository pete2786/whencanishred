// Hours under a 28°F wet bulb, per hill, per day, every autumn on record, into
// data/coldhours.json.
//
//   node scripts/coldhours.mjs
//
// Read from the ERA5 pulls in data/cache/, which only exist on a machine that
// has run allhours.mjs. The workflow has no cache, so the result is committed
// and project.mjs reads it from there.
//
// Daily counts rather than a summary, because project.mjs derives two things
// from them and one of them moves: how many hours each hill had banked before
// every opening on record changes whenever a season is added to the record.
// Keeping the raw days means a new opening date updates the model on the next
// run, with no cache needed.
//
// Each year is 150 days from 1 September, the season's autumn.

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const THRESHOLD_C = (28 - 32) * 5 / 9;
const DAYS = 150;

// Stull (2011), as in climatology.mjs and allhours.mjs.
const wb = (T, RH) => T * Math.atan(0.151977 * Math.sqrt(RH + 8.313659)) + Math.atan(T + RH)
  - Math.atan(RH - 1.676331) + 0.00391838 * Math.pow(RH, 1.5) * Math.atan(0.023101 * RH) - 4.686035;

const resorts = JSON.parse(readFileSync("data/resorts.json", "utf8"));
// allhours.mjs names its cache files after the hill, and shortens one name.
const CACHE_NAME = { "lutsen-mountains": "Lutsen" };
const cacheFile = slug => `data/cache/${(CACHE_NAME[slug] ?? resorts[slug].name).replace(/\s+/g, "-")}.json`;

const out = { start: "09-01", days: DAYS, threshold: 28, hills: {} };
for (const slug of Object.keys(resorts)) {
  const f = cacheFile(slug);
  if (!existsSync(f)) { console.error(`${slug}: no cache at ${f}, run allhours.mjs`); continue; }
  const h = JSON.parse(readFileSync(f, "utf8"));
  const years = {};
  for (let i = 0; i < h.time.length; i++) {
    const t = h.time[i], m = +t.slice(5, 7);
    if (m >= 3 && m < 9) continue;
    const y = m >= 9 ? +t.slice(0, 4) : +t.slice(0, 4) - 1;
    const d = Math.round((Date.parse(`${t.slice(0, 10)}T00:00:00Z`) - Date.parse(`${y}-09-01T00:00:00Z`)) / 86400000);
    if (d < 0 || d >= DAYS) continue;
    const row = (years[y] ??= new Array(DAYS).fill(0));
    const T = h.temperature_2m[i], R = h.relative_humidity_2m[i];
    if (T != null && R != null && wb(T, R) < THRESHOLD_C) row[d]++;
  }
  // Days past the end of the archive are null, not zero: a zero would read as
  // a warm January. The last autumn on record stops on 31 December.
  const last = Date.parse(`${h.time.at(-1).slice(0, 10)}T00:00:00Z`);
  for (const [y, row] of Object.entries(years)) {
    for (let d = 0; d < DAYS; d++) if (Date.parse(`${y}-09-01T00:00:00Z`) + d * 86400000 > last) row[d] = null;
  }
  out.hills[slug] = years;
  process.stderr.write(".");
}
writeFileSync("data/coldhours.json", JSON.stringify(out) + "\n");
console.error(`\nwrote data/coldhours.json, ${Object.keys(out.hills).length} hills`);
