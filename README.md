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
node scripts/curve.mjs                        # mean wet-bulb curve for the chart
node scripts/forecast.mjs                     # 16-day wet-bulb forecast -> data/forecast.json
node scripts/project.mjs                      # projected opening dates -> data/projection.json
node scripts/project.mjs --report              # the working, written nowhere
node scripts/identity.mjs                     # social/color candidates -> data/raw/identity.json
node scripts/identity.mjs --report            # the record next to the evidence
node scripts/identity.mjs --page              # review.html: the whole record as a table
```

Raw pulls cache to `data/cache/` (~108MB, gitignored). First run is slow and
rate-limited; reruns are free.

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

## Themes

The pages are a pure function of the JSON, so a visual direction is just a
different stylesheet over the same data. A theme is one override sheet in
`themes/<name>/theme.css` plus an optional `theme.json`. The base templates in
`templates/` hold the structure — the responsive table, the chart geometry, the
stacked mobile layout — so directions cannot drift apart structurally while
they are being compared.

```sh
node scripts/theme.mjs topsheet          # templates/ + override -> themes/topsheet/*.html
node scripts/build.mjs --theme=topsheet  # -> preview/topsheet/
python3 -m http.server 8899 --directory preview
```

`preview/` is gitignored. Building with no `--theme` behaves as it always has:
`templates/` to the repo root, which is what GitHub Pages serves. Nothing in
the published site changes until a direction is promoted into `templates/`.

`theme.json` takes three keys. `fonts` replaces the Google Fonts query.
`inject` is a list of plain-string patches applied to the body. `extends` names
a parent theme, whose sheet lands first so the child only says what differs —
the chain resolves to its root, so a grandchild still gets its grandparent's
sheet.

`scheme` is the one key `build.mjs` reads rather than `theme.mjs`. A theme that
commits to `"light"` or `"dark"` ships that scheme's generated colours only,
with no `prefers-color-scheme` branch. Themes that omit it follow the system as
the site always has.

### Hills wear their own colours

A hill named in a sentence is printed in that hill's own colour — the same
colour its marker carries in the table and its name carries on its own page.

The marking runs over the rendered HTML in `build.mjs`, not in the templates,
so copy written later is covered without remembering to tag it. Only a `<b>`
whose entire text is exactly a hill's name matches; the other `<b>` on these
pages hold numbers and a chart legend. Colours go through the same `readable()`
correction as everything else, against the backgrounds of whichever scheme the
theme ships.

This is why `topsheet` has no brand colour of its own. Snow-white does the
accent work and the cold cyan carries the data, which leaves every saturated
colour on the page belonging to a hill. An accent there would have been one
hill's identity worn by the whole site — the chartreuse that first version used
is Wild Mountain's park colour.

The cyan in the wordmark is the same cyan as the 28°F threshold line.

Three themes exist: `current` (an empty override sheet, so it reproduces the
live site), `trailmap` and `topsheet`.

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
