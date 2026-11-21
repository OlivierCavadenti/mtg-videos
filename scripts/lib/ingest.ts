import type { Creator, Video } from "../../shared/model.ts";
import { classify, offTopic } from "./classify.ts";
import type { FeedEntry } from "./feeds.ts";
import type { SetIndex } from "./sets.ts";
import { podcastId, type Store } from "./store.ts";
import { applyTags, type CardIndex } from "./tags.ts";

export interface IngestContext {
  sets: SetIndex;
  cards: CardIndex;
  historyStart: string;
}

export type Outcome = "added" | "updated" | "unchanged" | "skipped";

/**
 * Adds a feed entry to the archive, or refreshes the one already there: a title can change after
 * upload, and then a rule-based classification is done again (a language-model one is kept).
 */
export function upsert(store: Store, creator: Creator, entry: FeedEntry, { sets, cards, historyStart }: IngestContext): Outcome {
  if (!entry.published || entry.published.toISOString() < historyStart) return "skipped";
  const id = creator.platform === "youtube" ? entry.externalId : podcastId(creator.id, entry.externalId);
  const existing = store.get(creator.id, id);

  if (existing) {
    const next: Video = { ...existing };
    if (entry.title && entry.title !== existing.title) next.title = entry.title;
    if (!next.duration && entry.duration) next.duration = entry.duration;
    if (next.title !== existing.title && next.by === "rules" && !next.hidden) {
      delete next.set;
      delete next.setFrom;
      delete next.heard;
      Object.assign(next, classify({ title: next.title, published: next.published, platform: next.platform, heard: existing.heard }, creator, sets));
    }
    if (next.title !== existing.title && !next.hidden) applyTags(next, cards);
    if (JSON.stringify(next) === JSON.stringify(existing)) return "unchanged";
    store.put(next);
    return "updated";
  }

  const video: Video = {
    id,
    creator: creator.id,
    platform: creator.platform,
    url: entry.url,
    title: entry.title,
    published: entry.published.toISOString(),
    ...(entry.duration ? { duration: entry.duration } : {}),
    formats: [],
    kind: "other",
    by: "rules",
  };
  // Shorts: flagged by the feed, or under a minute when only the API saw them.
  if (entry.isShort || (creator.platform === "youtube" && entry.duration !== undefined && entry.duration <= 60)) video.hidden = "short";
  else if (offTopic(entry.title)) video.hidden = "off-topic";
  else {
    Object.assign(video, classify({ title: video.title, published: video.published, platform: video.platform }, creator, sets));
    applyTags(video, cards);
  }
  store.put(video);
  return "added";
}
