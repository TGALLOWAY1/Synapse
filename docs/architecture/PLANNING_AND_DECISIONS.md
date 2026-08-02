# Uncertainty-First Planning, Adversarial Review & the Decision Center

> Extracted from CLAUDE.md. The planning decision domain (PlanningRecord/DecisionEvent), readiness projection, assumption import/validation, decision impact + the compare-and-append write barrier, and the adversarial review engine. Design docs: docs/DECISION_CENTER_DESIGN.md, docs/ADVERSARIAL_PLANNING_REVIEW.md, docs/UNCERTAINTY_FIRST_PLANNING.md, docs/DECISION_CENTER_SIMPLIFICATION_PLAN.md. Open remediation program for change-management coherence (dependency coverage, approved baselines/change sets, region-level restore): docs/CHANGE_MANAGEMENT_REMEDIATION_PLAN.md — read it before extending downstream update plans, output alignment, or restore semantics.

### Uncertainty-first planning, adversarial review, and Decision Center

The user-facing workspace progression is **Define → Refine → Finalize →
Generate → Review → Build**. This is a presentation projection over the
existing persisted stage keys: Plan and Challenge both belong to Refine,
Finalize is the readiness checkpoint, and project history opens as a panel.
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
A completed critique's findings still promote into new planning records. When
open decisions remain, the global attention action opens the exact Decision
Center record without changing the underlying stage.
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
- `PlanningStateBar` is the compact Plan-stage reasoning header. It exposes the
  current readiness category, supporting criteria, and the three planning tools
  as an always-visible, ordered set — Decision Center (settle open choices /
  confirm scope) → Challenge this plan (stress-test once coherent) → Review
  readiness (final check before build) — each carrying a plain-language
  "when to use" cue so the order of operations is legible rather than three
  equal buried links. The unconfirmed `scope` criterion links directly to the
  Features view (`onOpenFeatures` → `?prdView=features`); the 7-criterion
  breakdown stays behind a collapsed "Readiness checks" disclosure.
