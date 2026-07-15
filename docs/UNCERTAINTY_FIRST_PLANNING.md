# Uncertainty-first planning

## Product position

Synapse is a planning system, not an artifact factory. Its primary progress
measure is the reduction of consequential uncertainty: whether the team
understands the problem, user, outcome, intended scope, key behavior, risks,
and downstream consequences well enough to build deliberately.

The core loop is:

> Propose → expose uncertainty → decide → propagate → challenge → commit

A generated PRD is a working interpretation. It becomes a trusted plan as its
material assumptions and questions are resolved, challenged, and kept aligned
with downstream work.

## Experience model

The workspace progression is `Plan → Challenge → Build → History`.

- **Plan** combines the current PRD with the active reasoning state. A compact
  working-plan header states the project's readiness category, the most
  valuable next action, and the reasons behind it.
- **Challenge** contains adversarial review and the full Decision Center. PRD
  entry points open the same durable planning records; there is no separate
  approval system.
- **Build** contains downstream artifacts. Before commitment these are
  exploratory outputs, not evidence that the project is implementation-ready.
- **History** preserves how both the specification and its reasoning changed.

Readiness is categorical and reasoned, never a percentage:

- Exploring
- Needs key decisions
- Ready to challenge
- Needs alignment
- Ready to build

The projection considers foundational clarity, unresolved material decisions,
conflicts, source drift, challenge freshness, incomplete PRD sections, and
downstream alignment. It does not reward artifact count.

## Commitment

"Mark Final" becomes **Review readiness** / **Commit plan**. Commitment is a
version-bound statement that the current working plan is the intended basis
for implementation. If material uncertainty remains, Synapse explains it and
requires an explicit choice to keep shaping or commit the working plan anyway.
Low-impact uncertainty does not block exploration.

Committing and generating assets are distinct actions. Generating an early
concept remains allowed, but the UI must call it exploratory when readiness has
not been established.

## Model direction

`PlanningRecord` remains the shared durable aggregate. Generated assumptions,
preflight unknowns, review findings, and consequential questions converge there.
PRD-local assumption fields remain compatibility projections; inline assumption
actions now append to the durable event history as well as versioning the PRD.
Feature confirmation remains PRD-local for compatibility and is the next model
convergence target.

Planning records may progressively add:

- materiality (`blocking`, `high`, `normal`, `low`)
- resolution horizon
- affected PRD locations and feature ids
- evidence and validation state

These fields support ranking and contextual disclosure. They must never allow
model-authored reasoning to appear user-confirmed.

## Current release boundary

The foundation release introduced the readiness projection, working-plan
guidance, progression reframe, direct Decision Center entry, contextual PRD
uncertainty, immediate preflight/PRD signal import, materiality, durable inline
assumption verdicts, exploratory-output framing, and an explicit commitment
checkpoint.

The first refinement phase closes the gap between deciding and propagating:

- a consequential verdict immediately creates a version-bound plan-alignment
  review;
- affected context can point to a claim, feature, requirement, behavior, scope
  choice, flow step, constraint, success criterion, or data/API expectation;
- proposed changes are reviewed individually and can be accepted, edited,
  rejected, or deferred without changing the underlying verdict;
- accepted changes are applied through the guarded PRD-version boundary and
  never overwrite a newer working plan;
- direct PRD edits are classified as copy-only, explicit structured meaning
  changes, or bounded Synapse inferences, with different authority semantics;
- downstream outputs distinguish aligned, possibly affected, and definitely
  stale states, including why and what to review next;
- unresolved plan propagation and consequential downstream alignment prevent a
  project from appearing ready to build.

The phase remains deliberately non-destructive. It does not silently rewrite
confirmed prose, auto-regenerate artifacts, add a readiness score, or turn the
planning flow into a wizard.

The second refinement phase adds bounded reasoning for complex review targets:

- a broad relevance signal (for example, a user-flow or data-model collection)
  is expanded into locally enumerated scalar leaves before the model sees it;
- the model must choose one supplied leaf, quote its exact current value, cite
  the user verdict and target evidence, and either propose one same-type
  replacement or explain why more information is needed;
- ids, reference fields, user-confirmation fields, timestamps, and other
  authority-bearing leaves are never offered as candidate targets;
- every applicable proposal is rebound locally to the plan version, verdict,
  target value, preserved surrounding content, evidence hashes, model, and
  provider before it enters the existing per-change review;
