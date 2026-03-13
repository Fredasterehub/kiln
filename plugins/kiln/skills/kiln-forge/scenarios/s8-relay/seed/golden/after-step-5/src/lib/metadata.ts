export function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    return new URL(withProtocol).toString();
  } catch {
    return null;
  }
}

export function getHostname(url: string): string {
  return new URL(url).hostname;
}

export function getFaviconUrl(url: string): string {
  const hostname = getHostname(url);
  return `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`;
}

interface AllOriginsResponse {
  contents?: unknown;
}

export async function fetchTitle(url: string, signal?: AbortSignal): Promise<string> {
  const fallbackTitle = getHostname(url);

  try {
    const response = await fetch(
      `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
      { signal },
    );

    if (!response.ok) {
      return fallbackTitle;
    }

    const data: unknown = await response.json();
    const contents =
      typeof data === 'object' && data !== null
        ? (data as AllOriginsResponse).contents
        : undefined;

    if (typeof contents !== 'string') {
      return fallbackTitle;
    }

    const match = /<title[^>]*>([^<]*)<\/title>/i.exec(contents);
    const title = match?.[1]?.trim();

    return title && title.length > 0 ? title : fallbackTitle;
  } catch {
    return fallbackTitle;
  }
}
