// Gathers candidate social handles, brand colors, and former domains for every
// resort. It writes candidates, never the record: data/resorts.json is
// hand-owned, so the winners are transcribed by a human after reading this.
//
//   node scripts/identity.mjs            # probe, write data/raw/identity.json
//   node scripts/identity.mjs --offline  # local cache only, no network
//   node scripts/identity.mjs --report   # print the record next to the evidence
//   node scripts/identity.mjs --page     # write review.html, the whole record in a table
//
// Evidence comes from three places, cheapest first:
//   1. The Wayback captures already on disk from the sweep. Free, and a handle
//      seen on 377 archived pages is about as corroborated as it gets.
//   2. A live fetch of the official site and its stylesheets. Colors only live
//      here; the archive rarely captured the CSS.
//   3. Whatever is left, which a human resolves by hand. Sites that render
//      their footer in JavaScript return a shell to both 1 and 2.

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

const CACHE = "data/cache/wayback";
const OUT = "data/raw/identity.json";
const UA = "whencanishred/1.0 (+https://github.com/pete2786/whencanishred)";

const argv = new Set(process.argv.slice(2));
const OFFLINE = argv.has("--offline");
const REPORT = argv.has("--report");
const PAGE = argv.has("--page");

const resorts = JSON.parse(readFileSync("data/resorts.json", "utf8"));
const sources = existsSync("data/sources.json")
  ? JSON.parse(readFileSync("data/sources.json", "utf8"))
  : {};

// Must match scripts/lib/cdx.mjs, which is what named the files on disk.
const key = s => createHash("sha1").update(s).digest("hex").slice(0, 16);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------- socials

// Facebook and Instagram URLs on a resort's own page are mostly its own
// profile, but not all of them. The tracking pixel posts to facebook.com/tr,
// share widgets point at sharer.php with the page URL attached, and a footer
// "follow us" block sometimes links a specific post rather than the profile.
const NOT_A_PROFILE = new RegExp([
  "^(tr|sharer|share|share\\.php|dialog|plugins|profile\\.php|pages|people|groups)$",
  "^(p|reel|reels|explore|accounts|stories|tv|direct|about|privacy|help|legal)$",
  "^(login|signup|policies|terms|business|developers|settings|hashtag)$",
].join("|"), "i");

function socialsIn(html) {
  const found = {};
  const re = /https?:\/\/(?:[a-z0-9-]+\.)*(facebook|instagram)\.com\/([A-Za-z0-9_.-]{2,})/gi;
  for (const m of html.matchAll(re)) {
    const network = m[1].toLowerCase();
    // Trailing punctuation from href quoting, and a trailing dot from prose.
    const handle = m[2].replace(/[.\-_]+$/, "");
    if (!handle || NOT_A_PROFILE.test(handle)) continue;
    const k = `${network}:${handle.toLowerCase()}`;
    found[k] = (found[k] ?? 0) + 1;
  }
  return found;
}

// ----------------------------------------------------------------- colors

// Neutrals are page furniture — text, rules, shadows, the white behind
// everything. A brand color is the one with some saturation to it.
function isNeutral(hex) {
  const n = parseInt(hex.length === 3 ? hex.replace(/./g, c => c + c) : hex, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === 0) return true;                       // black
  const sat = (max - min) / max;
  return sat < 0.18 || max < 24 || (min > 235 && sat < 0.35);
}

const norm = hex => {
  const h = hex.toLowerCase();
  return "#" + (h.length === 3 ? h.replace(/./g, c => c + c) : h);
};

// A variable named for its framework describes the framework's default, not the
// hill's brand. Buck Hill and Trollhaugen both reported #40d9f1 with over a
// hundred hits — the Modern Events Calendar default, on two unrelated sites.
const FRAMEWORK_VAR = /^--(bs|wp|wp-admin|mec|tec|tribe|swiper|ss|pum|elementor|woocommerce|jetpack|fl|et|astra)-/i;

