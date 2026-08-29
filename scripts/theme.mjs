// Builds themes/<name>/*.html from templates/*.html plus one override sheet.
//
// The base templates hold the structure: the responsive table, the chart
// geometry, the stacked mobile layout. A theme only says what looks different,
// so the two directions cannot drift apart structurally while we compare them.
//
//   node scripts/theme.mjs trailmap && node scripts/build.mjs --theme=trailmap
//
// theme.json is optional. `fonts` replaces the Google Fonts query; `inject` is
// a list of {find, html, where} plain-string patches applied to the body.

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";

const name = process.argv[2];
if (!name) { console.error("usage: node scripts/theme.mjs <name>"); process.exit(1); }
const dir = `themes/${name}`;
if (!existsSync(dir)) { console.error(`no such theme: ${dir}`); process.exit(1); }

const sheet = d => (existsSync(`${d}/theme.css`) ? readFileSync(`${d}/theme.css`, "utf8") : "");
const conf  = d => (existsSync(`${d}/theme.json`) ? JSON.parse(readFileSync(`${d}/theme.json`, "utf8")) : {});

// A theme may extend another, which is how one direction gets tried in several
// accents without four copies of the same sheet going out of step. The parent's
// css lands first so the child only says what differs.
// Walk the chain to its root, then apply it outwards, so a grandchild still
// gets its grandparent's sheet.
const chain = [];
for (let n = name, hops = 0; n && hops < 8; hops++) {
  const d = `themes/${n}`;
  if (!existsSync(d)) { console.error(`no such theme: ${d}`); process.exit(1); }
  chain.unshift({ n, d, c: conf(d) });
  n = chain[0].c.extends;
}
const css = chain.map(({ n, d }, i) =>
  (i ? `\n/* ---- ${n} ---- */\n` : "") + sheet(d)).join("");
const cfg = chain.reduce((acc, { c }) =>
  ({ ...acc, ...c, inject: [...(acc.inject ?? []), ...(c.inject ?? [])] }), {});

for (const file of readdirSync("templates").filter(f => f.endsWith(".html"))) {
  let html = readFileSync(`templates/${file}`, "utf8");

  if (cfg.fonts) {
    html = html.replace(/https:\/\/fonts\.googleapis\.com\/css2\?[^"]*/,
                        `https://fonts.googleapis.com/css2?${cfg.fonts}`);
  }

  // region.html carries no <style> of its own; it takes index's via {{STYLE}}.
  if (css && html.includes("</style>")) {
    html = html.replace("</style>", `\n/* ---- theme: ${name} ---- */\n${css}\n</style>`);
  }

  for (const p of cfg.inject ?? []) {
    if (p.only && p.only !== file) continue;
    if (!html.includes(p.find)) { console.error(`  ! ${file}: no match for ${JSON.stringify(p.find.slice(0, 40))}`); continue; }
    html = html.replace(p.find, p.where === "before" ? p.html + p.find : p.find + p.html);
  }

  writeFileSync(`${dir}/${file}`, html);
}
console.error(`themed ${name}`);
