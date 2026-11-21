import "./styles.css";
import { FORMAT_NAMES, FORMATS, KIND_NAMES, KINDS, type Archive, type ArchiveVideo, type Format, type Kind, type Language } from "../shared/model.ts";

/**
 * One page: the archive's videos, newest period first. In each period, one group per format;
 * Limited and Cube are split again by the set the videos are about. Filters live in the URL.
 */

type FormatKey = Format | "other";
const FORMAT_ORDER: readonly FormatKey[] = [...FORMATS, "other"];
const SPLIT_BY_SET: ReadonlySet<FormatKey> = new Set(["limited", "cube"]);

interface Filters {
  format?: FormatKey;
  set?: string;
  kind?: Kind;
  creator?: string;
  lang?: Language;
  q?: string;
}
type FilterKey = keyof Filters;

interface Item extends ArchiveVideo {
  creatorName: string;
  language: Language;
  href: string;
  haystack: string;
}

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]!);
const number = new Intl.NumberFormat("en-GB");
const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);
const shortDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const longDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
const monthYear = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const fold = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
const plural = (n: number, one: string, many = `${one}s`) => `${number.format(n)} ${n === 1 ? one : many}`;

function duration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

let archive: Archive;
let items: Item[] = [];
let setByCode = new Map<string, Archive["sets"][number]>();
let filters: Filters = {};
const expanded = new Set<string>();

// ---------------------------------------------------------------- filters and URL

function readFilters(): Filters {
  const p = new URLSearchParams(location.search);
  const f: Filters = {};
  const format = p.get("format");
  if (format && (FORMAT_ORDER as readonly string[]).includes(format)) f.format = format as FormatKey;
  const set = p.get("set")?.toUpperCase();
  if (set && setByCode.has(set)) f.set = set;
  const kind = p.get("kind");
  if (kind && (KINDS as readonly string[]).includes(kind)) f.kind = kind as Kind;
  const creator = p.get("creator");
  if (creator && archive.creators.some((c) => c.id === creator)) f.creator = creator;
  const lang = p.get("lang");
  if (lang === "en" || lang === "fr") f.lang = lang;
  const q = p.get("q")?.trim();
  if (q) f.q = q.slice(0, 80);
  return f;
}

function writeFilters() {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) p.set(k, k === "set" ? String(v).toLowerCase() : String(v));
  const qs = p.toString();
  history.replaceState(null, "", `${location.pathname}${qs ? `?${qs}` : ""}${location.hash}`);
}

function matches(v: Item, skip?: FilterKey): boolean {
  if (filters.format && skip !== "format" && v.format !== filters.format) return false;
  if (filters.set && skip !== "set" && v.set !== filters.set) return false;
  if (filters.kind && skip !== "kind" && v.kind !== filters.kind) return false;
  if (filters.creator && skip !== "creator" && archive.creators[v.c]!.id !== filters.creator) return false;
  if (filters.lang && skip !== "lang" && v.language !== filters.lang) return false;
  if (filters.q && skip !== "q") {
    for (const word of fold(filters.q).split(/\s+/)) if (word && !v.haystack.includes(word)) return false;
  }
  return true;
}

