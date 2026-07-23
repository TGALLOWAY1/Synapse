# Tier 1 Workflow Simplification Design

**Date:** 2026-07-22
**Source:** [`docs/audits/WORKFLOW_AUDIT.md`](../../audits/WORKFLOW_AUDIT.md)
**Status:** Approved for implementation
**Scope:** Tier 1 items 1–7 only

## 1. Outcome

Tier 1 makes Synapse easier to resume, correct, and trust without changing the
persisted pipeline-stage model. It introduces one global next action, closes the
Screens-to-plan loop, batches routine assumption and decision verdicts, adds a
rationale-backed escape from overridable artifact validation failures, renders
currently silent warnings, and removes repeated warning echoes.

The current `prd` / `review` / `workspace` / `history` stage keys, project route,
append-only planning authority, safety gate, structured-PRD gate, incomplete-PRD
acknowledgement, version guards, and export availability remain unchanged.

Success means:

- a returning user can see the single most useful next action from any stage;
- a concern discovered in a generated screen can become a planning record
  without losing the exact screen context;
- routine machine recommendations and newly imported assumptions can be handled
  in batches while preserving one user verdict per record;
- an overridable validation false positive can be accepted transparently,
  without erasing the original failed checks or weakening truncation safety;
- generation results and accepted risks are summarized once at the next
  checkpoint; and
- no unresolved concern is presented as repeated raw counts or warning badges
  across more than two surfaces.

## 2. Non-goals

Tier 1 does not:

- introduce the six-step Define → Refine → Finalize → Generate → Review → Build
  rail;
- turn the Decision Center into a global slide-over;
- merge Plan and Challenge;
- implement two-speed Sync outputs, background propagation, or decision
  grouping;
- change readiness to materiality-only blocking;
- add a persisted workflow step or summary collection;
- batch-apply PRD impact proposals; or
- change the underlying stage routes, authority model, or write barriers.

Those remain Tier 2 or Tier 3 work.

## 3. Delivery shape

Implementation is split into four coherent slices.

1. **Orientation and return loop**
   - persistent global next-action strip;
   - exact-screen navigation return target;
   - Screens and artifact-detail “Flag to plan” actions;
   - first echo reductions.
2. **Batch decisions**
   - shared guarded batch-verdict coordinator;
   - Decision Center “Accept all recommendations”;
   - PRD-arrival assumption batch card with Accept defaults / Review each /
     Later.
3. **Validation trust**
   - typed overrideability policy;
   - version-scoped, rationale-backed acceptance;
   - downstream eligibility for accepted versions;
   - immutable display of original failures.
4. **Checkpoints and cleanup**
   - inline pre-generation checkpoint;
   - generation-complete summary;
   - advisory-warning rendering;
   - Finalize-aware export/handoff;
   - echo-budget sweep;
   - removal of unused creation/derivation paths while retaining legacy reads.

Each slice receives its own focused tests and two-stage review before the next
slice starts.

## 4. Shared architecture

### 4.1 Presentation projections stay pure

The global strip and checkpoint summaries derive from current store state. They
do not create planning authority and are not persisted.

`derivePlanningAttention` remains the source for planning next action and
deduplicated attention items. A new checkpoint-summary projection composes:

- planning attention;
- current critique issues/findings;
- current preferred artifact versions and their validation metadata;
- accepted validation dispositions;
- output alignment/freshness; and
- the current trusted readiness commitment, when present.

The projection exposes stable identifiers and destinations so UI components can
link directly to the source. It never stores a duplicate count or conclusion.

### 4.2 Authority stays per record and per version

Batch UI actions are orchestration conveniences, not aggregate authority.

- A five-record batch decision writes five user decision events.
- Deferring six imported assumptions writes six user defer events.
- No batch record or synthetic “accepted all” event is introduced.
- Validation acceptance belongs to one exact artifact version.
- A generated replacement version does not inherit an earlier acceptance.

### 4.3 Navigation is presentation-only

Planning navigation remains URL-serialized and excluded from readiness hashes,
project persistence, provenance, and planning authority.

A first-class screen return target is added to `PlanningDestination`. It carries:

- artifact identity or slot;
- stable screen id;
- selected screen tab, when present; and
- a human-readable label.

Validation accepts only bounded strings and known screen-tab values. If an
artifact, screen, or tab no longer exists, resolution falls back to the nearest
safe readable surface: the artifact, then Screens, then Plan.

