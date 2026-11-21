import "./styles.css";
import { FORMAT_NAMES } from "../shared/model.ts";
import { COLOR_NAMES, duration, el, esc, fullDay, groupByFormat, loadArchive, localDay, pip, plural, utc, type FormatGroup, type Item, type Loaded } from "./common.ts";

/**
 * The videos of one day, midnight to midnight in the reader's time zone, by format and set. The
 * video of the day is the one that did best against its creator's usual views, when one stands out.
 */

const ARCHIVE = "../";
/** A video of the day has at least half again its creator's usual views. */
const STANDS_OUT = 1.5;
/** A format with this many videos or fewer shares a block with the other small ones. */
const SMALL = 2;
let data: Loaded;

const shift = (day: string, days: number) => new Date(utc(day).getTime() + days * 86_400_000).toISOString().slice(0, 10);
const today = () => localDay(new Date());

/** The day asked for in the URL (?d=YYYY-MM-DD), else today. */
function readDay(): string {
  const d = new URLSearchParams(location.search).get("d");
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) ? d : today();
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

const COMBINATIONS: Record<string, string> = {
  WU: "Azorius", UB: "Dimir", BR: "Rakdos", RG: "Gruul", WG: "Selesnya", WB: "Orzhov", UR: "Izzet", BG: "Golgari", WR: "Boros", UG: "Simic",
  WUB: "Esper", UBR: "Grixis", BRG: "Jund", WRG: "Naya", WUG: "Bant", WBG: "Abzan", WUR: "Jeskai", UBG: "Sultai", WBR: "Mardu", URG: "Temur",
};
const combination = (colors: string) =>
  colors.length === 1 ? `Mono-${COLOR_NAMES[colors]!.toLowerCase()}` : (COMBINATIONS[colors] ?? (colors.length === 4 ? "Four colors" : "Five colors"));

/** How many tile columns a group takes when there is room: the video of the day takes two by two. */
const columns = (l: Item[], pick: Item | undefined) => (pick && l.includes(pick) ? 2 + Math.ceil((l.length - 1) / 2) : l.length);

/** A CSS color for a color combination: its mana colors mixed in equal parts. */
const tint = (colors: string) =>
  [...colors]
    .map((c) => `var(--mana-${c.toLowerCase()})`)
    .reduce((mix, color, i) => `color-mix(in oklab, ${mix}, ${color} ${Math.round(100 / (i + 1))}%)`);

/** A rule in the combination's colors, side by side. */
const bar = (colors: string) =>
  `linear-gradient(90deg, ${[...colors].map((c, i) => `var(--mana-${c.toLowerCase()}) ${Math.round((i * 100) / colors.length)}% ${Math.round(((i + 1) * 100) / colors.length)}%`).join(", ")})`;

/** A framed group of tiles under a heading; tinted with its colors when it has some. */
function group(head: string, l: Item[], pick: Item | undefined, colors = ""): string {
  const style = `--cols:${columns(l, pick)}${colors ? `;--tint:${tint(colors)};--bar:${bar(colors)}` : ""}`;
  return `<div class="cgroup${colors ? " colored" : ""}" style="${style}"><p class="chead">${head}</p><div class="mosaic">${l.map((v) => tile(v, v === pick)).join("")}</div></div>`;
}

/**
 * A format's videos by colors played: one group per color combination (most videos first), then the
 * videos whose colors are not known. Without two videos with known colors, no grouping.
 */