function countBy<K>(skip: FilterKey, key: (v: Item) => K | undefined): Map<K, number> {
  const counts = new Map<K, number>();
  for (const v of items) {
    if (!matches(v, skip)) continue;
    const k = key(v);
    if (k !== undefined) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

const activeCount = () => Object.values(filters).filter(Boolean).length;

function setFilter(key: FilterKey, value: string | undefined) {
  const next = { ...filters } as Record<FilterKey, string | undefined>;
  next[key] = value || undefined;
  filters = next as Filters;
  expanded.clear();
  update();
}

// ---------------------------------------------------------------- filter bar

function option(value: string, label: string, selected: boolean, n?: number) {
  return `<option value="${esc(value)}"${selected ? " selected" : ""}>${esc(label)}${n !== undefined ? ` (${number.format(n)})` : ""}</option>`;
}

function renderFilterBar() {
  const bar = el<HTMLDivElement>("filters");
  if (!bar.dataset.ready) {
    bar.innerHTML = `
      <div class="formats" role="group" aria-label="Format"></div>
      <div class="refine">
        <label><span>Kind</span><select data-filter="kind"></select></label>
        <label><span>Set</span><select data-filter="set"></select></label>
        <label><span>Creator</span><select data-filter="creator"></select></label>
        <label><span>Language</span><select data-filter="lang"></select></label>
        <label class="search"><span>Search</span><input type="search" data-filter="q" placeholder="Title, archetype, creator" autocomplete="off" /></label>
      </div>
      <p class="summary" aria-live="polite"></p>`;
    bar.dataset.ready = "1";
    bar.hidden = false;
    let timer = 0;
    bar.addEventListener("change", (e) => {
      const target = e.target as HTMLSelectElement;
      if (target.tagName === "SELECT") setFilter(target.dataset.filter as FilterKey, target.value);
    });
    bar.addEventListener("input", (e) => {
      const target = e.target as HTMLInputElement;
      if (target.dataset.filter !== "q") return;
      clearTimeout(timer);
      timer = window.setTimeout(() => setFilter("q", target.value.trim().slice(0, 80)), 180);
    });
    bar.addEventListener("click", (e) => {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-format], button[data-clear]");
      if (!button) return;
      if (button.dataset.clear !== undefined) {
        filters = {};
        expanded.clear();
        bar.querySelector<HTMLInputElement>("input[data-filter=q]")!.value = "";
        update();
      } else setFilter("format", button.dataset.format === filters.format ? undefined : button.dataset.format);
    });
  }

  const focused = document.activeElement instanceof HTMLButtonElement ? document.activeElement.dataset.format : undefined;
  const formats = countBy("format", (v) => v.format);
  const total = [...formats.values()].reduce((a, b) => a + b, 0);
  const formatButtons = FORMAT_ORDER.filter((f) => formats.has(f) || filters.format === f).map(
    (f) => `<button type="button" data-format="${f}" aria-pressed="${filters.format === f}">${esc(FORMAT_NAMES[f])} <span class="n">${number.format(formats.get(f) ?? 0)}</span></button>`,
  );
  bar.querySelector(".formats")!.innerHTML = [`<button type="button" data-format="" aria-pressed="${!filters.format}">All formats <span class="n">${number.format(total)}</span></button>`, ...formatButtons].join("");
  if (focused !== undefined) bar.querySelector<HTMLButtonElement>(`button[data-format="${focused}"]`)?.focus();

  const kinds = countBy("kind", (v) => v.kind);
  bar.querySelector("select[data-filter=kind]")!.innerHTML = [
    option("", "All kinds", !filters.kind),
    ...KINDS.filter((k) => kinds.has(k) || filters.kind === k).map((k) => option(k, KIND_NAMES[k], filters.kind === k, kinds.get(k) ?? 0)),
  ].join("");

  const sets = countBy("set", (v) => v.set);
  bar.querySelector("select[data-filter=set]")!.innerHTML = [
    option("", "All sets", !filters.set),
    ...archive.sets.filter((s) => sets.has(s.code) || filters.set === s.code).map((s) => option(s.code, `${s.name} (${s.code})`, filters.set === s.code, sets.get(s.code) ?? 0)),
  ].join("");

  const creators = countBy("creator", (v) => archive.creators[v.c]!.id);
  const creatorOptions = (platform: string) =>
    archive.creators
      .filter((c) => c.platform === platform && (creators.has(c.id) || filters.creator === c.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => option(c.id, `${c.name}${c.language === "fr" ? " · FR" : ""}`, filters.creator === c.id, creators.get(c.id) ?? 0))
      .join("");
  bar.querySelector("select[data-filter=creator]")!.innerHTML = `${option("", "All creators", !filters.creator)}<optgroup label="Videos">${creatorOptions("youtube")}</optgroup><optgroup label="Podcasts">${creatorOptions("podcast")}</optgroup>`;

  const langs = countBy("lang", (v) => v.language);
  bar.querySelector("select[data-filter=lang]")!.innerHTML = [
    option("", "All languages", !filters.lang),
    option("en", "English", filters.lang === "en", langs.get("en") ?? 0),
    option("fr", "French", filters.lang === "fr", langs.get("fr") ?? 0),
  ].join("");

  const search = bar.querySelector<HTMLInputElement>("input[data-filter=q]")!;
  if (document.activeElement !== search) search.value = filters.q ?? "";

  const shown = items.filter((v) => matches(v)).length;
  bar.querySelector(".summary")!.innerHTML = `${plural(shown, "video")}${activeCount() ? ` match these filters. <button type="button" data-clear>Clear filters</button>` : " in the archive."}`;
}

// ---------------------------------------------------------------- timeline and periods

function eraTitle(index: number): { name: string; icon: string; dates: string } {
  const era = archive.eras[index]!;
  const set = setByCode.get(era.set);
  const today = archive.generated.slice(0, 10);
  const start = utc(era.start);
  let dates: string;
  if (era.start > today) dates = `Out ${longDate.format(start)}`;
  else if (!era.end) dates = `Since ${longDate.format(start)}`;
  else {
    const end = utc(era.end);
    dates = `${(start.getUTCFullYear() === end.getUTCFullYear() ? dayMonth : longDate).format(start)} to ${longDate.format(end)}`;
  }
  return { name: set?.name ?? era.set, icon: set?.icon ?? "", dates };
}

function renderTimeline(perEra: Map<number, number>) {
  const years = new Map<string, number[]>();
  archive.eras.forEach((era, i) => {
    const y = era.start.slice(0, 4);
    years.set(y, [...(years.get(y) ?? []), i]);
  });
  const html = [...years]
    .map(([year, eras]) => {
      const links = eras
        .map((i) => {
          const { name, icon } = eraTitle(i);
          const n = perEra.get(i) ?? 0;
          const code = archive.eras[i]!.set;
          return n
            ? `<li><a href="#era-${code}" data-era="${code}"><img src="${esc(icon)}" alt="" width="16" height="16" loading="lazy" /><span class="name">${esc(name)}</span><span class="n">${number.format(n)}</span></a></li>`
            : `<li class="empty"><span><img src="${esc(icon)}" alt="" width="16" height="16" loading="lazy" /><span class="name">${esc(name)}</span><span class="n">0</span></span></li>`;
        })
        .join("");
      return `<li class="year"><span class="year-label">${year}</span><ol>${links}</ol></li>`;
    })
    .join("");
  el("timeline").innerHTML = `<p class="timeline-title">Periods</p><ol>${html}</ol>`;
}

function card(v: Item): string {
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
  return `<article class="card">
    <a class="thumb" href="${esc(v.href)}" target="_blank" rel="noopener" tabindex="-1" aria-hidden="true">${thumb}${v.duration ? `<span class="len">${duration(v.duration)}</span>` : ""}</a>
    <p class="by"><button type="button" data-creator="${esc(creator.id)}">${esc(creator.name)}</button>${creator.language === "fr" ? ` <span class="lang">FR</span>` : ""}, <time datetime="${v.date}">${shortDate.format(utc(v.date))}</time></p>
    <h4><a href="${esc(v.href)}" target="_blank" rel="noopener"${v.summary ? ` title="${esc(v.summary)}"` : ""}>${esc(v.title)}</a></h4>
    ${tags.length ? `<p class="tags">${tags.join(" · ")}</p>` : ""}
    ${v.podcast ? `<p class="alt">Also as a <a href="${esc(v.podcast)}" target="_blank" rel="noopener">podcast episode</a></p>` : ""}
  </article>`;
}

/** Cards in one row of the grid at the current width (210px columns, 16px gaps). */
function perRow(): number {
  const width = el("main").clientWidth || 900;
  return Math.max(2, Math.floor((width + 16) / (210 + 16)));
}

function grid(list: Item[], key: string): string {
  // Two rows, three once the list is narrowed down.
  const limit = perRow() * (activeCount() ? 3 : 2);
  const open = expanded.has(key) || list.length <= limit + 2;
  const shown = open ? list : list.slice(0, limit);
  const more = list.length > shown.length ? `<button type="button" class="more" data-expand="${esc(key)}">Show all ${number.format(list.length)}</button>` : "";
  return `<div class="grid">${shown.map(card).join("")}</div>${more}`;
}

function renderMain(visible: Item[]) {
  const main = el<HTMLElement>("main");
  if (!visible.length) {
    main.innerHTML = `<p class="status">No video matches these filters. <button type="button" data-clear-main>Clear filters</button></p>`;
    return;
  }
  const byEra = new Map<number, Item[]>();
  for (const v of visible) {
    const list = byEra.get(v.era);
    if (list) list.push(v);
    else byEra.set(v.era, [v]);
  }
  const sections: string[] = [];
  for (const [era, list] of [...byEra].sort((a, b) => a[0] - b[0])) {
    const code = archive.eras[era]!.set;
    const { name, icon, dates } = eraTitle(era);
    const byFormat = new Map<FormatKey, Item[]>();
    for (const v of list) {
      const l = byFormat.get(v.format);
      if (l) l.push(v);
      else byFormat.set(v.format, [v]);
    }
    const formats = FORMAT_ORDER.filter((f) => byFormat.has(f));
    const index = formats.length > 1 ? `<p class="era-index">${formats.map((f) => `<a href="#era-${code}-${f}">${esc(FORMAT_NAMES[f])}</a> ${number.format(byFormat.get(f)!.length)}`).join(" · ")}</p>` : "";
    const groups = formats.map((f) => {
      const fl = byFormat.get(f)!;
      let body: string;
      if (SPLIT_BY_SET.has(f) && !filters.set) {
        const bySet = new Map<string, Item[]>();
        for (const v of fl) {
          const k = v.set ?? "";
          const l = bySet.get(k);
          if (l) l.push(v);
          else bySet.set(k, [v]);
        }
        // The period's own set first, then the most covered; videos naming no set last.
        const keys = [...bySet.keys()].sort((a, b) => Number(b === code) - Number(a === code) || Number(a === "") - Number(b === "") || bySet.get(b)!.length - bySet.get(a)!.length);
        body = keys
          .map((k) => {
            const set = k ? setByCode.get(k) : undefined;
            const label = set
              ? `<button type="button" class="set-link" data-set="${esc(set.code)}" title="Only ${esc(set.name)}"><img src="${esc(set.icon)}" alt="" width="18" height="18" loading="lazy" />${esc(set.name)}</button>`
              : `<span>No set named</span>`;
            return `<section class="subgroup"><h4 class="subhead">${label} <span class="n">${number.format(bySet.get(k)!.length)}</span></h4>${grid(bySet.get(k)!, `${era}|${f}|${k}`)}</section>`;
          })
          .join("");
      } else body = grid(fl, `${era}|${f}`);
      return `<section class="group" id="era-${code}-${f}"><h3>${esc(FORMAT_NAMES[f])} <span class="n">${number.format(fl.length)}</span></h3>${body}</section>`;
    });
    sections.push(`<section class="era" id="era-${code}" data-era="${code}">
      <header class="era-head">
        ${icon ? `<img class="symbol" src="${esc(icon)}" alt="" width="44" height="44" />` : ""}
        <div><h2>${esc(name)}</h2><p class="dates">${dates} · ${plural(list.length, "video")}</p>${index}</div>
      </header>
      ${groups.join("")}
    </section>`);
  }
  main.innerHTML = sections.join("");
  spy();
}

let observer: IntersectionObserver | undefined;
function spy() {
  observer?.disconnect();
  const links = new Map([...el("timeline").querySelectorAll<HTMLAnchorElement>("a[data-era]")].map((a) => [a.dataset.era!, a]));
  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        for (const a of links.values()) a.removeAttribute("aria-current");
        links.get((e.target as HTMLElement).dataset.era!)?.setAttribute("aria-current", "true");
      }
    },
    { rootMargin: "-20% 0px -70% 0px" },
  );
  for (const s of document.querySelectorAll<HTMLElement>("section.era")) observer.observe(s);
}

