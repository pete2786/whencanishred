# Resort Record and Real Opening Dates — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder opening dates in `index.html` with five seasons of real, sourced open/close dates for 16 Minnesota-area ski hills, and render the site from that data instead of from hand-typed HTML.

**Architecture:** Four data files with a hard line between hand-owned (`resorts.json`, `overrides.json`) and generated (`raw/*.json`, `seasons.json`). A Wayback sweep brackets each opening from archived resort pages; a browser-driven Facebook pass pins the dates; a reconciler cross-references them and records precision and corroboration per date. A zero-dependency build script renders `index.html` from the result.

**Tech Stack:** Node 23 ESM, no dependencies, no build tooling. `fetch` for archive.org's CDX API. Chrome via claude-in-chrome for the Facebook pass. Output is static files served by GitHub Pages from the repo root.

**Spec:** `docs/superpowers/specs/2026-08-24-resort-record-and-opening-dates-design.md` — read it first, including the "Field findings" section at the end, which corrects several assumptions made earlier in the same document.

## Global Constraints

- **No dependencies.** No `package.json`, no `node_modules`. Everything uses Node built-ins. This matches the existing `scripts/*.mjs`.
- **No test suite.** The author spot-checks. Every task ends with a command that prints output a human reads, not an assertion that passes silently.
- **Generated files are never hand-edited.** `data/raw/*.json`, `data/seasons.json`, `index.html`, and `resorts/*.html` are outputs. Corrections go in `data/overrides.json` or `data/resorts.json`.
- **`data/cache/` stays gitignored.** It already is. Wayback captures cache there so reruns are free, same convention as the ERA5 pulls.
- **Assert state only on explicit evidence.** A page with no operational language is `NO-SIGNAL`, never `CLOSED`. This is the single most important rule in the project; violating it manufactures confident wrong dates.
- **Seasons are `2021-22` through `2025-26`**, each spanning Oct 1 of the first year through Apr 30 of the second.
- **Slugs are lowercase, hyphenated, derived from the resort name**: `wild-mountain`, `andes-tower-hills`, `mount-kato`.
- **Be polite to archive.org.** 250 ms between capture fetches, exponential backoff on 429 and 503.

---

### Task 1: Seed the resort record

**Files:**
- Create: `data/resorts.json`
- Read for reference: `scripts/climatology.mjs:26-43` (names, places, coordinates), `index.html:352-478` (website URLs, region grouping)

**Interfaces:**
- Produces: `data/resorts.json`, an object keyed by slug. Every later task reads it. Fields: `name`, `place`, `state`, `region`, `lat`, `lon`, `website`, `formerDomains` (`string[]`, bare hostnames the resort used previously — Coffee Mill moved from `coffeemillski.com` to `cmskiarea.com`, and the sweep needs the old one to find any history at all), `social` (`{facebook, instagram}`, both `null` until Task 6), `colors` (`{primary, secondary}`, both `null` until Task 6), `photos` (`[]`).

- [ ] **Step 1: Build the file from the two existing sources**

The 16 hills, their places, and coordinates come from the `HILLS` array in `scripts/climatology.mjs`. The website URLs and the Twin Cities / Greater Minnesota grouping come from the table in `index.html`. Write `data/resorts.json`:

```json
{
  "wild-mountain": {
    "name": "Wild Mountain", "place": "Taylors Falls", "state": "MN",
    "region": "twin-cities", "lat": 45.3897, "lon": -92.7143,
    "website": "https://wildmountain.com/",
    "social": { "facebook": null, "instagram": null },
    "colors": { "primary": null, "secondary": null },
    "photos": []
  },
  "trollhaugen": {
    "name": "Trollhaugen", "place": "Dresser", "state": "WI",
    "region": "twin-cities", "lat": 45.3572, "lon": -92.6349,
    "website": "https://trollhaugen.com/",
    "social": { "facebook": null, "instagram": null },
    "colors": { "primary": null, "secondary": null },
    "photos": []
  }
}
```

Continue for all 16 in the order the table uses: `wild-mountain`, `trollhaugen`, `hyland-hills`, `afton-alps`, `welch-village`, `buck-hill`, `elm-creek` (region `twin-cities`), then `lutsen-mountains`, `giants-ridge`, `spirit-mountain`, `powder-ridge`, `mount-kato`, `buena-vista`, `detroit-mountain`, `andes-tower-hills`, `coffee-mill` (region `greater-minnesota`).

Note `state` is `"WI"` for Trollhaugen only. `place` drops the state suffix that `climatology.mjs` embeds in `"Dresser, WI"`.

- [ ] **Step 2: Re-verify every website URL and record former domains**

`index.html` links Wild Mountain to `wildmountainski.com`, which is dead and has zero Wayback captures. The real site is `wildmountain.com`. Assume others may be wrong too. Check each:

```bash
node --input-type=module -e '
import { readFileSync } from "node:fs";
const r = JSON.parse(readFileSync("data/resorts.json", "utf8"));
for (const [slug, v] of Object.entries(r)) {
  const res = await fetch(v.website, { redirect: "follow" })
    .catch(e => ({ status: "ERR", url: e.message }));
  console.log(String(res.status).padEnd(6), slug.padEnd(20), res.url ?? v.website);
}
'
```

Expected: every row `200`, and `res.url` either matching `website` or being a redirect target you then write back into `resorts.json` as the canonical URL. Anything non-200 gets fixed by hand before moving on.

- [ ] **Step 3: Confirm the record loads and is complete**

```bash
node -e '
const r = JSON.parse(require("fs").readFileSync("data/resorts.json","utf8"));
console.log(Object.keys(r).length, "resorts");
for (const [s, v] of Object.entries(r)) {
  const bad = ["name","place","state","region","lat","lon","website"].filter(k => v[k] == null);
  if (bad.length) console.log("  MISSING", s, bad.join(","));
}
'
```

Expected: `16 resorts` and no `MISSING` lines.

- [ ] **Step 4: Commit**

```bash
git add data/resorts.json
git commit -m "Seed resort record with verified URLs

Wild Mountain's URL in index.html was wildmountainski.com, which is dead.
The site is wildmountain.com."
```

---

### Task 2: CDX library

**Files:**
- Create: `scripts/lib/cdx.mjs`

**Interfaces:**
- Produces:
  - `captures(url, { from, to, matchType, collapse, limit }) -> Promise<Array<{timestamp, original}>>` — queries the Wayback CDX index. `from`/`to` are `YYYYMMDD` strings. Defaults to `collapse: "timestamp:8"` (one capture per day) and `filter=statuscode:200`.
  - `capture(timestamp, url) -> Promise<string|null>` — fetches one capture's original bytes, cached on disk. `null` if unavailable.
  - `visibleText(html) -> string` — strips scripts, styles, comments and tags; decodes entities; collapses whitespace.
  - `looksBinary(s) -> boolean` — true when decoding produced replacement characters, meaning the fetch is broken and the result must not be classified.
- Consumes: nothing.

- [ ] **Step 1: Write the library**

