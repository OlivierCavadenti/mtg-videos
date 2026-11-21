import { readFileSync } from "node:fs";
import type { CardInfo, CardMention, SetInfo, Video } from "../../shared/model.ts";

/**
 * What a title says about the deck: its colors, its archetype name and the cards it names.
 * Rules only, no guessing: a title that names no color gets none.
 */

const ORDER = "WUBRG";
const sortColors = (letters: string) => [...ORDER].filter((c) => letters.includes(c)).join("");

const COLOR_WORDS: Record<string, string> = {
  azorius: "WU",
  dimir: "UB",
  rakdos: "BR",
  gruul: "RG",
  selesnya: "GW",
  orzhov: "WB",
  izzet: "UR",
  golgari: "BG",
  boros: "RW",
  simic: "GU",
  esper: "WUB",
  grixis: "UBR",
  jund: "BRG",
  naya: "RGW",
  bant: "GWU",
  abzan: "WBG",
  jeskai: "URW",
  sultai: "BGU",
  mardu: "RWB",
  temur: "GUR",
  silverquill: "WB",
  prismari: "UR",
  witherbloom: "BG",
  lorehold: "RW",
  quandrix: "GU",
};
const COLOR_NAMES: Record<string, string> = { white: "W", blue: "U", black: "B", red: "R", green: "G", w: "W", u: "U", b: "B", r: "R", g: "G" };
const NICKNAMES: Record<string, string> = { RUG: "GUR", BUG: "BGU", RDW: "R" };
const EMOJI: Record<string, string> = { "⚪": "W", "\u{1F535}": "U", "⚫": "B", "\u{1F534}": "R", "\u{1F7E2}": "G" };

const GUILD = new RegExp(`\\b(${Object.keys(COLOR_WORDS).join("|")})\\b`, "gi");
const MONO = /\bmono[- ]?(white|blue|black|red|green|w|u|b|r|g)\b/gi;
const PAIR = /\b(white|blue|black|red|green)[- /&]+(white|blue|black|red|green)\b/gi;
const SINGLE = /\b(white|blue|black|red|green)(?= (aggro|deck|control|midrange|tempo|ramp|stompy|devotion|beats|weenie|burn|prowess)\b)/gi;
const LETTERS = /\b([WUBRG]{2,3}|RUG|BUG|RDW)x?\b/g;
const EMOJI_RUN = /(?:(?:⚪|\u{1F535}|⚫|\u{1F534}|\u{1F7E2})️?\s*)+/gu;

interface Term {
  at: number;
  end: number;
  colors: string;
  /** Emoji carry colors, never an archetype name. */
  named: boolean;
}

function colorTerms(title: string): Term[] {
  const terms: Term[] = [];
  const letters = title.replace(/[^A-Za-z]/g, "");
  const shouting = letters.length > 0 && letters.replace(/[^A-Z]/g, "").length / letters.length > 0.6;
  const push = (m: RegExpMatchArray, colors: string, named = true) => terms.push({ at: m.index!, end: m.index! + m[0].length, colors: sortColors(colors), named });
  for (const m of title.matchAll(GUILD)) push(m, COLOR_WORDS[m[1]!.toLowerCase()]!);
  for (const m of title.matchAll(MONO)) push(m, COLOR_NAMES[m[1]!.toLowerCase()]!);
  for (const m of title.matchAll(PAIR)) if (m[1]!.toLowerCase() !== m[2]!.toLowerCase()) push(m, COLOR_NAMES[m[1]!.toLowerCase()]! + COLOR_NAMES[m[2]!.toLowerCase()]!);
  for (const m of title.matchAll(SINGLE)) push(m, COLOR_NAMES[m[1]!.toLowerCase()]!);
  if (!shouting) {
    for (const m of title.matchAll(LETTERS)) {
      const token = m[1]!;
      const colors = NICKNAMES[token] ?? token;
      if (new Set(colors).size === colors.length) push(m, colors);
    }
  }
  // All five colors in one title is decoration ("⚪ Mechanics! 🔵 Themes! ⚫ …"), not a deck.
  const decoration = new Set([...title].map((c) => EMOJI[c]).filter(Boolean)).size === 5;
  for (const m of decoration ? [] : title.matchAll(EMOJI_RUN)) {
    const colors = new Set([...m[0]].map((c) => EMOJI[c]).filter(Boolean));
    if (colors.size) push(m, [...colors].join(""), false);
  }
  // A term inside a longer one ("mono-red" holds "red") does not count twice.
  return terms.sort((a, b) => a.at - b.at || b.end - a.end).filter((t, i, all) => !all.some((o, j) => j < i && o.at <= t.at && o.end >= t.end));
}

