// Renders index.html and one page per resort from the data files. Plain string
// substitution, no dependencies. Output is committed; GitHub Pages serves the
// repo root.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { daysUntil } from "./lib/days.mjs";

const read = f => JSON.parse(readFileSync(f, "utf8"));

// The site commits to one colour scheme rather than following the system: a
// topsheet printed on white is a different product. Generated colours ship for
// this scheme only, with no prefers-color-scheme branch.
const SCHEME = "dark";
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
// The surfaces text actually lands on. DARK_* are the shipped palette's
// --surface-2 and --ground; correcting against anything else measures a
// background that is not there.
const LIGHT_BG = "#ffffff", DARK_BG = "#1d2023";
const LIGHT_INK = "#8a5108", DARK_INK = "#f2a65a";
const LIGHT_GROUND = "#edf1f5", DARK_GROUND = "#0b0c0d";

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
  // The page commits to one scheme, so the hill ships one set of colours. Left
  // branching on prefers-color-scheme, a visitor whose system is in light mode
  // got the light-corrected brand colour — corrected against a white page —
  // painted onto the near-black one.
  if (SCHEME === "dark") return `<style>\n  :root { ${darkVars} }\n</style>`;
  const lightVars =
    `--accent:${light}; --accent-soft:${softLight}; --brand-ink:${light}; --brand-ink-2:${light2}; ` +
    `--brand-raw-1:${stripe(p, LIGHT_GROUND)}; --brand-raw-2:${stripe(s, LIGHT_GROUND)};`;
  if (SCHEME === "light") return `<style>\n  :root { ${lightVars} }\n</style>`;
  return `<style>
  :root { ${lightVars} }
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

// --------------------------------------------- hills named in the prose
//
// A hill mentioned in a sentence wears its own colour, the same colour its row
// carries in the table and its name carries on its own page. The site keeps no
// accent of its own in that position, so nothing borrows one hill's identity
// for the whole page.
//
// Marking happens on the rendered HTML rather than in the templates so that any
// copy written later is covered without remembering to tag it. Only an exact
// <b> whose whole text is a hill's name matches; the other <b> on these pages
// hold numbers and a chart legend.
const HILL_BY_NAME = new Map(Object.entries(resorts).map(([slug, r]) => [r.name, slug]));

const markHills = html => html.replace(/<b>([^<]+)<\/b>/g, (m, text) =>
  HILL_BY_NAME.has(text.trim())
    ? `<b class="hm" data-hill="${HILL_BY_NAME.get(text.trim())}">${text}</b>`
    : m);

function hillInkCss() {
  const rule = (slug, c, prefix = "") => `${prefix}.hm[data-hill="${slug}"]{color:${c}}`;
  const light = [], dark = [];
  for (const [slug, r] of Object.entries(resorts)) {
    const p = r.colors?.primary;
    if (!p) continue;
    light.push(rule(slug, readable(p, [LIGHT_BG, LIGHT_GROUND], 4.5, LIGHT_INK)));
    dark.push(rule(slug, readable(p, [DARK_BG, DARK_GROUND], 4.5, DARK_INK)));
  }
  const body =
    SCHEME === "dark"  ? dark.join("\n") :
    SCHEME === "light" ? light.join("\n") :
    [
      light.join("\n"),
      `@media (prefers-color-scheme:dark){`,
      dark.map(r => "  :root:not([data-theme=\"light\"]) " + r).join("\n"),
      `}`,
      dark.map(r => ':root[data-theme="dark"] ' + r).join("\n"),
    ].join("\n");
  return `<style>\n${body}\n</style>`;
}

const hours = Object.fromEntries(hoursRows.map(h => [slugify(h.hill), h]));

// How one hill operates, as opposed to what one winter did. Standing quirks
// that change how its dates should be read — a terrain park that lags the
// opening, a weekend-only schedule — belong to the hill, not to a season.
function hillNotesFor(slug) {
  return (resorts[slug].notes ?? [])
    .map(n => `        <p class="snote"><b>This resort</b>${esc(n)}</p>`);
}

// Statewide context for a season, shown under the table it explains. A hill
// opening late says nothing on its own; "the winter never came" does.
function seasonNotesFor(slug) {
  const rows = [
    ...hillNotesFor(slug),
    ...Object.keys(seasons[slug] ?? {})
      .filter(s => seasonNotes[s])
      .map(s => `        <p class="snote"><b>${esc(s)}</b>${esc(seasonNotes[s])}</p>`),
  ];
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
    return { TITLE: "The next two weeks", ANSWER: "No forecast on file.",
             NOTE: "Run <code>node scripts/forecast.mjs</code>.", CARDS: "" };
  }
  const made = new Date(fc.generatedAt);
  const ageDays = Math.floor((new Date() - made) / 86400000);
  const madeStr = `${made.getDate()} ${FULL[made.getMonth()]}`;
  // A forecast is only a forecast while it is about the future. Past a couple
  // of days it is a stale guess, and the page should say so rather than let
  // the reader assume it is current.
  const stale = ageDays >= 2 ? ` <b>${ageDays} days old. The refresh has not run.</b>` : "";

  const known = Object.entries(fc.hills).filter(([, h]) => h.min !== null);
  const withWindow = known.filter(([, h]) => h.hoursUnder > 0);

  // The answer, which used to be set as the section's heading. At display size
  // and with no label above it, it read as the page making a pronouncement
  // rather than reporting a forecast, so it moved down into the text and a
  // plain heading took its place.
  let answer;
  if (!known.length) {
    answer = "The forecast did not load for any resort.";
  } else if (!withWindow.length) {
    const [slug, h] = known.reduce((a, b) => (b[1].min < a[1].min ? b : a));
    answer = `No snowmaking weather in the next ${fc.horizonDays} days. ` +
      `The coldest any resort gets is <b>${esc(resorts[slug].name)}</b> at ${F(h.min)}.`;
  } else {
    const first = withWindow.reduce((a, b) => (a[1].firstWindow <= b[1].firstWindow ? a : b));
    answer = `${withWindow.length} of ${known.length} resorts get snowmaking weather. ` +
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
    // Rounded to whole weeks on purpose: a heading reads better in the unit
    // people actually think in, and the exact horizon appears twice directly
    // beneath it, in the answer and again in the note.
    TITLE: `The next ${WORDS[Math.round(fc.horizonDays / 7)] ?? Math.round(fc.horizonDays / 7)} ` +
           `${Math.round(fc.horizonDays / 7) === 1 ? "week" : "weeks"}`,
    ANSWER: answer,
    NOTE: `Wet-bulb forecast from <a href="https://open-meteo.com/">Open-Meteo</a>, ` +
      `updated twice a day and last pulled ${madeStr}. ` +
      `Guns can run under ${fc.threshold}&deg;.${stale}`,
    CARDS: cards,
  };
}

// Small numbers read better as words in prose. Declared up here because both
// the forecast heading and the hero copy want them, and they sit 400 lines apart.
const WORDS = ["", "one", "two", "three", "four", "five", "six"];
const TIMES = ["", "once", "twice", "three times", "four times", "five times"];

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
// Whole calendar days in the resorts' own zone, so the countdown holds still
// through a reader's day and ticks at local midnight. See lib/days.mjs.

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

// The hill's own two colours, split across one dot. Enough to tell sixteen rows
// apart without putting a logo palette into the type, where several of these
// fail contrast. Hills with only a primary get a solid dot.
// How soon the hill opens, as the three marks every skier already reads. The
// cut points are the natural gaps in the projection: six hills before the last
// week of November, six inside it, four in December. Purely presentational —
// themes that do not draw markers ignore the attribute.
const tierOf = iso => {
  const [, m, d] = iso.split("-").map(Number);
  if (m <= 11 && d <= 24) return "green";
  if (m <= 11) return "blue";
  return "black";
};

function pip(r, tier) {
  const a = r.colors?.primary;
  if (!a) return "";
  const b = r.colors?.secondary ?? a;
  const t = tier ? ` data-tier="${tier}"` : "";
  return `<span class="pip"${t} style="--c1:${esc(a)};--c2:${esc(b)}" aria-hidden="true"></span>`;
}

function tableRows() {
  const out = [];
  for (const [region, title] of GROUPS) {
    out.push(`          <tr class="grp"><td colspan="7">${title}</td></tr>`);
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

      // data-label carries the column header into the stacked mobile layout,
      // where the real <thead> is hidden.
      out.push(
        `          <tr${cls}>`,
        `            <td class="hill">${pip(r, tierOf(p.date))}` +
          `<a href="resorts/${slug}.html">${esc(r.name)}</a></td>`,
        `            <td class="where" data-label="Where">${esc(r.place)}</td>`,
        `            <td data-label="Projected">${pretty(p.date)}<span class="rng">${p.label}</span></td>`,
        `            <td class="num days" data-label="Days">${daysUntil(p.date)}</td>`,
        `            <td class="num" data-label="Snowmaking hrs">${hrs}</td>`,
        `            <td data-label="Typical opening">${typical}</td>`,
        `            <td class="go-cell"><a class="btn" href="resorts/${slug}.html"` +
          ` aria-label="See ${esc(r.name)}'s record">See record` +
          `<span class="btn-arrow" aria-hidden="true">&rarr;</span></a></td>`,
        `          </tr>`,
      );
    }
  }
  return out.join("\n");
}

// The season table used to print "single" under every date, "local" in every
// Sources cell and an em dash down the whole Closed column. Five columns, three
// of them the same word repeated. Only say what differs from the default.
function seasonRows(slug) {
  const rows = Object.entries(seasons[slug] ?? {});
  const showClose = rows.some(([, ev]) => ev.close?.date);

  const cell = e => {
    if (!e?.date) return "&mdash;";
    // "single" is the ordinary case and does not need saying; a bracketed date
    // or a second agreeing source does.
    const tag = e.precision === "bracket" ? "about"
              : e.corroboration === "confirmed" ? "confirmed" : null;
    return pretty(e.date) + (tag ? `<span class="rng">${tag}</span>` : "");
  };

  // With a permalink the source is worth following, and worth naming: "local"
  // is the record's word for how the date was gathered, not something a reader
  // wants to click. Name the site instead.
  const host = url => {
    try {
      const h = new URL(url).hostname.replace(/^www\./, "");
      return h === "facebook.com" ? "Facebook"
           : h === "instagram.com" ? "Instagram"
           : h.startsWith("web.archive.org") ? "Archive" : h;
    } catch { return "source"; }
  };
  const source = ev => {
    const src = ev.firstLift?.sources ?? [];
    const linked = src.find(s => s.url);
    if (linked) return `<a href="${esc(linked.url)}" rel="nofollow noopener">${esc(host(linked.url))}</a>`;
    const kinds = [...new Set(src.map(s => s.kind))];
    return esc(kinds.join(", ") || "none");
  };

  return rows.map(([season, ev]) =>
    `          <tr><td class="season">${season}</td>` +
    `<td data-label="First lift">${cell(ev.firstLift)}</td>` +
    `<td data-label="Full operations">${cell(ev.fullOps)}</td>` +
    (showClose ? `<td data-label="Closed">${cell(ev.close)}</td>` : "") +
    `<td class="where" data-label="Source">${source(ev)}</td></tr>`,
  ).join("\n");
}

// The header has to match, so it is built here rather than sat in the template.
function seasonHead(slug) {
  const showClose = Object.values(seasons[slug] ?? {}).some(ev => ev.close?.date);
  return `<tr><th>Season</th><th>First lift</th><th>Full operations</th>` +
         (showClose ? "<th>Closed</th>" : "") + `<th>Source</th></tr>`;
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
  const hills = Object.values(seasons).filter(s => Object.values(s).some(e => e.firstLift?.date)).length;
  return { n: withDate.length, total: all.length, hills, allHills: Object.keys(seasons).length };
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
if (kinds.has("social")) parts.push("the resorts' own social posts");
if (kinds.has("local")) parts.push("hand-recorded posts, news and local knowledge");
const sourcePhrase = parts.length > 1
  ? `${parts[0]}, plus ${parts.slice(1).join(" and ")}`
  : parts[0] ?? "no sources yet";

// States the coverage rather than describing the intent, and counts the record
// every build. A hand-written claim about how well the backfill went is a claim
// that goes stale the moment the backfill changes.
const provenance = `${t.n} of ${t.total} opening dates sourced from ${sourcePhrase}.`;

const now = new Date();
const dateline = `${now.getDate()} ${FULL[now.getMonth()]} ${now.getFullYear()}`;

// The countdown, the forecast age and the projection are all computed at build
// time, so how fresh the page is *is* when it was last built. Say it in the
// hills' own time zone rather than the build machine's, which is UTC in CI.
const CT = "America/Chicago";
const clock = d => new Intl.DateTimeFormat("en-GB", {
  timeZone: CT, hour: "2-digit", minute: "2-digit", hour12: false,
}).format(d);
const zone = d => new Intl.DateTimeFormat("en-US", {
  timeZone: CT, timeZoneName: "short",
}).formatToParts(d).find(p => p.type === "timeZoneName").value;
const onDay = d => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: CT, day: "numeric", month: "long", year: "numeric",
  }).formatToParts(d).map(x => [x.type, x.value]));
  return `${p.day} ${p.month} ${p.year}`;
};

const lastUpdated = (() => {
  const built = `<time datetime="${now.toISOString()}">${onDay(now)}, ` +
                `${clock(now)} ${zone(now)}</time>`;
  if (!fc) return `Rebuilt ${built}. No forecast on file.`;
  const made = new Date(fc.generatedAt);
  return `Rebuilt ${built}. Forecast pulled ` +
         `<time datetime="${made.toISOString()}">${onDay(made)}, ${clock(made)} ${zone(made)}</time>.`;
})();

// The year comes from Central like the rest of the footer, so the notice does
// not roll over on New Year's Eve on a UTC runner.
const copyright = "&copy; " + new Intl.DateTimeFormat("en-CA", {
  timeZone: CT, year: "numeric",
}).format(now) + " DP Labs, LLC";

const fcSection = forecastSection();

// Regions are states, because that is how people group these hills. Minnesota
// is the only one with a record; the rest get a page that says so and asks for
// help. Trollhaugen is a Wisconsin hill and is already tracked, so Wisconsin is
// not empty — it is counted from the record rather than asserted here.
const STATES = [
  { id: "mn",    state: "MN", name: "Minnesota",                    file: "index.html" },
  // Illinois has no page of its own: Chicago drives north, so its hills belong
  // to the same page as the southern Wisconsin ones they share a car park with.
  { id: "wi",    state: "WI", name: "Wisconsin",                    file: "wisconsin.html" },
  { id: "mi-up",              name: "Michigan \u00b7 Upper Peninsula", file: "michigan-up.html" },
  { id: "mi-lp",              name: "Michigan \u00b7 Lower Peninsula", file: "michigan-lp.html" },
  { id: "dak-ia",             name: "Dakotas & Iowa",               file: "dakotas-iowa.html" },
  { id: "oh-in",              name: "Ohio & Indiana",               file: "ohio-indiana.html" },
  // Not a state, and deliberately last: a place to find out whether anyone
  // outside the snowmaking belt wants this at all before building for them.
  {
    id: "other", name: "Everywhere else", file: "elsewhere.html",
    note: "Colorado, East Coast, interested?",
    eyebrow: "Not planned",
    headline: "Everywhere else, if anyone wants it.",
    lead: "This site answers one question: when does it get cold enough to blow snow, and " +
          "how long after that do resorts open? That matters where resorts make their own " +
          "winter. Where it snows for real, the answer is probably just that " +
          "the resort opens when it snows. I do not know whether this is worth having for " +
          "the Rockies, the East or anywhere else.",
    cta: "If you want this for your mountains, say so and say what would make it useful.",
  },
];

const countIn = state =>
  state ? Object.values(resorts).filter(r => r.state === state).length : 0;

// The menu names the areas a page covers rather than how far along it is.
// Somebody opening it wants to know whether their drive is on the list.
const MN_AREAS = "Twin Cities, Duluth, North Shore";
const regionNote = r => {
  if (r.note) return r.note;
  if (r.id === "mn") return MN_AREAS;
  const areas = placesIn(r.id).map(([, p]) => p.label);
  return areas.length ? areas.join(", ") : "";
};

// "root" is "" from the site root and "../" from resorts/.
function picker(current, root) {
  const here = STATES.find(r => r.id === current);
  const items = STATES.map(r =>
    `      <a href="${root}${r.file}"${r.id === current ? ' aria-current="page"' : ""}>${r.name}` +
    `<span>${regionNote(r)}</span></a>`).join("\n");
  return `    <details class="picker">\n` +
         `      <summary>${here.name}</summary>\n` +
         `      <nav class="picker-menu">\n${items}\n      </nav>\n    </details>`;
}

const fill = (tpl, map) =>
  Object.entries(map).reduce((s, [k, v]) => s.replaceAll(`<!--{{${k}}}-->`, v), tpl);

// ------------------------------------------------------------------- chart
//
// Rendered from data/curve.json at two geometries. The wide one is the chart
// as it has always looked. The narrow one fits a phone with no sideways drag,
// and pays for it in height: the three pins land within 35 units of each other
// down there, so their labels need three staggered rows or "Wild Mountain"
// lands on top of "Most metro resorts".
//
// Both come from the same call, so the two cannot drift the way the hand-drawn
// SVG drifted from the numbers printed beside it.

const curve = existsSync("data/curve.json") ? read("data/curve.json") : null;
const places = existsSync("data/places.json") ? read("data/places.json") : {};
// Names only, read off the Midwest Ski Resort Guide. No dates and no
// coordinates, so it cannot drive a projection; it can say which resorts exist.
const known = existsSync("data/known-resorts.json") ? read("data/known-resorts.json") : null;

// The first workable window is an early cold snap, about three weeks ahead of
// the day the mean itself crosses. From scripts/climatology.mjs; no data file
// carries these three yet, so they are stated here rather than in the markup.
const WINDOW = { earliest: "10-09", normal: "10-28", latest: "11-20" };

const AXIS_TO = "01-01";
const dayIndex = md => {
  const [m, d] = md.split("-").map(Number);
  return Math.round((Date.UTC(m < 6 ? 2002 : 2001, m - 1, d) - Date.UTC(2001, 7, 23)) / 86400000);
};
const SPAN = dayIndex(AXIS_TO);
const md2 = md => `${MONTHS[Number(md.slice(0, 2)) - 1]} ${Number(md.slice(3, 5))}`;

// Where the three pins sit is a fact about the hills, not a drawing decision.
// The hand-drawn chart eyeballed them; these follow the projection.
function chartPins() {
  const dates = Object.values(projection).map(p => p.date).sort();
  const first = Object.entries(projection).sort((a, b) => a[1].date.localeCompare(b[1].date))[0];
  const metro = Object.keys(resorts).filter(s => resorts[s].region === "twin-cities")
    .map(s => projection[s].date).sort();
  return [
    { md: first[1].date.slice(5), label: resorts[first[0]].name },
    { md: metro[Math.floor(metro.length / 2)].slice(5), label: "Most metro resorts" },
    { md: dates.at(-1).slice(5), label: "Last resorts open" },
  ];
}

const GEOM = {
  wide: {
    cls: "chart-wide", hBase: 420, w: 900, x0: 60, x1: 860, yTop: 93, yBase: 349,
    rngTitle: 44, rngBar: 62, rngLab: 84, midDrop: 0,
    xLab: 406, pinTip: 364, pinLab: 379, pinStep: 21, pinFont: 12,
    keyDx: 15, keyDy: -14, keyAnchor: "start", coldDy: 19,
    xTicks: ["08-23", "10-01", "11-01", "12-01", "01-01"],
  },
  // Everything the wide chart says, stacked instead of spread. Three things
  // need their own row down here that share one on the wide chart: the middle
  // window label, the crossing note, and each pin caption.
  narrow: {
    cls: "chart-narrow", hBase: 418, w: 300, x0: 32, x1: 292, yTop: 76, yBase: 352,
    rngTitle: 12, rngBar: 28, rngLab: 45, midDrop: 15,
    xLab: 368, pinTip: 390, pinLab: 402, pinStep: 22, pinFont: 11,
    // The pins cluster inside 70 units of each other, so their lines would run
    // straight through the month labels. The line picks up below that row; the
    // dot on the axis is what actually marks the date.
    pinLineFrom: 378,
    // Above-right of the dot is where this sits on the wide chart, and there
    // is no room for it there at 300 units — it would run off the edge, and
    // anchoring it back over the dot lays it on the curve. It goes below the
    // line instead, still ending at the dot: the band left of the crossing is
    // empty by definition, because that is what being left of the crossing
    // means. Sending it to the top of the drawing made it jump on resize.
    keyDx: 0, keyDy: 17, keyAnchor: "end", coldDy: 38,
    xTicks: ["08-23", "10-01", "11-01", "12-01", "01-01"],
  },
};

function chartSvg(g, d) {
  const X = md => g.x0 + (dayIndex(md) / SPAN) * (g.x1 - g.x0);
  const Y = t => g.yTop + ((60 - t) / 60) * (g.yBase - g.yTop);
  const n = (v) => Math.round(v * 10) / 10;
  const o = [];
  const yThresh = Y(28);

  o.push(`<rect class="band" x="${g.x0}" y="${n(yThresh)}" width="${g.x1 - g.x0}" height="${n(g.yBase - yThresh)}"></rect>`);
  for (const t of [60, 45, 30, 15])
    o.push(`<line class="grid-l" x1="${g.x0}" y1="${n(Y(t))}" x2="${g.x1}" y2="${n(Y(t))}"></line>`,
           `<text class="tick-t" x="${g.x0 - 10}" y="${n(Y(t) + 4)}" text-anchor="end">${t}&deg;</text>`);

  // The window: a bar with a dot at the normal date. On a phone the middle
  // label drops a row, because "normally Oct 28" is wider than the gap between
  // the two dates it sits between.
  const xe = X(d.window.earliest), xn = X(d.window.normal), xl = X(d.window.latest);
  o.push(`<text class="lab-rng" x="${n((xe + xl) / 2)}" y="${g.rngTitle}" text-anchor="middle">FIRST WORKABLE WINDOW</text>`,
         `<line class="rangebar" x1="${n(xe)}" y1="${g.rngBar}" x2="${n(xl)}" y2="${g.rngBar}"></line>`,
         `<line class="rangecap" x1="${n(xe)}" y1="${g.rngBar - 7}" x2="${n(xe)}" y2="${g.rngBar + 7}"></line>`,
         `<line class="rangecap" x1="${n(xl)}" y1="${g.rngBar - 7}" x2="${n(xl)}" y2="${g.rngBar + 7}"></line>`,
         `<circle class="rangedot" cx="${n(xn)}" cy="${g.rngBar}" r="5"></circle>`,
         `<text class="tick-t" x="${n(xe)}" y="${g.rngLab}" text-anchor="middle">${md2(d.window.earliest)}</text>`,
         `<text class="tick-t" x="${n(xn)}" y="${g.rngLab + g.midDrop}" text-anchor="middle">normally ${md2(d.window.normal)}</text>`,
         `<text class="tick-t" x="${n(xl)}" y="${g.rngLab}" text-anchor="middle">${md2(d.window.latest)}</text>`);

  o.push(`<line class="ax" x1="${g.x0}" y1="${g.yBase + 1}" x2="${g.x1}" y2="${g.yBase + 1}"></line>`,
         `<line class="ax" x1="${g.x0}" y1="${g.yTop + 7}" x2="${g.x0}" y2="${g.yBase + 1}"></line>`,
         `<line class="thresh" x1="${g.x0}" y1="${n(yThresh)}" x2="${g.x1}" y2="${n(yThresh)}"></line>`,
         `<text class="lab-cold" x="${g.x0 + 8}" y="${n(yThresh + g.coldDy)}">COLD ENOUGH TO MAKE SNOW</text>`);

  const pts = d.curve.series.filter((_, i) => i % 2 === 0 || i === curve.series.length - 1)
    .map(p => `${n(X(p.md))},${n(Y(p.v))}`).join(" ");
  o.push(`<polyline class="curve" points="${pts}"></polyline>`);

  const xc = X(d.curve.crossing);
  o.push(`<circle class="dot-cross" cx="${n(xc)}" cy="${n(yThresh)}" r="6"></circle>`,
         `<text class="lab-key" x="${n(xc + g.keyDx)}" y="${n(yThresh + g.keyDy)}" text-anchor="${g.keyAnchor}">` +
         `Average crosses 28&deg; &middot; ${md2(d.curve.crossing)}</text>`);

  // How far apart the pins land is a fact about the hills, and it changes when
  // the projection does — the metro median and the last hill open seventeen
  // days apart this year, which is not enough room for both captions on one
  // line. So the rows are packed here rather than declared in the geometry: a
  // caption drops to the next row only when it would touch the one beside it,
  // and the drawing grows by exactly the rows it used.
  let rows = 0;
  const placed = [];
  for (const p of d.pins) {
    const x = X(p.md);
    const w = p.label.length * g.pinFont * 0.52;
    const anchor = x > g.x1 - w / 2 ? "end" : x < g.x0 + w / 2 ? "start" : "middle";
    const left = anchor === "end" ? x - w : anchor === "start" ? x : x - w / 2;
    let row = 0;
    while (placed.some(q => q.row === row && left < q.right + 8 && left + w > q.left - 8)) row++;
    rows = Math.max(rows, row);
    placed.push({ x, label: p.label, anchor, row, left, right: left + w });
  }
  for (const q of placed) {
    const tip = g.pinTip + q.row * g.pinStep, lab = g.pinLab + q.row * g.pinStep;
    o.push(`<line class="pin" x1="${n(q.x)}" y1="${g.pinLineFrom ?? g.yBase + 1}" x2="${n(q.x)}" y2="${tip}"></line>`,
           `<circle class="pin-dot" cx="${n(q.x)}" cy="${g.yBase + 1}" r="3.5"></circle>`,
           `<text class="pin-t" x="${n(q.x)}" y="${lab}" text-anchor="${q.anchor}">${esc(q.label)}</text>`);
  }
  const h = g.hBase + rows * g.pinStep;

  g.xTicks.forEach((md, i) => {
    const anchor = i === 0 ? "start" : i === g.xTicks.length - 1 ? "end" : "middle";
    o.push(`<text class="tick-t" x="${n(X(md))}" y="${g.xLab}" text-anchor="${anchor}">${md2(md)}</text>`);
  });

  const alt = `Mean ${d.label} wet-bulb temperature falling from ` +
    `${Math.round(d.curve.series[0].v)} degrees on ${md2(d.curve.series[0].md)} to ` +
    `${Math.round(d.curve.series.at(-1).v)} degrees on ${md2(d.curve.series.at(-1).md)}, crossing 28 degrees on ` +
    `${md2(d.curve.crossing)}. The first workable snowmaking window normally arrives ` +
    `${md2(d.window.normal)}, with a historical range of ${md2(d.window.earliest)} to ${md2(d.window.latest)}.`;

  return `<svg class="${g.cls}" viewBox="0 0 ${g.w} ${h}" role="img" aria-label="${esc(alt)}">\n  ` +
         o.join("\n  ") + `\n</svg>`;
}

function chartSection(d) {
  if (!d?.curve) return `<p class="sec-note">No curve on file. Run <code>node scripts/curve.mjs</code>.</p>`;
  return [
    chartSvg(GEOM.wide, d),
    chartSvg(GEOM.narrow, d),
    `<div class="legend">`,
    `  <b><i class="sw"></i> Mean wet-bulb, ${esc(d.label)}, ${esc(d.years)}</b>`,
    `  <b><i class="sw cold"></i> 28&deg;F snowmaking threshold</b>`,
    `  <b><i class="sw band"></i> Cold enough to make snow</b>`,
    `</div>`,
  ].join("\n");
}

// ------------------------------------------------------------------ photos
//
// A hill's own photos, from data/resorts.json. Hills with none render nothing
// at all rather than an empty heading — fifteen of the sixteen are still empty,
// and a section that says "Photos" above a blank strip is worse than silence.

const GALLERY_SIZES =
  "(max-width:560px) calc(100vw - 48px), (max-width:900px) calc((100vw - 64px) / 2), 330px";

// One photo may be marked `"hero": true`, which lifts it out of the gallery and
// into the headline column. It appears once or the page shows the same picture
// twice on one screen.
function heroShot(slug) {
  const ph = (resorts[slug].photos ?? []).find(p => p.hero);
  if (!ph) return "";
  return `    <figure class="hero-shot">
      ${SHOT(ph.file, "", ph.alt, "(max-width:820px) calc(100vw - 48px), 300px", "../", true)}
      <figcaption>${esc(ph.caption)}</figcaption>
    </figure>`;
}

function photoSection(slug) {
  const shots = (resorts[slug].photos ?? []).filter(p => !p.hero);
  if (!shots.length) return "";
  const figs = shots.map(ph => `        <figure class="pic">
          ${SHOT(ph.file, "", ph.alt, GALLERY_SIZES, "../")}
          <figcaption>${esc(ph.caption)}</figcaption>
        </figure>`).join("\n");
  return `
  <section class="sec">
    <h2 class="sec-title">Photos</h2>
    <div class="gallery">
