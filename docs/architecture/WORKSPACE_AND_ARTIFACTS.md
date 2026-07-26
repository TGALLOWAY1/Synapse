# Build Workspace, Artifact Groups & Implementation Plan

> Extracted from CLAUDE.md. Post-finalization flow, hidden/retired artifact subtypes, the consolidated Implementation Plan, the Artifact Dependency Graph (Project Map), and implementation tasks.

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
per-artifact model overrides keep working.

**`HIDDEN_ARTIFACT_SUBTYPES` / `isHiddenArtifactSubtype` in
`coreArtifactPipeline.ts` is the single source of truth for "hidden"** — a
subtype that still *generates* but is surfaced nowhere. It drives: (1)
`buildSlotMetas` drops it so it renders no sidebar/mobile-header/auto-open row;
(2) `ProjectWorkspace.assetsReady` excludes it (via `visibleCoreSubtypes()`) so a
hidden slot erroring can't strand the finalize success modal on "assets are being
created" — the user has no row to see/retry it; (3) `ExportModal` drops it from
the export list; (4) `artifactDependencyGraph.isVisibleSubtype` excludes it as a
node (dependents inherit its dependencies transitively, and
`expandWithHiddenDependencyClosure` re-adds it to graph-driven batches); (5)
`artifactJobController.resumeIfNeeded` only auto-wakes for *visible* pending slots
so an errored hidden slot isn't retried invisibly on every remount — while
`startAll` still includes hidden slots in its pending set, so they're best-effort
generated alongside visible ones. **The load-bearing rule: a hidden artifact must
never gate user-facing readiness or trigger an invisible retry loop.**

**The hidden set is currently EMPTY.** `component_inventory` (UI Components) was
its last member and was **unhidden by W4** of
[docs/ARTIFACT_READINESS_RESOLUTION_PLAN.md](../ARTIFACT_READINESS_RESOLUTION_PLAN.md):
it feeds every mockup through `MOCKUP_DEPENDENCIES` (`generateMockup` tags
per-screen `componentRefs` from it, which reach the gpt-image prompts), so an
invisible failure silently degraded the product. The mechanism above is retained
(empty, not deleted) so a future subtype can be hidden without re-deriving the
rule; `expandWithHiddenDependencyClosure` takes an injectable `isHidden`
predicate so the closure behavior stays unit-testable while the set is empty.

What unhiding `component_inventory` changed — all intentional and test-covered:

- **It is reviewable.** `ComponentInventoryRenderer` (dispatched from
  `ArtifactContentRenderer`) renders it as the **Components section inside the
  Screens experience** (`ScreenComponentsSection`), with screen back-references
  and advisory component/screen contradictions. See SCREENS_EXPERIENCE.md.
- **It still has no sidebar row.** It is deliberately absent from
  `ARTIFACT_GROUPS.items`, so `buildSlotMetas` never materializes a row —
  the same treatment as `screen_inventory`/`mockup`. Deep links / graph nodes /
  checkpoint destinations naming it route to the Screens view via
  `SCREENS_HOSTED_SLOTS`. **"No row" ≠ "hidden"** — don't conflate the layout
  choice with the visibility contract.
- **It now GATES output readiness.** `ProjectWorkspace.assetsReady` iterates
  `visibleCoreSubtypes()` (the shared "not hidden, not retired" list — use it
  rather than re-filtering), which now includes `component_inventory`. An errored
  component inventory legitimately holds the "outputs are ready" signal back.
  That is only acceptable because the Components section shows its status and
  offers Retry. Covered by `coreArtifactPipeline.test.ts`.
- **It now AUTO-RETRIES.** `resumeIfNeeded` wakes a run for a pending
  `component_inventory` slot instead of skipping it — no longer an invisible
  retry, for the same reason. Covered by `src/lib/__tests__/artifactJobResume.test.ts`.
- **It is a Dependency-Graph node and an export row.** The mockup's dependency on
  it is now an explicit edge instead of a collapsed one, it appears in the
  Sync-outputs row list (so it can be regenerated like any other output), and it
  is included in exports.

To hide a subtype again, add it back to `HIDDEN_ARTIFACT_SUBTYPES` — and re-check
every consumer above against the load-bearing rule. `docs/backlog/BACKLOG.md` §6
records the original hide decision and its resolution.
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

