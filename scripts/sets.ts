/**
 * Refreshes data/sets.json from Scryfall: the sets a video can be about and the main sets that
 * open each period of the timeline.   npm run sets
 */
import { writeFileSync } from "node:fs";
import type { SetInfo } from "../shared/model.ts";
import { getJson } from "./lib/http.ts";

interface ScryfallSet {
  code: string;
  name: string;
  released_at?: string;
  set_type: string;
  icon_svg_uri: string;
  digital: boolean;
  parent_set_code?: string;
}

const KEPT = new Set(["expansion", "core", "draft_innovation", "masters"]);

const { data } = await getJson<{ data: ScryfallSet[] }>("https://api.scryfall.com/sets");
const sets: SetInfo[] = data
  .filter((s) => KEPT.has(s.set_type) && s.released_at)
  .map((s) => ({
    code: s.code.toUpperCase(),
    name: s.name,
    released: s.released_at!,
    type: s.set_type,
    icon: s.icon_svg_uri.replace(/\?.*$/, ""),
    digital: s.digital,
    ...(s.parent_set_code ? { parent: s.parent_set_code.toUpperCase() } : {}),
  }))
  .sort((a, b) => a.released.localeCompare(b.released) || a.code.localeCompare(b.code));

writeFileSync(new URL("../data/sets.json", import.meta.url), `[\n${sets.map((s) => JSON.stringify(s)).join(",\n")}\n]\n`);
console.log(`${sets.length} sets written to data/sets.json`);