```js
// Thin wrapper over the Wayback CDX index and capture fetching, with an on-disk
// cache. Same convention as the ERA5 pulls: data/cache/ is gitignored and reruns
// are free.

import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const CDX = "http://web.archive.org/cdx/search/cdx";
const CACHE = "data/cache/wayback";
const UA = "whencanishred/1.0 (+https://github.com/pete2786/whencanishred)";

mkdirSync(CACHE, { recursive: true });

const key = s => createHash("sha1").update(s).digest("hex").slice(0, 16);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// archive.org rate-limits and occasionally 503s under load. Back off rather
// than hammering, and give up quietly so one dead URL cannot stall a sweep.
async function retrying(url, tries = 5) {
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA } });
      if (res.ok) return res;
      if (res.status !== 429 && res.status !== 503) return null;
    } catch { /* network flake; fall through to the backoff */ }
    await sleep(5000 * (attempt + 1));
  }
  return null;
}

export async function captures(url, { from, to, matchType, collapse = "timestamp:8", limit = 5000 } = {}) {
  const q = new URLSearchParams({
    url, output: "json", collapse, limit: String(limit),
    filter: "statuscode:200", fl: "timestamp,original",
  });
  if (from) q.set("from", from);
  if (to) q.set("to", to);
  if (matchType) q.set("matchType", matchType);

  const file = `${CACHE}/cdx-${key(q.toString())}.json`;
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));

  const res = await retrying(`${CDX}?${q}`);
  if (!res) throw new Error(`CDX request failed: ${url}`);

  const body = await res.text();
  const rows = body.trim() ? JSON.parse(body) : [];
  // With `fl` set, the first row is a header. An empty result has no header.
  const data = rows.length && rows[0][0] === "timestamp" ? rows.slice(1) : rows;
  const out = data.map(([timestamp, original]) => ({ timestamp, original }));

  writeFileSync(file, JSON.stringify(out));
  return out;
}

// `id_` returns the archived bytes without the banner the Wayback UI injects.
export async function capture(timestamp, url) {
  const file = `${CACHE}/${timestamp}-${key(url)}.html`;
  if (existsSync(file)) return readFileSync(file, "utf8");

  const res = await retrying(`https://web.archive.org/web/${timestamp}id_/${url}`);
  if (!res) return null;

  const html = await res.text();
  writeFileSync(file, html);
  await sleep(250);
  return html;
}

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ndash: "–", mdash: "—", deg: "°", rsquo: "’", lsquo: "‘",
};

const decodeEntities = s => s
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);

export function visibleText(html) {
  const stripped = html
    .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(stripped).replace(/\s+/g, " ").trim();
}

// A capture whose body did not decode is a fetch bug, not an absence of signal.
// Classifying it would silently produce NO-SIGNAL for a page that says "OPEN".
export function looksBinary(s) {
  if (!s) return true;
  const sample = s.slice(0, 4000);
  let bad = 0;
  for (let i = 0; i < sample.length; i++) if (sample.charCodeAt(i) === 0xfffd) bad++;
  return bad > sample.length * 0.02;
}
```

- [ ] **Step 2: Run it against a known capture**

```bash
node -e '
import { captures, capture, visibleText, looksBinary } from "./scripts/lib/cdx.mjs";
const rows = await captures("wildmountain.com", { from: "20241201", to: "20241215" });
console.log(rows.length, "captures:", rows.map(r => r.timestamp).join(" "));
const html = await capture(rows[0].timestamp, "https://wildmountain.com/");
const text = visibleText(html);
console.log("binary?", looksBinary(text), "| chars:", text.length);
console.log(text.slice(0, 200));
' --input-type=module
```

Expected: two or three captures listed, `binary? false`, and readable navigation text beginning "Wild Mountain Skip to main content".

- [ ] **Step 3: Commit**

```bash
git add scripts/lib/cdx.mjs
git commit -m "Add Wayback CDX client with on-disk capture cache"
```

---

### Task 3: Source URL discovery

**Files:**
- Create: `scripts/discover.mjs`
- Create (output): `data/sources.json`
- Create: `data/sources-extra.json` (hand-owned add/drop corrections, applied by the script so rerunning discovery does not wipe them)

**Interfaces:**
- Consumes: `data/resorts.json` (Task 1), `captures` from `scripts/lib/cdx.mjs` (Task 2).
- Produces: `data/sources.json`, keyed by slug: `{ homepages: string[], conditions: string[] }`. Task 5 sweeps exactly these URLs. `homepages` is a list because a resort that changed domains has history under both.

Conditions pages beat homepages — they are structured, publish runs-open counts, and do not rotate with marketing — but their paths differ per resort (`/mountain-info/snow-report`, `/downhill-conditions`, a `ski-area-snow-report` WordPress plugin). Discover them instead of guessing.

- [ ] **Step 1: Write the discovery script**

```js
// Finds each resort's conditions / snow-report / hours pages in the Wayback
// index, so the sweep targets high-signal URLs rather than a hardcoded guess.
// Output is reviewed by hand before the sweep runs.

import { readFileSync, writeFileSync } from "node:fs";
import { captures } from "./lib/cdx.mjs";

const resorts = JSON.parse(readFileSync("data/resorts.json", "utf8"));

const WANTED = /(snow-?report|conditions|mountain-report|hours-of-operation|hours|lift-?status|trail-?report|whats-?open)/i;
const ASSET = /\.(css|js|jpe?g|png|gif|svg|webp|ico|pdf|woff2?|ttf|mp4|json|xml)(\?|$)/i;
const JUNK = /(wp-content|wp-includes|wp-json|\/feed\/?$|fbclid=|utm_|\/tag\/|\/category\/|summer)/i;

const out = {};
for (const [slug, r] of Object.entries(resorts)) {
  // Sweep former domains too. Coffee Mill moved from coffeemillski.com to
  // cmskiarea.com; its entire archived history lives under the old name.
  const domains = [
    new URL(r.website).hostname.replace(/^www\./, ""),
    ...(r.formerDomains ?? []),
  ];
  const rows = (await Promise.all(domains.map(d => captures(`${d}*`, {
    from: "20211001", to: "20260430", collapse: "urlkey", limit: 2000,
  })))).flat();

  const seen = new Set();
  const conditions = [];
  for (const { original } of rows) {
    if (ASSET.test(original) || JUNK.test(original)) continue;
    if (!WANTED.test(original)) continue;
    // Normalise away www and trailing slashes so the same page is not swept twice.
    const norm = original.replace(/^https?:\/\/(www\.)?/, "https://").replace(/\/$/, "");
    if (seen.has(norm.toLowerCase())) continue;
    seen.add(norm.toLowerCase());
    conditions.push(norm);
  }

  // Former-domain homepages are swept as well, so the old site's own history counts.
  const homepages = [r.website, ...(r.formerDomains ?? []).map(d => `https://${d}/`)];
  out[slug] = { homepages, conditions: conditions.slice(0, 4) };
  console.error(`${slug.padEnd(20)} ${rows.length.toString().padStart(4)} urls -> ${conditions.length} conditions`);
}

