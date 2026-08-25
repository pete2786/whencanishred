# Resort Record and Real Opening Dates

Design, 2026-08-24.

## Why

`index.html` hand-codes every hill as a `<tr>`, and the opening dates in it are
placeholders. The README says so. The dates feel wrong — Andes Tower Hills opened
earlier than the page claims — and there is no way to check, because no number on
the page cites where it came from.

This project builds the data layer the rest of the site has been faking: a resort
record, five seasons of real open/close dates with provenance, and a build step so
the page renders from data instead of from typing.

It is the first of six pieces. The others — recalibrating the projection, resort
pages and color theming, the design pass, the Troll/Wild race feature, and
widening past Minnesota — all read from what this produces.

## Decisions

**Two dates per season, not one.** `firstLift` is any public lift-served skiing:
one run, one rope tow, a Friday night park session. `fullOps` is the day the hill
was meaningfully open. Troll spinning a full chair over a single run in early
November and Buck Hill opening ten runs are different events, and collapsing them
into one "opening day" is most of why the current page reads wrong. Two dates also
give the hero an honest range later: Troll spins Nov 2, most hills are real by
Nov 20.

**Five seasons: 2021-22 through 2025-26.** Enough to calibrate against and to show
a recent-history strip per hill. It is also the window where Facebook posts and
Wayback captures are both reliably findable. Roughly 160 dates across 16 hills.

**Two independent sources, cross-referenced.** The Wayback sweep brackets a date;
the social pass pins it. Agreement is the confidence signal. Disagreement is a
recorded state, not an error — never silently averaged.

**Provenance on every date.** Every value carries its sources and how well they
pin it. The page shows this. "Andes Tower Hills opened early" becomes checkable
instead of another number taken on faith.

**A build step.** Sixteen individual resort pages cannot be hand-maintained. Plain
string templating, zero dependencies, output committed — GitHub Pages serves the
repo root, so the site stays clone-it-and-it-works.

## Data model

Four files. Two are hand-owned, two are generated, and the line never blurs.

### `data/resorts.json` — identity, hand-owned

```json
"wild-mountain": {
  "name": "Wild Mountain", "place": "Taylors Falls, MN",
  "state": "MN", "region": "twin-cities",
  "lat": 45.3897, "lon": -92.7143,
  "website": "https://www.wildmountainski.com/",
  "social":  { "facebook": "wildmountainski", "instagram": "wildmountainski" },
  "colors":  { "primary": "#0b3d91", "secondary": "#f0a500" },
  "photos":  []
}
```

Seeded from the 16 hills already in `scripts/climatology.mjs`. `social`, `website`,
and `colors` are filled during the social pass, which visits every resort's pages
anyway. `photos` stays empty here; it is the next project's business.

### `data/raw/wayback.json`, `data/raw/social.json` — observations, generated

What each source independently saw, never hand-edited. Separate files so the sweep
re-runs without touching social findings, and so any disagreement traces back to a
specific capture or post.

### `data/overrides.json` — adjudications, hand-owned

Dates set by hand, with a note as the source. Layered on top by the reconciler and
never overwritten, so adjudications survive every re-run.

### `data/seasons.json` — reconciled truth, generated

```json
"wild-mountain": {
  "2024-25": {
    "firstLift": {
      "date": "2024-11-15", "precision": "exact", "corroboration": "confirmed",
      "note": "one run off the Wild chair",
      "sources": [
        { "kind": "social",  "url": "…", "evidence": "IG post: WE'RE OPEN, 11/15 6am" },
        { "kind": "wayback", "url": "…", "evidence": "homepage banner OPEN, capture 11/16; CLOSED 11/12" }
      ]
    },
    "fullOps": {
      "date": "2024-12-06", "precision": "bracket", "range": ["2024-12-04", "2024-12-08"],
      "corroboration": "single", "sources": [ … ]
    },
    "close": { … }
  }
}
```

Two orthogonal fields, because they are different failure modes:

- **`precision`** — `exact`, or `bracket` with a `range`. How well we pinned the
  day. Wayback usually brackets; social usually pins.
- **`corroboration`** — `confirmed` (two independent sources agree), `single` (one
  source), `conflict` (sources disagree, both retained), or `unknown` when nothing
  was found. An `unknown` entry is still written, so the page can say "no record"
  rather than leaving a silent hole.

