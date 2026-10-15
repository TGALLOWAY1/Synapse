# Uncertainty-First Planning, Adversarial Review & the Decision Center

> Extracted from CLAUDE.md. The planning decision domain (PlanningRecord/DecisionEvent), readiness projection, assumption import/validation, decision impact + the compare-and-append write barrier, and the adversarial review engine. Design docs: docs/DECISION_CENTER_DESIGN.md, docs/ADVERSARIAL_PLANNING_REVIEW.md, docs/UNCERTAINTY_FIRST_PLANNING.md, docs/DECISION_CENTER_SIMPLIFICATION_PLAN.md. Open remediation program for change-management coherence (dependency coverage, approved baselines/change sets, region-level restore): docs/CHANGE_MANAGEMENT_REMEDIATION_PLAN.md — read it before extending downstream update plans, output alignment, or restore semantics.

### Uncertainty-first planning, adversarial review, and Decision Center

The user-facing workspace journey is **Plan · Decide · Build**
(`src/lib/journeyPresentation.ts`, rendered by `JourneyRail`). It is a
presentation projection over the existing persisted stage keys: the PRD
(`prd`) and the Challenge stage (`review`) both present as **Plan**; **Decide**
opens the Decision Center slide-over and carries the open-item badge
(`planningReadiness.openItems` — open decisions plus assumptions to confirm);
the outputs stage (`workspace`) is always **Build**. There is no Finalize /
commitment step and no "unavailable" state: a step with nothing to show yet
(Decide and Build before a safe structured plan exists) is simply inert, and
Build is also inert while a historical PRD version is selected (History Mode
is a read-only Plan view; see VERSIONING_AND_EXPORT.md). Project history opens
as a panel.
The **Decision Center is a universal slide-over** that preserves the originating
surface and exact return context; it is also available from the workspace
overflow menu. The Refine review surface opens on a **tab-free specialist
critique setup page** — a two-column layout pairing the recommended specialist
panel (colored per-challenger accents, Select all, per-row expandable focus
areas) with a **What happens next** sidebar and the primary action. The
**Findings → History** tabs are retained on the run surfaces (progress,
results, and the history list) so any completed run stays reachable; only the
fresh setup page omits them. The specialist critique is **optional and never
decision-count gated**. Starting a new run, resuming an interrupted/failed run,
retrying partial coverage, and reviewing again remain available while decisions
are open. Those surfaces show one quiet advisory — “N open items; critiquing now
may re-raise them” — rather than disabling the action or bulk-deferring records.
The Decision Center layer, critique history, and completed runs stay visible
throughout.
A completed critique's findings still promote into new planning records. The
Decide step and the Plan page's **Open Decision Center** open the Decision
Center over the current surface without changing the underlying stage.
`src/components/review/ReviewWorkspaceContainer.tsx`
adapts persisted review/planning state into the responsive UI in
`ReviewWorkspace.tsx` and `DecisionCenter.tsx`. The container is a thin
composition root: run orchestration lives in `useReviewRunController.ts`,
manifest capture/reconstruction in `useReviewContextManifest.ts`, issue
dispositions in `useReviewIssueActions.ts` (+ the
`reviewIssueDispositions.ts` action→disposition tables), assumption
validation in `useAssumptionValidationActions.ts`, decision verdicts /
impact previews / the write-barrier apply path in
`useDecisionImpactActions.ts`, and the pure store→view projections in
`reviewRunViews.ts` and `planningRecordViews.ts`.

- `derivePlanningReadiness` (`planningReadiness.ts`) is the pure, categorical
  project-readiness projection. It evaluates foundation clarity, intentional
  scope, material open decisions/assumptions, current challenge coverage,
  source drift, incomplete sections, and output alignment. Never replace it
  with a percentage or artifact-count score. Missing outputs do not reduce
  planning readiness. **It answers "is the product reasoning sound?" and
  nothing else** — do not widen it to look at artifacts; that is the separate
  build-packet evaluator's job (see "Two readiness evaluators" below).
