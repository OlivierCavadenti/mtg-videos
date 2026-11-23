import type { Format, LiveStream, Streamer } from "../../shared/model.ts";
import { offTopic, placeSet, titleFormats } from "./classify.ts";
import type { SetIndex } from "./sets.ts";

/**
 * Live streams: what format a stream is from its title, else from what its streamer usually
 * plays, and the database of streamers that learns the latter stream after stream.
 */

/** The format a streamer's titles name most: three streams at least, and three in five of them. */
export function usualFormat(s: Streamer | undefined): Format | undefined {
  if (!s) return undefined;
  const counts = Object.entries(s.formats) as Array<[Format, number]>;
  const named = counts.reduce((n, [, c]) => n + c, 0);
  const [top] = counts.sort((a, b) => b[1] - a[1]);
  return top && top[1] >= 3 && top[1] / named >= 0.6 ? top[0] : undefined;
}

export type StreamClass = Pick<LiveStream, "formats" | "usual" | "set" | "setGuessed">;

/** A stream's formats and set; null when the title is about something else than Magic. */
export function classifyStream(title: string, channelName: string, at: Date, sets: SetIndex, streamer?: Streamer): StreamClass | null {
  if (offTopic(title)) return null;
  let formats = titleFormats(title, channelName).slice(0, 3);
  let usual: true | undefined;
  if (!formats.length) {
    const f = usualFormat(streamer);
    if (f) {
      formats = [f];
      usual = true;
    }
  }
  const placed = formats.length ? placeSet(title, at, formats, "draft", sets) : {};
  return {
    formats,
    ...(usual ? { usual } : {}),
    ...(placed.set ? { set: placed.set } : {}),
    ...(placed.setFrom === "date" ? { setGuessed: true as const } : {}),
  };
}

export const streamerKey = (platform: Streamer["platform"], channel: string) => `${platform}:${channel}`;

/**
 * Notes a stream seen live: the streamer's name and language as they are now, and, once per
 * stream, one more stream and the formats its title names (not the usual one, guessed).
 */
export function recordStream(
  db: Map<string, Streamer>,
  seen: { platform: Streamer["platform"]; channel: string; login?: string; name: string; lang?: string; stream: string; formats: Format[]; usual?: true },
  from: Streamer["from"],
  now: string,
): Streamer {
  const key = streamerKey(seen.platform, seen.channel);
  const s: Streamer = db.get(key) ?? { platform: seen.platform, channel: seen.channel, name: seen.name, from, first: now, streams: 0, formats: {} };
  s.name = seen.name;
  if (seen.login) s.login = seen.login;
  if (seen.lang) s.lang = seen.lang;
  s.last = now;
  if (s.lastStream !== seen.stream) {
    s.lastStream = seen.stream;
    s.streams++;
    if (!seen.usual) for (const f of seen.formats) s.formats[f] = (s.formats[f] ?? 0) + 1;
  }
  db.set(key, s);
  return s;
}

// A YouTube search for Magic lives also brings lofi radios, and Meteosat's "MTG" satellites.
const SURELY_MAGIC = /magic:? ?the ?gathering|\bmtg ?a(rena)?\b|\bmtgo\b|\bmagic ?(arena|online)\b|#mtg\b|マジック:?ザ・?ギャザリング/i;
const MAGIC_NAME = /\bmtg\b|\bmagic\b/i;
const MAGIC_WORDS = /\b(decks?|draft(ing)?|arena|commander|edh|cube|sealed|limited|standard|pioneer|modern|legacy|vintage|pauper|historic|timeless|brawl|mythic|ladder|bo[13]|prerelease|boosters?|packs?|planeswalkers?)\b|デッキ|ドラフト|ミシック/i;

/** A title or channel about Magic: named outright, or "MTG"/"Magic" with a word of the game. */
export const isMagic = (text: string) => SURELY_MAGIC.test(text) || (MAGIC_NAME.test(text) && MAGIC_WORDS.test(text));
