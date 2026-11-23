import "./styles.css";
import { FORMAT_NAMES, type LiveList, type LivePlatform, type LiveStream } from "../shared/model.ts";
import { el, esc, FORMAT_ORDER, number, plural, type FormatKey } from "./common.ts";

/**
 * The Magic streams live now on Twitch and YouTube, by format from their titles. A server makes the
 * list every five minutes and pushes it to the repository's "live" branch, read from here.
 */

const SOURCE = new URLSearchParams(location.search).has("local")
  ? "../live.json"
  : "https://raw.githubusercontent.com/OlivierCavadenti/mtg-videos/live/live.json";
const REFRESH = 5 * 60_000;
/** Tiles of a block (or of a set's group) shown before "Show more". */
const SHOWN = 12;
const PLATFORM_NAMES: Record<LivePlatform, string> = { twitch: "Twitch", youtube: "YouTube" };
const CUBE = `<svg class="cube-icon" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" d="M8 1.5 14 4.8v6.4L8 14.5 2 11.2V4.8L8 1.5ZM2 4.8 8 8l6-3.2M8 8v6.5"/></svg>`;
const languageName = new Intl.DisplayNames(["en"], { type: "language" });
const compact = new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 });
const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

let list: LiveList | undefined;
let loadedAt = 0;
/** Blocks opened in full by the reader, kept across refreshes. */
const opened = new Set<string>();

// ------------------------------------------------------------------ filters (in the URL)

interface Filters {
  lang: string;
  on: LivePlatform | "";
}

function readFilters(): Filters {
  const p = new URLSearchParams(location.search);
  const on = p.get("on");
  return { lang: p.get("lang") ?? "", on: on === "twitch" || on === "youtube" ? on : "" };
}

function writeFilters(f: Filters) {
  const p = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(f)) {
    if (v) p.set(k, v);
    else p.delete(k);
  }
  const q = p.toString();
  history.replaceState(null, "", q ? `?${q}` : location.pathname);
}

const langOf = (s: LiveStream) => s.lang ?? "";
const visible = (f: Filters) => (s: LiveStream) => (!f.lang || langOf(s) === f.lang) && (!f.on || s.platform === f.on);

// ------------------------------------------------------------------ tiles and blocks

// ------------------------------------------------------------------ watching a stream on the page

/** The stream opened in the panel: "twitch:<login>" or "youtube:<video id>", also in the URL. */
let watching: string | undefined;
const WATCH = /^(twitch|youtube):[\w-]{2,64}$/;
const narrow = matchMedia("(max-width: 1100px)");
/** The chat beside the player, on wide screens only. */
let withChat = !narrow.matches;

const twitchLogin = (s: LiveStream) => new URL(s.url).pathname.split("/")[1] ?? "";
const watchKey = (s: LiveStream) => (s.platform === "twitch" ? `twitch:${twitchLogin(s)}` : `youtube:${s.id}`);
const streamOf = (key: string) => list?.streams.find((s) => watchKey(s) === key);

function readWatch(): string | undefined {
  const w = new URLSearchParams(location.search).get("watch");
  return w && WATCH.test(w) ? w : undefined;
}

/** The player and chat addresses. Twitch wants the page's domain as "parent". */
function embeds(key: string): { video: string; chat: string } {
  const [platform, id] = key.split(":") as [LivePlatform, string];
  const host = location.hostname;
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  const code = encodeURIComponent(id);
  return platform === "twitch"
    ? { video: `https://player.twitch.tv/?channel=${code}&parent=${host}&autoplay=true`, chat: `https://www.twitch.tv/embed/${code}/chat?parent=${host}${dark ? "&darkpopout" : ""}` }
    : { video: `https://www.youtube.com/embed/${code}?autoplay=1`, chat: `https://www.youtube.com/live_chat?v=${code}&embed_domain=${host}${dark ? "&dark_theme=1" : ""}` };
}

