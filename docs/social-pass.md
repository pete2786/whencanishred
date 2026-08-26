# The social pass

Run after `scripts/wayback.mjs`. Print the coverage summary first — the one-sided
and empty cells are the worklist, and the bracketed cells only need a date pinned
inside a known window.

```sh
node -e '
const w = JSON.parse(require("fs").readFileSync("data/raw/wayback.json","utf8"));
for (const [slug, seasons] of Object.entries(w)) {
  const cells = Object.entries(seasons).map(([s, v]) => {
    if (v.firstOpen && v.lastClosedBefore) return "["+v.lastClosedBefore.slice(5)+">"+v.firstOpen.slice(5)+"]";
    if (v.firstOpen) return "<="+v.firstOpen.slice(5);
    return "--";
  });
  console.log(slug.padEnd(20), cells.join("  "));
}
'
```

`[11-09>11-10]` is a real bracket and needs only a day pinned inside it.
`<=03-13` is one-sided — the archive never caught the hill closed, so the whole
season is open. `--` is nothing at all.

## Priority

Some hills are barely archived and the sweep cannot help them. As of the first
run, Trollhaugen and Coffee Mill are effectively social-only, and Detroit
Mountain has no conditions page at all. Do those first; they are the rows where
the pass is the entire source rather than a confirmation.

## Driving the page

Learned the hard way across six hills. The pass works when you follow these and
stalls for an hour when you do not.

**Use the date filter, not scrolling.** Every page has a **Filters** button above
the posts. It offers Year, then Month, then Day, and jumps the feed straight
there. Scrolling a month of image-heavy posts to reach its start takes dozens of
screens; the Day field takes three clicks. Set it a few days *after* the opening
you expect, so the confirming posts are the first thing you see.

**Go slowly.** This matters more than anything else here. Facebook stops
returning old posts if you page back quickly — the page keeps rendering, posts
below the first stay as grey skeletons that never fill, and it looks like the
history is gone. It is not; it is rate limiting. A few scroll ticks with several
seconds between them keeps it feeding. Bursts of twenty ticks do not.

**The throttle builds per page.** Hammering one hill gets that page cut off while
a hill you have not touched still loads normally. If a page goes quiet, move to
the next hill and come back later rather than pushing.

**Reload before changing seasons.** After several filter changes on one page load
the feed can wedge — it stops scrolling past the header and the dialog stops
accepting selections. Navigating to the page afresh clears it.

**Try the page search first.** Some pages carry a **Search** button next to
Follow, which maps to `facebook.com/profile/{id}/search/?q=...` and can be
visited directly. It is ranked and returns about seven results, so it finds a
well-phrased opening post in one shot and misses plenty. Cheap to try, not
something to rely on.

## Procedure

For each resort, in worklist order:

1. Open the resort's Facebook page in Chrome. Prefer Facebook over Instagram:
   the resorts cross-post the same announcements, and Facebook shows a visible
   date and greppable text where Instagram bakes "OPENING FRIDAY" into a graphic
   with an emoji caption and offers no date navigation.
2. If the resort keeps a news or blog archive on its own site, use that first —
   it is easier than either platform.
3. Filter to the season's opening month and a day just after it, per **Driving
   the page** above. Look for the announcement post: "WE OPEN SATURDAY", "WE'RE
   OPEN", "opening day", "first chair".
4. Record what exists, per season:
   - `firstLift` — the first day of public lift-served skiing, however small.
     One run, one rope tow, a Friday night park session all count.
   - `fullOps` — the day the hill was meaningfully open: main chair plus most
     runs. Usually a separate, later post.
   - `close` — the last day of the season.
5. Capture the permalink as `url` and the post's own words as `evidence`. The
   evidence is what makes the date checkable later; a date without it is worth
   very little.
6. While on the page, fill the resort's `social.facebook`, `social.instagram`,
   and `colors` (primary and secondary, sampled from their logo or site) into
   `data/resorts.json`.

## Watch for

- **A projected date is not an opening.** "Projected Opening Is Friday, November
  15" is a plan. Record the day they actually said they were open.
- **Snow tubing opens before the ski hill** at several of these. A "WE'RE OPEN"
  post about the tubing park is not `firstLift`.
- **Reposts and anniversary throwbacks** carry an old date in the image and
  today's date on the post. Trust the post date only when the text is current.
  These are also useful in reverse: Trollhaugen's throwback a year later is what
  confirmed its 19 October 2022 opening independently.
- **A first powder day is not a first day.** Wild Mountain and Buck Hill both
  post about "the first POW DAY of the season" weeks after opening. It is about
  natural snow, not lifts.
- **Look for the day-after post, not just the announcement.** "Thanks to everyone
  who came out for opening day" on the 27th proves the 26th happened; the
  announcement on the 22nd only proves it was planned. The confirming post is
  what turns a plan into a date.

Do not guess. A season with no findable post is left absent, and the Wayback
bracket stands alone. An absent entry is a better outcome than an invented one.

## Output

Write `data/raw/social.json`:

```json
{
  "trollhaugen": {
    "2024-25": {
      "firstLift": {
        "date": "2024-11-22",
        "url": "https://www.facebook.com/trollhaugen/posts/…",
        "evidence": "WE ARE OPEN. Chair 4 spinning, park is lit.",
        "platform": "facebook"
      }
    }
  }
}
```

Then `node scripts/reconcile.mjs && node scripts/review.mjs`.
