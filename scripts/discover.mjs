// Finds each resort's conditions / snow-report / hours pages in the Wayback
// index, so the sweep targets high-signal URLs rather than a hardcoded guess.
// Output is reviewed by hand before the sweep runs.

import { readFileSync, writeFileSync } from "node:fs";
import { captures } from "./lib/cdx.mjs";

const resorts = JSON.parse(readFileSync("data/resorts.json", "utf8"));

// Hand-owned corrections. Discovery is a good first pass but misses resorts
// with no conditions page at all (Detroit Mountain announces openings on dated
// event pages instead) and picks up relative-link artifacts. Keeping these
// separate means rerunning discovery does not wipe them.
const extra = JSON.parse(readFileSync("data/sources-extra.json", "utf8"));

// Strong signals are operational status pages; "hours" alone is weaker and
// matches a lot of marketing. Score them so the strong ones survive the cap.
const STRONG = /(snow-?report|mountain-report|current-conditions|ski-conditions|downhill-conditions|conditions\b|lift-?status|trail-?report|whats-?open)/i;
const WEAK = /(hours-of-operation|hours-rates|hours-and-rates|\/hours\b|hours\.(cfm|aspx|html?)$)/i;
const ASSET = /\.(css|js|jpe?g|png|gif|svg|webp|ico|pdf|woff2?|ttf|mp4|json|xml)(\?|$)/i;
const JUNK = new RegExp([
  "wp-content", "wp-includes", "wp-json", "/feed/?$", "fbclid=", "utm_",
  "/tag/", "/category/", "summer", "/blog/", "/event/", "/dm-events/",
  "/index.php/", "create-account", "terms", "/amp/?$", "layerslider",
  "\\?",                        // any query string is a duplicate of a clean URL
  "/\\d{4}/\\d{2}/\\d{2}/",       // dated blog posts
  "tubing|snowtubing|/tube/",  // tubing hours are a different operation
].join("|"), "i");

// Hyland Hills and Elm Creek both live on threeriversparks.org, so a bare
// domain sweep hands each of them the other's page. When a domain is shared,
// require the resort's own name in the path.
const domainOwners = {};
for (const r of Object.values(resorts)) {
  const d = new URL(r.website).hostname.replace(/^www\./, "");
  domainOwners[d] = (domainOwners[d] ?? 0) + 1;
}
const nameTokens = name => name.toLowerCase().split(/\s+/).filter(w => w.length > 3);

const out = {};
for (const [slug, r] of Object.entries(resorts)) {
  // Sweep former domains too. Coffee Mill moved from coffeemillski.com to
  // cmskiarea.com; its entire archived history lives under the old name.
  const domains = [
    new URL(r.website).hostname.replace(/^www\./, ""),
    ...(r.formerDomains ?? []),
  ];
  // Filter to HTML at the source. Without it the row cap is spent on images and
  // stylesheets long before a snow-report page appears.
  const rows = [];
  for (const d of domains) {
    try {
      rows.push(...await captures(`${d}*`, {
        from: "20211001", to: "20260430", collapse: "urlkey", limit: 20000,
        filters: ["mimetype:text/html"],
      }));
    } catch (e) {
      console.error(`  ! ${d}: ${e.message} — skipped, fill by hand`);
    }
  }

  const shared = domainOwners[domains[0]] > 1;
  const tokens = nameTokens(r.name);

  const seen = new Set();
  const scored = [];
  for (const { original } of rows) {
    if (ASSET.test(original) || JUNK.test(original)) continue;
    const score = STRONG.test(original) ? 3 : WEAK.test(original) ? 1 : 0;
    if (!score) continue;
    if (shared && !tokens.some(t => original.toLowerCase().includes(t))) continue;
    // Normalise away www and trailing slashes so the same page is not swept twice.
    const norm = original.replace(/^https?:\/\/(www\.)?/, "https://").replace(/\/$/, "");
    if (seen.has(norm.toLowerCase())) continue;
    seen.add(norm.toLowerCase());
    scored.push({ norm, score, len: norm.length });
  }
  // Strongest first, then shortest path — the canonical page is rarely the
  // longest one.
  scored.sort((a, b) => b.score - a.score || a.len - b.len);
  const conditions = scored.map(c => c.norm);

  // Former-domain homepages are swept as well, so the old site's own history counts.
  const homepages = [r.website, ...(r.formerDomains ?? []).map(d => `https://${d}/`)];
  const { add = [], drop = [] } = extra[slug] ?? {};
  const dropped = new Set(drop.map(u => u.toLowerCase()));
  const final = [...conditions.filter(c => !dropped.has(c.toLowerCase())).slice(0, 5), ...add];

  out[slug] = { homepages, conditions: final };
  console.error(`${slug.padEnd(20)} ${String(rows.length).padStart(5)} urls -> ${final.length} conditions`);
}

writeFileSync("data/sources.json", JSON.stringify(out, null, 2) + "\n");
