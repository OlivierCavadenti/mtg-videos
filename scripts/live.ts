/**
 * The Magic streams live now on Twitch and YouTube, by format from their titles.
 *   node scripts/live.ts --out <dir> --state <file>
 * Writes <dir>/live.json, which the Live streams page reads, and <dir>/streamers.json, every
 * streamer seen live (the database that learns each one's usual format). <file> keeps what need
 * not be published: the Twitch token, the YouTube videos already checked.
 *   Twitch (TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET): every stream live in the Magic category.
 *   YouTube (YOUTUBE_API_KEY): the channels of the database, read through their feeds a third at
 *   a time, and every four hours a search for Magic lives, which brings in new channels.
 * A platform without its keys is left out.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { LiveList, LivePlatform, LiveStream, Streamer } from "../shared/model.ts";
import { parseYoutubeFeed } from "./lib/feeds.ts";
import { getText } from "./lib/http.ts";
import { loadSets, SetIndex } from "./lib/sets.ts";
import { classifyStream, isMagic, recordStream, streamerKey } from "./lib/streams.ts";
import { loadConfig } from "./lib/store.ts";
import { appToken, gameIds, liveStreams, type TwitchToken } from "./lib/twitch.ts";
import { liveDetails, searchLive } from "./lib/youtube.ts";

const { values } = parseArgs({ options: { out: { type: "string" }, state: { type: "string" } } });
if (!values.out || !values.state) {
  console.error("usage: node scripts/live.ts --out <dir> --state <file>");
  process.exit(2);
}
const OUT = values.out;
const STATE = values.state;

interface State {
  twitchToken?: TwitchToken;
  twitchGames?: string[];
  lastSearch?: string;
  /** Where the round of YouTube feeds is. */
  feedCursor?: number;
  /** YouTube videos checked: live, coming, or not (or no longer) a live. */
  youtube: Record<string, { status: "live" | "upcoming" | "none"; at: string }>;
}

const HOUR = 3_600_000;
const now = new Date();
const nowIso = now.toISOString();
const readJson = <T>(file: string, fallback: T): T => (existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : fallback);
const state = readJson<State>(STATE, { youtube: {} });
const db = new Map(readJson<Streamer[]>(join(OUT, "streamers.json"), []).map((s) => [streamerKey(s.platform, s.channel), s]));
const allSets = loadSets();
const sets = new SetIndex(allSets);
const streams: LiveStream[] = [];
const failures: string[] = [];

// ------------------------------------------------------------------ Twitch

const MAGIC_CATEGORIES = ["Magic: The Gathering"];

async function twitch(clientId: string, secret: string) {
  if (!state.twitchToken || state.twitchToken.expires - Date.now() < 24 * HOUR) state.twitchToken = await appToken(clientId, secret);
  if (!state.twitchGames?.length) state.twitchGames = await gameIds(MAGIC_CATEGORIES, clientId, state.twitchToken);
  // Without a category, Twitch would list every stream of every game.
  if (!state.twitchGames.length) throw new Error(`no Twitch category named ${MAGIC_CATEGORIES.join(", ")}`);
  for (const s of await liveStreams(state.twitchGames, clientId, state.twitchToken)) {
    const streamer = db.get(streamerKey("twitch", s.user_id));
    const c = classifyStream(s.title, s.user_name, now, sets, streamer);
    if (!c) continue;
    const lang = s.language && s.language !== "other" ? s.language : undefined;
    recordStream(db, { platform: "twitch", channel: s.user_id, login: s.user_login, name: s.user_name, ...(lang ? { lang } : {}), stream: s.id, formats: c.formats, ...(c.usual ? { usual: c.usual } : {}) }, "twitch", nowIso);
    streams.push({
      platform: "twitch",
      id: s.id,
      channel: s.user_id,
      name: s.user_name,
      title: s.title,
      url: `https://www.twitch.tv/${s.user_login}`,
      thumb: s.thumbnail_url.replace("{width}", "440").replace("{height}", "248"),
      viewers: s.viewer_count,
      started: s.started_at,
      ...(lang ? { lang } : {}),
      ...c,
    });
  }
}

// ------------------------------------------------------------------ YouTube

const FEEDS_PER_ROUND = 3;
const SEARCH_EVERY = 4 * HOUR;

