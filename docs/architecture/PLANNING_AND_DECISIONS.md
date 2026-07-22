# Uncertainty-First Planning, Adversarial Review & the Decision Center

> Extracted from CLAUDE.md. The planning decision domain (PlanningRecord/DecisionEvent), readiness projection, assumption import/validation, decision impact + the compare-and-append write barrier, and the adversarial review engine. Design docs: docs/DECISION_CENTER_DESIGN.md, docs/ADVERSARIAL_PLANNING_REVIEW.md, docs/UNCERTAINTY_FIRST_PLANNING.md, docs/DECISION_CENTER_SIMPLIFICATION_PLAN.md.

### Uncertainty-first planning, adversarial review, and Decision Center

The workspace progression is **Plan → Challenge → Build → History**. The
Challenge stage is reachable as soon as a safe structured working PRD exists and
always exposes the Decision Center and review history. Its sub-tabs are ordered
**Decision Center → Findings → History** — decisions first, critique second.
The specialist critique (the Findings tab) is **optional and gated**: its start
surface (`ReviewSetup`) is replaced by a "resolve your open decisions first"
prompt (`CritiqueGate`) until every surfaced decision is addressed — answered
**or** deferred/skipped. The gate keys off `PlanningReadiness.openDecisionCount`
(open/proposed records of type decision/open_question/conflict/assumption; risks
are advisory and excluded); deferring or answering clears it, and the gate's
"defer the remaining decisions and continue" action is the escape hatch for an
unsure user. Only *running/continuing* the critique is gated: starting a new run,
resuming an interrupted/failed run, and retrying coverage are all suppressed
while decisions are open (a live in-flight run keeps showing progress). The
Decision Center, history, and any already-completed run stay visible even if a
later decision reopens the gate — findings remain viewable and triageable.
A completed critique's findings still promote into new planning records. When
open decisions remain, entering Challenge lands on the Decision Center tab.
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
  PRD exists; visiting Challenge is not a prerequisite for planning state.
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
- **Open decisions never block Explore/Build.** Only the specialist critique
  is gated (`CritiqueGate`). The Decision Center header and the critique gate
  both surface a "Continue to Explore" action (`onContinueToExplore`, threaded
  from `ProjectWorkspace`), and the advisory `PreBuildCheckModal`
  (`src/components/planning/PreBuildCheckModal.tsx`) moves the remaining
  open-question prompt to the start of output generation — offered once per
  workspace session by `handleGenerateAssets`, listing open
  decision/question/conflict/assumption records with "Review decisions first"
  vs "Generate anyway"; generating always proceeds. Do not re-introduce a
  decision-count or readiness gate on the `workspace` stage or on artifact
  generation (`artifactGenerationGate.ts` stays safety/PRD-only).
- **Planning navigation intents apply exactly once.** The `planning` URL
  param is applied to the presentation by `ProjectWorkspace`'s intent effect,
  which tracks the last-applied serialized intent **plus its validated
  destination** — later store updates (planning records, review runs, update
  plans) must never re-run a stale destination and yank the user back to a
  stage they navigated away from, while a deep link whose target loads late
  (initially validated down to the PRD fallback) still re-applies once the
  target exists. Do not remove that guard. Every jump that starts from the Plan stage
  (state bar, attention items, PRD decision surfaces) carries a
  `returnTo: { kind: 'prd' }` target so a persistent "Back to Plan" banner is
  available in Challenge, and the Decision Center offers the next unresolved
  item immediately after an answer is recorded.
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
  stable id, then uses the same compare-and-append barrier so a slow model call
  cannot overwrite an intervening user decision.
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