**The route to outputs is never gated on decisions or commitment.** The header
assets pill (`ProjectWorkspace.showAssetsPill`) shows whenever the latest
version has a safe structured PRD — labeled **Explore outputs** until
`planningReadiness.isReadyToBuild`, then **Build outputs** — so commitment is
an act of intent, not a prerequisite for reaching assets (do not re-add a
commitment condition to the pill). Because the pill is reachable before the
finalize flow, `handleGenerateAssets` interposes the explicit incomplete-PRD
confirmation ("Generate assets from an incomplete PRD?") whenever a non-final
spine has `generationMeta.failedSections` — `startAssetGeneration`'s
`acknowledgeIncomplete` flag may only ever carry a real user acknowledgement.
When output generation starts while planning items are still open,
`handleGenerateAssets` then offers the inline advisory
`PreBuildCheckpointCard` once per workspace session below the journey rail. It
names one exact, ranked planning item and offers Review first / Generate
outputs / Not now. Generating always proceeds; the hard generation gate stays
safety/PRD-only plus the incomplete-PRD acknowledgement
(`artifactGenerationGate.ts`). See PLANNING_AND_DECISIONS.md.

After a job observed active in the current session settles,
`WorkflowCheckpointSummaryCard` presents one non-persisted completion summary:
ready-output count plus current generation failures, validation dispositions
(including accepted issues and advisory warnings), critique findings, and
alignment notes. It is keyed by the transient job's spine/`startedAt`, is
dismissible, and does not reappear from stale persisted state after reload.

### Mockup flow-approval gate (approve flows before images)

Mockup generation is two-phase: a **spec phase** (`generateMockup`, no LLM —
derives the per-screen list from `screen_inventory` + `component_inventory` +
`design_system`) and a **visual phase** (OpenAI `gpt-image-2` per screen).
`runMockupSlot` produces the spec as part of the normal asset run but **no
longer fires image generation** — the costly visual step waits behind an
explicit flow-approval gate so the user reviews the user flows and approves
which screens are worth rendering before any image is generated.

- **`src/lib/mockupApproval.ts`** (pure, unit-tested) is the read/derive layer:
  `readMockupApproval` / `isMockupApproved` read the per-version overlay;
  `buildMockupScreenRecommendations` / `recommendedScreenIds` seed the checklist
  (P0/P1 and unlabelled screens pre-checked; P2/P3 offered unchecked — mirroring
  the spec's existing priority-first selection so the user sees *why* each screen
  is pre-checked).
- **Approval is a per-version overlay**, stored under
  `ArtifactVersion.metadata.mockupApproval`
  (`{ approvedAt, approvedScreenIds, flowsReviewed }`) via
  `updateArtifactVersionMetadata` — the same overlay pattern as `screenEdits` /
  `extraScreens`, so it travels through sync + snapshots with **no new persisted
  collection** (cross-cutting rules 6 & 12).
- **`MockupApprovalGate`** (`src/components/mockups/MockupApprovalGate.tsx`) is the
  UI: a compact flows review (parsed `user_flows` + an "Open Flows" jump + an
  "I've reviewed the flows" acknowledgement) and the recommendation-seeded screen
  checklist. On approve, `ArtifactWorkspace` writes the overlay (with a history
  description) and fires `mockupImageStore.generate` for the selected screens.
