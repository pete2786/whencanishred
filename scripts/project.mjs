// Projects each hill's first lift for the coming season from the record, and
// writes data/projection.json for the build to render.
//
//   node scripts/project.mjs            # write
//   node scripts/project.mjs --report   # print the working, write nothing
//
// Two estimators, because eight hills have five seasons on file and eight have
// none. A hill with its own history is projected from that history; a hill
// without one is projected from its climate, and the page says which by label.

import { readFileSync, writeFileSync } from "node:fs";

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
const anchorPoint = slug => {
  const was = prior[slug];
  return was && EXTERNAL.has(was.label) ? sinceOct(was.date) : null;
};

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
  if (was && EXTERNAL.has(was.label)) {
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

const ordered = Object.fromEntries(
  Object.entries(out).sort(([, a], [, b]) => a.date.localeCompare(b.date)),
);

const byKind = fitPoints.reduce((a, p) => ({ ...a, [p.kind]: (a[p.kind] ?? 0) + 1 }), {});
console.log(`fit: ${slope.toFixed(3)} days per snowmaking hour, R2 ${r2.toFixed(2)}, on ${fitPoints.length} points ` +
            `(${Object.entries(byKind).map(([k, n]) => `${n} ${k}`).join(", ")})`);
console.log("\nhill                 hrs  label    date        note");
for (const [slug, hrs, label, date, note] of rows.sort((a, b) => a[3].localeCompare(b[3]))) {
  console.log(`${slug.padEnd(20)}${String(hrs ?? "?").padStart(4)}  ${label.padEnd(8)} ${date}  ${note}`);
}

if (report) {
  console.log("\n--report: nothing written");
} else {
  writeFileSync("data/projection.json", JSON.stringify(ordered, null, 2) + "\n");
  console.log("\nwrote data/projection.json");
}
