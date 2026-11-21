import "./styles.css";
import { FORMAT_NAMES, KIND_NAMES, KINDS, type Kind, type Language } from "../shared/model.ts";
import {
  card,
  COLOR_NAMES,
  COLORS,
  dayMonth,
  el,
  esc,
  fold,
  FORMAT_ORDER,
  groupByFormat,
  loadArchive,
  longDate,
  monthYear,
  number,
  pip,
  plural,
  utc,
  type FormatKey,
  type Item,
  type Loaded,
} from "./common.ts";

/**
 * The archive: every video, newest period first. In each period, one group per format; Limited
 * and Cube are split again by the set the videos are about. Filters live in the URL.
 */

interface Filters {
  format?: FormatKey;
  set?: string;
  kind?: Kind;
  creator?: string;
  lang?: Language;
  /** Colors the deck must play, in WUBRG order ("UB": Dimir, Esper, Sultai…). */
  colors?: string;
  q?: string;
}
type FilterKey = keyof Filters;

let data: Loaded;
let filters: Filters = {};
const expanded = new Set<string>();

// ---------------------------------------------------------------- filters and URL

function readFilters(): Filters {
  const p = new URLSearchParams(location.search);
  const f: Filters = {};
  const format = p.get("format");
  if (format && (FORMAT_ORDER as readonly string[]).includes(format)) f.format = format as FormatKey;
  const set = p.get("set")?.toUpperCase();
  if (set && data.setByCode.has(set)) f.set = set;
  const kind = p.get("kind");
  if (kind && (KINDS as readonly string[]).includes(kind)) f.kind = kind as Kind;
  const creator = p.get("creator");
  if (creator && data.archive.creators.some((c) => c.id === creator)) f.creator = creator;
  const colors = (p.get("colors") ?? "").toUpperCase();
  const picked = COLORS.filter((c) => colors.includes(c)).join("");
  if (picked) f.colors = picked;
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
  if (filters.creator && skip !== "creator" && data.archive.creators[v.c]!.id !== filters.creator) return false;
  if (filters.lang && skip !== "lang" && v.language !== filters.lang) return false;
  if (filters.colors && skip !== "colors") {
    for (const c of filters.colors) if (!v.colors?.includes(c)) return false;
  }
  if (filters.q && skip !== "q") {
    for (const word of fold(filters.q).split(/\s+/)) if (word && !v.haystack.includes(word)) return false;
  }
  return true;
}

