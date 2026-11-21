import type { Creator, Format, Kind, Video } from "../../shared/model.ts";
import { normalizeWords, type SetIndex } from "./sets.ts";

/**
 * Rule-based classification of a video from its title and, when there is one, its transcript.
 * Language-model classifications imported from ManaRadar are kept: only their set is checked
 * against the title.
 */

// Matched against a title without accents ("limité" → "limite").
const FORMAT_PATTERNS: Array<[Format, RegExp]> = [
  ["cube", /\bcube\b/i],
  ["limited", /\bdrafts?\b|\bdrafting\b|\bsealed\b|\bscelle\b|\bprerelease\b|\blimited\b|\blimite\b|\b17 ?lands\b|\bp1p1\b|\bpick orders?\b|\bjump ?start\b/i],
  ["standard", /\bstandard\b/i],
  ["alchemy", /\balchemy\b/i],
  // Explorer (Pioneer on Arena) only where it names the format, not a card ("Icetill Explorer").
  ["pioneer", /\bpioneer\b|\|\s*explorer\b|\bexplorer(?=\s*(\||$|bo[13]\b|ladder|league|meta|gauntlet))/i],
  ["historic", /\bhistoric\b/i],
  ["timeless", /\btimeless\b/i],
  ["premodern", /\bpre-?modern\b/i],
  ["modern", /(?<!pre-?)\bmodern\b(?! horizons)/i],
  ["legacy", /\blegacy\b/i],
  ["vintage", /\bvintage\b/i],
  ["pauper", /\bpauper\b/i],
  ["commander", /\b(commander|edh|cedh)\b(?! (legends|masters))/i],
  ["brawl", /\bbrawl\b/i],
];

/** Formats a text names, in the order it names them. */
export function formatsIn(text: string): Format[] {
  const found: Array<{ format: Format; at: number }> = [];
  for (const [format, pattern] of FORMAT_PATTERNS) {
    const m = pattern.exec(text);
    if (m) found.push({ format, at: m.index });
  }
  found.sort((a, b) => a.at - b.at);
  return found.map((f) => f.format);
}

/** The formats a transcript talks about: named five times or more, most named first. */
function formatsInTranscript(transcript: string): Format[] {
  const counts: Array<{ format: Format; n: number }> = [];
  for (const [format, pattern] of FORMAT_PATTERNS) {
    const n = transcript.match(new RegExp(pattern.source, "gi"))?.length ?? 0;
    if (n >= 5) counts.push({ format, n });
  }
  return counts.sort((a, b) => b.n - a.n).map((c) => c.format);
}

// First match wins. Matched against a title without accents.
const KIND_PATTERNS: Array<[Kind, RegExp, (f: Format | undefined) => boolean]> = [
  [
    "set-review",
    /\bset reviews?\b|\bcard reviews?\b|\breview(ing)?\b|\btier list\b|\bfirst (look|impressions)\b|\bratings?\b|\bgrades?\b|\bbest (commons|uncommons|rares)\b|\btop \d+\b[^|]*\bcards\b|\banalyse\b[^|]*\bcartes\b|\brevue\b/i,
    (f) => f === "limited" || f === "cube" || f === undefined,
  ],
  ["sealed", /\bsealed\b|\bscelle\b|\bprerelease\b|\bavant-premiere\b/i, () => true],
  ["news", /\bbann?(ed|ing|s)?\b|\bunban(ned|s)?\b|\bb&r\b|\bannounce(ment|d)?\b|\bspoilers?\b|\breveal(ed|s)?\b|\bpreviews?\b|\bnews\b|\bleaks?\b/i, () => true],
  ["limited-strategy", /\barchetypes?\b|\bguide\b|\bformat overview\b|\bstate of the format\b|\bhow to (draft|win|beat)\b|\btips\b|\bbest (colors?|decks?|archetypes?)\b|\bcolor pairs?\b/i, (f) => f === "limited"],
  ["draft", /\bdrafts?\b|\bdrafting\b|\bdrafted\b|\bdrafters?\b|\bp1p1\b|\btrophy\b|\b7-[0-2]\b|\b3-0\b/i, (f) => f === "limited" || f === "cube"],
  [
    "tournament",
    /\bpro tour\b|\bworld championship\b|(?<!(new|post)[- ])\bworlds\b|\bregional championship\b|\brcq?\b|\bmocs\b|\bchallenge\b|\btop ?8\b|\bqualifier\b|\bspotlight\b|\bmagic ?con\b|\barena championship\b|\bgrand prix\b|\bplayers tour\b|\btournament\b|\bcoverage\b|\bnrg\b|\bf2f\b|\bevent report\b/i,
    () => true,
  ],
  ["metagame", /\bmetagame\b|\bmeta\b|\btier list\b|\bbest decks?\b|\bstate of\b|\bformat (overview|update|state)\b|\bdecks to play\b/i, () => true],
  ["deck-guide", /\bdeck ?techs?\b|\bdeck guides?\b|\bsideboard(ing)? guides?\b|\bsideboarding\b|\bhow to play\b|\bprimer\b|\bdeck ?build(ing)?\b|\bbrew(s|ing)?\b|\bdecklists?\b/i, (f) => f !== "limited"],
  ["gameplay", /\bleague\b|\bgameplay\b|\branked\b|\bmythic\b|\bladder\b|\bvs\.?\b|\bversus\b|\bmatch(es)?\b|\btrophy\b|\b5-0\b|\bplaying\b/i, () => true],
  ["strategy", /\bhow to\b|\btips\b|\bmistakes\b|\btheory\b|\bguide\b|\blessons?\b|\bimprove\b|\bexplained\b|\bwhy you\b/i, () => true],
  ["discussion", /\bpodcast\b|\binterview\b|\bq ?& ?a\b|\bama\b|\bmailbag\b|\bepisode\b|\bep\.? ?\d+\b|#\d{2,}/i, () => true],
];

const withoutAccents = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "");

