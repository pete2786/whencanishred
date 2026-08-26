// Renders index.html and one page per resort from the data files. Plain string
// substitution, no dependencies. Output is committed; GitHub Pages serves the
// repo root.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const read = f => JSON.parse(readFileSync(f, "utf8"));
const resorts = read("data/resorts.json");
const seasons = read("data/seasons.json");
const projection = read("data/projection.json");
const hoursRows = read("data/hours.json");
// Optional: the site builds without it, and says the forecast is missing
// rather than printing numbers it does not have.
const fc = existsSync("data/forecast.json") ? read("data/forecast.json") : null;
const seasonNotes = existsSync("data/season-notes.json") ? read("data/season-notes.json") : {};

// data/hours.json keys hills by display name, and one of them is shorter than
// the name in the resort record.
const HOURS_ALIASES = { "lutsen": "lutsen-mountains" };

function slugify(name) {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return HOURS_ALIASES[s] ?? s;
}

// ------------------------------------------------------------ brand colours
//
// Every one of the sixteen brand colours fails 4.5:1 body-text contrast on at
// least one of the two themes — Wild Mountain's chartreuse is invisible on
// white, Lutsen's navy is invisible on black. The page uses --accent for text,
// so dropping a brand colour straight in breaks readability on one theme or
// the other, every time. Instead, keep the hue and saturation and move only
// the lightness until the colour clears the threshold against that theme's
// worst-case background. It still reads as their colour; it also stays legible.

const hex2rgb = h => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgb2hex = ([r, g, b]) =>
  "#" + [r, g, b].map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("");