- The Plan-stage `PlanningStateBar` owns next-action guidance; there is no
  separate workspace-wide strip. (A `GlobalNextActionStrip` previously echoed
  the top ranked attention item below the stage rail, but it duplicated what
  `PlanningStateBar` already surfaces through its ordered tool cards and
  readiness checks, so it was removed.) `derivePlanningAttention` still ranks
  one primary and a small secondary set — every item carries an exact
  destination plus return target — but it now feeds only the internal
  `PreBuildCheckpointCard` gate (`preBuildAttentionItem`) and
  `dispatchPlanningAttentionItem`, not a persistent banner. Do not re-add a
  standalone aggregate open-item counter surface.
  - **Presentation is invitation-first, never default-alarm**
    (`planningOverviewPresentation.ts`, pure). Every fresh PRD lands in
    `needs_decisions` (imported assumptions open + scope unconfirmed), so that
    phase alone renders as a **calm** "Your draft is ready" card; the amber
    caution treatment is reserved for genuine regressions (`conflictCount > 0`
    or changed sources). This is presentation only — readiness authority,
    phases, and persisted enums are untouched. Do not re-add amber as the
    default first-run state, problem-counter stat tiles, or a
    "no news" downstream tile (the Downstream alignment tile renders only when
    the alignment criterion has a real signal).
  - **The guided sharpen flow** (`SharpenPlanFlow.tsx` +
    `deriveAnswerableAssumptionRecords` in `planningAttention.ts`) is the calm
    card's dominant action when open material assumptions exist: one
    plain-language question per assumption ("Synapse assumed … Does this match
    your reality?") with Sounds right / Not quite — correct it / Not sure yet
    chips. Verdicts flow through `useDecisionImpactActions.handleDecisionAction`
    — the exact append-only, user-only DecisionEvent path the Decision Center
    uses (confirm = statement as recorded answer, correction = premise_rejected,
    Not sure = deferred). No new persisted state; the queue is frozen at open so
    answering never reshuffles remaining questions. Elicitation vocabulary rule:
    on the Plan overview, never use "validate", "unresolved", "assumption", or
    "downstream alignment" in primary text — that vocabulary stays inside the
    Decision Center, where the attention item's action label is now "Answer
    this question".
- PRD assumptions are imported idempotently as soon as the latest structured
  PRD exists; visiting Challenge is not a prerequisite for planning state. The
  exact ids imported for a new spine drive a session-only arrival card on the
  Plan surface: **Accept defaults / Review each / Later**. Accept/Later expands
  to one guarded, append-only user `DecisionEvent` per record; there is no
  aggregate authority event and no persisted card state.
- Generated assumptions distinguish **confidence** (plausibility) from
  **materiality** (consequence if wrong) and may identify affected PRD
  sections. Ranking is materiality-first.
- `isFinal` now reads as a committed plan version, not proof that every output
  exists. Commitment and `artifactJobController.startAll` are separate user
  actions. Before commitment, Build is available as an explicitly exploratory
  surface and must never imply implementation readiness.
- A commitment binds to the reviewed spine, not to the readiness snapshot:
  post-commit Build activity (outputs, alignment, challenge, or planning-state
  drift) makes the readiness review historical without revoking the
  commitment. Commitment display goes through
  `commitmentRemainsCurrent(currentness)` (`readinessReview.ts`) — only an
  integrity failure or a changed reviewed spine (identity/content) ends the
  committed state; never re-add a raw `currentness.current` check for
  commitment UI. Closing a finding as dismissed/already-addressed requires a
  rationale of `MIN_CLOSURE_REASON_LENGTH` characters — entry surfaces must
  enforce the same floor the readiness predicate checks.

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
    authority on this obligation's severity; a `'blocking'` record would also
    arm the Finalize materiality hard stop off a one-click UI action, giving one
    fact two independent gates.

  Nothing is created by rendering the plan — the write happens only in the
  click handler, and the action is offered only when the capability policy
  allows persistence.
- **`PlanningArtifactRegionTarget.planId`/`itemId` are optional.** They are
  present only when a region came from a downstream update plan; a plan-less
  locator (an asset open item pointing at a flow) supplies just the label and
  the region keys. They travel together or not at all, and
  `ArtifactWorkspace`'s region banner hides its "Return to update plan" action
  when there is no plan.
- **Ordinary open decisions never block Refine, Generate, or Review.** The Decision
  Center keeps its "Continue to Explore" action (`onContinueToExplore`, threaded
  from `ProjectWorkspace`). At output generation, one inline
  `PreBuildCheckpointCard` appears below the stage rail at most once per
  workspace session, naming the highest-ranked exact planning record and
  offering Review first / Generate outputs / Not now. It is advisory and never
  replaces the safety, structured-PRD, incomplete-PRD, or design-preset gates.
  Do not re-introduce a decision-count or readiness gate on Challenge,
  `workspace`, or artifact generation (`artifactGenerationGate.ts` stays
  safety/PRD-only).
- **Only explicit `materiality: 'blocking'` records are decision-driven hard
  stops.** `deriveMaterialityGateSnapshot` follows authoritative verdicts and
  supersession, binds the exact sorted blocker fingerprints to the current
  spine, and ignores high/normal/low or missing materiality. Finalize may record
  a v2 append-only acceptance for that exact snapshot with a meaningful
  rationale. Build bundle export and external task export require the same
  current acceptance; resolving or changing a blocker invalidates the old
  snapshot. Advisory concerns remain visible but never acquire hard-stop
  authority. Valid current v1 commitments remain readable under the stricter
  policy that originally authorized them.
- **Planning navigation intents apply exactly once.** The `planning` URL
  param is applied to the presentation by `ProjectWorkspace`'s intent effect,
  which tracks the last-applied serialized intent **plus its validated
  destination** — later store updates (planning records, review runs, update
  plans) must never re-run a stale destination and yank the user back to a
  stage they navigated away from, while a deep link whose target loads late
  (initially validated down to the PRD fallback) still re-applies once the
  target exists. Do not remove that guard. Every jump that starts from the Plan stage
  (state bar, attention items, PRD decision surfaces) carries a
  `returnTo: { kind: 'prd' }` target so the Decision Center can close back to
  the exact originating surface, and it offers the next unresolved item
  immediately after an answer is recorded.
- Decision impact previews are bound to a PRD version and deterministic content
  hash (`decisionImpact.ts`). The first implementation safely patches imported
  PRD assumptions. Source-less or ambiguous records require a later
  model-assisted preview and cannot silently mutate the plan.
- `compareAndAppendStructuredPRD` is the authoritative version-bound write
  barrier. It verifies the latest spine, optional PRD hash, and current decision
  event inside one Zustand transaction; then appends the PRD version, rebuilt
  canonical spine, history, and `applied_to_plan` event atomically. A stale
  preview writes nothing. Existing artifacts are never regenerated by this
  action; normal source-ref staleness makes consequences visible.
- Section retry preserves assumption verdicts and feature confirmations by
  stable id, then uses the same compare-and-append barrier **with an explicit
  `expectedPrdHash`** (`planningContentHash` of the snapshot the retry was
  built from — `ProjectWorkspace.handleRetrySection`). The id check alone is
  insufficient because consecutive decision edits amend the latest spine IN
  PLACE under the same id; without the hash, a decision confirmed during the
  10–40s retry call would be silently reverted by the appended PRD. Any new
  barrier call site whose input was built from a PRD snapshot must pass the
  hash too.
- Readiness snapshot/current-signature hashes are derived from **durable state
  only**: `buildReadinessReviewInputFromState` deliberately omits the live job
  from its output-alignment derivation, because folding transient slot
  statuses in made each concurrently-settling artifact slot change the hash —
  a checkpoint created mid-generation was always rejected `'stale'` at commit.
  Don't re-add the live job to that input.
- Planning records already travel inside project bundles, server sync,
  recovery exports, and snapshots. Keep review/planning collections in
  `userScope.MERGEABLE_COLLECTIONS`, demo cleanup, and the explicit
  `PERSISTENT_STORE_ACTIONS` write guard.
- **Retention:** the machine-generated run/checkpoint history (review runs and
  their specialist runs/findings/issues, readiness reviews, downstream update
  plans and their proposal/application/verification chains) is capped at write
  time through `src/lib/collectionRetention.ts` (see the "Retention caps"
  section in STATE_AND_AUTH.md for limits and the cascade/protection rules).
  **`planningRecords` and `readinessCommitmentEvents` are exempt** — they are
  the append-only user-authority aggregates and are never pruned; do not add a
  cap to them, and never let a retention pass touch `DecisionEvent[]` or
  assumption-validation events. Runs with open/deferred issues, commitment-
  referenced readiness reviews, and the current substantive challenge are
  protected from pruning so nothing readiness/commitment currently relies on
  disappears.

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
They are independently reportable, and the copy at every surface must keep them
apart (docs/ARTIFACT_READINESS_RESOLUTION_PLAN.md §W6 — the audit's central
finding was a truth-in-signalling defect, where the reasoning projection was
presented as build readiness):

| Evaluator | Question | Reads |
|---|---|---|
| `derivePlanningReadiness` (`planningReadiness.ts`) | *is the product **reasoning** sound?* | PRD foundation, scope, decisions, challenge, alignment |
| `deriveBuildPacketReadiness` (`buildPacketReadiness.ts`) | *is the implementation **packet** complete and current?* | artifact slots, freshness, validation, coverage, API contracts, plan shape, the committed checkpoint |

- **Do not widen `derivePlanningReadiness`** to cover artifacts, and do not add
  an `isReadyToBuild`-style field to the packet evaluator — it deliberately
  exports `isPacketComplete` so the two can never be swapped by autocomplete.
- **Eight blocking criteria** (`BUILD_PACKET_CRITERION_ORDER`), each with
  evidence and a navigable action target: required outputs exist and are
  non-errored · no required source stale **or** missing · zero unresolved
  blocking validation issues · every in-scope requirement maps to a task and a
  verification criterion · every endpoint reachable from the first slice has a
  complete contract · conditional security/privacy + measurement obligations
  discharged · the first milestone is an executable slice with no unresolved
  dependency · the product reasoning is **committed**.
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
  match → every feature is in scope), so the gate and the planning scope
  criterion never disagree and "no in-scope requirement" can never become a
  vacuous pass. `should` / `could` / `v1` / `later` coverage is reported as a
  **non-blocking warning**.
