import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { Creator, CreatorsConfig, Video } from "../../shared/model.ts";

const ROOT = new URL("../../", import.meta.url);
const VIDEOS = new URL("data/videos/", ROOT);

export function loadConfig(): CreatorsConfig {
  return JSON.parse(readFileSync(new URL("config/creators.json", ROOT), "utf8")) as CreatorsConfig;
}

export function creatorMap(config: CreatorsConfig): Map<string, Creator> {
  return new Map(config.creators.map((c) => [c.id, c]));
}

/** Stable id of a podcast episode, from its creator and guid. */
export function podcastId(creatorId: string, guid: string): string {
  return `p${createHash("sha1").update(`${creatorId}\n${guid}`).digest("hex").slice(0, 12)}`;
}

/** Fields in a fixed order, so that a file only changes where a video does. */
const FIELD_ORDER: Array<keyof Video> = [
  "id", "creator", "platform", "url", "title", "published", "duration", "hidden",
  "formats", "kind", "set", "setFrom", "heard", "archetypes", "colors", "colorsFrom", "cards", "summary", "views", "by",
];
const canonical = (v: Video) => {
  const out: Record<string, unknown> = {};
  for (const k of FIELD_ORDER) if (v[k] !== undefined) out[k] = v[k];
  for (const [k, value] of Object.entries(v)) if (!(k in out) && value !== undefined) out[k] = value;
  return out;
};

/** Every stored video, keyed by "creator/id". */
export class Store {
  private readonly videos = new Map<string, Video>();

  static load(): Store {
    const store = new Store();
    mkdirSync(VIDEOS, { recursive: true });
    for (const file of readdirSync(VIDEOS).filter((f) => /^\d{4}\.json$/.test(f))) {
      for (const v of JSON.parse(readFileSync(new URL(file, VIDEOS), "utf8")) as Video[]) store.videos.set(Store.key(v), v);
    }
    return store;
  }

  static key(v: Pick<Video, "creator" | "id">): string {
    return `${v.creator}/${v.id}`;
  }

  get(creator: string, id: string): Video | undefined {
    return this.videos.get(`${creator}/${id}`);
  }

  put(v: Video): void {
    this.videos.set(Store.key(v), v);
  }

  all(): Video[] {
    return [...this.videos.values()];
  }

  /** One file per year of publication, newest first, one video per line (readable diffs). */
  save(): void {
    const years = new Map<string, Video[]>();
    for (const v of this.videos.values()) {
      const year = v.published.slice(0, 4);
      const list = years.get(year);
      if (list) list.push(v);
      else years.set(year, [v]);
    }
    for (const [year, list] of years) {
      list.sort((a, b) => b.published.localeCompare(a.published) || a.id.localeCompare(b.id));
      writeFileSync(new URL(`${year}.json`, VIDEOS), `[\n${list.map((v) => JSON.stringify(canonical(v))).join(",\n")}\n]\n`);
    }
  }
}
