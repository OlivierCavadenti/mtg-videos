import { FORMAT_NAMES, FORMATS, KIND_NAMES, type Archive, type ArchiveVideo, type Format, type Language } from "../shared/model.ts";

/** What both pages share: loading the archive, formatting, and the video card. */

export type FormatKey = Format | "other";
export const FORMAT_ORDER: readonly FormatKey[] = [...FORMATS, "other"];
export const SPLIT_BY_SET: ReadonlySet<FormatKey> = new Set(["limited", "cube"]);
export const COLORS = ["W", "U", "B", "R", "G"] as const;
export const COLOR_NAMES: Record<string, string> = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" };

export interface Item extends ArchiveVideo {
  creatorName: string;
  language: Language;
  href: string;
  haystack: string;
  /** Publication in the reader's time zone, as YYYY-MM-DD. */
  day: string;
}

export interface Loaded {
  archive: Archive;
  items: Item[];
  setByCode: Map<string, Archive["sets"][number]>;
}

export const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]!);
export const number = new Intl.NumberFormat("en-GB");
export const plural = (n: number, one: string, many = `${one}s`) => `${number.format(n)} ${n === 1 ? one : many}`;
export const fold = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

// Calendar dates (period bounds, YYYY-MM-DD) are read as UTC days; video times in the reader's zone.
export const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);
export const longDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
export const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
export const monthYear = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
export const fullDay = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const localShort = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const localTime = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

/** A moment as the reader's calendar day, YYYY-MM-DD. */
export function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function duration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

export const pip = (c: string, size = 14) =>
  `<img class="pip" src="https://svgs.scryfall.io/card-symbols/${c}.svg" alt="${COLOR_NAMES[c]}" title="${COLOR_NAMES[c]}" width="${size}" height="${size}" />`;

export async function loadArchive(): Promise<Loaded> {
  const res = await fetch(`${import.meta.env.BASE_URL}archive.json`);
  if (!res.ok) throw new Error(`archive.json: HTTP ${res.status}`);
  const archive = (await res.json()) as Archive;
  const setByCode = new Map(archive.sets.map((s) => [s.code, s]));
  const items = archive.videos.map((v): Item => {
    const creator = archive.creators[v.c]!;
    const set = v.set ? setByCode.get(v.set) : undefined;
    return {
      ...v,
      creatorName: creator.name,
      language: creator.language,
      href: v.url ?? `https://www.youtube.com/watch?v=${v.id}`,
      day: localDay(new Date(v.at)),
      haystack: fold([v.title, creator.name, set?.name ?? "", v.set ?? "", ...(v.archetypes ?? []), ...(v.cards ?? []).map((c) => c[0])].join(" ")),
    };
  });
  return { archive, items, setByCode };
}

export interface CardOptions {
  /** Show the time of day instead of the date (the day page). */
  time?: boolean;
  /** The creator's name links to the archive filtered on them, instead of filtering in place. */
  creatorLink?: string;
}

