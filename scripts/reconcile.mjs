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

const nextDay = d => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
};

// An announced date ("WE OPEN NOV 15") belongs to the season it falls in, not
// necessarily the calendar year of the capture that carried it.
function announcedDate(hint, season) {
  if (!hint || !MONTHS[hint.month]) return null;
  const m = MONTHS[hint.month];
  const year = m === 1 ? Number(season.slice(0, 4)) + 1 : Number(season.slice(0, 4));
  return `${year}-${String(m).padStart(2, "0")}-${String(hint.day).padStart(2, "0")}`;
}

// An OPEN capture in March says the hill was open in March, not when it opened.
// With no CLOSED capture before it there is nothing bounding the estimate from
// below, so a late one-sided "first open" is not an opening date at all — it is
// a gap for the social pass to fill. Mid-January is the cutoff: no Minnesota
// hill that opens at all opens later than that.
const LATEST_PLAUSIBLE_MONTHDAY = "01-15";
function plausibleOpening(date, season) {
  if (!date) return false;
  const y = Number(season.slice(0, 4));
  return date <= `${y + 1}-${LATEST_PLAUSIBLE_MONTHDAY}`;
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

  if (end && (start || plausibleOpening(end, season))) {
    return {
      date: end, precision: "bracket",
      range: [start ? nextDay(start) : null, end],
      corroboration: "single",
      note: start ? null : "one-sided: no closed capture before the first open one",
      sources,
    };
  }

  // Something was observed open, but too late in the season to say when it
  // opened. Record the observation without claiming it as an opening date.
  if (end) {
    return {
      ...empty(),
      note: `first archived open capture is ${end}, too late in the season to date the opening`,
      sources,
    };
  }

  return empty();
}

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