${figs}
    </div>
  </section>
`;
}

// The homepage headline says Wild Mountain opens first; this is Wild Mountain
// opening. It follows whichever photo that hill has marked as its hero, so the
// two cannot drift apart.
const INDEX_HERO = "wild-mountain";

function indexHeroShot() {
  const ph = (resorts[INDEX_HERO].photos ?? []).find(p => p.hero);
  if (!ph) return "";
  return `      <figure class="hero-shot">
        ${SHOT(ph.file, "", ph.alt, "(max-width:820px) calc(100vw - 48px), 300px", "", true)}
        <figcaption>${esc(resorts[INDEX_HERO].name)}&rsquo;s ${esc(ph.caption[0].toLowerCase() + ph.caption.slice(1))}</figcaption>
      </figure>`;
}

// ------------------------------------------------------------ who made this
//
// The about page was reachable only from the footer, which is where things go
// to not be read. This is the same introduction, sized to sit in the gap beside
// the hero — the gap being the other half of the problem, since a 62-character
// measure against an empty half-page reads as a column that failed to load.

const VENMO = "https://account.venmo.com/u/davidehp";

// The srcset lists the widths that exist rather than the widths we wish
// existed. scripts/photos.mjs refuses to enlarge a photo past its source, so
// which variants a shot has depends on what came out of the camera — or out of
// whatever resized it on the way here. Read them off disk rather than assuming
// a fixed set: a 726px-wide source ships a 726w file, and nothing else would
// know to offer it.
const PHOTO_WIDTHS = new Map();
for (const f of existsSync("photos") ? readdirSync("photos") : []) {
  const m = /^(.+)-(\d+)\.jpg$/.exec(f);
  if (!m) continue;
  if (!PHOTO_WIDTHS.has(m[1])) PHOTO_WIDTHS.set(m[1], []);
  PHOTO_WIDTHS.get(m[1]).push(Number(m[2]));
}
for (const a of PHOTO_WIDTHS.values()) a.sort((x, y) => x - y);

// `eager` is for the one photo above the fold. Deferring that one costs the
// page its largest paint for no saving — nobody scrolls past it.
function SHOT(base, cls, alt, sizes, root = "", eager = false) {
  const have = PHOTO_WIDTHS.get(base) ?? [];
  if (!have.length) throw new Error(`no photo files for "${base}"; run scripts/photos.mjs`);
  const srcset = have.map(w => `${root}photos/${base}-${w}.jpg ${w}w`).join(", ");
  const load = eager ? `loading="eager" fetchpriority="high" decoding="async"`
                     : `loading="lazy" decoding="async"`;
  return `<img class="${cls}" src="${root}photos/${base}-${have[0]}.jpg"\n` +
         `           srcset="${srcset}"\n` +
         `           sizes="${sizes}"\n` +
         `           ${load}\n` +
         `           alt="${esc(alt)}">`;
}

const ARMS_ALT = "David in a t-shirt and helmet at Wild Mountain on a warm spring day, " +
                 "ski racks and a chairlift behind him.";

// No Venmo here. Asking for money beside the data reads as a pitch; the ask
// lives on the about page, where somebody has already chosen to read about him.
function helloCard() {
  return `      <aside class="hello">
        ${SHOT("david-midwest", "hello-shot", ARMS_ALT, "(max-width:600px) calc(100vw - 48px), 220px")}
        <div class="hello-body">
          <p class="hello-eyebrow">Who made this</p>
          <p>I&rsquo;m David. I grew up snowboarding in the mid-90s, peak snowboarding
             culture, and got back into it five years ago. Now I&rsquo;m counting down from
             mid-August. Hope this site gets you hyped!!</p>
          <div class="hello-links">
            <a href="about.html">More about this</a>
          </div>
        </div>
      </aside>`;
}

// ------------------------------------------------------- who opened first
//
// This was two hardcoded sentences asserting a fact the data already knew, and
// it had drifted twice over. It counted a dead heat with Andes Tower Hills in
// 2022-23 as a win, and it counted 2024-25, where Wild Mountain's first lift is
// bracketed to a seventeen-day window running to 2 December — Andes opened on
// 23 November inside it, so nobody can say who was first.
//
// A date here is an interval, not a point. `exact` is a single day; `bracket`
// carries a range, and a null bound is unbounded. A hill could have been first
// if its earliest possible day is not after the earliest last-possible day of
// any other. One candidate is a winner, several identical exact ones are a tie,
// anything else is a winter nobody gets to claim.

// A closed bracket is real uncertainty: Wild Mountain's 2024-25 first lift sits
// somewhere in a seventeen-day window, and nobody can rank inside it.
//
// A one-sided bracket is not the same thing. "No closed capture before the first
// open one" means the archive never looked earlier — absence of evidence, not
// evidence of an earlier opening. Treating it as unbounded let an archive
// sampling gap veto Trollhaugen's own post announcing opening weekend on
// 19 November 2021, which is exactly backwards. It ranks as its recorded date.
function interval(fl) {
  if (!fl?.date) return null;
  const r = fl.range;
  if (fl.precision === "exact" || !r) return [fl.date, fl.date];
  if (r[0] == null || r[1] == null) return [fl.date, fl.date];
  return [r[0], r[1]];
}

function leadersBySeason() {
  const all = new Set();
  for (const h of Object.values(seasons)) for (const s of Object.keys(h)) all.add(s);
  const out = [];
  for (const season of [...all].sort()) {
    const rows = [];
    for (const [slug, hs] of Object.entries(seasons)) {
      const iv = interval(hs[season]?.firstLift);
      if (iv && resorts[slug]) rows.push({ slug, lo: iv[0], hi: iv[1], exact: iv[0] === iv[1] });
    }
    if (!rows.length) continue;
    const earliestHi = rows.reduce((m, r) => (r.hi < m ? r.hi : m), rows[0].hi);
    const could = rows.filter(r => r.lo <= earliestHi);
    const tied = could.length > 1 &&
                 could.every(r => r.exact && r.lo === could[0].lo);
    const settled = could.length === 1 || tied;
    // Everyone tied for the next place, not whichever one sorted first: Wild
    // Mountain and Trollhaugen both took their first lift on 10 November 2025,
    // and naming one of them was an arbitrary choice presented as a fact.
    const rest = rows.filter(r => !could.includes(r)).sort((x, y) => x.lo.localeCompare(y.lo));
    const nextLo = rest[0]?.lo ?? null;
    out.push({ season, settled, leaders: settled ? could.map(r => r.slug) : [],
               date: could[0].lo,
               next: settled && nextLo ? rest.filter(r => r.lo === nextLo) : [] });
  }
  return out;
}

// "A and B", "A, B and C" — the runner-up is often a tie.
const listOf = xs => xs.length < 2 ? (xs[0] ?? "")
  : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;

const dayGap = (a, b) =>
  Math.round((new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / 86400000);

function heroCopy() {
  const rows = leadersBySeason();
  if (!rows.length) return { SAY: "", SUB: "" };
  const bold = slug => `<b>${esc(resorts[slug].name)}</b>`;
  const last = rows.at(-1);

  let SAY;
  if (!last.settled) {
    SAY = "Last season's dates are too loose to say who opened first.";
  } else if (last.leaders.length > 1) {
    SAY = `${listOf(last.leaders.map(bold))} opened first last season, to the day.`;
  } else if (last.next.length) {
    const n = dayGap(last.date, last.next[0].lo);
    SAY = `${bold(last.leaders[0])} opened first last season, ` +
          `${n === 1 ? "a day" : `${n} days`} ahead of ${listOf(last.next.map(r => bold(r.slug)))}.`;
  } else {
    SAY = `${bold(last.leaders[0])} opened first last season.`;
  }

  const tally = new Map();
  for (const r of rows) for (const slug of r.leaders) tally.set(slug, (tally.get(slug) ?? 0) + 1);
  const loose = rows.filter(r => !r.settled).length;

  // Group by how many each has won, so a hill with one is named alongside the
  // hills with two rather than dropped for not topping the table.
  const byCount = new Map();
  for (const [slug, n] of tally) {
    if (!byCount.has(n)) byCount.set(n, []);
    byCount.get(n).push(slug);
  }
  const groups = [...byCount].sort((a, b) => b[0] - a[0]).map(([n, slugs]) =>
    `${listOf(slugs.map(bold))} ${TIMES[n] ?? n + " times"}${slugs.length > 1 ? " each" : ""}`);

  let SUB = "";
  if (groups.length) {
    SUB = `First open has gone to ${listOf(groups)}`;
    SUB += loose
      ? `; ${WORDS[loose] ?? loose} of the ${WORDS[rows.length] ?? rows.length} winters on ` +
        `record ${loose === 1 ? "is" : "are"} too loosely dated to call. `
      : `. `;
  }
  SUB += "No resort has announced a date for the coming winter.";
  return { SAY, SUB };
}

// ------------------------------------------------- regions without hills
//
// A region nobody has gathered dates for still has weather. These pages carry
// the same wet-bulb chart and the same forecast tiles as Minnesota, taken at
// reference towns instead of at hills, and stop there: no season table, no
// projection, no opening date. The estimate is the climatology and says so.

const placesIn = id => Object.entries(places).filter(([, p]) => p.region === id);

// Which resorts a region has, and which of them we already hold dates for.
// A name on its own is not much, but it is the difference between "nobody has
// worked this state" and a list somebody can pick a weekend off.
const TRACKED = new Set(Object.values(resorts).map(r => r.name.toLowerCase()));
const looksTracked = n => {
  const k = n.toLowerCase().replace(/ ski area$| mountains?$/,"").trim();
  for (const t of TRACKED) if (t === k || t.startsWith(k) || k.startsWith(t)) return true;
  return false;
};

function roster(id) {
  const list = known?.regions?.[id] ?? [];
  if (!list.length) return "";
  const items = list.map(r => {
    const on = looksTracked(r.name);
    return `        <li${on ? ' class="on"' : ""}>${esc(r.name)}` +
           `<span>${esc(r.state.replace(/^(UP|LP) - Michigan$/, "$1"))}</span></li>`;
  }).join("\n");
  const n = list.filter(r => looksTracked(r.name)).length;
  return `    <p class="sec-note roster-note">${list.length} resorts in this region, ` +
    `${n ? `${n} with dates on file. The rest have none.` : "none with dates on file yet."} ` +
    `From the <a href="${esc(known.source.map)}">Midwest Ski Resort Guide</a> ` +
    `by <a href="${esc(known.source.site)}">Midwest Skiers</a>.</p>

    <ul class="roster">
