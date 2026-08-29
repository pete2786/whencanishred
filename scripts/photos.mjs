// Turns one photo into the widths the pages ask for.
//
//   node scripts/photos.mjs ~/Desktop/buck.jpg buck-hill-night
//
// Never enlarges. Images pasted into a chat arrive capped near 1572px on the
// long edge, so asking for a 1120-wide version of an 884-wide source produced
// a file 27% bigger than its own detail — and it was the one retina screens
// picked. A width wider than the source is skipped and said so out loud.
//
// Re-encoding is also what drops the camera metadata: no GPS, no make, no model.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";

const WIDTHS = [560, 840, 1120];
const [src, base] = process.argv.slice(2);

if (!src || !base) {
  console.error("usage: node scripts/photos.mjs <source-image> <basename>");
  process.exit(1);
}
if (!existsSync(src)) { console.error(`no such file: ${src}`); process.exit(1); }
if (!/^[a-z0-9-]+$/.test(base)) {
  console.error(`basename must be lowercase letters, digits and dashes: ${base}`);
  process.exit(1);
}

const sips = args => execFileSync("sips", args, { encoding: "utf8" });
const dim = (f, k) => Number(sips(["-g", k, f]).trim().split(/\s+/).pop());

mkdirSync("photos", { recursive: true });
const w0 = dim(src, "pixelWidth"), h0 = dim(src, "pixelHeight");
console.log(`${src}  ${w0}x${h0}`);

// A source narrower than the largest step still deserves a retina-sized file:
// 560 alone is soft in a 380px slot on a 2x screen. Emit its own width too,
// which is the largest honest size it has.
const wanted = WIDTHS.filter(w => w <= w0);
if (w0 < Math.max(...WIDTHS) && !wanted.includes(w0) && w0 > Math.min(...WIDTHS)) wanted.push(w0);
wanted.sort((a, b) => a - b);

let made = 0;
for (const w of WIDTHS.filter(w => w > w0)) console.log(`  ${w}w  skipped, source is only ${w0}px wide`);
for (const w of wanted) {
  const out = `photos/${base}-${w}.jpg`;
  sips(["-s", "format", "jpeg", "-s", "formatOptions", "72", "--resampleWidth", String(w), src, "--out", out]);
  console.log(`  ${w}w  ${out}  ${(statSync(out).size / 1024).toFixed(0)}K`);
  made++;
}
if (!made) { console.error("nothing written: source narrower than the smallest width"); process.exit(1); }
console.log(`\nwrote ${made} file${made > 1 ? "s" : ""}. Rebuild with: node scripts/build.mjs`);