export function card(v: Item, { archive, setByCode }: Loaded, options: CardOptions = {}): string {
  const creator = archive.creators[v.c]!;
  const thumb =
    v.url === undefined
      ? `<img src="https://i.ytimg.com/vi/${esc(v.id)}/mqdefault.jpg" alt="" width="320" height="180" loading="lazy" decoding="async" />`
      : `<span class="tile" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M12 3a4 4 0 0 0-4 4v5a4 4 0 0 0 8 0V7a4 4 0 0 0-4-4Zm-7 9a1 1 0 1 1 2 0 5 5 0 0 0 10 0 1 1 0 1 1 2 0 7 7 0 0 1-6 6.93V21h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3v-2.07A7 7 0 0 1 5 12Z"/></svg><span>${esc(creator.name)}</span></span>`;
  const set = v.set ? setByCode.get(v.set) : undefined;
  const tags = [
    KIND_NAMES[v.kind] !== "Other" ? esc(KIND_NAMES[v.kind]) : "",
    set ? `<abbr title="${esc(set.name)}${v.setGuessed ? " (from the date)" : ""}">${esc(set.code)}</abbr>` : "",
    ...(v.also ?? []).map((f) => esc(FORMAT_NAMES[f])),
    ...(v.archetypes ?? []).map((a) => `<span class="arch">${esc(a)}</span>`),
  ].filter(Boolean);
  const pips = v.colors ? `<span class="pips">${[...v.colors].map((c) => pip(c)).join("")}</span> ` : "";
  // Cards heard in the transcript: each opens the video where it comes up.
  const heard = (v.cards ?? []).filter((c): c is [string, number] => c[1] !== undefined);
  const cards = heard.length
    ? `<details class="heard"><summary>${plural(heard.length, "card")} discussed</summary><p>${heard
        .map(([name, at]) =>
          v.url === undefined
            ? `<a href="https://www.youtube.com/watch?v=${esc(v.id)}&amp;t=${at}s" target="_blank" rel="noopener">${esc(name)}</a> <span class="at">${duration(at)}</span>`
            : `${esc(name)} <span class="at">${duration(at)}</span>`,
        )
        .join(" · ")}</p></details>`
    : "";
  const when = new Date(v.at);
  const name = options.creatorLink
    ? `<a class="creator" href="${esc(options.creatorLink)}?creator=${esc(creator.id)}">${esc(creator.name)}</a>`
    : `<button type="button" data-creator="${esc(creator.id)}">${esc(creator.name)}</button>`;
  return `<article class="card">
    <a class="thumb" href="${esc(v.href)}" target="_blank" rel="noopener" tabindex="-1" aria-hidden="true">${thumb}${v.duration ? `<span class="len">${duration(v.duration)}</span>` : ""}</a>
    <p class="by">${name}${creator.language === "fr" ? ` <span class="lang">FR</span>` : ""}, <time datetime="${v.at}">${(options.time ? localTime : localShort).format(when)}</time></p>
    <h4><a href="${esc(v.href)}" target="_blank" rel="noopener"${v.summary ? ` title="${esc(v.summary)}"` : ""}>${esc(v.title)}</a></h4>
    ${tags.length || pips ? `<p class="tags">${pips}${tags.join(" · ")}</p>` : ""}
    ${cards}
    ${v.podcast ? `<p class="alt">Also as a <a href="${esc(v.podcast)}" target="_blank" rel="noopener">podcast episode</a></p>` : ""}
  </article>`;
}

export interface FormatGroup {
  format: FormatKey;
  items: Item[];
  /** Limited and Cube: one list per set, `ownSet` first, then the most covered; no set last (code ""). */
  bySet?: Array<{ code: string; items: Item[] }>;
}

/** A list of videos as format groups, in the order formats are listed. */
export function groupByFormat(list: Item[], ownSet?: string, splitSets = true): FormatGroup[] {
  const byFormat = new Map<FormatKey, Item[]>();
  for (const v of list) {
    const l = byFormat.get(v.format);
    if (l) l.push(v);
    else byFormat.set(v.format, [v]);
  }
  return FORMAT_ORDER.filter((f) => byFormat.has(f)).map((format) => {
    const items = byFormat.get(format)!;
    if (!splitSets || !SPLIT_BY_SET.has(format)) return { format, items };
    const bySet = new Map<string, Item[]>();
    for (const v of items) {
      const k = v.set ?? "";
      const l = bySet.get(k);
      if (l) l.push(v);
      else bySet.set(k, [v]);
    }
    const codes = [...bySet.keys()].sort((a, b) => Number(b === ownSet) - Number(a === ownSet) || Number(a === "") - Number(b === "") || bySet.get(b)!.length - bySet.get(a)!.length);
    return { format, items, bySet: codes.map((code) => ({ code, items: bySet.get(code)! })) };
  });
}