${items}
    </ul>`;
}


// The next time a calendar day comes round, which is what "N days away" means
// in August when the date in question is in November.
function daysUntilMd(md) {
  const [m, d] = md.split("-").map(Number);
  const today = new Date();
  let when = new Date(today.getFullYear(), m - 1, d);
  if (when < today) when = new Date(today.getFullYear() + 1, m - 1, d);
  return Math.round((when - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
}

const stat = (label, value, lede = false) =>
  `      <div><dt>${label}</dt><dd${lede ? ' class="lede"' : ""}>${value}</dd></div>`;

function regionClimate(id) {
  const list = placesIn(id);
  // Nothing is tracked on these pages yet, and saying so with a zero beats
  // borrowing Minnesota's totals, which describe a different state.
  if (!list.length) {
    return { CLIMATE: "", HEADLINE: null, LEAD: null, EYEBROW: null,
             STATS: [stat("Resorts tracked", "0"), stat("Opening dates on file", "0")].join("\n") };
  }

  const [, ref] = list.find(([, p]) => p.curve) ?? list[0];

  const cards = list.map(([pid, p]) => {
    const f = fc?.places?.[pid];
    if (!f || f.min === null) {
      return `      <div class="card"><h3>${esc(p.label)}</h3><p class="big">&mdash;</p>
        <p>Forecast unavailable for ${esc(p.note)}.</p></div>`;
    }
    return `      <div class="card">
        <h3>${esc(p.label)}</h3>
        <p class="big">${F(f.min)}</p>
        <p>Coldest wet bulb the ${fc.horizonDays}-day forecast reaches at ${esc(p.note)}.</p>
        <dl>
          <dt>Hours under ${fc.threshold}&deg;</dt><dd>${f.hoursUnder}</dd>
          <dt>First window</dt><dd>${f.firstWindow ? whenWindow(f.firstWindow) : "&mdash;"}</dd>
          <dt>Normal Oct&ndash;Nov hours</dt><dd>${p.hours.normal}</dd>
        </dl>
      </div>`;
  }).join("\n");

  // Keep the place with its own forecast rather than matching two arrays by
  // index: one unreadable forecast would shift them and name the wrong town.
  const known = list
    .map(([pid, p]) => ({ p, f: fc?.places?.[pid] }))
    .filter(({ f }) => f && f.min !== null);
  const withWindow = known.filter(({ f }) => f.hoursUnder > 0);
  let answer;
  if (!fc) answer = "No forecast on file.";
  else if (!known.length) answer = "The forecast did not load for any of these.";
  else if (!withWindow.length) {
    const cold = known.reduce((a, b) => (b.f.min < a.f.min ? b : a));
    answer = `No snowmaking weather in the next ${fc.horizonDays} days. ` +
      `The coldest any of these gets is ${F(cold.f.min)} at ${esc(cold.p.note)}.`;
  } else {
    answer = `${withWindow.length} of ${known.length} get snowmaking weather in the ` +
      `next ${fc.horizonDays} days.`;
  }

  const chart = chartSection({
    curve: ref.curve, window: ref.window, pins: [], label: ref.note, years: ref.years,
  });

  const CLIMATE = `
  <section class="sec">
    <h2 class="sec-title">When the guns can run</h2>
    <p class="sec-note">
      Snow guns need a wet-bulb temperature under 28&deg;F. The mean at ${esc(ref.note)}
      does not get there until ${md2(ref.curve.crossing)}, but the first workable window normally
      arrives on ${md2(ref.window.normal)}. Resorts open on those early cold snaps rather than on
      the average.
    </p>

    <div class="chart-box">