function countBy<K>(skip: FilterKey, key: (v: Item) => K | undefined): Map<K, number> {
  const counts = new Map<K, number>();
  for (const v of data.items) {
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
  const { archive, items } = data;
  const bar = el<HTMLDivElement>("filters");
  if (!bar.dataset.ready) {
    bar.innerHTML = `
      <div class="formats" role="group" aria-label="Format"></div>
      <div class="refine">
        <label><span class="sr-only">Kind</span><select data-filter="kind"></select></label>
        <label><span class="sr-only">Set</span><select data-filter="set"></select></label>
        <label><span class="sr-only">Creator</span><select data-filter="creator"></select></label>
        <label><span class="sr-only">Language</span><select data-filter="lang"></select></label>
        <span class="colors" role="group" aria-label="Colors played"></span>
        <label class="search"><span class="sr-only">Search</span><input type="search" data-filter="q" placeholder="Search titles, cards, archetypes" autocomplete="off" /></label>
        <p class="summary" aria-live="polite"></p>
      </div>`;
    // The periods' sticky offsets follow the height of this bar.
    new ResizeObserver(() => document.documentElement.style.setProperty("--sticky", `${bar.offsetHeight}px`)).observe(bar);
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
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-format], button[data-clear], button[data-color]");
      if (!button) return;
      if (button.dataset.color) {
        const c = button.dataset.color;
        const next = filters.colors?.includes(c) ? filters.colors.replace(c, "") : `${filters.colors ?? ""}${c}`;
        setFilter("colors", COLORS.filter((x) => next.includes(x)).join(""));
      } else if (button.dataset.clear !== undefined) {
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

  bar.querySelector(".colors")!.innerHTML = COLORS.map(
    (c) => `<button type="button" data-color="${c}" aria-pressed="${Boolean(filters.colors?.includes(c))}" title="Decks playing ${COLOR_NAMES[c]!.toLowerCase()}">${pip(c, 18)}</button>`,
  ).join("");

  const langs = countBy("lang", (v) => v.language);
  bar.querySelector("select[data-filter=lang]")!.innerHTML = [
    option("", "All languages", !filters.lang),
    option("en", "English", filters.lang === "en", langs.get("en") ?? 0),
    option("fr", "French", filters.lang === "fr", langs.get("fr") ?? 0),
  ].join("");

  const search = bar.querySelector<HTMLInputElement>("input[data-filter=q]")!;
  if (document.activeElement !== search) search.value = filters.q ?? "";

  const shown = items.filter((v) => matches(v)).length;
  bar.querySelector(".summary")!.innerHTML = activeCount()
    ? `${number.format(shown)} of ${plural(items.length, "video")} · <button type="button" data-clear>Clear filters</button>`
    : plural(shown, "video");
}

// ---------------------------------------------------------------- timeline and periods

function eraTitle(index: number): { name: string; icon: string; dates: string } {
  const { archive, setByCode } = data;
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
  const { archive } = data;
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
  return `<div class="grid">${shown.map((v) => card(v, data)).join("")}</div>${more}`;
}

function renderMain(visible: Item[]) {
  const { archive, setByCode } = data;
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
    const groups = groupByFormat(list, code, !filters.set);
    const index = groups.length > 1 ? `<p class="era-index">${groups.map((g) => `<a href="#era-${code}-${g.format}">${esc(FORMAT_NAMES[g.format])}</a> ${number.format(g.items.length)}`).join(" · ")}</p>` : "";
    const body = groups.map((g) => {
      const inner = g.bySet
        ? g.bySet
            .map(({ code: k, items: l }) => {
              const set = k ? setByCode.get(k) : undefined;
              const label = set
                ? `<button type="button" class="set-link" data-set="${esc(set.code)}" title="Only ${esc(set.name)}"><img src="${esc(set.icon)}" alt="" width="18" height="18" loading="lazy" />${esc(set.name)}</button>`
                : `<span>No set named</span>`;
              return `<section class="subgroup"><h4 class="subhead">${label} <span class="n">${number.format(l.length)}</span></h4>${grid(l, `${era}|${g.format}|${k}`)}</section>`;
            })
            .join("")
        : grid(g.items, `${era}|${g.format}`);
      return `<section class="group" id="era-${code}-${g.format}"><h3>${esc(FORMAT_NAMES[g.format])} <span class="n">${number.format(g.items.length)}</span></h3>${inner}</section>`;
    });
    sections.push(`<section class="era" id="era-${code}" data-era="${code}">
      <header class="era-head">
        ${icon ? `<img class="symbol" src="${esc(icon)}" alt="" width="36" height="36" />` : ""}
        <div><h2>${esc(name)}</h2><p class="dates">${dates} · ${plural(list.length, "video")}</p>${index}</div>
      </header>
      ${body.join("")}
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
  const visible = data.items.filter((v) => matches(v));
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
    const list = data.items.filter((v) => matches(v) && v.era === Number(era) && v.format === format && (set === undefined || (v.set ?? "") === set));
    const gridEl = more.previousElementSibling;
    if (gridEl) gridEl.innerHTML = list.map((v) => card(v, data)).join("");
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
  data = await loadArchive();
  const { archive, items } = data;
  const updated = longDate.format(utc(archive.generated.slice(0, 10)));
  el("dek").textContent = `${number.format(items.length)} videos and podcasts from ${archive.creators.length} Magic creators since ${monthYear.format(utc(archive.since))}, by period, format and set. Updated ${updated}.`;
  filters = readFilters();
  update();
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
}

start().catch((error: unknown) => {
  el("main").innerHTML = `<p class="status">The archive could not be loaded (${esc(String(error))}).</p>`;
});
