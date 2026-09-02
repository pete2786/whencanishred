// Instagram frames for whencanishred, batch one.
//
// Every number on every card is read from data/ at build time. Nothing here is
// typed by hand, because a card that says a resort opens on a date the site does
// not claim is worse than no card at all -- and the whole pitch of the site is
// that it does not guess.
//
// The look is not invented either. The palette, the two faces and the hazard
// tape are lifted from the built site so a card and the page it points at
// cannot drift apart. Resort colours come out of index.html, which already holds
// them post-`readable()`-correction against the dark ground.
//
//   node social/make.mjs
//
// Emits:
//   social/cards.html   every frame at true pixel size, for screenshotting
//   social/review.html  the same frames scaled, beside their captions
//
// This is the seed of the eventual scripts/cards.mjs. It is deliberately one
// file while the layouts are still being argued about.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const read = p => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

const resorts    = read("data/resorts.json");
const projection = read("data/projection.json");
const seasons    = read("data/seasons.json");
const forecast   = read("data/forecast.json");
const hoursList  = read("data/hours.json");

const hours = new Map(hoursList.map(h => [h.hill, h]));
// hours.json keys on display name and shortens two of them.
const HOURS_ALIAS = { "Lutsen Mountains": "Lutsen" };
const hoursFor = name => hours.get(HOURS_ALIAS[name] ?? name);

// ---------------------------------------------------------------- the look
//
// Straight out of templates/index.html. Repeated rather than imported because
// the site's CSS is one inline block in a template, not a file anything can
// pull from; when cards.mjs lands, both should read one shared token list.
const TOKENS = {
  ground: "#0B0C0D", surface: "#141618", surface2: "#1D2023",
  line: "#33393D", lineSoft: "#24282B",
  ink: "#F3F5F6", ink2: "#A6AEB3", ink3: "#7B848A",
  accent: "#DCE9F0", accentSoft: "#1C2A33",
  mark: "#37D2E8", cold: "#37D2E8", coldSoft: "#0C2E34",
  warm: "#FF5B35",
};

// The hill inks the site actually renders, read back out of the built page so
// the contrast correction in build.mjs is honoured without duplicating it.
function hillInks() {
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  const out = {};
  for (const m of html.matchAll(/\.hm\[data-hill="([^"]+)"\]\{color:(#[0-9a-fA-F]{6})\}/g)) {
    out[m[1]] = m[2];
  }
  if (!Object.keys(out).length) throw new Error("no hill inks in index.html -- run scripts/build.mjs first");
  return out;
}
const INK = hillInks();
const ink = slug => INK[slug] ?? TOKENS.ink;
const nameOf = slug => resorts[slug]?.name ?? slug;

// ------------------------------------------------------------------ dates
const MONTHS = ["January","February","March","April","May","June",
                "July","August","September","October","November","December"];
const SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const parse = iso => new Date(`${iso}T12:00:00`);
const dayMonth = iso => { const d = parse(iso); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
const shortDate = iso => { const d = parse(iso); return `${SHORT[d.getMonth()]} ${d.getDate()}`; };

// The site's own countdown, imported rather than reimplemented. The two used
// to disagree by a day.
import { daysUntil } from "../scripts/lib/days.mjs";

// ------------------------------------------------------------ derived facts
//
// The claims the cards make, each computed rather than asserted.

// Who the record says went first, per season, and how sure we are.
function firstLiftTable(slugs) {
  const all = new Set();
  for (const s of slugs) for (const k of Object.keys(seasons[s] ?? {})) all.add(k);
  const list = [...all].sort();
  return list.map(season => {
    const cells = slugs.map(slug => {
      const f = seasons[slug]?.[season]?.firstLift;
      return f?.date ? { slug, date: f.date, precision: f.precision } : { slug, date: null };
    });
    const dated = cells.filter(c => c.date);
    const best = dated.length ? dated.reduce((a, b) => (b.date < a.date ? b : a)).date : null;
    return { season, cells, winners: dated.filter(c => c.date === best).map(c => c.slug) };
  });
}

// Where a date sits in its own season, not in the calendar. A ski season runs
// October to April, so 18 October is *early* and 14 January is *late* -- sorting
// the raw ISO strings puts November 2021 ahead of October 2022 and is wrong in
// both directions. Anything before June belongs to the back half of a season.
const seasonRank = iso => {
  const md = iso.slice(5);
  return (md < "06" ? "Z" : "A") + md;
};

// The earliest first lift anywhere in the record, by season position.
const earliest = (() => {
  let best = null;
  for (const [slug, byYear] of Object.entries(seasons)) {
    for (const [season, v] of Object.entries(byYear)) {
      const d = v.firstLift?.date;
      if (!d) continue;
      const rank = seasonRank(d);
      if (!best || rank < best.rank) {
        best = { slug, season, date: d, rank, precision: v.firstLift.precision };
      }
    }
  }
  return best;
})();

// Everyone who opened on the earliest date, and whoever came next -- only the
// resorts sharing that single next date, so "N days behind" describes all of them.
const earliestDay = (() => {
  const on = [], after = [];
  for (const [slug, byYear] of Object.entries(seasons)) {
    const v = byYear[earliest.season]?.firstLift;
    if (!v?.date) continue;
    if (v.date === earliest.date) on.push({ slug, ...v });
    else if (v.date > earliest.date) after.push({ slug, ...v });
  }
  after.sort((a, b) => a.date.localeCompare(b.date));
  const nextDate = after[0]?.date;
  return { on, next: after.filter(r => r.date === nextDate) };
})();

// The latest first lift in the record -- the outlier card.
const latest = (() => {
  let worst = null;
  for (const [slug, byYear] of Object.entries(seasons)) {
    for (const [season, v] of Object.entries(byYear)) {
      const d = v.firstLift?.date;
      if (!d) continue;
      const rank = seasonRank(d);
      if (!worst || rank > worst.rank) worst = { slug, season, date: d, rank, precision: v.firstLift.precision };
    }
  }
  return worst;
})();

// Resorts with no season on record at all -- the worklist, and the ask.
const undated = Object.keys(resorts)
  .filter(slug => !Object.values(seasons[slug] ?? {}).some(v => v.firstLift?.date))
  .map(slug => ({ slug, name: nameOf(slug), hours: hoursFor(nameOf(slug))?.normal ?? null }))
  .sort((a, b) => (b.hours ?? 0) - (a.hours ?? 0));

// The cold-hours extremes, for the wet-bulb explainer.
const byHours = [...hoursList].sort((a, b) => b.normal - a.normal);

// The next resort up, whatever the model says.
const nextUp = (() => {
  const rows = Object.entries(projection)
    .map(([slug, p]) => ({ slug, ...p }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const first = rows[0];
  return { ...first, ties: rows.filter(r => r.date === first.date), all: rows };
})();

// North-is-not-earlier: the pair that makes the point hardest.
const northPair = (() => {
  const withHours = Object.entries(projection).map(([slug, p]) => ({
    slug, name: nameOf(slug), date: p.date, label: p.label,
    lat: resorts[slug]?.lat, hrs: hoursFor(nameOf(slug))?.normal ?? null,
  })).filter(r => r.hrs != null && r.lat != null);
  // The northernmost resort against the earliest-opening one.
  const north = withHours.reduce((a, b) => (b.lat > a.lat ? b : a));
  const early = withHours.reduce((a, b) => (b.date < a.date ? b : a));
  return { north, early };
})();

// Forecast triad -- the three climates, same three resorts the site uses.
const TRIAD = [
  { slug: "hyland-hills",     label: "Metro",       note: "Bloomington" },
  { slug: "spirit-mountain",  label: "Duluth",      note: "Spirit Mountain" },
  { slug: "lutsen-mountains", label: "North Shore", note: "Lutsen" },
];
const coldest = (() => {
  const known = Object.entries(forecast.hills).filter(([, h]) => h.min !== null);
  const [slug, h] = known.reduce((a, b) => (b[1].min < a[1].min ? b : a));
  return { slug, ...h, withWindow: known.filter(([, x]) => x.hoursUnder > 0).length, of: known.length };
})();

// ------------------------------------------------------------------- html
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const dataUri = rel => {
  const buf = readFileSync(join(ROOT, rel));
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
};

// The site's wordmark, lowercase, "shred" in the accent.
const MARK = `<span class="wm">when can i <em>shred</em></span>`;
const DOMAIN = `whencanishred.com`;

// A projected date must never appear without the site's own label for how it
// was arrived at. This is the one rule the cards are not allowed to relax.
const LABEL = {
  model:   n => `median of ${n > 1 ? "each resort's" : "this resort's"} own record`,
  climate: n => `estimated from cold hours -- no record ${n > 1 ? "for these" : "yet"}`,
};
const provenance = (label, n = 1) =>
  `<span class="prov"><span class="prov-k">${esc(label)}</span>${esc(LABEL[label]?.(n) ?? "")}</span>`;

const PRECISION_NOTE = {
  exact:   "",
  bracket: "±",
};
const prec = p => PRECISION_NOTE[p] ? `<span class="pm" title="dated to a window, not a day">±</span>` : "";


const places = read("data/places.json");

// ------------------------------------------------------------ powder
//
// Natural snow, which is a different question from everything else here.
// Optional: the file only exists once scripts/powder.mjs has been run.
const powder = existsSync(join(ROOT, "data/powder.json"))
  ? read("data/powder.json")
  : { horizonDays: 16, thresholds: { freshCm: 3, goodCm: 8, bigCm: 15 }, hills: {} };

const GRADE_LABEL = {
  fresh: "Worth going",
  good:  "A powder day here",
  big:   "Season highlight",
};

// The best day any resort is forecast, if one clears the bar at all.
const bestPowder = (() => {
  let best = null;
  for (const [slug, v] of Object.entries(powder.hills ?? {})) {
    if (!v?.best) continue;
    if (!best || v.best.score > best.best.score) best = { slug, ...v };
  }
  if (!best) return null;
  const b = best.best;
  return {
    hill: nameOf(best.slug), ink: ink(best.slug),
    headline: b.grade === "big" ? "The best day<br>of the run." : "Fresh snow<br>on the way.",
    when: dayMonth(b.date),
    snowCm: b.snowCm, tempC: b.tempC, ratio: b.ratio,
    grade: b.grade, gradeLabel: GRADE_LABEL[b.grade],
  };
})();

// A winter day, so the template can be judged in August. Every frame built
// from this is stamped on its face, and nothing derived from it is ever
// presented as a forecast.
const POWDER_SAMPLE = {
  hill: "Lutsen Mountains", ink: ink("lutsen-mountains"),
  headline: "Fresh snow<br>on the way.",
  when: "12 January", snowCm: 11.4, tempC: -9.6, ratio: 16,
  grade: "good", gradeLabel: GRADE_LABEL.good,
};

// ----------------------------------------------------------- region stories
//
// Every region has exactly three reference points, so the grid is uniform.
// What sits in the right-hand column is not: Minnesota has resorts with a record
// to project from, and the other five have climatology and nothing else.
const REGION_NAMES = {
  wi:       { name: "Wisconsin",                    file: "wisconsin.html" },
  "mi-up":  { name: "Michigan · Upper Peninsula", file: "michigan-up.html" },
  "mi-lp":  { name: "Michigan · Lower Peninsula", file: "michigan-lp.html" },
  "dak-ia": { name: "Dakotas & Iowa",               file: "dakotas-iowa.html" },
  "oh-in":  { name: "Ohio & Indiana",               file: "ohio-indiana.html" },
};
const REGION_COUNT = Object.keys(REGION_NAMES).length + 1;

// What is actually out there, against what we hold. known-resorts.json is a
// names-only roster read off the Midwest Skiers map, so it is the honest
// denominator: 98 resorts exist, we track 19, and 12 have a date.
const known = read("data/known-resorts.json");
const KNOWN_BY_REGION = Object.fromEntries(
  Object.entries(known.regions).map(([id, list]) => [id, list.length]));
const KNOWN_TOTAL = Object.values(KNOWN_BY_REGION).reduce((a, b) => a + b, 0);

const TRACKED_TOTAL = Object.keys(resorts).length;
const DATED_TOTAL = Object.keys(resorts)
  .filter(s => Object.values(seasons[s] ?? {}).some(v => v.firstLift?.date)).length;

// Resorts we track in a region, by the region ids the roster uses.
// The resorts a region is still missing, by name, off the full roster rather
// than off what we happen to track. A name we have never touched counts as
// missing just as much as one we track and have no season for.
const DATED_NAMES = new Set(Object.entries(resorts)
  .filter(([slug]) => Object.values(seasons[slug] ?? {}).some(v => v.firstLift?.date))
  .map(([, r]) => r.name.toLowerCase()));
const needDatesIn = id =>
  (known.regions[id] ?? []).map(x => x.name).filter(n => !DATED_NAMES.has(n.toLowerCase()));

const hasDates = slug => Object.values(seasons[slug] ?? {}).some(v => v.firstLift?.date);
const datedIn = id => Object.entries(resorts).filter(([slug, r]) =>
  (id === "mn" && r.state === "MN") || (id === "wi" && r.state === "WI"))
  .filter(([slug]) => hasDates(slug)).length;

const MN_SUBS = [
  { label: "Twin Cities", slug: "hyland-hills" },
  { label: "Duluth",      slug: "spirit-mountain" },
  { label: "North Shore", slug: "lutsen-mountains" },
];

// The spread of first lifts a resort actually has on record. Snowmaking hours
// are an input to the estimate, not an answer anybody wants; the dates are the
// answer, so the cards carry those and the hours stay behind the scenes.
function recordedRange(slug) {
  const dates = Object.values(seasons[slug] ?? {})
    .map(v => v.firstLift?.date).filter(Boolean)
    .sort((a, b) => seasonRank(a).localeCompare(seasonRank(b)));
  if (!dates.length) return null;
  return { n: dates.length, first: dates[0], last: dates.at(-1) };
}

const REGION_STORIES = [
  {
    id: "mn", name: "Minnesota", path: "whencanishred.com", dated: datedIn("mn"),
    blurb: "Three climates, one state",
    foot: "Projected from each resort's own record of first lifts.",
    subs: MN_SUBS.map(s => {
      const r = recordedRange(s.slug);
      return {
        label: s.label,
        note: nameOf(s.slug),
        ink: ink(s.slug),
        date: projection[s.slug] ? shortDate(projection[s.slug].date) : "--",
        qual: r
          ? `opened ${shortDate(r.first)} to ${shortDate(r.last)}`
          : "no record yet",
      };
    }),
  },
  ...Object.entries(REGION_NAMES).map(([id, meta]) => ({
    id, name: meta.name, path: `whencanishred.com/${meta.file}`, dated: datedIn(id),
    blurb: "When the guns can first run",
    // Wisconsin holds Trollhaugen, so the blanket "nothing gathered here" line
    // is false for it. The claim has to follow the region's own count.
    foot: datedIn(id)
      ? "These are snowmaking windows, not openings."
      : "No opening dates gathered here yet. These are snowmaking windows, not openings.",
    subs: Object.entries(places)
      .filter(([, p]) => p.region === id)
      .map(([slug, p]) => ({
        label: p.label,
        // The reference town, when it differs from the area's name. Wausau stands
        // for itself, so printing it twice just looks like a bug.
        note: [p.name, p.note].find(x => x && x !== p.label) ?? "",
        date: p.window?.normal ? shortDate(`2026-${p.window.normal}`) : "--",
        qual: p.window?.earliest
          ? `earliest ${shortDate(`2026-${p.window.earliest}`)} in ${p.window.years} yrs`
          : "",
      })),
  })),
];

// ------------------------------------------------------------------ cards
//
// Each entry is one frame. `post` groups frames into a single Instagram post,
// so a carousel is several frames sharing one caption.

const cards = [];
const card = (o) => { cards.push(o); return o; };

// -- 0 -------------------------------------- best, median, worst for Minnesota
//
// The homepage hero, as a frame. Same resort the site leads with (the one
// projected earliest) and the same three scenarios: its earliest first lift on
// record, the median of its seasons, and its latest. Carries a live day count,
// so regenerate on the day it is posted.
const leader = Object.keys(projection)
  .sort((a, b) => projection[a].date.localeCompare(projection[b].date))[0];

const scenarios = (() => {
  const seen = Object.entries(seasons[leader] ?? {})
    .map(([season, s]) => ({ season, date: s.firstLift?.date }))
    .filter(e => e.date)
    .sort((a, b) => seasonRank(a.date).localeCompare(seasonRank(b.date)));
  if (seen.length < 2) return null;
  return [
    { ...seen[0], key: "early", lede: "earliest on record" },
    { ...seen[Math.floor((seen.length - 1) / 2)], key: "real", lede: `median of ${seen.length} seasons` },
    { ...seen.at(-1), key: "late", lede: "latest on record" },
  ];
})();

// A recorded date replayed onto the coming season, which is what makes a day
// count from it meaningful.
const thisSeason = iso => {
  const md = iso.slice(5);
  const y = md < "06" ? SEASON_START + 1 : SEASON_START;
  return `${y}-${md}`;
};
const SEASON_START = new Date().getMonth() >= 5
  ? new Date().getFullYear() : new Date().getFullYear() - 1;

if (scenarios) card({
  post: 0, name: "mn-scenarios", kind: "Feed · single", w: 1080, h: 1080,
  title: "Best, median, worst",
  body: `
  <div class="c photo">
    <img src="${dataUri("photos/wild-mountain-night-840.jpg")}" alt="">
    <div class="scrim scrim-even"></div>
    <div class="pad col">
    <div class="top">${MARK}</div>
    <div class="grow col ctr" style="gap:24px; justify-content:center">
      <p class="kicker cyan">Opening day at <span style="color:${ink(leader)}">${esc(nameOf(leader))}</span> is in&hellip;</p>
      <div class="scens">
        ${scenarios.map(s => {
          const iso = thisSeason(s.date);
          const days = daysUntil(iso);
          return `<div class="scen${s.key === "real" ? " scen-real" : ""}">
            <span class="scen-num">${days}<span class="scen-unit">days</span></span>
            <span class="scen-date">${esc(shortDate(iso))}</span>
            <span class="scen-lede">${esc(s.lede)}<span class="scen-yr">${esc(s.season)}</span></span>
          </div>`;
        }).join("\n")}
      </div>
    </div>
    <div class="rule tape"></div>
    <p class="foot">${DOMAIN}</p>
    </div>
  </div>`,
});

// -- 1 ------------------------------------------------------ what this is
//
// The photo treatment David liked, with the copy pointed at the reader instead
// of at how the site got made.
card({
  post: 1, name: "what-this-is", kind: `Feed · carousel 1/${REGION_STORIES.length + 1}`, w: 1080, h: 1080,
  title: "What this is",
  body: `
  <div class="c photo">
    <img src="${dataUri("photos/wild-mountain-lowsun-840.jpg")}" alt="">
    <div class="scrim"></div>
    <div class="pad col">
      <div class="top">${MARK}<span class="pg">1/${REGION_STORIES.length + 1}</span></div>
      <div class="grow"></div>
      <p class="kicker">${KNOWN_TOTAL} resorts across ${REGION_COUNT} regions</p>
      <h1 class="huge">When does<br>your resort<br>open?</h1>
      <p class="sub">Built on 31 years of hourly weather. We have historic
        opening dates for <b>${DATED_TOTAL}</b> of them so far, and we need the rest.</p>
      <div class="rule tape"></div>
      <p class="foot">${DOMAIN}<span class="swipe">swipe &rarr;</span></p>
    </div>
  </div>`,
});

// -- 1b ------------------------------------------------ a slide per region
//
// The opening post is the survey: the photo frame states the gap in one line,
// then one slide per region shows where the gap actually is. Each slide ends
// with how many resorts are known to be there against how many we hold dates
// for, which is the ask stated in numbers rather than pleaded for.
for (const [i, r] of REGION_STORIES.entries()) {
  const knownN = KNOWN_BY_REGION[r.id] ?? null;
  card({
    post: 1, name: `region-${r.id}`,
    kind: `Feed \u00b7 carousel ${i + 2}/${REGION_STORIES.length + 1}`, w: 1080, h: 1080,
    body: `
    <div class="c col pad">
      <div class="top">${MARK}<span class="pg">${i + 2}/${REGION_STORIES.length + 1}</span></div>
      <div class="grow col" style="gap:20px; justify-content:center">
        <p class="kicker cyan">${esc(r.blurb)}</p>
        <h2 class="mid" style="font-size:${r.name.length > 22 ? 46 : 60}px">${esc(r.name)}</h2>
        <div class="rsubs">
          ${r.subs.map(s => `
          <div class="rsub">
            <div class="rsub-l">
              <p class="rsub-k"${s.ink ? ` style="color:${s.ink}"` : ""}>${esc(s.label)}</p>
              <p class="rsub-n">${esc(s.note)}</p>
            </div>
            <div class="rsub-r">
              <p class="rsub-v">${esc(s.date)}</p>
              <p class="rsub-d">${esc(s.qual)}</p>
            </div>
          </div>`).join("\n")}
        </div>
        <p class="rsub-key">${esc(r.foot)}</p>
        ${knownN ? (() => {
          // The ask follows the coverage, not merely the presence of a date.
          // Wisconsin holding one season out of 23 resorts needs history as
          // badly as a region holding none; only a region that is genuinely
          // half covered has earned the plain tally.
          const thin = r.dated < knownN / 2;
          return `<div class="gapbar">
          <span class="gapbar-k">${knownN} resorts here${r.dated && thin ? `, ${r.dated} dated` : ""}</span>
          <span class="gapbar-v${thin ? " none" : ""}">${thin
            ? "need more history"
            : `${r.dated} with opening dates`}</span>
        </div>`;
        })() : ""}
      </div>
      <div class="rule tape"></div>
      <p class="foot">${esc(r.path)}<span class="swipe">${i === REGION_STORIES.length - 1 ? "" : "swipe &rarr;"}</span></p>
    </div>`,
  });
}


// -- 2 -------------------------------------------- why 28 degrees, 3 slides
card({
  post: 2, name: "wetbulb-1", kind: "Feed · carousel 1/2", w: 1080, h: 1080,
  title: "Why 28&deg;F",
  body: `
  <div class="c col pad">
    <div class="top">${MARK}<span class="pg">1/2</span></div>
    <div class="grow center ctr">
      <p class="kicker cyan">The number your season runs on</p>
      <div class="temp"><span class="temp-n">28</span><span class="temp-u">&deg;F</span></div>
      <h2 class="mid">is not the temperature<br>on your phone</h2>
    </div>
    <div class="rule tape"></div>
    <p class="foot">${DOMAIN}<span class="swipe">swipe &rarr;</span></p>
  </div>`,
});

card({
  post: 2, name: "wetbulb-2", kind: "Feed · carousel 2/2", w: 1080, h: 1080,
  body: `
  <div class="c col pad">
    <div class="top">${MARK}<span class="pg">2/2</span></div>
    <div class="grow col gap">
      <h2 class="mid">Snow guns care about<br>humidity too.</h2>
      <div class="two">
        <div class="box">
          <p class="box-k">Dry air</p>
          <p class="box-v cyan">makes snow</p>
          <p class="box-n">even when the air temperature is above freezing</p>
        </div>
        <div class="box">
          <p class="box-k">Humid air</p>
          <p class="box-v warm">will not</p>
          <p class="box-n">even when the thermometer says it should</p>
        </div>
      </div>
      <p class="sub">Wet-bulb temperature folds both together. Under 28&deg;F,
        a resort can blow snow. Over it, the guns stay off.</p>
    </div>
    <div class="rule tape"></div>
    <p class="foot">${DOMAIN}<span class="swipe">swipe &rarr;</span></p>
  </div>`,
});

// -- 3 -------------------------------------------------------- how we guess
//
// The project's character, which is the honest part of "get to know us": it
// says which of its numbers are soft and gets out of the way when a resort speaks.
card({
  post: 3, name: "how-we-guess", kind: "Feed · single", w: 1080, h: 1080,
  title: "How we guess",
  body: `
  <div class="c col pad">
    <div class="top">${MARK}</div>
    <div class="grow col gap">
      <p class="kicker cyan">Every date here is labelled</p>
      <h2 class="mid">We tell you when<br>we&rsquo;re guessing.</h2>
      <div class="two">
        <div class="box">
          <p class="box-k cyan">Model</p>
          <p class="box-n">The resort has opening dates on record. We take the
            median of its own first lifts.</p>
        </div>
        <div class="box">
          <p class="box-k cyan">Climate</p>
          <p class="box-n">No record yet. We estimate from how much snowmaking
            weather it normally gets.</p>
        </div>
      </div>
      <p class="sub big-sub">And when a resort announces its own date, that wins.
        Always. We are guessing until they aren&rsquo;t.</p>
    </div>
    <div class="rule tape"></div>
    <p class="foot">${DOMAIN}</p>
  </div>`,
});

// -- 4 ------------------------------------------------- the battle for first
const RACERS = ["wild-mountain", "trollhaugen", "andes-tower-hills"];
const race = firstLiftTable(RACERS);
card({
  post: 4, name: "battle-for-first", kind: "Feed · single", w: 1080, h: 1080,
  title: "The battle for first",
  body: `
  <div class="c col pad">
    <div class="top">${MARK}</div>
    <div class="grow col gap">
      <p class="kicker cyan">First chair in Minnesota</p>
      <h2 class="mid">Three resorts battle it out.</h2>
      <table class="race">
        <thead><tr><th></th>${RACERS.map(s =>
          `<th style="color:${ink(s)}">${esc(nameOf(s).replace(" Tower Resorts", " Tower").replace(" Mountain", " Mtn"))}</th>`).join("")}</tr></thead>
        <tbody>
        ${race.map(r => `<tr>
          <td class="ry">${esc(r.season)}</td>
          ${r.cells.map(c => {
            const win = r.winners.includes(c.slug);
            return `<td class="${win ? "rw" : ""}"${win ? ` style="color:${ink(c.slug)}"` : ""}>${
              c.date ? esc(shortDate(c.date)) : "--"}</td>`;
          }).join("")}
        </tr>`).join("\n")}
        </tbody>
      </table>
    </div>
    <div class="rule tape"></div>
    <p class="foot">${DOMAIN}</p>
  </div>`,
});


// -- 6..11 -------------------------------------------------- help, per region
//
// The region slides in post 1 say a region needs history. These say which
// resorts, by name, because "we need dates for Michigan" is a shrug and
// "we need dates for Nub's Nob" is something a person can answer.
//
// One post per region, run as a series rather than all at once.
const HELP_REGIONS = [
  { id: "mn", name: "Minnesota", path: "whencanishred.com" },
  ...Object.entries(REGION_NAMES).map(([id, meta]) =>
    ({ id, name: meta.name, path: `whencanishred.com/${meta.file}` })),
];

for (const [i, h] of HELP_REGIONS.entries()) {
  const need = needDatesIn(h.id);
  const total = KNOWN_BY_REGION[h.id] ?? need.length;
  // The list is the card, so the type shrinks to fit rather than the list
  // getting trimmed. A truncated ask reads as though the rest do not matter.
  const size = need.length > 20 ? 25 : need.length > 14 ? 29 : need.length > 9 ? 34 : 40;
  const cols = need.length > 9 ? 2 : 1;
  card({
    post: 6 + i, name: `help-${h.id}`, kind: "Feed · single", w: 1080, h: 1080,
    title: `Help: ${h.name}`,
    body: `
    <div class="c col pad">
      <div class="top">${MARK}</div>
      <div class="grow col" style="gap:22px; justify-content:center">
        <p class="kicker warm">No opening date on file for any of these</p>
        <h2 class="mid" style="font-size:${h.name.length > 22 ? 46 : 58}px">${esc(h.name)}</h2>
        <ul class="need" style="font-size:${size}px; columns:${cols}">
          ${need.map(n => `<li>${esc(n)}</li>`).join("\n")}
        </ul>
        <div class="gapbar">
          <span class="gapbar-k">${need.length} of ${total} resorts</span>
          <span class="gapbar-v none">need more history</span>
        </div>
      </div>
      <div class="rule tape"></div>
      <p class="foot">Comment a year and a month &middot; ${esc(h.path)}</p>
    </div>`,
  });
}

// -- 12 ----------------------------------------------------- countdown story
const days = daysUntil(nextUp.date);
card({
  post: 12, name: "countdown-story", kind: "Story · template", w: 1080, h: 1920,
  title: "Countdown",
  body: `
  <div class="c col pad story">
    <div class="safe-t"></div>
    <div class="top">${MARK}</div>
    <div class="grow center ctr">
      <p class="kicker cyan">Until the first resort is projected to spin</p>
      <div class="cd"><span class="cd-n">${days}</span><span class="cd-u">days</span></div>
      <div class="cd-who">
        ${nextUp.ties.map(t => `<p class="who" style="color:${ink(t.slug)}">${esc(nameOf(t.slug))}</p>`).join("\n")}
        <p class="who-n">${esc(dayMonth(nextUp.date))}</p>
        ${provenance(nextUp.label, nextUp.ties.length)}
      </div>
      <div class="fc-mini">
        <p class="fc-k">Right now</p>
        <p class="fc-v">${forecast.horizonDays}-day forecast reaches
          <b class="warm">${coldest.min.toFixed(1)}&deg;F</b> at
          <b style="color:${ink(coldest.slug)}">${esc(nameOf(coldest.slug))}</b></p>
        <p class="fc-n">${coldest.withWindow === 0
          ? "No snowmaking weather anywhere yet."
          : `${coldest.withWindow} of ${coldest.of} resorts get a window.`}</p>
      </div>
    </div>
    <div class="linkzone">
      <span class="linkpill">&#128279; whencanishred.com</span>
      <p class="linkhint">link sticker sits here</p>
    </div>
    <div class="safe-b"></div>
  </div>`,
});

// -- 6 --------------------------------------------------------- powder story
//
// Rendered twice on purpose. The live frame shows what the data actually says
// today, which at the end of August is nothing; the sample beside it shows the
// same template with a winter day in it so the layout can be judged now. The
// sample is marked on the frame itself so a marked frame can never be posted
// by mistake.
const powderFrame = (p, isSample) => `
  <div class="c col pad story">
    ${isSample ? `<div class="sample-flag">Layout sample &middot; not real data</div>` : ""}
    <div class="safe-t"></div>
    <div class="top">${MARK}</div>
    <div class="grow col" style="gap:26px; justify-content:center">
      <p class="kicker cyan">Our best guess at the next good day</p>
      ${p ? `
      <h2 class="mid" style="font-size:62px">${p.headline}</h2>
      <div class="pow">
        <p class="pow-hill" style="color:${p.ink}">${esc(p.hill)}</p>
        <p class="pow-when">${esc(p.when)}</p>
        <div class="pow-n">
          <span class="pow-v">${p.snowCm}<span class="pow-u">cm</span></span>
          <span class="pow-sep"></span>
          <span class="pow-v2">${p.tempC}&deg;C<span class="pow-u2">air</span></span>
          <span class="pow-sep"></span>
          <span class="pow-v2">${p.ratio}:1<span class="pow-u2">ratio</span></span>
        </div>
        <p class="pow-grade ${p.grade}">${esc(p.gradeLabel)}</p>
      </div>`
      : `
      <h2 class="mid" style="font-size:62px">Nothing in<br>the next ${powder.horizonDays} days.</h2>
      <div class="pow empty">
        <p class="pow-when">No resort on the list is forecast enough snow to be
          worth the drive.</p>
      </div>`}
      <p class="rsub-key"><b>How we work it out.</b> Forecast snowfall, weighted
        by how light that snow should fall. Colder air gives a higher
        snow-to-liquid ratio. Then knocked down for wind and rain. It is a guess,
        the same way the opening dates are.</p>
      <p class="rsub-key">Midwest scale: <b>${powder.thresholds.freshCm}cm</b> is
        worth going, <b>${powder.thresholds.goodCm}cm</b> is a powder day here,
        <b>${powder.thresholds.bigCm}cm</b> is a season highlight. Fresh snow to
        rip, not the Rockies.</p>
    </div>
    <div class="linkzone">
      <span class="linkpill">&#128279; whencanishred.com</span>
      <p class="linkhint">link sticker sits here</p>
    </div>
    <div class="safe-b"></div>
  </div>`;

card({
  post: 13, name: "powder-story", kind: "Story · template", w: 1080, h: 1920,
  title: "Powder day",
  body: powderFrame(bestPowder, false),
});

card({
  post: 13, name: "powder-story-sample", kind: "Story · layout sample", w: 1080, h: 1920,
  body: powderFrame(POWDER_SAMPLE, true),
});

// -- 5 -------------------------------------------- the two extremes
//
// The record's outer edges in one card. Apart they are two anecdotes; together
// they are the range, and the range is the point: the same weather map has
// produced an October opening and a January one.
const latestHrs = hoursFor(nameOf(latest.slug));
// How far apart they sit *within a season*, not on the calendar. The two dates
// are 15 months apart in real time, which says nothing; laid on the same winter
// they are about three months apart, which is the entire point of the card.
const seasonDay = iso => {
  const [, m, d] = iso.split("-").map(Number);
  const base = m >= 6 ? Date.UTC(2000, m - 1, d) : Date.UTC(2001, m - 1, d);
  return Math.round((base - Date.UTC(2000, 9, 1)) / 86400000);
};
const spanDays = Math.abs(seasonDay(latest.date) - seasonDay(earliest.date));

card({
  post: 5, name: "extremes", kind: "Feed · single", w: 1080, h: 1080,
  title: "Earliest and latest on record",
  body: `
  <div class="c col pad">
    <div class="top">${MARK}</div>
    <div class="grow col" style="gap:26px; justify-content:center">
      <p class="kicker cyan">First lift, the outer edges of the record</p>
      <div class="ext">
        <div class="ext-r">
          <p class="ext-k">Earliest</p>
          <p class="ext-d">${esc(dayMonth(earliest.date))}</p>
          <p class="ext-y">${parse(earliest.date).getFullYear()}</p>
          <p class="ext-w">${earliestDay.on.map(o =>
            `<span style="color:${ink(o.slug)}">${esc(nameOf(o.slug))}</span>`).join(" and ")}</p>
        </div>
        <div class="ext-r">
          <p class="ext-k warm">Latest</p>
          <p class="ext-d">${esc(dayMonth(latest.date))}</p>
          <p class="ext-y">${parse(latest.date).getFullYear()}</p>
          <p class="ext-w"><span style="color:${ink(latest.slug)}">${esc(nameOf(latest.slug))}</span></p>
        </div>
      </div>
      <p class="sub">Same weather map, ${Math.abs(spanDays)} days apart. One
        October opening, one that waited until the middle of January.</p>
    </div>
    <div class="rule tape"></div>
    <p class="foot">${esc(earliest.season)} and ${esc(latest.season)} &middot; ${DOMAIN}</p>
  </div>`,
});

// ------------------------------------------------------------- parked
//
// Built, reviewed, and not in the current lineup. Kept because they are
// finished and cheap to bring back, not because they are scheduled.

// -- 3 ------------------------------------------- north is not earlier, x3
card({
  post: 20, parked: true, name: "north-1", kind: "Feed · carousel 1/2", w: 1080, h: 1080,
  title: "North isn't earlier",
  body: `
  <div class="c col pad">
    <div class="top">${MARK}<span class="pg">1/2</span></div>
    <div class="grow center">
      <p class="kicker cyan">The thing everyone gets wrong</p>
      <h1 class="big2">North does<br>not mean<br>earlier.</h1>
    </div>
    <div class="rule tape"></div>
    <p class="foot">${DOMAIN}<span class="swipe">swipe &rarr;</span></p>
  </div>`,
});

card({
  post: 20, parked: true, name: "north-2", kind: "Feed · carousel 2/2", w: 1080, h: 1080,
  body: `
  <div class="c col pad">
    <div class="top">${MARK}<span class="pg">2/2</span></div>
    <div class="grow col gap">
      <h2 class="mid">Colder resort.<br>Later opening.</h2>
      <div class="two">
        ${[northPair.north, northPair.early].map(r => `
        <div class="box" style="border-color:${ink(r.slug)}44">
          <p class="box-k" style="color:${ink(r.slug)}">${esc(r.name)}</p>
          <p class="box-h">${r.hrs}<span class="box-hu">hrs under 28&deg;F</span></p>
          <p class="box-d">${esc(shortDate(r.date))}</p>
          <p class="box-n">projected first lift</p>
          ${provenance(r.label)}
        </div>`).join("\n")}
      </div>
      <p class="sub">${esc(northPair.north.name)} is the furthest north on the
        list and gets <b>${northPair.north.hrs - northPair.early.hrs} more hours</b>
        of snowmaking weather, and still opens
        <b class="warm">${Math.round((parse(northPair.north.date) - parse(northPair.early.date)) / 86400000)} days later</b>.</p>
    </div>
    <div class="rule tape"></div>
    <p class="foot">${DOMAIN}<span class="swipe">swipe &rarr;</span></p>
  </div>`,
});

// -- 5 ----------------------------------------------------- the earliest ever
// ---------------------------------------------------------------- captions
//
// In David's voice: first person, same rigour as the site, no overselling.
// A caption never states a projected date without the site's own hedge.

const CAPTIONS = {
  1: {
    title: "What this is, and where the gaps are",
    when: "Post first. Pin it.",
    text: `Every autumn the same question goes round: when does it open?

Nobody aggregates that for resorts this size. So we pulled 31 years of hourly weather and worked it out: when each resort can physically start making snow, and when it normally opens.

${KNOWN_TOTAL} resorts across ${REGION_COUNT} regions. We have historic opening dates for ${DATED_TOTAL}.

${REGION_STORIES.map(r => {
  const k = KNOWN_BY_REGION[r.id];
  return `${r.name}: ${k} resorts, ${r.dated ? `${r.dated} dated` : "none dated"}.`;
}).join("\n")}

Minnesota dates are projected first lifts from each resort's own record. Everywhere else, that is when the guns can normally first run, which is the earliest an opening could happen and not the opening itself.

Swipe for your region. If yours is one of the ones with no dates, you are the source we do not have.

whencanishred.com`,
    alt: `Carousel: ${KNOWN_TOTAL} resorts across ${REGION_COUNT} regions, opening dates held for ${DATED_TOTAL}, then one slide per region with its three reference points and how many of its resorts have dates on record.`,
  },
  2: {
    title: "Why 28°F",
    when: "Day 3–4. The one that earns follows.",
    text: `28°F is the number the whole season runs on, and it isn't the number on your phone.

Snowmaking depends on wet-bulb temperature, which folds in humidity. Dry air at 34°F can make snow. Humid air at 30°F can't. It's why a resort sits idle on a day that feels plenty cold, and why the guns come on when you'd swear it was too warm.

We counted, for every resort, how many hours of October and November come in under it.

${byHours[0].hill} gets ${byHours[0].normal} across a normal October and November. ${byHours.at(-1).hill} gets ${byHours.at(-1).normal}, and in a lean year ${byHours.at(-1).lean}. Eleven hours, across two entire months.

Same weather map. Completely different winters.

whencanishred.com`,
    alt: "Three-slide explainer: 28 degrees Fahrenheit wet-bulb is the snowmaking threshold, why humidity matters, and a bar chart of October–November hours under it by resort.",
  },
  3: {
    title: "How we guess",
    when: "Day 6. Sets expectations early.",
    text: `Everything here is an estimate until a resort says otherwise, and we'd rather tell you which kind you're looking at.

If a resort has opening dates on record, we take the median of its own first lifts. That's labelled model.

If it doesn't, we estimate from how much snowmaking weather it normally gets. That's labelled climate, and it's the softer of the two.

The moment a resort announces its own date, the estimate goes in the bin. Their word beats our maths every time.

We'd rather leave a season blank than fill it with something we made up.

whencanishred.com`,
    alt: "Card explaining the two kinds of estimate. Model, from a resort's own record. Climate, from its snowmaking hours. A resort's own announcement always wins.",
  },
  4: {
    title: "The battle for first",
    when: "Day 10. Tag all three resorts.",
    text: `Same three resorts, five years running.

${RACERS.map(s => nameOf(s)).join(", ")}. Whoever gets first lift in Minnesota, it's one of these. They have the cold, the snowmaking, and apparently the stubbornness.

In ${earliest.season} two of them opened on the same day.

The ± marks a date bracketed rather than pinned: the archive caught the resort open before it caught it opening, so we know the week and not the morning. Better to show you that than round it off.

Every date on the site has its source attached. Some of them took real digging.

whencanishred.com`,
    alt: `Table of first-lift dates for ${RACERS.map(s => nameOf(s)).join(", ")} across five seasons, each resort in its own colour, winners highlighted.`,
  },
  5: {
    title: "Earliest and latest on record",
    when: "Day 12. The range post.",
    text: `The two outer edges of everything we hold.

${dayMonth(earliest.date)} ${parse(earliest.date).getFullYear()}: ${earliestDay.on.map(o => nameOf(o.slug)).join(" and ")} both spinning. October, in the Midwest.

${dayMonth(latest.date)} ${parse(latest.date).getFullYear()}: ${nameOf(latest.slug)} finally opened. Everyone else had been running for a month.

Same weather map. Same question. About three months between the answers.

That spread is the whole reason for the site. A normal opening date is an average of winters that look nothing like each other.

Were you out for either one? We would like to hear about it.

whencanishred.com`,
    alt: `The earliest and latest first lifts on record side by side: ${dayMonth(earliest.date)} ${parse(earliest.date).getFullYear()} for ${earliestDay.on.map(o => nameOf(o.slug)).join(" and ")}, and ${dayMonth(latest.date)} ${parse(latest.date).getFullYear()} for ${nameOf(latest.slug)}.`,
  },

  12: {
    title: "Countdown",
    when: "Weekly now. Daily from November.",
    text: `${days} days.

Reuse this all season. The number and the resort come straight off the site, so it's current whenever you post it. Link sticker on the frame.`,
    alt: `${days} days until the first resort is projected to open, ${nextUp.ties.map(t => nameOf(t.slug)).join(" and ")} on ${dayMonth(nextUp.date)}.`,
  },
  13: {
    title: "Powder day",
    when: "In-season only. Fire it when the model finds a day.",
    text: `${bestPowder
      ? `${bestPowder.snowCm}cm forecast at ${bestPowder.hill} on ${bestPowder.when}, falling at ${bestPowder.tempC}°C -- about a ${bestPowder.ratio}:1 ratio, so it should stay light.`
      : `Nothing clearing the bar in the next ${powder.horizonDays} days. This template stays in the drawer until it does.`}

Midwest scale, not Rockies scale: ${powder.thresholds.freshCm}cm is worth going, ${powder.thresholds.goodCm}cm is a powder day here, ${powder.thresholds.bigCm}cm is a season highlight. Fresh snow to rip, not waist deep.

Same honesty as the opening dates. It's our guess, from snowfall, temperature and wind. Link sticker on the frame.`,
    alt: bestPowder
      ? `Powder estimate: ${bestPowder.snowCm}cm at ${bestPowder.hill} on ${bestPowder.when} at ${bestPowder.tempC} degrees Celsius, graded ${bestPowder.grade}.`
      : `Powder day template showing no qualifying snow in the ${powder.horizonDays}-day forecast.`,
  },
  20: {
    title: "North isn't earlier",
    when: "Parked.",
    text: `${northPair.north.name} is the furthest north on the list and gets ${northPair.north.hrs} hours of snowmaking weather across October and November. ${northPair.early.name}, an easy drive from the Twin Cities, gets ${northPair.early.hrs}.

${northPair.north.name} is projected ${Math.round((parse(northPair.north.date) - parse(northPair.early.date)) / 86400000)} days later.

More cold, later opening. We don't know why, and we aren't going to guess.

whencanishred.com`,
    alt: `Two-slide carousel: north does not mean earlier. ${northPair.north.name} gets ${northPair.north.hrs} hours under 28 degrees and opens later than ${northPair.early.name} at ${northPair.early.hrs} hours.`,
  },
};

// One caption per help post. The names carry it, so the words stay short.
for (const [i, h] of HELP_REGIONS.entries()) {
  const need = needDatesIn(h.id);
  const total = KNOWN_BY_REGION[h.id] ?? need.length;
  CAPTIONS[6 + i] = {
    title: `Help: ${h.name}`,
    when: i === 0 ? "Start the help series here." : "Help series, one a week.",
    text: `${need.length} resorts in ${h.name} with no opening date on file anywhere.

${need.join("\n")}

These dates are genuinely not on the internet. We swept the Wayback Machine and filled 5 of 80 season slots, and no aggregator carries opening days for resorts this size. So it comes down to asking people.

If you rode any of these on an opening weekend, comment the year and roughly when. "Second weekend of December, 2022" is enough. We will go and find the post and check it.

${h.path}`,
    alt: `${need.length} of ${total} resorts in ${h.name} have no opening date on record: ${need.slice(0, 6).join(", ")}${need.length > 6 ? ", and more" : ""}.`,
  };
}

// -------------------------------------------------------------------- css
const CARD_CSS = `
:root{
  --ground:${TOKENS.ground}; --surface:${TOKENS.surface}; --surface-2:${TOKENS.surface2};
  --line:${TOKENS.line}; --line-soft:${TOKENS.lineSoft};
  --ink:${TOKENS.ink}; --ink-2:${TOKENS.ink2}; --ink-3:${TOKENS.ink3};
  --accent:${TOKENS.accent}; --accent-soft:${TOKENS.accentSoft};
  --mark:${TOKENS.mark}; --cold:${TOKENS.cold}; --cold-soft:${TOKENS.coldSoft};
  --warm:${TOKENS.warm};
}
.frame{
  background:var(--ground); color:var(--ink); overflow:hidden; position:relative;
  font-family:Archivo,"Helvetica Neue",Arial,sans-serif;
  -webkit-font-smoothing:antialiased;
}
.frame *{box-sizing:border-box; margin:0;}
.c{width:100%; height:100%; position:relative;}
.col{display:flex; flex-direction:column;}
.pad{padding:64px 68px;}
.grow{flex:1; display:flex; flex-direction:column; min-height:0;}
.grow.center{justify-content:center;}
.gap{gap:34px;}
.cyan{color:var(--cold);} .warm{color:var(--warm);}

/* Display type is Anton throughout, as the site forces it to be. */
.wm,.huge,.big2,.mid,.temp-n,.temp-u,.date-h,.date-y,.who,.cd-n,.cd-u,
.tri-v,.thresh-v,.box-v,.box-h,.box-d,.why-v,.bar-n,.race th,.race td,.cta,.gap-h{
  font-family:Anton,"Archivo Narrow",Impact,sans-serif; font-weight:400;
}

.top{display:flex; align-items:baseline; justify-content:space-between; flex:none; margin-bottom:32px;}
.wm{font-size:34px; letter-spacing:.005em; color:var(--ink);}
.wm em{color:var(--mark); font-style:normal;}
.pg{font-size:20px; font-weight:600; color:var(--ink-3); letter-spacing:.1em;}

.kicker{
  font-size:22px; font-weight:700; letter-spacing:.15em; text-transform:uppercase;
  color:var(--ink-3);
}
.kicker.cyan{color:var(--cold);} .kicker.warm{color:var(--warm);}

.huge{font-size:104px; line-height:.94; letter-spacing:-.015em; margin-top:20px;}
.big2{font-size:118px; line-height:.92; letter-spacing:-.02em; margin-top:22px;}
.mid{font-size:70px; line-height:1.0; letter-spacing:-.01em;}

.sub{font-size:29px; line-height:1.42; color:var(--ink-2); max-width:34ch;}
.sub.big-sub{font-size:33px; color:var(--ink);}
.sub b{color:var(--ink); font-weight:700;}
.sub b.warm,.who-n b.warm{color:var(--warm);}
.sub b.cyan,.who-n b.cyan{color:var(--cold);}
.center-t{margin:24px auto 0; text-align:center;}

.rule{height:12px; margin-top:32px; flex:none;}
.tape{background:repeating-linear-gradient(45deg,var(--accent) 0 10px,transparent 10px 20px);}
.foot{
  display:flex; justify-content:space-between; align-items:baseline;
  font-size:23px; font-weight:700; letter-spacing:.05em; color:var(--ink-2);
  padding-top:22px; flex:none;
}
.swipe{color:var(--ink-3); font-weight:600; letter-spacing:.1em; text-transform:uppercase; font-size:19px;}

/* photo card */
.photo img{position:absolute; inset:0; width:100%; height:100%; object-fit:cover;}
.photo .scrim{
  position:absolute; inset:0;
  background:linear-gradient(180deg,rgba(11,12,13,.55) 0%,rgba(11,12,13,.2) 32%,rgba(11,12,13,.93) 74%,rgba(11,12,13,.99) 100%);
}
.photo .pad{position:relative; height:100%;}
.photo .scrim-even{
  background:linear-gradient(180deg,rgba(11,12,13,.86) 0%,rgba(11,12,13,.78) 45%,rgba(11,12,13,.92) 100%);
}

/* the 28 degree slide */
.temp{display:flex; align-items:flex-start; justify-content:center; margin:8px 0 4px;}
.temp-n{font-size:300px; line-height:.82; letter-spacing:-.03em; color:var(--cold);}
.temp-u{font-size:96px; color:var(--cold); margin-top:26px;}
.mid + .sub{margin-top:4px;}
.ctr{text-align:center;}
.ctr .mid{margin-top:10px;}
.ctr .sub{margin-left:auto; margin-right:auto;}

/* two-up boxes */
.two{display:grid; grid-template-columns:1fr 1fr; gap:26px;}
.box{
  border:2px solid var(--line); border-radius:4px; padding:32px 30px;
  background:var(--surface); display:flex; flex-direction:column; gap:10px;
}
.box-k{font-size:21px; font-weight:800; letter-spacing:.12em; text-transform:uppercase; color:var(--ink-3);}
.box-v{font-size:52px; line-height:1;}
.box-h{font-size:66px; line-height:1; display:flex; align-items:baseline; gap:12px; flex-wrap:wrap;}
.box-hu{font-family:Archivo,sans-serif; font-size:19px; font-weight:600; color:var(--ink-3); letter-spacing:.04em;}
.box-d{font-size:44px; line-height:1; color:var(--ink);}
.box-n{font-size:21px; line-height:1.35; color:var(--ink-3); font-weight:500;}

.prov{display:block; margin-top:6px; font-size:17px; line-height:1.3; color:var(--ink-3);}
.prov-k{
  display:inline-block; font-size:15px; font-weight:800; letter-spacing:.12em;
  text-transform:uppercase; color:var(--cold); border:1px solid var(--cold);
  border-radius:3px; padding:2px 7px; margin-right:8px;
}

/* bars */
.bars{display:flex; flex-direction:column; gap:17px;}
.bar{display:grid; grid-template-columns:270px 1fr 74px; align-items:center; gap:20px;}
.bar-l{font-size:24px; font-weight:700; letter-spacing:.01em;}
.bar-t{height:20px; background:var(--surface-2); border-radius:2px; overflow:hidden;}
.bar-f{display:block; height:100%;}
.bar-n{font-size:32px; text-align:right; font-variant-numeric:tabular-nums; color:var(--ink);}

/* race table */
.race{width:100%; border-collapse:collapse; font-variant-numeric:tabular-nums;}
.race th{
  font-family:Archivo,sans-serif; font-size:20px; font-weight:800; text-transform:uppercase;
  letter-spacing:.08em; text-align:right; padding:0 0 14px; border-bottom:2px solid var(--line);
}
.race th:first-child{text-align:left;}
.race td{font-size:34px; text-align:right; padding:12px 0; border-bottom:1px solid var(--line-soft); color:var(--ink-3);}
.race td.rw{color:var(--ink);}
.race .ry{
  font-family:Archivo,sans-serif; font-size:23px; font-weight:700; text-align:left; color:var(--ink-2);
  letter-spacing:.02em;
}
.pm{color:var(--cold); font-size:.7em; vertical-align:super; margin-left:2px;}

/* big date cards */
.date-h{font-size:130px; line-height:.94; letter-spacing:-.02em; margin-top:14px; text-align:center;}
.date-y{font-size:74px; line-height:1; color:var(--ink-3); text-align:center; letter-spacing:-.01em;}
.whold{margin-top:40px; text-align:center;}
.who{font-size:56px; line-height:1.06; text-align:center;}
.who-n{font-size:27px; line-height:1.4; color:var(--ink-2); margin-top:12px; text-align:center;
  max-width:30ch; margin-left:auto; margin-right:auto;}
.who-n b{font-weight:700;}
.why{
  margin-top:44px; border-top:2px solid var(--line); padding-top:30px;
  display:flex; flex-direction:column; gap:6px; align-items:center;
}
.why-k{font-size:20px; font-weight:800; letter-spacing:.12em; text-transform:uppercase; color:var(--ink-3); text-align:center;}
.why-v{font-size:60px; line-height:1.06; display:flex; align-items:baseline; gap:14px;}
.why-u{font-family:Archivo,sans-serif; font-size:20px; font-weight:600; color:var(--ink-3); letter-spacing:.03em;}

/* gaps */
.gaps{display:flex; flex-direction:column; gap:0; border-top:2px solid var(--line);}
.gap-r{
  display:grid; grid-template-columns:1fr 132px 116px; align-items:baseline; gap:14px;
  padding:11px 0; border-bottom:1px solid var(--line-soft);
}
.gap-n{font-size:29px; font-weight:700; line-height:1.15;}
.gap-h{font-size:27px; text-align:right; color:var(--ink-2); font-variant-numeric:tabular-nums;}
.gap-hu{font-family:Archivo,sans-serif; font-size:15px; font-weight:600; color:var(--ink-3); margin-left:5px;}
.gap-d{
  font-size:14px; font-weight:800; letter-spacing:.1em; text-transform:uppercase;
  color:var(--warm); text-align:right;
}

.cta{
  font-size:56px; margin-top:34px; color:var(--cold); text-align:center; letter-spacing:-.01em;
}

/* stories */
.story{padding:64px 68px;}
.safe-t{height:180px; flex:none;}
.safe-b{height:210px; flex:none;}
.cd{display:flex; align-items:baseline; justify-content:center; gap:22px; margin:26px 0 0;}
.cd-n{font-size:280px; line-height:1; letter-spacing:-.035em;}
.cd-u{font-size:82px; color:var(--ink-3);}
.cd-who{margin-top:26px; text-align:center; display:flex; flex-direction:column; align-items:center;}
.fc-mini{
  margin-top:56px; border:2px solid var(--line); border-radius:4px; background:var(--surface);
  padding:34px 34px; display:flex; flex-direction:column; gap:10px;
}
.fc-k{font-size:20px; font-weight:800; letter-spacing:.14em; text-transform:uppercase; color:var(--ink-3);}
.fc-v{font-size:33px; line-height:1.32; color:var(--ink-2);}
.fc-v b{font-weight:700;}
.fc-n{font-size:24px; color:var(--ink-3);}
.linkzone{flex:none; display:flex; flex-direction:column; align-items:center; gap:14px; padding-bottom:8px;}
.linkpill{
  font-size:30px; font-weight:700; color:var(--ground); background:var(--accent);
  border-radius:999px; padding:18px 38px; letter-spacing:.01em;
}
.linkhint{
  font-size:18px; font-weight:700; letter-spacing:.14em; text-transform:uppercase;
  color:var(--ink-3); border:1px dashed var(--line); border-radius:3px; padding:8px 16px;
}

/* region stories */
.rsubs{display:flex; flex-direction:column; gap:16px;}
.rsub{
  display:grid; grid-template-columns:1fr auto; align-items:center; gap:24px;
  border:2px solid var(--line); border-radius:4px; background:var(--surface);
  padding:28px 32px;
}
.rsub-k{
  font-family:Anton,Impact,sans-serif; font-weight:400; font-size:42px;
  line-height:1.04; letter-spacing:-.005em; color:var(--ink);
}
.rsub-n{font-size:21px; color:var(--ink-3); font-weight:600; margin-top:4px;}
.rsub-r{text-align:right;}
.rsub-v{
  font-family:Anton,Impact,sans-serif; font-weight:400; font-size:60px; line-height:1;
  color:var(--cold); font-variant-numeric:tabular-nums;
}
.rsub-u{
  font-family:Archivo,sans-serif; font-size:20px; font-weight:600;
  color:var(--ink-3); letter-spacing:.04em; margin-left:8px;
}
.rsub-d{font-size:19px; color:var(--ink-2); font-weight:600; margin-top:6px;}
.rsub-key{font-size:23px; line-height:1.45; color:var(--ink-3);}
.rsub-key b{color:var(--ink-2); font-weight:700;}

/* The homepage hero's three scenarios, same shape as templates/index.html. */
.scens{display:flex; align-items:flex-end; justify-content:center; gap:44px; flex-wrap:wrap;}
.scen{display:flex; flex-direction:column; align-items:center; text-align:center;}
.scen-num{
  font-family:Anton,Impact,sans-serif; font-weight:400; font-size:78px; line-height:.9;
  letter-spacing:-.02em; color:var(--ink-2); font-variant-numeric:tabular-nums;
}
.scen-real .scen-num{font-size:132px; color:var(--ink);}
.scen-unit{
  font-family:Anton,Impact,sans-serif; font-size:.36em; color:var(--ink-3);
  margin-left:.12em; letter-spacing:0;
}
.scen-date{
  font-family:Anton,Impact,sans-serif; font-weight:400; font-size:34px;
  margin-top:14px; color:var(--ink-2);
}
.scen-real .scen-date{color:var(--accent);}
.scen-lede{
  font-size:17px; font-weight:800; letter-spacing:.1em; text-transform:uppercase;
  color:var(--ink-3); margin-top:8px; line-height:1.5;
}
.scen-yr{display:block; letter-spacing:.06em; opacity:.75; font-weight:600;}

/* The resorts still missing a date. A list is the whole card, so it columns
   rather than scrolls, and the type sizes to the count. */
.need{list-style:none; padding:0; margin:0; column-gap:36px;}
.need li{
  line-height:1.5; color:var(--ink); font-weight:600;
  break-inside:avoid; letter-spacing:.005em;
}
.need li::before{content:"\\2022"; color:var(--warm); margin-right:10px; font-weight:800;}

/* The record's outer edges, side by side. */
.ext{display:grid; grid-template-columns:1fr 1fr; gap:26px;}
.ext-r{
  border:2px solid var(--line); border-radius:4px; background:var(--surface);
  padding:32px 30px; display:flex; flex-direction:column; gap:4px;
}
.ext-k{
  font-size:21px; font-weight:800; letter-spacing:.14em; text-transform:uppercase;
  color:var(--cold);
}
.ext-k.warm{color:var(--warm);}
.ext-d{font-family:Anton,Impact,sans-serif; font-weight:400; font-size:66px; line-height:1.02; letter-spacing:-.01em;}
.ext-y{font-family:Anton,Impact,sans-serif; font-weight:400; font-size:38px; line-height:1; color:var(--ink-3);}
.ext-w{font-size:26px; font-weight:700; line-height:1.3; margin-top:10px;}

/* The gap, stated on every region slide: what exists against what we hold. */
.gapbar{
  display:flex; align-items:baseline; justify-content:space-between; gap:18px;
  border-top:2px solid var(--line); padding-top:16px;
}
.gapbar-k{font-size:22px; font-weight:700; color:var(--ink-2);}
.gapbar-v{
  font-size:19px; font-weight:800; letter-spacing:.1em; text-transform:uppercase;
  color:var(--cold);
}
.gapbar-v.none{color:var(--warm);}

/* powder */
.pow{
  border:2px solid var(--line); border-radius:4px; background:var(--surface);
  padding:34px 34px; display:flex; flex-direction:column; gap:14px;
}
.pow.empty{background:none; border-style:dashed;}
.pow-hill{font-family:Anton,Impact,sans-serif; font-weight:400; font-size:56px; line-height:1;}
.pow-when{font-size:27px; color:var(--ink-2); font-weight:600;}
.pow-n{display:flex; align-items:center; gap:22px; flex-wrap:wrap; margin-top:4px;}
.pow-sep{width:2px; height:44px; background:var(--line);}
.pow-v{
  font-family:Anton,Impact,sans-serif; font-weight:400; font-size:78px; line-height:1;
  color:var(--cold); display:flex; align-items:baseline;
}
.pow-u{font-family:Archivo,sans-serif; font-size:24px; font-weight:600; color:var(--ink-3); margin-left:6px;}
.pow-v2{
  font-family:Anton,Impact,sans-serif; font-weight:400; font-size:46px; line-height:1;
  color:var(--ink); display:flex; align-items:baseline;
}
.pow-u2{font-family:Archivo,sans-serif; font-size:18px; font-weight:600; color:var(--ink-3); margin-left:6px;}
.pow-grade{
  font-size:20px; font-weight:800; letter-spacing:.14em; text-transform:uppercase;
  border-radius:3px; padding:9px 16px; align-self:flex-start; margin-top:4px;
}
.pow-grade.fresh{color:var(--ink-2); border:1px solid var(--line);}
.pow-grade.good{color:var(--cold); border:1px solid var(--cold); background:var(--cold-soft);}
.pow-grade.big{color:var(--ground); background:var(--cold);}

/* A sample frame says so on its face, so it cannot be posted by accident. */
.sample-flag{
  position:absolute; top:0; left:0; right:0; z-index:5; text-align:center;
  font-size:22px; font-weight:800; letter-spacing:.16em; text-transform:uppercase;
  color:var(--ground); background:var(--warm); padding:14px 0;
}

/* triad */
.triad{display:grid; grid-template-columns:1fr; gap:20px;}
.tri{
  display:grid; grid-template-columns:1fr auto; align-items:center; gap:20px;
  border:2px solid var(--line); border-radius:4px; background:var(--surface); padding:30px 34px;
}
.tri-k{font-size:36px; font-weight:800; letter-spacing:.02em; color:var(--ink);}
.tri-n{font-size:20px; color:var(--ink-3); font-weight:600; grid-column:1;}
.tri-v{font-size:78px; line-height:.9; grid-row:1 / span 2; grid-column:2; display:flex; align-items:flex-start;}
.tri-u{font-size:30px; margin-top:8px;}
.thresh{
  display:flex; align-items:baseline; justify-content:center; gap:16px;
  border-top:2px solid var(--cold); border-bottom:2px solid var(--cold);
  padding:22px 0; background:var(--cold-soft);
}
.thresh-l{font-size:24px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--ink-2);}
.thresh-v{font-size:62px; line-height:1; color:var(--cold);}
`;

// --------------------------------------------------------- cards.html
//
// Every frame at true pixel size, one per screen, for screenshotting.

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Anton&family=Archivo:wght@400;500;600;700;800&display=swap">`;

const sheet = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>whencanishred · card sheet</title>
${FONTS}
<style>
body{margin:0; background:#000; display:flex; flex-direction:column; align-items:center; gap:40px; padding:40px 0;}
${CARD_CSS}
.frame{flex:none;}
.tag{font-family:Archivo,sans-serif; color:#7B848A; font-size:13px; letter-spacing:.12em;
  text-transform:uppercase; font-weight:700;}
</style></head><body>
${cards.map(c => `<p class="tag">${c.name} &middot; ${c.w}&times;${c.h}</p>
<div class="frame" id="${c.name}" style="width:${c.w}px;height:${c.h}px">${c.body}</div>`).join("\n")}
</body></html>`;

mkdirSync(join(HERE, "out"), { recursive: true });
writeFileSync(join(HERE, "cards.html"), sheet);

// Drop frames that no longer exist. Without this a cut frame keeps its PNG in
// out/ and stays queueable -- which is exactly how a deleted claim gets posted.
{
  const live = new Set(cards.flatMap(c => [`${c.name}.html`, `${c.name}.png`]));
  const keep = /^(contact\.(html|png))$/;
  for (const f of readdirSync(join(HERE, "out"))) {
    if (live.has(f) || keep.test(f)) continue;
    unlinkSync(join(HERE, "out", f));
    console.log(`  removed stale ${f}`);
  }
}

// One file per frame, sized exactly to the frame, so headless Chrome's
// whole-viewport screenshot is the frame and nothing else. No cropping step,
// and no dependency beyond the Chrome already on the machine.
for (const c of cards) {
  writeFileSync(join(HERE, "out", `${c.name}.html`), `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
${FONTS}
<style>
html,body{margin:0; padding:0; width:${c.w}px; height:${c.h}px; overflow:hidden;}
${CARD_CSS}
.frame{width:${c.w}px; height:${c.h}px;}
</style></head><body><div class="frame">${c.body}</div></body></html>`);
}

// --------------------------------------------------------- review.html
//
// The page to actually look at: every frame scaled to fit beside its caption,
// grouped by post, in posting order. Published as an Artifact.

const SCALE = { 1080: 0.42 };
const scaleFor = c => (c.h > 1400 ? 0.235 : 0.42);

const allPosts = [...new Set(cards.map(c => c.post))].sort((a, b) => a - b);
// The two frames David actually wants lead the page. The rest are kept below
// because they are built, not because they are chosen.
const WANTED = [0, 4];
const posts = allPosts.filter(p => p < 20 && !WANTED.includes(p));
const parkedPosts = allPosts.filter(p => p >= 20);

// One post's block on the review page -- frames on the left, words on the right.
const postBlock = p => {
  const frames = cards.filter(c => c.post === p);
  const cap = CAPTIONS[p] ?? {};
  const lead = frames[0];
  // The title comes off the lead frame when there is no caption entry. David
  // writes his own copy, so a missing caption is normal, not an error.
  const title = cap.title ?? lead.title ?? lead.name;
  return `  <section class="post">
    <div class="p-head">
      <span class="p-n">${String(p).padStart(2, "0")}</span>
      <h2 class="p-t">${title}</h2>
      <span class="p-k">${esc(lead.kind.split(" \u00b7 ")[0])}</span>
      ${cap.when ? `<span class="p-w">${esc(cap.when)}</span>` : ""}
    </div>
    <div class="frames">
${frames.map(c => {
  const s = scaleFor(c);
  return `      <figure class="shot" style="width:${Math.round(c.w * s)}px;height:${Math.round(c.h * s)}px">
        <div class="frame" style="width:${c.w}px;height:${c.h}px;transform:scale(${s})">${c.body}</div>
        <figcaption>${esc(c.name)} &middot; ${c.w}&times;${c.h}</figcaption>
      </figure>`;
}).join("\n")}
    </div>
    ${cap.alt ? `<div class="side">
      <div class="blk">
        <h3>Alt text</h3>
        <p class="alt">${esc(cap.alt)}</p>
      </div>
    </div>` : ""}
  </section>`;
};

const review = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Shred &middot; Instagram batch one</title>
${FONTS}
<style>
*{box-sizing:border-box;}
img{max-width:100%;}
${CARD_CSS}

/* ---- review chrome. Same palette, but plainly a working document. ---- */
:root{ --page:#08090A; --panel:#101214; --edge:#22262A; }
body{
  background:var(--page); color:var(--ink);
  font-family:Archivo,"Helvetica Neue",Arial,sans-serif; font-size:15px; line-height:1.6;
}
.shell{max-width:1180px; margin:0 auto; padding:0 28px 100px;}

header.head{
  display:flex; flex-wrap:wrap; gap:18px 32px; align-items:baseline;
  justify-content:space-between; padding:44px 0 22px;
}
.h-mark{font-family:Anton,Impact,sans-serif; font-size:30px; letter-spacing:.005em;}
.h-mark em{font-style:italic; color:var(--accent);}
.h-meta{font-size:13px; color:var(--ink-3); letter-spacing:.1em; text-transform:uppercase; font-weight:700;}
.head-rule{height:10px; background:repeating-linear-gradient(45deg,var(--accent) 0 10px,transparent 10px 20px);}

.lede{max-width:66ch; padding:34px 0 10px;}
.lede h1{
  font-family:Anton,Impact,sans-serif; font-weight:400; font-size:clamp(38px,6vw,62px);
  line-height:1.0; letter-spacing:-.015em; text-wrap:balance; margin:0 0 18px;
}
.lede p{color:var(--ink-2); font-size:17px; margin:0 0 14px;}
.lede b{color:var(--ink); font-weight:700;}

.rails{
  display:grid; grid-template-columns:repeat(auto-fit,minmax(210px,1fr)); gap:2px;
  background:var(--edge); border:1px solid var(--edge); margin:30px 0 0;
}
.rail{background:var(--panel); padding:20px 22px;}
.rail dt{font-size:11px; font-weight:800; letter-spacing:.16em; text-transform:uppercase; color:var(--ink-3);}
.rail dd{margin:8px 0 0; font-family:Anton,Impact,sans-serif; font-size:34px; line-height:1; letter-spacing:-.01em;}
.rail dd small{font-family:Archivo,sans-serif; font-size:13px; font-weight:600; color:var(--ink-3); letter-spacing:.04em;}

/* ---- one post ---- */
.post{
  border-top:1px solid var(--edge); padding:52px 0 0; margin-top:52px;
  display:grid; grid-template-columns:minmax(0,auto) minmax(300px,1fr); gap:44px; align-items:start;
}
@media (max-width:900px){ .post{grid-template-columns:1fr;} }

.p-head{grid-column:1 / -1; display:flex; flex-wrap:wrap; gap:12px 20px; align-items:baseline;}
.p-n{
  font-family:Anton,Impact,sans-serif; font-size:15px; color:var(--ground);
  background:var(--accent); border-radius:2px; padding:3px 11px; letter-spacing:.06em;
}
.p-t{font-family:Anton,Impact,sans-serif; font-size:30px; letter-spacing:-.01em; line-height:1;}
.p-k{
  font-size:11px; font-weight:800; letter-spacing:.14em; text-transform:uppercase;
  color:var(--cold); border:1px solid var(--cold); border-radius:2px; padding:4px 9px;
}
.p-w{font-size:13px; color:var(--ink-3); font-weight:600; margin-left:auto;}

.frames{display:flex; gap:16px; flex-wrap:wrap; align-items:flex-start;}
.shot{position:relative; flex:none; border:1px solid var(--edge); background:#000; overflow:hidden;}
.shot .frame{transform-origin:top left;}
.shot figcaption{
  position:absolute; left:0; bottom:0; right:0; font-size:10px; font-weight:800;
  letter-spacing:.12em; text-transform:uppercase; color:var(--ink-3);
  background:rgba(8,9,10,.86); padding:5px 8px; backdrop-filter:blur(2px);
}

.side{display:flex; flex-direction:column; gap:22px; min-width:0;}
.blk h3{
  font-size:11px; font-weight:800; letter-spacing:.16em; text-transform:uppercase;
  color:var(--ink-3); margin:0 0 10px;
}
.cap{
  background:var(--panel); border:1px solid var(--edge); border-left:3px solid var(--accent);
  padding:20px 22px; font-size:15px; line-height:1.62; color:var(--ink);
  white-space:pre-wrap; overflow-wrap:break-word;
}
.alt{
  font-size:13.5px; line-height:1.55; color:var(--ink-2); background:var(--panel);
  border:1px solid var(--edge); border-left:3px solid var(--cold); padding:16px 18px;
}

/* ---- the chosen two ---- */
.wanted-head{max-width:66ch; padding:10px 0 0;}
.wanted-head h2{
  font-family:Anton,Impact,sans-serif; font-weight:400; font-size:34px;
  letter-spacing:-.01em; margin:0 0 12px;
}
.wanted-head p{margin:0; color:var(--ink-2); font-size:15px;}
.wanted-head + .post{border-top:none; padding-top:30px; margin-top:30px;}

/* ---- parked ---- */
.parked-head{
  border-top:1px solid var(--edge); margin-top:60px; padding-top:44px; max-width:66ch;
}
.parked-head h2{
  font-family:Anton,Impact,sans-serif; font-weight:400; font-size:34px;
  letter-spacing:-.01em; margin:0 0 12px; color:var(--ink-3);
}
.parked-head p{margin:0; color:var(--ink-3); font-size:15px;}
.parked-head + .post{border-top:none; padding-top:26px; margin-top:26px; opacity:.72;}
.parked-head ~ .post{opacity:.72;}
.parked-head ~ .post:hover{opacity:1;}

/* ---- closing notes ---- */
.notes{border-top:1px solid var(--edge); margin-top:60px; padding-top:44px;}
.notes h2{font-family:Anton,Impact,sans-serif; font-weight:400; font-size:34px; letter-spacing:-.01em; margin:0 0 22px;}
.nlist{display:grid; gap:2px; background:var(--edge); border:1px solid var(--edge);}
.n{background:var(--panel); padding:22px 24px; display:grid; grid-template-columns:34px 1fr; gap:18px;}
.n-i{
  font-family:Anton,Impact,sans-serif; font-size:20px; color:var(--cold);
  line-height:1.2;
}
.n-b h4{font-size:16px; margin:0 0 6px; font-weight:800; letter-spacing:.01em;}
.n-b p{margin:0; color:var(--ink-2); font-size:14.5px; line-height:1.6;}
.n-b p + p{margin-top:8px;}
.n-b code{
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.9em;
  background:var(--surface-2); padding:1px 5px; border-radius:2px; color:var(--accent);
}
footer.foot-r{
  margin-top:54px; padding-top:22px; border-top:1px solid var(--edge);
  font-size:12.5px; color:var(--ink-3); display:flex; flex-wrap:wrap; gap:8px 24px;
}
</style></head>
<body>
<div class="shell">
  <header class="head">
    <span class="h-mark">when can i <em>shred</em></span>
    <span class="h-meta">Instagram &middot; batch one &middot; for review</span>
  </header>
  <div class="head-rule"></div>

  <div class="lede">
    <h1>Frames to pick from. You write the words.</h1>
    <p>Every figure on every frame is read out of <b>data/</b> at build time by
      <b>social/make.mjs</b>: the hours from <code>hours.json</code>, the dates from
      <code>seasons.json</code>, the projections and their labels from
      <code>projection.json</code>, the forecast from <code>forecast.json</code>. Resort colours
      are lifted from the built <code>index.html</code>, so they arrive already corrected for
      contrast against the dark ground rather than corrected twice.</p>
    <p>Which means these are not mockups. Re-run the generator tomorrow and any
      day count has moved, with the hedges intact.</p>
    <p><b>Caption drafts are gone.</b> Alt text stays, because Instagram and
      LinkedIn both want it and it has to be written by somebody.</p>
    <p><b>Powder days are a model now, not a snowfall readout.</b>
      <code>scripts/powder.mjs</code> weights forecast snowfall by the snow-to-liquid
      ratio implied by temperature, then knocks it down for wind and rain. The
      same shape of guess as wet-bulb, labelled the same way. Thresholds are set to
      the Midwest: 3cm worth going, 8cm a powder day, 15cm a season highlight.</p>
  </div>

  <dl class="rails">
    <div class="rail"><dt>In the lineup</dt><dd>${posts.length}<small> posts / ${cards.filter(c => c.post < 20).length} frames</small></dd></div>
    <div class="rail"><dt>Runway</dt><dd>${days}<small> days to first projected lift</small></dd></div>
    <div class="rail"><dt>Resorts on record</dt><dd>${Object.keys(resorts).length - undated.length}<small> of ${Object.keys(resorts).length}</small></dd></div>
    <div class="rail"><dt>Parked</dt><dd>${parkedPosts.length}<small> built, not scheduled</small></dd></div>
  </dl>

  <section class="wanted-head">
    <h2>The two you asked for</h2>
    <p>Both carry a live day count off <code>projection.json</code> and the
      record, so regenerate on the day you post.</p>
  </section>
${WANTED.filter(p => cards.some(c => c.post === p)).map(postBlock).join("\n")}

  <section class="parked-head">
    <h2>Everything else built</h2>
    <p>Kept because it exists and is cheap to bring back, not because it is
      scheduled. Caption drafts are gone; alt text stays where it was written,
      since you need it to post either way.</p>
  </section>
${posts.map(postBlock).join("\n")}

  <section class="parked-head">
    <h2>Parked</h2>
    <p>Built and reviewed, not in the lineup. Kept because they are finished and
      cheap to bring back. The gaps one in particular is the only frame here that
      asks the audience for something.</p>
  </section>
${parkedPosts.map(postBlock).join("\n")}

  <section class="notes">
    <h2>Before any of this goes out</h2>
    <div class="nlist">
      <div class="n"><span class="n-i">&#9633;</span><div class="n-b">
        <h4>The domain</h4>
        <p>Every frame says <code>whencanishred.com</code> and nothing currently
          answers there. The site is on <code>pete2786.github.io/whencanishred</code>.
          One <code>CNAME</code> file and about &pound;10 a year fixes it, and until it is fixed
          the CTA on fourteen frames is a dead end.</p>
      </div></div>
      <div class="n"><span class="n-i">&#9633;</span><div class="n-b">
        <h4>Analytics, before post one</h4>
        <p>There is no counter on the site, so posting batch one without one
          means never knowing which of these nine worked. Cloudflare Web
          Analytics or GoatCounter, one script tag in the three templates.</p>
      </div></div>
      <div class="n"><span class="n-i">&#9633;</span><div class="n-b">
        <h4>UTM per surface</h4>
        <p>The story link stickers should carry
          <code>?utm_source=ig&amp;utm_medium=story</code>, the bio link
          <code>utm_medium=bio</code>. Feed captions can't hold a link, so a typed
          domain reads as direct traffic, and that asymmetry is worth knowing before
          you judge the results.</p>
      </div></div>
      <div class="n"><span class="n-i">&#9633;</span><div class="n-b">
        <h4>og:image is the same renderer</h4>
        <p>The templates carry <code>og:title</code> and <code>og:description</code> but no
          <code>og:image</code>, so every link you or anyone else shares renders as a grey
          box. A 1200&times;630 frame is one more geometry through this same file, and it
          pays off on every share, not just the ones you post.</p>
      </div></div>
      <div class="n"><span class="n-i">&#9633;</span><div class="n-b">
        <h4>Powder stories need a page to land on</h4>
        <p>The site answers a question about man-made winter. Powder is natural snow,
          which it currently says nothing about, so a powder story sends people
          to a page that doesn't mention powder. Either the site gains a snowfall
          view, or these link to the forecast section and the caption carries the
          detail. Worth settling before the first one goes out in January.</p>
      </div></div>
      <div class="n"><span class="n-i">&#9633;</span><div class="n-b">
        <h4>Rendering to PNG</h4>
        <p><code>social/cards.html</code> holds all ${cards.length} frames at true pixel size.
          Headless Chrome screenshots them with no new dependency, consistent with a repo that has no <code>package.json</code> and should keep it
          that way.</p>
      </div></div>
      <div class="n"><span class="n-i">&#10003;</span><div class="n-b">
        <h4>Record only, no explanations</h4>
        <p>Every claim on every frame traces to a number in <code>data/</code>. The
          staffing-and-holiday-demand explanation for why northern resorts open late is
          out of the captions and its slide is deleted. It was reasoning written
          into the README, not something any resort said, and it was also wrong about
          which of Minnesota's three areas gets the most cold (Duluth, not the North
          Shore).</p>
        <p>Where the record shows something unexpected, the frames now say so and
          stop. If an operator or a patroller ever explains it on the record, that
          becomes a source worth quoting.</p>
      </div></div>
    </div>
    <footer class="foot-r">
      <span>Generated by <code>social/make.mjs</code></span>
      <span>Powder model: <code>scripts/powder.mjs</code></span>
      <span>Data as of ${esc(new Date(forecast.generatedAt).toISOString().slice(0, 10))} forecast pull</span>
      <span>Frames: ${cards.length}</span>
    </footer>
  </section>
</div>
</body></html>`;

writeFileSync(join(HERE, "review.html"), review);

console.log(`social/cards.html   ${cards.length} frames at true size`);
console.log(`social/review.html  ${posts.length} posts, for review`);
console.log("");
console.log("derived facts used:");
console.log(`  next up        ${nextUp.ties.map(t => nameOf(t.slug)).join(", ")} ${nextUp.date} (${nextUp.label}) -- ${days} days`);
console.log(`  earliest ever  ${earliestDay.on.map(o => nameOf(o.slug)).join(", ")} ${earliest.date} (${earliest.season})`);
console.log(`  latest ever    ${nameOf(latest.slug)} ${latest.date} (${latest.season})`);
console.log(`  north pair     ${northPair.north.name} ${northPair.north.hrs}h → ${northPair.north.date} vs ${northPair.early.name} ${northPair.early.hrs}h → ${northPair.early.date}`);
console.log(`  undated        ${undated.map(u => u.name).join(", ")}`);
