/**
 * Refreshes data/cards.json from Scryfall: the name and colors of every card of the sets a video
 * of the archive can be about (a year before historyStart onwards), to find cards in titles.
 * Sets already there are kept, except those out for less than four months (late additions).
 *   npm run cards
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { CardInfo } from "../shared/model.ts";
import { getJson } from "./lib/http.ts";
import { isDraftableSet, loadSets } from "./lib/sets.ts";
import { loadConfig } from "./lib/store.ts";

interface ScryfallCard {
  name: string;
  colors?: string[];
  card_faces?: Array<{ colors?: string[] }>;
  type_line: string;
}
interface Page {
  data: ScryfallCard[];
  has_more: boolean;
  next_page?: string;
}

const FILE = new URL("../data/cards.json", import.meta.url);
const ORDER = "WUBRG";
const DAY = 86_400_000;

const since = new Date(Date.parse(loadConfig().historyStart) - 365 * DAY).toISOString().slice(0, 10);
const recent = new Date(Date.now() - 120 * DAY).toISOString().slice(0, 10);
const kept: CardInfo[] = existsSync(FILE) ? (JSON.parse(readFileSync(FILE, "utf8")) as CardInfo[]) : [];
const keptSets = new Set(kept.map((c) => c.set));
const sets = loadSets().filter((s) => isDraftableSet(s) && s.released >= since);
const out: CardInfo[] = kept.filter((c) => sets.some((s) => s.code === c.set && s.released < recent));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

for (const set of sets) {
  if (set.released < recent && keptSets.has(set.code)) continue;
  let url: string | undefined = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(`e:${set.code.toLowerCase()} -t:basic`)}&unique=cards&order=set`;
  let n = 0;
  try {
    while (url) {
      const page: Page = await getJson<Page>(url);
      for (const c of page.data) {
        const colors = new Set([...(c.colors ?? []), ...(c.card_faces ?? []).flatMap((f) => f.colors ?? [])]);
        out.push({ name: c.name, set: set.code, colors: [...ORDER].filter((x) => colors.has(x)).join("") });
        n++;
      }
      url = page.has_more ? page.next_page : undefined;
      await sleep(120); // Scryfall asks for 50 to 100 ms between requests
    }
    console.log(`${set.code.padEnd(5)} ${n} cards`);
  } catch (error) {
    // A set not on Scryfall yet (announced only) has no cards to search.
    console.warn(`${set.code.padEnd(5)} skipped: ${(error as Error).message}`);
    out.push(...kept.filter((c) => c.set === set.code));
  }
}

out.sort((a, b) => a.set.localeCompare(b.set) || a.name.localeCompare(b.name));
writeFileSync(FILE, `[\n${out.map((c) => JSON.stringify(c)).join(",\n")}\n]\n`);
console.log(`${out.length} cards written to data/cards.json`);
