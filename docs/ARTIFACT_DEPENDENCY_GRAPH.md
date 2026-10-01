# Artifact Dependency Graph (Project Map)

A read-side **project integrity dashboard** in the Assets workspace: it
visualizes how Synapse artifacts derive from the PRD and from each other,
which artifacts are stale after upstream changes (and *why*), and the safe
order to regenerate them. Sidebar: **Project Map → Dependency Graph**.

## Audit — the artifact system this was built on

(Read-only audit performed before implementation; this is the ground truth
the feature keys off.)

- **Node universe.** The PRD spine (`SpineVersion`) plus the artifact slots
  (`ArtifactSlotKey = CoreArtifactSubtype | 'mockup'`). Reviewable subtypes
  today: `design_system`, `screen_inventory`, `user_flows`,
  `component_inventory`, `data_model`, `implementation_plan`, plus the
  `mockup` artifact. `component_inventory` has no sidebar row but is visible
  inside Screens → Components and in this graph; `HIDDEN_ARTIFACT_SUBTYPES` is
  empty. `prompt_pack` is **retired** (`RETIRED_ARTIFACT_SUBTYPES`).
- **Real generation dependencies.** `CORE_ARTIFACT_PIPELINE[].dependsOn`:
  `user_flows ← screen_inventory`; `component_inventory ← screen_inventory`;
  `implementation_plan ← screen_inventory + data_model + user_flows` (the
  `user_flows` edge is the deliberate W2 decision — flows carry the
  alternate/error journeys the plan must see; it makes the active pipeline 3
  layers deep, accepted in docs/ARTIFACT_READINESS_RESOLUTION_PLAN.md §W2,
  and is optional context, not a `REQUIRED_DEPENDENCIES` entry). The mockup consumes
  `MOCKUP_DEPENDENCIES = [screen_inventory, component_inventory,
  design_system]` (constant now lives in `coreArtifactPipeline.ts`, shared
  with `artifactJobController`). Every artifact is additionally generated
  from the PRD (canonical spine + markdown are in every prompt).
- **Provenance.** `ArtifactVersion.sourceRefs`: every generated version
  records a `spine` ref; mockup versions already recorded `core_artifact`
  refs for their inputs (the design_system ref carries the tokensHash in
  `SourceRef.anchorInfo`). Core artifacts recorded **only** the spine ref
  before this feature. Since input fingerprints (below), every generated
  version ALSO records `provenance.inputHashes` — fingerprints of exactly the
  inputs its generator read.
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

Evaluated per node by `evaluateDependencyGraph()`. **Inputs are compared, not
version ids**, whenever the version carries a comparable input fingerprint;
legacy versions keep the id rules.

### Input fingerprints (`src/lib/artifactInputSlices.ts`)

A version id moves without any input moving all the time: a PRD restore to
identical content mints a new spine id, a no-op save or an undone edit lands
back on the same content, and an overlay edit, "Mark as up to date", or an
artifact restore appends a content-identical clone of an upstream. Comparing
ids flagged every downstream output in all of those cases (a one-sentence
Vision edit, a decision apply, or a restore marked all seven outputs "Needs
update" and the Sync modal preselected Regenerate on each — ~3 minutes and six
model calls). So generation records what each output was built from:

- **The slice map.** `ARTIFACT_INPUT_SLICES` declares, per slot, what its
  generator reads: the PRD-side slice kind, the design-direction policy, and
  the upstream artifacts whose content it consumes (the pipeline's own
  `dependsOn`; the mockup's `screen_inventory` + `component_inventory` — its
  design-system input stays tracked by tokensHash, rule 4 below).
- **The projection is shared.** `selectArtifactPrdInput` projects a spine +
  project onto a slot's slice. The job controller builds every core prompt
  from that projection (`selectCorePromptInput` → `buildCorePromptCall` →
  `generateCoreArtifact`) and the mockup spec's settings from
  `selectMockupSpecInput`, so prompt and fingerprint cannot drift.
  `artifactInputSlices.test.ts` pins it: inputs outside a slice change neither
  the assembled prompt nor the fingerprint, and every input change the prompt
  sees moves the fingerprint.
