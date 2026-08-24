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
```

Raw pulls cache to `data/cache/` (~108MB, gitignored). First run is slow and
rate-limited; reruns are free.

## Site

`index.html` is the whole site. No build step.