// ---------------------------------------------------------------- wiring

function update() {
  writeFilters();
  renderFilterBar();
  const visible = items.filter((v) => matches(v));
  const perEra = new Map<number, number>();
  for (const v of visible) perEra.set(v.era, (perEra.get(v.era) ?? 0) + 1);
  renderTimeline(perEra);
  renderMain(visible);
}

el("main").addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  const more = target.closest<HTMLButtonElement>("button[data-expand]");
  if (more) {
    const key = more.dataset.expand!;
    expanded.add(key);
    const [era, format, set] = key.split("|") as [string, FormatKey, string | undefined];
    const list = items.filter((v) => matches(v) && v.era === Number(era) && v.format === format && (set === undefined || (v.set ?? "") === set));
    const gridEl = more.previousElementSibling;
    if (gridEl) gridEl.innerHTML = list.map(card).join("");
    more.remove();
    return;
  }
  const creator = target.closest<HTMLButtonElement>("button[data-creator]");
  if (creator) return setFilter("creator", creator.dataset.creator);
  const set = target.closest<HTMLButtonElement>("button[data-set]");
  if (set) return setFilter("set", set.dataset.set);
  if (target.closest("button[data-clear-main]")) {
    filters = {};
    update();
  }
});

async function start() {
  const res = await fetch(`${import.meta.env.BASE_URL}archive.json`);
  if (!res.ok) throw new Error(`archive.json: HTTP ${res.status}`);
  archive = (await res.json()) as Archive;
  setByCode = new Map(archive.sets.map((s) => [s.code, s]));
  items = archive.videos.map((v) => {
    const creator = archive.creators[v.c]!;
    const set = v.set ? setByCode.get(v.set) : undefined;
    return {
      ...v,
      creatorName: creator.name,
      language: creator.language,
      href: v.url ?? `https://www.youtube.com/watch?v=${v.id}`,
      haystack: fold([v.title, creator.name, set?.name ?? "", v.set ?? "", ...(v.archetypes ?? [])].join(" ")),
    };
  });
  const updated = longDate.format(new Date(archive.generated));
  el("dek").textContent = `${plural(items.length, "video")} and podcast episodes from ${archive.creators.length} Magic: The Gathering creators since ${monthYear.format(utc(archive.since))}, filed by period, format and set. Updated ${updated}.`;
  filters = readFilters();
  update();
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
}

start().catch((error: unknown) => {
  el("main").innerHTML = `<p class="status">The archive could not be loaded (${esc(String(error))}).</p>`;
});
