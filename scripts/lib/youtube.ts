import { getJson, HttpError } from "./http.ts";
import type { FeedEntry } from "./feeds.ts";
import { normalizeSpace } from "./feeds.ts";

/**
 * YouTube Data API v3, for the whole upload history of a channel (its feed only lists the 15
 * latest). The "UULF" playlist holds a channel's videos without its Shorts, "UULV" its past lives.
 */

const API = "https://www.googleapis.com/youtube/v3";

export function uploadPlaylists(feedUrl: string): string[] {
  const url = new URL(feedUrl);
  const channel = url.searchParams.get("channel_id");
  const playlist = url.searchParams.get("playlist_id");
  const suffix = channel?.startsWith("UC") ? channel.slice(2) : playlist?.startsWith("UU") ? playlist.slice(4) : null;
  return suffix ? [`UULF${suffix}`, `UULV${suffix}`] : [];
}

/** "PT1H2M3S" → 3723. */
export function parseIsoDuration(value: string | undefined): number | undefined {
  const m = value ? /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value) : null;
  if (!m) return undefined;
  const [, d, h, min, s] = m.map((x) => Number(x ?? 0));
  return d! * 86_400 + h! * 3600 + min! * 60 + s! || undefined;
}

interface PlaylistItems {
  nextPageToken?: string;
  items: Array<{
    snippet: { title: string; description: string; resourceId: { videoId: string } };
    contentDetails: { videoId: string; videoPublishedAt?: string };
  }>;
}

/** View counts of videos (50 per request); a deleted or private video is missing from the result. */
export async function viewCounts(ids: string[], key: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 50) {
    const query = new URLSearchParams({ part: "statistics", id: ids.slice(i, i + 50).join(","), key });
    const data = await getJson<{ items: Array<{ id: string; statistics: { viewCount?: string } }> }>(`${API}/videos?${query}`);
    for (const v of data.items) if (v.statistics.viewCount !== undefined) out.set(v.id, Number(v.statistics.viewCount));
  }
  return out;
}

interface Videos {
  items: Array<{ id: string; snippet: { liveBroadcastContent: string }; contentDetails: { duration?: string } }>;
}

/** Videos of a playlist published since `since`, newest first; an unknown playlist gives none. */
async function playlistEntries(playlistId: string, key: string, since: Date, maxPages: number): Promise<FeedEntry[]> {
  const out: FeedEntry[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const query = new URLSearchParams({ part: "snippet,contentDetails", maxResults: "50", playlistId, key });
    if (pageToken) query.set("pageToken", pageToken);
    let data: PlaylistItems;
    try {
      data = await getJson<PlaylistItems>(`${API}/playlistItems?${query}`);
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) return out;
      throw error;
    }
    let older = 0;
    for (const item of data.items) {
      const published = item.contentDetails.videoPublishedAt ? new Date(item.contentDetails.videoPublishedAt) : undefined;
      if (!published) continue; // private or deleted
      if (published < since) {
        older++;
        continue;
      }
      const id = item.contentDetails.videoId;
      out.push({
        externalId: id,
        url: `https://www.youtube.com/watch?v=${id}`,
        title: normalizeSpace(item.snippet.title),
        description: normalizeSpace(item.snippet.description.replace(/https?:\/\/\S+/g, "")),
        published,
        isShort: false,
      });
    }
    pageToken = data.nextPageToken;
    if (!pageToken || older === data.items.length) break;
  }
  return out;
}

/** A channel's videos and past lives since `since`, with their duration; lives not over yet are left out. */
export async function channelEntries(feedUrl: string, key: string, since: Date, maxPages = 200): Promise<FeedEntry[]> {
  const entries: FeedEntry[] = [];
  for (const playlist of uploadPlaylists(feedUrl)) entries.push(...(await playlistEntries(playlist, key, since, maxPages)));
  const byId = new Map(entries.map((e) => [e.externalId, e]));
  const ids = [...byId.keys()];
  for (let i = 0; i < ids.length; i += 50) {
    const query = new URLSearchParams({ part: "snippet,contentDetails", id: ids.slice(i, i + 50).join(","), key });
    const data = await getJson<Videos>(`${API}/videos?${query}`);
    for (const v of data.items) {
      const entry = byId.get(v.id);
      if (!entry) continue;
      if (v.snippet.liveBroadcastContent !== "none") byId.delete(v.id);
      else entry.duration = parseIsoDuration(v.contentDetails.duration);
    }
  }
  return [...byId.values()];
}
