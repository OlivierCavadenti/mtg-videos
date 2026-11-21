import { test } from "node:test";
import assert from "node:assert/strict";
import type { Creator } from "../../shared/model.ts";
import { classify, formatsIn, offTopic, similarity, titleWords } from "../lib/classify.ts";
import { parsePodcastFeed, parseYoutubeFeed } from "../lib/feeds.ts";
import { loadSets, SetIndex } from "../lib/sets.ts";
import { parseIsoDuration, uploadPlaylists } from "../lib/youtube.ts";

const sets = new SetIndex(loadSets());
const creator = (over: Partial<Creator> = {}): Creator => ({ id: "c", name: "Someone", platform: "youtube", feed: "https://example.com", home: "https://example.com", focus: ["constructed"], language: "en", ...over });

test("formats come in the order the title names them", () => {
  assert.deepEqual(formatsIn("Izzet Prowess | Standard Bo3 | Pioneer next"), ["standard", "pioneer"]);
  assert.deepEqual(formatsIn("Modern Horizons 3 draft"), ["limited"]);
  assert.deepEqual(formatsIn("Golgari Icetill Explorer deck"), []);
  assert.deepEqual(formatsIn("White Aggro | Explorer Bo3"), ["pioneer"]);
});

test("a show's own name does not make it Limited", () => {
  const c = classify({ title: "Limited Resources 869 – Anatomy of a Great Cube Deck", published: "2026-09-10T00:00:00Z", platform: "podcast" }, creator({ name: "Limited Resources", platform: "podcast", focus: ["limited"] }), sets);
  assert.equal(c.formats[0], "cube");
});

test("a set named in the title wins, nicknames included", () => {
  assert.equal(sets.findInTitle("Lorwyn Eclipsed Draft | MTG Arena", new Date("2026-02-01")), "ECL");
  assert.equal(sets.findInTitle("Tarkir Dragonstorm Draft", new Date("2025-04-20")), "TDM");
  assert.equal(sets.findInTitle("THIS DECK IS INSANE", new Date("2026-02-01")), null);
  assert.equal(sets.findInTitle("Ouroboroid Is a BRO | Simic Midrange | Standard Bo3", new Date("2025-08-30")), null);
  assert.equal(sets.findInTitle("Best commons in DFT | Limited", new Date("2025-03-01")), "DFT");
  assert.equal(sets.findInTitle("Gruul Landfall | EOE | MTG Arena", new Date("2025-08-10")), "EOE");
});

test("a Limited video naming no set gets the Limited format of its day", () => {
  const c = classify({ title: "Winning a trophy with this deck", published: "2025-08-20T00:00:00Z", platform: "youtube" }, creator({ focus: ["limited"] }), sets);
  assert.deepEqual([c.formats[0], c.kind, c.set, c.setFrom], ["limited", "draft", "EOE", "date"]);
});

test("a set review before release is about the coming set", () => {
  const c = classify({ title: "Complete set review: green", published: "2025-07-20T00:00:00Z", platform: "youtube" }, creator({ focus: ["limited"] }), sets);
  assert.equal(c.set, "EOE");
});

test("chat commands in stream titles are not read", () => {
  assert.equal(offTopic("Shrines Never Lose! | !merch | December 23, 2025"), false);
  assert.equal(offTopic("My Flesh and Blood deck for Worlds"), true);
});

test("a constructed player's video on a fresh set is Standard", () => {
  const c = classify({ title: "Ten New Brews! - Bant Federation - Star Trek", published: "2026-11-13T00:00:00Z", platform: "youtube" }, creator(), sets);
  assert.deepEqual([c.formats[0], c.set], ["standard", "TRK"]);
});

test("two copies of one episode are recognised", () => {
  assert.ok(similarity(titleWords("Lords of Limited 512 – Star Trek Top Commons"), titleWords("Star Trek Top Commons | Lords of Limited Ep. 512")) >= 0.5);
});

test("feeds and API values are parsed", () => {
  const atom = `<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/"><entry><yt:videoId>abc123</yt:videoId><title>Draft &amp; more</title><link rel="alternate" href="https://www.youtube.com/shorts/abc123"/><published>2026-01-02T10:00:00+00:00</published><media:group><media:description>Hi https://x.y</media:description></media:group></entry></feed>`;
  const [e] = parseYoutubeFeed(atom);
  assert.deepEqual([e?.externalId, e?.title, e?.isShort, e?.description], ["abc123", "Draft & more", true, "Hi"]);
  const rss = `<rss><channel><item><guid isPermaLink="false">g1</guid><title><![CDATA[Ep 1]]></title><link>https://p.example/1</link><pubDate>Fri, 02 Jan 2026 10:00:00 GMT</pubDate><itunes:duration>1:02:03</itunes:duration><enclosure url="https://p.example/1.mp3"/></item></channel></rss>`;
  const [p] = parsePodcastFeed(rss);
  assert.deepEqual([p?.externalId, p?.title, p?.duration], ["g1", "Ep 1", 3723]);
  assert.equal(parseIsoDuration("PT1H2M3S"), 3723);
  assert.deepEqual(uploadPlaylists("https://www.youtube.com/feeds/videos.xml?channel_id=UCabc"), ["UULFabc", "UULVabc"]);
});