/** The panel's heading: who, the title, and the links. Redrawn on refresh; the player is not. */
function renderHead() {
  const head = document.getElementById("player-head");
  if (!head || !watching) return;
  const s = streamOf(watching);
  const [platform] = watching.split(":") as [LivePlatform];
  const who = s
    ? `<strong>${esc(s.name)}</strong> · ${PLATFORM_NAMES[s.platform]} · ${number.format(s.viewers)} watching · for ${uptime(s.started)}`
    : `<strong>${esc(watching.split(":")[1]!)}</strong> · ${PLATFORM_NAMES[platform]}${list ? " · no longer in the list of streams live" : ""}`;
  const url = s?.url ?? (platform === "twitch" ? `https://www.twitch.tv/${watching.split(":")[1]}` : `https://www.youtube.com/watch?v=${watching.split(":")[1]}`);
  head.innerHTML = `<p class="player-who">${who}</p>
    ${s ? `<p class="player-title">${esc(s.title)}</p>` : ""}
    <p class="player-actions">
      <a href="${esc(url)}" target="_blank" rel="noopener">Open on ${PLATFORM_NAMES[platform]}</a>
      <button type="button" data-full>Full screen</button>
      <button type="button" data-chat>${withChat ? "Hide the chat" : "Show the chat"}</button>
      <button type="button" data-close>Close</button>
    </p>`;
}

function chatFrame(key: string): string {
  const [platform] = key.split(":") as [LivePlatform];
  return `<div class="player-chat"><p class="player-chat-head">Live chat <span class="n">on ${PLATFORM_NAMES[platform]}</span></p><iframe src="${esc(embeds(key).chat)}" title="Chat"></iframe></div>`;
}

/** Opens a stream in the panel (or closes it, with no key), and says so in the URL. */
function watch(key: string | undefined) {
  watching = key;
  const panel = el("player");
  el("layout").classList.toggle("watching", Boolean(key));
  const p = new URLSearchParams(location.search);
  if (key) p.set("watch", key);
  else p.delete("watch");
  const q = p.toString();
  history.replaceState(null, "", q ? `?${q}` : location.pathname);
  if (!key) {
    panel.hidden = true;
    panel.innerHTML = "";
  } else {
    panel.hidden = false;
    panel.innerHTML = `<div class="player-head" id="player-head"></div>
      <div class="player-body"><div class="player-video"><iframe src="${esc(embeds(key).video)}" title="Stream" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>${withChat ? chatFrame(key) : ""}</div>`;
    renderHead();
  }
  for (const a of document.querySelectorAll<HTMLElement>(".mtile[data-watch]")) a.classList.toggle("playing", a.dataset.watch === key);
}

