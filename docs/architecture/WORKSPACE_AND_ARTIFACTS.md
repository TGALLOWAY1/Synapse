# Build Workspace, Artifact Groups & Implementation Plan

> Extracted from CLAUDE.md. Reaching the Build stage, hidden/retired artifact subtypes, the consolidated Implementation Plan, the Artifact Dependency Graph (Project Map), and implementation tasks.

### Reaching the Build stage (Generate outputs)

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
hidden slot erroring can't hold the header outputs CTA short of "Review outputs"
— the user has no row to see/retry it; (3) `ExportModal` drops it from
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
  retry, for the same reason (and, like every slot, within the automatic-resume
  cap — see "Artifact job runs" below). Covered by
  `src/lib/__tests__/artifactJobResume.test.ts`.
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

Output generation is an explicit user action with **no commitment step in
front of it** (the Finalize flow — readiness review, commit, finalize success
modal, pre-build card — was removed; see PLANNING_AND_DECISIONS.md). It starts
from the Plan page's top-bar **Generate outputs**
(`ProjectWorkspace.handleGenerateAssets`) or from the Build stage's own
**Generate outputs** banner (`showBuildGenerateBanner`: shown on the Build stage
while no visible output is ready and no run is building, gated on
`capabilities.canGenerateArtifacts`, hidden while the PRD run is in flight or an
old version is viewed). Both go through the same handler: the incomplete-PRD
confirmation when needed, then the one-time visual-direction picker when no
preset is set, then `artifactJobController.startAll`. Starting generation,
**Review outputs**, and the journey rail's Build step (when outputs exist or
are building) switch `currentStage` to `workspace` and arm a one-shot
`outputsAutoOpen` flag passed to `ArtifactWorkspace`. `ArtifactWorkspace` consumes it once
(via `onAutoOpenConsumed`): it auto-selects the first **non-PRD** artifact —
preferring `done`, then `generating`, then `queued`, else the first slot in
`ARTIFACT_GROUPS` order (design_system → user_flows → screens → … →
implementation_plan) — and opens the mobile drawer (`useIsMobile`-gated, so it
never reopens after the user closes it; desktop keeps the persistent side rail). While the overall run is in
flight, an idle slot renders a centered `BuildAssetsLoading` ("Creating your
build assets…") instead of an empty state.

**The route to outputs is never gated on decisions, readiness, or
commitment.** The header outputs pill (`ProjectWorkspace.showAssetsPill`) shows
whenever the latest version has a safe structured PRD and its run has settled.
Its label states the action only — **Generate outputs**, **Review outputs**, or
**Building outputs…** — never a readiness claim; the outputs stage is always
labelled **Build** (there is no Explore-vs-Build split). Once outputs exist,
the pill's hover copy adds the advisory build-packet state ("estimated"). Do
not re-add a readiness or commitment condition to the pill or the banner.
`handleGenerateAssets` interposes the explicit incomplete-PRD confirmation
("Generate assets from an incomplete PRD?") whenever the spine has
`generationMeta.failedSections` (a legacy `isFinal` spine already recorded that
acknowledgement) — `startAssetGeneration`'s `acknowledgeIncomplete` flag may
only ever carry a real user acknowledgement. There is no pre-generation
interstitial: generating always proceeds, and the hard generation gate stays
safety/PRD-only plus the incomplete-PRD acknowledgement
(`artifactGenerationGate.ts`).

After a job observed active in the current session settles,
`WorkflowCheckpointSummaryCard` presents one non-persisted completion summary:
ready-output count plus current generation failures, validation dispositions
(including accepted issues and advisory warnings), critique findings, and
alignment notes. It is keyed by the transient job's spine/`startedAt`, is
dismissible, and does not reappear from stale persisted state after reload.

### Artifact job runs: ownership, resume evidence, automatic-resume cap

`artifactJobController` (`src/lib/services/artifactJobController.ts`) drives
output runs; the per-project job (`generationJobsSlice`) is transient UI state.
Three rules keep runs from fighting each other or looping:

- **Run ownership.** Every run (`startAll`, `regenerateSlots`, `retrySlot`,
  `ensureDesignSystemForSpine`) has a `runId`. `initJob(…, { runId })` stamps it
  on the job (`ProjectJobState.runId`); a run that reuses an existing job
  (`retrySlot` without a live run, the early design-system run) takes it over
  with `claimJobRun`; a retry that joins the live run shares its id. Every job
  write from the controller passes its run id — `setSlotStatus`,
  `appendSlotProgress`, `markAllInterrupted` — and the slice **no-ops a write
  from any run that doesn't own the job**. So a superseded run (e.g. aborted by
  a spine change) settling late can't flip the new run's slots to
  `interrupted`. Untagged writes stay unguarded (legacy callers, tests). New
  controller write paths must pass the run id.
