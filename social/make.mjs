// Instagram frames for whencanishred, batch one.
//
// Every number on every card is read from data/ at build time. Nothing here is
// typed by hand, because a card that says a resort opens on a date the site does
// not claim is worse than no card at all -- and the whole pitch of the site is
// that it does not guess.
//
// The look is not invented either. The palette, the two faces and the hazard
// tape are lifted from the built site so a card and the page it points at
// cannot drift apart. Resort colours come out of index.html, which already holds
// them post-`readable()`-correction against the dark ground.
//
//   node social/make.mjs
//
// Emits:
//   social/cards.html   every frame at true pixel size, for screenshotting
//   social/review.html  the same frames scaled, beside their captions
//
// This is the seed of the eventual scripts/cards.mjs. It is deliberately one
// file while the layouts are still being argued about.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const read = p => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

const resorts    = read("data/resorts.json");
const projection = read("data/projection.json");
const seasons    = read("data/seasons.json");
const forecast   = read("data/forecast.json");
const hoursList  = read("data/hours.json");

const hours = new Map(hoursList.map(h => [h.hill, h]));
// hours.json keys on display name and shortens two of them.
const HOURS_ALIAS = { "Lutsen Mountains": "Lutsen" };
const hoursFor = name => hours.get(HOURS_ALIAS[name] ?? name);

// ---------------------------------------------------------------- the look
//
// Straight out of templates/index.html. Repeated rather than imported because
// the site's CSS is one inline block in a template, not a file anything can
// pull from; when cards.mjs lands, both should read one shared token list.
const TOKENS = {
  ground: "#0B0C0D", surface: "#141618", surface2: "#1D2023",
  line: "#33393D", lineSoft: "#24282B",
  ink: "#F3F5F6", ink2: "#A6AEB3", ink3: "#7B848A",
  accent: "#DCE9F0", accentSoft: "#1C2A33",
  mark: "#37D2E8", cold: "#37D2E8", coldSoft: "#0C2E34",
  warm: "#FF5B35",
};

// The hill inks the site actually renders, read back out of the built page so
// the contrast correction in build.mjs is honoured without duplicating it.
function hillInks() {
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  const out = {};
  for (const m of html.matchAll(/\.hm\[data-hill="([^"]+)"\]\{color:(#[0-9a-fA-F]{6})\}/g)) {
    out[m[1]] = m[2];
  }
  if (!Object.keys(out).length) throw new Error("no hill inks in index.html -- run scripts/build.mjs first");
  return out;
}
const INK = hillInks();
const ink = slug => INK[slug] ?? TOKENS.ink;
const nameOf = slug => resorts[slug]?.name ?? slug;

// ------------------------------------------------------------------ dates
const MONTHS = ["January","February","March","April","May","June",
                "July","August","September","October","November","December"];
const SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const parse = iso => new Date(`${iso}T12:00:00`);
const dayMonth = iso => { const d = parse(iso); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
const shortDate = iso => { const d = parse(iso); return `${SHORT[d.getMonth()]} ${d.getDate()}`; };

// The site's own countdown, imported rather than reimplemented. The two used
// to disagree by a day.
import { daysUntil } from "../scripts/lib/days.mjs";

// ------------------------------------------------------------------- html
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const dataUri = rel => {
  const buf = readFileSync(join(ROOT, rel));
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
};

// The site's wordmark, lowercase, "shred" in the accent.
const MARK = `<span class="wm">when can i <em>shred</em>?</span>`;
const DOMAIN = `whencanishred.com`;

// A projected date must never appear without the site's own label for how it
// was arrived at. This is the one rule the cards are not allowed to relax.
const LABEL = {
  model:   n => `median of ${n > 1 ? "each resort's" : "this resort's"} own record`,
  climate: n => `estimated from cold hours -- no record ${n > 1 ? "for these" : "yet"}`,
  peer:    () => "projected from a similar hill's record",
  target:  () => "the resort's own date",
};
const provenance = (label, n = 1) =>
  `<span class="prov"><span class="prov-k">${esc(label)}</span>${esc(LABEL[label]?.(n) ?? "")}</span>`;

const PRECISION_NOTE = {
  exact:   "",
  bracket: "±",
};
const prec = p => PRECISION_NOTE[p] ? `<span class="pm" title="dated to a window, not a day">±</span>` : "";


const places = read("data/places.json");

// ------------------------------------------------------------------ cards
//
// Each entry is one frame. `post` groups frames into a single Instagram post,
// so a carousel is several frames sharing one caption.

const cards = [];
const card = (o) => { cards.push(o); return o; };

// -- 15 ---------------------------------------- opening days, region by region
//
// Every hill on the Minnesota board, grouped as the board groups them, with
// where it stands: the day it opened, the day it has posted, or the range the
// site projects. Read from the same files the board is, so the post and the
// page cannot disagree on a date.
const POD_SEASON = "2026-27";
const REGION_AREAS = [
  { id: "metro",   name: "Twin Cities" },
  { id: "north",   name: "Duluth & the North" },
  { id: "central", name: "Central & West" },
  { id: "south",   name: "Southern" },
];
const statedNow = existsSync(join(ROOT, "data/stated.json")) ? read("data/stated.json").hills : {};
const WEEKDAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const wd = iso => `${WEEKDAYS[parse(iso).getDay()]} ${shortDate(iso)}`;
const standingOf = slug => {
  const p = projection[slug];
  const opened = seasons[slug]?.[POD_SEASON]?.firstLift?.date;
  if (opened) return { k: "Opened", v: wd(opened), open: true };
  if (p.label === "target" && statedNow[slug]?.date === p.date) return { k: "Posted", v: wd(p.date) };
  const lo = p.range?.lo ?? p.date, hi = p.range?.hi ?? p.date;
  return { k: "Projected", v: lo === hi ? shortDate(lo) : `${shortDate(lo)} – ${shortDate(hi)}` };
};
const regionHills = id => Object.keys(resorts).filter(s => resorts[s].area === id)
  .sort((a, b) => (projection[a].range?.lo ?? projection[a].date).localeCompare(projection[b].range?.lo ?? projection[b].date)
    || nameOf(a).localeCompare(nameOf(b)));
const OPEN_COUNT = REGION_AREAS.flatMap(a => regionHills(a.id)).filter(s => standingOf(s).open).length;
const ALL_COUNT = REGION_AREAS.flatMap(a => regionHills(a.id)).length;
const RN = REGION_AREAS.length + 1;

card({
  post: 15, name: "regions-cover", kind: `Feed · carousel 1/${RN}`, w: 1080, h: 1080,
  title: "Opening days by region",
  body: `
  <div class="c photo">
    <img src="${dataUri("photos/buck-hill-snowing-840.jpg")}" alt="">
    <div class="scrim scrim-day"></div>
    <div class="pad col">
    <div class="top">${MARK}<span class="pg">1/${RN}</span></div>
    <div class="grow col" style="gap:26px; justify-content:center">
      <p class="kicker cyan">Minnesota &middot; ${POD_SEASON}</p>
      <h2 class="mid" style="font-size:84px">Opening days,<br>region by region</h2>
      <p class="sub" style="font-size:32px"><b>${OPEN_COUNT} of ${ALL_COUNT}</b> hills are open.</p>
    </div>
    <div class="rule tape"></div>
    <p class="foot">${DOMAIN}<span class="swipe">swipe &rarr;</span></p>
    </div>
  </div>`,
});

for (const [i, a] of REGION_AREAS.entries()) {
  const hills = regionHills(a.id);
  card({
    post: 15, name: `regions-${a.id}`, kind: `Feed · carousel ${i + 2}/${RN}`, w: 1080, h: 1080,
    body: `
  <div class="c col pad">
    <div class="top">${MARK}<span class="pg">${i + 2}/${RN}</span></div>
    <div class="grow col" style="gap:${hills.length > 6 ? 18 : 26}px; justify-content:center">
      <p class="kicker cyan">Opening days &middot; ${POD_SEASON}</p>
      <h2 class="mid" style="font-size:64px">${esc(a.name)}</h2>
      <div style="display:flex; flex-direction:column; gap:${hills.length > 6 ? 12 : 18}px; margin-top:6px">
        ${hills.map(s => { const st = standingOf(s); return `<div style="display:flex; justify-content:space-between; align-items:baseline; gap:20px; border-bottom:1px solid ${TOKENS.line}; padding-bottom:${hills.length > 6 ? 10 : 14}px">
          <span style="font-size:${hills.length > 6 ? 34 : 40}px; font-weight:800; color:${ink(s)}">${esc(nameOf(s))}</span>
          <span style="text-align:right; white-space:nowrap">
            <span style="font-size:20px; font-weight:800; letter-spacing:.12em; text-transform:uppercase; color:${st.open ? TOKENS.cold : TOKENS.ink3}">${st.k}</span>
            <span class="mid" style="font-size:${hills.length > 6 ? 34 : 40}px; margin-left:12px; color:${st.open ? TOKENS.ink : TOKENS.ink2}">${esc(st.v)}</span>
          </span>
        </div>`; }).join("\n        ")}
      </div>
    </div>
    <div class="rule tape"></div>
    <p class="foot">${DOMAIN}<span class="swipe">${i === REGION_AREAS.length - 1 ? "" : "swipe &rarr;"}</span></p>
  </div>`,
  });
}

const CAPTIONS = {};

// -------------------------------------------------------------------- css
const CARD_CSS = `
:root{
  --ground:${TOKENS.ground}; --surface:${TOKENS.surface}; --surface-2:${TOKENS.surface2};
  --line:${TOKENS.line}; --line-soft:${TOKENS.lineSoft};
  --ink:${TOKENS.ink}; --ink-2:${TOKENS.ink2}; --ink-3:${TOKENS.ink3};
  --accent:${TOKENS.accent}; --accent-soft:${TOKENS.accentSoft};
  --mark:${TOKENS.mark}; --cold:${TOKENS.cold}; --cold-soft:${TOKENS.coldSoft};
  --warm:${TOKENS.warm};
}
.frame{
  background:var(--ground); color:var(--ink); overflow:hidden; position:relative;
  font-family:Archivo,"Helvetica Neue",Arial,sans-serif;
  -webkit-font-smoothing:antialiased;
}
.frame *{box-sizing:border-box; margin:0;}
.c{width:100%; height:100%; position:relative;}
.col{display:flex; flex-direction:column;}
.pad{padding:64px 68px;}
.grow{flex:1; display:flex; flex-direction:column; min-height:0;}
.grow.center{justify-content:center;}
.gap{gap:34px;}
.cyan{color:var(--cold);} .warm{color:var(--warm);}

/* Display type is Anton throughout, as the site forces it to be. */
.wm,.huge,.big2,.mid,.temp-n,.temp-u,.date-h,.date-y,.who,.cd-n,.cd-u,
.tri-v,.thresh-v,.box-v,.box-h,.box-d,.why-v,.bar-n,.race th,.race td,.cta,.gap-h{
  font-family:Anton,"Archivo Narrow",Impact,sans-serif; font-weight:400;
}

.top{display:flex; align-items:baseline; justify-content:space-between; flex:none; margin-bottom:32px;}
.wm{font-size:34px; letter-spacing:.005em; color:var(--ink);}
.wm em{color:var(--mark); font-style:normal;}
.pg{font-size:20px; font-weight:600; color:var(--ink-3); letter-spacing:.1em;}

.kicker{
  font-size:22px; font-weight:700; letter-spacing:.15em; text-transform:uppercase;
  color:var(--ink-3);
}
.kicker.cyan{color:var(--cold);} .kicker.warm{color:var(--warm);}

.huge{font-size:104px; line-height:.94; letter-spacing:-.015em; margin-top:20px;}
.big2{font-size:118px; line-height:.92; letter-spacing:-.02em; margin-top:22px;}
.mid{font-size:70px; line-height:1.0; letter-spacing:-.01em;}

.sub{font-size:29px; line-height:1.42; color:var(--ink-2); max-width:34ch;}
.sub.big-sub{font-size:33px; color:var(--ink);}
.sub b{color:var(--ink); font-weight:700;}
.sub b.warm,.who-n b.warm{color:var(--warm);}
.sub b.cyan,.who-n b.cyan{color:var(--cold);}
.center-t{margin:24px auto 0; text-align:center;}

.rule{height:12px; margin-top:32px; flex:none;}
.tape{background:repeating-linear-gradient(45deg,var(--accent) 0 10px,transparent 10px 20px);}
.foot{
  display:flex; justify-content:space-between; align-items:baseline;
  font-size:23px; font-weight:700; letter-spacing:.05em; color:var(--ink-2);
  padding-top:22px; flex:none;
}
.swipe{color:var(--ink-3); font-weight:600; letter-spacing:.1em; text-transform:uppercase; font-size:19px;}

/* photo card */
.photo img{position:absolute; inset:0; width:100%; height:100%; object-fit:cover;}
.photo .scrim{
  position:absolute; inset:0;
  background:linear-gradient(180deg,rgba(11,12,13,.55) 0%,rgba(11,12,13,.2) 32%,rgba(11,12,13,.93) 74%,rgba(11,12,13,.99) 100%);
}
.photo .pad{position:relative; height:100%;}
.photo .scrim-even{
  background:linear-gradient(180deg,rgba(11,12,13,.86) 0%,rgba(11,12,13,.78) 45%,rgba(11,12,13,.92) 100%);
}

/* the 28 degree slide */
.temp{display:flex; align-items:flex-start; justify-content:center; margin:8px 0 4px;}
.temp-n{font-size:300px; line-height:.82; letter-spacing:-.03em; color:var(--cold);}
.temp-u{font-size:96px; color:var(--cold); margin-top:26px;}
.mid + .sub{margin-top:4px;}
.ctr{text-align:center;}
.ctr .mid{margin-top:10px;}
.ctr .sub{margin-left:auto; margin-right:auto;}

/* two-up boxes */
.two{display:grid; grid-template-columns:1fr 1fr; gap:26px;}
.box{
  border:2px solid var(--line); border-radius:4px; padding:32px 30px;
  background:var(--surface); display:flex; flex-direction:column; gap:10px;
}
.box-k{font-size:21px; font-weight:800; letter-spacing:.12em; text-transform:uppercase; color:var(--ink-3);}
.box-v{font-size:52px; line-height:1;}
.box-h{font-size:66px; line-height:1; display:flex; align-items:baseline; gap:12px; flex-wrap:wrap;}
.box-hu{font-family:Archivo,sans-serif; font-size:19px; font-weight:600; color:var(--ink-3); letter-spacing:.04em;}
.box-d{font-size:44px; line-height:1; color:var(--ink);}
.box-n{font-size:21px; line-height:1.35; color:var(--ink-3); font-weight:500;}

.prov{display:block; margin-top:6px; font-size:17px; line-height:1.3; color:var(--ink-3);}
.prov-k{
  display:inline-block; font-size:15px; font-weight:800; letter-spacing:.12em;
  text-transform:uppercase; color:var(--cold); border:1px solid var(--cold);
  border-radius:3px; padding:2px 7px; margin-right:8px;
}

/* bars */
.bars{display:flex; flex-direction:column; gap:17px;}
.bar{display:grid; grid-template-columns:270px 1fr 74px; align-items:center; gap:20px;}
.bar-l{font-size:24px; font-weight:700; letter-spacing:.01em;}
.bar-t{height:20px; background:var(--surface-2); border-radius:2px; overflow:hidden;}
.bar-f{display:block; height:100%;}
.bar-n{font-size:32px; text-align:right; font-variant-numeric:tabular-nums; color:var(--ink);}

/* race table */
.race{width:100%; border-collapse:collapse; font-variant-numeric:tabular-nums;}
.race th{
  font-family:Archivo,sans-serif; font-size:20px; font-weight:800; text-transform:uppercase;
  letter-spacing:.08em; text-align:right; padding:0 0 14px; border-bottom:2px solid var(--line);
}
.race th:first-child{text-align:left;}
.race td{font-size:34px; text-align:right; padding:12px 0; border-bottom:1px solid var(--line-soft); color:var(--ink-3);}
.race td.rw{color:var(--ink);}
.race td .win{
  display:block; font-family:Archivo,sans-serif; font-style:normal; font-size:17px;
  font-weight:600; letter-spacing:.04em; color:var(--ink-3); margin-top:1px;
}
.rkey{font-size:23px; line-height:1.45; color:var(--ink-3); margin:22px 0 0;}
.rkey b{color:var(--ink-2); font-weight:700;}
.race .ry{
  font-family:Archivo,sans-serif; font-size:23px; font-weight:700; text-align:left; color:var(--ink-2);
  letter-spacing:.02em;
}
.pm{color:var(--cold); font-size:.7em; vertical-align:super; margin-left:2px;}

/* big date cards */
.date-h{font-size:130px; line-height:.94; letter-spacing:-.02em; margin-top:14px; text-align:center;}
.date-y{font-size:74px; line-height:1; color:var(--ink-3); text-align:center; letter-spacing:-.01em;}
.whold{margin-top:40px; text-align:center;}
.who{font-size:56px; line-height:1.06; text-align:center;}
.who-n{font-size:27px; line-height:1.4; color:var(--ink-2); margin-top:12px; text-align:center;
  max-width:30ch; margin-left:auto; margin-right:auto;}
.who-n b{font-weight:700;}
.why{
  margin-top:44px; border-top:2px solid var(--line); padding-top:30px;
  display:flex; flex-direction:column; gap:6px; align-items:center;
}
.why-k{font-size:20px; font-weight:800; letter-spacing:.12em; text-transform:uppercase; color:var(--ink-3); text-align:center;}
.why-v{font-size:60px; line-height:1.06; display:flex; align-items:baseline; gap:14px;}
.why-u{font-family:Archivo,sans-serif; font-size:20px; font-weight:600; color:var(--ink-3); letter-spacing:.03em;}

/* gaps */
.gaps{display:flex; flex-direction:column; gap:0; border-top:2px solid var(--line);}
.gap-r{
  display:grid; grid-template-columns:1fr 132px 116px; align-items:baseline; gap:14px;
  padding:11px 0; border-bottom:1px solid var(--line-soft);
}
.gap-n{font-size:29px; font-weight:700; line-height:1.15;}
.gap-h{font-size:27px; text-align:right; color:var(--ink-2); font-variant-numeric:tabular-nums;}
.gap-hu{font-family:Archivo,sans-serif; font-size:15px; font-weight:600; color:var(--ink-3); margin-left:5px;}
.gap-d{
  font-size:14px; font-weight:800; letter-spacing:.1em; text-transform:uppercase;
  color:var(--warm); text-align:right;
}

.cta{
  font-size:56px; margin-top:34px; color:var(--cold); text-align:center; letter-spacing:-.01em;
}

/* stories */
.story{padding:64px 68px;}
.safe-t{height:180px; flex:none;}
.safe-b{height:210px; flex:none;}
.cd{display:flex; align-items:baseline; justify-content:center; gap:22px; margin:26px 0 0;}
.cd-n{font-size:280px; line-height:1; letter-spacing:-.035em;}
.cd-u{font-size:82px; color:var(--ink-3);}
.cd-who{margin-top:26px; text-align:center; display:flex; flex-direction:column; align-items:center;}
.fc-mini{
  margin-top:56px; border:2px solid var(--line); border-radius:4px; background:var(--surface);
  padding:34px 34px; display:flex; flex-direction:column; gap:10px;
}
.fc-k{font-size:20px; font-weight:800; letter-spacing:.14em; text-transform:uppercase; color:var(--ink-3);}
.fc-v{font-size:33px; line-height:1.32; color:var(--ink-2);}
.fc-v b{font-weight:700;}
.fc-n{font-size:24px; color:var(--ink-3);}
.linkzone{flex:none; display:flex; flex-direction:column; align-items:center; gap:14px; padding-bottom:8px;}
.linkpill{
  font-size:30px; font-weight:700; color:var(--ground); background:var(--accent);
  border-radius:999px; padding:18px 38px; letter-spacing:.01em;
}
.linkhint{
  font-size:18px; font-weight:700; letter-spacing:.14em; text-transform:uppercase;
  color:var(--ink-3); border:1px dashed var(--line); border-radius:3px; padding:8px 16px;
}

/* region stories */
.rsubs{display:flex; flex-direction:column; gap:16px;}
.rsub{
  display:grid; grid-template-columns:1fr auto; align-items:center; gap:24px;
  border:2px solid var(--line); border-radius:4px; background:var(--surface);
  padding:28px 32px;
}
.rsub-k{
  font-family:Anton,Impact,sans-serif; font-weight:400; font-size:42px;
  line-height:1.04; letter-spacing:-.005em; color:var(--ink);
}
.rsub-n{font-size:21px; color:var(--ink-3); font-weight:600; margin-top:4px;}
.rsub-r{text-align:right;}
.rsub-v{
  font-family:Anton,Impact,sans-serif; font-weight:400; font-size:60px; line-height:1;
  color:var(--cold); font-variant-numeric:tabular-nums;
}
.rsub-u{
  font-family:Archivo,sans-serif; font-size:20px; font-weight:600;
  color:var(--ink-3); letter-spacing:.04em; margin-left:8px;
}
.rsub-d{font-size:19px; color:var(--ink-2); font-weight:600; margin-top:6px;}
.rsub-key{font-size:23px; line-height:1.45; color:var(--ink-3);}
.rsub-key b{color:var(--ink-2); font-weight:700;}

/* The homepage hero's three scenarios, same shape as templates/index.html. */
.scens{display:flex; align-items:flex-end; justify-content:center; gap:44px; flex-wrap:wrap;}
.scen{display:flex; flex-direction:column; align-items:center; text-align:center;}
.scen-num{
  font-family:Anton,Impact,sans-serif; font-weight:400; font-size:78px; line-height:.9;
  letter-spacing:-.02em; color:var(--ink-2); font-variant-numeric:tabular-nums;
}
.scen-real .scen-num{font-size:132px; color:var(--ink);}
.scen-unit{
  font-family:Anton,Impact,sans-serif; font-size:.36em; color:var(--ink-3);
  margin-left:.12em; letter-spacing:0;
}
.scen-date{
  font-family:Anton,Impact,sans-serif; font-weight:400; font-size:34px;
  margin-top:14px; color:var(--ink-2);
}
.scen-real .scen-date{color:var(--accent);}
.scen-lede{
  font-size:17px; font-weight:800; letter-spacing:.1em; text-transform:uppercase;
  color:var(--ink-3); margin-top:8px; line-height:1.5;
}
.scen-yr{display:block; letter-spacing:.06em; opacity:.75; font-weight:600;}

/* The resorts still missing a date. A list is the whole card, so it columns
   rather than scrolls, and the type sizes to the count. */
.need{list-style:none; padding:0; margin:0; column-gap:36px;}
.need li{
  line-height:1.5; color:var(--ink); font-weight:600;
  break-inside:avoid; letter-spacing:.005em;
}
.need li::before{content:"\\2022"; color:var(--warm); margin-right:10px; font-weight:800;}

/* The record's outer edges, side by side. */
.ext{display:grid; grid-template-columns:1fr 1fr; gap:26px;}
.ext-r{
  border:2px solid var(--line); border-radius:4px; background:var(--surface);
  padding:32px 30px; display:flex; flex-direction:column; gap:4px;
}
.ext-k{
  font-size:21px; font-weight:800; letter-spacing:.14em; text-transform:uppercase;
  color:var(--cold);
}
.ext-k.warm{color:var(--warm);}
.ext-d{font-family:Anton,Impact,sans-serif; font-weight:400; font-size:66px; line-height:1.02; letter-spacing:-.01em;}
.ext-y{font-family:Anton,Impact,sans-serif; font-weight:400; font-size:38px; line-height:1; color:var(--ink-3);}
.ext-w{font-size:26px; font-weight:700; line-height:1.3; margin-top:10px;}

/* The gap, stated on every region slide: what exists against what we hold. */
.gapbar{
  display:flex; align-items:baseline; justify-content:space-between; gap:18px;
  border-top:2px solid var(--line); padding-top:16px;
}
.gapbar-k{font-size:22px; font-weight:700; color:var(--ink-2);}
.gapbar-v{
  font-size:19px; font-weight:800; letter-spacing:.1em; text-transform:uppercase;
  color:var(--cold);
}
.gapbar-v.none{color:var(--warm);}

/* powder */
.pow{
  border:2px solid var(--line); border-radius:4px; background:var(--surface);
  padding:34px 34px; display:flex; flex-direction:column; gap:14px;
}
.pow.empty{background:none; border-style:dashed;}
.pow-hill{font-family:Anton,Impact,sans-serif; font-weight:400; font-size:56px; line-height:1;}
.pow-when{font-size:27px; color:var(--ink-2); font-weight:600;}
.pow-n{display:flex; align-items:center; gap:22px; flex-wrap:wrap; margin-top:4px;}
.pow-sep{width:2px; height:44px; background:var(--line);}
.pow-v{
  font-family:Anton,Impact,sans-serif; font-weight:400; font-size:78px; line-height:1;
  color:var(--cold); display:flex; align-items:baseline;
}
.pow-u{font-family:Archivo,sans-serif; font-size:24px; font-weight:600; color:var(--ink-3); margin-left:6px;}
.pow-v2{
  font-family:Anton,Impact,sans-serif; font-weight:400; font-size:46px; line-height:1;
  color:var(--ink); display:flex; align-items:baseline;
}
.pow-u2{font-family:Archivo,sans-serif; font-size:18px; font-weight:600; color:var(--ink-3); margin-left:6px;}
.pow-grade{
  font-size:20px; font-weight:800; letter-spacing:.14em; text-transform:uppercase;
  border-radius:3px; padding:9px 16px; align-self:flex-start; margin-top:4px;
}
.pow-grade.fresh{color:var(--ink-2); border:1px solid var(--line);}
.pow-grade.good{color:var(--cold); border:1px solid var(--cold); background:var(--cold-soft);}
.pow-grade.big{color:var(--ground); background:var(--cold);}

/* A sample frame says so on its face, so it cannot be posted by accident. */
.sample-flag{
  position:absolute; top:0; left:0; right:0; z-index:5; text-align:center;
  font-size:22px; font-weight:800; letter-spacing:.16em; text-transform:uppercase;
  color:var(--ground); background:var(--warm); padding:14px 0;
}

/* triad */
.triad{display:grid; grid-template-columns:1fr; gap:20px;}
.tri{
  display:grid; grid-template-columns:1fr auto; align-items:center; gap:20px;
  border:2px solid var(--line); border-radius:4px; background:var(--surface); padding:30px 34px;
}
.tri-k{font-size:36px; font-weight:800; letter-spacing:.02em; color:var(--ink);}
.tri-n{font-size:20px; color:var(--ink-3); font-weight:600; grid-column:1;}
.tri-v{font-size:78px; line-height:.9; grid-row:1 / span 2; grid-column:2; display:flex; align-items:flex-start;}
.tri-u{font-size:30px; margin-top:8px;}
.thresh{
  display:flex; align-items:baseline; justify-content:center; gap:16px;
  border-top:2px solid var(--cold); border-bottom:2px solid var(--cold);
  padding:22px 0; background:var(--cold-soft);
}
.thresh-l{font-size:24px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--ink-2);}
.thresh-v{font-size:62px; line-height:1; color:var(--cold);}
`;

// --------------------------------------------------------- cards.html
//
// Every frame at true pixel size, one per screen, for screenshotting.

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Anton&family=Archivo:wght@400;500;600;700;800&display=swap">`;

const sheet = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>whencanishred · card sheet</title>
${FONTS}
<style>
body{margin:0; background:#000; display:flex; flex-direction:column; align-items:center; gap:40px; padding:40px 0;}
${CARD_CSS}
.frame{flex:none;}
.tag{font-family:Archivo,sans-serif; color:#7B848A; font-size:13px; letter-spacing:.12em;
  text-transform:uppercase; font-weight:700;}
</style></head><body>
${cards.map(c => `<p class="tag">${c.name} &middot; ${c.w}&times;${c.h}</p>
<div class="frame" id="${c.name}" style="width:${c.w}px;height:${c.h}px">${c.body}</div>`).join("\n")}
</body></html>`;

mkdirSync(join(HERE, "out"), { recursive: true });
writeFileSync(join(HERE, "cards.html"), sheet);

// Drop frames that no longer exist. Without this a cut frame keeps its PNG in
// out/ and stays queueable -- which is exactly how a deleted claim gets posted.
{
  const live = new Set(cards.flatMap(c => [`${c.name}.html`, `${c.name}.png`]));
  const keep = /^(contact\.(html|png))$/;
  for (const f of readdirSync(join(HERE, "out"))) {
    if (live.has(f) || keep.test(f)) continue;
    unlinkSync(join(HERE, "out", f));
    console.log(`  removed stale ${f}`);
  }
}

// One file per frame, sized exactly to the frame, so headless Chrome's
// whole-viewport screenshot is the frame and nothing else. No cropping step,
// and no dependency beyond the Chrome already on the machine.
for (const c of cards) {
  writeFileSync(join(HERE, "out", `${c.name}.html`), `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
${FONTS}
<style>
html,body{margin:0; padding:0; width:${c.w}px; height:${c.h}px; overflow:hidden;}
${CARD_CSS}
.frame{width:${c.w}px; height:${c.h}px;}
</style></head><body><div class="frame">${c.body}</div></body></html>`);
}

// --------------------------------------------------------- review.html
//
// The page to actually look at: every frame scaled to fit beside its caption,
// grouped by post, in posting order. Published as an Artifact.

const SCALE = { 1080: 0.42 };
const scaleFor = c => (c.h > 1400 ? 0.235 : 0.42);

const allPosts = [...new Set(cards.map(c => c.post))].sort((a, b) => a - b);

// One post's block on the review page -- frames on the left, words on the right.
const postBlock = p => {
  const frames = cards.filter(c => c.post === p);
  const cap = CAPTIONS[p] ?? {};
  const lead = frames[0];
  // The title comes off the lead frame when there is no caption entry. David
  // writes his own copy, so a missing caption is normal, not an error.
  const title = cap.title ?? lead.title ?? lead.name;
  return `  <section class="post">
    <div class="p-head">
      <span class="p-n">${String(p).padStart(2, "0")}</span>
      <h2 class="p-t">${title}</h2>
      <span class="p-k">${esc(lead.kind.split(" \u00b7 ")[0])}</span>
      ${cap.when ? `<span class="p-w">${esc(cap.when)}</span>` : ""}
    </div>
    <div class="frames">
${frames.map(c => {
  const s = scaleFor(c);
  return `      <figure class="shot" style="width:${Math.round(c.w * s)}px;height:${Math.round(c.h * s)}px">
        <div class="frame" style="width:${c.w}px;height:${c.h}px;transform:scale(${s})">${c.body}</div>
        <figcaption>${esc(c.name)} &middot; ${c.w}&times;${c.h}</figcaption>
      </figure>`;
}).join("\n")}
    </div>
    ${cap.alt ? `<div class="side">
      <div class="blk">
        <h3>Alt text</h3>
        <p class="alt">${esc(cap.alt)}</p>
      </div>
    </div>` : ""}
  </section>`;
};

const review = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Shred &middot; posts</title>
${FONTS}
<style>
*{box-sizing:border-box;}
img{max-width:100%;}
${CARD_CSS}

/* ---- review chrome. Same palette, but plainly a working document. ---- */
:root{ --page:#08090A; --panel:#101214; --edge:#22262A; }
body{
  background:var(--page); color:var(--ink);
  font-family:Archivo,"Helvetica Neue",Arial,sans-serif; font-size:15px; line-height:1.6;
}
.shell{max-width:1180px; margin:0 auto; padding:0 28px 100px;}

header.head{
  display:flex; flex-wrap:wrap; gap:18px 32px; align-items:baseline;
  justify-content:space-between; padding:44px 0 22px;
}
.h-mark{font-family:Anton,Impact,sans-serif; font-size:30px; letter-spacing:.005em;}
.h-mark em{font-style:italic; color:var(--accent);}
.h-meta{font-size:13px; color:var(--ink-3); letter-spacing:.1em; text-transform:uppercase; font-weight:700;}
.head-rule{height:10px; background:repeating-linear-gradient(45deg,var(--accent) 0 10px,transparent 10px 20px);}

.lede{max-width:66ch; padding:34px 0 10px;}
.lede h1{
  font-family:Anton,Impact,sans-serif; font-weight:400; font-size:clamp(38px,6vw,62px);
  line-height:1.0; letter-spacing:-.015em; text-wrap:balance; margin:0 0 18px;
}
.lede p{color:var(--ink-2); font-size:17px; margin:0 0 14px;}
.lede b{color:var(--ink); font-weight:700;}

.rails{
  display:grid; grid-template-columns:repeat(auto-fit,minmax(210px,1fr)); gap:2px;
  background:var(--edge); border:1px solid var(--edge); margin:30px 0 0;
}
.rail{background:var(--panel); padding:20px 22px;}
.rail dt{font-size:11px; font-weight:800; letter-spacing:.16em; text-transform:uppercase; color:var(--ink-3);}
.rail dd{margin:8px 0 0; font-family:Anton,Impact,sans-serif; font-size:34px; line-height:1; letter-spacing:-.01em;}
.rail dd small{font-family:Archivo,sans-serif; font-size:13px; font-weight:600; color:var(--ink-3); letter-spacing:.04em;}

/* ---- one post ---- */
.post{
  border-top:1px solid var(--edge); padding:52px 0 0; margin-top:52px;
  display:grid; grid-template-columns:minmax(0,auto) minmax(300px,1fr); gap:44px; align-items:start;
}
@media (max-width:900px){ .post{grid-template-columns:1fr;} }

.p-head{grid-column:1 / -1; display:flex; flex-wrap:wrap; gap:12px 20px; align-items:baseline;}
.p-n{
  font-family:Anton,Impact,sans-serif; font-size:15px; color:var(--ground);
  background:var(--accent); border-radius:2px; padding:3px 11px; letter-spacing:.06em;
}
.p-t{font-family:Anton,Impact,sans-serif; font-size:30px; letter-spacing:-.01em; line-height:1;}
.p-k{
  font-size:11px; font-weight:800; letter-spacing:.14em; text-transform:uppercase;
  color:var(--cold); border:1px solid var(--cold); border-radius:2px; padding:4px 9px;
}
.p-w{font-size:13px; color:var(--ink-3); font-weight:600; margin-left:auto;}

.frames{display:flex; gap:16px; flex-wrap:wrap; align-items:flex-start;}
.shot{position:relative; flex:none; border:1px solid var(--edge); background:#000; overflow:hidden;}
.shot .frame{transform-origin:top left;}
.shot figcaption{
  position:absolute; left:0; bottom:0; right:0; font-size:10px; font-weight:800;
  letter-spacing:.12em; text-transform:uppercase; color:var(--ink-3);
  background:rgba(8,9,10,.86); padding:5px 8px; backdrop-filter:blur(2px);
}

.side{display:flex; flex-direction:column; gap:22px; min-width:0;}
.blk h3{
  font-size:11px; font-weight:800; letter-spacing:.16em; text-transform:uppercase;
  color:var(--ink-3); margin:0 0 10px;
}
.cap{
  background:var(--panel); border:1px solid var(--edge); border-left:3px solid var(--accent);
  padding:20px 22px; font-size:15px; line-height:1.62; color:var(--ink);
  white-space:pre-wrap; overflow-wrap:break-word;
}
.alt{
  font-size:13.5px; line-height:1.55; color:var(--ink-2); background:var(--panel);
  border:1px solid var(--edge); border-left:3px solid var(--cold); padding:16px 18px;
}

/* ---- the chosen two ---- */
.wanted-head{max-width:66ch; padding:10px 0 0;}
.wanted-head h2{
  font-family:Anton,Impact,sans-serif; font-weight:400; font-size:34px;
  letter-spacing:-.01em; margin:0 0 12px;
}
.wanted-head p{margin:0; color:var(--ink-2); font-size:15px;}
.wanted-head + .post{border-top:none; padding-top:30px; margin-top:30px;}

/* ---- parked ---- */
.parked-head{
  border-top:1px solid var(--edge); margin-top:60px; padding-top:44px; max-width:66ch;
}
.parked-head h2{
  font-family:Anton,Impact,sans-serif; font-weight:400; font-size:34px;
  letter-spacing:-.01em; margin:0 0 12px; color:var(--ink-3);
}
.parked-head p{margin:0; color:var(--ink-3); font-size:15px;}
.parked-head + .post{border-top:none; padding-top:26px; margin-top:26px; opacity:.72;}
.parked-head ~ .post{opacity:.72;}
.parked-head ~ .post:hover{opacity:1;}

/* ---- closing notes ---- */
.notes{border-top:1px solid var(--edge); margin-top:60px; padding-top:44px;}
.notes h2{font-family:Anton,Impact,sans-serif; font-weight:400; font-size:34px; letter-spacing:-.01em; margin:0 0 22px;}
.nlist{display:grid; gap:2px; background:var(--edge); border:1px solid var(--edge);}
.n{background:var(--panel); padding:22px 24px; display:grid; grid-template-columns:34px 1fr; gap:18px;}
.n-i{
  font-family:Anton,Impact,sans-serif; font-size:20px; color:var(--cold);
  line-height:1.2;
}
.n-b h4{font-size:16px; margin:0 0 6px; font-weight:800; letter-spacing:.01em;}
.n-b p{margin:0; color:var(--ink-2); font-size:14.5px; line-height:1.6;}
.n-b p + p{margin-top:8px;}
.n-b code{
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.9em;
  background:var(--surface-2); padding:1px 5px; border-radius:2px; color:var(--accent);
}
footer.foot-r{
  margin-top:54px; padding-top:22px; border-top:1px solid var(--edge);
  font-size:12.5px; color:var(--ink-3); display:flex; flex-wrap:wrap; gap:8px 24px;
}
</style></head>
<body>
<div class="shell">
  <header class="head">
    <span class="h-mark">when can i <em>shred</em>?</span>
    <span class="h-meta">Instagram &middot; for review</span>
  </header>

${allPosts.map(postBlock).join("\n")}

</div>
</body></html>`;

writeFileSync(join(HERE, "review.html"), review);
console.log(`social/cards.html   ${cards.length} frames, social/review.html ${allPosts.length} post${allPosts.length === 1 ? "" : "s"}`);
