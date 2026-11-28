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
// Dates a hill has put out for this season. Unlike the old announced and
// targeted dates below, these are current, so they win over the hill's own
// record. They also skip the weather check below: that check's gap comes from
// how long the hill has taken after its first cold night, and a hill like
// Lutsen has always opened weeks after the cold for reasons that are not cold.
// Holding its own posted date to that gap would overrule the hill.
const stated = existsSync("data/stated.json") ? read("data/stated.json") : null;
const statedNow = stated?.season === `${SEASON}-${String((SEASON + 1) % 100).padStart(2, "0")}`
  ? stated.hills : {};

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

// Past seasons only. This season's opening, once it happens, is the answer
// for this season, not one more sample of what the hill normally does: left
// in, Andes Tower Hills' 14 November 2026 pulled its own projection to itself.
const THIS_SEASON = `${SEASON}-${String((SEASON + 1) % 100).padStart(2, "0")}`;
const observed = slug => Object.entries(seasons[slug] ?? {})
  .filter(([season]) => season !== THIS_SEASON)
  .map(([, v]) => v.firstLift?.date).filter(Boolean).map(sinceOct).sort((a, b) => a - b);
const openedOn = slug => seasons[slug]?.[THIS_SEASON]?.firstLift?.date ?? null;

// A hill with no record of its own can be told to project like another hill
// whose record fits it better than the climate fit does: `projectLike` in
// resorts.json. It borrows that hill's openings and gaps, not its weather.
const recordHill = slug => observed(slug).length < 2 && resorts[slug].projectLike ? resorts[slug].projectLike : slug;

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
// Only the old hand-typed "announced" dates carry over from last run. A
// "target" is owned by stated.json: taken out of that file, it must go, or
// Detroit Mountain's withdrawn 27 November would outlive the post behind it.
const statedWins = slug => !statedNow[slug] && prior[slug]?.label === "announced" && observed(slug).length < 2;

// A date posted this season is the strongest anchor a hill without a record
// can give the fit, and it is read from stated.json, never from last run's
// output, so the fit does not depend on what the previous run happened to save.
const anchorPoint = slug => {
  if (observed(slug).length >= 2) return null;
  if (statedNow[slug]) return sinceOct(statedNow[slug].date);
  return statedWins(slug) ? sinceOct(prior[slug].date) : null;
};

