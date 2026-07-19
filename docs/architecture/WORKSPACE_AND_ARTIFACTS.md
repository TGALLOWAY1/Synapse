# Build Workspace, Artifact Groups & Implementation Plan

> Extracted from CLAUDE.md. Post-commitment flow, hidden/retired artifact subtypes, the consolidated Implementation Plan, the Artifact Dependency Graph (Project Map), and implementation tasks.

### Post-commitment transition (Commit Plan → Build)

The artifact sidebar is organized into four workflow-named sections —
**Project Foundation** (PRD **and** Design System — the design system sits
directly below the PRD as the shared visual foundation every downstream asset is
generated against), **Experience** (User Flows, Screens — see "The Experience
workspace" below), **Architecture** (Data Model), and **Development**
(Implementation Plan — see "Consolidated Implementation Plan" below) — driven by
`ARTIFACT_GROUPS` in `ArtifactWorkspace.tsx`. Grouping is purely visual;
`CoreArtifactSubtype` ids
(`'data_model'`, `'component_inventory'`, `'design_system'`, `'prompt_pack'`,
`'implementation_plan'`) are unchanged so persisted artifacts, generation, and
per-artifact model overrides keep working. **`component_inventory` (UI Components)
is a *hidden* artifact** — no hard dependents, not useful to surface directly
right now, so it is hidden from the assets list but **still generates** (it stays
in `CORE_ARTIFACT_PIPELINE` and `MOCKUP_DEPENDENCIES`; mockups softly consume it
to tag per-screen `componentRefs`). **`HIDDEN_ARTIFACT_SUBTYPES` /
`isHiddenArtifactSubtype` in `coreArtifactPipeline.ts` is the single source of
truth for "hidden"** and drives three things: (1) `buildSlotMetas` drops it so it
renders no sidebar/mobile-header/auto-open row (it may stay listed in
`ARTIFACT_GROUPS.items`; the filter removes it); (2) `ProjectWorkspace.assetsReady`
excludes hidden subtypes so a hidden slot erroring can't strand the finalize
success modal on "assets are being created" (the user has no row to see/retry it);
(3) `artifactJobController.resumeIfNeeded` only auto-wakes for *visible* pending
slots so an errored hidden slot isn't retried invisibly on every remount — but
`startAll` still includes hidden slots in its pending set, so they're best-effort
generated alongside visible ones. A hidden artifact must never gate readiness or
be the sole reason a run resumes. To re-expose one, remove it from
`HIDDEN_ARTIFACT_SUBTYPES`. See `docs/backlog/BACKLOG.md` §6.
**`prompt_pack` (Developer Prompts) is a *retired* artifact**
(`RETIRED_ARTIFACT_SUBTYPES` / `isRetiredArtifactSubtype`, same module) —
stronger than hidden: retired subtypes are excluded from new generation runs
(`pendingSlotsForSpine`), from `assetsReady`, from `buildSlotMetas`, and from
the Settings model list, while the pipeline meta / renderer / export path stay
for legacy persisted artifacts. A retired subtype must never be a dependency
of an active one (its dep would starve in the layer filter — regression test
in `coreArtifactPipeline.test.ts`). `title`/`description` in
`CORE_ARTIFACT_PIPELINE` are display-only labels that may be renamed freely; the
sidebar's iteration order (and the mobile-header / auto-open order)
all derive from `ARTIFACT_GROUPS`, not `displayOrder`. There is no
separate generation-status panel on the right — per-slot status lives
inline on each sidebar row (the `StatusDot` next to the title) and in
the mobile header beside the selected artifact name.

Committing a spine records implementation intent but does not start artifact
generation. `ProjectWorkspace.handleToggleFinal` first presents categorical
planning readiness and any incomplete-source acknowledgement, then shows
`FinalizationSuccessModal`. The modal makes **Generate build foundation** an
explicit second action. Existing-output projects can instead **Review outputs**;
that action switches `currentStage` to `workspace` and arms a one-shot
`finalizeAutoOpen` flag passed to `ArtifactWorkspace`. `ArtifactWorkspace` consumes it once
(via `onAutoOpenConsumed`): it auto-selects the first **non-PRD** artifact —
preferring `done`, then `generating`, then `queued`, else the first slot in
`ARTIFACT_GROUPS` order (design_system → user_flows → screens → … →
implementation_plan) — and opens the mobile drawer (`useIsMobile`-gated, so it
never reopens after the user closes it; desktop keeps the persistent side rail). While the overall run is in
flight, an idle slot renders a centered `BuildAssetsLoading` ("Creating your
build assets…") instead of an empty state.

### Consolidated Implementation Plan (Development section)

The old **Developer Prompts** (`prompt_pack`) and **Build Plan**
(`implementation_plan`) rows are consolidated into one **Implementation Plan**
artifact (subtype id still `implementation_plan` — no new subtype, so
persisted artifacts, version history, snapshots, sync, model routing, and
Convert-to-Tasks all keep working). See
`docs/IMPLEMENTATION_PLAN_CONSOLIDATION.md` for the audit + design.

- **Data shape.** `StructuredImplementationPlan` (in `src/types`) gained
  all-optional consolidated fields: plan `summary`
  (`ImplementationPlanSummary`), `globalQualityGates`, and per-milestone
  `objective`/`priority`/`estimatedEffort`/`dependencies`/`linkedArtifacts`/
  `promptPacks` (`ImplementationPromptPack`)/`qualityGates`
  (`ImplementationQualityGate`)/`validationCommands`/`definitionOfDone`.
  Storage format is unchanged: markdown + trailing ```` ```json synapse-plan ````
  fence; the readable markdown keeps the legacy
  Milestone/Goal/Deliverables/Dependencies headings (artifactValidation and
  the legacy parser depend on them) and full prompt bodies live only in the
  fence JSON.
- **Adapter, not migration.** `src/lib/services/implementationPlanAdapter.ts`
  (`buildConsolidatedPlan`, pure, unit-tested) builds the render-time
  `ConsolidatedImplementationPlan` view model from any combination of: native
  consolidated plan, legacy structured plan, legacy markdown-only plan,
  and/or a legacy `prompt_pack` artifact. Legacy prompts become prompt packs
  attached to milestones by conservative token matching (≥2 shared meaningful
  tokens; unmatched → a labeled **Unassigned Prompt Packs** group); legacy
  plan-wide Definition of Done → categorized global quality gates; legacy
  Architecture → summary stack; Risks (milestone or appendix) → `plan.risks`
  (their own overview card — deliberately **not** folded into
  `readiness.warnings`, so the readiness signal stays trustworthy).
  `readiness` and `traceability` are always **derived, never
  persisted/generated**. The legacy prompt-card parser is shared via
  `src/lib/services/promptPackParser.ts` (extracted from
  `PromptPackRenderer`).
- **Renderer.** `ImplementationPlanRenderer` routes through the adapter into
  `renderers/implementationPlan/ConsolidatedPlanView.tsx` — a guided build
  launcher, not a report. Tab **ids** keep the internal vocabulary
  (`overview`/`milestones`/`prompt_packs`/`quality_gates`/`traceability`) but
  the **labels** are Build Brief / Roadmap / Prompts / Validation / Coverage.
  An executive `PlanHeader` sits above the tabs: readiness pill, scope
  counts, generated-from PRD version + staleness (threaded like data_model's
  `prdVersionLabel`/`staleness` props), a primary **Copy next prompt** CTA,
  and the **Convert to tasks** entry point (moved out of `ArtifactWorkspace`'s
  floating row; the legacy markdown fallback renders its own
  Convert-to-Tasks row so the modal stays reachable either way, and the
  outer white prose card is skipped for `implementation_plan` since the view
  brings its own cards). Decision-surface data is derived by the pure,
  unit-tested **`src/lib/services/implementationPlanInsights.ts`**:
  prompt-pack build order + next-pack resolution, gate rows with
  milestone/prompt linkage and verify commands, the coverage matrix (cells
  are explicitly `covered`/`missing`/`not_tracked` — `missing` only when the
  plan links that artifact kind somewhere, so absence is never
  over-reported), change-impact scoping per upstream artifact, critical-path
  resolution (ids/names → clickable milestone chips), and structured prompt
  previews. **Honest gate statuses:** every quality gate defaults to **Not
  run** — green/passed styling only ever reflects a user-recorded outcome;
  never re-add implied-pass icons. User progress (gate outcomes + copied
  packs) persists as the **`planProgress` metadata overlay** on the
  implementation_plan ArtifactVersion (`readPlanProgress`; same per-version
  pattern as screenEdits/promptEdits — regeneration starts clean; written
  silently via `updateArtifactVersionMetadata`, no history event). Saved
  `ProjectTask`s are threaded in as `savedTasks` so structured-plan task ids
  (preserved by `taskExtractor`) mark milestone tasks as "tracked" vs merely
  planned. Fence-less, milestone-less content falls back to the old timeline
  / plain markdown. `ArtifactWorkspace` threads the legacy standalone
  prompt_pack artifact's preferred content in as `promptPackContent`, plus
  `sourceVersions` (core_artifact sourceRefs resolved to "Data Model v2"
  labels for Coverage provenance), via `ArtifactContentRenderer`.
- **Generation.** The `implementation_plan` prompt + Gemini schema
  (`artifactSchemas.ts`) emit the consolidated shape with **milestone-centered
  prompt packs** (self-contained, agent-agnostic, fixed heading structure:
  Goal / Relevant Synapse Artifacts / Scope / Out of Scope / Implementation
  Steps / Acceptance Criteria / Quality Gates / Validation Commands / Commit
  Guidance; no triple backticks inside bodies — they'd collide with the
  markdown fences). It has true data deps on `screen_inventory` +
  `data_model` (NOT `user_flows` — that edge would make the active pipeline 3
  layers deep; the pipeline-shape tests assert ≥3-wide layer 1 and ≤2 layers
  over the **active** pipeline). New runs never generate `prompt_pack` (see
  the retired-subtype rules above).
- The demo project is a **cloud snapshot** and carries the legacy
  two-artifact shape until the owner re-pins a regenerated snapshot; the
  adapter is what keeps it rendering consolidated in the meantime. Do not add
  persisted state for the consolidated view.


### Artifact Dependency Graph (Project Map) — read-side integrity view

**Project Map → Dependency Graph** (`'dependency_graph'`, a
`WorkspaceSelection` like `'screens'`, NOT an artifact slot — no persisted
state) visualizes how artifacts derive from the PRD and each other, which are
stale and why, and the safe update order. See
`docs/ARTIFACT_DEPENDENCY_GRAPH.md`.

- **The map is derived, never hand-drawn.** `src/lib/artifactDependencyGraph.ts`
  (pure; no store/React/LLM imports; unit-tested) builds the graph from
  `CORE_ARTIFACT_PIPELINE` + `MOCKUP_DEPENDENCIES` (the latter now lives in
  `coreArtifactPipeline.ts`, shared with `artifactJobController`). Hidden
  subtypes collapse transitively; retired subtypes are excluded. To change the
  graph, change the pipeline constants — do **not** add edges in the graph
  module.
- **Provenance refs.** `runCoreArtifactSlot` records a `core_artifact`
  `SourceRef` for each `dependsOn` input actually available at generation time
  (mirrors what `runMockupSlot` always did). Legacy versions lack these refs —
  the evaluator falls back to a timestamp heuristic (advisory
  `update_recommended`, never hard `needs_update`). `sourceRefs` already
  travel in `ArtifactVersion` through persistence/sync/snapshots, so no
  schema change was involved.
- **Staleness is deterministic** (`evaluateDependencyGraph`): spine-ref drift
  and recorded dependency-ref drift → `needs_update`; the mockup
  design-tokensHash rule mirrors `stalenessSlice` (hash comparison beats
  version-id comparison — a token-identical regen keeps mockups current);
  missing/error/generating come from artifact presence + live job slots.
  Upstream trouble propagates downstream as `impactedBy` (blue "Impacted"
  pill). Keep this evaluator and `stalenessSlice` consistent if either rule
  set changes.
- **Actions reuse existing flows.** Single update → `retrySlot`; batch →
  `artifactJobController.regenerateSlots(slots, args)`, a thin wrapper over
  the existing `executeJob` (dependency-layer order, mockup last — no second
  pipeline). It no-ops while a run is active; the UI disables update buttons
  off live job state. `computeUpdateOrder`/`computeRecommendedUpdates` supply
  the topological order. **Hidden closure rule:** graph batches only name
  visible nodes, so `regenerateSlots` expands them via
  `expandWithHiddenDependencyClosure` (`coreArtifactPipeline.ts`) — a hidden
  subtype is pulled in when a requested slot consumes it and its inputs are
  also being regenerated (or it isn't done for the spine). Never pass a
  graph-derived batch to `executeJob` without this expansion, or the mockup
  can rebuild against a `component_inventory` generated from the old
  screen inventory.
- **Retry respects the dependency closure.** `retrySlot` no longer regenerates a
  slot against missing/errored/stale/needs_review upstreams. It calls the pure
  `planSlotRetry(slot, isHealthy)` (`coreArtifactPipeline.ts`), which walks the
  slot's dependency closure (including hidden deps like `component_inventory`)
  and, when a dependency is unhealthy (`isDependencyHealthy`: not done for the
  spine, or its preferred version carries `validationBlockers`), routes to
  `regenerateSlots([…unhealthy deps, slot])` so the upstreams regenerate first —
  reusing the same graph-driven `executeJob` path — instead of saving a
  downstream result built from invalid dependency state. Routes only when no run
  is active; an all-healthy plan falls through to the plain single-slot retry.
- **Workspace wiring rules.** The selection is excluded from the finalize
  auto-open candidates and renders no `StatusDot` (`slotStatusFor` returns a
  constant `'done'` for it). "Open artifact" routes `screen_inventory`/
  `mockup` into the Screens view since neither has its own sidebar row.

### Implementation tasks (plan → tracked checklist)

The Implementation Plan artifact converts into trackable build tasks.
`taskExtractor.ts` deterministically derives `ImplementationTask[]` (no LLM
call) from the plan's structured JSON or legacy markdown. `ConvertToTasksModal`
(opened from the Implementation Plan view) lets the user review/edit them, then:

- **Save to project** persists them via `saveTasks` (`tasksSlice`) as
  `ProjectTask[]` with `status: 'todo'`. Re-opening the modal seeds from the
  saved set (preserving status), so editing and re-saving never resets
  progress.
- **Export** (`taskExport/` registry: markdown / github / linear) is unchanged;
  after a github/linear export the modal calls `recordTaskExports` to attach
  the created issue refs to the matching persisted tasks.

`TaskChecklist` (`src/components/tasks/`) renders above the Implementation Plan
content when saved tasks exist: a progress bar (`done / total`), a status
toggle per row cycling todo → in_progress → done, expandable acceptance
criteria, and a link to any exported GitHub issue. The "Convert to Tasks"
button becomes "Manage Tasks (N)" once tasks are saved. Tasks capture
`sourceSpineVersionId` for future staleness hints. Persisted tasks are cleaned
up in `deleteProject`.

