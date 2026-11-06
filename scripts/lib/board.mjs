// The homepage's hill cards and night strips.
//
// Rendered twice: once by build.mjs, so the page arrives with the default hills
// already drawn, and again in the browser when a reader picks their own.
// build.mjs inlines these functions into the page with Function.toString, so
// there is one copy of the markup rather than a Node one and a browser one that
// drift. That only works if every function here is self-contained: it may call
// the others in this file, and use nothing else.
//
// K is the payload build.mjs embeds: { days, models, areas, hills, defaults }.

export const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
export const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

export function bEsc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
// Dates are parsed by hand rather than through Date and a locale, so the build
// machine and the reader's browser print the same thing.
export function bShort(iso) {
  return MON[Number(iso.slice(5, 7)) - 1] + " " + Number(iso.slice(8, 10));
}
export function bDow(iso) {
  return DOW[new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))).getUTCDay()];
}
export function bHour(iso) {
  const h = Number(iso.slice(11, 13));
  return (h % 12 || 12) + (h < 12 ? "am" : "pm");
}
// How many of the models put that night under the threshold. A night past
// every model's range has nothing to say and is hatched.
export function bShade(c) {
  if (c.n === 0) return "na";
  return "s" + Math.min(c.under, 3);
}

export function bHeader(K) {
  return '<div class="strip strip-hd" aria-hidden="true">' + K.days.map(d =>
    '<span class="hd">' + bDow(d)[0] + "<br>" + Number(d.slice(8, 10)) + "</span>").join("") + "</div>";
}
export function bStrip(K, h, pre) {
  return '<div class="strip">' + h.cells.map((c, i) =>
    '<button type="button" class="cell ' + bShade(c) + '" data-cell="' + pre + "|" + h.slug + "|" + i + '" ' +
    'aria-label="' + bEsc(h.name) + ", " + bDow(K.days[i]) + " " + bShort(K.days[i]) + ": " +
    c.under + " of " + c.n + ' models under the threshold"></button>').join("") + "</div>";
}
function bDays(n) {
  if (n > 0) return '<span class="pc-num">' + n + '</span><span class="pc-unit">days</span>';
  if (n === 0) return '<span class="pc-num">Today</span>';
  return '<span class="pc-num">Open</span>';
}
export function bOptions(K, picks, current) {
  return '<option value=""' + (current ? "" : " selected") + " disabled>Choose a hill</option>" +
    K.areas.map(a => '<optgroup label="' + bEsc(a.name) + '">' + a.hills.map(s =>
      '<option value="' + s + '"' + (s === current ? " selected" : "") +
      (s !== current && picks.indexOf(s) >= 0 ? " disabled" : "") + ">" + bEsc(K.hills[s].name) + "</option>").join("") +
      "</optgroup>").join("");
}
export function bCard(K, picks, slug, idx) {
  const h = K.hills[slug];
  const agree = '<span class="agree">' + Object.keys(K.models).map(m =>
    '<i class="' + (h.nights[m] ? "on" : "") + '" title="' + bEsc(K.models[m]) + '"></i>').join("") + "</span>" +
    h.agree + " of " + Object.keys(K.models).length + " models see a full night";
  return '<article class="pcard" style="--c1:' + h.c1 + ";--c2:" + h.c2 + '">' +
    '<button type="button" class="pc-rm" data-rm="' + idx + '" aria-label="Remove ' + bEsc(h.name) + '">&times;</button>' +
    '<h3 class="pc-name">' + bEsc(h.name) + "</h3>" +
    '<p class="pc-place">' + bEsc(h.place) + "</p>" +
    '<p class="pc-count">' + bDays(h.days) + "</p>" +
    '<p class="pc-line">First lift <b>' + bShort(h.proj) + "</b>" + (h.label === "weather" ? ' <span class="tag">weather</span>' : "") + "</p>" +
    '<p class="pc-line pc-mut">Range ' + bShort(h.lo) + " &ndash; " + bShort(h.hi) + "</p>" +
    '<p class="pc-line pc-mut">' + (h.last ? "Last season " + bShort(h.last) : "No first lift on record last season") + "</p>" +
    '<div class="pc-strip">' + bHeader(K) + bStrip(K, h, "card") + "</div>" +
    '<p class="pc-line">' + (h.first ? "First hour under 28&deg; <b>" + bDow(h.first) + " " + bShort(h.first) + ", " + bHour(h.first) + "</b>"
      : "Nothing under 28&deg; in " + K.days.length + " days") + "</p>" +
    '<p class="pc-line pc-mut">' + agree + "</p>" +
    '<a class="pc-link" href="resorts/' + slug + '.html">' + bEsc(h.name) + "&rsquo;s history &rarr;</a>" +
    "</article>";
}
export function bEmpty(K, picks, idx) {
  return '<div class="pcard pc-empty"><span class="pc-plus" aria-hidden="true">+</span>' +
    '<span class="pc-add">Add a hill</span>' +
    '<label class="pc-choose">Choose &#9662;<select data-slot="' + idx + '" aria-label="Add a hill">' +
    bOptions(K, picks, null) + "</select></label></div>";
}
export function bSlots(K, picks) {
  const isDefault = picks.join() === K.defaults.join();
  return '<div class="slots">' + picks.map((s, i) => bCard(K, picks, s, i)).join("") +
    (picks.length < K.max ? bEmpty(K, picks, picks.length) : "") + "</div>" +
    '<p class="slot-foot">' + (isDefault
      ? "Remove any of these and add your own. This browser remembers them."
      : 'Your hills, saved in this browser. <button type="button" class="linkish" data-reset>Back to the defaults</button>') + "</p>";
}

// Everything above, as source for the page.
export const KIT = [bEsc, bShort, bDow, bHour, bShade, bHeader, bStrip, bDays, bOptions, bCard, bEmpty, bSlots]
  .map(f => f.toString()).join("\n") +
  `\nconst MON = ${JSON.stringify(MON)};\nconst DOW = ${JSON.stringify(DOW)};`;
