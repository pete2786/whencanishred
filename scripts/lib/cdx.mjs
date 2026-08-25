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