"Nov 15, confirmed", "sometime Nov 6-9, archive only", and a placeholder are three
different claims, and the page says which one it is showing.

## Collection pipeline

### `scripts/wayback.mjs`

For each hill, query the archive.org CDX index for captures of the homepage and
the conditions / snow-report URL between Oct 1 and Apr 30 of each target season,
collapsed to one capture per day. Fetch each through the `id_` raw endpoint to get
original HTML without the archive banner. Classify each capture:

- `OPEN` — "now open", "opening day", "we open", a nonzero runs-open count
- `CLOSED` — "closed for the season", "see you next season", zero runs open
- `NO-SIGNAL` — nothing decisive

Extract runs-open counts where the page publishes them; they feed the `fullOps`
proposal. The bracket falls out of the timeline: last `CLOSED` before first `OPEN`.

Captures cache to `data/cache/wayback/`, gitignored, matching the existing ERA5
cache convention. Back off on rate limits the way the current scripts do.

Known weak spot: Afton Alps is a Vail site and renders client-side, so its captures
will often be an empty shell. `NO-SIGNAL` is recorded as itself and handed to the
social pass, rather than quietly producing no row.

### Social pass

Not a script. A documented procedure run through the user's logged-in Chrome,
writing into `data/raw/social.json` in the observation shape.

Facebook is the primary target over Instagram: posts carry visible dates, pages are
usually public, and most of these hills post "WE OPEN FRIDAY" as their entire
marketing plan. Where a resort keeps a news or blog archive on its own site, that
is easier than either and takes precedence.

This pass also collects social handles, website URLs, and brand colors into
`data/resorts.json`.

### `scripts/reconcile.mjs`

Joins raw sources per hill, season, and event:

| Evidence | `precision` | `corroboration` | `date` |
|---|---|---|---|
| Social date inside Wayback bracket | `exact` | `confirmed` | the social date |
| Social only | `exact` | `single` | the social date |
| Wayback only | `bracket` | `single` | first `OPEN` capture |
| Social date outside bracket | as found | `conflict` | both retained, queued |
| Neither | — | `unknown` | absent, entry retained |

The Wayback-only point estimate is the first `OPEN` capture, never earlier than the
evidence supports. `data/overrides.json` is applied last and always wins.

`fullOps` is a judgment call, and the design treats it as one. The reconciler
proposes a date only where evidence is unambiguous — a conditions page showing the
main chair plus most runs, or a "fully open" post — and queues everything else.
Across 16 hills and 5 seasons that is a bounded amount of adjudication, and it is
where the user's Twin Cities knowledge beats any scraper.

### `scripts/review.mjs`

Prints the unresolved queue: conflicts, `NO-SIGNAL` hills, and unproposed
`fullOps`. This is the worklist for adjudication.

## Build

`scripts/build.mjs`, plain string templating, zero dependencies.

The current `index.html` becomes `templates/index.html` with a token where the
table body goes. `templates/resort.html` is added for per-hill pages. Build writes
`index.html` and `resorts/<slug>.html`; both are committed.

The build reproduces the homepage table as it looks today — same columns, same
styling — with real dates replacing placeholders where they exist. Changing what
the table shows, the hero range, the theming, and the resort page design belongs to
the next project. This one earns the right to do that by making the numbers real.

## Verification

No test suite. This is a project for fun and the author spot-checks it.

The pipeline's own honesty is the main safeguard: every date carries its sources,
`review.mjs` surfaces everything unresolved, and nothing is inferred past its
evidence. Beyond that:

- **The Andes Tower Hills check.** The author says it opened early and the current
  page disagrees. If the pipeline comes back agreeing with the author, it works. If
  it agrees with the current page, something is wrong — and it is better to find
  that on a hill he knows cold than on Coffee Mill.
- **Build smoke check.** Every hill produces a page, and no template token survives
  into output.
- **Eyeball the reconciled table** against what the author already knows about the
  Twin Cities hills before anything ships.

## Out of scope

Recalibrating the projection and the hero range. Resort page design and color
theming. The author's photos. The Troll/Wild race feature. Any hill outside the
current 16. Each is its own project, and each gets better inputs from this one.