- **When the gate shows.** `ArtifactWorkspace`'s mockup branch renders the gate
  instead of `MockupViewer` only when the version has **no approval overlay and
  no images yet** *and* the project can generate. So demo/snapshot mockups (read
  only, images already present) and pre-feature versions render straight through,
  and a fresh regenerate re-gates the new version. Approval stays advisory in
  spirit — nothing else is blocked, and users can still add/regenerate screens
  from the mockup view afterwards.

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
  (`overview`/`milestones`/`prompt_packs`) and the **labels** are Build Brief /
  Roadmap / Prompts. **Synapse ends at the plan + prompts handoff** — see the
  "Removed: validation surface" note below. Above the tabs sit two cards, in
  order: `PlanHeader` (an **identity strip only** — title, the adapter's
  plan-shape readiness pill, scope counts, generated-from PRD version +
  staleness, threaded like data_model's `prdVersionLabel`/`staleness` props),
  then **`FinalReviewCard` — the plan's one decision surface** (see "Final
  Review" below, which owns every action including Convert to tasks). The
  legacy markdown fallback renders its own Convert-to-Tasks row so the modal
  stays reachable either way, and the outer white prose card is skipped for
  `implementation_plan` since the view brings its own cards.
  Decision-surface data is derived by the pure,
  unit-tested **`src/lib/services/implementationPlanInsights.ts`**:
  prompt-pack build order + next-pack resolution, the coverage matrix (cells
  are explicitly `covered`/`missing`/`not_tracked` — `missing` only when the
  plan links that artifact kind somewhere, so absence is never
  over-reported), change-impact scoping per upstream artifact, and structured
  prompt previews. The **Build Brief** tab's Build Timeline is the single
  milestone-sequencing view (the redundant Critical Path chip row was
  removed). The **Coverage tab is gone** (plan §W7): its gap summary is folded
  into Final Review and the full matrix survives there as an expandable
  detail via `CoverageTab showSummary={false}`, mounted only when opened. Do
  not re-add a Coverage tab — a second top-level integrity surface is the
  defect §W7 fixed. User progress (copied packs only) persists as the
  **`planProgress` metadata overlay** on the implementation_plan
  ArtifactVersion (`readPlanProgress`; same per-version pattern as
  screenEdits/promptEdits — regeneration starts clean; written silently via
  `updateArtifactVersionMetadata`, no history event). Saved
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
  `data_model` + `user_flows`. The `user_flows` edge is a **deliberate W2
  decision** (docs/ARTIFACT_READINESS_RESOLUTION_PLAN.md §W2): flows carry
  the alternate/error journeys the plan must turn into engineering work, so
  they reach the plan as prompt context (via `buildDependencyContext`, with a
  flows-aware summary — `summarizeUserFlowsDependency` — that preserves every
  flow's steps, decisions, error paths, and edge cases past the truncation
  budget), as a provenance `SourceRef`, and as a freshness input. This makes
  the **active pipeline 3 layers deep** (`screen_inventory → user_flows →
  implementation_plan`); the added wall-clock was accepted — do not
  "optimize" the edge back out. `user_flows` stays **out of
  `REQUIRED_DEPENDENCIES`**: plan generation waits for flows but proceeds
  with degraded context when they are missing/errored, and that gap surfaces
  through the dependency graph's `impactedBy` (see
  docs/ARTIFACT_DEPENDENCY_GRAPH.md), not as a generation blocker. The
  pipeline-shape tests assert ≥3-wide layer 1 and **exactly 3 layers** over
  the **active** pipeline. New runs never generate `prompt_pack` (see
  the retired-subtype rules above). Generated plans still carry
  `qualityGates`/`globalQualityGates` and `validationCommands` in the data
  model (the schema/prompt are unchanged), but only the validation commands
  are surfaced (as a per-milestone code block for the coding agent) — see the
  next note.
- **Removed: validation surface (kept as a note, intentionally not built).**
  Synapse's product boundary ends at the **implementation plan + prompts
  handoff**: the user copies the plan and prompt packs into their coding
  agent, and verification happens there. An earlier build tried to own
  post-handoff verification with a **Validation tab** — a quality-gate
  tracker where each generated gate had a user-set run status (Not run /
  Passed / Failed / Needs review / Blocked), a per-milestone Quality Gates
  card, a "Validated by" line on each prompt pack, a Quality Gates column in
  the Coverage matrix, and a copyable validation checklist, all persisted in
  the `planProgress.gateStatuses` overlay. This was removed as unnecessary
  complexity (confusing, and outside the handoff boundary). The gate **data**
  still generates so the concept can be revived, but there is **no gate UI or
  status tracking** — `planProgress` now tracks copied packs only, and
  `readPlanProgress` ignores any legacy `gateStatuses`. If reviving: restore
  `ValidationTab`, the `quality_gates` tab/nav target, the gate-row/summary/
  checklist derivations in `implementationPlanInsights.ts`, and the overlay
  field; do not resurrect model-authored "passed" styling (gates were always
  Not run until a user recorded an outcome).
- **Requirement / criterion identity for coverage & traceability.** Stable
  ids come from the derived `src/lib/requirementIdentity.ts` layer
  (`RequirementId` = `Feature.id`; `CriterionId` hashes the normalized
  criterion text — see "Derived requirement & criterion identity" in
  PLANNING_AND_DECISIONS.md). Coverage and traceability surfaces key off
  these ids, never off array position or raw prose equality; criterion prose
  found in screens, tasks, and Definition-of-Done lines resolves through
  `resolveCriterionRefs` with an explicit
  `exact | normalized | fuzzy | unmatched` confidence, and `unmatched` is
  reported, never dropped. The layer is derived and advisory only
  (cross-cutting rule 10); it is consumed by the
  ARTIFACT_READINESS_RESOLUTION_PLAN workstreams (W3/W6/W7).