Writing a planning intent must preserve the serialized `returnTo` target instead
of deleting the screen context before it has been captured.

### 4.4 Concurrency is fail-safe

Every mutation snapshots the exact durable targets it intends to change and
revalidates them inside the authoritative store action.

- Batch verdicts recheck status and option identity before each write.
- Validation acceptance rechecks the preferred artifact version id and blocker
  set inside one store transaction.
- A stale version or changed recommendation is skipped, never silently applied.
- Partial batch success is reported with succeeded and skipped record ids.
- Demo/read-only capability guards remain authoritative at the store boundary.

## 5. Slice 1 — Orientation and return loop

### 5.1 Persistent global next-action strip

The selected placement is a full-width strip immediately below
`PipelineStageBar` and above stage content.

It renders on every project stage and contains:

- the primary `planningAttention` title;
- its action label;
- one aggregate open-items count;
- calm copy that open items do not block progress; and
- a compact mobile layout with a full-width action.

The strip opens the exact `PlanningDestination` from the attention item. Actions
that currently assume Plan receive a return target based on the active surface.
The Plan-only `PlanningStateBar` is reduced to Plan context, readiness detail,
and the Sharpen flow; it no longer repeats the same primary action or raw count.

The strip is the only global raw count. Contextual source links may remain, but
they do not repeat aggregate counts.

### 5.2 Flag to plan

Screen review notes gain a visible secondary action: **Flag to plan**. Artifact
detail views receive the same action where meaningful.

For an existing screen note:

1. The note text, screen identity, artifact version, and current spine identity
   are captured.
2. Synapse creates one user-owned open planning record.
3. A stable source key prevents a second open record from the same note and
   artifact version.
4. The user remains on the current screen.
5. A confirmation offers **Keep reviewing** and **Review now**.
6. **Review now** opens the record with `returnTo` pointing to the exact screen
   and tab.

For artifact-level concerns without an existing note, a compact form collects a
title and statement before creating the record.

The created record uses existing planning primitives:

- `createdBy: 'user'`;
- explicit source locators and affected artifact slot;
- the current spine/version context;
- materiality chosen conservatively from the source severity, defaulting to
  `normal`; and
- an append-only `created` event.

Read-only and demo projects show no mutation action. Stale sources may still open
the planning record, but the return target falls back safely.

## 6. Slice 2 — Batch decisions

### 6.1 Shared batch-verdict coordinator

A shared coordinator accepts a snapshot of candidate records and one requested
action. It:

1. computes eligibility with pure helpers;
2. disables repeated submission while running;
3. revalidates each record and recommendation;
4. invokes the same single-record authority action used by the existing UI;
5. records separate per-record user events;
6. returns `succeeded`, `skipped`, and `failed` ids with reasons; and
7. starts impact-preview preparation only for successfully answered records.

The coordinator does not promise all-or-nothing atomicity across records. Its UI
reports partial completion explicitly.

### 6.2 Decision Center batch recommendations

**Accept N recommendations** appears only when at least two open records have a
currently valid machine-authored recommended option.

“All” means all currently eligible visible records with valid recommendations,
not every open record. Records without generated options remain open. The
existing eager recommendation cap is not expanded in Tier 1.

The control summarizes the number of records affected. After completion:

- answered records move normally;
- changed or already-answered records remain visible with a skip explanation;
- impact previews continue through existing guarded behavior; and
- no aggregate resolution or combined PRD write is created.

### 6.3 Assumption-arrival batch card

When a PRD generation imports assumptions, `ProjectWorkspace` retains the exact
ids reported as newly imported for that arrival. The card never sweeps
historical open assumptions into the batch.

The card shows:

- imported count;
- materiality summary;
- the two most material assumptions;
- **Accept defaults**;
- **Review each**; and
- **Later**.

**Accept defaults** records a user verdict for each assumption using its
currently presented default. It does not claim evidence validation.

**Review each** opens the existing Sharpen flow scoped to that arrival batch.

**Later** records one defer verdict per imported assumption, as approved. The
records follow existing deferral-resurfacing rules and reappear only when
dependent state changes. No separate “card dismissed” persistence is added.

The card is idempotent across rerenders and does not resurrect after the whole
arrival batch has been answered or deferred.

## 7. Slice 3 — Validation trust

### 7.1 Typed overrideability

