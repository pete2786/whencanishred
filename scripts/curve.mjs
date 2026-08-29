// The mean wet-bulb curve for the homepage chart, from the same 31 years of
// hourly ERA5 the rest of the site runs on. Hyland Hills stands for the Twin
// Cities. Writes data/curve.json and prints the marks worth reading by eye.
//
// The chart used to be hand-drawn: this script printed ten numbers and the
// SVG coordinates were transcribed into the template. That left no way to
// render the chart a second time at a second size, and the transcription had
// already drifted — the crossing dot sat two days right of the date beside it.

import { readFileSync, writeFileSync } from "node:fs";

const wetBulbC = (T, RH) =>
  T * Math.atan(0.151977 * Math.sqrt(RH + 8.313659)) + Math.atan(T + RH) -
  Math.atan(RH - 1.676331) + 0.00391838 * Math.pow(RH, 1.5) * Math.atan(0.023101 * RH) - 4.686035;

const FROM = "08-23", TO = "12-31";

const h = JSON.parse(readFileSync("data/cache/Hyland-Hills.json", "utf8"));
const sum = new Map();
for (let i = 0; i < h.time.length; i++) {
  const md = h.time[i].slice(5, 10);
  const T = h.temperature_2m[i], RH = h.relative_humidity_2m[i];
  if (T == null || RH == null) continue;
  const wb = wetBulbC(T, RH) * 9 / 5 + 32;
  if (!sum.has(md)) sum.set(md, [0, 0]);
  const e = sum.get(md); e[0] += wb; e[1]++;
}

const daily = [...sum.entries()]
  .filter(([md]) => md >= FROM && md <= TO)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([md, [s, n]]) => ({ md, v: s / n }));

// A 31-year average still wiggles a degree or two from one calendar day to the
// next, and that wiggle is sampling noise: there is nothing meteorological
// about 14 October being colder than the 15th across three decades. Plotted
// raw it draws a hairy line that reads as data when it is not. A centred
// 7-day mean keeps the shape and the crossing while dropping the hair.
const WIN = 3;
const series = daily.map((_, i) => {
  const lo = Math.max(0, i - WIN), hi = Math.min(daily.length - 1, i + WIN);
  const slice = daily.slice(lo, hi + 1);
  return { md: daily[i].md, v: +(slice.reduce((a, p) => a + p.v, 0) / slice.length).toFixed(2) };
});

// The day the mean itself drops under 28. Not the first workable window —
// that is an early cold snap and arrives about three weeks sooner.
//
// Read off the raw daily means, never the smoothed line. Smoothing is a
// drawing decision; this is a number the site states as fact and the copy
// quotes. Taking it off the smoothed series moved it three days, which is
// exactly the kind of quiet drift that must not happen here.
let crossing = null;
for (let i = 1; i < daily.length; i++) {
  if (daily[i - 1].v >= 28 && daily[i].v < 28) { crossing = daily[i].md; break; }
}

writeFileSync("data/curve.json", JSON.stringify({
  station: "Hyland Hills", label: "Twin Cities", smoothing: `${WIN * 2 + 1}-day centred mean`,
  years: `${h.time[0].slice(0, 4)}–${h.time.at(-1).slice(0, 4)}`,
  from: FROM, to: TO, crossing, series,
}, null, 1) + "\n");

const at = md => daily.find(p => p.md === md)?.v;   // report the raw means, not the smoothed line
console.log(`Twin Cities mean wet-bulb (F), ${h.time[0].slice(0, 4)}-${h.time.at(-1).slice(0, 4)}:`);
for (const m of ["08-23", "09-01", "09-15", "10-01", "10-15", "11-01", "11-15", "12-01", "12-15", "12-31"])
  console.log(`  ${m}  ${at(m).toFixed(1)}`);
console.log(`\nmean curve crosses 28F at ${crossing}`);
console.log(`wrote data/curve.json (${series.length} days)`);
