import "./styles.css";
import { FORMAT_NAMES } from "../shared/model.ts";
import { duration, el, esc, fullDay, groupByFormat, loadArchive, localDay, plural, utc, type FormatGroup, type Item, type Loaded } from "./common.ts";

/**
 * The videos of one day, midnight to midnight in the reader's time zone, by format and set. The
 * video of the day is the one that did best against its creator's usual views, when one stands out.
 */

const ARCHIVE = "../";
/** A video of the day has at least half again its creator's usual views. */
const STANDS_OUT = 1.5;
let data: Loaded;

const shift = (day: string, days: number) => new Date(utc(day).getTime() + days * 86_400_000).toISOString().slice(0, 10);
const today = () => localDay(new Date());

function readDay(): { day: string; asked: boolean } {
  const d = new URLSearchParams(location.search).get("d");
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) ? { day: d, asked: true } : { day: today(), asked: false };
}

function pickOfTheDay(list: Item[]): Item | undefined {
  let best: Item | undefined;
  for (const v of list) if (v.score !== undefined && v.score >= STANDS_OUT && (!best || v.score > best.score!)) best = v;
  return best;
}

const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
const MIC = `<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="M12 3a4 4 0 0 0-4 4v5a4 4 0 0 0 8 0V7a4 4 0 0 0-4-4Zm-7 9a1 1 0 1 1 2 0 5 5 0 0 0 10 0 1 1 0 1 1 2 0 7 7 0 0 1-6 6.93V21h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3v-2.07A7 7 0 0 1 5 12Z"/></svg>`;

/** One video as a mosaic tile: the thumbnail, its title and who made it over the image. */
function tile(v: Item, pick = false): string {
  const creator = data.archive.creators[v.c]!;
  const set = v.set ? data.setByCode.get(v.set) : undefined;
  const image =
    v.url === undefined
      ? `<img src="https://i.ytimg.com/vi/${esc(v.id)}/${pick ? "hqdefault" : "mqdefault"}.jpg" alt="" loading="lazy" decoding="async" />`
      : `<span class="tile-mic">${MIC}</span>`;
  const meta = [
    `${esc(creator.name)}${creator.language === "fr" ? ' <span class="lang">FR</span>' : ""}`,
    time.format(new Date(v.at)),
    set ? esc(set.code) : "",
    ...(v.archetypes ?? []).slice(0, 1).map(esc),
  ].filter(Boolean);
  const why = pick
    ? `<p class="why">Video of the day · ${String(v.score).replace(/\.0$/, "")}× ${esc(creator.name)}'s usual views${v.dayAfter ? " the day after release" : ""}</p>`
    : "";
  return `<a class="mtile${pick ? " pick" : ""}" href="${esc(v.href)}" target="_blank" rel="noopener"${v.summary ? ` title="${esc(v.summary)}"` : ""}>
    ${image}${v.duration ? `<span class="len">${duration(v.duration)}</span>` : ""}
    <span class="over">${why}<span class="t">${esc(v.title)}</span><span class="meta">${meta.join(" · ")}</span></span>
  </a>`;
}

/** A format's title tile: its name, how many videos, and its sets for Limited and Cube. */
function labelTile(g: FormatGroup): string {
  const sets = (g.bySet ?? [])
    .map(({ code, items }) => {
      const set = code ? data.setByCode.get(code) : undefined;
      return set ? `<a href="${ARCHIVE}?set=${esc(set.code.toLowerCase())}"><img src="${esc(set.icon)}" alt="" width="14" height="14" />${esc(set.name)}</a> ${items.length}` : "";
    })
    .filter(Boolean)
    .join(" · ");
  return `<div class="mlabel"><span class="fmt">${esc(FORMAT_NAMES[g.format])}</span><span class="n">${plural(g.items.length, "video")}</span>${sets ? `<span class="sets">${sets}</span>` : ""}</div>`;
}

function daySection(day: string, list: Item[], heading: string): string {
  if (!list.length) return `<section class="day"><h2 class="day-title">${heading}</h2><p class="status">No video on this day.</p></section>`;
  const pick = pickOfTheDay(list);
  const podcasts = list.filter((v) => v.url !== undefined).length;
  const counts = podcasts ? `${plural(list.length - podcasts, "video")} and ${plural(podcasts, "podcast episode")}` : plural(list.length, "video");
  // The video of the day leads the mosaic; then each format, its title tile first, its sets in order.
  const tiles = [pick ? tile(pick, true) : ""];
  for (const g of groupByFormat(list.filter((v) => v !== pick))) {
    tiles.push(labelTile(g));
    for (const v of g.bySet ? g.bySet.flatMap((s) => s.items) : g.items) tiles.push(tile(v));
  }
  return `<section class="day" data-day="${day}"><h2 class="day-title">${heading} <span class="n">${counts}</span></h2><div class="mosaic">${tiles.join("")}</div></section>`;
}

function render() {
  const { day, asked } = readDay();
  const now = today();
  const first = data.archive.since;
  const onDay = (d: string) => data.items.filter((v) => v.day === d);
  const list = onDay(day);
  const label = fullDay.format(utc(day));
  document.title = `${day === now ? "Today" : label}: Magic videos of the day`;

  const prev = day > first ? `<a href="?d=${shift(day, -1)}" rel="prev">← ${esc(fullDay.format(utc(shift(day, -1))).replace(/ \d{4}$/, ""))}</a>` : "<span></span>";
  const next = day < now ? `<a href="?d=${shift(day, 1)}" rel="next">${esc(fullDay.format(utc(shift(day, 1))).replace(/ \d{4}$/, ""))} →</a>` : "<span></span>";
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  el("daynav").innerHTML = `
    ${prev}
    <span class="daynav-mid">
      ${day !== now ? `<a href="./">Today</a> · ` : ""}
      <label><span class="sr-only">Go to a day</span><input type="date" value="${day}" min="${first}" max="${now}" /></label>
    </span>
    ${next}`;
  el("dek").textContent = `Every video and podcast episode of the day, midnight to midnight (${zone}), by format and set.`;

  let html = daySection(day, list, day === now ? `Today, ${label}` : label);
  // Early in the day there is little yet: yesterday follows, whole.
  if (!asked && list.length < 5) {
    const yesterday = shift(day, -1);
    html += daySection(yesterday, onDay(yesterday), `Yesterday, ${fullDay.format(utc(yesterday))}`);
  }
  el("main").innerHTML = html;
}

function go(day: string) {
  history.pushState(null, "", day === today() ? "./" : `?d=${day}`);
  render();
  window.scrollTo({ top: 0 });
}

el("daynav").addEventListener("change", (e) => {
  const input = e.target as HTMLInputElement;
  if (input.type === "date" && input.value) go(input.value);
});
el("daynav").addEventListener("click", (e) => {
  const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a");
  if (!a) return;
  e.preventDefault();
  go(new URL(a.href).searchParams.get("d") ?? today());
});
document.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement || e.altKey || e.ctrlKey || e.metaKey) return;
  const { day } = readDay();
  if (e.key === "ArrowLeft" && day > data.archive.since) go(shift(day, -1));
  if (e.key === "ArrowRight" && day < today()) go(shift(day, 1));
});
window.addEventListener("popstate", render);

loadArchive()
  .then((loaded) => {
    data = loaded;
    render();
  })
  .catch((error: unknown) => {
    el("main").innerHTML = `<p class="status">The archive could not be loaded (${esc(String(error))}).</p>`;
  });
