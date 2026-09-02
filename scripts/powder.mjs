// Powder days, estimated the way the rest of the site estimates things: a
// stated method over public data, with the guess labelled as a guess.
//
//   node scripts/powder.mjs            # -> data/powder.json
//   node scripts/powder.mjs --report   # what it found, printed
//
// Deliberately separate from forecast.mjs. That one feeds the site and runs
// twice a day in CI; nothing here should be able to break it.
//
// ---------------------------------------------------------------------------
// What a powder day is here
//
// Not a Rockies powder day and not JaPow. In the Midwest a powder day means
// ripping fresh snow -- a few inches of something soft on top of a groomed,
// man-made base. The thresholds below are set for that, and calling 15cm
// "exceptional" would be laughable in Utah and is simply true here.
//
// Snowfall alone does not decide it. The same 10cm is a completely different
// day at -12C than at 0C, because the snow-to-liquid ratio roughly doubles
// across that range: cold snow falls dry and stays light, warm snow falls wet
// and sets up like concrete. Wind ruins it from the other end by scouring the
// exposed pitches and slabbing the gullies. So the estimate is snowfall
// weighted by how good that snow is likely to be.
//
// This is a model. It will be wrong sometimes, and anything built on it should
// say "our guess" rather than "there will be powder".

import { writeFileSync, readFileSync } from "node:fs";

const HORIZON_DAYS = 16;

// Midwest thresholds, in centimetres of forecast snowfall adjusted for quality.
// A day has to clear FRESH to be worth mentioning at all.
const FRESH_CM = 3;    // ~1in -- soft edges, worth going
const GOOD_CM = 8;     // ~3in -- an actual powder day here
const BIG_CM = 15;     // ~6in -- exceptional for the Midwest

// Snow-to-liquid ratio against mean daily temperature, in Celsius. A coarse
// step function rather than a fitted curve: the forecast's own temperature
// error is larger than the precision a smooth curve would imply.
//
// The classic 10:1 sits around -5C. Colder falls drier and lighter until the
// air runs out of moisture; warmer falls wet and heavy, and above freezing it
// is not really snow at all.
function ratioFor(tempC) {
  if (tempC > 1) return 4;    // sleet, mush, rain on snow
  if (tempC > -1) return 7;   // heavy and wet
  if (tempC > -4) return 10;  // the textbook case
  if (tempC > -8) return 13;
  if (tempC > -13) return 16; // the good stuff
  if (tempC > -20) return 18; // dry and squeaky
  return 15;                  // very cold air holds little moisture
}

// Quality multiplier: 1.0 is snow that arrives as good as its ratio suggests.
// Wind and rain both take it away.
function qualityFor({ tempC, windKmh, rainMm }) {
  let q = ratioFor(tempC) / 12;      // 12:1 is the reference "normal" day

  // Wind scours the exposed pitches and slabs everything else. Midwest hills
  // are small and largely treeless, so there is nowhere for it to hide.
  if (windKmh > 45) q *= 0.45;
  else if (windKmh > 32) q *= 0.65;
  else if (windKmh > 22) q *= 0.85;

  // Rain in the same 24 hours ends the conversation.
  if (rainMm > 2) q *= 0.2;
  else if (rainMm > 0.5) q *= 0.6;

  return Math.max(0, Math.min(q, 1.7));
}

const grade = cm =>
  cm >= BIG_CM ? "big" : cm >= GOOD_CM ? "good" : cm >= FRESH_CM ? "fresh" : null;

const resorts = JSON.parse(readFileSync("data/resorts.json", "utf8"));
const places = JSON.parse(readFileSync("data/places.json", "utf8"));
const REPORT = process.argv.includes("--report");

