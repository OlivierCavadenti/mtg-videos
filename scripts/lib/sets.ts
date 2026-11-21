import { readFileSync } from "node:fs";
import type { SetInfo } from "../../shared/model.ts";

const DAY = 86_400_000;

/** Sets a Limited video can be about (Commander decks, promos, tokens… are not). */
const DRAFTABLE = new Set(["expansion", "core", "draft_innovation", "masters"]);

/** Main sets: each release opens a new period of the timeline. */
export const isMainSet = (s: SetInfo) => (s.type === "expansion" || s.type === "core") && !s.digital && !s.parent;

export const isDraftableSet = (s: SetInfo) => DRAFTABLE.has(s.type) && !s.digital && !s.parent;

export function loadSets(): SetInfo[] {
  return JSON.parse(readFileSync(new URL("../../data/sets.json", import.meta.url), "utf8")) as SetInfo[];
}

function loadAliases(): Record<string, string[]> {
  return JSON.parse(readFileSync(new URL("../../config/set-aliases.json", import.meta.url), "utf8")) as Record<string, string[]>;
}

/** Lowercase words separated by single spaces, padded: " star trek draft ". */
export function normalizeWords(s: string): string {
  const words = s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return ` ${words} `;
}

/** Names a set goes by in titles: its full name, the part before a colon, without "The"... */
function namesOf(set: SetInfo, extra: string[]): string[] {
  const names = new Set<string>();
  const add = (n: string) => {
    const w = normalizeWords(n).trim();
    if (w.length >= 4) names.add(w);
  };
  add(set.name);
  const [before, after] = set.name.split(/:\s*/, 2);
  if (after !== undefined) {
    if (/^magic$/i.test(before!.trim())) add(after.replace(/^the gathering\s*/i, ""));
    else if (before!.trim().length >= 5) add(before!);
  }
  for (const n of [...names]) {
    if (n.startsWith("the ") && n.length >= 9) names.add(n.slice(4));
    if (n.startsWith("marvels ")) names.add(n.slice(8));
  }
  for (const n of extra) add(n);
  return [...names];
}

/** Uppercase words that are set codes but mostly mean something else in a title. */
const AMBIGUOUS_CODES = new Set(["THE", "AND", "FOR", "TOP", "NEW", "ONE", "WAR", "BIG", "ALL", "OUT", "WHO"]);