function uptime(started: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(started)) / 60_000));
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}`;
}

function tile(s: LiveStream, stamp: string): string {
  const meta = [
    esc(s.name),
    PLATFORM_NAMES[s.platform],
    s.lang && s.lang !== "en" ? `<span class="lang" title="${esc(languageName.of(s.lang) ?? s.lang)}">${esc(s.lang.toUpperCase())}</span>` : "",
    `for ${uptime(s.started)}`,
    s.formats[0] === "cube" ? `${CUBE}Cube` : s.set && !s.setGuessed ? esc(s.set) : "",
    s.usual ? `<span class="usual" title="The title names no format: this is the one the streamer's titles usually name">usual format</span>` : "",
  ].filter(Boolean);
  const key = watchKey(s);
  return `<a class="mtile${key === watching ? " playing" : ""}" href="${esc(s.url)}" target="_blank" rel="noopener" title="${esc(s.title)}" data-watch="${esc(key)}">
    <img src="${esc(s.thumb)}?t=${stamp}" alt="" loading="lazy" decoding="async" />
    <span class="len viewers" title="${number.format(s.viewers)} watching">${compact.format(s.viewers)}</span>
    <span class="over"><span class="t">${esc(s.title)}</span><span class="meta">${meta.join(" · ")}</span></span>
  </a>`;
}

interface Block {
  format: FormatKey;
  streams: LiveStream[];
  viewers: number;
}

/** One block per format, most watched first, streams naming none last; Cube goes with Limited. */
function blocksOf(streams: LiveStream[]): Block[] {
  const by = new Map<FormatKey, LiveStream[]>();
  for (const s of streams) {
    const f: FormatKey = s.formats[0] === "cube" ? "limited" : (s.formats[0] ?? "other");
    const l = by.get(f);
    if (l) l.push(s);
    else by.set(f, [s]);
  }
  return [...by]
    .map(([format, l]) => ({ format, streams: l, viewers: l.reduce((n, s) => n + s.viewers, 0) }))
    .sort((a, b) => Number(a.format === "other") - Number(b.format === "other") || b.viewers - a.viewers || FORMAT_ORDER.indexOf(a.format) - FORMAT_ORDER.indexOf(b.format));
}

const columns = (n: number) => `--cols:${Math.max(1, n)}`;

function mosaic(streams: LiveStream[], open: boolean, stamp: string): string {
  return `<div class="mosaic">${(open ? streams : streams.slice(0, SHOWN)).map((s) => tile(s, stamp)).join("")}</div>`;
}

/** Limited: a group per set, then Cube, then the streams naming no set. */
function limitedGroups(streams: LiveStream[], open: boolean, stamp: string): string | undefined {
  const sets = new Map<string, LiveStream[]>();
  for (const s of streams) {
    const k = s.formats[0] === "cube" ? "cube" : s.set ?? "";
    const l = sets.get(k);
    if (l) l.push(s);
    else sets.set(k, [s]);
  }
  if (sets.size < 2) return undefined;
  const setInfo = new Map(list!.sets.map((s) => [s.code, s]));
  const keys = [...sets.keys()].sort((a, b) => Number(a === "") - Number(b === "") || Number(a === "cube") - Number(b === "cube") || sets.get(b)!.length - sets.get(a)!.length);
  return keys
    .map((k) => {
      const l = sets.get(k)!;
      const set = setInfo.get(k);
      const head =
        k === "cube"
          ? `${CUBE}<strong>Cube</strong>`
          : set
            ? `<img src="${esc(set.icon)}" alt="" width="14" height="14" class="set-icon" /><strong>${esc(set.name)}</strong>`
            : "<strong>Set not named</strong>";
      const shown = open ? l.length : Math.min(l.length, SHOWN);
      return `<div class="cgroup${k === "cube" ? " cube" : ""}" style="${columns(shown)}"><p class="chead">${head} <span class="n">${l.length}</span></p>${mosaic(l, open, stamp)}</div>`;
    })
    .join("");
}

function block(b: Block, stamp: string): string {
  const open = opened.has(b.format);
  const name = b.format === "other" ? "Format not named" : FORMAT_NAMES[b.format];
  const body = (b.format === "limited" ? limitedGroups(b.streams, open, stamp) : undefined) ?? mosaic(b.streams, open, stamp);
  const hidden = b.format === "limited" && body.includes("cgroup") ? countHidden(b.streams) : Math.max(0, b.streams.length - SHOWN);
  const more = !open && hidden > 0 ? `<p class="more"><button type="button" data-open="${b.format}">Show ${plural(hidden, "more stream")}</button></p>` : "";
  return `<div class="cluster" data-format="${b.format}">
    <div class="mlabel"><span class="fmt">${esc(name)}</span><span class="n">${plural(b.streams.length, "stream")}, ${compact.format(b.viewers)} watching</span></div>
    <div class="cluster-body">${body}${more}</div>
  </div>`;
}

/** Streams hidden in a grouped Limited block: what each group has beyond SHOWN. */
function countHidden(streams: LiveStream[]): number {
  const sizes = new Map<string, number>();
  for (const s of streams) {
    const k = s.formats[0] === "cube" ? "cube" : s.set ?? "";
    sizes.set(k, (sizes.get(k) ?? 0) + 1);
  }
  return [...sizes.values()].reduce((n, size) => n + Math.max(0, size - SHOWN), 0);
}

/** A format with this many streams or fewer shares a block with the other small ones. */
const SMALL = 2;

/** The blocks in order: the big formats, then the small ones together, then those naming none. */
function arrange(blocks: Block[], stamp: string): string {
  const small = blocks.filter((b) => b.format !== "other" && b.streams.length <= SMALL);
  if (small.length < 2) return blocks.map((b) => block(b, stamp)).join("");
  const big = blocks.filter((b) => b.format !== "other" && !small.includes(b));
  const other = blocks.filter((b) => b.format === "other");
  const streams = small.flatMap((b) => b.streams);
  const viewers = small.reduce((n, b) => n + b.viewers, 0);
  const groups = small
    .map((b) => `<div class="cgroup" style="${columns(b.streams.length)}"><p class="chead"><strong>${esc(FORMAT_NAMES[b.format])}</strong> <span class="n">${b.streams.length}</span></p>${mosaic(b.streams, true, stamp)}</div>`)
    .join("");
  const shared = `<div class="cluster" data-format="more">
    <div class="mlabel"><span class="fmt">${big.length ? "More formats" : "Formats"}</span><span class="n">${plural(streams.length, "stream")}, ${compact.format(viewers)} watching</span></div>
    <div class="cluster-body">${groups}</div>
  </div>`;
  return [...big.map((b) => block(b, stamp)), shared, ...other.map((b) => block(b, stamp))].join("");
}

// ------------------------------------------------------------------ page

function render() {
  if (!list) return;
  const f = readFilters();
  const stamp = String(Math.floor(Date.parse(list.generated) / 60_000));
  const shown = list.streams.filter(visible(f));

  // Filters: the languages and platforms of the streams live now.
  const langs = new Map<string, number>();
  for (const s of list.streams.filter((s) => !f.on || s.platform === f.on)) langs.set(langOf(s), (langs.get(langOf(s)) ?? 0) + 1);
  const langOptions = [...langs]
    .sort((a, b) => b[1] - a[1])
    .map(([code, n]) => `<option value="${esc(code)}"${code === f.lang ? " selected" : ""}>${esc(code ? (languageName.of(code) ?? code) : "Language not given")} (${n})</option>`)
    .join("");
  el("filters").innerHTML = `
    <label><span class="sr-only">Language</span><select data-filter="lang"><option value="">All languages</option>${langOptions}</select></label>
    <label><span class="sr-only">Platform</span><select data-filter="on"><option value="">Twitch and YouTube</option>${list.platforms.map((p) => `<option value="${p}"${p === f.on ? " selected" : ""}>${PLATFORM_NAMES[p]} only</option>`).join("")}</select></label>`;

  const generated = new Date(list.generated);
  const age = Math.round((Date.now() - generated.getTime()) / 60_000);
  const audience = shown.reduce((n, s) => n + s.viewers, 0);
  const late = age > 30 ? ` The list is late: it was made at ${time.format(generated)}.` : "";
  const missing = (["twitch", "youtube"] as const).filter((p) => !list!.platforms.includes(p)).map((p) => PLATFORM_NAMES[p]);
  const without = missing.length ? ` ${missing.join(" and ")} could not be read this time.` : "";
  el("summary").textContent = `${plural(shown.length, "stream")} live, ${number.format(audience)} watching. Updated ${age < 1 ? "just now" : `${plural(age, "minute")} ago`}.${late}${without}`;

  el("main").innerHTML = shown.length ? arrange(blocksOf(shown), stamp) : `<p class="status">No Magic stream live right now${f.lang || f.on ? " with these filters" : ""}.</p>`;
  renderHead();
}

async function load() {
  try {
    const res = await fetch(`${SOURCE}?t=${Math.floor(Date.now() / 60_000)}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    list = (await res.json()) as LiveList;
    loadedAt = Date.now();
    render();
  } catch (error) {
    if (!list) el("main").innerHTML = `<p class="status">The list of live streams could not be loaded (${esc(String(error))}).</p>`;
  }
}