- **Approval authority is the committed checkpoint, not the projection.** The
  committed criterion requires a **current committed `ReadinessReview`** — the
  caller's `commitmentRemainsCurrent(...)` + `activeCommit` filter
  (`currentCommittedReadiness` in `ProjectWorkspace`). It **fails closed** on
  `isCommitmentUnverifiable`, on a commitment bound to a different spine
  version, and on a `not_ready` commitment with no recorded rationale.
  `planningReadiness.isReadyToBuild` is passed in **only** so the blocker copy
  can say whether a commit action is currently on offer — it can never satisfy
  the criterion. A `not_ready` commitment **with** the authorizing event's
  rationale is reported as an accepted-risk warning.
- **Warnings are earned.** A non-blocking warning is permitted only when
  `owner`, `impact`, and `rationale` are all recorded (the type requires all
  three); anything that cannot state them is a blocker. There is **no composite
  score** (rule 13) and nothing auto-rewrites an artifact.
- **Derived, never persisted** (rule 10) and **advisory transport**: the
  evaluator reports; it never blocks rendering or generation on its own.
  `src/hooks/useBuildPacketInputs.ts` assembles the store-derived half of its
  input (slot states, freshness, resolved data model/endpoints, consolidated
  plan) and is the only React binding — it resolves the Data Model through the
  same `resolveDataModelForTrace` the advisory obligations card uses, so the
  gate and that card can never disagree about which obligations are owed.
- **The gate must never be stricter than the generator** (plan §7). Every
  blocking criterion ships with a test proving a freshly generated, well-formed
  project satisfies it (`buildPacketReadiness.test.ts`). Anything the generator
  is not prompted to produce — verbatim PRD-criterion restatements in the plan,
  a vertical (UI + data) first milestone, supplementary endpoint fields — is a
  warning, not a blocker.

Consumers today: `ProjectWorkspace` (the outputs CTA no longer claims build
readiness from the reasoning projection; its label reads off the recorded
commitment) and `PlanningStateBar` (an "Implementation packet" block with its
own "Packet checks" disclosure, beside the "Product-reasoning checks" one). The
single-CTA Final Review surface is plan §W7 and is not built yet.

The full normalized Planning Knowledge Graph is deliberately future work; see
`docs/DECISION_CENTER_DESIGN.md`. Do not introduce composite planning-confidence
scores, automatic artifact rewriting, or model-authored user verdicts.
