// Projects each hill's first lift for the coming season from the record, and
// writes data/projection.json for the build to render.
//
//   node scripts/project.mjs            # write
//   node scripts/project.mjs --report   # print the working, write nothing
//
// Two estimators, because eight hills have five seasons on file and eight have
// none. A hill with its own history is projected from that history; a hill
// without one is projected from its climate, and the page says which by label.

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const SEASON = 2026;
const report = process.argv.includes("--report");

const read = f => JSON.parse(readFileSync(f, "utf8"));
const resorts = read("data/resorts.json");
const seasons = read("data/seasons.json");
const hoursRows = read("data/hours.json");
const prior = read("data/projection.json");

const slugify = n => n.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const HOURS_ALIASES = { lutsen: "lutsen-mountains" };
const hours = Object.fromEntries(hoursRows.map(h => {
  const k = slugify(h.hill);
  return [HOURS_ALIASES[k] ?? k, h];
}));

// Seasons straddle new year — Coffee Mill opened 14 January once — so dates are
// counted as days since 1 October of the season's own autumn.
const EPOCH = m => Date.UTC(m, 9, 1);
const sinceOct = iso => {
  const t = new Date(`${iso}T00:00:00Z`);
  const autumn = t.getUTCMonth() >= 6 ? t.getUTCFullYear() : t.getUTCFullYear() - 1;
  return Math.round((t - EPOCH(autumn)) / 86400000);
};
const toDate = d => new Date(EPOCH(SEASON) + Math.round(d) * 86400000).toISOString().slice(0, 10);

const observed = slug => Object.values(seasons[slug] ?? {})
  .map(v => v.firstLift?.date).filter(Boolean).map(sinceOct).sort((a, b) => a - b);

// Median, not mean: Coffee Mill's 14 January 2024 is a real season but it is not
// what Coffee Mill normally does, and one outlier in five should not move the
// projection two weeks.
const median = xs => xs.length % 2 ? xs[(xs.length - 1) / 2]
                                   : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2;

// --- the climate estimator, fitted on every hill that has said anything ------
// More snowmaking weather means an earlier opening. Fitted on observed medians
// alone the line is steep, and extrapolating it past the metro hills it was
// built from puts Buena Vista (458 normal hours) at 19 October — while Giants
// Ridge, at effectively the same 454 hours, targets 24 November, and Lutsen at
// 386 announces the 22nd. Northern hills are bounded by staffing and holiday
// demand, not by cold, so the real curve flattens where the line does not.
//
// Those announced and targeted dates are evidence of exactly the thing being
// predicted, so they join the fit rather than being corrected for afterwards
// with a floor. Only for hills with no season history of their own — a hill
// already in the fit through its record must not be counted twice.
// Only these two are facts from outside. "model" and "climate" are both this
// script's own output: treating them as anchors would freeze last run's numbers
// and feed the fit its own predictions.
const EXTERNAL = new Set(["announced", "target"]);

// A date a hill states about itself is the best evidence there is right up
// until the hill has a record, and then it is not. Lutsen's announced 22
// November and Giants Ridge's targeted 24th were transcribed out of the old
// hand-typed page and are contradicted by every season since: Lutsen has opened
// on 6 December at the median and has never once opened before the 28th. Five
// observed seasons beat a stated intention of unknown vintage.
const statedWins = slug => EXTERNAL.has(prior[slug]?.label) && observed(slug).length < 2;

const anchorPoint = slug => (statedWins(slug) ? sinceOct(prior[slug].date) : null);

const fitPoints = Object.keys(resorts).map(slug => {
  const x = hours[slug]?.normal;
  const obs = observed(slug);
  if (x == null) return null;
  if (obs.length >= 2) return { slug, x, y: median(obs), kind: "record" };
  const anchor = anchorPoint(slug);
  return anchor == null ? null : { slug, x, y: anchor, kind: prior[slug].label };
}).filter(Boolean);

