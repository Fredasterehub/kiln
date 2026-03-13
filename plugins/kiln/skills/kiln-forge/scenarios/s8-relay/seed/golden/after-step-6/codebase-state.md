# Codebase State — Linkah

**TL;DR**: M0 + M1 + M2 complete. Full link management with tagging and filtering working: add links via URL paste, metadata fetching (title + favicon via CORS proxy), delete links, add/remove tags per card with auto-suggest, filter grid by tag, responsive grid, localStorage persistence. Next milestone: M3 (Animation Polish).

## Repository Contents

```
/DEV/finalkiln/
├── .git/
├── .claude/
├── .kiln/                         # pipeline planning artifacts
├── package.json                   # linkah, deps: react 19, react-dom 19, framer-motion 12
├── vite.config.ts                 # base: "./", plugins: react + @tailwindcss/vite
├── tsconfig.json / tsconfig.app.json  # TypeScript strict mode
├── eslint.config.js
├── index.html                     # Vite entry
└── src/
    ├── main.tsx                   # React root mount
    ├── App.tsx                    # Root component — wires hooks + components, resolvingIds + activeTag state
    ├── index.css                  # @import "tailwindcss"
    ├── components/
    │   ├── Header.tsx             # App title "Linkah" + tagline, dark header card
    │   ├── AddLinkForm.tsx        # URL input, single submit path for paste + manual, validation error
    │   ├── FilterBar.tsx          # Tag filter pills + "All" button, active tag highlight (M2)
    │   ├── LinkCard.tsx           # Card: favicon, title (pulse while resolving), URL, TagEditor, delete button
    │   ├── LinkGrid.tsx           # Responsive 1/2/3-col grid, empty state, passes allTags + onUpdateTags
    │   └── TagEditor.tsx          # Inline tag add/remove per card, pill badges, auto-suggest dropdown (M2)
    ├── hooks/
    │   ├── useLinks.ts            # CRUD hook: addLink, deleteLink, updateLink, updateLinkTags — localStorage sync
    │   └── useMetadata.ts         # Imperative resolveMetadata(id, url, updateLink) — 5s AbortController timeout
    └── lib/
        ├── types.ts               # Link interface (id, url, title, favicon, tags, createdAt)
        ├── storage.ts             # getLinks() / saveLinks() — defensive, treats localStorage as untrusted
        └── metadata.ts            # normalizeUrl, getHostname, getFaviconUrl, fetchTitle (never throws)
```

## Installed Dependencies

**Runtime**: react 19.2, react-dom 19.2, framer-motion 12.35
**Build**: vite 6, @vitejs/plugin-react 5, tailwindcss 4.2, @tailwindcss/vite 4.2, typescript 5.9, eslint 9

## Milestone Status

| # | Name | Status |
|---|------|--------|
| M0 | Project Scaffold | **complete** |
| M1 | Core Data Layer + Link Management | **complete** |
| M2 | Tagging and Filtering | **complete** |
| M3 | Animation Polish | pending |

## M1 Implementation Details

### metadata.ts
- `normalizeUrl`: prepends `https://` if no protocol, validates with `new URL()`, returns string or null
- `getHostname`: extracts hostname via `new URL(url).hostname`
- `getFaviconUrl`: Google S2 favicons at `?domain={hostname}&sz=64`
- `fetchTitle`: allorigins.win `/get?url=` endpoint, JSON response with `contents` field, regex title extraction, never throws, hostname fallback

### useLinks.ts
- Functional updater pattern with `setLinks(prev => ...)` for safe concurrent updates
- `addLink`: normalizes URL, creates Link with crypto.randomUUID(), inserts at index 0 (newest first), saves immediately
- `deleteLink`: filters by id, saves immediately
- `updateLink`: maps and merges partial updates, saves immediately
- `updateLinkTags`: convenience wrapper around updateLink for tag updates

### useMetadata.ts
- `resolveMetadata(id, url, updateLink)`: imperative, creates AbortController with 5s timeout, calls fetchTitle, updates link title if different from hostname fallback, clearTimeout in finally block

### App.tsx (M1 patterns)
- Wires useLinks + useMetadata hooks
- `resolvingIds: Set<string>` ephemeral state — tracks pending metadata fetches
- `handleSubmit`: addLink -> add to resolvingIds -> resolveMetadata -> remove from resolvingIds in .finally()
- Layout: slate-100 bg, centered max-w-4xl container

### Component patterns (M1)
- **AddLinkForm**: controlled input, onPaste auto-submits valid URLs (preventDefault + submit), manual submit via form onSubmit, validation error display
- **LinkCard**: favicon with onError hide, title with animate-pulse while resolving, truncated URL, delete button with stopPropagation
- **LinkGrid**: responsive `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4`, empty state with dashed border
- **Header**: dark (slate-900) rounded card with sky-300 subtitle, title, description

