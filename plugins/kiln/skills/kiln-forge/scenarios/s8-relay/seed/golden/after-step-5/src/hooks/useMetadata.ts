import { useCallback } from 'react';
import { fetchTitle, getHostname, normalizeUrl } from '../lib/metadata.ts';
import type { Link } from '../lib/types.ts';

interface UseMetadataReturn {
  resolveMetadata: (
    id: string,
    url: string,
    updateLink: (id: string, updates: Partial<Link>) => void,
  ) => Promise<void>;
}

export function useMetadata(): UseMetadataReturn {
  const resolveMetadata = useCallback(
    async (
      id: string,
      url: string,
      updateLink: (id: string, updates: Partial<Link>) => void,
    ): Promise<void> => {
      const normalized = normalizeUrl(url);

      if (!normalized) {
        return;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      try {
        const fallbackTitle = getHostname(normalized);
        const title = await fetchTitle(normalized, controller.signal);

        if (title !== fallbackTitle) {
          updateLink(id, { title });
        }
      } catch {
        // fetchTitle already swallows failures; keep this hook non-throwing too.
      } finally {
        clearTimeout(timeoutId);
      }
    },
    [],
  );

  return { resolveMetadata };
}
