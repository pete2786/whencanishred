// How many days until a date, counted the way a reader counts them.
//
// Shared by scripts/build.mjs and social/make.mjs. It lives here because the
// two had drifted: the site said 70 days while a social card said 71, from two
// copies of the same arithmetic run minutes apart.
//
// ---------------------------------------------------------------------------
// Why not just subtract and round
//
// The original was:
//
//   Math.round((new Date(`${iso}T00:00:00`) - new Date()) / 86400000)
//
// which measures from the *instant* the build runs and then rounds. Two things
// go wrong. The rounding boundary sits half a day off any date boundary, so the
// 11:00 UTC build and the 23:00 UTC build on the same day returned 69 and 68.
// And on a CI runner both sides parse as UTC, so what day it is flips at UTC
// midnight, which is late afternoon where the resorts and the readers are.
//
// The result was a countdown that changed in the middle of the reader's day.
//
// Counting whole calendar days in the resorts' own zone fixes both: the number
// is the same all day whenever the build happens to run, and it ticks over at
// local midnight like a countdown should.

const ZONE = "America/Chicago";

// Today's date in a given zone, as YYYY-MM-DD. en-CA formats that way already.
export function todayIn(zone = ZONE, now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

// Whole calendar days from today to `iso`, in the resorts' own time zone.
// Negative once the date has passed. Accepts a full timestamp or a bare date.
export function daysUntil(iso, { zone = ZONE, now = new Date() } = {}) {
  const [ay, am, ad] = todayIn(zone, now).split("-").map(Number);
  const [by, bm, bd] = String(iso).slice(0, 10).split("-").map(Number);
  return Math.round(
    (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}
