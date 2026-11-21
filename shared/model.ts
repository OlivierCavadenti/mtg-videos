/**
 * Types and vocabularies shared by the data scripts (scripts/) and the page (src/).
 */

export const FORMATS = [
  "limited",
  "cube",
  "standard",
  "alchemy",
  "pioneer",
  "historic",
  "timeless",
  "modern",
  "premodern",
  "legacy",
  "vintage",
  "pauper",
  "commander",
  "brawl",
] as const;
export type Format = (typeof FORMATS)[number];

export const FORMAT_NAMES: Record<Format | "other", string> = {
  limited: "Limited",
  cube: "Cube",
  standard: "Standard",
  alchemy: "Alchemy",
  pioneer: "Pioneer",
  historic: "Historic",
  timeless: "Timeless",
  modern: "Modern",
  premodern: "Premodern",
  legacy: "Legacy",
  vintage: "Vintage",
  pauper: "Pauper",
  commander: "Commander",
  brawl: "Brawl",
  other: "Other & general",
};

export const KINDS = [
  "draft",
  "sealed",
  "set-review",
  "limited-strategy",
  "gameplay",
  "deck-guide",
  "metagame",
  "tournament",
  "strategy",
  "news",
  "discussion",
  "other",
] as const;
export type Kind = (typeof KINDS)[number];

export const KIND_NAMES: Record<Kind, string> = {
  draft: "Draft",
  sealed: "Sealed",
  "set-review": "Set review",
  "limited-strategy": "Limited strategy",
  gameplay: "Gameplay",
  "deck-guide": "Deck guide",
  metagame: "Metagame",
  tournament: "Tournament",
  strategy: "Strategy",
  news: "News",
  discussion: "Discussion",
  other: "Other",
};

export type Platform = "youtube" | "podcast";
export type Focus = "limited" | "constructed" | "commander" | "general";
export type Language = "en" | "fr";

export interface Creator {
  id: string;
  name: string;
  platform: Platform;
  /** YouTube channel or playlist feed, or podcast RSS feed. */
  feed: string;
  home: string;
  /** What the creator is known for: a hint when a title names no format. */
  focus: Focus[];
  /** The format of a video whose title names none (a Pauper podcast, an Arena Standard channel). */
  format?: Format;
  language: Language;
  /** One show published both as a podcast and as videos: the two copies of an episode are merged. */
  show?: string;
  enabled?: boolean;
}

export interface CreatorsConfig {
  /** Nothing older is imported. */
  historyStart: string;
  creators: Creator[];
}

/** Where a video's set comes from, most reliable first. */
export type SetSource = "title" | "llm" | "transcript" | "date";

/** One video or podcast episode, as stored in data/videos/{year}.json. */
export interface Video {
  /** YouTube video id, or "p" + hash of the podcast episode guid. */
  id: string;
  creator: string;
  platform: Platform;
  url: string;
  title: string;
  /** ISO date-time, UTC. */
  published: string;
  /** Seconds. */
  duration?: number;
  /** Kept to remember not to import it again, never shown. */
  hidden?: "short" | "off-topic";
  /** Primary format first; empty when the video is not about one format. */
  formats: Format[];
  kind: Kind;
  /** Set code (uppercase) the video is about. */
  set?: string;
  setFrom?: SetSource;
  /** Formats read in the transcript when the title names none (transcripts themselves are not kept). */
  heard?: Format[];
  archetypes?: string[];
  /** One sentence, written by the classifier (never the creator's text). */
  summary?: string;
  /** "llm" (classified by a language model on ManaRadar) or "rules" (scripts/lib/classify.ts). */
  by: "llm" | "rules";
}

export interface SetInfo {
  code: string;
  name: string;
  released: string;
  type: string;
  icon: string;
  digital: boolean;
  parent?: string;
}

/** What the page loads: public/archive.json, written by scripts/build-data.ts. */
export interface Archive {
  generated: string;
  since: string;
  creators: Array<{ id: string; name: string; language: Language; platform: Platform; home: string }>;
  /** Only the sets the page names, newest first. */
  sets: Array<{ code: string; name: string; released: string; icon: string }>;
  /**
   * Periods between two main set releases, newest first. A period is named after the set that
   * opened it; `end` is the next one's release (null for the latest).
   */
  eras: Array<{ set: string; start: string; end: string | null }>;
  /** Newest first. */
  videos: ArchiveVideo[];
}

export interface ArchiveVideo {
  /** YouTube id (the page builds the link and thumbnail) or podcast episode id. */
  id: string;
  /** Index in `creators`. */
  c: number;
  title: string;
  /** Podcast episodes only: the episode page. */
  url?: string;
  /** YYYY-MM-DD. */
  date: string;
  duration?: number;
  /** Primary format, "other" when none. */
  format: Format | "other";
  /** Other formats it also covers. */
  also?: Format[];
  kind: Kind;
  set?: string;
  /** Set guessed from the date only (the Limited format of the moment). */
  setGuessed?: true;
  /** Index in `eras`. */
  era: number;
  archetypes?: string[];
  summary?: string;
  /** The same episode as a podcast. */
  podcast?: string;
}
