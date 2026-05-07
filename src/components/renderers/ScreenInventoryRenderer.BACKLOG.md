# Screen Inventory — Backlog

Deferred features for the structured Screen Inventory artifact. Documented
here per the formatting refactor brief; **not implemented** in the current
pass.

## UX

- **Clickable Linked-Feature pills** — tapping a feature pill (e.g. `f8
  Ingredient Aggregation`) opens a side panel with the full feature
  description, originating PRD section, and the other screens that
  reference it. Requires an artifact-wide feature lookup and a generic
  side-panel primitive that doesn't yet exist; see also the
  Implementation-Plan backlog item for a similar cross-artifact anchor
  scheme.
- **Filter / sort screens** — by priority (P0 → P3), linked feature, or
  flow membership, scoped to a section or to the whole artifact.
- **Mini-map / overview visualization** — a top-of-artifact diagram of
  all screens and the journeys between them, using `flowSummary` per
  section plus `entryPoints` / `exitPaths` per screen. Likely a hand-
  rolled SVG or `react-flow` graph.
- **Audience modes** — PM / Design / Engineering toggles that re-rank or
  hide subsections per audience (e.g. Engineering hides Intent and
  Outputs but emphasizes States and Risks).

## Data quality

- **Validation overlays** — surface orphan screens (no entry points),
  dead-end exits (target not present in inventory), missing required
  states (e.g. an "input" screen with no error state). Render as a
  per-card warning chip plus a section-header summary count.

## Integration

- **Artifact navigation** — clicking a Linked-Feature pill could jump to
  the feature's anchor inside the PRD artifact once a cross-artifact
  anchor scheme exists.
