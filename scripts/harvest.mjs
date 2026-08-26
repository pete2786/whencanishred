// Merges one clipboard dump from scripts/harvest-snippet.js into the per-hill
// post store. Append-only and idempotent: re-harvesting an overlapping view
// costs nothing, so the browser rule can be "grab whatever is on screen".
//
//   pbpaste | node scripts/harvest.mjs elm-creek
//   pbpaste | node scripts/harvest.mjs elm-creek --year 2023
//
// --year supplies the year for posts Facebook rendered without one ("December
// 3"), which happens only for the current year. Undated posts are stored with
// a null date rather than a guess.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { classify } from "./lib/classify.mjs";

const MONTHS = ["january","february","march","april","may","june","july",
                "august","september","october","november","december"];

const [slug, ...rest] = process.argv.slice(2);
if (!slug) {
  console.error("usage: pbpaste | node scripts/harvest.mjs <slug> [--year YYYY]");
  process.exit(1);
}
const yearHint = rest.includes("--year") ? rest[rest.indexOf("--year") + 1] : null;

const resorts = JSON.parse(readFileSync("data/resorts.json", "utf8"));
if (!resorts[slug]) {
  console.error(`unknown slug "${slug}". Known: ${Object.keys(resorts).join(", ")}`);
  process.exit(1);
}

const raw = readFileSync(0, "utf8").trim();
if (!raw) {
  console.error("nothing on stdin — did harvest() copy to the clipboard?");
  process.exit(1);
}
let dump;
try {
  dump = JSON.parse(raw);
} catch (e) {
  console.error(`stdin is not JSON (${e.message}). First 80 chars: ${raw.slice(0, 80)}`);
  process.exit(1);
}
const incoming = dump.posts ?? dump;
if (!Array.isArray(incoming)) {
  console.error("expected {posts:[...]} or a bare array");
  process.exit(1);
}

// Facebook wraps each post body in chrome: a "PageName / date / ·" header
// above, and below it the "See less" toggle, bare reaction counts and the whole
// comment thread. Evidence has to be the post's own words, so cut both ends.
function tidy(text) {
  let t = text.replace(/^[^\n]{0,80}\n\s*[A-Z][a-z]+ \d{1,2}, \d{4}\s*\n\s*·\s*\n/, "");
  const toggle = t.search(/^\s*See (less|more)\s*$/m);
  if (toggle > 40) t = t.slice(0, toggle);
  else {
    // Un-truncated posts have no toggle line; reaction counts are bare numbers.
    const counts = t.search(/^\s*\d{1,4}\s*$/m);
    if (counts > 40) t = t.slice(0, counts);
  }
  // The toggle also rides at the end of the last line rather than on its own.
  return t.replace(/\s*See (less|more)\s*$/, "").trim();
}

function normalize(text) {
  if (!text) return null;
  const m = /^([A-Za-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?$/.exec(text.trim());
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].toLowerCase());
  if (month < 0) return null;
  const year = m[3] ?? yearHint;
  if (!year) return null;
  return `${year}-${String(month + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

const path = `data/raw/posts/${slug}.json`;
const store = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};

let added = 0, updated = 0, undated = 0;
for (const p of incoming) {
  if (!p?.id || !p.text) continue;
  const date = normalize(p.date);
  if (!date) undated++;
  const post = { date, url: p.url ?? null, text: tidy(p.text), alt: p.alt ?? [] };
  const prior = store[p.id];
  if (!prior) { store[p.id] = post; added++; continue; }
  // A later pass may carry an expanded body, a date the first pass missed, or
  // alt text Facebook had not generated yet.
  const newAlt = post.alt.some(a => !(prior.alt ?? []).includes(a));
  if (post.text.length > prior.text.length || (post.date && !prior.date) || newAlt) {
    store[p.id] = { ...prior, ...post, date: post.date ?? prior.date,
                     alt: [...new Set([...(prior.alt ?? []), ...post.alt])] };
    updated++;
  }
}

const sorted = Object.fromEntries(
  Object.entries(store).sort(([, a], [, b]) => (a.date ?? "9999").localeCompare(b.date ?? "9999")),
);
mkdirSync("data/raw/posts", { recursive: true });
writeFileSync(path, JSON.stringify(sorted, null, 1) + "\n");

const dates = Object.values(sorted).map(p => p.date).filter(Boolean).sort();
console.log(`${slug}: +${added} new, ${updated} updated, ${undated} undated in this dump`);
console.log(`store now ${Object.keys(sorted).length} posts, ${dates[0] ?? "?"} .. ${dates.at(-1) ?? "?"}`);

// classify.mjs is tuned for website homepages and misses post-shaped language
// ("Downhill ski and snowboard opens at 3pm today" matches none of its
// patterns). The report is therefore recall-first: anything that mentions
// opening near ski context is surfaced, and the judging happens by hand
// against docs/social-pass.md. A tubing post reads exactly like a ski post.
const SKI = /(downhill|ski|snowboard|chairlift|chair lift|rope tow|lift|slope|hill|terrain park|tubing)/i;
const OPENING = /\b(open|opens|opening|opened|first chair|first lift|now spinning|season pass)\b/i;

const scored = Object.values(sorted).map(p => {
  const haystack = [p.text, ...(p.alt ?? [])].join("\n");
  const c = classify(p.text, { kind: "homepage" });
  const mentions = SKI.test(haystack) && OPENING.test(haystack);
  // A hit that appears only in the alt text means the detail is in a graphic.
  const inImage = !(SKI.test(p.text) && OPENING.test(p.text));
  const rank = c.state === "OPEN" ? 0 : c.announcedOpening ? 1 : mentions ? 2 : 3;
  const line = c.evidence ?? (mentions ? (inImage ? (p.alt ?? []).join(" / ") : p.text) : null);
  // An image whose text names a day or an hour is usually the schedule graphic,
  // which is where these hills put the detail the caption leaves out.
  const dated = (p.alt ?? []).filter(a => /\b(mon|tue|wed|thu|fri|sat|sun|jan|feb|mar|oct|nov|dec)[a-z]*\.?\s*\d|\d\s*(am|pm)\b/i.test(a));
  return { ...p, rank, line, inImage: mentions && inImage, dated };
}).filter(p => p.rank < 3);

const LABEL = ["OPEN", "PLAN", "MENT"];
console.log(`\n${scored.length} post(s) worth reading, oldest first (* = signal is in an image, go look):`);
for (const p of scored.sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"))) {
  console.log(`  ${LABEL[p.rank]}${p.inImage ? "*" : " "} ${p.date ?? "????-??-??"}  ${p.line.replace(/\s+/g, " ").slice(0, 120)}`);
  for (const a of p.dated) console.log(`         img: ${a.replace(/\s+/g, " ").slice(0, 110)}`);
}