- `PlanningStateBar` is the Plan stage's **one line** of planning state:
  "N open decisions · M assumptions to confirm" (or "No open decisions or
  assumptions"), read from `derivePlanningReadiness(...).openItems` — the same
  set the Decision Center lists under "Needs attention", so the bar, the Decide
  badge, and the queue always agree — plus **Open Decision Center** and a quiet
  **Challenge this plan**. It is deliberately not a card: no readiness verdict,
  no criterion breakdown or "checks" disclosures, no implementation-packet
  block, so the PRD content starts right under it. Do not re-add a verdict,
  tool cards, or check lists to it.
- There is no workspace-wide next-action strip and no ranked attention model.
  (A `GlobalNextActionStrip`, and later `derivePlanningAttention` feeding a
  pre-generation `PreBuildCheckpointCard`, the calm/caution overview card, and
  the guided "sharpen" question flow, were all removed with the Finalize
  layer.) The open-item count lives on the one-line bar and the Decide badge;
  the items themselves are answered in the Decision Center. Do not re-add a
  standalone aggregate open-item surface or a pre-generation interstitial.
- PRD assumptions are imported idempotently as soon as the latest structured
  PRD exists; visiting Challenge is not a prerequisite for planning state.
  Newly imported assumptions surface as the Decide badge / the one-line bar's
  count and in the Decision Center queue — the former session-only arrival
  card (Accept defaults / Review each / Later) folded into that badge. Each
  answer is the Decision Center's ordinary guarded, append-only user
  `DecisionEvent` for that record.
- Generated assumptions distinguish **confidence** (plausibility) from
  **materiality** (consequence if wrong) and may identify affected PRD
  sections. Ranking is materiality-first.
- **There is no commitment layer.** The Finalize flow — the readiness review
  modal, commit/authorize/reopen, the materiality hard stop, the finalize
  success modal, the pre-build card, the committed / accepted-risk /
  unverifiable header states, and the Explore-vs-Build label split — was
  removed. Output generation (`artifactJobController.startAll`) is reached
  directly from the Plan page's top-bar **Generate outputs** and from the Build
  stage; only the incomplete-PRD gate and the safety gate stand in front of it.
  Do not re-introduce a commitment, readiness, or decision-count gate on
  generation, export, task conversion, or prompt copying.
- **Legacy commitment data stays readable; nothing writes it.**
  `SpineVersion.isFinal`, `readinessReviews`, and `readinessCommitmentEvents`
  remain in the types (marked legacy) and in `ALL_PROJECT_COLLECTIONS`,
  snapshots, sync, and retention so old projects round-trip; `readinessSlice`
  now only declares the two empty collections. A legacy `isFinal` spine still
  counts as a durable incomplete-PRD acknowledgement
  (`artifactGenerationGate.ts`; newer spines record the explicit "Generate
  anyway" as `incompleteAcknowledgedAt` instead) and still confirms a
  downstream update plan's source change. `HistoryView` renders old checkpoint/commitment events as
  plain, neutral entries.
- **Downstream source-change confirmation comes from the surviving authority**
  (`isSourceChangeConfirmed`, `downstreamUpdatePlanGeneration.ts`), not from a
  commitment. A plan's source change (the latest spine) is confirmed when it is
  user-authored — `provenance.changeSource` is `user_edit` (inline edits, and
  decision-impact applies through `compareAndAppendStructuredPRD`),
  `decision_edit`, `branch_merge` (consolidation / staged apply), `revert`
  (restore), or `ai_section_retry` (a section re-run the user triggered) — or
  when a confirmed/resolved planning record produced it, or (legacy) the spine
  is `isFinal`. Only a fresh model draft with no user decision behind its
  content (`ai_generation`, `ai_regeneration` from Regenerate Draft) or a
  legacy spine with no provenance stays provisional; the review says "no edit
  or decision has confirmed it yet", and the next user-authored change
  confirms it. A confirmed change lets the bounded planners propose definite
  removals of obsolete downstream elements; a provisional one keeps them
  review items. Keep the distinction: do not confirm wholesale model churn.
- **Challenge coverage** (`challengeCoverage.ts`, `deriveChallengeCoverage`) is
  the pure projection of "has the exact current plan been substantively
  challenged, and which consequential findings are still unresolved?". It feeds
  `derivePlanningReadiness`'s `challenge` criterion and the generation/export
  checkpoint's critique rows; it gates nothing. Closing a finding as
  dismissed/already-addressed requires a rationale of
  `MIN_CLOSURE_REASON_LENGTH` characters — entry surfaces must enforce the
  same floor the coverage projection checks.

- `PlanningRecord` is the shared durable aggregate for decisions, assumptions,
  risks, open questions, and semantic inconsistencies. Do not add a parallel
  decision collection. Older records remain valid because all new fields are
  optional.
- Human authority is append-only in `DecisionEvent[]`. Verdict events are
  structurally and runtime-restricted to `actor: 'user'`; Synapse/model output
  belongs in `DecisionAssessment[]`. The current status is a projection from
  events (`src/lib/planning/decisionProjection.ts`), never proof that a model
  response was approved.
- Existing PRD assumptions are imported lazily and idempotently by stable
  assumption id (`assumptionImport.ts`). Legacy confirmed/rejected assumption
  fields become explicit imported user verdict events; undecided assumptions
  never gain fabricated approval.
- Open decisions and open questions get **machine-suggested alternatives**:
  `generateDecisionOptions` (`decisionOptionsGeneration.ts`) is a bounded
  strong-model call that returns 2-3 mutually exclusive options (each with
  honest tradeoffs including at least one cost/risk) and exactly one
  recommendation, validated closed with one structured-repair attempt. Results
  persist through `setPlanningRecordDecisionOptions` only — a guarded store
  action that refuses non-choice record types and any record that already has
  a user verdict, and stamps `decisionOptionsProvenance`. Suggestions are
  advisory: they never alter record status. In the Decision Center the
  recommended option is **preselected as the default choice** so approving it
  is a single explicit **Approve recommendation** click — a verdict is still
  only ever recorded by that user action (`actor: 'user'`; nothing is
  auto-approved), and choosing another option or a custom answer stays one
  click away. Generation auto-triggers when a decision record is created from
  a Challenge finding, when the Decision Center opens an option-less
  unresolved decision, and eagerly for the first open choices when the
  Challenge stage mounts (`MAX_EAGER_OPTION_PREPARATIONS` in
  `ReviewWorkspaceContainer.tsx` is a **per-mount total**, tracked by a
  requested-id set so re-renders never drain a larger backlog batch by batch;
  failed attempts are not auto-retried; `useDecisionOptionSuggestions.ts`
  dedupes in-flight and stored options). The prompt is snapshot-locked in
  `promptSurfaces.test.ts`.
- **Batch recommendation acceptance is presentation orchestration over
  individual authority events.** `batchVerdicts.ts` snapshots each eligible
  record's open status, semantic target, recommendation identity, and source
  spine. `useBatchVerdictCoordinator` submits records one at a time; the store
  revalidates every guard inside the write transaction and reports
  succeeded/skipped/failed ids. A stale or changed recommendation writes
  nothing. The Decision Center exposes **Accept N recommendations** only when
  at least two visible records are eligible.
- **Related planning records group visually, not semantically.**
  `planningRecordGrouping.ts` builds conservative critique-cluster and exact
  PRD-section groups with stable order and singleton fallback. Group children
  remain separately selectable, answerable, auditable records; grouping never
  creates a combined verdict or changes hashes.
- **Answering is terminal for the Decision Center queue.** The "Needs
  attention" tab lists only records that still need an answer
  (`needsVerdict`: status open/proposed); the header count chip and the
  post-answer banner count the same set, so the numbers always agree. An
  answered material assumption moves to "Resolved & history" immediately,
  labeled **"Answered · not validated"** — `requiresValidation` stays true on
  the view (readiness surfaces still see it) but it never keeps a record
  looking unresolved in the queue after the user answered. In the detail pane
  the answer actions render directly under "Why it matters"; the full
  evidence workflow (`AssumptionValidationPanel`) sits behind a collapsed
  "Validate with evidence" disclosure (auto-open only while a validation is
  planned/in progress/due for review), and the decision-impact "Plan
  alignment" proposals sit behind a collapsed summary line with a pending
  count — recording a verdict must never unload proposal cards onto the
  user. Do not re-add `requiresValidation` to the queue's attention
  predicate or re-expand these sections by default.
- **Open items live in the Decision Center, not inside the assets.** Generated
  outputs are read surfaces: they render their content plainly and must not
  flag their own unresolved items. (The User Flows asset previously derived a
  per-flow risk level and an "N unresolved" count from an issue-wording
  heuristic; both were removed — the heuristic mostly fired on designed
  fallbacks such as "… is missing from the index → return a canned reply".)
  `assetOpenItems.ts` is the derived, advisory replacement: it scans each
  artifact's current version for explicitly labelled `**Open Questions:**` /
  `**Assumptions:**` blocks and for unambiguous markers (TBD/TODO/"to be
  determined"/"needs a decision" — deliberately NOT "missing"/"unresolved",
  which are ordinary words in designed behavior). The generic markdown pass
  treats **data as data, never prose**: fenced code blocks are skipped
  outright (the Implementation Plan embeds JSON task blocks whose
  `"status": "todo",` lines otherwise surface as "Marked open" items — the
  live defect that motivated the rule), a fence boundary ends any labelled
  block in progress, and a content that is a whole JSON document (the
  screen-inventory and mockup-spec artifacts) is not scanned at all. Every item carries a locator
  back to its source region, and for user-flow assets that means a `flowId`
  (slugged identically to `UserFlowsRenderer`'s `flowId()`) plus an optional
  `flowStepIndex`. `AssetOpenItemsPanel` renders the list at the foot of the
  Decision Center queue. These items are **recomputed on every read, never
  persisted, and never counted toward the unresolved total**; the only durable
  effect is the user promoting one into a real `PlanningRecord` through the
  existing `flagPlanningConcern` path (`assetOpenItemPlanningSourceKey`, which
  omits the version so a promoted item stays marked after a regeneration). Do
  not re-add an in-asset open-item indicator, and do not auto-create planning
  records from this projection.
- **An unresolved cross-cutting obligation resolves in the Decision Center
  too.** The Implementation Plan's §W5 sections are a contract-level derivation
  (`deriveCrossCuttingObligations`), not the retired open-item heuristic, so
  they *do* keep an in-plan indicator — but a deliberately quiet one: a compact
  flag whose single action routes the obligation out to the Decision Center (see
  "Severity is expressed once" in UI_PATTERNS.md for the presentation rules).
  The route is the ordinary flag→plan path, not a new concept:
  `flagCrossCuttingObligationConcern` (`src/lib/planning/flagToPlan.ts`) builds
  a `FlagPlanningConcernInput` from the derived status and hands it to the
  store's `flagPlanningConcern`, which creates the usual `createdBy: 'user'`
  `open_question` record. Three fixed properties:
  - the **source key omits the plan version**
    (`cross-cutting-obligation:<artifactId>:<key>`), so regenerating the plan
    does not split one open question into two;
  - the record **title matches §W6's blocker title** for the same obligation
    (`"<label> not discharged"`) so the blocker and the record read as one item,
    and the statement carries the derived reason plus every named gap
    untruncated;
  - materiality is **`'normal'`, never `'blocking'`**. §W6 is the single
    authority on this obligation's severity; a one-click flag must not mint a
    second, independent `'blocking'` severity for the same fact.

  Nothing is created by rendering the plan — the write happens only in the
  click handler, and the action is offered only when the capability policy
  allows persistence.
- **`PlanningArtifactRegionTarget.planId`/`itemId` are optional.** They are
  present only when a region came from a downstream update plan; a plan-less
  locator (an asset open item pointing at a flow) supplies just the label and
  the region keys. They travel together or not at all, and
  `ArtifactWorkspace`'s region banner hides its "Return to update plan" action
  when there is no plan.
- **Open decisions never block anything.** The Decision Center's "Continue to
  Build" action (`onContinueToBuild`, threaded from `ProjectWorkspace`) goes
  straight to the Build stage, and output generation starts without a
  pre-generation interstitial. Do not re-introduce a decision-count or
  readiness gate on Challenge, `workspace`, or artifact generation
  (`artifactGenerationGate.ts` stays safety/PRD-only: safe, latest,
  structured, and acknowledged-if-incomplete).
- **No planning record is a hard stop.** The materiality gate
  (`deriveMaterialityGateSnapshot`, which made explicit `materiality:
  'blocking'` records hard stops on Finalize, build-bundle export, and task
  export) was removed with the Finalize layer. `materiality` still ranks
  records (materiality-first); it never gates.
- **Planning navigation intents apply exactly once.** The `planning` URL
  param is applied to the presentation by `ProjectWorkspace`'s intent effect,
  which tracks the last-applied serialized intent **plus its validated
  destination** — later store updates (planning records, review runs, update
  plans) must never re-run a stale destination and yank the user back to a
  stage they navigated away from, while a deep link whose target loads late
  (initially validated down to the PRD fallback) still re-applies once the
  target exists. Do not remove that guard. Every jump that starts from the Plan stage
  (the state bar, PRD decision surfaces) carries a
  `returnTo: { kind: 'prd' }` target so the Decision Center can close back to
  the exact originating surface, and it offers the next unresolved item
  immediately after an answer is recorded. (The `readiness` destination kind
  was removed with the readiness review modal; a legacy URL carrying one no
  longer parses and is ignored.)
- Decision impact previews are bound to a PRD version and deterministic content
  hash (`decisionImpact.ts`). The first implementation safely patches imported
  PRD assumptions. Source-less or ambiguous records require a later
  model-assisted preview and cannot silently mutate the plan.
- `compareAndAppendStructuredPRD` is the authoritative version-bound write
  barrier. It verifies the latest spine, optional PRD hash, and current decision
  event inside one Zustand transaction; then appends the PRD version, rebuilt
  canonical spine, history, and `applied_to_plan` event atomically (and
  re-points open branches to the new version — see `branchSlice` in
  STATE_AND_AUTH.md). A stale preview writes nothing. It also refuses
  (`stale`, `reason: 'generation_running'`) while the latest spine's PRD run is
  still in flight (`generationPhase === 'running'`): the pipeline keeps
  rewriting that spine in place, and the hash check alone misses an apply made
  when no partial lands between preview and apply — e.g. during the final
  consistency-review pass — which would fork the run. Existing artifacts are
  never regenerated by this action; the normal freshness engine makes the
  consequences visible (an output whose input fingerprint the applied change
  moves reads `prd_changed`; a legacy output, any new spine version).
- Section retry preserves assumption verdicts and feature confirmations by
  stable id, then uses the same compare-and-append barrier **with an explicit
  `expectedPrdHash`** (`planningContentHash` of the snapshot the retry was
  built from — `ProjectWorkspace.handleRetrySection`). The id check alone is
  insufficient because consecutive decision edits amend the latest spine IN
  PLACE under the same id; without the hash, a decision confirmed during the
  10–40s retry call would be silently reverted by the appended PRD. Any new
  barrier call site whose input was built from a PRD snapshot must pass the
  hash too.
- Planning records already travel inside project bundles, server sync,
  recovery exports, and snapshots. Keep review/planning collections in
  `userScope.MERGEABLE_COLLECTIONS`, demo cleanup, and the explicit
  `PERSISTENT_STORE_ACTIONS` write guard.
- **Retention:** the machine-generated run history (review runs and their
  specialist runs/findings/issues, downstream update plans and their
  proposal/application/verification chains) is capped at write time through
  `src/lib/collectionRetention.ts`; the legacy readiness reviews (nothing
  appends them any more) are capped only by the rehydrate sweep (see the
  "Retention caps" section in STATE_AND_AUTH.md for limits and the
  cascade/protection rules). **`planningRecords` and the legacy
  `readinessCommitmentEvents` are exempt** — they are append-only user
  authority and are never pruned; do not add a cap to them, and never let a
  retention pass touch `DecisionEvent[]` or assumption-validation events. Runs
  with open/deferred issues, readiness reviews a legacy commitment event
  references, and the current substantive challenge are protected from
  pruning.

### Derived requirement & criterion identity (read-side, advisory)

`src/lib/requirementIdentity.ts` (pure, unit-tested) is the identity substrate
from docs/ARTIFACT_READINESS_RESOLUTION_PLAN.md §W1: stable ids for
requirements and acceptance criteria so coverage/traceability can key off
identity instead of label-matching heuristics.

- `RequirementId` **is** the existing `Feature.id` — reused, never a parallel
  id scheme.
- `CriterionId` = `` `${featureId}.AC.${hash8(normalize(text))}` `` — derived
  from the criterion's **normalized text**, never its array position.
  Reordering a feature's criteria changes no id; rewording one criterion
  changes exactly that one id (deliberate — a reworded criterion is a
  different criterion, and the id delta is the drift signal).
- `buildRequirementIndex` indexes a structured PRD's features across all five
  criterion lists the PRD markdown renders as acceptance-criteria groups
  (`acceptanceCriteria`, plus premium `successCriteria` / `edgeCases` /
  `failureModes` / `uiAcceptanceCriteria`).
  `resolveCriterionRefs(text, index)` maps criterion prose quoted in screen
  contracts, implementation tasks, and plan Definition-of-Done lines back to
  canonical ids with an honest confidence label:
  `exact | normalized | fuzzy | unmatched`. The fuzzy tier is deliberately
  conservative (token-overlap thresholds documented in the module);
  `unmatched` is a **first-class reported state** — "not traced to a PRD
  criterion" — never silently dropped and never auto-rewritten to force a
  match.
- **Derived, never persisted** (cross-cutting rule 10): ids are recomputed on
  read as a pure function of PRD content — no new collection, no
  `ALL_PROJECT_COLLECTIONS` / snapshot / sync wiring — so legacy projects
  gain traceability with no migration. The layer is advisory: nothing gates
  rendering or generation on it. Consumers land in the later plan
  workstreams (W3 API-contract `requirementIds`, W6 build-packet coverage,
  W7 Final Review). Per-criterion *lifecycle* state (approved/superseded,
  with owner) is explicitly deferred — that would be persisted state and is
  out of this layer's scope (see the plan's §6).

### Two readiness evaluators: reasoning vs. packet (never conflate them)

There are **two** readiness evaluators, answering **two different questions**.
Both are **advisory** — neither gates generation, export, task conversion, or
prompt copying. They are independently reportable, and the copy at every
surface must keep them apart (docs/ARTIFACT_READINESS_RESOLUTION_PLAN.md §W6 —
the audit's central finding was a truth-in-signalling defect, where the
reasoning projection was presented as build readiness):

| Evaluator | Question | Reads |
|---|---|---|
| `derivePlanningReadiness` (`planningReadiness.ts`) | *is the product **reasoning** sound?* | PRD foundation, scope, decisions, challenge, alignment |
| `deriveBuildPacketReadiness` (`buildPacketReadiness.ts`) | *is the implementation **packet** complete and current?* | artifact slots, freshness, validation, coverage, API contracts, obligations, plan shape |

- **Do not widen `derivePlanningReadiness`** to cover artifacts, and do not add
  an `isReadyToBuild`-style field to the packet evaluator — it deliberately
  exports `isPacketComplete` so the two can never be swapped by autocomplete.
- **Seven packet checks** (`BUILD_PACKET_CRITERION_ORDER`), each with
  evidence and a navigable action target (an artifact slot, optionally narrowed
  to its `api_contract` / `coverage` / `first_milestone` sub-surface, or a PRD
  feature): required outputs exist and are non-errored · no required source
  stale **or** missing · zero unresolved blocking validation issues · every
  in-scope requirement maps to a task and a verification criterion · every
  endpoint reachable from the first slice has a complete contract · the
  conditional security/privacy obligation is discharged · the first milestone
  is an executable slice with no unresolved dependency. An unresolved
  **measurement** obligation is a warning owned by the user, not an open check
  (the generator is not reliably prompted to produce it). "Blocker" in the code
  means an unmet check with a navigable fix — never a lock.
- **There is no commitment criterion.** `reasoning_committed`, its commitment
  evidence, the rationale/accepted-risk logic, and the `readiness_commitment`
  action target were removed with the Finalize layer. The packet evaluator
  never reads the planning projection or any commitment record.
- **Sources are consumed, never re-derived.** Staleness comes from the one
  freshness engine (`evaluateProjectFreshness` / `useProjectFreshness`, rule 9)
  and is read through **both `status` and `impactedBy`** — a MISSING or ERRORED
  dependency leaves the dependent `up_to_date` and shows up only in
  `impactedBy`. Validation state comes from
  `readArtifactValidationDisposition`; endpoint completeness from
  `apiContractCompleteness`; obligations from `crossCuttingObligations`;
  requirement/criterion identity from `requirementIdentity`; the plan shape from
  the consolidated-plan adapter.
- **In-scope requirement** = `tier === 'mvp'` **or** `priority === 'must'`, with
  a feature declaring **neither** field counted in scope, and the same
  empty-set fallback `derivePlanningReadiness`'s `scopeCandidates` applies (no
  match → every feature is in scope), so the packet check and the planning
  scope criterion never disagree and "no in-scope requirement" can never become a
  vacuous pass. `should` / `could` / `v1` / `later` coverage is reported as a
  **non-blocking warning**.
- **Approval is an optional sign-off, not authority.** "Approve build packet"
  (`buildPacketApproval.ts`) pins the current artifact versions as a
  versioned overlay on the plan version (written through
  `updateArtifactOverlay`, rule 12) and records any still-open check ids it
  was approved with (`acknowledgedOpenCheckIds`); afterwards the Final Review
  reports "changed since approval" when an output moves. It is never required —
  approving with open checks is allowed, and nothing waits on an approval.
- **Warnings are earned.** A non-blocking warning is permitted only when
  `owner`, `impact`, and `rationale` are all recorded (the type requires all
  three); anything that cannot state them is a blocker. There is **no composite
  score** (rule 13) and nothing auto-rewrites an artifact.
- **Derived, never persisted** (rule 10) and **advisory**: the evaluator
  reports; nothing — rendering, generation, export, task conversion, prompt
  copying — gates on it.
  `src/hooks/useBuildPacketInputs.ts` assembles the store-derived half of its
  input (slot states, freshness, resolved data model/endpoints, consolidated
  plan) and is the only React binding — it resolves the Data Model through the
  same `resolveDataModelForTrace` the advisory obligations card uses, so the
  checklist and that card can never disagree about which obligations are owed.
- **A check must never be stricter than the generator** (plan §7). Every
  criterion ships with a test proving a freshly generated, well-formed
  project satisfies it (`buildPacketReadiness.test.ts`). Anything the generator
  is not prompted to produce — verbatim PRD-criterion restatements in the plan,
  a vertical (UI + data) first milestone, supplementary endpoint fields — is a
  warning, not a blocker.

Consumers today: `derivePlanningReadiness` feeds the one-line
`PlanningStateBar` and the Decide badge (`openItems`) — its criteria are no
longer shown on the Plan page. `deriveBuildPacketReadiness` feeds only the
Implementation Plan's **Final Review** card (§W7, see WORKSPACE_AND_ARTIFACTS.md):
an advisory checklist with "estimated" labels and a navigable fix per open
check (`ProjectWorkspace` evaluates the packet once and passes it down). The
header outputs CTA's label states the action only ("Generate outputs" /
"Review outputs" / "Building outputs…"); once outputs exist its hover copy adds
the packet state, labelled estimated and advisory. Neither evaluator changes
what the CTA does.

The full normalized Planning Knowledge Graph is deliberately future work; see
`docs/DECISION_CENTER_DESIGN.md`. Do not introduce composite planning-confidence
scores, automatic artifact rewriting, or model-authored user verdicts.