function colorsIn(css) {
  const out = { declared: {}, frequent: {} };

  // A CSS custom property named for the brand is a stated intent, not a guess,
  // so it outranks anything counted by frequency.
  for (const m of css.matchAll(/--([a-z0-9-]*(?:brand|primary|secondary|accent|main|theme)[a-z0-9-]*)\s*:\s*#([0-9a-f]{3,8})\b/gi)) {
    const name = `--${m[1].toLowerCase()}`;
    if (FRAMEWORK_VAR.test(name)) continue;
    out.declared[name] = norm(m[2].slice(0, 6));
  }

  for (const m of css.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    const hex = norm(m[1]);
    if (isNeutral(m[1])) continue;
    out.frequent[hex] = (out.frequent[hex] ?? 0) + 1;
  }
  return out;
}

function metaColorsIn(html) {
  const out = {};
  for (const m of html.matchAll(/<meta[^>]+>/gi)) {
    const tag = m[0];
    const name = /name\s*=\s*["']?(theme-color|msapplication-TileColor)["']?/i.exec(tag);
    const content = /content\s*=\s*["']?(#[0-9a-fA-F]{3,6})/.exec(tag);
    if (name && content) out[name[1].toLowerCase()] = norm(content[1].slice(1));
  }
  return out;
}

// ------------------------------------------------------------ tier 1: disk

const cacheFiles = existsSync(CACHE) ? readdirSync(CACHE).filter(f => f.endsWith(".html")) : [];

function knownUrls(slug, r) {
  const s = sources[slug] ?? {};
  return [...new Set([r.website, ...(s.homepages ?? []), ...(s.conditions ?? [])])];
}

function fromCache(slug, r) {
  const keys = new Map(knownUrls(slug, r).map(u => [key(u), u]));
  const social = {};
  let pages = 0;
  const seenOn = {};

  for (const file of cacheFiles) {
    const k = file.slice(-21, -5);           // ${timestamp}-${key}.html
    const url = keys.get(k);
    if (!url) continue;
    pages++;
    const html = readFileSync(`${CACHE}/${file}`, "utf8");
    for (const [hit, n] of Object.entries(socialsIn(html))) {
      social[hit] = (social[hit] ?? 0) + n;
      (seenOn[hit] ??= new Set()).add(url);
    }
  }
  return { pages, social, seenOn };
}

// ------------------------------------------------------------ tier 2: live

async function get(url, timeoutMs = 20000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { "user-agent": UA }, signal: ac.signal, redirect: "follow" });
    if (!res.ok) return null;
    return { finalUrl: res.url, body: await res.text() };
  } catch {
    return null;                              // a dead site is a hand-fill, not a crash
  } finally {
    clearTimeout(timer);
  }
}

const host = u => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return null; } };

