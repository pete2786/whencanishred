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
node scripts/identity.mjs                     # social/color candidates -> data/raw/identity.json
node scripts/identity.mjs --report            # the record next to the evidence
node scripts/identity.mjs --page              # review.html: the whole record as a table
```

Raw pulls cache to `data/cache/` (~108MB, gitignored). First run is slow and
rate-limited; reruns are free.

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