${chart}
    </div>
  </section>

  <section class="sec">
    <h2 class="sec-title">The next ${WORDS[Math.round((fc?.horizonDays ?? 14) / 7)] ?? ""} weeks</h2>
    <p class="fc-answer">${answer}</p>

    <div class="duo">
${cards}
    </div>

    <p class="sec-note fc-note">
      Wet-bulb forecast from <a href="https://open-meteo.com/">Open-Meteo</a>, updated twice a
      day. Guns can run under ${fc?.threshold ?? 28}&deg;.
    </p>
  </section>
`;

  // The headline answers "when can I first ride here", so it takes the soonest
  // of the region's points rather than the one the chart happens to be drawn
  // for. In the Dakotas that is a 700-mile difference: the Black Hills cross
  // four weeks before Dubuque.
  const soonest = list.reduce((a, b) =>
    (b[1].window.normal < a[1].window.normal ? b : a))[1];
  const days = daysUntilMd(soonest.window.normal);
  return {
    STATS: [
      stat("Resorts tracked", "0"),
      stat("Opening dates on file", "0"),
      stat("Earliest normal window", md2(soonest.window.normal), true),
      stat(`Oct&ndash;Nov hrs there`, String(soonest.hours.normal)),
    ].join("\n"),
    CLIMATE,
    EYEBROW: `Normally ${md2(soonest.window.normal)}`,
    HEADLINE: `Snowmaking weather normally reaches ${esc(soonest.label)} around ` +
              `${md2(soonest.window.normal)}, ${days} days away.`,
    LEAD: `That is the whole estimate, and it describes the weather at a reference town. ` +
          `Nobody has filed an opening date for a resort here, so there is nothing to ` +
          `project from. The chart and the tiles below are the same ones the ` +
          `Minnesota page runs on, taken at ${listOf(list.map(([, p]) => esc(p.note)))} ` +
          `instead of at resorts. The curve shown is ${esc(ref.note)}'s.`,
  };
}


