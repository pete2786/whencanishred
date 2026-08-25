# Asking the hills

The opening dates are not on the internet. This is how we get them anyway.

## Why we are asking

Two automated routes were tried and both failed on evidence, so the manual route
is not laziness — it is the only one left.

**The archive sweep** (`scripts/wayback.mjs`) filled 5 of 80 season-slots. Capture
density is roughly one page a fortnight on the thin hills, and most captures are
marketing pages that never say whether the lifts are turning. A longer sweep does
not fix that; there is nothing more to find.

**Aggregators do not carry it.** Checked August 2026:

| Source | What it actually has |
|---|---|
| OnTheSnow, Minnesota | Two columns: resort name, *projected* opening. No past seasons. |
| skiresort.com season start | Upcoming only, and excludes every Minnesota area. |
| OpenSnow, SnowBrains | Annual "confirmed upcoming" posts, not archives. |
| SnowPak | Claims historical dates; rate-limited both attempts, still unverified. |

The one aggregator page that would have solved it — OnTheSnow's Minnesota
"open resorts" list, every hill's status on one URL — is archived far too thinly
to use. Nearest capture to November 2023 is 39 days away; November 2024, 43 days.

What the search did turn up is the reason asking works: Loveland publishes its
own opening and closing dates back to 1979-80. Nobody aggregates this data, but
**the areas keep it themselves**. A marketing manager can answer in five minutes
what a month of scraping could not.

## Who to ask

Sixteen hills, fifteen in Minnesota and Trollhaugen in Wisconsin.

Start with the **Minnesota Ski Areas Association**, the nonprofit representing the
19 Minnesota alpine areas. One conversation there plausibly reaches almost the
whole list, and an introduction from the association gets a better reply rate
than sixteen cold emails. Trollhaugen is Wisconsin and needs asking directly.

Addresses are not recorded here because they go stale and inventing one is worse
than looking it up: take them from each hill's own contact page, which is linked
from its row in `review.html`. Ask marketing or the general office, not the snow
phone.

**Ask in the off-season.** April to September, nobody is running a hill at 5am.
A question that is a nuisance in January is a pleasant one in June.

## The email

Short, one ask, easy to answer, no attachment. Adjust the hill's name and send.

> **Subject:** Opening dates for the last five seasons?
>
> Hi —
>
> I run a small non-commercial site that tracks when Minnesota ski areas can
> start making snow and when they usually open: https://pete2786.github.io/whencanishred/
> It is built on 31 years of weather data, and it is free, has no ads, and sells
> nothing.
>
> The one thing I cannot get right is the dates you actually opened. Archived web
> pages only caught a handful, and I would rather print your real dates than my
> estimates.
>
> Would you be willing to send the first day you ran lifts for the last five
> seasons? Closing dates too if you have them handy. Anything like this is
> perfect — a forwarded email or a screenshot of a spreadsheet is completely
> fine:
>
> ```
> 2021-22   opened Nov 20   closed Mar 14
> 2022-23   opened Oct 18   closed Mar 26
> 2023-24   opened Nov 1    closed Feb 29
> 2024-25   opened Nov 15   closed
> 2025-26   opened Nov 10   closed Mar 14
> ```
>
> If a year is a guess, say so and I will mark it as approximate rather than
> print it as fact. Partial answers are welcome — even one season helps.
>
> Happy to credit you as the source and link to your site, or to leave the
> attribution off entirely, whichever you prefer.
>
> Thanks,
> David

Notes on why it reads that way:

- **Say it is non-commercial early.** The first question anyone has is whether
  this is a competitor or a scraper reselling their data.
- **Five seasons, not "your records".** A bounded ask gets answered; an open one
  gets filed.
- **Give the format in the mail.** Most replies will copy the block and edit it.
- **Invite "approximate".** A hedged real date beats a confident wrong one, and
  the record has a place for it.
- **Offer to skip attribution.** Some operators would rather not be quoted on a
  bad season, and a date is worth more than a credit.

## Logging a reply

Replies go in `data/overrides.json`, which is hand-owned and outranks every
automated source. Season keys are `2021-22` through `2025-26`.

```json
{
  "buck-hill": {
    "2023-24": {
      "firstLift": { "date": "2023-12-02", "note": "Email from the hill, 12 June 2026." },
      "close":     { "date": "2024-03-10", "note": "Email from the hill, 12 June 2026." }
    }
  }
}
```

`firstLift`, `fullOps` and `close` each take a `date` and a `note`. The note is
the provenance and is the only record of where the date came from, so write who
said it and when — "email from the hill, 12 June 2026", not "confirmed".

For a date the hill flagged as approximate, say so in the note. It still renders
as exact, so the note is what stops a guess hardening into a fact later.

Then:

```sh
node scripts/reconcile.mjs   # merge overrides into data/seasons.json
node scripts/review.mjs      # what is still unresolved
node scripts/build.mjs       # render
```

An override that agrees with an independent source is marked `confirmed`; on its
own it is `single`. Nothing else needs touching.

## While waiting for replies

Local news runs a "which hills are open" list every year, and it is dated,
citable, and far better provenance than a Facebook post. Worth a pass per season:

- `minnesota ski hills open list <year>` — FOX 9 and CBS Minnesota both run one
- `<hill name> opening day <year>` — local papers cover the northern hills
- The hill's own press release or blog, which often outlives the homepage banner

Log these the same way, with the URL and publication date in the note.
