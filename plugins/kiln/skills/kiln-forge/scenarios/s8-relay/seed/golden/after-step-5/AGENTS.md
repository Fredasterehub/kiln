# AGENTS.md — Linkah

## Project
Personal link dashboard. Paste URLs -> rich preview cards (title + favicon) -> tag links -> filter by tag. All data in localStorage. No backend.

## Stack
React 19 | Vite 6 | TypeScript strict | Tailwind CSS 4 | Framer Motion 12 | npm

## Key Files
- `.kiln/master-plan.md` — full implementation plan, task lists, acceptance criteria
- `.kiln/architecture-handoff.md` — concise architecture reference for builders
- `.kiln/docs/architecture.md` — detailed architecture with diagrams
- `.kiln/docs/tech-stack.md` — technology choices and rationale
- `codebase-state.md` — current codebase state (updated by persistent minds)

## Build Milestones (sequential)
| # | Name | Status |
|---|------|--------|
| M0 | Project Scaffold | **complete** |
| M1 | Core Data Layer + Link Management | **complete** |
| M2 | Tagging and Filtering | **complete** |
| M3 | Animation Polish | pending |

## Conventions
- TypeScript strict mode — no `any` types
- Only `Link[]` persists to localStorage (key: `linkah-links`)
- UI state (activeTag, resolvingIds, form state) is ephemeral
- Newest links first (insert at index 0)
- Tags: lowercase, trimmed, deduplicated, reject empty
- URL validation via `new URL()` constructor
- Metadata fetching: imperative API, never throws, hostname fallback
- All animations: `transform` + `opacity` only (GPU-composited)
- Vite base: `"./"` for static file open
- Tailwind v4: `@import "tailwindcss"` in CSS, `@tailwindcss/vite` plugin

## Gotchas
1. Tailwind v4 uses `@import "tailwindcss"`, NOT `@tailwind` directives
2. CORS proxy: use `/get?url=` (JSON), NOT `/raw?url=`
3. Framer Motion `AnimatePresence mode="popLayout"` on grid
4. `base: "./"` in vite.config.ts is required for SC-06
5. Google S2 favicons won't load offline — acceptable, no error handling needed