writeFileSync("data/sources.json", JSON.stringify(out, null, 2) + "\n");
```

- [ ] **Step 2: Run it and read the output**

```bash
node scripts/discover.mjs && cat data/sources.json
```

Expected: `wild-mountain` picks up `/mountain-info/snow-report` and `/mountain-info/hours-of-operation`; `andes-tower-hills` picks up `/downhill-conditions`. Some resorts will find nothing — that is fine and expected, they fall back to the homepage alone.

- [ ] **Step 3: Hand-correct via `data/sources-extra.json`**

`data/sources.json` is overwritten on every run, so corrections go in
`data/sources-extra.json` as `{ slug: { add: [], drop: [] } }` and are applied by
the script. Read every entry of the generated file. Delete anything that is obviously not an operational page (a blog post that happens to contain "conditions", a summer hours page). Add any conditions URL you know exists that discovery missed. Coffee Mill has only 14 captures across five seasons — expect it to be homepage-only, and do not manufacture URLs for it.

- [ ] **Step 4: Commit**

```bash
git add scripts/discover.mjs data/sources.json
git commit -m "Discover per-resort conditions URLs from the Wayback index"
```

---

### Task 4: The classifier

**Files:**
- Create: `scripts/lib/classify.mjs`

**Interfaces:**
- Consumes: nothing — a pure function over text.
- Produces: `classify(text, { kind }) -> { state, evidence, runsOpen, announcedOpening }` where `state` is `"OPEN" | "CLOSED" | "NO-SIGNAL"`, `evidence` is the matched snippet with surrounding context or `null`, `runsOpen` is a number or `null`, and `announcedOpening` is `{ month, day, evidence }` or `null`. `kind` is `"homepage"` or `"conditions"`.

This is where the project's central rule lives. Wild Mountain's homepage on 9, 19, and 26 November 2024 showed gift-card and season-pass marketing with no operational language; only the 8 December capture said "OPEN DAILY". Absence of "open" is not evidence of closed.

- [ ] **Step 1: Write the classifier**

```js
// Assigns an operational state to one archived page. Asserts a state only on
// explicit evidence: a page with no operational language is NO-SIGNAL, never
// CLOSED. See the field findings in the design spec for why this matters.

