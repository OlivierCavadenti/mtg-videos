import "./styles.css";
import { FORMAT_NAMES } from "../shared/model.ts";
import { card, el, esc, fullDay, groupByFormat, loadArchive, localDay, number, plural, utc, type Item, type Loaded } from "./common.ts";

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

function daySection(day: string, list: Item[], heading: string): string {
  if (!list.length) return `<section class="day"><h2 class="day-title">${heading}</h2><p class="status">No video on this day.</p></section>`;
  const pick = pickOfTheDay(list);
  const podcasts = list.filter((v) => v.url !== undefined).length;
  const counts = podcasts ? `${plural(list.length - podcasts, "video")} and ${plural(podcasts, "podcast episode")}` : plural(list.length, "video");
  const pickBlock = pick
    ? `<section class="pick">
        <h3>Video of the day</h3>
        <p class="why">${String(pick.score).replace(/\.0$/, "")} times ${esc(pick.creatorName)}'s usual views${pick.dayAfter ? " the day after release" : ""}${pick.views ? ` (${number.format(pick.views)})` : ""}.</p>
        <div class="pick-card">${card(pick, data, { time: true, creatorLink: ARCHIVE })}</div>
      </section>`
    : "";
  // The video of the day leads; the format groups hold the others.
  const groups = groupByFormat(list.filter((v) => v !== pick))
    .map((g) => {
      const inner = g.bySet
        ? g.bySet
            .map(({ code, items }) => {
              const set = code ? data.setByCode.get(code) : undefined;
              const label = set
                ? `<a class="set-link" href="${ARCHIVE}?set=${esc(set.code.toLowerCase())}"><img src="${esc(set.icon)}" alt="" width="18" height="18" loading="lazy" />${esc(set.name)}</a>`
                : `<span>No set named</span>`;
              return `<section class="subgroup"><h4 class="subhead">${label} <span class="n">${number.format(items.length)}</span></h4><div class="grid">${items.map((v) => card(v, data, { time: true, creatorLink: ARCHIVE })).join("")}</div></section>`;
            })
            .join("")
        : `<div class="grid">${g.items.map((v) => card(v, data, { time: true, creatorLink: ARCHIVE })).join("")}</div>`;
      return `<section class="group"><h3>${esc(FORMAT_NAMES[g.format])} <span class="n">${number.format(g.items.length)}</span></h3>${inner}</section>`;
    })
    .join("");
  return `<section class="day" data-day="${day}"><h2 class="day-title">${heading}</h2><p class="dates">${counts}</p>${pickBlock}${groups}</section>`;
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