async function youtube(key: string) {
  // The archive's creators are watched too.
  for (const c of loadConfig().creators) {
    const channel = c.platform === "youtube" ? new URL(c.feed).searchParams.get("channel_id") : null;
    if (channel && !db.has(streamerKey("youtube", channel))) db.set(streamerKey("youtube", channel), { platform: "youtube", channel, name: c.name, lang: c.language, from: "creator", first: nowIso, streams: 0, formats: {} });
  }
  const candidates = new Set<string>();
  // Every four hours, a search finds the Magic lives of channels not known yet (100 units).
  if (!state.lastSearch || now.getTime() - Date.parse(state.lastSearch) >= SEARCH_EVERY) {
    state.lastSearch = nowIso;
    for (const hit of await searchLive('mtg|"magic the gathering"|mtga', key)) {
      if (!isMagic(`${hit.title} ${hit.channelTitle}`)) continue;
      candidates.add(hit.videoId);
      const k = streamerKey("youtube", hit.channelId);
      if (!db.has(k)) db.set(k, { platform: "youtube", channel: hit.channelId, name: hit.channelTitle, from: "search", first: nowIso, streams: 0, formats: {} });
    }
  }
  // The feeds of a third of the channels each round, and every round those seen live lately.
  const channels = [...db.values()].filter((s) => s.platform === "youtube").sort((a, b) => a.channel.localeCompare(b.channel));
  const size = Math.ceil(channels.length / FEEDS_PER_ROUND);
  const start = ((state.feedCursor ?? 0) % FEEDS_PER_ROUND) * size;
  state.feedCursor = ((state.feedCursor ?? 0) + 1) % FEEDS_PER_ROUND;
  const recent = (s: Streamer) => s.last !== undefined && now.getTime() - Date.parse(s.last) < 2 * 24 * HOUR;
  const round = channels.filter((s, i) => (i >= start && i < start + size) || recent(s));
  for (const s of round) {
    try {
      const xml = await getText(`https://www.youtube.com/feeds/videos.xml?channel_id=${s.channel}`, "application/atom+xml");
      for (const e of parseYoutubeFeed(xml)) {
        const known = state.youtube[e.externalId];
        if (!e.published || now.getTime() - e.published.getTime() > 7 * 24 * HOUR || known?.status === "none") continue;
        candidates.add(e.externalId);
      }
    } catch {
      // A feed down (or a channel gone) is skipped this round.
    }
  }
  for (const [id, v] of Object.entries(state.youtube)) if (v.status !== "none") candidates.add(id);

  for (const d of await liveDetails([...candidates], key)) {
    state.youtube[d.id] = { status: d.status, at: nowIso };
    if (d.status !== "live") continue;
    const streamer = db.get(streamerKey("youtube", d.channelId));
    const c = classifyStream(d.title, d.channelTitle, now, sets, streamer);
    if (!c || (!c.formats.length && !isMagic(`${d.title} ${d.channelTitle}`) && streamer?.from === "search")) continue;
    const lang = d.lang ?? streamer?.lang;
    recordStream(db, { platform: "youtube", channel: d.channelId, name: d.channelTitle, ...(lang ? { lang } : {}), stream: d.id, formats: c.formats, ...(c.usual ? { usual: c.usual } : {}) }, "search", nowIso);
    streams.push({
      platform: "youtube",
      id: d.id,
      channel: d.channelId,
      name: d.channelTitle,
      title: d.title,
      url: `https://www.youtube.com/watch?v=${d.id}`,
      thumb: `https://i.ytimg.com/vi/${d.id}/hqdefault_live.jpg`,
      viewers: d.viewers ?? 0,
      started: d.started ?? nowIso,
      ...(lang ? { lang } : {}),
      ...c,
    });
  }
  // Videos checked more than three days ago are forgotten.
  for (const [id, v] of Object.entries(state.youtube)) if (now.getTime() - Date.parse(v.at) > 3 * 24 * HOUR) delete state.youtube[id];
}

// ------------------------------------------------------------------ run

const { TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, YOUTUBE_API_KEY } = process.env;
if (TWITCH_CLIENT_ID && TWITCH_CLIENT_SECRET) {
  await twitch(TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET).catch((error: unknown) => {
    failures.push("twitch");
    // An expired token is asked again next round.
    delete state.twitchToken;
    console.warn(`Twitch skipped: ${(error as Error).message}`);
  });
} else console.log("Twitch keys not set: Twitch left out");
if (YOUTUBE_API_KEY) {
  await youtube(YOUTUBE_API_KEY).catch((error: unknown) => {
    failures.push("youtube");
    console.warn(`YouTube skipped: ${(error as Error).message}`);
  });
} else console.log("YOUTUBE_API_KEY not set: YouTube left out");

streams.sort((a, b) => b.viewers - a.viewers);
const named = new Set(streams.flatMap((s) => (s.set ? [s.set] : [])));
const read = [TWITCH_CLIENT_ID && TWITCH_CLIENT_SECRET && !failures.includes("twitch") ? "twitch" : null, YOUTUBE_API_KEY && !failures.includes("youtube") ? "youtube" : null].filter((p): p is LivePlatform => p !== null);
const list: LiveList = {
  generated: nowIso,
  platforms: read,
  streams,
  sets: allSets.filter((s) => named.has(s.code)).map((s) => ({ code: s.code, name: s.name, icon: s.icon })),
};
const streamers = [...db.values()].sort((a, b) => a.platform.localeCompare(b.platform) || a.name.localeCompare(b.name));
writeFileSync(join(OUT, "live.json"), `${JSON.stringify(list)}\n`);
writeFileSync(join(OUT, "streamers.json"), `[\n${streamers.map((s) => JSON.stringify(s)).join(",\n")}\n]\n`);
writeFileSync(STATE, JSON.stringify(state));
const watching = streams.reduce((n, s) => n + s.viewers, 0);
console.log(`${streams.length} streams live (${watching} watching); ${streamers.length} streamers known${failures.length ? `; failed: ${failures.join(", ")}` : ""}`);
// Both platforms down: something is broken.
if (failures.length && failures.length === [TWITCH_CLIENT_SECRET, YOUTUBE_API_KEY].filter(Boolean).length) process.exit(1);
