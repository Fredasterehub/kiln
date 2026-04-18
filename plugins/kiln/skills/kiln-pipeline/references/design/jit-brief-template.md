# JIT Component Brief Template

Fill-in skeleton, not a reference lookup. KRS-One (art-of-war, xhigh) generates one brief per chunk when `design_enabled` and the chunk contains UI components, then hands it to la-peintresse (high effort) via the `<design>` section of the XML assignment. Target: 200-500 tokens.

---

**Component:** {component_name}
**Role:** {what this component does in the page — e.g., "Primary navigation bar, always visible"}
**Tokens:** {subset of relevant tokens — e.g., surface-secondary for bg, text-primary for labels, space-4 for padding, radius-md for corners}
**States:** {interaction states — e.g., "default, hover (accent-hover bg), active (accent-active bg), disabled (opacity-muted)"}
**Match:** {reference components to be consistent with — e.g., "Same card style as DashboardCard, same button style as PrimaryButton"}
**Constraints:** {specific design constraints — e.g., "Must use container query for responsive layout, no fixed widths, blur overlay on mobile menu"}