// Named entities do not appear in hrefs, but `&amp;` does, and Drupal's
// aggregated CSS URLs are full of query parameters that must survive intact.
const decodeEntities = s => s.replace(/&amp;/g, "&").replace(/&#0?38;/g, "&");

// Where a stylesheet lives says how much it knows about the brand. A theme or
// a file the site author named "custom" outranks anything a plugin shipped.
function sheetRank(url) {
  if (/\/(themes?|templates?)\//i.test(url)) return 3;
  if (/(custom|main|style|header|site|brand|theme)[.\-_]?[\w.]*\.css/i.test(url)) return 2;
  if (/\/(plugins?|wp-includes|vendor|packages)\//i.test(url)) return 0;
  return 1;
}

async function fromLive(slug, r) {
  const out = { fetched: null, redirectedTo: null, social: {}, meta: {}, declared: {}, frequent: {}, stylesheets: [] };

  const home = await get(r.website);
  if (!home) return out;
  out.fetched = r.website;
  if (host(home.finalUrl) !== host(r.website)) out.redirectedTo = home.finalUrl;

  Object.assign(out.social, socialsIn(home.body));
  out.meta = metaColorsIn(home.body);

  const inline = [...home.body.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join("\n");
  const acc = colorsIn(inline);

  // Same-origin stylesheets only, ranked before they are capped. Document order
  // puts plugin CSS first on most WordPress sites, so taking the first few by
  // position samples a cookie banner and a lightbox and never reaches the
  // theme. The theme's own stylesheet is the only one that knows the brand.
  const hrefs = [...home.body.matchAll(/<link[^>]+rel\s*=\s*["']?stylesheet["']?[^>]*>/gi)]
    .map(m => /href\s*=\s*["']([^"']+)["']/i.exec(m[0])?.[1])
    .filter(Boolean)
    .map(h => { try { return new URL(decodeEntities(h), home.finalUrl).href; } catch { return null; } })
    .filter(u => u && host(u) === host(home.finalUrl))
    .filter(u => !/(font-?awesome|normalize|reset\.|icon-?fonts|select2|tooltip|lightbox|photoswipe|slick|jquery|mediaelement|cookie|spam|forms?\b)/i.test(u))
    .sort((a, b) => sheetRank(b) - sheetRank(a))
    .slice(0, 5);

  for (const href of hrefs) {
    const sheet = await get(href);
    if (!sheet) continue;
    out.stylesheets.push(href);
    const c = colorsIn(sheet.body);
    Object.assign(acc.declared, c.declared);
    for (const [hex, n] of Object.entries(c.frequent)) acc.frequent[hex] = (acc.frequent[hex] ?? 0) + n;
    await sleep(200);
  }

  out.declared = acc.declared;
  out.frequent = acc.frequent;
  return out;
}

// ------------------------------------------------------------------ probe

function rank(counts) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, hits]) => ({ ...splitHit(k), hits }));
}
const splitHit = k => {
  const [network, handle] = k.split(":");
  return { network, handle };
};

async function probe() {
  const out = {};
  for (const [slug, r] of Object.entries(resorts)) {
    process.stderr.write(`${slug}\n`);
    const cached = fromCache(slug, r);
    const live = OFFLINE ? { fetched: null, redirectedTo: null, social: {}, meta: {}, declared: {}, frequent: {}, stylesheets: [] }
                         : await fromLive(slug, r);

    const merged = { ...cached.social };
    for (const [k, n] of Object.entries(live.social)) merged[k] = (merged[k] ?? 0) + n;

    out[slug] = {
      archivedPages: cached.pages,
      liveFetched: live.fetched,
      redirectedTo: live.redirectedTo,
      social: {
        facebook: rank(merged).filter(c => c.network === "facebook"),
        instagram: rank(merged).filter(c => c.network === "instagram"),
        fromArchiveOnly: Object.keys(cached.social).filter(k => !(k in live.social)),
        fromLiveOnly: Object.keys(live.social).filter(k => !(k in cached.social)),
      },
      colors: {
        meta: live.meta,
        declared: live.declared,
        frequent: Object.entries(live.frequent).sort((a, b) => b[1] - a[1]).slice(0, 8)
          .map(([hex, hits]) => ({ hex, hits })),
        stylesheets: live.stylesheets,
      },
      // A redirect off the recorded domain is the strongest evidence of a move.
      formerDomainHints: [...new Set([
        ...(live.redirectedTo && host(live.redirectedTo) !== host(r.website) ? [host(r.website)] : []),
        ...knownUrls(slug, r).map(host).filter(h => h && h !== host(r.website)),
      ])],
    };
    if (!OFFLINE) await sleep(500);
  }
  // Without this the report cannot tell "the site linked nothing" from "nobody
  // asked the site", and an --offline run reads as sixteen dead websites.
  out._probe = { offline: OFFLINE };
  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`\nwrote ${OUT}`);
}

// ----------------------------------------------------------------- report

function report() {
  if (!existsSync(OUT)) {
    console.error(`no ${OUT} yet — run: node scripts/identity.mjs`);
    process.exit(1);
  }
  const eviAll = JSON.parse(readFileSync(OUT, "utf8"));
  const pad = (s, n) => String(s ?? "").padEnd(n).slice(0, n);
  let gaps = 0;

  console.log(pad("resort", 19), pad("facebook", 26), pad("instagram", 22), pad("primary", 9), pad("second", 9), pad("colours", 7), "former");
  console.log("-".repeat(100));
  for (const [slug, r] of Object.entries(resorts)) {
    const e = eviAll[slug] ?? {};
    const mark = (val, cands) => {
      if (val) return val;
      gaps++;
      const top = cands?.[0];
      return top ? `? ${top.handle} (${top.hits})` : "? none";
    };
    const fb = mark(r.social?.facebook, e.social?.facebook);
    const ig = mark(r.social?.instagram, e.social?.instagram);
    const p = r.colors?.primary ?? "?";
    const s = r.colors?.secondary ?? "?";
    if (!r.colors?.primary) gaps++;
    if (!r.colors?.secondary) gaps++;
    const lock = r.colors?.source === "manual" ? "locked" : "";
    console.log(pad(slug, 19), pad(fb, 26), pad(ig, 22), pad(p, 9), pad(s, 9), pad(lock, 7), (r.formerDomains ?? []).join(",") || "-");
  }
  console.log("-".repeat(100));
  console.log(`${gaps} field(s) still unfilled. "?" is a candidate from the probe, not a recorded value.`);

  const locked = Object.entries(resorts).filter(([, r]) => r.colors?.source === "manual");
  if (locked.length) {
    console.log(`\ncolours set by hand, never from the probe — leave them alone:`);
    for (const [slug, r] of locked) console.log(`  ${pad(slug, 19)} ${r.colors.note}`);
  }

  if (eviAll._probe?.offline) {
    console.log("evidence came from an --offline run: only the hills already in the capture cache were looked at.");
    return;
  }
  const thin = Object.entries(eviAll)
    .filter(([s]) => s in resorts)
    .filter(([, e]) => !e.archivedPages && !e.liveFetched);
  if (thin.length) console.log(`no evidence at all for: ${thin.map(([s]) => s).join(", ")}`);
}

// ------------------------------------------------------------------- page

// A hex is unreadable and a handle is unverifiable as text. The page exists so
// both can be judged at a glance: colors as swatches, handles as live links,
// and every gap loud enough to find without hunting.
const PAGE_OUT = "review.html";
const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function page() {
  const evi = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
  const seasons = existsSync("data/seasons.json")
    ? JSON.parse(readFileSync("data/seasons.json", "utf8"))
    : {};

  let filled = 0, total = 0;
  const cell = v => { total++; if (v) filled++; return v; };

  const rows = Object.entries(resorts).map(([slug, r]) => {
    const e = evi[slug] ?? {};
    const fb = cell(r.social?.facebook), ig = cell(r.social?.instagram);
    const p = cell(r.colors?.primary), s2 = cell(r.colors?.secondary);

    const gap = label => `<span class="gap">${label}</span>`;
    const link = (href, text) => `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(text)}</a>`;
    const swatch = hex => hex
      ? `<span class="sw" style="background:${esc(hex)}"></span><code>${esc(hex)}</code>`
      : gap("none");

    // Colors set by hand outrank anything the probe can find, and three hills
    // take their identity from terrain park paint rather than their website.
    // Rerunning the probe must never look like it disagrees with them.
    const locked = r.colors?.source === "manual";

    // Any candidate the probe saw but the record did not take. This is the
    // column that catches a wrong handle: if the archive saw something else a
    // hundred times, it says so right next to the value.
    const others = ["facebook", "instagram"].flatMap(net =>
      (e.social?.[net] ?? [])
        .filter(c => c.handle.toLowerCase() !== String(r.social?.[net] ?? "").toLowerCase())
        .map(c => `${net[0]}/${c.handle} ×${c.hits}`));

    const sn = seasons[slug] ?? {};
    const withDate = Object.values(sn).filter(x => x.firstLift?.date).length;

    return `<tr>
  <td class="hill"><b>${esc(r.name)}</b><span class="slug">${esc(slug)}</span></td>
  <td>${esc(r.place)}, ${esc(r.state)}<span class="slug">${esc(r.region)}</span></td>
  <td class="num">${r.lat}, ${r.lon}</td>
  <td>${link(r.website, new URL(r.website).hostname.replace(/^www\./, ""))}</td>
  <td>${(r.formerDomains ?? []).map(esc).join("<br>") || "&mdash;"}</td>
  <td>${fb ? link(`https://facebook.com/${fb}`, fb) : gap("none")}</td>
  <td>${ig ? link(`https://instagram.com/${ig}`, ig) : gap("none")}</td>
  <td class="cols">${swatch(p)}<br>${swatch(s2)}
      ${locked ? `<span class="lock" title="${esc(r.colors.note ?? "")}">&#128274; manual &mdash; do not update</span>` : ""}</td>
  <td class="num">${r.photos?.length ? r.photos.length : gap("0")}</td>
  <td class="num">${withDate ? `${withDate}/${Object.keys(sn).length}`
                              : gap(`0/${Object.keys(sn).length || 0}`)}</td>
  <td class="evi">${e.archivedPages ?? 0} archived${e.liveFetched ? "" : ", <b>site not reachable</b>"}
      ${others.length ? `<span class="alt">also seen: ${esc(others.join(", "))}</span>` : ""}
      ${locked ? `<span class="alt">${esc(r.colors.note)}</span>` : ""}</td>
</tr>`;
  }).join("\n");

  const stamp = evi._probe?.offline ? "an --offline probe (cache only)" : "a full probe";
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Resort record &middot; review</title>
<style>
  :root {
    --ground:#EDF1F5; --surface:#FFFFFF; --surface-2:#E2E9F0;
    --line:#C7D3DF; --line-soft:#DCE4EC;
    --ink:#10171F; --ink-2:#46596E; --ink-3:#6E8298;
    --accent:#B4610E; --warm:#A8402B;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --ground:#0B1017; --surface:#131A24; --surface-2:#1B2431;
      --line:#2A3646; --line-soft:#202B39;
      --ink:#E8EEF4; --ink-2:#A6B6C8; --ink-3:#7C8B9E;
      --accent:#F2A65A; --warm:#E07257;
    }
  }
  * { box-sizing:border-box; }
  body {
    margin:0; padding:28px 24px 80px; background:var(--ground); color:var(--ink);
    font-family:Archivo,"Helvetica Neue",Arial,sans-serif; font-size:15px; line-height:1.5;
  }
  h1 { font-family:Georgia,serif; font-size:28px; font-weight:400; margin:0 0 6px; }
  .sub { color:var(--ink-2); font-size:14px; margin:0 0 4px; max-width:80ch; }
  .sub code { background:var(--surface-2); padding:1px 5px; border-radius:3px; }
  .box { background:var(--surface); border:1px solid var(--line); border-radius:4px; overflow-x:auto; margin-top:22px; }
  table { border-collapse:collapse; width:100%; min-width:1180px; }
  th {
    text-align:left; font-size:10.5px; font-weight:600; letter-spacing:.12em;
    text-transform:uppercase; color:var(--ink-3); padding:12px 12px;
    border-bottom:1px solid var(--line); white-space:nowrap; position:sticky; top:0;
    background:var(--surface);
  }
  td { padding:12px; border-bottom:1px solid var(--line-soft); font-size:13.5px; vertical-align:top; }
  tbody tr:last-child td { border-bottom:0; }
  tbody tr:hover td { background:var(--surface-2); }
  .hill b { font-weight:600; }
  .slug { display:block; color:var(--ink-3); font-size:11.5px; }
  .num { font-variant-numeric:tabular-nums; white-space:nowrap; }
  a { color:var(--accent); text-decoration:none; border-bottom:1px solid var(--line); }
  a:hover { border-bottom-color:var(--accent); }
  code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; }
  .sw {
    display:inline-block; width:15px; height:15px; border-radius:3px;
    border:1px solid var(--line); vertical-align:-3px; margin-right:6px;
  }
  .cols { white-space:nowrap; line-height:2; }
  .gap { color:var(--warm); font-weight:600; }
  .lock { display:block; margin-top:5px; font-size:11px; color:var(--ink-3); white-space:nowrap; }
  .evi { color:var(--ink-3); font-size:12px; max-width:30ch; }
  .alt { display:block; color:var(--ink-2); margin-top:3px; }
  footer { margin-top:22px; color:var(--ink-3); font-size:12.5px; }
</style>
</head>
<body>
  <h1>Resort record</h1>
  <p class="sub">Every field in <code>data/resorts.json</code>. Edit that file by hand, then rerun
    <code>node scripts/identity.mjs --page</code> to refresh this table.
    Values in <span class="gap">this colour</span> are empty.</p>
  <p class="sub"><b>${filled} of ${total}</b> social and colour fields filled.
    Evidence from ${stamp}; rerun <code>node scripts/identity.mjs</code> to refresh it.</p>

  <div class="box">
    <table>
      <thead><tr>
        <th>Hill</th><th>Place</th><th>Coords</th><th>Website</th><th>Former</th>
        <th>Facebook</th><th>Instagram</th><th>Colours</th><th>Photos</th><th>Dates</th><th>Evidence</th>
      </tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </div>

  <footer>Generated by <code>scripts/identity.mjs --page</code>. Not part of the site &mdash;
    <code>review.html</code> is gitignored.</footer>
</body>
</html>
`;
  writeFileSync(PAGE_OUT, html);
  console.log(`wrote ${PAGE_OUT} — ${filled}/${total} social and colour fields filled`);
}

if (REPORT) report();
else if (PAGE) page();
else await probe();
