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
