# Uncertainty-First Planning, Adversarial Review & the Decision Center

> Extracted from CLAUDE.md. The planning decision domain (PlanningRecord/DecisionEvent), readiness projection, assumption import/validation, decision impact + the compare-and-append write barrier, and the adversarial review engine. Design docs: docs/DECISION_CENTER_DESIGN.md, docs/ADVERSARIAL_PLANNING_REVIEW.md, docs/UNCERTAINTY_FIRST_PLANNING.md, docs/DECISION_CENTER_SIMPLIFICATION_PLAN.md.

### Uncertainty-first planning, adversarial review, and Decision Center

The user-facing workspace progression is **Define → Refine → Finalize →
Generate → Review → Build**. This is a presentation projection over the
existing persisted stage keys: Plan and Challenge both belong to Refine,
Finalize is the readiness checkpoint, and project history opens as a panel.
The **Decision Center is a universal slide-over** that preserves the originating
surface and exact return context; it is also available from the workspace
overflow menu. The Refine review surface contains **Findings → History**.
The specialist critique (the Findings tab) is **optional and never
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
  planning readiness.
- `PlanningStateBar` is the compact Plan-stage reasoning header. It exposes the
  current readiness category, supporting criteria, and one highest-value next
  action with direct entry to decisions or Challenge.
- `GlobalNextActionStrip` is the one workspace-wide aggregate planning-attention
  surface below the stage rail. `derivePlanningAttention` ranks one primary and
  a small secondary set, and every action carries an exact destination plus
  return target. Local surfaces may explain a specific record in context, but
  they must not repeat aggregate open-item totals; the global strip owns that
  count/next-action echo.
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

The full normalized Planning Knowledge Graph is deliberately future work; see
`docs/DECISION_CENTER_DESIGN.md`. Do not introduce composite planning-confidence
scores, automatic artifact rewriting, or model-authored user verdicts.