- **What each slot reads today.**
  - Every core artifact (design_system, screen_inventory, user_flows,
    component_inventory, data_model, implementation_plan) — `core_prompt`:
    the canonical PRD spine built from the WHOLE structured PRD (identity,
    users, features, screen/entity seeds, constraints, safety, architecture,
    design direction), the guardrails' feature ids, and the **full PRD
    markdown appendix**, which renders essentially every structured field
    (decisions included). So any PRD content edit — a Vision sentence, a
    risk, a confirmed assumption — moves every core fingerprint, honestly:
    the model would see it. Narrowing a subtype means narrowing what its
    prompt reads (a new slice kind its prompt is built from).
  - The mockup — `mockup_spec`: only the product name, the vision (title +
    summary) and the auto settings (platform + a fidelity derived from
    feature count, high-complexity count, and PRD length). A risks,
    architecture, decision, or feature-description edit leaves it current.
- **Fingerprints hash raw inputs** — the structured PRD, the stored PRD
  markdown (`responseText`), the product-name fallback, platform, the safety
  review's directive fields, the preset, and upstream content — never derived
  renderings such as the canonical spine, so a deploy that changes how a
  prompt or the spine is rendered never moves a fingerprint the user did not
  touch. Hashing is canonical (sorted keys, collapsed whitespace, empty values
  dropped) and 64-bit (`inputContentHash`).
- **Recorded as provenance** (`provenance.inputHashes = { scheme, spine,
  designBrief?, dependencies? }`, stamped by `runCoreArtifactSlot` /
  `runMockupSlot`); every comparison is derived on read (rule 10). The
  `scheme` carries the hashing version and the slot's slice version: a record
  from another scheme is never compared (id fallback), so changing a slice can
  never mass-flag existing outputs.
- **The current side** is computed by the freshness seam
  (`buildDependencyEvaluationInput` → `currentPrdInputHashesForSpine`, memoized
  per spine object and shared by every core slot; each preferred version's
  `contentHash` via `versionContentHash`, memoized per version object) — only
  for slots whose output recorded a fingerprint, and only when the latest spine
  has a structured PRD and the project is known; otherwise the engine falls
  back to ids. `deriveProjectOutputAlignment` assembles the same fingerprints
  (it takes the project), so alignment and freshness reach one verdict.

### The rules