- The demo project is a **cloud snapshot** and carries the legacy
  two-artifact shape until the owner re-pins a regenerated snapshot; the
  adapter is what keeps it rendering consolidated in the meantime. Do not add
  persisted state for the consolidated view.


### Final Review — one blocker list, one CTA (plan §W7)

`renderers/implementationPlan/FinalReviewCard.tsx` is the Implementation
Plan's **decision surface**. It replaced the old executive header, which
rendered **four competing actions** with "Copy next prompt" styled primary
regardless of blockers, while plan integrity was summarized in four places
(workspace status, Dependency Graph, Coverage tab, readiness) with no single
authority.

- **Exactly one primary action, always.** The pure, unit-tested state machine
  `deriveFinalReviewCta` (`src/lib/planning/buildPacketApproval.ts`) returns one
  `primary` plus a `secondary` list, in four states:

  | State | Primary label | Source of the label |
  |---|---|---|
  | `resolve_blockers` (`!packet.isPacketComplete`) | **Resolve N blockers** | `N = packet.blockers.length` from §W6's `deriveBuildPacketReadiness` |
  | `approve` (complete, no covering approval) | **Approve build packet** / **Re-approve build packet** | fixed copy; "Re-" when a recorded approval no longer covers the current versions |
  | `start_build` (complete + covering approval) | **Copy first / next implementation prompt**, else **Start first slice** | the plan's own next-uncopied prompt pack (`findNextPromptPack`) |
  | `unavailable` (no `packet` — isolated renders only) | **Check build readiness**, disabled | fixed copy |

  **Blockers dominate:** a packet that regressed after approval returns to
  `resolve_blockers`, and a prior approval never promotes a build action.
  `resolve_blockers` toggles the ordered blocker list open; each entry shows
  `title`, `consequence`, `remedy` and a navigable action target.
