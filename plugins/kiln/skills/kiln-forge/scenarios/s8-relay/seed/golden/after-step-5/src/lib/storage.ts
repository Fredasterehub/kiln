import { Link } from './types';

const STORAGE_KEY = 'linkah-links';

export function getLinks(): Link[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as Link[];
  } catch {
    return [];
  }
}

export function saveLinks(links: Link[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(links));
  } catch {
    // QuotaExceededError — keep state in memory, don't crash
  }
}
