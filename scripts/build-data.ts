/**
 * Writes public/archive.json, what the page loads: the visible videos, their creators, the sets
 * they are about and the periods of the timeline.   npm run data
 *
 * Periods: each main set release opens one, named after the set. A video about a main set that
 * came out shortly before its release (previews, set reviews) or during the next period is filed
 * under that set's period; any other video goes by its date.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import type { Archive, ArchiveVideo, SetInfo, Video } from "../shared/model.ts";
import { similarity, titleWords } from "./lib/classify.ts";
import { loadSets, normalizeWords, SetIndex } from "./lib/sets.ts";
import { creatorMap, loadConfig, Store } from "./lib/store.ts";

const DAY = 86_400_000;
const config = loadConfig();
const creators = creatorMap(config);
const allSets = loadSets();
const index = new SetIndex(allSets);
const now = new Date();

const visible = Store.load()
  .all()
  .filter((v) => !v.hidden && v.published >= config.historyStart && creators.has(v.creator))
  .sort((a, b) => b.published.localeCompare(a.published) || a.id.localeCompare(b.id))
  // A feed that publishes an episode twice (a new guid, the same title within three days): kept once.
  .filter(
    (
      (seen) => (v: Video) => {
        const key = `${v.creator}|${normalizeWords(v.title)}`;
        const t = Date.parse(v.published);
        const last = seen.get(key);
        seen.set(key, t);
        return last === undefined || last - t > 3 * DAY;
      }
    )(new Map<string, number>()),
  );

// One show published as a podcast and as videos: the video stands for both.
const podcastOf = new Map<Video, string>();
const merged = new Set<Video>();
const showVideos = new Map<string, Video[]>();
for (const v of visible) {
  const show = creators.get(v.creator)?.show;
  if (show && v.platform === "youtube") showVideos.set(show, [...(showVideos.get(show) ?? []), v]);
}
for (const p of visible) {
  const show = creators.get(p.creator)?.show;
  if (!show || p.platform !== "podcast") continue;
  const words = titleWords(p.title);
  let best: { video: Video; score: number } | null = null;
  for (const v of showVideos.get(show) ?? []) {
    if (podcastOf.has(v) || Math.abs(Date.parse(v.published) - Date.parse(p.published)) > 6 * DAY) continue;
    const score = similarity(words, titleWords(v.title));
    if (score >= 0.5 && (!best || score > best.score)) best = { video: v, score };
  }
  if (!best) continue;
  podcastOf.set(best.video, p.url);
  merged.add(p);
  // The episode's language-model classification is worth more than the rules on the video.
  if (best.video.by === "rules" && p.by === "llm") {
    Object.assign(best.video, { formats: p.formats, kind: p.kind, set: p.set, setFrom: p.setFrom, archetypes: p.archetypes, summary: p.summary, by: "llm" });
  }
}
const videos = visible.filter((v) => !merged.has(v));

// Periods, oldest first, from the one under way at historyStart; a coming set only once a video covers it.
const mains = index.mainSets;
const firstMain = Math.max(0, mains.findLastIndex((s) => s.released <= config.historyStart));
const today = now.toISOString().slice(0, 10);
const placedAhead = new Set(videos.map((v) => v.set).filter((c): c is string => Boolean(c)));
const eraSets: SetInfo[] = mains.slice(firstMain).filter((s) => s.released <= today || placedAhead.has(s.code));
const eras = eraSets.map((s, i) => ({ set: s.code, start: s.released, end: eraSets[i + 1]?.released ?? null }));
const eraOfSet = new Map(eras.map((e, i) => [e.set, i]));

function eraOf(v: Video): number {
  const day = v.published.slice(0, 10);
  const own = v.set && v.setFrom !== "date" ? eraOfSet.get(v.set) : undefined;
  if (own !== undefined) {
    const era = eras[own]!;
    const from = new Date(Date.parse(era.start) - 60 * DAY).toISOString().slice(0, 10);
    const to = era.end ? new Date(Date.parse(era.end) + 30 * DAY).toISOString().slice(0, 10) : "9999";
    if (day >= from && day <= to) return own;
  }
  let at = 0;
  for (let i = 0; i < eras.length; i++) if (eras[i]!.start <= day) at = i;
  return at;
}

// How a video's views compare with its creator's usual: the median of their other videos read at
// the same stage. Read the day after release: the 30 read that way before it. Read later (older
// videos, read once at import): those published within two months around it.
const DAY_AFTER_HOURS = 72;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const scores = new Map<Video, number>();
const measured = new Map<string, Video[]>();
for (const v of videos) {
  if (!v.views) continue;
  const list = measured.get(v.creator);
  if (list) list.push(v);
  else measured.set(v.creator, [v]);
}
for (const list of measured.values()) {
  list.sort((a, b) => a.published.localeCompare(b.published));
  list.forEach((v, i) => {
    const fresh = v.views!.hours < DAY_AFTER_HOURS;
    const t = Date.parse(v.published);
    const peers = fresh
      ? list
          .slice(0, i)
          .filter((o) => o.views!.hours < DAY_AFTER_HOURS)
          .slice(-30)
      : list.filter((o) => o !== v && o.views!.hours >= DAY_AFTER_HOURS && Math.abs(Date.parse(o.published) - t) <= 60 * DAY);
    if (peers.length < 5) return;
    const usual = median(peers.map((o) => o.views!.n));
    if (usual > 0) scores.set(v, Math.round((v.views!.n / usual) * 10) / 10);
  });
}

const creatorList = config.creators.filter((c) => videos.some((v) => v.creator === c.id));
const creatorIndex = new Map(creatorList.map((c, i) => [c.id, i]));
const order = eras.length - 1;

const out: ArchiveVideo[] = videos.map((v) => {
  const [format = "other", ...also] = v.formats;
  const a: ArchiveVideo = {
    id: v.id,
    c: creatorIndex.get(v.creator)!,
    title: v.title,
    at: v.published.replace(/\.\d{3}Z$/, "Z"),
    format,
    kind: v.kind,
    // Newest first in the file.
    era: order - eraOf(v),
  };
  if (v.platform === "podcast") a.url = v.url;
  if (v.duration) a.duration = v.duration;
  if (also.length) a.also = also;
  if (v.set) a.set = v.set;
  if (v.setFrom === "date") a.setGuessed = true;
  if (v.archetypes?.length) a.archetypes = v.archetypes;
  if (v.colors) a.colors = v.colors;
  if (v.colorsFrom === "cards") a.colorsHeard = true;
  // Cards heard in the transcript link to their first mention; the most discussed come first.
  if (v.cards?.length) a.cards = v.cards.map((c): [string, number?] => (c.at?.length ? [c.name, c.at[0]] : [c.name]));
  if (v.summary) a.summary = v.summary;
  const podcast = podcastOf.get(v);
  if (podcast) a.podcast = podcast;
  if (v.views) {
    a.views = v.views.n;
    const score = scores.get(v);
    if (score !== undefined) a.score = score;
    if (v.views.hours < DAY_AFTER_HOURS) a.dayAfter = true;
  }
  return a;
});

const named = new Set([...out.map((v) => v.set), ...eras.map((e) => e.set)].filter((c): c is string => Boolean(c)));
const archive: Archive = {
  generated: now.toISOString(),
  since: config.historyStart,
  creators: creatorList.map((c) => ({ id: c.id, name: c.name, language: c.language, platform: c.platform, home: c.home })),
  sets: allSets
    .filter((s) => named.has(s.code))
    .sort((a, b) => b.released.localeCompare(a.released))
    .map((s) => ({ code: s.code, name: s.name, released: s.released, icon: s.icon })),
  eras: [...eras].reverse(),
  videos: out,
};

mkdirSync(new URL("../public/", import.meta.url), { recursive: true });
const json = JSON.stringify(archive);
writeFileSync(new URL("../public/archive.json", import.meta.url), json);

const byFormat = new Map<string, number>();
for (const v of out) byFormat.set(v.format, (byFormat.get(v.format) ?? 0) + 1);
console.log(
  `${out.length} videos (${merged.size} podcast episodes merged with their video), ${archive.eras.length} periods, ${(json.length / 1024).toFixed(0)} KB`,
  Object.fromEntries([...byFormat].sort((a, b) => b[1] - a[1])),
);