const OPEN_PATTERNS = [
  /\bnow open\b/i,
  /\bwe(?:'|’|\s+a)re open\b/i,
  /\bopen daily\b/i,
  /\bopen for the season\b/i,
  /\blifts?\s+(?:are\s+)?(?:now\s+)?spinning\b/i,
  /\bopen (?:today|now)\b/i,
  /\bopen\s+\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\s*[-–—]\s*\d/i,
];

const CLOSED_PATTERNS = [
  /\bclosed for the season\b/i,
  /\bsee you (?:next|in) (?:season|the fall|november|december)\b/i,
  /\bopening soon\b/i,
  /\bcountdown to (?:opening|winter|the season)\b/i,
  /\bnot yet open\b/i,
  /\bclosed for (?:the )?summer\b/i,
  /\bwe(?:'|’)?ll see you (?:next|in)\b/i,
];

const RUNS_PATTERNS = [
  /(\d{1,2})\s*(?:of|\/)\s*\d{1,2}\s*(?:runs|trails)\b/i,
  /\bruns?\s*open\s*[:\-]?\s*(\d{1,2})\b/i,
  /\b(\d{1,2})\s*(?:runs|trails)\s+open\b/i,
];

const ANNOUNCED =
  /\b(?:we open|opening day|opening|opens)\b[^.!?]{0,40}?\b(oct|nov|dec|jan)[a-z]*\.?\s+(\d{1,2})\b/i;

// A homepage in October can say "open daily" about go-karts or an alpine slide.
// Require ski context nearby before believing a homepage. Conditions pages are
// already scoped to the ski operation and need no such guard.
const SKI_CONTEXT = /(ski|snowboard|ride|lift|chair|snow|slope|hill|terrain park|tubing|runs|trails)/i;
const CONTEXT_WINDOW = 160;

const snippet = (text, index, length) =>
  text.slice(Math.max(0, index - 80), index + length + 80).trim();

function findFirst(text, patterns, { requireSkiContext }) {
  for (const re of patterns) {
    const m = re.exec(text);
    if (!m) continue;
    if (requireSkiContext) {
      const around = text.slice(
        Math.max(0, m.index - CONTEXT_WINDOW),
        m.index + m[0].length + CONTEXT_WINDOW,
      );
      if (!SKI_CONTEXT.test(around)) continue;
    }
    return { evidence: snippet(text, m.index, m[0].length), match: m };
  }
  return null;
}

function findRuns(text) {
  for (const re of RUNS_PATTERNS) {
    const m = re.exec(text);
    if (m) return { open: Number(m[1]), evidence: snippet(text, m.index, m[0].length) };
  }
  return null;
}

function findAnnounced(text) {
  const m = ANNOUNCED.exec(text);
  if (!m) return null;
  return {
    month: m[1].toLowerCase().slice(0, 3),
    day: Number(m[2]),
    evidence: snippet(text, m.index, m[0].length),
  };
}

export function classify(text, { kind = "homepage" } = {}) {
  const guard = { requireSkiContext: kind === "homepage" };
  const runs = findRuns(text);
  const announcedOpening = findAnnounced(text);

  // A nonzero runs count is the strongest signal available and outranks prose.
  if (runs && runs.open > 0) {
    return { state: "OPEN", evidence: runs.evidence, runsOpen: runs.open, announcedOpening: null };
  }

  const open = findFirst(text, OPEN_PATTERNS, guard);
  if (open) {
    return { state: "OPEN", evidence: open.evidence, runsOpen: runs?.open ?? null, announcedOpening: null };
  }

  if (runs && runs.open === 0) {
    return { state: "CLOSED", evidence: runs.evidence, runsOpen: 0, announcedOpening };
  }

  const closed = findFirst(text, CLOSED_PATTERNS, guard);
  if (closed) {
    return { state: "CLOSED", evidence: closed.evidence, runsOpen: null, announcedOpening };
  }

  // "WE OPEN FRIDAY NOV 15" is a closed page carrying a more precise date than
  // any bracket around it will have.
  if (announcedOpening) {
    return { state: "CLOSED", evidence: announcedOpening.evidence, runsOpen: null, announcedOpening };
  }

  return { state: "NO-SIGNAL", evidence: null, runsOpen: null, announcedOpening: null };
}
```

- [ ] **Step 2: Run it against the four Wild Mountain captures that motivated the rule**

```bash
node -e '
import { capture, visibleText } from "./scripts/lib/cdx.mjs";
import { classify } from "./scripts/lib/classify.mjs";
for (const ts of ["20241109214718","20241119052354","20241126022849","20241208180910"]) {
  const text = visibleText(await capture(ts, "https://wildmountain.com/"));
  const c = classify(text, { kind: "homepage" });
  console.log(ts, c.state.padEnd(10), (c.evidence ?? "").slice(0, 90));
}
' --input-type=module
```

Expected: the first three print `NO-SIGNAL`, and `20241208180910` prints `OPEN` with evidence containing "OPEN DAILY". If any of the November captures classify as `CLOSED`, the rule has been violated — fix the classifier, not the expectation.

- [ ] **Step 3: Commit**

```bash
git add scripts/lib/classify.mjs
git commit -m "Add page classifier that asserts state only on explicit evidence"
```

---

### Task 5: The Wayback sweep

**Files:**
- Create: `scripts/wayback.mjs`
- Create (output): `data/raw/wayback.json`

**Interfaces:**
- Consumes: `data/resorts.json`, `data/sources.json`, `captures`/`capture`/`visibleText`/`looksBinary` from `scripts/lib/cdx.mjs`, `classify` from `scripts/lib/classify.mjs`.
- Produces: `data/raw/wayback.json`, shaped `{ [slug]: { [season]: { timeline: Array<{date, url, kind, state, evidence, runsOpen, announcedOpening}>, firstOpen, lastClosedBefore, lastOpen, firstClosedAfter, fetchErrors } } }`. `season` is `"2021-22"` etc. Dates are `YYYY-MM-DD`.

- [ ] **Step 1: Write the sweep**

```js
// Sweeps each resort's homepage and conditions pages across five seasons and
// records what each archived capture said. Writes observations only; deciding
// what they mean is reconcile.mjs's job.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { captures, capture, visibleText, looksBinary } from "./lib/cdx.mjs";
import { classify } from "./lib/classify.mjs";

const SEASONS = ["2021-22", "2022-23", "2023-24", "2024-25", "2025-26"];
const startYear = season => Number(season.slice(0, 4));
const isoDate = ts => `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;

const resorts = JSON.parse(readFileSync("data/resorts.json", "utf8"));
const sources = JSON.parse(readFileSync("data/sources.json", "utf8"));

mkdirSync("data/raw", { recursive: true });

const out = {};
for (const slug of Object.keys(resorts)) {
  const { homepages, conditions } = sources[slug];
  const urls = [
    ...homepages.map(url => ({ url, kind: "homepage" })),
    ...conditions.map(url => ({ url, kind: "conditions" })),
  ];
  out[slug] = {};

  for (const season of SEASONS) {
    const y = startYear(season);
    const timeline = [];
    let fetchErrors = 0;

    for (const { url, kind } of urls) {
      const rows = await captures(url, { from: `${y}1001`, to: `${y + 1}0430` });
      for (const { timestamp } of rows) {
        const html = await capture(timestamp, url);
        const text = html ? visibleText(html) : null;
        if (!text || looksBinary(text)) { fetchErrors++; continue; }

        const c = classify(text, { kind });
        if (c.state === "NO-SIGNAL" && !c.announcedOpening) continue;
        timeline.push({ date: isoDate(timestamp), url, kind, ...c });
      }
    }

    timeline.sort((a, b) => a.date.localeCompare(b.date));

    // Conditions pages outrank homepages on the same day: a homepage running a
    // gift-card banner is not evidence against a conditions page reporting runs.
    const opens = timeline.filter(t => t.state === "OPEN");
    const closes = timeline.filter(t => t.state === "CLOSED");
    const firstOpen = opens[0]?.date ?? null;
    const lastOpen = opens.at(-1)?.date ?? null;

    out[slug][season] = {
      timeline,
      firstOpen,
      lastClosedBefore: firstOpen
        ? (closes.filter(t => t.date < firstOpen).at(-1)?.date ?? null)
        : (closes.at(-1)?.date ?? null),
      lastOpen,
      firstClosedAfter: lastOpen
        ? (closes.find(t => t.date > lastOpen)?.date ?? null)
        : null,
      fetchErrors,
    };

    const s = out[slug][season];
    console.error(
      `${slug.padEnd(20)} ${season}  captures:${String(timeline.length).padStart(3)}` +
      `  open:${s.firstOpen ?? "--"}  prevClosed:${s.lastClosedBefore ?? "--"}` +
      (fetchErrors ? `  ERRORS:${fetchErrors}` : ""),
    );
  }
}

writeFileSync("data/raw/wayback.json", JSON.stringify(out, null, 2) + "\n");
```

- [ ] **Step 2: Run one resort first to check the shape before committing an hour**

The sweep honours an `ONLY` environment variable so a single resort can be tried
without touching the data files. Add this line to `scripts/wayback.mjs` just after
the two `JSON.parse` calls, and use it in the resort loop:

```js
const ONLY = process.env.ONLY;   // ONLY=wild-mountain node scripts/wayback.mjs
```

```js
for (const slug of Object.keys(resorts)) {
  if (ONLY && slug !== ONLY) continue;
```

Then:

```bash
ONLY=wild-mountain node scripts/wayback.mjs
node -e 'console.log(JSON.stringify(JSON.parse(require("fs").readFileSync("data/raw/wayback.json","utf8"))["wild-mountain"]["2024-25"], null, 2))'
```

Note that an `ONLY` run writes a `data/raw/wayback.json` containing just that
resort. That is fine — Step 3's full run overwrites it.

Expected: a `2024-25` entry whose `timeline` holds a handful of dated observations and whose `firstOpen` and `lastClosedBefore` bracket a plausible opening. `fetchErrors` should be 0 or very low; anything higher means the compression handling in `cdx.mjs` is broken.

- [ ] **Step 3: Run the full sweep**

```bash
time node scripts/wayback.mjs 2>&1 | tee /tmp/sweep.log
```

Expected: roughly 16 resorts × 5 seasons of progress lines. The first run fetches on the order of a few thousand captures at 250 ms apiece, so budget 30–60 minutes; every rerun is instant off the cache. Watch for `ERRORS:` in the output.

- [ ] **Step 4: Read the coverage summary before trusting any of it**

```bash
node -e '
const w = JSON.parse(require("fs").readFileSync("data/raw/wayback.json","utf8"));
let both = 0, oneSided = 0, none = 0;
for (const [slug, seasons] of Object.entries(w)) {
  const cells = Object.entries(seasons).map(([s, v]) => {
    if (v.firstOpen && v.lastClosedBefore) { both++; return "["+v.lastClosedBefore.slice(5)+">"+v.firstOpen.slice(5)+"]"; }
    if (v.firstOpen) { oneSided++; return "<="+v.firstOpen.slice(5); }
    none++; return "--";
  });
  console.log(slug.padEnd(20), cells.join("  "));
}
console.log("\nbracketed:", both, " one-sided:", oneSided, " nothing:", none);
'
```

Expected: most cells bracketed or one-sided. Coffee Mill will be mostly `--`. This printout is the input to the Facebook pass — the `--` and one-sided cells are what it has to resolve.

- [ ] **Step 5: Commit**

```bash
git add scripts/wayback.mjs data/raw/wayback.json
git commit -m "Sweep archived resort pages for open/closed observations"
```

---

### Task 6: The Facebook pass

**Files:**
- Create: `docs/social-pass.md` (the procedure)
- Create (output): `data/raw/social.json`
- Modify: `data/resorts.json` (fill `social` and `colors`)

**Interfaces:**
- Consumes: the coverage summary printed in Task 5 Step 4 — the unresolved cells are the worklist.
- Produces: `data/raw/social.json`, shaped `{ [slug]: { [season]: { firstLift?: Obs, fullOps?: Obs, close?: Obs } } }` where `Obs` is `{ date, url, evidence, platform }`. `date` is `YYYY-MM-DD`, `platform` is `"facebook" | "instagram" | "site-news"`.

This is a human-in-the-loop browser pass, not a script. It runs **after** the sweep so it is confirming a known window per hill rather than hunting a season.

- [ ] **Step 1: Write the procedure document**

Create `docs/social-pass.md` containing:

```markdown
# The social pass

Run after `scripts/wayback.mjs`. Print the coverage summary first (Task 5,
Step 4) — the one-sided and empty cells are the worklist, and the bracketed
cells only need a date pinned inside a known window.

For each resort, in worklist order:

1. Open the resort's Facebook page in Chrome. Prefer Facebook over Instagram:
   the resorts cross-post the same announcements, and Facebook shows a visible
   date and greppable text where Instagram bakes "OPENING FRIDAY" into a
   graphic with an emoji caption and offers no date navigation.
2. If the resort keeps a news or blog archive on its own site, use that first —
   it is easier than either platform.
3. Scroll to the season's November. Look for the announcement post: "WE OPEN
   SATURDAY", "WE'RE OPEN", "opening day", "first chair".
4. Record three things per season where they exist:
   - `firstLift` — the first day of public lift-served skiing, however small.
     One run, one rope tow, a Friday night park session all count.
   - `fullOps` — the day the hill was meaningfully open: main chair plus most
     runs. Often a separate later post.
   - `close` — the last day of the season.
5. For each, capture the permalink as `url` and the post's own words as
   `evidence`. The evidence field is what makes the date checkable later.
6. While on the page, fill the resort's `social.facebook`, `social.instagram`,
   and `colors` (primary and secondary, sampled from their logo or site) into
   `data/resorts.json`.

Do not guess. A season with no findable post is left absent, and the Wayback
bracket stands alone. An absent entry is a better outcome than an invented one.
```

- [ ] **Step 2: Run the pass and write observations**

Work through the worklist with the browser. Write `data/raw/social.json` as you go:

```json
{
  "wild-mountain": {
    "2024-25": {
      "firstLift": {
        "date": "2024-11-29",
        "url": "https://www.facebook.com/wildmountainski/posts/…",
        "evidence": "WE ARE OPEN! Lifts spinning 10am, 3 runs top to bottom.",
        "platform": "facebook"
      },
      "fullOps": {
        "date": "2024-12-14",
        "url": "https://www.facebook.com/wildmountainski/posts/…",
        "evidence": "All chairs turning, 25 of 25 runs open.",
        "platform": "facebook"
      }
    }
  }
}
```

- [ ] **Step 3: Check the file parses and covers what you think it covers**

```bash
node -e '
const s = JSON.parse(require("fs").readFileSync("data/raw/social.json","utf8"));
let n = 0;
for (const [slug, seasons] of Object.entries(s))
  for (const [season, ev] of Object.entries(seasons))
    for (const [k, o] of Object.entries(ev)) {
      n++;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(o.date)) console.log("BAD DATE", slug, season, k, o.date);
      if (!o.url || !o.evidence) console.log("MISSING PROVENANCE", slug, season, k);
    }
console.log(n, "observations");
'
```

Expected: a count, and no `BAD DATE` or `MISSING PROVENANCE` lines.

- [ ] **Step 4: Commit**

```bash
git add docs/social-pass.md data/raw/social.json data/resorts.json
git commit -m "Add social pass procedure, observations, and resort socials/colors"
```

---

### Task 7: The reconciler

**Files:**
- Create: `scripts/reconcile.mjs`
- Create: `data/overrides.json` (starts as `{}`)
- Create (output): `data/seasons.json`

**Interfaces:**
- Consumes: `data/resorts.json`, `data/raw/wayback.json`, `data/raw/social.json`, `data/overrides.json`.
- Produces: `data/seasons.json`, shaped `{ [slug]: { [season]: { firstLift: Event, fullOps: Event, close: Event } } }` where `Event` is `{ date, precision, range?, corroboration, note?, sources: Array<{kind, url, evidence}> }`. `precision` is `"exact" | "bracket"`. `corroboration` is `"confirmed" | "single" | "conflict" | "unknown"`. `kind` is `"wayback" | "social" | "announced" | "local"`.

- [ ] **Step 1: Create the empty overrides file**

```bash
echo '{}' > data/overrides.json
```

Its shape mirrors `data/raw/social.json`, plus a `note` used as the source evidence:

```json
{
  "andes-tower-hills": {
    "2024-25": {
      "firstLift": { "date": "2024-11-22", "note": "I was there. Two runs off the main chair." }
    }
  }
}
```

- [ ] **Step 2: Write the reconciler**

```js
// Cross-references the Wayback sweep against the social pass and produces the
// reconciled truth. Never averages a disagreement — a conflict is a recorded
// state that a human resolves in data/overrides.json.

import { readFileSync, writeFileSync } from "node:fs";

const SEASONS = ["2021-22", "2022-23", "2023-24", "2024-25", "2025-26"];
const MONTHS = { oct: 10, nov: 11, dec: 12, jan: 1 };

const read = f => JSON.parse(readFileSync(f, "utf8"));
const resorts = read("data/resorts.json");
const wayback = read("data/raw/wayback.json");
const social = read("data/raw/social.json");
const overrides = read("data/overrides.json");

const empty = () => ({ date: null, precision: null, corroboration: "unknown", sources: [] });

// An announced date ("WE OPEN NOV 15") belongs to the season it falls in, not
// necessarily the calendar year of the capture that carried it.
function announcedDate(hint, season) {
  if (!hint || !MONTHS[hint.month]) return null;
  const m = MONTHS[hint.month];
  const year = m === 1 ? Number(season.slice(0, 4)) + 1 : Number(season.slice(0, 4));
  return `${year}-${String(m).padStart(2, "0")}-${String(hint.day).padStart(2, "0")}`;
}

function inRange(date, start, end) {
  if (!date || !end) return false;
  if (date > end) return false;
  return !start || date > start;
}

function reconcileFirstLift(slug, season) {
  const wb = wayback[slug]?.[season];
  const soc = social[slug]?.[season]?.firstLift;
  const ovr = overrides[slug]?.[season]?.firstLift;

  const sources = [];
  const start = wb?.lastClosedBefore ?? null;   // exclusive lower bound
  const end = wb?.firstOpen ?? null;            // inclusive upper bound

  if (end) {
    const cap = wb.timeline.find(t => t.date === end && t.state === "OPEN");
    sources.push({
      kind: "wayback", url: cap?.url ?? null,
      evidence: `open by ${end}` + (start ? `, closed on ${start}` : ", no prior closed capture"),
    });
  }

  // The most precise Wayback signal is often a pre-season page announcing a date.
  const hint = wb?.timeline
    .filter(t => t.announcedOpening)
    .map(t => ({ date: announcedDate(t.announcedOpening, season), t }))
    .filter(h => h.date && inRange(h.date, start, end))
    .at(-1);
  if (hint) sources.push({ kind: "announced", url: hint.t.url, evidence: hint.t.announcedOpening.evidence });

  if (soc) sources.push({ kind: "social", url: soc.url, evidence: soc.evidence });
  if (ovr) sources.push({ kind: "local", url: null, evidence: ovr.note });

  // An override is the author's own knowledge and outranks everything.
  if (ovr) {
    const agrees = inRange(ovr.date, start, end) || ovr.date === soc?.date;
    return {
      date: ovr.date, precision: "exact",
      corroboration: agrees && sources.length > 1 ? "confirmed" : "single",
      note: ovr.note, sources,
    };
  }

  if (soc && end) {
    return inRange(soc.date, start, end)
      ? { date: soc.date, precision: "exact", corroboration: "confirmed", sources }
      : {
          date: soc.date, precision: "exact", corroboration: "conflict",
          note: `social says ${soc.date}; archive bracket is ${start ?? "?"}..${end}`,
          sources,
        };
  }

  if (soc) return { date: soc.date, precision: "exact", corroboration: "single", sources };

  if (end && hint) {
    return { date: hint.date, precision: "exact", corroboration: "single",
             note: "from an announced opening date on a pre-season page", sources };
  }

  if (end) {
    return {
      date: end, precision: "bracket",
      range: [start ? nextDay(start) : null, end],
      corroboration: "single",
      note: start ? null : "one-sided: no closed capture before the first open one",
      sources,
    };
  }

  return empty();
}

const nextDay = d => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
};

// fullOps is proposed only where the runs-open counts are unambiguous; the rest
// is queued for the author. Threshold is 60% of the most runs that resort has
// ever been observed reporting, which stands in for a peak-runs figure we do
// not otherwise have.
function reconcileFullOps(slug, season) {
  const soc = social[slug]?.[season]?.fullOps;
  const ovr = overrides[slug]?.[season]?.fullOps;
  if (ovr) return { date: ovr.date, precision: "exact", corroboration: "single", note: ovr.note,
                    sources: [{ kind: "local", url: null, evidence: ovr.note }] };
  if (soc) return { date: soc.date, precision: "exact", corroboration: "single",
                    sources: [{ kind: "social", url: soc.url, evidence: soc.evidence }] };

  const all = Object.values(wayback[slug] ?? {}).flatMap(s => s.timeline);
  const peak = Math.max(0, ...all.map(t => t.runsOpen ?? 0));
  if (peak < 4) return empty();

  const hit = (wayback[slug]?.[season]?.timeline ?? [])
    .filter(t => (t.runsOpen ?? 0) >= peak * 0.6)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  if (!hit) return empty();

  return {
    date: hit.date, precision: "bracket", range: [null, hit.date], corroboration: "single",
    note: `first capture reporting ${hit.runsOpen} runs, against a peak of ${peak}`,
    sources: [{ kind: "wayback", url: hit.url, evidence: hit.evidence }],
  };
}

function reconcileClose(slug, season) {
  const wb = wayback[slug]?.[season];
  const soc = social[slug]?.[season]?.close;
  const ovr = overrides[slug]?.[season]?.close;
  if (ovr) return { date: ovr.date, precision: "exact", corroboration: "single", note: ovr.note,
                    sources: [{ kind: "local", url: null, evidence: ovr.note }] };
  if (soc) return { date: soc.date, precision: "exact", corroboration: "single",
                    sources: [{ kind: "social", url: soc.url, evidence: soc.evidence }] };
  if (!wb?.lastOpen) return empty();
  return {
    date: wb.lastOpen, precision: "bracket", range: [wb.lastOpen, wb.firstClosedAfter ?? null],
    corroboration: "single", note: "last capture still reporting open",
    sources: [{ kind: "wayback", url: null, evidence: `open on ${wb.lastOpen}` }],
  };
}

const out = {};
for (const slug of Object.keys(resorts)) {
  out[slug] = {};
  for (const season of SEASONS) {
    out[slug][season] = {
      firstLift: reconcileFirstLift(slug, season),
      fullOps: reconcileFullOps(slug, season),
      close: reconcileClose(slug, season),
    };
  }
}

writeFileSync("data/seasons.json", JSON.stringify(out, null, 2) + "\n");
console.error("wrote data/seasons.json");
```

- [ ] **Step 3: Run it and read a resort you know**

```bash
node scripts/reconcile.mjs
node -e 'console.log(JSON.stringify(JSON.parse(require("fs").readFileSync("data/seasons.json","utf8"))["wild-mountain"], null, 2))'
```

Expected: five seasons, each with `firstLift` carrying a date, a `precision`, a `corroboration`, and at least one source with real evidence text.

- [ ] **Step 4: Commit**

```bash
git add scripts/reconcile.mjs data/overrides.json data/seasons.json
git commit -m "Reconcile archive brackets against social observations"
```

---

### Task 8: The review report

**Files:**
- Create: `scripts/review.mjs`

**Interfaces:**
- Consumes: `data/resorts.json`, `data/seasons.json`.
- Produces: a printed worklist. No file output.

- [ ] **Step 1: Write the report**

```js
// Prints everything unresolved: conflicts first, then seasons with no date at
// all, then dates resting on a single source or a wide bracket. This is the
// adjudication worklist.

import { readFileSync } from "node:fs";

const resorts = JSON.parse(readFileSync("data/resorts.json", "utf8"));
const seasons = JSON.parse(readFileSync("data/seasons.json", "utf8"));

const width = (r) => (r?.range?.[0] && r?.range?.[1])
  ? Math.round((new Date(r.range[1]) - new Date(r.range[0])) / 86400000)
  : null;

const buckets = { conflict: [], unknown: [], wide: [], single: [], confirmed: [] };

for (const [slug, byS] of Object.entries(seasons)) {
  for (const [season, ev] of Object.entries(byS)) {
    for (const [event, r] of Object.entries(ev)) {
      const row = { slug, season, event, r };
      if (r.corroboration === "conflict") buckets.conflict.push(row);
      else if (!r.date) buckets.unknown.push(row);
      else if (r.precision === "bracket" && (width(r) ?? 99) > 7) buckets.wide.push(row);
      else if (r.corroboration === "single") buckets.single.push(row);
      else buckets.confirmed.push(row);
    }
  }
}

const show = (title, rows) => {
  if (!rows.length) return;
  console.log(`\n${title}  (${rows.length})`);
  for (const { slug, season, event, r } of rows) {
    const range = r.range ? ` [${r.range[0] ?? "?"}..${r.range[1] ?? "?"}]` : "";
    console.log(`  ${slug.padEnd(20)} ${season}  ${event.padEnd(9)} ${(r.date ?? "--").padEnd(11)}${range}`);
    if (r.note) console.log(`      ${r.note}`);
  }
};

show("CONFLICTS — sources disagree, resolve in data/overrides.json", buckets.conflict);
show("MISSING — no date from any source", buckets.unknown);
show("WIDE — bracket over a week, worth pinning", buckets.wide);
show("SINGLE SOURCE — usable, uncorroborated", buckets.single);

console.log(`\nconfirmed: ${buckets.confirmed.length}` +
  `  single: ${buckets.single.length}  wide: ${buckets.wide.length}` +
  `  missing: ${buckets.unknown.length}  conflicts: ${buckets.conflict.length}`);
console.log(`of ${Object.keys(resorts).length * 5 * 3} possible values`);
```

- [ ] **Step 2: Run it**

```bash
node scripts/review.mjs
```

Expected: a grouped worklist ending in a tally. Conflicts should be few; if there are many, the classifier or the social dates are systematically wrong and that is worth understanding before adjudicating one by one.

- [ ] **Step 3: Commit**

```bash
git add scripts/review.mjs
git commit -m "Add adjudication worklist report"
```

---

### Task 9: Adjudication

**Files:**
- Modify: `data/overrides.json`
- Regenerate: `data/seasons.json`

**Interfaces:**
- Consumes: the Task 8 report.
- Produces: an `overrides.json` that resolves every conflict, and a `seasons.json` the author is willing to publish.

This task is judgment, not code. It is where the author's Twin Cities knowledge beats every scraper in the project.

- [ ] **Step 1: Resolve every conflict**

For each row under `CONFLICTS`, open the sources listed in `seasons.json` and decide. Write the decision into `data/overrides.json` with a `note` explaining it. A conflict left unresolved must not ship.

- [ ] **Step 2: Fill in `fullOps` where the pipeline could not propose one**

Work the `MISSING` rows for `fullOps`. Where neither runs-counts nor a post exists and memory does not serve, leave it missing — an absent date is honest, a guessed one is not.

- [ ] **Step 3: Run the Andes Tower Hills check**

```bash
node -e '
const s = JSON.parse(require("fs").readFileSync("data/seasons.json","utf8"))["andes-tower-hills"];
for (const [season, ev] of Object.entries(s))
  console.log(season, "firstLift:", ev.firstLift.date ?? "--", ev.firstLift.precision ?? "", ev.firstLift.corroboration);
'
```

The current `index.html` projects Andes Tower Hills opening 5 December, and the author believes that is far too late. If the reconciled dates come back agreeing with the author, the pipeline works. If they come back agreeing with the old page, stop and find out why before building anything on top of them.

- [ ] **Step 4: Regenerate and re-review until the worklist is acceptable**

```bash
node scripts/reconcile.mjs && node scripts/review.mjs
```

Expected: zero conflicts, and the author satisfied that the remaining single-source and missing values are honestly labelled rather than wrong.

- [ ] **Step 5: Commit**

```bash
git add data/overrides.json data/seasons.json
git commit -m "Adjudicate conflicts and fill full-operations dates"
```

---

### Task 10: Extract the current projection into data

**Files:**
- Create: `data/projection.json`
- Read for reference: `index.html:352-478`

**Interfaces:**
- Produces: `data/projection.json`, shaped `{ [slug]: { date: "2026-11-08", label: "model" | "target" | "announced" } }`. Task 11 renders the Projected column from it.

The projection column is not recalibrated in this project — that is the next one. But the build cannot render a column whose values live only in hand-typed HTML, so the existing values move into data unchanged. Moving them verbatim also makes the next project's diff show exactly what recalibration changed.

- [ ] **Step 1: Transcribe the current values**

Read the Projected column and its `.rng` label out of `index.html` and write them as ISO dates for the 2026-27 season. From the current table: Wild Mountain `Nov 8 / model`, Trollhaugen `Nov 10 / model`, Hyland Hills `Nov 16 / model`, Afton Alps `Nov 21 / target`, Welch Village `Nov 22 / model`, Buck Hill `Nov 24 / model`, Elm Creek `Dec 6 / model`, Lutsen Mountains `Nov 22 / announced`, Giants Ridge `Nov 24 / target`, Spirit Mountain `Nov 26 / model`, Powder Ridge `Nov 26 / model`, Mount Kato `Nov 27 / model`, Buena Vista `Nov 28 / model`, Detroit Mountain `Dec 3 / model`, Andes Tower Hills `Dec 5 / model`, Coffee Mill `Dec 10 / model`.

```json
{
  "wild-mountain":  { "date": "2026-11-08", "label": "model" },
  "trollhaugen":    { "date": "2026-11-10", "label": "model" },
  "afton-alps":     { "date": "2026-11-21", "label": "target" }
}
```

- [ ] **Step 2: Check every resort is covered**

```bash
node -e '
const fs = require("fs");
const r = Object.keys(JSON.parse(fs.readFileSync("data/resorts.json","utf8")));
const p = JSON.parse(fs.readFileSync("data/projection.json","utf8"));
const missing = r.filter(s => !p[s]);
console.log(missing.length ? "MISSING: " + missing.join(", ") : "all 16 covered");
'
```

Expected: `all 16 covered`.

- [ ] **Step 3: Commit**

```bash
git add data/projection.json
git commit -m "Move projection values out of index.html into data"
```

---

### Task 11: The build

**Files:**
- Create: `templates/index.html` (from the current `index.html`)
- Create: `templates/resort.html`
- Create: `scripts/build.mjs`
- Regenerate: `index.html`
- Create (output): `resorts/<slug>.html`

**Interfaces:**
- Consumes: `data/resorts.json`, `data/seasons.json`, `data/projection.json`, `data/hours.json`.
- Produces: static `index.html` and `resorts/*.html`, both committed.

**One deliberate deviation from "reproduce the table as it looks today":** the hill name in the table now links to its local resort page rather than straight out to the resort's website, and the resort page carries the outbound link. Resort pages that nothing links to would be dead weight.

- [ ] **Step 1: Turn the current page into a template**

```bash
mkdir -p templates resorts
cp index.html templates/index.html
```

Then edit `templates/index.html`, replacing generated regions with tokens and leaving all styling untouched:

- Replace everything between `<tbody>` and `</tbody>` in the hill table with `<!--{{TABLE}}-->`.
- In the hero, replace `77` (inside `<span class="count-num">`) with `<!--{{HERO_DAYS}}-->`.
- In the hero, replace `Wild Mountain` inside `<p class="hero-say"><b>…</b>` with `<!--{{HERO_LEADER}}-->`.
- In the hero `<dl class="stats">`, replace the `Typical opening`, `Earliest ever`, and `Latest ever` values (`Nov 8`, `Oct 26`, `Nov 28`) with `<!--{{HERO_TYPICAL}}-->`, `<!--{{HERO_EARLIEST}}-->`, `<!--{{HERO_LATEST}}-->`. Leave `Guns can first run` alone — it comes from the climatology, not from opening dates.
- In the footer, replace `<span>Opening dates are placeholders.</span>` with `<span><!--{{FOOTER_PROVENANCE}}--></span>`.

- [ ] **Step 2: Write the resort page template**

Create `templates/resort.html`. Plain and functional — the design pass is the next project. It must reuse the existing stylesheet, so copy the entire `<head>` and the `<style>` block from `templates/index.html` unchanged, then:

```html
<body>
<div class="wrap">
  <p><a href="../index.html">&larr; All hills</a></p>
  <section class="hero">
    <h1><!--{{NAME}}--></h1>
    <p class="hero-sub"><!--{{PLACE}}--> &middot;
      <a href="<!--{{WEBSITE}}-->" target="_blank" rel="noopener">Official site</a>
      <!--{{SOCIAL_LINKS}}-->
    </p>
    <dl class="stats">
      <div><dt>Typical first day</dt><dd class="lede"><!--{{TYPICAL}}--></dd></div>
      <div><dt>Earliest observed</dt><dd><!--{{EARLIEST}}--></dd></div>
      <div><dt>Latest observed</dt><dd><!--{{LATEST}}--></dd></div>
      <div><dt>Normal snowmaking hours</dt><dd><!--{{HOURS}}--></dd></div>
    </dl>
  </section>
  <section class="sec">
    <h2 class="sec-title">Season by season</h2>
    <p class="sec-note">Every date carries where it came from. A bracket means the
      archive placed it in a window without pinning the day.</p>
    <div class="tbl-box">
      <table>
        <thead><tr><th>Season</th><th>First lift</th><th>Full operations</th><th>Closed</th><th>Source</th></tr></thead>
        <tbody><!--{{SEASONS}}--></tbody>
      </table>
    </div>
  </section>
  <footer><span><!--{{FOOTER_PROVENANCE}}--></span></footer>
</div>
</body>
</html>
```

- [ ] **Step 3: Write the build script**

```js
// Renders index.html and one page per resort from the data files. Plain string
// substitution, no dependencies. Output is committed; GitHub Pages serves the
// repo root.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const read = f => JSON.parse(readFileSync(f, "utf8"));
const resorts = read("data/resorts.json");
const seasons = read("data/seasons.json");
const projection = read("data/projection.json");
const hoursRows = read("data/hours.json");

// data/hours.json keys hills by display name, and one of them is shorter than
// the name in the resort record.
const HOURS_ALIASES = { "lutsen": "lutsen-mountains" };

function slugify(name) {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return HOURS_ALIASES[s] ?? s;
}

const hours = Object.fromEntries(hoursRows.map(h => [slugify(h.hill), h]));

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const pretty = iso => iso ? `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}` : "—";

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

const GROUPS = [["twin-cities", "Twin Cities"], ["greater-minnesota", "Greater Minnesota"]];

function tableRows() {
  const out = [];
  for (const [region, title] of GROUPS) {
    out.push(`<tr class="grp"><td colspan="6">${title}</td></tr>`);
    const slugs = Object.keys(resorts)
      .filter(s => resorts[s].region === region)
      .sort((a, b) => projection[a].date.localeCompare(projection[b].date));

    for (const [i, slug] of slugs.entries()) {
      const r = resorts[slug], p = projection[slug], h = hours[slug], o = observed(slug);
      const cls = region === GROUPS[0][0] && i === 0 ? ' class="first"' : "";
      const typical = o.typical
        ? `${pretty(o.typical)}<span class="rng">${pretty(o.earliest)} &ndash; ${pretty(o.latest)}</span>`
        : `&mdash;<span class="rng">${o.n === 1 ? "one season only" : "no record"}</span>`;

      out.push(
        `<tr${cls}>`,
        `  <td class="hill"><a href="resorts/${slug}.html">${esc(r.name)}</a></td>`,
        `  <td class="where">${esc(r.place)}</td>`,
        `  <td>${pretty(p.date)}<span class="rng">${p.label}</span></td>`,
        `  <td class="num days">${daysUntil(p.date)}</td>`,
        `  <td class="num">${h.normal}<span class="rng">${h.lean}&ndash;${h.fat}</span></td>`,
        `  <td>${typical}</td>`,
        `</tr>`,
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
    const src = ev.firstLift?.sources?.map(s => s.kind).join(", ") || "none";
    return `<tr><td>${season}</td><td>${cell(ev.firstLift)}</td>` +
           `<td>${cell(ev.fullOps)}</td><td>${cell(ev.close)}</td>` +
           `<td class="where">${esc(src)}</td></tr>`;
  }).join("\n");
}

function socialLinks(r) {
  const links = [];
  if (r.social?.facebook) links.push(`<a href="https://facebook.com/${r.social.facebook}" target="_blank" rel="noopener">Facebook</a>`);
  if (r.social?.instagram) links.push(`<a href="https://instagram.com/${r.social.instagram}" target="_blank" rel="noopener">Instagram</a>`);
  return links.length ? " &middot; " + links.join(" &middot; ") : "";
}

const counts = () => {
  const all = Object.values(seasons).flatMap(s => Object.values(s)).map(e => e.firstLift);
  const withDate = all.filter(e => e.date);
  const confirmed = withDate.filter(e => e.corroboration === "confirmed").length;
  return `${withDate.length} opening dates from archived resort pages and their own social posts, ` +
         `${confirmed} corroborated by two independent sources. Every date links its evidence.`;
};

const fill = (tpl, map) =>
  Object.entries(map).reduce((s, [k, v]) => s.replaceAll(`<!--{{${k}}}-->`, v), tpl);

// Homepage
const leader = Object.keys(projection).sort((a, b) => projection[a].date.localeCompare(projection[b].date))[0];
const lead = observed(leader);

let index = fill(readFileSync("templates/index.html", "utf8"), {
  TABLE: tableRows(),
  HERO_DAYS: String(daysUntil(projection[leader].date)),
  HERO_LEADER: esc(resorts[leader].name),
  HERO_TYPICAL: pretty(lead.typical),
  HERO_EARLIEST: pretty(lead.earliest),
  HERO_LATEST: pretty(lead.latest),
  FOOTER_PROVENANCE: counts(),
});
writeFileSync("index.html", index);

// Resort pages
mkdirSync("resorts", { recursive: true });
const resortTpl = readFileSync("templates/resort.html", "utf8");
for (const [slug, r] of Object.entries(resorts)) {
  const o = observed(slug);
  writeFileSync(`resorts/${slug}.html`, fill(resortTpl, {
    NAME: esc(r.name), PLACE: esc(`${r.place}, ${r.state}`), WEBSITE: esc(r.website),
    SOCIAL_LINKS: socialLinks(r),
    TYPICAL: pretty(o.typical), EARLIEST: pretty(o.earliest), LATEST: pretty(o.latest),
    HOURS: String(hours[slug]?.normal ?? "—"),
    SEASONS: seasonRows(slug),
    FOOTER_PROVENANCE: counts(),
  }));
}

console.error(`built index.html and ${Object.keys(resorts).length} resort pages`);
```

`data/hours.json` keys hills by display name. Fifteen of the sixteen slugify
cleanly onto the resort record; `"Lutsen"` does not, because the record calls it
`lutsen-mountains`, which is what `HOURS_ALIASES` exists for. Step 4 verifies the
join rather than assuming it.

- [ ] **Step 4: Build and check nothing silently dropped**

```bash
node scripts/build.mjs
grep -c '{{' index.html resorts/*.html | grep -v ':0' || echo "no unreplaced tokens"
node -e '
const fs = require("fs");
const r = Object.keys(JSON.parse(fs.readFileSync("data/resorts.json","utf8")));
const missing = r.filter(s => !fs.existsSync(`resorts/${s}.html`));
console.log(missing.length ? "MISSING PAGES: " + missing.join(", ") : r.length + " resort pages built");
const idx = fs.readFileSync("index.html","utf8");
console.log("table rows:", (idx.match(/<td class="hill">/g) || []).length);
console.log("em-dash hour cells (join failures):", (idx.match(/<td class="num">—/g) || []).length);
'
```

Expected: `no unreplaced tokens`, `16 resort pages built`, `table rows: 16`, and `0` join failures. A nonzero join-failure count means the `data/hours.json` name-to-slug mapping needs a hand-written alias.

- [ ] **Step 5: Look at it in a browser**

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000/`. Check that the page is visually unchanged apart from the Typical opening column now carrying real dates, and click through to two or three resort pages.

- [ ] **Step 6: Commit**

```bash
git add templates scripts/build.mjs index.html resorts
git commit -m "Render index.html and resort pages from the data"
```

---

### Task 12: Documentation and final check

**Files:**
- Modify: `README.md`
- Modify: `.gitignore`

- [ ] **Step 1: Update `.gitignore`**

`data/cache/` is already ignored, which covers `data/cache/wayback/`. Confirm:

```bash
git check-ignore -v data/cache/wayback/x.html
```

Expected: a line showing the `data/cache/` rule matched.

- [ ] **Step 2: Rewrite the README's data section**

Replace the "Opening dates are still placeholders." line and the regeneration block with:

```markdown
Opening dates come from two independent sources, cross-referenced: archived
resort pages via the Wayback Machine, and the resorts' own Facebook
announcements. Every date records its precision (pinned to a day, or bracketed
to a window) and its corroboration (two sources agreeing, one source alone, or a
conflict a human resolved).

## Data files

Hand-owned, edit freely:

- `data/resorts.json` — identity: names, places, coordinates, websites, socials, colors
- `data/overrides.json` — dates set by hand; always wins, survives every rerun
- `data/sources.json` — which URLs the sweep reads per resort
- `data/projection.json` — the projection column, not yet recalibrated

Generated, never edit:

- `data/raw/wayback.json`, `data/raw/social.json` — what each source observed
- `data/seasons.json` — the reconciled dates
- `index.html`, `resorts/*.html` — the site

## Regenerating

```sh
node scripts/discover.mjs    # find each resort's conditions pages
node scripts/wayback.mjs     # sweep archived pages for open/closed observations
node scripts/reconcile.mjs   # cross-reference sources into data/seasons.json
node scripts/review.mjs      # print what is unresolved
node scripts/build.mjs       # render index.html and resorts/*.html
```

The social pass is a human step between the sweep and the reconcile; see
`docs/social-pass.md`.

Wayback captures cache to `data/cache/wayback/` (gitignored). The first sweep
takes 30–60 minutes; reruns are free.
```

- [ ] **Step 3: Full rebuild from a cold start of the generated files**

```bash
rm -f data/seasons.json index.html resorts/*.html
node scripts/reconcile.mjs && node scripts/build.mjs && node scripts/review.mjs
git status --short
```

Expected: the generated files come back, and `git status` shows them as modified rather than as unexpected new paths.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "Document the data pipeline"
```

---

## What this leaves for the next project

The projection column is still the old model, now sitting in `data/projection.json`
instead of hand-typed HTML — recalibrating it against `data/seasons.json` is the
next piece of work, along with turning the hero into a range. Resort pages exist
but are deliberately plain; `colors` are collected and unused. The author's photos,
the Troll/Wild race feature, and anything outside the current 16 hills are
untouched.
