/**
 * Hourly update: reads every creator's feed and adds what is new to data/videos/.
 *   npm run sync [-- --creator <id>]
 * YouTube feeds list the 15 latest uploads; with YOUTUBE_API_KEY set, the API is read instead
 * (two pages: durations included). Podcast feeds hold their whole history.
 */
import { parseArgs } from "node:util";
import type { Creator } from "../shared/model.ts";
import { parsePodcastFeed, parseYoutubeFeed, type FeedEntry } from "./lib/feeds.ts";
import { getText } from "./lib/http.ts";
import { upsert, type Outcome } from "./lib/ingest.ts";
import { loadSets, SetIndex } from "./lib/sets.ts";
import { CardIndex } from "./lib/tags.ts";
import { loadConfig, Store } from "./lib/store.ts";
import { channelEntries } from "./lib/youtube.ts";

const { values } = parseArgs({ options: { creator: { type: "string" } } });
const config = loadConfig();
const allSets = loadSets();
const sets = new SetIndex(allSets);
const cards = CardIndex.load(new Map(allSets.map((s) => [s.code, s])));
const store = Store.load();
const key = process.env.YOUTUBE_API_KEY;
const FEED_ACCEPT = "application/atom+xml,application/rss+xml,application/xml;q=0.9,*/*;q=0.5";

async function entriesOf(creator: Creator): Promise<FeedEntry[]> {
  if (creator.platform === "youtube" && key) {
    const since = new Date(Date.now() - 30 * 86_400_000);
    return channelEntries(creator.feed, key, since, 2);
  }
  const xml = await getText(creator.feed, FEED_ACCEPT);
  return creator.platform === "youtube" ? parseYoutubeFeed(xml) : parsePodcastFeed(xml);
}

const creators = config.creators.filter((c) => c.enabled !== false && (!values.creator || c.id === values.creator));
const totals: Record<Outcome, number> = { added: 0, updated: 0, unchanged: 0, skipped: 0 };
const failed: string[] = [];
for (const creator of creators) {
  try {
    const counts: Record<Outcome, number> = { added: 0, updated: 0, unchanged: 0, skipped: 0 };
    for (const entry of await entriesOf(creator)) counts[upsert(store, creator, entry, { sets, cards, historyStart: config.historyStart })]++;
    for (const k of Object.keys(totals) as Outcome[]) totals[k] += counts[k];
    console.log(`${creator.id.padEnd(26)} +${counts.added} ~${counts.updated}`);
  } catch (error) {
    failed.push(creator.id);
    console.warn(`${creator.id.padEnd(26)} skipped: ${(error as Error).message}`);
  }
}
store.save();
console.log(`added ${totals.added}, updated ${totals.updated}; ${failed.length} feed(s) failed${failed.length ? `: ${failed.join(", ")}` : ""}`);
// One feed down is routine; all of them down means something is broken.
if (creators.length > 0 && failed.length === creators.length) process.exit(1);