const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const mx = mean(fitPoints.map(p => p.x)), my = mean(fitPoints.map(p => p.y));
const slope = fitPoints.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0)
            / fitPoints.reduce((a, p) => a + (p.x - mx) ** 2, 0);
const intercept = my - slope * mx;
const predict = x => intercept + slope * x;

// Weak on purpose to report: the anchors pull the line away from the metro
// hills that dominate it, which costs in-sample fit and buys sane extrapolation.
// R2 is the wrong thing to maximise when the whole job is predicting hills that
// are not in the sample.
const ssTot = fitPoints.reduce((a, p) => a + (p.y - my) ** 2, 0);
const ssRes = fitPoints.reduce((a, p) => a + (p.y - predict(p.x)) ** 2, 0);
const r2 = 1 - ssRes / ssTot;

const out = {}, rows = [];
for (const slug of Object.keys(resorts)) {
  const was = prior[slug];

  // An announced or targeted date is something a hill said about itself. The
  // model does not get to overrule it.
  if (statedWins(slug)) {
    out[slug] = { date: was.date, label: was.label };
    rows.push([slug, hours[slug]?.normal, was.label, was.date, "kept"]);
    continue;
  }

  const obs = observed(slug);
  if (obs.length >= 2) {
    const date = toDate(median(obs));
    out[slug] = { date, label: "model" };
    rows.push([slug, hours[slug]?.normal, "model", date,
               `median of ${obs.length}, was ${was?.date ?? "—"}`]);
    continue;
  }

  const date = toDate(predict(hours[slug].normal));
  out[slug] = { date, label: "climate" };
  rows.push([slug, hours[slug]?.normal, "climate", date, `fit, was ${was?.date ?? "—"}`]);
}

// --- this fall's weather ------------------------------------------------------
// The record says when a hill normally opens. It cannot say when the cold has
// not come. Every one of the 60 openings on file came after at least one full
// night of snowmaking, eight hours in a row under 28, and in the late falls on
// record each hill opened close to the shortest gap it has ever managed after
// that night: in 2024 Afton, Welch and Buck all opened ten days after it, which
// is the least any of them has ever taken.
//
// So a hill opens no sooner than its first night plus its shortest gap. In a
// normal fall that lands well before the median and changes nothing. In a late
// one it is the binding date, and the projection moves to it.
//
// Before the first night has come, its date is the median of the falls that
// were just as late: the years in data/nights.json with no night by today. When
// no model in the forecast has a night in the coming week either, "just as
// late" means no night a week from now. A week, because past it the models
// have twice found nights that never came: 10 and 16 October, this fall.
const nights = existsSync("data/nights.json") ? read("data/nights.json").hills : {};
const now = existsSync("data/this-season.json") ? read("data/this-season.json") : null;
const fc = existsSync("data/forecast.json") ? read("data/forecast.json") : null;
const SURE_DAYS = 7;
const live = now?.season === SEASON;
const asOf = live ? now.through.slice(0, 10) : null;
const dayDiff = (a, b) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

const shortestGap = slug => {
  const gaps = Object.entries(seasons[slug] ?? {}).map(([season, v]) => {
    const night = nights[slug]?.[season.slice(0, 4)];
    return v.firstLift?.date && night ? dayDiff(v.firstLift.date, night) : null;
  }).filter(g => g !== null && g >= 0);
  return gaps.length ? Math.min(...gaps) : null;
};
// A hill with no record borrows the middle of everyone else's shortest gap.
const ownGaps = Object.keys(resorts).map(shortestGap).filter(g => g !== null).sort((a, b) => a - b);
const pooledGap = ownGaps.length ? Math.round(median(ownGaps)) : null;