el("filters").addEventListener("change", (e) => {
  const select = e.target as HTMLSelectElement;
  const f = readFilters();
  if (select.dataset.filter === "lang") f.lang = select.value;
  if (select.dataset.filter === "on") f.on = select.value === "twitch" || select.value === "youtube" ? select.value : "";
  writeFilters(f);
  render();
});
el("main").addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  const button = target.closest<HTMLButtonElement>("button[data-open]");
  if (button) {
    opened.add(button.dataset.open!);
    render();
    return;
  }
  // A stream opens in the panel; with a modifier key or the middle button, in a new tab as before.
  const a = target.closest<HTMLAnchorElement>("a.mtile[data-watch]");
  if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  watch(a.dataset.watch);
  if (narrow.matches) window.scrollTo({ top: 0, behavior: "smooth" });
});
el("player").addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  if (target.closest("[data-close]")) watch(undefined);
  else if (target.closest("[data-full]")) void el("player").querySelector<HTMLElement>(".player-video")?.requestFullscreen();
  else if (target.closest("[data-chat]") && watching) {
    withChat = !withChat;
    const panel = el("player");
    panel.querySelector(".player-chat")?.remove();
    if (withChat) panel.querySelector(".player-body")?.insertAdjacentHTML("beforeend", chatFrame(watching));
    renderHead();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && watching && !(e.target instanceof HTMLSelectElement)) watch(undefined);
});
// Fresh every five minutes, and on coming back to the tab.
setInterval(() => void load(), REFRESH);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && Date.now() - loadedAt > 2 * 60_000) void load();
});
const asked = readWatch();
if (asked) watch(asked);
void load();
