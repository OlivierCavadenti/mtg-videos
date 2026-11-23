import { HttpError } from "./http.ts";

/**
 * Twitch Helix API with an app access token (client credentials: a "confidential" application
 * registered at dev.twitch.tv). Only public data: streams live in a category.
 */

const HELIX = "https://api.twitch.tv/helix";
const USER_AGENT = "mtg-videos/1.0 (+https://github.com/OlivierCavadenti/mtg-videos)";

export interface TwitchToken {
  value: string;
  /** Epoch milliseconds. */
  expires: number;
}

export interface TwitchStream {
  id: string;
  user_id: string;
  user_login: string;
  user_name: string;
  game_id: string;
  title: string;
  viewer_count: number;
  started_at: string;
  language: string;
  /** With {width} and {height} to fill. */
  thumbnail_url: string;
}

export async function appToken(clientId: string, secret: string): Promise<TwitchToken> {
  const body = new URLSearchParams({ client_id: clientId, client_secret: secret, grant_type: "client_credentials" });
  const res = await fetch("https://id.twitch.tv/oauth2/token", { method: "POST", body, headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new HttpError(res.status, "https://id.twitch.tv/oauth2/token");
  const data = (await res.json()) as { access_token: string; expires_in: number };
  return { value: data.access_token, expires: Date.now() + data.expires_in * 1000 };
}

async function helix<T>(path: string, clientId: string, token: TwitchToken): Promise<T> {
  const url = `${HELIX}${path}`;
  const res = await fetch(url, {
    headers: { "client-id": clientId, authorization: `Bearer ${token.value}`, "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new HttpError(res.status, url);
  return (await res.json()) as T;
}

/** The ids of categories by their exact names. */
export async function gameIds(names: string[], clientId: string, token: TwitchToken): Promise<string[]> {
  const query = new URLSearchParams(names.map((n) => ["name", n]));
  const data = await helix<{ data: Array<{ id: string; name: string }> }>(`/games?${query}`, clientId, token);
  return data.data.map((g) => g.id);
}

/** Every stream live in the categories, most watched first, 100 per request. */
export async function liveStreams(games: string[], clientId: string, token: TwitchToken, maxPages = 20): Promise<TwitchStream[]> {
  const out: TwitchStream[] = [];
  let after: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const query = new URLSearchParams([...games.map((g) => ["game_id", g]), ["first", "100"], ...(after ? [["after", after]] : [])]);
    const data = await helix<{ data: TwitchStream[]; pagination: { cursor?: string } }>(`/streams?${query}`, clientId, token);
    out.push(...data.data);
    after = data.pagination.cursor;
    if (!after || !data.data.length) break;
  }
  return out;
}
