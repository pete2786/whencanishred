// Renders index.html and one page per resort from the data files. Plain string
// substitution, no dependencies. Output is committed; GitHub Pages serves the
// repo root.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const read = f => JSON.parse(readFileSync(f, "utf8"));
const resorts = read("data/resorts.json");
const seasons = read("data/seasons.json");
const projection = read("data/projection.json");
const hoursRows = read("data/hours.json");

// data/hours.json keys hills by display name, and one of them is shorter than
// the name in the resort record.
const HOURS_ALIASES = { "lutsen": "lutsen-mountains" };

function slugify(name) {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return HOURS_ALIASES[s] ?? s;
}

const hours = Object.fromEntries(hoursRows.map(h => [slugify(h.hill), h]));

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const FULL = ["January","February","March","April","May","June","July","August",
              "September","October","November","December"];
const pretty = iso => iso ? `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}` : "&mdash;";

// Compare opening dates across seasons by their position in the snow year, so
// a January opening sorts after a November one rather than before it.
const snowDay = iso => {
  const m = Number(iso.slice(5, 7)), d = Number(iso.slice(8, 10));
  return (m >= 9 ? m - 9 : m + 3) * 31 + d;
};

// The typical opening is the median of the seasons we actually observed. With
// fewer than two, there is no habit to report and we say so.
function observed(slug) {
  const dates = Object.values(seasons[slug] ?? {})
    .map(s => s.firstLift?.date).filter(Boolean)
    .sort((a, b) => snowDay(a) - snowDay(b));
  if (dates.length < 2) return { typical: null, earliest: null, latest: null, n: dates.length };
  return {
    typical: dates[Math.floor((dates.length - 1) / 2)],
    earliest: dates[0], latest: dates.at(-1), n: dates.length,
  };
}

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const daysUntil = iso => Math.round((new Date(`${iso}T00:00:00`) - new Date()) / 86400000);

const GROUPS = [["twin-cities", "Twin Cities"], ["greater-minnesota", "Greater Minnesota"]];

function tableRows() {
  const out = [];
  for (const [region, title] of GROUPS) {
    out.push(`          <tr class="grp"><td colspan="6">${title}</td></tr>`);
    const slugs = Object.keys(resorts)
      .filter(s => resorts[s].region === region)
      .sort((a, b) => projection[a].date.localeCompare(projection[b].date));

    for (const [i, slug] of slugs.entries()) {
      const r = resorts[slug], p = projection[slug], h = hours[slug], o = observed(slug);
      const cls = region === GROUPS[0][0] && i === 0 ? ' class="first"' : "";
      const typical = o.typical
        ? `${pretty(o.typical)}<span class="rng">${pretty(o.earliest)} &ndash; ${pretty(o.latest)}</span>`
        : `&mdash;<span class="rng">${o.n === 1 ? "one season only" : "no record yet"}</span>`;
      const hrs = h
        ? `${h.normal}<span class="rng">${h.lean}&ndash;${h.fat}</span>`
        : `&mdash;`;

      out.push(
        `          <tr${cls}>`,
        `            <td class="hill"><a href="resorts/${slug}.html">${esc(r.name)}</a></td>`,
        `            <td class="where">${esc(r.place)}</td>`,
        `            <td>${pretty(p.date)}<span class="rng">${p.label}</span></td>`,
        `            <td class="num days">${daysUntil(p.date)}</td>`,
        `            <td class="num">${hrs}</td>`,
        `            <td>${typical}</td>`,
        `          </tr>`,
      );
    }
  }
  return out.join("\n");
}

function seasonRows(slug) {
  return Object.entries(seasons[slug] ?? {}).map(([season, ev]) => {
    const cell = e => {
      if (!e?.date) return "&mdash;";
      const tag = e.precision === "bracket" ? "about" : e.corroboration;
      return `${pretty(e.date)}<span class="rng">${tag}</span>`;
    };
    const kinds = [...new Set(ev.firstLift?.sources?.map(s => s.kind) ?? [])];
    return `          <tr><td>${season}</td><td>${cell(ev.firstLift)}</td>` +
           `<td>${cell(ev.fullOps)}</td><td>${cell(ev.close)}</td>` +
           `<td class="where">${esc(kinds.join(", ") || "none")}</td></tr>`;
  }).join("\n");
}

function socialLinks(r) {
  const links = [];
  if (r.social?.facebook) links.push(`<a href="https://facebook.com/${r.social.facebook}" target="_blank" rel="noopener">Facebook</a>`);
  if (r.social?.instagram) links.push(`<a href="https://instagram.com/${r.social.instagram}" target="_blank" rel="noopener">Instagram</a>`);
  return links.length ? " &middot; " + links.join(" &middot; ") : "";
}

const tally = () => {
  const all = Object.values(seasons).flatMap(s => Object.values(s)).map(e => e.firstLift);
  const withDate = all.filter(e => e.date);
  const confirmed = withDate.filter(e => e.corroboration === "confirmed").length;
  return { n: withDate.length, confirmed, total: all.length };
};

const t = tally();
const provenance =
  `${t.n} of ${t.total} opening dates sourced from archived resort pages and the resorts' own ` +
  `announcements, ${t.confirmed} corroborated by two independent sources. Blanks are gaps, not guesses.`;

const notice =
  `<strong>Part real.</strong> Wet-bulb curve, snowmaking hours and first-window dates are computed ` +
  `from 31 years of ERA5 data. Opening dates are sourced per hill and labelled with how firmly ` +
  `they are pinned. The projected column has not been recalibrated yet.`;

const now = new Date();
const dateline = `${now.getDate()} ${FULL[now.getMonth()]} ${now.getFullYear()}`;

const fill = (tpl, map) =>
  Object.entries(map).reduce((s, [k, v]) => s.replaceAll(`<!--{{${k}}}-->`, v), tpl);

// Homepage
const leader = Object.keys(projection).sort((a, b) => projection[a].date.localeCompare(projection[b].date))[0];
const lead = observed(leader);

writeFileSync("index.html", fill(readFileSync("templates/index.html", "utf8"), {
  TABLE: tableRows(),
  NOTICE: notice,
  DATELINE: dateline,
  HERO_DAYS: String(daysUntil(projection[leader].date)),
  HERO_LEADER: esc(resorts[leader].name),
  HERO_TYPICAL: pretty(lead.typical),
  HERO_EARLIEST: pretty(lead.earliest),
  HERO_LATEST: pretty(lead.latest),
  FOOTER_PROVENANCE: provenance,
}));

// Resort pages
mkdirSync("resorts", { recursive: true });
const resortTpl = readFileSync("templates/resort.html", "utf8");
for (const [slug, r] of Object.entries(resorts)) {
  const o = observed(slug);
  writeFileSync(`resorts/${slug}.html`, fill(resortTpl, {
    NAME: esc(r.name), PLACE: esc(`${r.place}, ${r.state}`), WEBSITE: esc(r.website),
    SOCIAL_LINKS: socialLinks(r),
    TYPICAL: pretty(o.typical), EARLIEST: pretty(o.earliest), LATEST: pretty(o.latest),
    HOURS: String(hours[slug]?.normal ?? "—"),
    SEASONS: seasonRows(slug),
    FOOTER_PROVENANCE: provenance,
  }));
}

console.error(`built index.html and ${Object.keys(resorts).length} resort pages`);
