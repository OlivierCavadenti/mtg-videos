import { XMLParser } from "fast-xml-parser";

export interface FeedEntry {
  /** YouTube video id, or the podcast episode guid (else its audio file, else its link). */
  externalId: string;
  url: string;
  title: string;
  /** Plain text, links removed (they are sponsor and social lists, not content). */
  description: string;
  published?: Date;
  duration?: number;
  isShort: boolean;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  parseTagValue: false,
  parseAttributeValue: false,
  htmlEntities: true,
  trimValues: true,
  isArray: (name) => ["entry", "item", "link", "enclosure"].includes(name),
});

type Node = Record<string, unknown>;

/** Text of an element that may carry attributes ({"#text": …}) or be missing. */
function text(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return text(value[0]);
  if (typeof value === "object") return text((value as Node)["#text"]);
  return "";
}

const attr = (value: unknown, name: string): string => {
  const node = Array.isArray(value) ? value[0] : value;
  return node && typeof node === "object" ? text((node as Node)[`@${name}`]) : "";
};

const date = (s: string) => (s && !Number.isNaN(Date.parse(s)) ? new Date(s) : undefined);

export const normalizeSpace = (s: string) =>
  s
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const stripUrls = (s: string) => s.replace(/https?:\/\/\S+/g, "").replace(/\bwww\.\S+/g, "");

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…", ndash: "–", mdash: "—" };

export function htmlToText(html: string): string {
  return normalizeSpace(
    html
      .replace(/<(br|\/p|\/li|\/h\d|\/div)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
        if (e[0] === "#") {
          const code = e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
          return Number.isFinite(code) ? String.fromCodePoint(code) : m;
        }
        return ENTITIES[e.toLowerCase()] ?? m;
      }),
  );
}

/** "1:02:03", "62:03" or "3723" → seconds. */
export function parseDuration(value: string): number | undefined {
  if (!value) return undefined;
  const parts = value.trim().split(":").map(Number);
  if (parts.length === 0 || parts.length > 3 || parts.some((p) => !Number.isFinite(p))) return undefined;
  return parts.reduce((total, p) => total * 60 + p, 0) || undefined;
}

/** YouTube channel or playlist feed (Atom + Media RSS): the 15 latest uploads, no duration. */
export function parseYoutubeFeed(xml: string): FeedEntry[] {
  const doc = parser.parse(xml) as Node;
  const entries = ((doc.feed as Node | undefined)?.entry as Node[] | undefined) ?? [];
  return entries
    .map((e) => {
      const videoId = text(e["yt:videoId"]);
      const links = (e.link as Node[] | undefined) ?? [];
      const alternate = links.find((l) => text(l["@rel"]) === "alternate");
      const url = (alternate && text(alternate["@href"])) || `https://www.youtube.com/watch?v=${videoId}`;
      const group = (e["media:group"] as Node | undefined) ?? {};
      return {
        externalId: videoId,
        url,
        title: normalizeSpace(text(e.title)),
        description: normalizeSpace(stripUrls(text(group["media:description"]))),
        published: date(text(e.published)),
        isShort: url.includes("/shorts/"),
      };
    })
    .filter((e) => e.externalId && e.title);
}

/** Podcast RSS 2.0 with the iTunes namespace. Feeds usually hold the whole history. */
export function parsePodcastFeed(xml: string): FeedEntry[] {
  const doc = parser.parse(xml) as Node;
  const items = (((doc.rss as Node | undefined)?.channel as Node | undefined)?.item as Node[] | undefined) ?? [];
  const seenAudio = new Set<string>();
  const out: FeedEntry[] = [];
  for (const e of items) {
    const audioUrl = attr(e.enclosure, "url");
    const link = text(e.link);
    const entry: FeedEntry = {
      externalId: text(e.guid) || audioUrl || link,
      url: link || audioUrl,
      title: normalizeSpace(text(e.title)),
      description: normalizeSpace(stripUrls(htmlToText(text(e["content:encoded"]) || text(e.description) || text(e["itunes:summary"])))),
      published: date(text(e.pubDate)),
      duration: parseDuration(text(e["itunes:duration"])),
      isShort: false,
    };
    if (!entry.externalId || !entry.url || !entry.title) continue;
    // Some feeds repeat an episode under a new guid: the audio file identifies it.
    if (audioUrl) {
      if (seenAudio.has(audioUrl)) continue;
      seenAudio.add(audioUrl);
    }
    out.push(entry);
  }
  return out;
}
