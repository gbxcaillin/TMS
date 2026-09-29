const GRAPH = 'https://graph.microsoft.com/v1.0';

export class GraphError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

export async function graphGet<T>(token: string, pathOrUrl: string, headers: Record<string, string> = {}): Promise<T> {
  const url = pathOrUrl.startsWith('https://') ? pathOrUrl : `${GRAPH}${pathOrUrl}`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...headers } });
    if (res.ok) return (await res.json()) as T;
    // Graph throttling: honour Retry-After, a few times.
    if ((res.status === 429 || res.status === 503) && attempt < 4) {
      const wait = Number(res.headers.get('retry-after') ?? 2 ** attempt) * 1000;
      await new Promise((r) => setTimeout(r, Math.min(wait, 60_000)));
      continue;
    }
    const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    throw new GraphError(body?.error?.message ?? `Graph ${res.status}`, res.status, body?.error?.code);
  }
}

export interface DeltaPage<T> {
  value: T[];
  '@odata.nextLink'?: string;
  '@odata.deltaLink'?: string;
}

/** Walks a delta query to completion, yielding each page. Returns the new deltaLink. */
export async function* walkDelta<T>(token: string, start: string, headers: Record<string, string> = {}) {
  let next: string | undefined = start;
  while (next) {
    const page: DeltaPage<T> = await graphGet<DeltaPage<T>>(token, next, headers);
    yield page;
    if (page['@odata.deltaLink']) return page['@odata.deltaLink'];
    next = page['@odata.nextLink'];
  }
  return undefined;
}
