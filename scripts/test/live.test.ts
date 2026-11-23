import { test } from "node:test";
import assert from "node:assert/strict";
import type { Streamer } from "../../shared/model.ts";
import { loadSets, SetIndex } from "../lib/sets.ts";
import { classifyStream, isMagic, recordStream, usualFormat } from "../lib/streams.ts";

const sets = new SetIndex(loadSets());
const at = new Date("2026-11-23T12:00:00Z");
const streamer = (formats: Streamer["formats"]): Streamer => ({ platform: "twitch", channel: "1", name: "Someone", from: "twitch", first: "2026-01-01", streams: 10, formats });

test("a stream's format comes from its title, chat commands and channel name aside", () => {
  assert.deepEqual(classifyStream("!merch !discord | Vintage Cube Draft | come hang", "Someone", at, sets)?.formats, ["cube"]);
  assert.deepEqual(classifyStream("Pauper League w/ Grixis Affinity !deck", "Someone", at, sets)?.formats, ["pauper"]);
  assert.deepEqual(classifyStream("Limited Larry hangs out | !youtube", "Limited Larry", at, sets)?.formats, []);
});

test("a title naming no format takes the streamer's usual one, when there is one", () => {
  const c = classifyStream("Chill vibes, chatting with chat", "Someone", at, sets, streamer({ limited: 7, cube: 1 }));
  assert.deepEqual([c?.formats, c?.usual], [["limited"], true]);
  assert.equal(usualFormat(streamer({ limited: 2 })), undefined);
  assert.equal(usualFormat(streamer({ limited: 3, standard: 3 })), undefined);
  assert.equal(classifyStream("Riftbound boxes!", "Someone", at, sets), null);
});

test("a stream counts once in the database, and the guessed format not at all", () => {
  const db = new Map<string, Streamer>();
  const seen = { platform: "twitch" as const, channel: "1", name: "Someone", stream: "s1", formats: ["modern" as const] };
  recordStream(db, seen, "twitch", "2026-11-23T12:00:00Z");
  recordStream(db, seen, "twitch", "2026-11-23T12:05:00Z");
  recordStream(db, { ...seen, stream: "s2", usual: true }, "twitch", "2026-11-24T12:00:00Z");
  const s = db.get("twitch:1")!;
  assert.deepEqual([s.streams, s.formats.modern, s.last], [2, 1, "2026-11-24T12:00:00Z"]);
});

test("a YouTube search hit is kept only when it is about Magic", () => {
  assert.ok(isMagic("【#mtg #初見歓迎】オリジナルのゴルガリデッキでミシック目指すぞ！"));
  assert.ok(isMagic("【#MagicTheGatheringArena】特別講師に教えてもらいつつMtGやってくよ"));
  assert.ok(isMagic("Test Stream! Playing Magic with a Clone only deck!"));
  assert.ok(!isMagic("EUMETSAT Earth view - MTG FCI Atlantic Ocean GeoColour EUMETSAT"));
  assert.ok(!isMagic("medieval lofi radio - beats to scribe manuscripts to"));
});
