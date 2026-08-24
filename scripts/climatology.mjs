// Computes, per hill, the date each autumn when sustained snowmaking first becomes
// possible: the first run of >= MIN_HOURS consecutive hours with wet-bulb < 28F.
//
// Data: Open-Meteo ERA5 archive (CC BY 4.0). No API key.

const THRESHOLD_F = 28;
const MIN_HOURS = 8;          // one night of blowing
const START_YEAR = 1995;
const END_YEAR = 2025;

// Stull (2011) wet-bulb approximation. T in Celsius, RH in %.
export function wetBulbC(T, RH) {
  return T * Math.atan(0.151977 * Math.sqrt(RH + 8.313659))
    + Math.atan(T + RH)
    - Math.atan(RH - 1.676331)
    + 0.00391838 * Math.pow(RH, 1.5) * Math.atan(0.023101 * RH)
    - 4.686035;
}

const fToC = f => (f - 32) * 5 / 9;
const THRESHOLD_C = fToC(THRESHOLD_F);

const HILLS = [
  { name: "Wild Mountain",     place: "Taylors Falls", lat: 45.3897, lon: -92.7143 },
  { name: "Trollhaugen",       place: "Dresser, WI",   lat: 45.3572, lon: -92.6349 },
  { name: "Buck Hill",         place: "Burnsville",    lat: 44.7433, lon: -93.2872 },
  { name: "Afton Alps",        place: "Afton",         lat: 44.8574, lon: -92.7899 },
  { name: "Welch Village",     place: "Welch",         lat: 44.5619, lon: -92.7360 },
  { name: "Hyland Hills",      place: "Bloomington",   lat: 44.8297, lon: -93.3672 },
  { name: "Elm Creek",         place: "Maple Grove",   lat: 45.1461, lon: -93.4419 },
  { name: "Lutsen Mountains",  place: "Lutsen",        lat: 47.6683, lon: -90.7175 },
  { name: "Giants Ridge",      place: "Biwabik",       lat: 47.5583, lon: -92.2830 },
  { name: "Spirit Mountain",   place: "Duluth",        lat: 46.7183, lon: -92.2200 },
  { name: "Mount Kato",        place: "Mankato",       lat: 44.1372, lon: -94.0186 },
  { name: "Powder Ridge",      place: "Kimball",       lat: 45.3308, lon: -94.3086 },
  { name: "Buena Vista",       place: "Bemidji",       lat: 47.5875, lon: -94.8464 },
  { name: "Detroit Mountain",  place: "Detroit Lakes", lat: 46.8222, lon: -95.7736 },
  { name: "Andes Tower Hills", place: "Kensington",    lat: 45.8047, lon: -95.6664 },
  { name: "Coffee Mill",       place: "Wabasha",       lat: 44.3819, lon: -92.0413 },
];

async function fetchHours(hill) {
  const url = "https://archive-api.open-meteo.com/v1/archive"
    + `?latitude=${hill.lat}&longitude=${hill.lon}`
    + `&start_date=${START_YEAR}-09-01&end_date=${END_YEAR}-12-31`
    + "&hourly=temperature_2m,relative_humidity_2m"
    + "&timezone=America%2FChicago";

  // Open-Meteo weights calls by payload size; a 30-year hourly pull is heavy,
  // so back off and retry rather than hammering.
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url);
    if (res.ok) return (await res.json()).hourly;
    if (res.status !== 429) throw new Error(`${hill.name}: HTTP ${res.status}`);
    await new Promise(r => setTimeout(r, 20000 * (attempt + 1)));
  }
  throw new Error(`${hill.name}: still rate-limited after 6 attempts`);
}

// First sustained sub-threshold run in each autumn (Sep 1 - Dec 31).
function firstWindowByYear(hourly) {
  const { time, temperature_2m: temps, relative_humidity_2m: rhs } = hourly;
  const byYear = new Map();
  let run = 0;

  for (let i = 0; i < time.length; i++) {
    const t = temps[i], rh = rhs[i];
    const stamp = time[i];
    const month = +stamp.slice(5, 7);

    if (month < 9) { run = 0; continue; }          // outside the autumn window
    if (t == null || rh == null) { run = 0; continue; }

    if (wetBulbC(t, rh) < THRESHOLD_C) {
      run++;
      if (run >= MIN_HOURS) {
        const year = +stamp.slice(0, 4);
        if (!byYear.has(year)) {
          // credit the date the run started
          const startIdx = i - MIN_HOURS + 1;
          byYear.set(year, time[startIdx].slice(0, 10));
        }
      }
    } else {
      run = 0;
    }
  }
  return byYear;
}

const dayOfYear = iso => {
  const d = new Date(iso + "T00:00:00Z");
  return Math.floor((d - new Date(Date.UTC(d.getUTCFullYear(), 0, 1))) / 86400000);
};
const fromDoy = (doy, year = 2026) => {
  const d = new Date(Date.UTC(year, 0, 1 + doy));
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
};

const results = [];

for (const hill of HILLS) {
  try {
    const hourly = await fetchHours(hill);
    const byYear = firstWindowByYear(hourly);
    const doys = [...byYear.values()].map(dayOfYear).sort((a, b) => a - b);
    if (!doys.length) { console.error(`${hill.name}: no windows found`); continue; }

    const mean = doys.reduce((a, b) => a + b, 0) / doys.length;
    const median = doys[Math.floor(doys.length / 2)];
    const sd = Math.sqrt(doys.reduce((s, d) => s + (d - mean) ** 2, 0) / doys.length);

    results.push({
      hill: hill.name,
      place: hill.place,
      years: doys.length,
      normal: fromDoy(Math.round(median)),
      earliest: fromDoy(doys[0]),
      latest: fromDoy(doys[doys.length - 1]),
      sdDays: +sd.toFixed(1),
      spreadDays: doys[doys.length - 1] - doys[0],
    });
    process.stderr.write(".");
  } catch (e) {
    console.error(`\n${hill.name}: ${e.message}`);
  }
}

process.stderr.write("\n\n");
console.table(results);
