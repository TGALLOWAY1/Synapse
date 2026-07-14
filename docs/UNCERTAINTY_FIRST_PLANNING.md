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
planning flow into a wizard. Complex affected locations remain review targets
when Synapse lacks enough structured evidence to propose a safe edit.

## Future planning intelligence

The next phases should build on the same durable records rather than introducing
new approval systems:

1. **Build-readiness review:** turn the current categorical projection into a
   version-pinned review that can explain missing evidence and challenge whether
   an override remains reasonable after the plan changes.
2. **Decision impact analysis:** extend the current version-bound, per-change
   alignment review with stronger semantic proposal generation, dependency-path
   evidence, and selective artifact update plans without silently rewriting
   confirmed outputs.
3. **Assumption validation:** let users attach evidence, validation methods, and
   outcomes to material assumptions; distinguish “confirmed by the user” from
   “supported by evidence.” This is explicitly a future task, not inferred from
   today’s confidence label.
4. **Scenario exploration:** compare a small number of consequential alternative
   decisions against scope, risks, and implementation cost while keeping the
   committed plan unchanged.
5. **Adversarial critique:** deepen Challenge with contradiction, necessity,
   feasibility, and missing-case specialists that reference the same decision
   and readiness context.
