# Artifact Dependency Graph (Project Map)

A read-side **project integrity dashboard** in the Assets workspace: it
visualizes how Synapse artifacts derive from the PRD and from each other,
which artifacts are stale after upstream changes (and *why*), and the safe
order to regenerate them. Sidebar: **Project Map → Dependency Graph**.

## Audit — the artifact system this was built on

(Read-only audit performed before implementation; this is the ground truth
the feature keys off.)

- **Node universe.** The PRD spine (`SpineVersion`) plus the artifact slots
  (`ArtifactSlotKey = CoreArtifactSubtype | 'mockup'`). Visible subtypes
  today: `design_system`, `screen_inventory`, `user_flows`, `data_model`,
  `implementation_plan`, plus the `mockup` artifact. `component_inventory`
  is **hidden** (generates, no UI row — `HIDDEN_ARTIFACT_SUBTYPES`);
  `prompt_pack` is **retired** (`RETIRED_ARTIFACT_SUBTYPES`).
- **Real generation dependencies.** `CORE_ARTIFACT_PIPELINE[].dependsOn`:
  `user_flows ← screen_inventory`; `component_inventory ← screen_inventory`;
  `implementation_plan ← screen_inventory + data_model`. The mockup consumes
  `MOCKUP_DEPENDENCIES = [screen_inventory, component_inventory,
  design_system]` (constant now lives in `coreArtifactPipeline.ts`, shared
  with `artifactJobController`). Every artifact is additionally generated
  from the PRD (canonical spine + markdown are in every prompt).
- **Provenance.** `ArtifactVersion.sourceRefs`: every generated version
  records a `spine` ref; mockup versions already recorded `core_artifact`
  refs for their inputs (the design_system ref carries the tokensHash in
  `SourceRef.anchorInfo`). Core artifacts recorded **only** the spine ref
  before this feature.
- **Freshness (SYN-005).** `evaluateDependencyGraph` is the ONE freshness
  engine. The old `stalenessSlice.getArtifactStaleness` (3-value
  `current | possibly_outdated | outdated`) was **deleted**; its spine-ref-drift
  and mockup-tokensHash rules were absorbed here. `src/lib/artifactFreshness.ts`
  assembles the evaluator input from store slices and
  `useProjectFreshness(projectId)` is the selector-stable React entry every
  surface consumes. Live per-slot status still lives in the transient
  `generationJobsSlice`.
- **Regeneration flows.** `artifactJobController.retrySlot` (single slot),
  `startAll`/`resumeIfNeeded` (pending slots), `executeJob` (runs slots in
  `buildDependencyLayers()` order, mockup after the core pipeline).
- **Persistence/sync.** `sourceRefs` are part of `ArtifactVersion`, which
  already travels through localStorage, `/api/projects` sync, and snapshots
  — no schema or serialization change was needed.

## Dependency map

`src/lib/artifactDependencyGraph.ts` (pure — no store/React/LLM imports).
`buildArtifactDependencyGraph()` **derives** the graph from
`CORE_ARTIFACT_PIPELINE` + `MOCKUP_DEPENDENCIES`; it is never hand-drawn.
Hidden subtypes collapse transitively (dependents inherit their deps);
retired subtypes are excluded. Edge kinds:

- `hard` — a true data dependency from the pipeline (the dependent consumes
  the upstream artifact's output as prompt context).
- `foundation` — the implicit `prd → X` edge every artifact has.

To change the map, change the pipeline constants — the graph follows.

## Staleness model (deterministic, no semantic diffing)

Evaluated per node by `evaluateDependencyGraph()`:

1. **PRD drift** — the version's `spine` ref ≠ the latest spine id →
   `needs_update` (`prd_changed`).
2. **Dependency drift** — a recorded `core_artifact` ref ≠ that dependency's
   current preferred version id → `needs_update` (`dependency_changed`).
   `runCoreArtifactSlot` now records these refs for each `dependsOn` input
   (mirroring what `runMockupSlot` always did).
3. **Design token drift** (mockup only) — recorded tokensHash
   (`SourceRef.anchorInfo`) ≠ current preferred design system's hash →
   `needs_update` (`design_tokens_changed`). Hash comparison beats
   version-id comparison so a token-identical regen keeps mockups current.
4. **Legacy fallback** — no recorded dependency ref (pre-feature versions)
   but the dependency's preferred version is newer than this artifact →
   advisory `update_recommended` (`dependency_newer`).
5. **Validation review** — a live or persisted blocking validation
   disposition → `needs_review`. This is deliberately distinct from
   planning alignment: the evaluator still records any PRD or dependency
   drift reasons, but the output cannot be marked current until validation is
   resolved or explicitly accepted under policy.
6. **Missing / error / generating** — from artifact presence + the live job
   slot state.

Upstream trouble (including `needs_review`) additionally propagates
downstream as `impactedBy`
(transitive over hard edges), so an artifact whose own refs match still
warns when an ancestor is stale — surfaced as the blue **Impacted** pill.
Manual edits (`provenance.changeSource === 'user_edit'`) surface as a
caution flag, never a hard status.

## Update ordering & actions

- `computeUpdateOrder()` — topological order over the induced subgraph, so a
  batch never regenerates an artifact before an upstream input in the same
  batch. `computeRecommendedUpdates()` = stale ∪ missing ∪ errored ∪
  validation-review ∪ impacted nodes, in that order.
- **Update selected** → existing `artifactJobController.retrySlot`.
- **Update all impacted** → `artifactJobController.regenerateSlots(slots,
  args)` — a thin wrapper over the existing `executeJob`, which already runs
  core slots layer-by-layer and the mockup last. No second pipeline. No-op
  while a run is active (buttons are disabled off live job state). Because
  graph batches only name *visible* nodes, `regenerateSlots` expands the set
  with the hidden dependency closure
  (`expandWithHiddenDependencyClosure` in `coreArtifactPipeline.ts`): a
  hidden subtype rides along when a requested slot consumes it and either
  its own inputs are also being regenerated or it isn't done for the spine —
  so a `[screen_inventory, …, mockup]` batch also refreshes
  `component_inventory` instead of feeding the new mockup a component
  inventory built from the old screens.
- **Open artifact** → the hosting workspace view (`screen_inventory` and
  `mockup` route into the Screens experience view).
- **Mark current** is unavailable for `needs_review`; synchronization cannot
  convert a failed validation gate into a trusted output.

## UI

`src/components/dependency/DependencyGraphView.tsx`, mounted from
`ArtifactWorkspace` as the `'dependency_graph'` `WorkspaceSelection` (a
derived view like `'screens'`, **not** an artifact slot — no persisted
state). Graph View renders a deterministic SVG canvas (rows = dependency
depth, barycenter-ordered; no graph library, no DOM measurement); stale-
cause edges draw dashed amber. Impact View is the list-first exploration of
one artifact's blast radius. The detail panel has Overview / Dependencies /
Change Impact / History tabs.

## Compatibility

- Older projects lack dependency refs → the timestamp heuristic covers them
  (advisory, never hard-stale). Everything else keys off data that already
  exists (spine refs, versions, job slots).
- No new persisted state; snapshots and `/api/projects` sync are unchanged
  (`sourceRefs` already traveled in `ArtifactVersion`).

## Known limitations / follow-ups

- Node cards show version + date, not content-derived counts ("28 screens")
  — parsing every artifact on each render was deliberately skipped.
- Fine-grained content hashing (`contentHash`) is not implemented; version
  ids + tokensHash are the drift signals.
- `regenerateSlots` regenerates against the current final spine; it does not
  attempt per-artifact spine pinning.