const SEGMENT_BEFORE = /(^|[|\-–—:([#/])\s*$/;
const SEGMENT_AFTER = /^\s*([|\-–—:)\]/!?.,]|$)/;
const WORD_AFTER =
  /^\s+(draft|drafts|drafting|sealed|prerelease|pre-release|set|review|limited|spoilers?|previews?|early access|cube|premier|quick|traditional|trad|bo[13]|p1p1|first look|commons?|uncommons?|rares?|mythics?|cards?|standard|format|arena|gameplay|league|run|trophy)\b/i;
const WORD_BEFORE = /\b(in|of|for|from|draft|drafting|sealed|reviewing)\s+$/i;

/**
 * A code counts only where a title uses it as one: a segment of its own ("| EOE |", "#FIN"),
 * before a Limited word ("TDM Draft") or after "in", "of"… ("Best commons in DFT"). "Ouroboroid
 * Is a BRO" is not about The Brothers' War.
 */
function usedAsCode(title: string, code: string): boolean {
  for (const m of title.matchAll(new RegExp(`\\b${code}\\b`, "g"))) {
    const before = title.slice(0, m.index);
    const after = title.slice(m.index + code.length);
    if ((SEGMENT_BEFORE.test(before) && SEGMENT_AFTER.test(after)) || WORD_AFTER.test(after) || WORD_BEFORE.test(before)) return true;
  }
  return false;
}

interface Matcher {
  code: string;
  released: number;
  names: string[];
  main: boolean;
}

export class SetIndex {
  readonly byCode: Map<string, SetInfo>;
  private readonly matchers: Matcher[];
  /** Main sets, oldest first. */
  readonly mainSets: SetInfo[];

  constructor(sets: SetInfo[], aliases: Record<string, string[]> = loadAliases()) {
    this.byCode = new Map(sets.map((s) => [s.code, s]));
    this.matchers = sets
      .filter((s) => isDraftableSet(s) && s.released)
      .map((s) => ({ code: s.code, released: Date.parse(s.released), names: namesOf(s, aliases[s.code] ?? []), main: isMainSet(s) }));
    this.mainSets = sets.filter((s) => isMainSet(s) && s.released).sort((a, b) => a.released.localeCompare(b.released));
  }

  /** Sets out within three years before `at`, or due within four months after. */
  private around(at: Date, yearsBack = 3) {
    const t = at.getTime();
    return this.matchers.filter((m) => m.released >= t - yearsBack * 365 * DAY && m.released <= t + 120 * DAY);
  }

  /** Closer releases win; a set not out yet counts double the distance. */
  private static distance(m: Matcher, at: Date) {
    const d = (m.released - at.getTime()) / DAY;
    return d > 0 ? d * 2 : -d;
  }

  /**
   * The set a title names, by name or nickname (the longest wins, so "Lorwyn Eclipsed" beats
   * "Lorwyn") or by its code written in capitals ("EOE").
   */
  findInTitle(title: string, at: Date): string | null {
    const words = normalizeWords(title);
    const letters = title.replace(/[^A-Za-z]/g, "");
    const shouting = letters.length > 0 && letters.replace(/[^A-Z]/g, "").length / letters.length > 0.6;
    const codes = shouting ? new Set<string>() : new Set(title.match(/\b[A-Z0-9]{3}\b/g) ?? []);
    const codeCutoff = at.getTime() - 2 * 365 * DAY;
    let best: { code: string; length: number; distance: number } | null = null;
    for (const m of this.around(at)) {
      let length = 0;
      for (const n of m.names) if (n.length > length && words.includes(` ${n} `)) length = n.length;
      if (!length && codes.has(m.code) && !AMBIGUOUS_CODES.has(m.code) && m.released >= codeCutoff && usedAsCode(title, m.code)) length = 3;
      if (!length) continue;
      const distance = SetIndex.distance(m, at);
      if (!best || length > best.length || (length === best.length && distance < best.distance)) best = { code: m.code, length, distance };
    }
    return best?.code ?? null;
  }

  /** The set a transcript keeps naming: at least three times, and twice as often as any other. */
  findInTranscript(transcript: string, at: Date): string | null {
    const words = normalizeWords(transcript);
    const counts: Array<{ code: string; n: number }> = [];
    for (const m of this.around(at, 1)) {
      let n = 0;
      for (const name of m.names) {
        if (name.length < 5) continue;
        let from = 0;
        for (;;) {
          const i = words.indexOf(` ${name} `, from);
          if (i < 0) break;
          n++;
          from = i + name.length;
        }
      }
      if (n) counts.push({ code: m.code, n });
    }
    counts.sort((a, b) => b.n - a.n);
    const [first, second] = counts;
    return first && first.n >= 3 && (!second || first.n >= 2 * second.n) ? first.code : null;
  }

  /** A main set out for less than ten weeks, or due within three, on that day. */
  isFreshMainSet(code: string, at: Date): boolean {
    const s = this.byCode.get(code);
    if (!s || !isMainSet(s)) return false;
    const d = (at.getTime() - Date.parse(s.released)) / DAY;
    return d >= -21 && d <= 70;
  }

  /**
   * The Limited format of the moment: the latest main set out on that day. A set review looks
   * ahead: a main set due within the next five weeks is the one it reviews.
   */
  currentLimitedSet(at: Date, lookAheadDays = 0): string | null {
    const t = at.getTime() + lookAheadDays * DAY;
    let current: SetInfo | null = null;
    for (const s of this.mainSets) if (Date.parse(s.released) <= t) current = s;
    return current?.code ?? null;
  }
}