## M2 Implementation Details

### TagEditor.tsx (new)
- Inline tag editor rendered per card below the URL
- Tags displayed as sky-colored pill badges (`bg-sky-100 text-sky-700`) with "x" remove button
- "+" button reveals a text input; Enter adds tag, Escape cancels
- `normalizeTag()`: lowercase + trim; rejects empty strings and duplicates
- Auto-suggest dropdown: filters `allTags` to exclude tags already on this link, matches against input text
- Click-outside detection via `mousedown` listener on document to close input
- Uses refs for container and input element (focus management)
- Props: `tags: string[]`, `allTags: string[]`, `onTagsChange: (tags: string[]) => void`

### FilterBar.tsx (new)
- Returns `null` when no tags exist (hidden when no tags across any link)
- "All" button + one button per unique tag, `flex-wrap` layout with `overflow-x-auto`
- Active state: filled `bg-sky-600 text-white`; inactive: outlined `border border-slate-300 text-slate-600`
- Clicking active tag or "All" clears filter (passes `null`)
- `getButtonClassName(isActive)` helper for style toggling
- Props: `tags: string[]`, `activeTag: string | null`, `onTagSelect: (tag: string | null) => void`

### LinkCard.tsx (M2 changes)
- Card wrapper changed from `<a>` to `<div>` with `<a>` inside for link area only (allows TagEditor click interaction without navigating)
- TagEditor integrated below the link `<a>` area, above delete button
- New props: `allTags: string[]`, `onUpdateTags: (id: string, tags: string[]) => void`
- `onUpdateTags` wired to TagEditor's `onTagsChange` with `link.id` closure

### LinkGrid.tsx (M2 changes)
- New props: `allTags: string[]`, `onUpdateTags: (id: string, tags: string[]) => void`
- Passes `allTags` and `onUpdateTags` through to each LinkCard

### App.tsx (M2 changes)
- `activeTag: string | null` ephemeral state (not persisted to localStorage)
- `allTags`: derived via `Array.from(new Set(links.flatMap(l => l.tags))).sort()`
- `filteredLinks`: `activeTag ? links.filter(l => l.tags.includes(activeTag)) : links`
- `useEffect` auto-clears `activeTag` to `null` when tag disappears from `allTags`
- FilterBar rendered between AddLinkForm and LinkGrid
- `updateLinkTags` from useLinks destructured and passed down through LinkGrid to LinkCard
- Render order: Header -> AddLinkForm -> FilterBar -> LinkGrid(filteredLinks)

## Next Milestone: M3 — Animation Polish

**Goal**: Layer Framer Motion animations onto all interactions, loading skeletons, responsive polish. Make the app feel alive.

### M3 Files to Modify
- `src/index.css` — theme variables, color palette, optional dark mode via `prefers-color-scheme`
- `src/components/Header.tsx` — typography polish
- `src/components/LinkCard.tsx` — motion.div with layout, entry/exit/hover animations, loading skeleton pulse via Framer Motion
- `src/components/LinkGrid.tsx` — AnimatePresence mode="popLayout", empty state fade-in
- `src/components/TagEditor.tsx` — AnimatePresence on tag pills, spring scale add/remove
- `src/components/FilterBar.tsx` — staggered fade-in on mount
- `src/components/AddLinkForm.tsx` — focus animation/glow

### M3 Key Patterns
- All animations: `transform` + `opacity` only (GPU-composited)
- Stable keys: `link.id`, never array index
- AnimatePresence mode="popLayout" on grid
- `layout` prop on cards for reflow during filter changes
- Consistent spring config across similar interactions
- Target 60fps, no layout thrashing

## Key Architecture Decisions
- **URL validation**: `new URL()` constructor, not regex
- **Metadata**: imperative `resolveMetadata()` API, not reactive
- **CORS proxy**: `api.allorigins.win/get?url=` (JSON), not `/raw?url=`
- **Ordering**: newest first, insert at index 0
- **Persistence**: only `Link[]` in localStorage (key: `linkah-links`); UI state is ephemeral
- **Tailwind v4**: `@import "tailwindcss"` in CSS, `@tailwindcss/vite` plugin (not PostCSS)
- **Vite base**: `"./"` for static file open (SC-06)
- **Tag normalization**: lowercase, trim, deduplicate, reject empty
- **activeTag**: ephemeral, auto-clears via useEffect when tag disappears from allTags
- **Card structure**: outer `<div>` wrapper with `<a>` for link area only (TagEditor needs click interaction without navigating)
