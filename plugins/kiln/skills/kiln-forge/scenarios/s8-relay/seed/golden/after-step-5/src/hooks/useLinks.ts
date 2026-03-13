import { useCallback, useState } from 'react';
import { getFaviconUrl, getHostname, normalizeUrl } from '../lib/metadata.ts';
import { getLinks, saveLinks } from '../lib/storage.ts';
import type { Link } from '../lib/types.ts';

interface UseLinksReturn {
  links: Link[];
  addLink: (url: string) => string | null;
  deleteLink: (id: string) => void;
  updateLink: (id: string, updates: Partial<Link>) => void;
  updateLinkTags: (id: string, tags: string[]) => void;
}

export function useLinks(): UseLinksReturn {
  const [links, setLinks] = useState<Link[]>(() => getLinks());

  const addLink = useCallback((url: string): string | null => {
    const normalized = normalizeUrl(url);

    if (!normalized) {
      return null;
    }

    const hostname = getHostname(normalized);
    const favicon = getFaviconUrl(normalized);
    const newLink: Link = {
      id: crypto.randomUUID(),
      url: normalized,
      title: hostname,
      favicon,
      tags: [],
      createdAt: Date.now(),
    };

    setLinks((prev) => {
      const next = [newLink, ...prev];
      saveLinks(next);
      return next;
    });

    return newLink.id;
  }, []);

  const deleteLink = useCallback((id: string): void => {
    setLinks((prev) => {
      const next = prev.filter((link) => link.id !== id);
      saveLinks(next);
      return next;
    });
  }, []);

  const updateLink = useCallback((id: string, updates: Partial<Link>): void => {
    setLinks((prev) => {
      const next = prev.map((link) =>
        link.id === id ? { ...link, ...updates } : link,
      );
      saveLinks(next);
      return next;
    });
  }, []);

  const updateLinkTags = useCallback(
    (id: string, tags: string[]): void => {
      updateLink(id, { tags });
    },
    [updateLink],
  );

  return {
    links,
    addLink,
    deleteLink,
    updateLink,
    updateLinkTags,
  };
}
