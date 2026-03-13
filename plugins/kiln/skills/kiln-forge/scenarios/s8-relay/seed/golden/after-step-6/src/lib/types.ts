export interface Link {
  id: string;          // crypto.randomUUID()
  url: string;         // normalized, always has protocol
  title: string;       // fetched page title or hostname fallback
  favicon: string;     // Google S2 favicon URL
  tags: string[];      // user-defined tags
  createdAt: number;   // Date.now()
}