/** Colors of the deck: those of the first color term of the title. */
export function colorsIn(title: string): string | undefined {
  const first = colorTerms(title)[0];
  return first?.colors || undefined;
}

const STOP = new Set(
  `a an and are as at back bad be best bo1 bo3 brew brews by can card cards challenge control cube deck decks draft every finally for from game games gameplay gets goes good got guide has have how in into is it its just league limited list makes mtg mtga mythic needs new now of on or play playing plays rank really sealed so still that the this to today top truly update vs versus was will win wins with without you your
  standard modern pioneer legacy vintage pauper historic timeless alchemy premodern commander brawl arena early access
  archetype archetypes shell shells deckbuilding again also are beat breaks break crush crushes destroy destroys dominate dominates does do goes go hit hits is isn't lose loses make makes smash smashes take takes went`.split(/\s+/),
);
const SEPARATOR = /[|:!?,()[\]–—"“”]| - |\p{Extended_Pictographic}/u;

/** Archetype names: a color term and the words that name the deck after it ("Simic Midrange", "Golgari Icetill"). */
export function archetypesIn(title: string): string[] {
  const out: string[] = [];
  for (const term of colorTerms(title)) {
    if (!term.named) continue;
    const rest = title.slice(term.end).split(SEPARATOR)[0] ?? "";
    const words: string[] = [];
    for (const w of rest.trim().split(/\s+/)) {
      const clean = w.replace(/^['"]+|['".…]+$/g, "");
      if (!clean || words.length === 2 || STOP.has(clean.toLowerCase()) || !/^[A-Z0-9]/.test(clean)) break;
      words.push(clean);
    }
    if (!words.length) continue;
    const name = `${title.slice(term.at, term.end).trim()} ${words.join(" ")}`;
    if (!out.some((o) => o.toLowerCase() === name.toLowerCase())) out.push(name);
  }
  return out.slice(0, 2);
}

// ------------------------------------------------------------------ cards

/** Lowercase words only: "He's Dead, Jim" and "he’s dead jim" read the same. */
const normalize = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Words so common that a card named only with them ("Last Chance", "Make Your Move") is not looked for in titles. */
const COMMON = new Set(
  `a about after again all also an and any are as at away back be because been before being best better big but by call can chance come could day did do does done down each end even every far find first for from get give go going good got great had has have he her here him his how i if in into is it its just keep know last let life like little long look make many may me more most move much must my never new next no not now of off old on once one only or other our out over own play power put real right run same see she should show so some still such sure take than that the their them then there these they thing think this those through time to too turn two up us very want was way we well were what when where which while who why will win with without work would year you your
  rise fall fire storm light dark night day sun moon star end final edge world worlds return lost found deal hold break fight strike charge wave call rush flash shock blast burst`.split(/\s+/),
);

/** Card names that are also game terms or show segments ("Flashback Draft", "Brainstorm Buddies"). */
const GAME_TERMS = new Set(
  `flashback brainstorm kicker cycling landfall prowess delirium energy affinity storm cascade convoke surveil scry ward flying trample haste lifelink deathtouch vigilance mill discover explore connive craft offspring gift impending exhaust station warp void harmonize mobilize flurry renew endure behold blight sealed draft cube`.split(/\s+/),
);

interface CardPattern {
  name: string;
  words: string[];
  released: number;
  /** One-word names are only found written with a capital, as a name. */
  single: boolean;
}

export class CardIndex {
  private readonly byFirstWord = new Map<string, CardPattern[]>();
  private readonly colors = new Map<string, string>();

  constructor(cards: CardInfo[], sets: Map<string, SetInfo>, setNames: Set<string>) {
    const seen = new Set<string>();
    for (const c of cards) {
      this.colors.set(c.name, c.colors);
      const released = Date.parse(sets.get(c.set)?.released ?? "");
      if (!Number.isFinite(released)) continue;
      for (const face of c.name.split(" // ")) {
        const norm = normalize(face);
        const words = norm.split(" ");
        if (seen.has(norm) || setNames.has(norm)) continue;
        if (words.every((w) => COMMON.has(w))) continue;
        if (words.length === 1 && (norm.length < 6 || GAME_TERMS.has(norm))) continue;
        seen.add(norm);
        const p: CardPattern = { name: c.name, words, released, single: words.length === 1 };
        const list = this.byFirstWord.get(words[0]!);
        if (list) list.push(p);
        else this.byFirstWord.set(words[0]!, [p]);
      }
    }
  }

  static load(sets: Map<string, SetInfo>): CardIndex {
    const cards = JSON.parse(readFileSync(new URL("../../data/cards.json", import.meta.url), "utf8")) as CardInfo[];
    const setNames = new Set([...sets.values()].map((s) => normalize(s.name)));
    return new CardIndex(cards, sets, setNames);
  }

  colorsOf(name: string): string | undefined {
    return this.colors.get(name);
  }

  /** Cards of the sets out within two years before the video (or due within two months) that its title names. */
  findInTitle(title: string, at: Date): string[] {
    const t = at.getTime();
    const words = normalize(title).split(" ");
    const found: string[] = [];
    for (let i = 0; i < words.length; i++) {
      for (const p of this.byFirstWord.get(words[i]!) ?? []) {
        if (p.released < t - 730 * 86_400_000 || p.released > t + 60 * 86_400_000) continue;
        if (!p.words.every((w, k) => words[i + k] === w)) continue;
        if (p.single && !new RegExp(`(^|[^A-Za-z])${p.name.split(" // ")[0]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z]|$)`).test(title)) continue;
        if (!found.includes(p.name)) found.push(p.name);
      }
    }
    // A longer name holds a shorter one ("Genesis Device" and "Device"): keep the longer.
    return found.filter((n) => !found.some((o) => o !== n && normalize(o).includes(normalize(n)))).slice(0, 3);
  }
}

/**
 * The colors of a Limited deck told by the cards heard in the video: each mono- or two-colored card
 * weighs the times it comes up. The two leading colors must hold two thirds of the weight (a second
 * color under a fifth is left out). Tested against drafts whose title names the colors.
 */
export function colorsHeard(v: Video, cards: CardIndex): string | undefined {
  if (v.formats[0] !== "limited" || (v.kind !== "draft" && v.kind !== "sealed")) return undefined;
  const weight: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const c of v.cards ?? []) {
    const colors = cards.colorsOf(c.name);
    if (!c.at?.length || !colors || colors.length > 2) continue;
    for (const x of colors) weight[x]! += c.at.length / colors.length;
  }
  const total = Object.values(weight).reduce((a, b) => a + b, 0);
  if (total < 8) return undefined;
  const [first, second] = Object.entries(weight).sort((a, b) => b[1] - a[1]) as [[string, number], [string, number]];
  if ((first[1] + second[1]) / total < 0.65) return undefined;
  return sortColors(second[1] / total >= 0.2 ? first[0] + second[0] : first[0]);
}

/**
 * Colors, archetypes and title cards of a video. Cards heard in a transcript (with times) are
 * kept; a language model's archetypes are kept when it found some.
 */
export function tag(v: Video, cards: CardIndex): Pick<Video, "colors" | "colorsFrom" | "archetypes" | "cards"> {
  const archetypes = v.by === "llm" && v.archetypes?.length ? v.archetypes : archetypesIn(v.title);
  const named = colorsIn(v.title) ?? colorsIn(archetypes.join(" | "));
  const heardColors = named ? undefined : colorsHeard(v, cards);
  const colors = named ?? heardColors;
  const heard = (v.cards ?? []).filter((c) => c.at?.length);
  const inTitle: CardMention[] = cards
    .findInTitle(v.title, new Date(v.published))
    .filter((n) => !heard.some((h) => h.name === n))
    .map((name) => ({ name }));
  const all = [...inTitle, ...heard];
  return {
    ...(colors ? { colors } : {}),
    ...(heardColors ? { colorsFrom: "cards" as const } : {}),
    ...(archetypes.length ? { archetypes } : {}),
    ...(all.length ? { cards: all } : {}),
  };
}

/** Sets the tags of a video in place, replacing what the rules found before. */
export function applyTags(v: Video, cards: CardIndex): void {
  const tags = tag(v, cards);
  delete v.colors;
  delete v.colorsFrom;
  delete v.cards;
  if (v.by === "rules") delete v.archetypes;
  Object.assign(v, tags);
}