// Homepage
const hero = heroCopy();
const leader = Object.keys(projection).sort((a, b) => projection[a].date.localeCompare(projection[b].date))[0];
const lead = observed(leader);

writeFileSync("index.html", markHills(fill(readFileSync("templates/index.html", "utf8"), {
  TABLE: tableRows(),
  DATELINE: dateline,
  FORECAST_TITLE: fcSection.TITLE,
  FORECAST_ANSWER: fcSection.ANSWER,
  FORECAST_NOTE: fcSection.NOTE,
  FORECAST_CARDS: fcSection.CARDS,
  HERO_SCENARIOS: heroScenarios(leader),
  HERO_SEASONS: String(lead.n),
  HERO_HILLS: String(Object.keys(resorts).length),
  HERO_HOURS: String(hours[leader]?.normal ?? "—"),
  FOOTER_PROVENANCE: provenance,
  LAST_UPDATED: lastUpdated,
  COPYRIGHT: copyright,
  PICKER: picker("mn", ""),
  HILL_INK: hillInkCss(),
  CHART: chartSection(curve && {
    curve, window: WINDOW, pins: chartPins(), label: curve.label, years: curve.years,
  }),
  HELLO: helloCard(),
  HERO_SAY: hero.SAY,
  HERO_SUB: hero.SUB,
  HERO_SHOT: indexHeroShot(),
})));

