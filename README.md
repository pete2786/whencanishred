# whencanishred

When Minnesota ski hills can start making snow, and when they normally open.

Snowmaking needs a wet-bulb temperature under 28°F. Everything on the page is derived
from that: `data/hours.json` and the climatology in the chart come from 31 years of
hourly ERA5 reanalysis via [Open-Meteo](https://open-meteo.com/) (CC BY 4.0).

Opening dates are still placeholders.

## Regenerating the data

```sh
node scripts/allhours.mjs > data/hours.json   # Oct-Nov snowmaking hours per hill
node scripts/climatology.mjs                  # first-window date, normal/earliest/latest
node scripts/curve.mjs                        # mean wet-bulb curve -> data/curve.json
node scripts/forecast.mjs                     # 16-day wet-bulb forecast -> data/forecast.json
node scripts/project.mjs                      # projected opening dates -> data/projection.json
node scripts/project.mjs --report              # the working, written nowhere
node scripts/identity.mjs                     # social/color candidates -> data/raw/identity.json
node scripts/identity.mjs --report            # the record next to the evidence
node scripts/identity.mjs --page              # review.html: the whole record as a table
```

Raw pulls cache to `data/cache/` (~108MB, gitignored). First run is slow and
rate-limited; reruns are free.

## Staying current

`.github/workflows/refresh.yml` pulls the forecast and rebuilds twice a day, at
11:00 and 23:00 UTC — early morning and evening in the hills' own time zone. It
commits the result to `main`, which is what GitHub Pages serves.

The rebuild matters on its own, not only for the forecast. The countdown, the
days-until column and the forecast's own staleness note are all computed at
build time, so a page left alone keeps saying whatever it said when it was
built. Every page carries the build time and the forecast pull time in its
footer, in Central rather than the build machine's UTC.

If Open-Meteo is unreachable the forecast step is allowed to fail and the build
runs anyway: a stale forecast that says how stale it is beats a frozen
countdown. The run leaves a warning when that happens.

The forecast is the one thing on the page that goes out of date. Rerun
`scripts/forecast.mjs` before building; the page prints the date it was made and
says so in the copy once it is two days old. Build it without `data/forecast.json`
and the section says the forecast is missing rather than showing stale numbers.

`review.html` is the page to read while editing: every field as a table, colors as
swatches, handles as links, gaps in red, and each value sat next to the evidence
behind it. It is gitignored and never published — regenerate it after each edit.

`data/projection.json` is generated, not hand-owned. `scripts/project.mjs`
projects each hill's next first lift two ways and labels which is which. A hill
with at least two recorded seasons gets the **median** of its own first lifts —
median, so Coffee Mill's 14 January 2024 does not drag it a fortnight late. A
hill with no record gets a **climate** estimate: normal Oct-Nov snowmaking hours
regressed against the openings of the hills that do have one.

The fit includes the announced and targeted dates of hills that have no record
of their own, and this matters. Fitted on the recorded hills alone the line is
steep enough that extrapolating it puts Buena Vista, at 458 normal hours, in
mid-October — while Giants Ridge at effectively the same 454 hours targets
24 November and Lutsen at 386 announces the 22nd. Northern hills are bounded by
staffing and holiday demand rather than by cold, and the curve flattens where
the line does not. Feeding those stated dates into the fit buys sane
extrapolation at the cost of in-sample R2, which is the right trade when the
whole job is predicting hills that are not in the sample.

A hill's own announced or targeted date always wins over the model. Both
estimators are weak while the record is half empty; rerun after any backfill.

`data/resorts.json` is hand-owned. `scripts/identity.mjs` only gathers candidate
handles and colors from the resorts' own pages — archived captures first, then a
live fetch — and a human transcribes the winners. Colors are recorded but nothing
renders them yet.

Three hills carry `"source": "manual"` on their colors: Wild Mountain, Hyland
Hills and Elm Creek take their identity from terrain park paint, not from their
websites. Hyland and Elm Creek share `threeriversparks.org`, so site CSS returns
the same palette for both and cannot tell the two hills apart. Those values are
set by hand and must survive any rerun — the report and `review.html` both mark
them `locked`. Do not "correct" them to match the probe's evidence.

## Site

`index.html` is the whole site. No build step.

## The look

The site commits to one colour scheme rather than following the system, so the
generated colours ship for that scheme only, with no `prefers-color-scheme`
branch. `SCHEME` in `scripts/build.mjs` is the switch.

The page keeps no brand colour of its own. Snow-white does the accent work and
the cold cyan carries the data, which leaves every saturated colour on the page
belonging to a hill: its marker in the table, its name on its own page, and its
name wherever the prose says it. An accent here would have been one hill's
identity worn by the whole site — the first draft used chartreuse, which is
Wild Mountain's park colour.

The cyan in the wordmark is the same cyan as the 28°F threshold line.

### Hills wear their own colours

A hill named in a sentence is printed in that hill's own colour. The marking
runs over the rendered HTML in `build.mjs`, not in the templates, so copy
written later is covered without remembering to tag it. Only a `<b>` whose
entire text is exactly a hill's name matches; the other `<b>` on these pages
hold numbers and a chart legend. Colours go through the same `readable()`
correction as everything else.

### The chart

`data/curve.json` drives it, and `build.mjs` renders the SVG at two geometries
from one function, so the phone chart and the desktop chart cannot disagree.
The wide one appears only at viewports where it renders at 1:1 or better —
988px, being 900 for the drawing, 40 for the box padding and 48 for the page
gutters. Below that the narrow drawing takes over, capped at 400px so the two
meet at roughly the same type size instead of stepping.

That is the chart's own breakpoint, not the table's 920px. The table stacks
where seven columns stop fitting; the chart swaps where it would start being
shrunk. Different content, different threshold.

The pin captions pack themselves: a caption drops to the next row only when it
would touch the one beside it, and the drawing grows by exactly the rows used.
Their positions come from `data/projection.json`, so the layout follows the
data rather than a set of eyeballed coordinates.

## Opening dates

Each season carries two dates, and the difference between them is the point.

- **`firstLift`** — any public lift-served skiing. One rope tow, one run, a
  Friday night park session. Wild Mountain spinning a chair over a single strip
  of man-made snow counts.
- **`fullOps`** — normal hours and normal services: the regular schedule,
  rentals, lessons, the food open. **Not 100% open.** A connector trail still
  closed or a halfpipe not yet built does not count against it — those are
  bonus, and where the line sits varies by hill.

Buck Hill's 2025-26 season is the worked example. It ran an opening weekend on
29-30 November, closed for four days to make snow, and came back on 5 December
with additional lifts, more parks, tubing and lessons. More terrain followed on
the 12th and the halfpipe on the 17th, when the hill called itself "100% open".
`firstLift` is 29 November, `fullOps` is 5 December, and 17 December is neither.

Trollhaugen says it plainly in its own words: "NORMAL HOURS BEGIN 11/28",
eighteen days after first lift.

`data/season-notes.json` holds statewide context for a season — why a winter ran
late, or opened fine and then stalled. It renders under the season table on every
resort page, because an opening date on its own does not explain itself.


The dates are not on the internet. The archive sweep filled 5 of 80 season-slots
and no aggregator carries historical opening dates for hills this small, so the
record is filled by asking the hills directly. See `docs/asking-the-hills.md` for
who to ask, what to send, and how to log a reply.