/** Stream titles carry chat commands ("!merch", "!holzkern"): they say nothing of the video. */
const withoutCommands = (s: string) => s.replace(/(^|\s)![a-z0-9_]+/gi, " ");

/** A title without the show's own name ("Limited Resources 879 – …" is not Limited because of it). */
function ownTitle(title: string, creator: Creator | undefined): string {
  let t = withoutCommands(withoutAccents(title));
  if (creator) {
    const name = withoutAccents(creator.name)
      .replace(/\s*\(.*\)$/, "")
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    t = t.replace(new RegExp(name.replace(/[-\s]+/g, "[-\\s]+"), "gi"), " ");
  }
  return t;
}

function kindOf(title: string, format: Format | undefined, creator: Creator | undefined, platform: Video["platform"]): Kind {
  for (const [kind, pattern, applies] of KIND_PATTERNS) if (applies(format) && pattern.test(title)) return kind;
  if (platform === "podcast" || creator?.show) return "discussion";
  if (format === "limited" || format === "cube") return "draft";
  if (format) return "gameplay";
  return "other";
}

const LIMITED_KINDS: ReadonlySet<Kind> = new Set(["draft", "sealed", "set-review", "limited-strategy"]);

export interface ClassifyInput {
  title: string;
  published: string;
  platform: Video["platform"];
  transcript?: string;
  /** Formats read earlier in a transcript no longer at hand (`Video.heard`). */
  heard?: Format[];
}

export type Classification = Pick<Video, "formats" | "kind" | "set" | "setFrom" | "heard" | "by">;

/**
 * Formats from the title, else the transcript, else what the creator does. Descriptions are not
 * read: their boilerplate ("my Pioneer guide") and decklists ("Icetill Explorer") mislead.
 */
export function classify(input: ClassifyInput, creator: Creator | undefined, sets: SetIndex): Classification {
  const at = new Date(input.published);
  const title = ownTitle(input.title, creator);
  let formats = formatsIn(title);
  let heard: Format[] | undefined;
  if (!formats.length && input.transcript) formats = heard = formatsInTranscript(withoutAccents(input.transcript)).slice(0, 2);
  if (!formats.length && input.heard?.length) formats = heard = input.heard;
  if (!formats.length && creator?.format) formats = [creator.format];
  if (!formats.length && creator?.focus.length === 1 && creator.focus[0] === "limited") formats = ["limited"];
  if (!formats.length && creator?.focus.length === 1 && creator.focus[0] === "commander") formats = ["commander"];
  // A set review is a Limited video unless the title says otherwise.
  if (!formats.length && /\bset review\b/i.test(title)) formats = ["limited"];
  formats = formats.slice(0, 3);

  let kind = kindOf(title, formats[0], creator, input.platform);
  const placed = placeSet(input.title, at, formats, kind, sets, input.transcript);
  // A constructed player's video on a set just out (brews, first games) is about Standard.
  if (!formats.length && placed.set && creator?.focus.includes("constructed") && !creator.focus.includes("limited") && sets.isFreshMainSet(placed.set, at)) {
    formats = ["standard"];
    kind = kindOf(title, "standard", creator, input.platform);
  }
  return { formats, kind, ...placed, ...(heard?.length ? { heard } : {}), by: "rules" };
}

/**
 * The set a video is about: named in its title, else named again and again in its transcript,
 * else, for a Limited video, the Limited format of the day it came out.
 */
export function placeSet(title: string, at: Date, formats: Format[], kind: Kind, sets: SetIndex, transcript?: string): Pick<Video, "set" | "setFrom"> {
  const named = sets.findInTitle(title, at);
  if (named) return { set: named, setFrom: "title" };
  const limited = formats[0] === "limited";
  if (!limited) return {};
  const heard = transcript ? sets.findInTranscript(transcript, at) : null;
  if (heard) return { set: heard, setFrom: "transcript" };
  if (!LIMITED_KINDS.has(kind) && kind !== "discussion") return {};
  const current = sets.currentLimitedSet(at, kind === "set-review" ? 35 : 0);
  return current ? { set: current, setFrom: "date" } : {};
}

/** A title about another game, a giveaway or the channel itself rather than Magic. */
export function offTopic(title: string): boolean {
  return /\b(giveaway|new merch|merch drop|channel update|stream schedule|flesh and blood|lorcana|pokemon|one piece tcg|riftbound|star wars unlimited)\b/i.test(withoutCommands(withoutAccents(title)));
}

/** Words of a title, for comparing two copies of one episode. */
export function titleWords(title: string): Set<string> {
  return new Set(
    normalizeWords(title.replace(/\b(ep(isode)?\.?|#)\s*\d+\b/gi, " "))
      .trim()
      .split(" ")
      .filter((w) => w.length > 2),
  );
}

export function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / Math.min(a.size, b.size);
}