- **Copy plan / Review prompts / Convert to tasks are secondary at ALL times**,
  including when the packet is ready — they live in a demoted "More actions"
  menu. Copying a prompt before approval stays possible, only never as the
  primary: every prompt-copy button on the surface (`PromptPackCard`, the
  Prompts tab's copy-next/copy-all, "Copy milestone prompts") is permanently
  `variant="secondary"` — approved or not — so `FinalReviewCard` holds the only
  filled button on any tab. **Prompt review and task conversion are not
  approvals** — do not wire either to the approval state.
- **The blocker list and the Dependency Graph can never disagree.** Both derive
  from the same engines: §W6 consumes `evaluateProjectFreshness` (rule 9) and
  the graph *is* that engine's output. §W7 introduces no third integrity
  source, and the Dependency Graph stays a **diagnostics** view.
- **Navigation reuses the readiness router.** `BuildPacketActionTarget` is
  `ReadinessActionTarget` plus `artifact_slot` and `readiness_commitment`.
  `isReadinessActionTarget` / `buildPacketNavigationDestination` /
  `buildPacketActionLabel` (`components/planning/readinessCheckpointView.ts`)
  split them, and `ProjectWorkspace.navigateBuildPacketTarget` **delegates every
  shared kind to `navigateReadinessTarget`**. Do not add a second router.
- **The pinned artifact-version manifest.** `useBuildPacketInputs` returns a
  `manifest: BuildPacketManifestEntry[]` built in the **same** slot → artifact →
  preferred-version loop as the evaluator's per-slot state, so the gate's
  evidence and the manifest the user signs can never describe different
  versions. `reconcileBuildPacketManifest` compares the pinned versions against
  the current ones and labels each row `match` / `changed` / `added` /
  `removed` / `unpinned`; any drift marks the approval **superseded** and the
  CTA asks to re-approve. The approval is never rewritten to "catch up" — that
  would silently re-sign work the user never saw. **One row is exempt from
  version comparison:** the slot hosting the overlay
  (`BUILD_PACKET_APPROVAL_HOST_SLOT` = `implementation_plan`). Recording the
  approval appends a content-identical clone, so the plan's own preferred version
  id moves as a *side effect of approving*; comparing it would mark every fresh
  approval superseded on the next render. The host row needs no comparison —
  the overlay living on that version IS the pin, and a regenerated plan yields a
  version with no overlay, which reads back as "not approved".
- **How the approval persists — a versioned user overlay, no new collection.**
  `metadata.buildPacketApproval` on the implementation_plan ArtifactVersion,
  listed in `OVERLAY_METADATA_KEYS` and written **only** through
  `updateArtifactOverlay` (cross-cutting rule 12), never
  `updateArtifactVersionMetadata`. `buildPacketApprovalPatch` merges from the
  stored value so unknown keys survive, and re-approval is destructive under
  `patchDestroysOverlayWork`, so it **appends** and the earlier sign-off stays
  restorable. Because `artifactVersions` is already a persisted collection, the
  approval travels through snapshots, sync, and the recovery bundle for free —
  **no `ALL_PROJECT_COLLECTIONS` entry** (rule 6). It is deliberately **not**
  the readiness commitment (`readinessCommitment.ts`), which approves the
  product *reasoning*: reusing that would conflate the two evaluators §W6 keeps
  apart, and it cannot pin artifact versions. Regenerating the plan starts a
  fresh version with no approval — correct, since that is a different packet.
- **Capability.** The approval respects one policy: `ArtifactWorkspace` gates
  `onApprove` on `capabilities.canPersistWorkflowState`
  (`useProjectCapabilities`), the store action re-checks through
  `guardProjectStoreActions`, and the CTA renders disabled with a stated reason
  in a read-only project. No raw demo-id check (rule 5).
- **§W5's cross-cutting obligations card lives here**, passed in as
  `obligations`, instead of floating above the plan as a sibling in
  `ArtifactWorkspace` — next to the `cross_cutting` blocker it corresponds to,
  so plan integrity has one home. Consequence, accepted: the **legacy markdown
  fallback** (content `buildConsolidatedPlan` cannot parse) no longer shows the
  obligations card, since it renders no Final Review. Stating a cross-cutting
  verdict over content Synapse could not read as a plan would be a guess; the
  §W6 gate still blocks on it either way.

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
- **`evaluateDependencyGraph` is THE single freshness engine (SYN-005).** The
  legacy `stalenessSlice` / `getArtifactStaleness` (3-value `StalenessState`:
  current/possibly_outdated/outdated) was deleted; every surface now reads this
  one evaluator through the shared seam. **`src/lib/artifactFreshness.ts`**
  assembles its `DependencyEvaluationInput` from raw store slices
  (`buildDependencyEvaluationInput` / `evaluateProjectFreshness` /
  `invertToArtifactIds`) — **never hand-roll the store→input loop again** (that
  duplication across DependencyGraphView and the update-plan builder was the
  SYN-005 defect). **`useProjectFreshness(projectId)`** is the selector-stable
  React entry (used by DependencyGraphView, ArtifactWorkspace, ExportModal).
  **`DEPENDENCY_STATUS_LABELS`** is the ONLY status-label map; `isStaleStatus`
  (needs_update | update_recommended) and `hasDesignTokenDrift` are the shared
  staleness predicates; `needs_review` is handled explicitly as a separate
  validation-blocked status. `FreshnessBadge` is the inline badge for stale
  statuses. Staleness itself is deterministic: spine-ref drift and recorded
  dependency-ref drift → `needs_update`; the mockup design-tokensHash rule (a
  `design_tokens_changed` reason) uses hash comparison over version-id
  comparison — a token-identical regen keeps mockups current; missing/error/
  generating come from artifact presence + live job slots. A live or durable
  blocking validation disposition is `needs_review`; it remains separate from
  planning alignment, propagates downstream as trouble, and cannot be cleared
  with Mark current. Upstream trouble propagates downstream as `impactedBy`
  (blue "Impacted" pill).
  **System freshness (`DependencyNodeStatus`) is a SEPARATE vocabulary from the
  user review/readiness statuses** (`screenReadiness` / `screenReviewWorkflow`)
  — never merge them.
- **One two-speed `Sync outputs` entry reuses existing flows.** Quick sync
  presents every affected visible output together with Regenerate / Mark
  current / Later choices, revalidates the exact spine and preferred versions,
  and submits one dependency-safe
  `artifactJobController.regenerateSlots(slots, args)` batch. Careful sync is
  advanced disclosure over the existing immutable per-region downstream update
  plans; those plans are prepared idempotently in the background when inputs
  drift, and their exact-region proposals are projected into the Review-stage
  output-sync queue. Preparation returns partial results and never records a
  review decision, applies content, promotes a version, or manufactures user
  authority. A dependent cannot
  be marked current while a troubled upstream is skipped or regenerated.
  Manual edits are called out because regeneration appends a version rather
  than overwriting the preferred one. Active jobs, project capabilities,
  generation gates, the design preset, and the key requirement are rechecked
  before writes. The batch wrapper still delegates to `executeJob`
  (dependency-layer order, mockup last — no second pipeline). It no-ops while a
  run is active. `computeUpdateOrder`/`computeRecommendedUpdates` supply the
  topological order. **Hidden closure rule:** graph batches only name
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
  spine, or its preferred version has a non-accepted validation disposition),
  routes to
  `regenerateSlots([…unhealthy deps, slot])` so the upstreams regenerate first —
  reusing the same graph-driven `executeJob` path — instead of saving a
  downstream result built from invalid dependency state. Routes only when no run
  is active; an all-healthy plan falls through to the plain single-slot retry.