- **Resume evidence (`hasResumeEvidence`).** Auto-resume is recovery for a run
  that was started, never an entry side effect of opening Build. Evidence is
  (1) an output already completed for the spine, (2) this session's job for the
  spine still holding queued/generating/interrupted slots, or (3) the durable
  `Project.outputRun` marker for the spine reading `'interrupted'`. `startAll`
  stamps the marker `'running'` (`markOutputRunStarted`) when a run launches and
  removes it when **that** run settles — completed, failed, or cancelled
  (`settleOutputRun`, a no-op for any other run id). A page load converts a
  leftover `'running'` marker to `'interrupted'` (`markInterruptedOutputRuns` in
  `onRehydrateStorage`, mirroring `markInterruptedGenerations`), which is how a
  reload **before the first output lands** resumes instead of leaving an idle
  workspace. A `'running'` marker is not evidence: it may belong to a run that is
  live in another tab or on another device (cross-tab adoption and sync pulls
  never convert it). Known limit, shared with PRD `generationPhase` recovery: a
  page load converts EVERY persisted `'running'` marker, including one written
  by another tab or pulled from another device whose run is still live, so
  that run can be resumed twice. Only `startAll` stamps the marker —
  `regenerateSlots` batches and single-slot runs do not.
- **Automatic-resume cap.** `resumeIfNeeded` runs on every Build mount, so a
  deterministically failing slot used to be re-run (and paid for) on every
  visit. Each automatic run counts toward its slots'
  `SlotState.autoResumeAttempts` (carried across same-spine `initJob`s; a new
  spine starts fresh); once a slot reaches `MAX_AUTO_RESUME_ATTEMPTS` (2) it is left out of
  automatic runs — its failed state is carried into the new job unchanged
  (`carryOverSlots`) — and the manual Retry (with its own `MAX_RETRY_FAILURES`
  cap) owns it. User-started runs neither count nor reset the budget. Like the
  manual cap it is per page session (jobs are not persisted).

Covered by `src/lib/services/__tests__/artifactJobController.runs.test.ts`,
`src/store/__tests__/generationJobsSlice.test.ts`,
`src/lib/__tests__/artifactJobResume.test.ts`, and
`src/store/__tests__/interruptedGeneration.test.ts`.

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
  screenEdits/promptEdits — regeneration starts clean; written through
  `updateArtifactOverlay` like every other user overlay, cross-cutting rule
  12). Saved `ProjectTask`s are threaded in as `savedTasks` so structured-plan
  task ids (preserved by `taskExtractor`) mark milestone tasks as "tracked" vs
  merely planned, and any self-reported progress on them is named per
  "Task progress is SELF-REPORTED" below.
  Fence-less, milestone-less content falls back to the old timeline
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


### Final Review — an advisory checklist, one CTA (plan §W7)

`renderers/implementationPlan/FinalReviewCard.tsx` is the Implementation
Plan's review surface. It replaced the old executive header, which rendered
**four competing actions** with "Copy next prompt" styled primary, while plan
integrity was summarized in four places (workspace status, Dependency Graph,
Coverage tab, readiness) with no single home.