// Resort pages
mkdirSync("resorts", { recursive: true });
// One placeholder per state that has no record yet. They borrow the homepage's
// stylesheet rather than keeping a second copy in step with it.
const indexTpl = readFileSync("templates/index.html", "utf8");
const style = indexTpl.slice(indexTpl.indexOf("<style"), indexTpl.indexOf("</style>") + 8);
const regionTpl = readFileSync("templates/region.html", "utf8");

for (const region of STATES.filter(r => r.id !== "mn")) {
  const n = countIn(region.state);
  const clim = regionClimate(region.id);
  const lead = n
    ? `${n === 1 ? "One" : String(n)} ${region.name} resort ${n === 1 ? "is" : "are"} already on ` +
      `the site, carried over because it sits in the Twin Cities' orbit. That does not mean ` +
      `the state is covered: nobody has gathered the rest of ${region.name} yet.`
    : `No ${region.name} resorts are on the site yet. Everything here is built from dates ` +
      `gathered one post at a time, and nobody has worked this state.`;
  writeFileSync(region.file, fill(regionTpl, {
    STYLE: style,
    PICKER: picker(region.id, ""),
    REGION: esc(region.name),
    // A region with climatology leads with the weather; one without still says
    // plainly that nobody has worked it.
    EYEBROW: clim.EYEBROW ?? region.eyebrow ?? (n ? "Barely started" : "Not covered yet"),
    HEADLINE: clim.HEADLINE ?? region.headline ?? (n
      ? `${region.name} is barely started.`
      : `${region.name} is not covered yet.`),
    LEAD: clim.LEAD ?? region.lead ?? lead,
    REGION_CLIMATE: clim.CLIMATE,
    ROSTER: roster(region.id),
    REGION_STATS: clim.STATS,
    CTA: region.cta ?? `Know a ${region.name} resort's dates, or want to take on the whole ` +
         `state?`,
    FOOTER_PROVENANCE: provenance,
  LAST_UPDATED: lastUpdated,
  COPYRIGHT: copyright,
  }));
}
console.log(`built ${STATES.length - 1} state placeholders`);