function firstNight(slug) {
  const seen = now?.hills?.[slug]?.firstNight;
  if (seen) { const d = seen.slice(0, 10); return { date: d, lo: d, hi: d, how: "observed" }; }
  // A night any model sees inside the week keeps the clock at today.
  const sure = addDays(asOf, SURE_DAYS);
  const models = Object.values(fc?.hills?.[slug]?.models ?? {});
  const coming = models.some(m => m.firstNight && m.firstNight.slice(0, 10) <= sure);
  const by = models.length && !coming ? sure : asOf;
  // Falls with no night by then, by month and day. A fall that never got one
  // before New Year counts as the latest of all rather than dropping out.
  const md = by.slice(5);
  const late = Object.values(nights[slug] ?? {})
    .map(d => (d === null ? "12-31" : d.slice(5))).filter(d => d > md).sort();
  if (!late.length) { const d = addDays(by, 1); return { date: d, lo: d, hi: d, how: "unprecedented" }; }
  const mid = late[Math.floor((late.length - 1) / 2)];
  return { date: `${SEASON}-${mid}`, lo: `${SEASON}-${late[0]}`, hi: `${SEASON}-${late.at(-1)}`,
           how: `median of ${late.length} falls with none by ${by.slice(5)}` };
}

if (live) {
  for (const slug of Object.keys(out)) {
    if (EXTERNAL.has(out[slug].label)) continue;
    const gap = shortestGap(slug) ?? pooledGap;
    if (gap === null) continue;
    const night = firstNight(slug);
    const earliest = addDays(night.date, gap);
    const row = rows.find(r => r[0] === slug);
    // The range around it. Each end is the later of what the weather allows,
    // from the earliest and latest of the falls that were just as late, and
    // what the hill itself has done, from its earliest and latest opening on
    // record. In a normal fall the record decides both ends; in a late one the
    // weather lifts them. Never earlier than tomorrow.
    const obs = observed(slug).map(toDate);
    const later = (...xs) => xs.filter(Boolean).sort().at(-1);
    const range = {
      lo: later(addDays(night.lo, gap), obs[0], addDays(asOf, 1)),
      hi: later(addDays(night.hi, gap), obs.at(-1)),
    };
    if (earliest > out[slug].date) {
      row.push(`pushed from ${out[slug].date}: night ${night.date} (${night.how}) + ${gap}d`);
      out[slug] = { date: earliest, label: "weather", usual: out[slug].date, night: night.date, gap };
      row[2] = "weather"; row[3] = earliest;
    } else {
      row.push(`weather allows ${earliest}`);
    }
    const d = out[slug].date;
    out[slug].range = { lo: range.lo < d ? range.lo : d, hi: range.hi > d ? range.hi : d };
    row.push(`range ${out[slug].range.lo} to ${out[slug].range.hi}`);
  }
}

const ordered = Object.fromEntries(
  Object.entries(out).sort(([, a], [, b]) => a.date.localeCompare(b.date)),
);

const byKind = fitPoints.reduce((a, p) => ({ ...a, [p.kind]: (a[p.kind] ?? 0) + 1 }), {});
console.log(`fit: ${slope.toFixed(3)} days per snowmaking hour, R2 ${r2.toFixed(2)}, on ${fitPoints.length} points ` +
            `(${Object.entries(byKind).map(([k, n]) => `${n} ${k}`).join(", ")})`);
console.log("\nhill                 hrs  label    date        note");
if (live) console.log(`(this fall through ${asOf}; no-record hills borrow a ${pooledGap}-day gap)`);
for (const [slug, hrs, label, date, ...notes] of rows.sort((a, b) => a[3].localeCompare(b[3]))) {
  console.log(`${slug.padEnd(20)}${String(hrs ?? "?").padStart(4)}  ${label.padEnd(8)} ${date}  ${notes.join("; ")}`);
}

if (report) {
  console.log("\n--report: nothing written");
} else {
  writeFileSync("data/projection.json", JSON.stringify(ordered, null, 2) + "\n");
  console.log("\nwrote data/projection.json");
}