- **Advisory, not a gate.** The card lists §W6's seven packet checks
  (`packet.criteria`, in `BUILD_PACKET_CRITERION_ORDER`) as a checklist
  labelled **estimated, advisory**, with a status chip ("N of 7 checks pass ·
  estimated"). Each open check shows its explanation and every blocker's
  `title`, `consequence`, `remedy`, and a navigable fix
  (`buildPacketActionLabel` — e.g. "Open the API contract", "Open this
  feature"). Warnings render under "Recorded, not counted". Nothing — copying
  prompts, exporting, converting to tasks — waits on any check.
- **Exactly one primary action, always the next build step.** The pure,
  unit-tested `deriveFinalReviewCta` (`src/lib/planning/buildPacketApproval.ts`)
  returns `primary` (`start_build`: **Copy first / next implementation
  prompt**, else **Start first slice**, from the plan's own next-uncopied
  prompt pack, `findNextPromptPack`), a `secondary` list, a `rationale`, the
  `openCheckCount`, and the `approvalState`
  (`not_approved` / `approved` / `superseded`). The primary never changes with
  the checks or the approval.
- **Approval is an optional sign-off.** **Approve build packet** (or
  **Re-approve build packet** once a recorded approval no longer covers the
  current versions) renders beside the primary, marked "(optional)", and is
  disabled with a stated reason in a read-only project. Approving with open
  checks is allowed; the overlay records the open check ids it was approved
  with (`acknowledgedOpenCheckIds`). Once approved the button disappears and a
  "Packet approved" chip shows; when an output moves the chip reads "Changed
  since approval".
- **Review prompts / Convert to tasks (Manage tasks (N)) / Copy plan are
  secondary at ALL times** — they live in a demoted "More actions" menu. Every
  prompt-copy button on the surface (`PromptPackCard`, the Prompts tab's
  copy-next/copy-all, "Copy milestone prompts") is permanently
  `variant="secondary"`, so `FinalReviewCard` holds the only filled button on
  any tab. **Prompt review and task conversion are not approvals** — do not
  wire either to the approval state.
- **The checklist and the Dependency Graph can never disagree.** Both derive
  from the same engines: §W6 consumes `evaluateProjectFreshness` (rule 9) and
  the graph *is* that engine's output. §W7 introduces no third integrity
  source, and the Dependency Graph stays a **diagnostics** view.
- **One router.** `BuildPacketActionTarget` has exactly two kinds: an
  `artifact_slot` (optionally narrowed to `api_contract` / `coverage` /
  `first_milestone`, or a milestone) and a `feature` in the PRD's Features
  view. `ProjectWorkspace.navigateBuildPacketTarget` handles both: a slot
  target opens the Build stage on that slot (threaded through
  `initialBuildPacketTarget`), a feature target switches the PRD to the
  Features view on that feature with a "Back to Build" return target. Do not
  add a second router.
- **The pinned artifact-version manifest.** `useBuildPacketInputs` returns a
  `manifest: BuildPacketManifestEntry[]` built in the **same** slot → artifact →
  preferred-version loop as the evaluator's per-slot state, so the checklist's
  evidence and the manifest the user signs can never describe different
  versions. The card shows it as the "Artifact versions an approval covers"
  disclosure. `reconcileBuildPacketManifest` compares the pinned versions against
  the current ones and labels each row `match` / `changed` / `added` /
  `removed` / `unpinned`; any drift marks the approval **superseded** and the
  card offers **Re-approve build packet** (still optional). The approval is never rewritten to "catch up" — that
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
  **no `ALL_PROJECT_COLLECTIONS` entry** (rule 6). It is deliberately about the
  *packet* only — it says nothing about the product reasoning, so the two
  evaluators §W6 keeps apart stay apart (the old reasoning commitment it was
  once contrasted with was removed with the Finalize layer). Regenerating the
  plan starts a fresh version with no approval — correct, since that is a
  different packet.
- **Capability.** The approval respects one policy: `ArtifactWorkspace` gates
  `onApprove` on `capabilities.canPersistWorkflowState`
  (`useProjectCapabilities`), the store action re-checks through
  `guardProjectStoreActions`, and the CTA renders disabled with a stated reason
  in a read-only project. No raw demo-id check (rule 5).
- **§W5's cross-cutting obligations card lives here**, passed in as
  `obligations`, instead of floating above the plan as a sibling in
  `ArtifactWorkspace` — next to the `cross_cutting` check it corresponds to,
  so plan integrity has one home. Consequence, accepted: the **legacy markdown
  fallback** (content `buildConsolidatedPlan` cannot parse) no longer shows the
  obligations card, since it renders no Final Review. Stating a cross-cutting
  verdict over content Synapse could not read as a plan would be a guess; the
  §W6 check still reports it as open either way.

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
- **Workspace wiring rules.** The selection is excluded from the outputs
  auto-open candidates and renders no `StatusDot` (`slotStatusFor` returns a
  constant `'done'` for it). "Open artifact" routes `screen_inventory`/
  `mockup` into the Screens view since neither has its own sidebar row.

### Build-packet readiness (is this packet implementable?)

`src/lib/planning/buildPacketReadiness.ts` (`deriveBuildPacketReadiness`, pure +
unit-tested) is the artifact-side readiness evaluator from
[docs/ARTIFACT_READINESS_RESOLUTION_PLAN.md](../ARTIFACT_READINESS_RESOLUTION_PLAN.md)
§W6. It answers **"is the implementation packet complete and current?"** — a
*different* question from `derivePlanningReadiness`'s "is the product reasoning
sound?". Both are advisory. The seven checks and the never-conflate rule
live in [PLANNING_AND_DECISIONS.md](PLANNING_AND_DECISIONS.md); what matters
here is how it sits on the workspace:

- **Required slots are `buildPacketRequiredSlots()` = `visibleCoreSubtypes()` +
  `mockup`** — deliberately the same set `ProjectWorkspace.assetsReady` reads,
  so unhiding/hiding a subtype moves both signals together and the checklist
  can never demand an output the pipeline does not produce. A slot is *present* when
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
- **Nothing gates on it** — not rendering, generation, export, task
  conversion, or prompt copying. It is a derived, never-persisted read-side
  layer (rule 10) that *reports*.
- **Workspace consumers.** The header outputs CTA labels the action only
  ("Generate outputs" / "Review outputs" / "Building outputs…" — never "Build
  outputs" from the planning-readiness projection, the audited false claim);
  its hover copy states the packet state separately, labelled estimated. The
  Implementation Plan page's **Final Review** card (plan §W7 — see "Final
  Review" above) is the only checklist: `ProjectWorkspace` computes the packet
  **once** and passes it to `ArtifactWorkspace` (`buildPacket` /
  `buildPacketManifest` / `onNavigateBuildPacketTarget`). The Plan page shows
  no packet block, and the Dependency Graph stays diagnostics.

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
content when saved tasks exist: a progress bar, a status toggle per row,
expandable acceptance criteria, and a link to any exported GitHub issue. The
"Convert to Tasks" button becomes "Manage Tasks (N)" once tasks are saved.
Tasks capture `sourceSpineVersionId` for future staleness hints. Persisted
tasks are cleaned up in `deleteProject`.

#### Task progress is SELF-REPORTED, and says so (plan §W8)

Synapse ends at the plan + prompts handoff — it never runs a build, a test, or
a command — so it holds **no evidence** that a task was implemented. Every
progress state is something the user ticked, and the vocabulary says that out
loud: **planned → started → implemented (self-reported)**.

- **`src/lib/taskProgressLanguage.ts` is the single source of those words.**
  `taskProgressCopy(status)` maps a *stored* value to `{ label, longLabel,
  nextAction }`; `TASK_PROGRESS_SELF_REPORTED_NOTE` is the one line that states
  Synapse does not verify execution. Don't inline a status label at a surface.
- **Presentation only — the persisted vocabulary is unchanged.** `TaskStatus`
  is still `todo | in_progress | done | blocked`, so older projects, snapshots,
  sync, exports and the plan-markdown round-trip keep working; §W8 renamed
  nothing on disk and migrated nothing. Mapping: `todo` → Planned,
  `in_progress` → Started, `done` → **Implemented (self-reported)**, `blocked`
  → Blocked (import-only; no UI writes it). An unrecognized stored value reads
  as Planned — never as implemented (cross-cutting rule 3's spirit).
- **Where it renders.** `TaskChecklist` (the only surface that writes progress):
  the toggle's accessible name/tooltip is `"<longLabel> — click to
  <nextAction>"`, the header count reads `"N of M marked implemented · K
  started"`, the bar is `aria-label`led "Self-reported implementation
  progress", and the note renders **once** under the bar. `MilestoneCard`
  build-task rows (read-only reflections of either a converted `ProjectTask` or
  a legacy `- [x]` markdown deliverable) name any non-planned state in a small
  chip with `longLabel` as its `title`, and the milestone's tracked count is
  suffixed `· self-reported`. **One line per surface, never a per-row banner or
  a modal.**
- **Build-packet readiness must never count it as evidence.**
  `buildPacketReadiness.ts` (§W6) reads plan tasks for their *structure* only —
  ids, titles, descriptions, `linkedArtifacts`, `dependencies`, and the
  verification texts around them. It does not read a plan task's `status`, the
  persisted `ProjectTask.status`, or the `planProgress` overlay, and
  `BuildPacketReadinessInput` deliberately has no field for them; otherwise a
  project could tick its way to a green packet. Locked by
  `buildPacketReadiness.test.ts` → "self-reported task progress is never
  evidence" (flipping every stored status must not change the evaluation).
- **Deliberately not built:** CI/command evidence ingestion. §6 of
  docs/ARTIFACT_READINESS_RESOLUTION_PLAN.md defers it (it needs an evidence
  transport, a trust model, and staleness rules); honest labelling removes the
  misleading signal at a fraction of the cost. Do not add a verified-state
  lifecycle here without that plan — §W8 exists partly to hold the line against
  Synapse drifting into a project-management tool.