- the user's review event records a canonical hash of the exact proposal shown,
  so changing a proposal and its patch together cannot reuse an earlier
  acceptance;
- users may request an initial interpretation, provide missing context, or ask
  for a different interpretation; that context is preserved as user-authored
  evidence but never treated as a verdict, and the result remains pending until
  they separately accept or edit it;
- model conclusions distinguish impact relevance, reasoning confidence, and
  whether evidence is direct, a supported inference, or merely plausible;
  plausible inference can identify a review target but cannot become an
  applicable plan change;
- already-aligned and not-applicable conclusions remain explicit review states
  with their own hash-bound user confirmations, rather than being collapsed
  into a rejection or a generated change; if the analysis changes, confirmation
  returns to pending;
- rejected, malformed, stale, redirected, overbroad, multi-leaf, or failed
  analysis leaves the original Phase 1 review target intact.

This remains a replace-only capability for existing scalar leaves. Adding or
removing structured items, creating missing optional fields, changing identity
or reference keys, and rewriting architecture prose across multiple claims stay
review-only. Those limits are intentional: relevance and fluent wording are not
permission to mutate the plan.

## Phase 3: version-pinned build-readiness review

Build readiness now has two complementary layers. The live categorical
projection continues to tell the user what planning action matters next. When
the user chooses **Review readiness**, Synapse records a durable checkpoint for
the exact plan and planning state being assessed.

Each checkpoint is bound to the PRD version and content, planning records,
challenge context and findings, propagation state, downstream-output state,
readiness schema, and criteria version. Its conclusion is derived from those
durable sources; model narrative is not evidence and cannot confer authority.
Material changes make the checkpoint historical instead of silently reusing
its conclusion.

A completed challenge supports readiness only when it preserves the full
project-specific specialist panel that was recommended when the run started.
Users may deliberately run a narrower exploratory review, but the interface
labels that limitation before execution and preserves the exploratory label,
omitted specialist names, and reason in results and history; the run cannot
satisfy the readiness checkpoint.
For no-finding conclusions, every specialist must return structured coverage
checks grounded in exact source locators; Product & Scope must explicitly cover
the problem, primary user, intended outcome, first-release scope, and material
assumptions. Freeform summaries and automatically assigned source IDs are not
treated as substantive challenge evidence. Coverage citations must use the
structured PRD path family relevant to the claimed area, and readiness
revalidates the locator id, path, excerpt, and excerpt hash against the exact
reviewed PRD instead of trusting a persisted `verified` flag.
Any unsupported finding triggers the same bounded specialist repair before a
run can complete. Legacy or malformed completed runs with incomplete evidence
remain visibly labeled as incomplete in results and history rather than
appearing as readiness-supporting challenge coverage.

Historical checkpoints preserve both the original evidence and a deterministic
comparison with the current readiness projection. The comparison names newly
introduced or resolved concerns, criterion changes, changed evidence support,
and the plan version involved. Large comparisons prioritize the conclusion,
blockers, and criterion state rather than becoming an unbounded diff report.

A favorable checkpoint does not commit the plan. Commitment remains an
append-only user action bound to the exact checkpoint. If the user proceeds
with unresolved material concerns, Synapse requires explicit rationale and,
where needed, a containment plan. That authorization preserves the concern as
accepted uncertainty; it never relabels the issue as resolved or the evidence
as validated.

Commitment events carry a versioned integrity hash over their complete payload
and are validated as an ordered authorization → commitment → reopening chain.
Malformed or pre-integrity Phase 3 events remain historical/unverifiable and
cannot fall back to legacy commitment semantics.

## Future planning intelligence

The next phases should build on the same durable records rather than introducing
new approval systems:

1. **Selective downstream update planning:** extend the current version-bound,
   per-change alignment review into dependency-path evidence and selective
   artifact update plans without silently regenerating or rewriting confirmed
   outputs.
2. **Assumption validation:** let users attach evidence, validation methods, and
   outcomes to material assumptions; distinguish “confirmed by the user” from
   “supported by evidence.” This is explicitly a future task, not inferred from
   today’s confidence label.
3. **Scenario exploration:** compare a small number of consequential alternative
   decisions against scope, risks, and implementation cost while keeping the
   committed plan unchanged.
4. **Adversarial critique:** deepen Challenge with contradiction, necessity,
   feasibility, and missing-case specialists that reference the same decision
   and readiness context.