function byColors(list: Item[], pick: Item | undefined): string {
  if (list.filter((v) => v.colors).length < 2) return `<div class="mosaic">${list.map((v) => tile(v, v === pick)).join("")}</div>`;
  const groups = new Map<string, Item[]>();
  for (const v of list) {
    const k = v.colors ?? "";
    const l = groups.get(k);
    if (l) l.push(v);
    else groups.set(k, [v]);
  }
  const keys = [...groups.keys()].sort(
    (a, b) => Number(Boolean(pick && groups.get(b)!.includes(pick))) - Number(Boolean(pick && groups.get(a)!.includes(pick))) || Number(a === "") - Number(b === "") || groups.get(b)!.length - groups.get(a)!.length,
  );
  return keys
    .map((k) => {
      const l = groups.get(k)!.sort((a, b) => Number(b === pick) - Number(a === pick));
      const archetypes = [...new Set(l.flatMap((v) => v.archetypes ?? []))].slice(0, 4);
      const heardOnly = l.every((v) => v.colorsHeard);
      const head = k
        ? `<span class="pips">${[...k].map((c) => pip(c)).join("")}</span> <strong>${combination(k)}</strong> <span class="n">${l.length}</span>${archetypes.length ? ` <span class="archs">${archetypes.map(esc).join(", ")}</span>` : ""}${heardOnly ? ' <span class="archs" title="Colors told by the cards discussed in the video">from the cards discussed</span>' : ""}`
        : `<strong>Colors not named</strong> <span class="n">${l.length}</span>`;
      return group(head, l, pick, k);
    })
    .join("");
}

/** A format's videos in their order: sets in order (Limited, Cube), the video of the day first. */
const inOrder = (g: FormatGroup, pick: Item | undefined) =>
  (g.bySet ? g.bySet.flatMap((s) => s.items) : g.items).sort((a, b) => Number(b === pick) - Number(a === pick));

/** The set names of a format's videos, for Limited and Cube. */
const setNames = (g: FormatGroup) =>
  (g.bySet ?? [])
    .map(({ code }) => (code ? data.setByCode.get(code)?.name : undefined))
    .filter((name): name is string => Boolean(name))
    .map(esc)
    .join(", ");

function daySection(day: string, list: Item[], heading: string): string {
  if (!list.length) return `<section class="day"><h2 class="day-title">${heading}</h2><p class="status">No video on this day.</p></section>`;
  const pick = pickOfTheDay(list);
  const podcasts = list.filter((v) => v.url !== undefined).length;
  const counts = podcasts ? `${plural(list.length - podcasts, "video")} and ${plural(podcasts, "podcast episode")}` : plural(list.length, "video");
  // One framed block per format: its title on the left, its videos on the right, by colors played.
  // The video of the day takes a double tile in its format's block, which comes first. Formats with
  // one or two videos share a last block, one group each.
  const groups = groupByFormat(list).sort((a, b) => Number(Boolean(pick && b.items.includes(pick))) - Number(Boolean(pick && a.items.includes(pick))));
  const isSmall = (g: FormatGroup) => g.items.length <= SMALL && !(pick && g.items.includes(pick));
  const small = groups.filter(isSmall);
  const shared = small.length >= 2;
  const big = groups.filter((g) => !shared || !isSmall(g));
  const clusters = big.map((g) => `<div class="cluster" data-format="${g.format}">${labelTile(g)}<div class="cluster-body">${byColors(inOrder(g, pick), pick)}</div></div>`);
  if (shared) {
    const videos = small.reduce((n, g) => n + g.items.length, 0);
    const label = `<div class="mlabel"><span class="fmt">${big.length ? "More formats" : "Formats"}</span><span class="n">${plural(videos, "video")}</span></div>`;
    const body = small
      .map((g) => {
        const sets = setNames(g);
        return group(`<strong>${esc(FORMAT_NAMES[g.format])}</strong> <span class="n">${g.items.length}</span>${sets ? ` <span class="archs">${sets}</span>` : ""}`, inOrder(g, pick), pick);
      })
      .join("");
    clusters.push(`<div class="cluster" data-format="more">${label}<div class="cluster-body">${body}</div></div>`);
  }
  return `<section class="day" data-day="${day}"><h2 class="day-title">${heading} <span class="n">${counts}</span></h2>${clusters.join("")}</section>`;
}

function render() {
  const day = readDay();
  const now = today();
  const first = data.archive.since;
  const list = data.items.filter((v) => v.day === day);
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

  // One day per page: the day before is a click (or the left arrow key) away.
  el("main").innerHTML = daySection(day, list, day === now ? `Today, ${label}` : label);
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
  const day = readDay();
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
