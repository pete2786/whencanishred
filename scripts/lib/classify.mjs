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
];

// Deliberately NOT an open signal: a bare hours range like "Open 10am - 9pm".
// Resorts publish next month's lift schedule weeks ahead, and Wild Mountain's
// 9 Nov 2024 snow report advertised its 15 Nov holiday hours while the hill was
// still closed. Present-tense phrasing ("open today", "now open") is required.

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