async function fetchDaily({ lat, lon }) {
  const url = "https://api.open-meteo.com/v1/forecast"
    + `?latitude=${lat}&longitude=${lon}`
    + "&daily=snowfall_sum,temperature_2m_max,temperature_2m_min,"
    + "wind_speed_10m_max,rain_sum"
    + `&forecast_days=${HORIZON_DAYS}`
    + "&timezone=America%2FChicago";

  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url);
    if (res.ok) return (await res.json()).daily;
    if (res.status !== 429) throw new Error(`HTTP ${res.status}`);
    await new Promise(r => setTimeout(r, 8000 * (attempt + 1)));
  }
  throw new Error("still rate-limited after 5 attempts");
}

function summarise(d) {
  const days = d.time.map((date, i) => {
    const snow = d.snowfall_sum[i] ?? 0;
    const tMax = d.temperature_2m_max[i];
    const tMin = d.temperature_2m_min[i];
    const tempC = (tMax + tMin) / 2;
    const windKmh = d.wind_speed_10m_max[i] ?? 0;
    const rainMm = d.rain_sum[i] ?? 0;

    const quality = snow > 0 ? qualityFor({ tempC, windKmh, rainMm }) : 0;
    // The number the cards actually use: forecast snowfall, weighted by how
    // good that snow is likely to be. Not a depth measurement.
    const score = Math.round(snow * quality * 10) / 10;

    return {
      date,
      snowCm: Math.round(snow * 10) / 10,
      tempC: Math.round(tempC * 10) / 10,
      windKmh: Math.round(windKmh),
      rainMm: Math.round(rainMm * 10) / 10,
      ratio: ratioFor(tempC),
      score,
      grade: grade(score),
    };
  });

  const rated = days.filter(x => x.grade);
  const best = rated.length ? rated.reduce((a, b) => (b.score > a.score ? b : a)) : null;

  return {
    days,
    best,
    total: Math.round(days.reduce((a, x) => a + x.snowCm, 0) * 10) / 10,
    counts: {
      fresh: days.filter(x => x.grade === "fresh").length,
      good: days.filter(x => x.grade === "good").length,
      big: days.filter(x => x.grade === "big").length,
    },
  };
}

const out = {
  generatedAt: new Date().toISOString(),
  horizonDays: HORIZON_DAYS,
  method: "forecast snowfall weighted by snow-to-liquid ratio (from temperature), "
        + "reduced for wind and rain",
  thresholds: { freshCm: FRESH_CM, goodCm: GOOD_CM, bigCm: BIG_CM },
  hills: {},
  places: {},
};

for (const [slug, r] of Object.entries(resorts)) {
  try { out.hills[slug] = summarise(await fetchDaily(r)); }
  catch (e) { console.error(`  ! ${slug}: ${e.message}`); out.hills[slug] = null; }
}
for (const [slug, p] of Object.entries(places)) {
  try { out.places[slug] = summarise(await fetchDaily(p)); }
  catch (e) { console.error(`  ! ${slug}: ${e.message}`); out.places[slug] = null; }
}

writeFileSync("data/powder.json", JSON.stringify(out, null, 2) + "\n");

const hills = Object.entries(out.hills).filter(([, v]) => v);
const rated = hills.filter(([, v]) => v.best);
console.log(`data/powder.json -- ${hills.length} hills, ${HORIZON_DAYS}-day horizon`);
console.log(rated.length
  ? `${rated.length} with a day clearing ${FRESH_CM}cm adjusted`
  : `nothing clears ${FRESH_CM}cm adjusted in the window`);

if (REPORT) {
  console.log("");
  const rows = hills
    .map(([slug, v]) => ({ name: resorts[slug].name, ...v }))
    .sort((a, b) => (b.best?.score ?? -1) - (a.best?.score ?? -1) || b.total - a.total);
  for (const r of rows) {
    const b = r.best;
    console.log(
      `  ${r.name.padEnd(20)} ${String(r.total).padStart(6)}cm forecast` +
      (b ? `   best ${b.date} ${b.score}cm adj (${b.snowCm}cm at ${b.tempC}C, ${b.ratio}:1) ${b.grade.toUpperCase()}`
         : "   --"));
  }
}