- **Workspace wiring rules.** The selection is excluded from the finalize
  auto-open candidates and renders no `StatusDot` (`slotStatusFor` returns a
  constant `'done'` for it). "Open artifact" routes `screen_inventory`/
  `mockup` into the Screens view since neither has its own sidebar row.

### Build-packet readiness (is this packet implementable?)

`src/lib/planning/buildPacketReadiness.ts` (`deriveBuildPacketReadiness`, pure +
unit-tested) is the artifact-side readiness evaluator from
[docs/ARTIFACT_READINESS_RESOLUTION_PLAN.md](../ARTIFACT_READINESS_RESOLUTION_PLAN.md)
§W6. It answers **"is the implementation packet complete and current?"** — a
*different* question from `derivePlanningReadiness`'s "is the product reasoning
sound?". The authority model, the eight criteria, and the never-conflate rule
live in [PLANNING_AND_DECISIONS.md](PLANNING_AND_DECISIONS.md); what matters
here is how it sits on the workspace:

- **Required slots are `buildPacketRequiredSlots()` = `visibleCoreSubtypes()` +
  `mockup`** — deliberately the same set `ProjectWorkspace.assetsReady` gates on,
  so unhiding/hiding a subtype moves both signals together and the gate can
  never demand an output the pipeline does not produce. A slot is *present* when
  it has a preferred version and is neither errored nor still generating;
  presence unions the caller's slot state with the freshness engine's
  `missing` / `error` / `generating` statuses, so a disagreement fails closed.
- **It consumes the one freshness engine** — `useProjectFreshness` through
  `src/hooks/useBuildPacketInputs.ts` — and reads **both `status` and
  `impactedBy`**. That second read is load-bearing:
  `evaluateDependencyGraph` short-circuits when an upstream snapshot is absent,
  so a plan whose `user_flows` input is **missing or errored** stays
  `up_to_date` and records the problem only in `impactedBy`. Never "fix" that in
  the engine (one engine, one vocabulary — cross-cutting rule 9); read
  `impactedBy`.
- **Validation** comes from the per-version disposition
  (`readArtifactValidationDisposition`): `needs_review` blocks, while an
  `accepted_issue` — which carries the user's recorded rationale — is reported
  as a non-blocking warning. Endpoint completeness comes from
  `apiContractCompleteness` and blocks only for endpoints reachable from the
  **first milestone**; a later-slice gap is a warning.
- **Nothing about it gates rendering or generation.** It is a derived,
  never-persisted read-side layer (rule 10) that *reports*. Exploratory output
  generation stays available exactly as before.
- **Workspace consumers.** The header outputs CTA no longer labels itself
  "Build outputs" from the planning-readiness projection (the audited false
  claim); it reads off the recorded commitment
  (`displaysCurrentCommitment`), and its hover copy states the packet state
  separately. `PlanningStateBar` renders an "Implementation packet" block with
  its own "Packet checks" disclosure next to the "Product-reasoning checks"
  one. The Implementation Plan page's **Final Review** surface (plan §W7 — see
  "Final Review" above) is the plan-side authority: `ProjectWorkspace` computes
  the packet **once** and passes it to both `PlanningStateBar` and
  `ArtifactWorkspace` (`buildPacket` / `buildPacketManifest` /
  `onNavigateBuildPacketTarget`), so the two surfaces never evaluate
  independently. `PlanningStateBar` stays the *plan-stage* summary; Final Review
  owns the CTA and the blocker list, and the Dependency Graph stays diagnostics.

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