Blocking validation results gain stable typed codes. A central policy classifies
each code as:

- `non_overridable` — truncation, structurally incomplete or unparsable output;
  or
- `rationale_required` — heuristic or semantic checks that a user may
  legitimately dispute.

The UI never determines overrideability by matching warning text.

### 7.2 Version-scoped acceptance

For an overridable `needs_review` preferred version, the artifact banner offers:

- **Regenerate**; and
- **Accept with noted issue**.

Acceptance requires a non-empty, trimmed rationale. The store action atomically:

1. confirms the artifact and exact preferred version still exist;
2. confirms the blocker set is unchanged and fully overrideable;
3. preserves the original blocker codes and messages;
4. appends version metadata containing actor, timestamp, rationale, and blocker
   identity;
5. changes the effective acceptance state from `needs_review` to usable with a
   noted issue; and
6. clears only matching transient failure state for that exact version.

Accepted output becomes eligible as downstream generation context. UI and
export language says **Accepted issue**, never **Passed** or **Validated**.

If the preferred version or blockers changed, the action writes nothing and
asks the user to review the current version. Read-only/demo guards apply.

### 7.3 Accepted-risk lifecycle

The original failed checks remain inspectable for the lifetime of the version.
Regeneration creates a new version with a fresh validation outcome. Accepted
issues appear in the generation-complete and export summaries until that version
is no longer preferred.

## 8. Slice 4 — Checkpoints, echo budget, and cleanup

### 8.1 Inline pre-generation checkpoint

The current advisory `PreBuildCheckModal` becomes an inline checkpoint card at
the point where generation was requested. It does not alter the hard
incomplete-PRD or design-direction gates.

The card:

- summarizes the highest-material planning concern without a duplicate raw
  count;
- offers a contextual Review action;
- preserves **Generate outputs**; and
- appears only when the existing pre-build conditions warrant it.

It is an inline stage surface, not a navigation detour.

### 8.2 Generation-complete summary

When the observed artifact run transitions from active to settled, one summary
appears in the workspace. It is derived from current state and contains:

- ready output count;
- non-overridable blockers;
- rationale-accepted issues;
- advisory `validationWarnings`;
- failed jobs; and
- current alignment warnings relevant to the generated outputs.

Every row links to the exact artifact. The summary may be dismissed for the
current component session, but the underlying state remains derivable and
available from the workspace. No summary object is persisted.

### 8.3 Finalize-aware export

Export receives the current trusted readiness commitment and the shared
checkpoint summary rather than only a `planningReady` boolean.

When a current trusted Finalize/commitment verdict exists, export and handoff
reuse:

- accepted concern ids;
- rationale;
- containment notes; and
- current accepted validation issues.

When no current verdict exists, export remains available and uses one neutral
**Working plan** label. It does not add a second blanket “exploratory” nag on top
of the same open-item warnings.

New handoff fields are optional for backward compatibility. Existing consumers
that understand only the exploratory flag continue to work during the
transition.

### 8.4 Echo budget

A warning may appear:

1. where it arose; and
2. in the next relevant checkpoint summary.

It does not render as a third raw count, badge, banner, modal, or export nag.

The implementation inventory applies these rules:

- global aggregate count: persistent next-action strip only;
- Plan: no duplicate primary count/action in `PlanningStateBar`;
- PRD sections: exact contextual links may remain, aggregate counts are removed;
- Challenge/Decision Center: local management count may remain, but stage and
  page-level duplicate counts are removed;
- pre-build: severity summary without raw decision count;
- generation: outcome summary once;
- export: current Finalize/working-plan verdict and accepted-risk list, not a
  fresh open-item warning;
- contextual return banners remain because they provide navigation, not echo.

### 8.5 Silent/dead machinery

Tier 1 renders `validationWarnings` in the generation summary.

The following unused creation/derivation paths are removed:

- `createFeedbackItem` capability and write action, while legacy feedback
  records and their read/update UI remain supported; and
- the unrendered screen review checklist/progress derivation, while the visible
  acceptance-criteria experience remains unchanged.

Stored legacy fields remain optional and readable. No destructive migration is
performed.

## 9. Error handling and recovery

- **Stale planning recommendation:** skip that record, keep it open, report why.
- **Partial batch result:** show succeeded/skipped counts and direct links to
  remaining records.
- **Duplicate Flag to plan:** reuse/open the existing current record instead of
  creating another.