const luminance = hex => {
  const c = hex2rgb(hex).map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

function rgb2hsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  const l = (mx + mn) / 2;
  if (!d) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hsl2rgb([h, s, l]) {
  if (!s) { const v = l * 255; return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => {
    t = (t + 360) % 360 / 360;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 120) * 255, f(h) * 255, f(h - 120) * 255];
}

// Walk lightness toward the readable end in small steps. Pure black and pure
// white have no hue to preserve, so they get the theme's own ink instead of a
// pointless search that would land on grey.
//
// The accent has to clear the bar against every surface it lands on, not just
// the page: the same colour is chip text on a tinted chip background, which is
// closer to it than the page is. Fixing against the page alone left eleven of
// the sixteen chips under 4.5:1, so all backgrounds are checked together.
function readable(hex, bgs, target, fallback) {
  const list = [].concat(bgs);
  const [h, s, l0] = rgb2hsl(hex2rgb(hex));
  if (s < 0.05) return fallback;
  const darken = luminance(list[0]) > 0.35;
  for (let i = 0; i <= 100; i++) {
    const l = darken ? l0 - i / 100 : l0 + i / 100;
    if (l < 0 || l > 1) break;
    const candidate = rgb2hex(hsl2rgb([h, s, l]));
    if (list.every(bg => contrast(candidate, bg) >= target)) return candidate;
  }
  return fallback;
}

// The chip background: the same hue, pushed to the far end of the lightness
// range so accent-coloured text sits on it comfortably.
const soft = (hex, dark) => {
  const [h, s] = rgb2hsl(hex2rgb(hex));
  if (s < 0.05) return dark ? "#242c38" : "#e8eaee";
  return rgb2hex(hsl2rgb([h, Math.min(s, dark ? 0.30 : 0.55), dark ? 0.16 : 0.90]));
};

// Worst case per theme: the lightest surface a light page paints text on, and
// the lightest surface the dark page does.
const LIGHT_BG = "#ffffff", DARK_BG = "#1b2431";
const LIGHT_INK = "#8a5108", DARK_INK = "#f2a65a";
const LIGHT_GROUND = "#edf1f5", DARK_GROUND = "#0b1017";

// The brand stripe shows the colours raw, which fails when a brand colour is
// the page background: Wild Mountain's black half vanishes on the dark theme
// and Elm Creek's white half vanishes on the light one, and a two-colour bar
// that renders as one colour reads as a bug. Nudge only far enough to be
// visible — this is separation, not legibility, so the bar is 1.5:1 not 4.5:1.
// Unlike the text colours this must also work for pure black and pure white,
// which have no hue and so walk the grey ramp.
function stripe(hex, bg, min = 1.5) {
  if (contrast(hex, bg) >= min) return hex;
  const [h, s, l0] = rgb2hsl(hex2rgb(hex));
  const lighten = luminance(bg) < 0.2;
  for (let i = 1; i <= 100; i++) {
    const l = lighten ? l0 + i / 100 : l0 - i / 100;
    if (l < 0 || l > 1) break;
    const candidate = rgb2hex(hsl2rgb([h, s, l]));
    if (contrast(candidate, bg) >= min) return candidate;
  }
  return hex;
}

function brandCss(r) {
  const p = r.colors.primary, s = r.colors.secondary;
  const softLight = soft(p, false), softDark = soft(p, true);
  const light = readable(p, [LIGHT_BG, softLight], 4.5, LIGHT_INK);
  const dark = readable(p, [DARK_BG, softDark], 4.5, DARK_INK);
  // The wordmark's second colour is large display type, so 3:1 is the bar.
  const light2 = readable(s, [LIGHT_BG], 3, "#46596e");
  const dark2 = readable(s, [DARK_BG], 3, "#a6b6c8");
  const darkVars =
    `--accent:${dark}; --accent-soft:${softDark}; --brand-ink:${dark}; --brand-ink-2:${dark2}; ` +
    `--brand-raw-1:${stripe(p, DARK_GROUND)}; --brand-raw-2:${stripe(s, DARK_GROUND)};`;
  return `<style>
  :root { --accent:${light}; --accent-soft:${softLight};
          --brand-ink:${light}; --brand-ink-2:${light2};
          --brand-raw-1:${stripe(p, LIGHT_GROUND)}; --brand-raw-2:${stripe(s, LIGHT_GROUND)}; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${darkVars} } }
  :root[data-theme="dark"] { ${darkVars} }
</style>`;
}

// The name, set in the hill's own two colours. A single-word name has no
// second half to colour, so it takes the primary and leans on the rule beneath.
function wordmark(name) {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return `<span class="bm-1">${esc(name)}</span>`;
  const head = parts.slice(0, -1).join(" "), tail = parts.at(-1);
  return `<span class="bm-1">${esc(head)}</span> <span class="bm-2">${esc(tail)}</span>`;
}

const hours = Object.fromEntries(hoursRows.map(h => [slugify(h.hill), h]));

// Statewide context for a season, shown under the table it explains. A hill
// opening late says nothing on its own; "the winter never came" does.
function seasonNotesFor(slug) {
  const rows = Object.keys(seasons[slug] ?? {})
    .filter(s => seasonNotes[s])
    .map(s => `        <p class="snote"><b>${esc(s)}</b>${esc(seasonNotes[s])}</p>`);
  return rows.length ? `\n      <div class="snotes">\n${rows.join("\n")}\n      </div>` : "";
}

// --------------------------------------------------------------- forecast
//
// Three hills stand for the three climates the state's hills sit in. The
// metro is the warm case, the North Shore the cold one, and Duluth between.
const REGIONS = [
  { slug: "hyland-hills", label: "Metro", note: "Bloomington" },
  { slug: "spirit-mountain", label: "Duluth", note: "Spirit Mountain" },
  { slug: "lutsen-mountains", label: "North Shore", note: "Lutsen" },
];

const F = n => `${n.toFixed(1)}&deg;`;
const whenWindow = iso => {
  const d = new Date(`${iso}:00`);
  const hour = d.getHours();
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${DAYS[d.getDay()]} ${h12}${hour < 12 ? "am" : "pm"}`;
};
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function forecastSection() {
  if (!fc) {
    return { NOTE: "No forecast on file. Run <code>node scripts/forecast.mjs</code>.",
             HEADLINE: "&mdash;", CARDS: "" };
  }
  const made = new Date(fc.generatedAt);
  const ageDays = Math.floor((new Date() - made) / 86400000);
  const madeStr = `${made.getDate()} ${FULL[made.getMonth()]}`;
  // A forecast is only a forecast while it is about the future. Past a couple
  // of days it is a stale guess, and the page should say so rather than let
  // the reader assume it is current.
  const stale = ageDays >= 2 ? ` <b>${ageDays} days old &mdash; rerun the forecast.</b>` : "";

  const known = Object.entries(fc.hills).filter(([, h]) => h.min !== null);
  const withWindow = known.filter(([, h]) => h.hoursUnder > 0);

  let headline;
  if (!known.length) {
    headline = "The forecast could not be read for any hill.";
  } else if (!withWindow.length) {
    const [slug, h] = known.reduce((a, b) => (b[1].min < a[1].min ? b : a));
    headline = `No snowmaking weather in the next ${fc.horizonDays} days. ` +
      `Coldest is <b>${esc(resorts[slug].name)}</b> at ${F(h.min)}.`;
  } else {
    const first = withWindow.reduce((a, b) => (a[1].firstWindow <= b[1].firstWindow ? a : b));
    headline = `${withWindow.length} of ${known.length} hills get snowmaking weather. ` +
      `<b>${esc(resorts[first[0]].name)}</b> first, ${whenWindow(first[1].firstWindow)}.`;
  }

  const cards = REGIONS.map(({ slug, label, note }) => {
    const h = fc.hills[slug];
    if (!h || h.min === null) {
      return `      <div class="card"><h3>${label}</h3><p class="big">&mdash;</p>
        <p>Forecast unavailable for ${esc(note)}.</p></div>`;
    }
    return `      <div class="card">
        <h3>${label}</h3>
        <p class="big">${F(h.min)}</p>
        <p>Coldest wet bulb the ${fc.horizonDays}-day forecast reaches at ${esc(note)}.</p>
        <dl>
          <dt>Hours under ${fc.threshold}&deg;</dt><dd>${h.hoursUnder}</dd>
          <dt>First window</dt><dd>${h.firstWindow ? whenWindow(h.firstWindow) : "&mdash;"}</dd>
          <dt>Normal Oct&ndash;Nov hours</dt><dd>${hours[slug]?.normal ?? "&mdash;"}</dd>
        </dl>
      </div>`;
  }).join("\n");

  return {
    // No heading sits above this any more, so the note carries what the
    // numbers are, where they come from, and when they were made.
    NOTE: `${fc.horizonDays}-day wet-bulb forecast from ` +
      `<a href="https://open-meteo.com/">Open-Meteo</a>, made ${madeStr}. ` +
      `Guns can run under ${fc.threshold}&deg;.${stale}`,
    HEADLINE: headline,
    CARDS: cards,
  };
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const FULL = ["January","February","March","April","May","June","July","August",
              "September","October","November","December"];
const pretty = iso => iso ? `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}` : "&mdash;";

// Compare opening dates across seasons by their position in the snow year, so
// a January opening sorts after a November one rather than before it.
const snowDay = iso => {
  const m = Number(iso.slice(5, 7)), d = Number(iso.slice(8, 10));
  return (m >= 9 ? m - 9 : m + 3) * 31 + d;
};

// The typical opening is the median of the seasons we actually observed. With
// fewer than two, there is no habit to report and we say so.
function observed(slug) {
  const dates = Object.values(seasons[slug] ?? {})
    .map(s => s.firstLift?.date).filter(Boolean)
    .sort((a, b) => snowDay(a) - snowDay(b));
  if (dates.length < 2) return { typical: null, earliest: null, latest: null, n: dates.length };
  return {
    typical: dates[Math.floor((dates.length - 1) / 2)],
    earliest: dates[0], latest: dates.at(-1), n: dates.length,
  };
}

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const daysUntil = iso => Math.round((new Date(`${iso}T00:00:00`) - new Date()) / 86400000);

// ------------------------------------------------------------------- hero
//
// A single "75 days, probably" hid how wide the spread actually is: Wild
// Mountain has opened as early as 18 October and as late as 20 November, five
// weeks apart. Three numbers say that honestly. Each one is a season that
// actually happened, not a percentile invented from five samples.

// Openings land either side of New Year, so a season's dates belong to the
// year the season started in, not the year on the calendar.
const seasonStartYear = () => {
  const n = new Date();
  return n.getMonth() >= 6 ? n.getFullYear() : n.getFullYear() - 1;
};
const thisSeason = iso => `${seasonStartYear() + (Number(iso.slice(5, 7)) >= 7 ? 0 : 1)}-${iso.slice(5)}`;

function scenarios(slug) {
  const seen = Object.entries(seasons[slug] ?? {})
    .map(([season, s]) => ({ season, date: s.firstLift?.date }))
    .filter(e => e.date)
    .sort((a, b) => snowDay(a.date) - snowDay(b.date));
  if (seen.length < 2) return null;
  return [
    { ...seen[0], key: "early", lede: "earliest on record" },
    { ...seen[Math.floor((seen.length - 1) / 2)], key: "real", lede: `median of ${seen.length} seasons` },
    { ...seen.at(-1), key: "late", lede: "latest on record" },
  ];
}

// Past the date the countdown is meaningless, and a build in December must not
// print "-30 days". The scenario says it has come and gone instead.
function countdown(days) {
  if (days > 0) return `${days}<span class="scen-unit">days</span>`;
  if (days === 0) return `<span class="scen-word">today</span>`;
  return `<span class="scen-word">passed</span>`;
}

function heroScenarios(slug) {
  const rows = scenarios(slug);
  // One observed season is not a spread. Fall back to the model date alone.
  if (!rows) {
    return `<div class="count">
      <span class="count-num">${daysUntil(projection[slug].date)}</span>
      <span class="count-unit">days, probably</span>
    </div>`;
  }
  const cells = rows.map(r => {
    const iso = thisSeason(r.date);
    return `      <div class="scen scen-${r.key}">
        <span class="scen-num">${countdown(daysUntil(iso))}</span>
        <span class="scen-date">${pretty(iso)}</span>
        <span class="scen-lede">${r.lede}<span class="scen-yr">${esc(r.season)}</span></span>
      </div>`;
  });
  return `<div class="scens">\n${cells.join("\n")}\n    </div>`;
}

const GROUPS = [["twin-cities", "Twin Cities"], ["greater-minnesota", "Greater Minnesota"]];

function tableRows() {
  const out = [];
  for (const [region, title] of GROUPS) {
    out.push(`          <tr class="grp"><td colspan="6">${title}</td></tr>`);
    const slugs = Object.keys(resorts)
      .filter(s => resorts[s].region === region)
      .sort((a, b) => projection[a].date.localeCompare(projection[b].date));

    for (const [i, slug] of slugs.entries()) {
      const r = resorts[slug], p = projection[slug], h = hours[slug], o = observed(slug);
      const cls = region === GROUPS[0][0] && i === 0 ? ' class="first"' : "";
      const typical = o.typical
        ? `${pretty(o.typical)}<span class="rng">${pretty(o.earliest)} &ndash; ${pretty(o.latest)}</span>`
        : `&mdash;<span class="rng">${o.n === 1 ? "one season only" : "no record yet"}</span>`;
      const hrs = h
        ? `${h.normal}<span class="rng">${h.lean}&ndash;${h.fat}</span>`
        : `&mdash;`;

      out.push(
        `          <tr${cls}>`,
        `            <td class="hill"><a href="resorts/${slug}.html">${esc(r.name)}</a></td>`,
        `            <td class="where">${esc(r.place)}</td>`,
        `            <td>${pretty(p.date)}<span class="rng">${p.label}</span></td>`,
        `            <td class="num days">${daysUntil(p.date)}</td>`,
        `            <td class="num">${hrs}</td>`,
        `            <td>${typical}</td>`,
        `          </tr>`,
      );
    }
  }
  return out.join("\n");
}

function seasonRows(slug) {
  return Object.entries(seasons[slug] ?? {}).map(([season, ev]) => {
    const cell = e => {
      if (!e?.date) return "&mdash;";
      const tag = e.precision === "bracket" ? "about" : e.corroboration;
      return `${pretty(e.date)}<span class="rng">${tag}</span>`;
    };
    const kinds = [...new Set(ev.firstLift?.sources?.map(s => s.kind) ?? [])];
    return `          <tr><td>${season}</td><td>${cell(ev.firstLift)}</td>` +
           `<td>${cell(ev.fullOps)}</td><td>${cell(ev.close)}</td>` +
           `<td class="where">${esc(kinds.join(", ") || "none")}</td></tr>`;
  }).join("\n");
}

function socialLinks(r) {
  const links = [];
  if (r.social?.facebook) links.push(`<a href="https://facebook.com/${r.social.facebook}" target="_blank" rel="noopener">Facebook</a>`);
  if (r.social?.instagram) links.push(`<a href="https://instagram.com/${r.social.instagram}" target="_blank" rel="noopener">Instagram</a>`);
  return links.length ? " &middot; " + links.join(" &middot; ") : "";
}

const tally = () => {
  const all = Object.values(seasons).flatMap(s => Object.values(s)).map(e => e.firstLift);
  const withDate = all.filter(e => e.date);
  const confirmed = withDate.filter(e => e.corroboration === "confirmed").length;
  const hills = Object.values(seasons).filter(s => Object.values(s).some(e => e.firstLift?.date)).length;
  return { n: withDate.length, confirmed, total: all.length, hills, allHills: Object.keys(seasons).length };
};

const t = tally();
// Only name sources that actually contributed, and work it out from the record
// rather than describing it by hand. This line has already been wrong once: it
// credited "the resorts' own announcements" before any such pass had run, and
// then went stale the other way once hand-sourced dates started arriving.
// "announced" is not a source of its own — those are opening notices found on
// the archived pages — so it folds into the archive phrase rather than being
// listed beside it.
const kinds = new Set(
  Object.values(seasons)
    .flatMap(s => Object.values(s))
    .flatMap(e => [e.firstLift, e.fullOps, e.close])
    .filter(x => x?.date)
    .flatMap(x => (x.sources ?? []).map(s => s.kind))
);
const archivePhrase = kinds.has("announced")
  ? "archived resort pages and the opening announcements on them"
  : "archived resort pages";
const parts = [];
if (kinds.has("wayback") || kinds.has("announced")) parts.push(archivePhrase);
if (kinds.has("social")) parts.push("the hills' own social posts");
if (kinds.has("local")) parts.push("hand-recorded posts, news and local knowledge");
const sourcePhrase = parts.length > 1
  ? `${parts[0]}, plus ${parts.slice(1).join(" and ")}`
  : parts[0] ?? "no sources yet";

const provenance =
  `${t.n} of ${t.total} opening dates sourced from ${sourcePhrase}, ${t.confirmed} ` +
  `corroborated by a second independent source. Blanks are gaps, not guesses.`;

// The banner states the coverage rather than describing the intent, and it
// counts the record every build. A hand-written claim about how well the
// backfill went is a claim that goes stale the moment the backfill changes.
const notice =
  `<strong>Part real.</strong> Wet-bulb curve, snowmaking hours and first-window dates are computed ` +
  `from 31 years of ERA5 data. Real opening dates are mostly still missing: ` +
  `${t.hills} of ${t.allHills} hills ${t.hills === 1 ? "has" : "have"} a sourced record, and the ` +
  `rest fall back to a model. The projected column has not been recalibrated yet.`;

const now = new Date();
const dateline = `${now.getDate()} ${FULL[now.getMonth()]} ${now.getFullYear()}`;

const fcSection = forecastSection();

const fill = (tpl, map) =>
  Object.entries(map).reduce((s, [k, v]) => s.replaceAll(`<!--{{${k}}}-->`, v), tpl);

// Homepage
const leader = Object.keys(projection).sort((a, b) => projection[a].date.localeCompare(projection[b].date))[0];
const lead = observed(leader);

writeFileSync("index.html", fill(readFileSync("templates/index.html", "utf8"), {
  TABLE: tableRows(),
  NOTICE: notice,
  DATELINE: dateline,
  FORECAST_NOTE: fcSection.NOTE,
  FORECAST_HEADLINE: fcSection.HEADLINE,
  FORECAST_CARDS: fcSection.CARDS,
  HERO_SCENARIOS: heroScenarios(leader),
  HERO_LEADER: esc(resorts[leader].name),
  HERO_SEASONS: String(lead.n),
  HERO_HILLS: String(Object.keys(resorts).length),
  HERO_HOURS: String(hours[leader]?.normal ?? "—"),
  FOOTER_PROVENANCE: provenance,
}));

// Resort pages
mkdirSync("resorts", { recursive: true });
const resortTpl = readFileSync("templates/resort.html", "utf8");
for (const [slug, r] of Object.entries(resorts)) {
  const o = observed(slug);
  writeFileSync(`resorts/${slug}.html`, fill(resortTpl, {
    NAME: esc(r.name), PLACE: esc(`${r.place}, ${r.state}`), WEBSITE: esc(r.website),
    NAME_MARK: wordmark(r.name),
    BRAND_CSS: brandCss(r),
    SOCIAL_LINKS: socialLinks(r),
    TYPICAL: pretty(o.typical), EARLIEST: pretty(o.earliest), LATEST: pretty(o.latest),
    HOURS: String(hours[slug]?.normal ?? "—"),
    SEASONS: seasonRows(slug),
    SEASON_NOTES: seasonNotesFor(slug),
    FOOTER_PROVENANCE: provenance,
  }));
}

console.error(`built index.html and ${Object.keys(resorts).length} resort pages`);