// About page
const ABOUT_SIZES = "(max-width:820px) calc(100vw - 48px), 380px";
writeFileSync("about.html", fill(readFileSync("templates/about.html", "utf8"), {
  STYLE: style,
  PICKER: picker("mn", ""),
  FOOTER_PROVENANCE: provenance,
  LAST_UPDATED: lastUpdated,
  COPYRIGHT: copyright,
  SHOT_POND: SHOT("wild-mountain-pondskim", "",
    "David going down in the pond skim at Wild Mountain, mid-wipeout in a spray of green " +
    "water, a crowd watching from the fence and the lift tower behind.", ABOUT_SIZES),
  SHOT_PEAKS: SHOT("david-mountains", "",
    "David on a groomed run at Copper Mountain in snowboard gear, " +
    "the snow-covered Tenmile Range behind him.", ABOUT_SIZES),
  PAY: VENMO ? `<div class="pay-block">
          <p>If the site saved you a search, or just got you hyped, there is a Venmo.</p>
          <a class="pay" href="${esc(VENMO)}" rel="noopener">Buy me a beer</a>
        </div>` : "",
}));

const resortTpl = readFileSync("templates/resort.html", "utf8");
for (const [slug, r] of Object.entries(resorts)) {
  const o = observed(slug);
  writeFileSync(`resorts/${slug}.html`, markHills(fill(resortTpl, {
    NAME: esc(r.name), PLACE: esc(`${r.place}, ${r.state}`), WEBSITE: esc(r.website),
    NAME_MARK: wordmark(r.name),
    BRAND_CSS: brandCss(r),
    SOCIAL_LINKS: socialLinks(r),
    TYPICAL: pretty(o.typical), EARLIEST: pretty(o.earliest), LATEST: pretty(o.latest),
    HOURS: String(hours[slug]?.normal ?? "—"),
    SEASONS: seasonRows(slug),
    SEASON_HEAD: seasonHead(slug),
    SEASON_NOTES: seasonNotesFor(slug),
    FOOTER_PROVENANCE: provenance,
  LAST_UPDATED: lastUpdated,
  COPYRIGHT: copyright,
    PICKER: picker("mn", "../"),
    HILL_INK: hillInkCss(),
    PHOTOS: photoSection(slug),
    HERO_SHOT: heroShot(slug),
  })));
}

// Region and about pages carried the preconnect hint but not the stylesheet it
// was hinting at, so Anton never loaded and they fell back to Impact — close
// enough in shape to look intentional rather than broken. Every page that asks
// for a face must also ask for the file.
const FACES = ["Anton", "Archivo"];
const built = ["index.html", "about.html", ...STATES.filter(r => r.id !== "mn").map(r => r.file),
               ...Object.keys(resorts).map(s => `resorts/${s}.html`)];
const unstyled = built.filter(f => {
  const html = readFileSync(f, "utf8");
  return FACES.some(face => html.includes(`font-family:${face}`)) &&
         !html.includes("fonts.googleapis.com/css2");
});
if (unstyled.length) {
  console.error(`\nERROR: these pages use a webfont but never load one:\n  ${unstyled.join("\n  ")}`);
  process.exit(1);
}

console.error(`built index.html and ${Object.keys(resorts).length} resort pages`);
