const USER_AGENT = "mtg-videos/1.0 (+https://github.com/OlivierCavadenti/mtg-videos)";

export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, url: string) {
    super(`HTTP ${status} for ${url.replace(/key=[^&]+/, "key=…")}`);
    this.status = status;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** GET with a User-Agent, a timeout and a few retries on network errors and 5xx/429. */
export async function getText(url: string, accept = "*/*", attempts = 3): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": USER_AGENT, accept }, signal: AbortSignal.timeout(30_000) });
      if (res.ok) return await res.text();
      if (res.status < 500 && res.status !== 429) throw new HttpError(res.status, url);
      lastError = new HttpError(res.status, url);
    } catch (error) {
      if (error instanceof HttpError && error.status < 500 && error.status !== 429) throw error;
      lastError = error;
    }
    if (attempt < attempts) await sleep(1000 * 2 ** attempt);
  }
  throw lastError;
}

export async function getJson<T>(url: string): Promise<T> {
  return JSON.parse(await getText(url, "application/json")) as T;
}