- **Missing screen return target:** fall back to the owning artifact or Screens.
- **Stale artifact acceptance:** write nothing and refresh the displayed
  preferred version.
- **Non-overridable blocker:** do not render the acceptance action.
- **Interrupted generation:** existing recovery remains authoritative; the
  completion summary waits for the recovered run to settle.
- **Legacy metadata:** absence of new acceptance or summary fields projects
  conservatively and never implies user approval.
- **Cross-tab updates:** mutation checks run inside store updaters; read-side
  summaries tolerate new current state without replaying stale actions.

## 10. Accessibility and responsive behavior

- The global strip uses a landmark/label and maintains one primary button.
- On narrow screens, strip copy stacks above a full-width action.
- Batch controls expose exact affected counts in accessible names.
- Partial-result messages use an `aria-live` region.
- “Flag to plan” confirmation returns focus to the triggering note; Review now
  moves focus through existing navigation.
- Validation acceptance uses a labeled dialog, focus trap, Escape handling, and
  focus restoration consistent with existing checkpoint dialogs.
- Status is never communicated by color alone.
- All new controls retain the project’s 44px minimum touch target.

## 11. Testing strategy

### Pure projections and policy

- planning attention produces one stable global primary action;
- checkpoint summary covers ready, blocker, accepted issue, advisory warning,
  failure, and alignment combinations;
- validation blocker codes classify overrideability correctly;
- truncation and structural incompleteness are always non-overridable;
- exact-screen navigation destinations serialize, validate, and degrade safely;
- batch eligibility excludes resolved, changed, or recommendation-less records.

### Store/domain behavior

- Flag to plan creates one user-owned record and deduplicates the same source;
- batch actions emit one user event per successfully changed record;
- Later defers exactly the imported arrival batch;
- partial batch results do not roll back successful independent records;
- acceptance targets the exact preferred version and blocker set;
- accepted output is available as downstream context;
- regeneration does not inherit acceptance;
- read-only/demo mutation guards remain effective; and
- cross-tab/stale version cases fail without mutation.

### Components and integration

- global strip renders and navigates from every current stage;
- Plan does not duplicate its action/count;
- Flag to plan stays on the screen and Review now returns exactly;
- batch controls show correct eligibility, busy, success, and partial states;
- assumption card scopes itself to a generation arrival and does not resurrect;
- acceptance dialog preserves failed checks and rationale;
- pre-build card preserves existing proceed/review behavior;
- generation-settled transition shows one summary;
- export uses trusted Finalize data or one neutral Working plan state;
- duplicate echo surfaces and counts are absent; and
- mobile layouts, focus, Escape, and accessible names are covered.

### Required repository gates

Before commit/push:

- targeted Vitest suites for each slice;
- `npm test`;
- `npm run build`;
- `npm run lint`;
- `git diff --check`.

Visual e2e is not automatically run because repository instructions require
explicit viewport/scope selection. If requested later, use the branch-diff mode
for the affected Plan, Challenge, Screens, generation, and export views.

## 12. Documentation

The implementation updates, in the same change:

- `docs/architecture/PLANNING_AND_DECISIONS.md`;
- `docs/architecture/WORKSPACE_AND_ARTIFACTS.md`;
- `docs/architecture/SCREENS_EXPERIENCE.md`;
- `docs/architecture/SAFETY_AND_VALIDATION.md`;
- `docs/architecture/VERSIONING_AND_EXPORT.md`;
- `docs/architecture/UI_PATTERNS.md`;
- `README.md` where the visible journey description changes; and
- tour copy/screens if the shipped UI makes current tour frames misleading.

## 13. Acceptance criteria

Tier 1 is complete only when all seven audit items are addressed:

1. one global next-action strip appears on every stage;
2. Screens and artifact detail can flag a concern to the plan and return exactly;
3. eligible Decision Center recommendations can be accepted in one action with
   per-record authority;
4. newly imported assumptions appear as one arrival batch with Accept, Review,
   and recorded Later behavior;
5. overridable validation blockers can be accepted with version-scoped
   rationale while truncation remains non-overridable;
6. advisory warnings are visible and unused creation/derivation paths are
   retired safely; and
7. the echo budget is enforced through pre-generation, generation-complete, and
   export surfaces.

No Tier 2 or Tier 3 behavior is required for Tier 1 completion.
