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

## Opening dates

The dates are not on the internet. The archive sweep filled 5 of 80 season-slots
and no aggregator carries historical opening dates for hills this small, so the
record is filled by asking the hills directly. See `docs/asking-the-hills.md` for
who to ask, what to send, and how to log a reply.