1. **PRD drift** — fingerprinted: the recorded PRD-side fingerprint ≠ the
   current one → `needs_update` (`prd_changed`, "The parts of the PRD this
   output reads changed…"). Legacy: the version's `spine` ref ≠ the latest
   spine id → `needs_update` (`prd_changed`).
2. **Design direction drift** — fingerprinted, **design system only**: the
   recorded design brief (the effective preset) ≠ the current one →
   `needs_update` (`design_direction_changed`). Every core prompt carries the
   direction (the spine's `design` block), so it is *recorded* for every core
   slot, but only the design system — whose prompt takes the preset directive
   as a hard constraint — is *compared*: a direction change invalidates the
   design system and, through its tokens, the mockups (rule 4), as before.
3. **Dependency drift** — fingerprinted: the recorded content fingerprint of
   a consumed dependency ≠ that dependency's current `contentHash` →
   `needs_update` (`dependency_changed`); a content-identical clone (overlay
   edit, mark-current, restore) is **not** drift. Legacy: a recorded
   `core_artifact` ref ≠ that dependency's current preferred version id →
   `needs_update` (`dependency_changed`). `runCoreArtifactSlot` records these
   refs for each `dependsOn` input (mirroring what `runMockupSlot` always did).
4. **Design token drift** (mockup only) — recorded tokensHash
   (`SourceRef.anchorInfo`) ≠ current preferred design system's hash →
   `needs_update` (`design_tokens_changed`). Hash comparison beats
   version-id comparison so a token-identical regen keeps mockups current.
5. **Legacy fallback** — no recorded dependency ref or fingerprint
   (pre-feature versions, or a dependency missing at generation time) but the
   dependency's preferred version is newer than this artifact → advisory
   `update_recommended` (`dependency_newer`).
6. **Validation review** — a live or persisted blocking validation
   disposition → `needs_review`. This is deliberately distinct from
   planning alignment: the evaluator still records any PRD or dependency
   drift reasons, but the output cannot be marked current until validation is
   resolved or explicitly accepted under policy.
7. **Missing / error / generating** — from artifact presence + the live job
   slot state.

Upstream trouble (including `needs_review`) additionally propagates
downstream as `impactedBy`
(transitive over hard edges), so an artifact whose own refs match still
warns when an ancestor is stale — surfaced as the blue **Impacted** pill.
That includes a fingerprint-current mockup whose screen inventory is stale:
its own inputs did not move, but they will when the upstream regenerates.

`changeSummary` and `likelyUnaffected` are kept on both paths: a moved
fingerprint establishes drift, and the change summary still explains *what*
changed; because every core prompt reads the whole PRD, the advisory
"likely unaffected" hint (the affinity map in `spineChangeAnalysis.ts`) is
still the only signal that a hard `prd_changed` is probably immaterial. It
never suppresses the hard status.
Manual edits (`provenance.changeSource === 'user_edit'`) surface as a
caution flag, never a hard status.

**A missing dependency is not a stale one.** When an upstream snapshot is
absent, the evaluator short-circuits (`if (!depSnapshot) continue` — nothing
concrete to compare), so the dependent's own status stays `up_to_date`; the
problem is reported **only through `impactedBy`** (the propagation loop's
`troubled()` predicate includes `missing` and `error`). Concretely for the W2
edge: a **changed** `user_flows` marks `implementation_plan` `needs_update`
(`dependency_changed`), but a **missing or errored** `user_flows` leaves the
plan `up_to_date` with `user_flows` in its `impactedBy`. Consumers must
therefore read `impactedBy` alongside status (`isStaleStatus` alone misses
this case — W6's build-packet gate reads both). This is deliberate engine
semantics (cross-cutting rule 9) — do not "fix" it by changing the status
vocabulary.

## Update ordering & actions

- `computeUpdateOrder()` — topological order over the induced subgraph, so a
  batch never regenerates an artifact before an upstream input in the same
  batch. `computeRecommendedUpdates()` = stale ∪ missing ∪ errored ∪
  validation-review ∪ impacted nodes, in that order.
- **Generation reads the same verdict.** The job controller's "is this slot
  current for the spine?" (`isSlotDoneForSpine` → `isVersionCurrentForSpine`)
  applies the engine's PRD-side comparison, so a run seeds fingerprint-current
  upstreams generated against an older spine version as dependency context
  (`seedGenerationContext`) and records refs to them — regenerating one
  dependent alone still reads its required inputs. `startAll` skips
  fingerprint-current outputs, except that an output whose input regenerates
  in the same run rides along (never more than the spine-ref rule scheduled).
  Resume
  evidence stays spine-ref based: an output merely current for a newer spine
  is not evidence that a run for it began. The controller's verdict is
  PRD-side only — a changed design preset is reported by the engine
  (`design_direction_changed`) but never makes the design system "not done",
  or the early design-system run (which the workspace fires on any project
  change) would regenerate it in the background, racing Change direction's
  own regenerate confirmation.
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
- **Mark current** rebases the refs and the input fingerprint onto the
  confirmed inputs (VERSIONING_AND_EXPORT.md). It is unavailable for
  `needs_review`; synchronization cannot convert a failed validation gate into
  a trusted output.

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
  (advisory, never hard-stale). Versions without an input fingerprint keep
  the id comparison; everything else keys off data that already exists
  (spine refs, versions, job slots).
- No new persisted collection: `provenance.inputHashes` is an optional field
  on `ArtifactVersion`, which already travels through localStorage,
  `/api/projects` sync, snapshots, and the recovery bundle.

## Known limitations / follow-ups

- Node cards show version + date, not content-derived counts ("28 screens")
  — parsing every artifact on each render was deliberately skipped.
- Every core prompt reads the whole PRD (the full markdown appendix), so a
  PRD content edit anywhere still flags all six core outputs; only the mockup
  has a narrow slice. Precision for the core outputs needs their prompts
  narrowed (a new slice kind each prompt is built from) and live quality
  validation — the slice map is where that lands.
- Clones that change content without regenerating (an applied selective
  downstream update) drop the fingerprint, so that version falls back to the
  id comparison until its next regeneration.
- `regenerateSlots` regenerates against the current final spine; it does not
  attempt per-artifact spine pinning.
