/**
 * Runs the rules of scripts/lib/classify.ts again over the archive, after changing them, the
 * set aliases or a creator's default format.   npm run reclassify
 * Language-model classifications keep their formats, kind and archetypes; only their set is
 * checked again against the title (a set named in the title wins).
 */
import type { Video } from "../shared/model.ts";
import { classify, offTopic, placeSet } from "./lib/classify.ts";
import { loadSets, SetIndex } from "./lib/sets.ts";
import { creatorMap, loadConfig, Store } from "./lib/store.ts";

const config = loadConfig();
const creators = creatorMap(config);
const sets = new SetIndex(loadSets());
const store = Store.load();
let changed = 0;
for (const v of store.all()) {
  if (v.hidden === "short" || (v.hidden && v.by === "llm")) continue;
  const before = JSON.stringify(v);
  const next: Video = { ...v };
  if (v.by === "rules") {
    delete next.hidden;
    delete next.set;
    delete next.setFrom;
    delete next.heard;
    if (offTopic(v.title)) Object.assign(next, { hidden: "off-topic", formats: [], kind: "other" });
    else {
      // Transcripts are not kept: the formats and set read in one stay unless the title now says otherwise.
      const again = classify({ title: v.title, published: v.published, platform: v.platform, heard: v.heard }, creators.get(v.creator), sets);
      if (v.setFrom === "transcript" && again.setFrom !== "title") Object.assign(again, { set: v.set, setFrom: v.setFrom });
      Object.assign(next, again);
    }
  } else {
    const named = sets.findInTitle(v.title, new Date(v.published));
    if (named) Object.assign(next, { set: named, setFrom: "title" });
    // A set once read in the title that the rules no longer see there goes too.
    else if (v.setFrom === "date" || v.setFrom === "title" || !v.set) {
      delete next.set;
      delete next.setFrom;
      Object.assign(next, placeSet(v.title, new Date(v.published), v.formats, v.kind, sets));
    }
  }
  if (JSON.stringify(next) !== before) {
    store.put(next);
    changed++;
  }
}
store.save();
console.log(`${changed} video(s) classified differently`);