const fitPoints = Object.keys(resorts).map(slug => {
  const x = hours[slug]?.normal;
  const obs = observed(slug);
  if (x == null) return null;
  if (obs.length >= 2) return { slug, x, y: median(obs), kind: "record" };
  const anchor = anchorPoint(slug);
  return anchor == null ? null : { slug, x, y: anchor, kind: statedNow[slug] ? "posted" : prior[slug].label };
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

  // Open is open. Nothing is projected for a hill that has already turned a
  // lift this season.
  if (openedOn(slug)) {
    const d = openedOn(slug);
    out[slug] = { date: d, label: "open", range: { lo: d, hi: d } };
    rows.push([slug, hours[slug]?.normal, "open", d, "opened"]);
    continue;
  }

  // An announced or targeted date is something a hill said about itself. The
  // model does not get to overrule it.
  if (statedWins(slug)) {
    out[slug] = { date: was.date, label: was.label };
    rows.push([slug, hours[slug]?.normal, was.label, was.date, "kept"]);
    continue;
  }

  if (statedNow[slug]) {
    const d = statedNow[slug].date;
    out[slug] = { date: d, label: "target", range: { lo: d, hi: d } };
    rows.push([slug, hours[slug]?.normal, "target", statedNow[slug].date, "stated this season"]);
    continue;
  }

  const peer = recordHill(slug);
  const obs = observed(peer);
  if (obs.length >= 2) {
    const date = toDate(median(obs));
    const label = peer === slug ? "model" : "peer";
    out[slug] = peer === slug ? { date, label } : { date, label, like: peer };
    rows.push([slug, hours[slug]?.normal, label, date,
               `median of ${obs.length}${peer === slug ? "" : ` at ${peer}`}, was ${was?.date ?? "—"}`]);
    continue;
  }

  const date = toDate(predict(hours[slug].normal));
  out[slug] = { date, label: "climate" };
  rows.push([slug, hours[slug]?.normal, "climate", date, `fit, was ${was?.date ?? "—"}`]);
}

// --- this fall's weather ------------------------------------------------------
// The record says when a hill normally opens. It cannot say when the cold has
// not come, or has come for a night and left. What a hill opens on is snow it
// has made, so the weather enters as hours banked: hours under 28 in the
// three weeks before the day. Each hill needs nine tenths of the fewest it has
// ever opened on; a hill with no record needs the median of everyone else's.
//
// Tested on the 60 openings on record, each predicted from the other seasons
// only: the median date alone misses by 7.0 days on average, the median held
// back until the hours are banked by about 6, whichever window and share. The
// first-night rule this replaced managed 6.9. For a hill predicted with no
// record of its own, 11.9 days becomes about 11; those dates are partly
// business decisions, which no weather explains.
//
// The hours come from three places in turn: what has happened this season
// (data/this-season.json), the forecast (data/forecast.json), and past its
// horizon each hill's normal for that day (data/coldhours.json). The American
// and European models set the range: the wetter one its early end, the drier
// one its late end, and their average the projection.
const coldHist = existsSync("data/coldhours.json") ? read("data/coldhours.json").hills : {};
const now = existsSync("data/this-season.json") ? read("data/this-season.json") : null;
const fc = existsSync("data/forecast.json") ? read("data/forecast.json") : null;
// Three weeks, not two. Scored on the record the two are a wash (5.8 days
// against 6.1), but a 14-day window forgets snow that is still on the hill:
// on 28 November it was dropping Hyland's mid-November cold just as a warm
// week set in, and held its projection to 16 December while Hyland posted
// that it was getting close.
const WINDOW = 21;
// A hill can open a little short of its fewest. On the record 90% and the
// full amount score the same; this season decided it. Lutsen opened on 152 hours against a fewest of 169, and
// Hyland Hills, needing 156, sat at 120 on 28 November with its own post
// saying it was getting close.
const NEED_SHARE = 0.9;
const NO_RECORD_MISS = 11;
const live = now?.season === SEASON;
const asOf = live ? now.through.slice(0, 10) : null;
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const dayOf = (year, iso) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${year}-09-01T00:00:00Z`)) / 86400000);
const autumnOf = season => +season.slice(0, 4);

// Hours under the line in the WINDOW days before day d of one autumn on record.
const bankedOn = (row, d) => {
  if (!row || d < WINDOW) return null;
  const xs = row.slice(d - WINDOW, d);
  return xs.some(x => x === null) ? null : xs.reduce((a, x) => a + x, 0);
};
const ownNeed = slug => {
  const got = Object.entries(seasons[slug] ?? {})
    .filter(([season, v]) => season !== THIS_SEASON && v.firstLift?.date)
    .map(([season, v]) => bankedOn(coldHist[slug]?.[autumnOf(season)], dayOf(autumnOf(season), v.firstLift.date)))
    .filter(x => x !== null);
  return got.length ? Math.min(...got) : null;
};
const ownNeeds = Object.keys(resorts).map(ownNeed).filter(x => x !== null).sort((a, b) => a - b);
const pooledNeed = ownNeeds.length ? median(ownNeeds) : null;
const needOf = slug => {
  const n = ownNeed(recordHill(slug)) ?? pooledNeed;
  return n === null ? null : n * NEED_SHARE;
};

// A hill's normal hours on each day of the autumn, averaged over the record.
const normalOn = (slug, d) => {
  const rows = Object.values(coldHist[slug] ?? {}).map(r => r[d]).filter(x => x !== null && x !== undefined);
  return rows.length ? rows.reduce((a, x) => a + x, 0) / rows.length : 0;
};

// Hours under the line on one date this season: what happened, then the
// forecast, then the normal. which picks how the two models combine.
function hoursOn(slug, iso, which) {
  if (iso < asOf) return now.hills?.[slug]?.daily?.[iso] ?? 0;
  const i = fc?.days?.indexOf(iso) ?? -1;
  const m = fc?.hills?.[slug]?.models;
  const xs = i < 0 || !m ? [] : ["gfs", "ecmwf"].map(k => m[k]?.dailyHours?.[i]).filter(x => x !== null && x !== undefined);
  if (!xs.length) return normalOn(slug, dayOf(SEASON, iso));
  return which === "wet" ? Math.max(...xs) : which === "dry" ? Math.min(...xs) : xs.reduce((a, x) => a + x, 0) / xs.length;
}

// The first day from tomorrow on with the hill's need banked, searching to the
// end of January. Null if never: a hill that cannot get there on normal
// weather is left on its record date.
function ready(slug, which) {
  const need = needOf(slug);
  if (need === null) return null;
  const memo = new Map();
  const h = iso => (memo.has(iso) ? memo.get(iso) : (memo.set(iso, hoursOn(slug, iso, which)), memo.get(iso)));
  for (let k = 1; k < 75; k++) {
    const day = addDays(asOf, k);
    let sum = 0;
    for (let j = 1; j <= WINDOW; j++) sum += h(addDays(day, -j));
    if (sum >= need) return day;
  }
  return null;
}

if (live) {
  const later = (...xs) => xs.filter(Boolean).sort().at(-1);
  for (const slug of Object.keys(out)) {
    if (EXTERNAL.has(out[slug].label) || out[slug].label === "open") continue;
    const row = rows.find(r => r[0] === slug);
    const mid = ready(slug, "mid"), wet = ready(slug, "wet"), dry = ready(slug, "dry");
    if (!mid) { row.push("weather: need not reached by January"); continue; }
    const need = Math.round(needOf(slug));
    if (mid > out[slug].date) {
      row.push(`pushed from ${out[slug].date}: ${need}h banked by ${mid}`);
      out[slug] = { date: mid, label: "weather", usual: out[slug].date, need };
      row[2] = "weather"; row[3] = mid;
    } else {
      row.push(`${need}h banked by ${mid}`);
    }
    // The range: each end the later of what the weather allows and what the
    // hill has done, its earliest and latest opening on record.
    // A hill with no record of its own has nothing to bound the late end, and
    // the backtest misses those by 11 days on average, so its range runs that
    // far past the projection rather than pretending to a single day.
    const obs = observed(recordHill(slug)).map(toDate);
    const d = out[slug].date;
    const lo = later(wet ?? mid, obs[0], addDays(asOf, 1));
    const hi = later(dry ?? mid, obs.length ? obs.at(-1) : addDays(d, NO_RECORD_MISS));
    out[slug].range = { lo: lo < d ? lo : d, hi: hi > d ? hi : d };
    row.push(`range ${out[slug].range.lo} to ${out[slug].range.hi}`);
  }
}

// A hill not recorded as open has not opened, as far as the site knows, so its
// projection cannot sit in the past: the board would read that as open. It
// holds at today until the hill opens or the weather moves it. Trollhaugen's
// 14 November passed on the 15th with no opening on record.
if (live) {
  for (const p of Object.values(out)) {
    if (p.label === "open" || p.date >= asOf) continue;
    p.date = asOf;
    if (p.range) p.range = { lo: p.range.lo < asOf ? asOf : p.range.lo, hi: p.range.hi < asOf ? asOf : p.range.hi };
  }
}

const ordered = Object.fromEntries(
  Object.entries(out).sort(([, a], [, b]) => a.date.localeCompare(b.date)),
);

const byKind = fitPoints.reduce((a, p) => ({ ...a, [p.kind]: (a[p.kind] ?? 0) + 1 }), {});
console.log(`fit: ${slope.toFixed(3)} days per snowmaking hour, R2 ${r2.toFixed(2)}, on ${fitPoints.length} points ` +
            `(${Object.entries(byKind).map(([k, n]) => `${n} ${k}`).join(", ")})`);
console.log("\nhill                 hrs  label    date        note");
if (live) console.log(`(this fall through ${asOf}; ${WINDOW}-day banked hours; no-record hills need ${Math.round(pooledNeed)}h)`);
for (const [slug, hrs, label, date, ...notes] of rows.sort((a, b) => a[3].localeCompare(b[3]))) {
  console.log(`${slug.padEnd(20)}${String(hrs ?? "?").padStart(4)}  ${label.padEnd(8)} ${date}  ${notes.join("; ")}`);
}

if (report) {
  console.log("\n--report: nothing written");
} else {
  writeFileSync("data/projection.json", JSON.stringify(ordered, null, 2) + "\n");
  console.log("\nwrote data/projection.json");
}
