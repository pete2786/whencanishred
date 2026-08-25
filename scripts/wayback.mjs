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
const ONLY = process.env.ONLY;   // ONLY=wild-mountain node scripts/wayback.mjs

mkdirSync("data/raw", { recursive: true });

const out = {};
for (const slug of Object.keys(resorts)) {
  if (ONLY && slug !== ONLY) continue;
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
      let rows;
      try {
        rows = await captures(url, { from: `${y}1001`, to: `${y + 1}0430` });
      } catch (e) {
        // One unreachable URL must not cost the whole sweep. It shows up as a
        // fetch error and the season falls back to whatever else was found.
        console.error(`    ! ${url}: ${e.message}`);
        fetchErrors++;
        continue;
      }
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
