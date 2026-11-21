/**
 * Fills the archive back to `historyStart` (config/creators.json): the whole upload history of
 * each YouTube channel (needs YOUTUBE_API_KEY, a YouTube Data API v3 key) and of each podcast feed.
 *   YOUTUBE_API_KEY=… npm run backfill [-- --creator <id>] [-- --since 2024-01-01]
 * Run it again after moving historyStart back; what is already there is only refreshed.
 */
import { parseArgs } from "node:util";
import { parsePodcastFeed } from "./lib/feeds.ts";
import { getText } from "./lib/http.ts";
import { upsert, type Outcome } from "./lib/ingest.ts";
import { loadSets, SetIndex } from "./lib/sets.ts";
import { CardIndex } from "./lib/tags.ts";
import { loadConfig, Store } from "./lib/store.ts";
import { channelEntries } from "./lib/youtube.ts";

const { values } = parseArgs({ options: { creator: { type: "string" }, since: { type: "string" } } });
const config = loadConfig();
const since = values.since ?? config.historyStart;
const allSets = loadSets();
const sets = new SetIndex(allSets);
const cards = CardIndex.load(new Map(allSets.map((s) => [s.code, s])));
const store = Store.load();
const key = process.env.YOUTUBE_API_KEY;
if (!key) console.warn("YOUTUBE_API_KEY is not set: YouTube channels are skipped, podcasts only.");

for (const creator of config.creators.filter((c) => c.enabled !== false && (!values.creator || c.id === values.creator))) {
  if (creator.platform === "youtube" && !key) continue;
  try {
    const entries =
      creator.platform === "youtube"
        ? await channelEntries(creator.feed, key!, new Date(since))
        : parsePodcastFeed(await getText(creator.feed, "application/rss+xml,application/xml;q=0.9,*/*;q=0.5"));
    const counts: Record<Outcome, number> = { added: 0, updated: 0, unchanged: 0, skipped: 0 };
    for (const entry of entries) counts[upsert(store, creator, entry, { sets, cards, historyStart: since })]++;
    console.log(`${creator.id.padEnd(26)} +${counts.added} ~${counts.updated} (${entries.length} read)`);
    store.save();
  } catch (error) {
    console.warn(`${creator.id.padEnd(26)} skipped: ${(error as Error).message}`);
  }
}
