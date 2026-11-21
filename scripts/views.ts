/**
 * Reads the YouTube views of each video once, the day after its release (and, the first time, of
 * every older video), so the page can tell which videos did better than their creator's usual.
 *   YOUTUBE_API_KEY=… npm run views
 * Without a key it does nothing. Views are read once only: the data files do not change every day.
 */
import { loadConfig, Store } from "./lib/store.ts";
import { viewCounts } from "./lib/youtube.ts";

const key = process.env.YOUTUBE_API_KEY;
if (!key) {
  console.log("YOUTUBE_API_KEY is not set: views not read");
  process.exit(0);
}

const HOUR = 3_600_000;
const now = Date.now();
const store = Store.load();
const enabled = new Set(loadConfig().creators.filter((c) => c.platform === "youtube").map((c) => c.id));
// A day old at least: younger, a video has not had its first day yet.
const due = store.all().filter((v) => v.platform === "youtube" && !v.hidden && !v.views && enabled.has(v.creator) && now - Date.parse(v.published) >= 20 * HOUR);
const counts = await viewCounts(
  due.map((v) => v.id),
  key,
);
let read = 0;
for (const v of due) {
  const n = counts.get(v.id);
  if (n === undefined) continue;
  store.put({ ...v, views: { n, hours: Math.round((now - Date.parse(v.published)) / HOUR) } });
  read++;
}
store.save();
console.log(`views read for ${read} of ${due.length} video(s)`);
