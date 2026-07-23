# Tier 2 Workflow Simplification Design

**Date:** 2026-07-23
**Source:** [`docs/audits/WORKFLOW_AUDIT.md`](../../audits/WORKFLOW_AUDIT.md)
**Status:** Approved for implementation
**Scope:** Tier 2 items 8–12 only

## 1. Outcome

Tier 2 shortens the correction and review loops without weakening Synapse's
append-only authority, version guards, dependency safety, or advisory review
semantics.

Success means:

- a changed plan exposes one **Sync outputs** entry point;
- Quick sync can regenerate a safe dependency-ordered batch or explicitly mark
  selected outputs current;
- Careful sync opens ready, deterministic per-region plans from the same entry;
- an applied careful update immediately reports its already-derived
  verification result instead of demanding a redundant second step;
- generation completion and export show one composed checkpoint summary;
- related planning records are grouped for reading while every action still
  targets one durable record; and
- open planning items advise, but never gate, specialist critique.

The persisted `prd` / `review` / `workspace` / `history` stages, project route,
artifact and planning schemas, safety gate, incomplete-PRD acknowledgement,
append-only user authority, artifact-version write barriers, and export
availability remain unchanged.

## 2. Audit corrections

Implementation follows the code, not two stale audit-era descriptions:

1. `UpdateAssetsPlanModal` is not rendered anywhere. The architecture document
   says re-finalize uses it, but the live code has no caller. Tier 2 revives and
   generalizes it as the Sync outputs surface.
2. Proposal Apply already derives, validates, and persists an advisory
   verification inside the same guarded Zustand transaction. Tier 2 does not
   add a second verifier. It makes that atomic result visible and keeps manual
   verification only for externally or manually changed outputs.

## 3. Non-goals

Tier 2 does not:

- add the six-step rail or merge Plan and Challenge;
- make the Decision Center a global slide-over;
- auto-apply an output update, planning verdict, or verification review;
- invent surgical support for Design System or Mockups;
- introduce background LLM calls;
- persist a checkpoint-summary or decision-group record;
- replace the canonical freshness evaluator;
- weaken stale-plan, stale-proposal, safety, dependency, or generation gates;
- add fuzzy/semantic grouping; or
- make materiality a new hard gate.

## 4. Shared rules

### 4.1 Derived orchestration only

Sync rows, checkpoint rows, and decision groups are pure projections over
current state. They may contain stable destinations and artifact/record ids,
but are never persisted.

### 4.2 Existing authority remains authoritative

- `useProjectFreshness` is the only React freshness seam.
- `markArtifactCurrentForSpine` remains the explicit audited user assertion.
- `expandSelectionWithTroubledUpstreams` protects partial selections.
- `artifactJobController.regenerateSlots` remains the dependency-ordered
  execution path and expands hidden dependencies.
- `generateDownstreamUpdatePlans` remains deterministic, idempotent, and
  stale-safe.
- the existing proposal Apply transaction remains the only selective-write
  path.
- critique and planning actions continue to operate on individual ids.

### 4.3 No fabricated progress

Quick sync cannot claim to have started while generation is active or while a
hard generation prerequisite is unsatisfied. Auto-prepared Careful plans do not
imply user approval. Auto-verification remains advisory and never appends a
user confirmation event.

## 5. Slice A — Two-speed Sync outputs

### 5.1 One entry

When canonical freshness reports drift, the workspace exposes one primary
**Sync outputs** action. Artifact headers and the Dependency Graph route to the
same surface instead of presenting competing Update / Confirm aligned / Update
plan ceremonies.

### 5.2 Quick sync

The revived triage modal lists visible outputs in graph order:

- **Regenerate** — selected for canonical recommended updates;
- **Mark up to date** — available only for an existing stale version; and
- **Later** — performs no write.

Confirm applies every mark-current choice first. It then treats those slots as
healed, expands selected regeneration slots with troubled visible upstreams,
and invokes `regenerateSlots` once. The controller performs hidden-dependency
closure expansion and generation ordering.

Manually edited rows receive an explicit warning. A live generation run disables
confirm. Missing Design System setup or another hard generation prerequisite
stays visible rather than producing a false success.

### 5.3 Careful sync

An advanced disclosure lists current deterministic per-region plans for the
supported output slots:

- Screen Inventory;
- User Flows;
- Data Model; and
- Implementation Plan.

Opening a row uses the existing `DownstreamUpdatePlanReview`. Design System and
Mockups explain that Careful sync is unavailable and offer Quick sync only.

Current plans are generated idempotently when authoritative drift inputs change.
No proposal, disposition, apply, or verdict is generated automatically.

## 6. Slice B — Applied and verified in one state

Proposal Apply returns or immediately reads the verification created by the
same transaction.

The UI presents:

- **Applied — verification passed** for `aligned`; or
- **Applied — verification needs your eye** for every advisory/non-aligned
  result.

The advisory evidence and user review controls remain available. The manual
**Verify current output** action remains only when the output changed outside
the application-bound lifecycle or for a legacy lifecycle with no current
application verification.

## 7. Slice C — Checkpoint summaries

A pure checkpoint projection composes signals without collapsing them:

- current critique issues from the current substantive review only;
- preferred-version blocking and advisory validation metadata;
- generation failures and interruptions;
- output alignment state; and
- the current trusted commitment/working-plan verdict.

One artifact row may carry several signals; no later signal overwrites an
earlier one.

The generation summary appears after an observed job transitions from active to
settled. Dismissal is session-local and keyed by the job identity. The
pre-export summary reuses the same projection and replaces the separate
alignment and blanket exploratory banners. Cloud-durability warnings stay
separate because they describe a different failure domain.

Summaries are non-blocking and route to the exact existing detail surfaces.
Hidden and retired artifacts are omitted.

## 8. Slice D — Presentation-only decision grouping

Grouping priority is conservative and deterministic:

1. exact `sourceReviewIssueId` (the existing critique cluster);
2. exactly one canonical normalized PRD section from a primary plan location,
   affected section, or source locator; or
3. standalone.

Critique identity wins over section identity. A multi-section record remains
standalone unless it has one exact primary locator. Groups with one member
render as an ordinary row.

The existing Needs attention / Resolved split and dominant-condition guidance
remain. Relationship groups nest inside those sections. Every sub-item is an
individual button and every action still emits exactly one record id.

## 9. Slice E — Non-blocking critique suggestion

The full-page `CritiqueGate` and bulk-defer escape hatch are removed.

When open planning items exist, critique launch and relaunch surfaces show one
contextual sentence:

> N open items — critiquing now may re-raise them.

Start, resume, retry coverage, and re-review remain enabled subject only to
their existing run and read-only guards. Entering Challenge may still orient to
the Decision Center; the Findings tab is always runnable.

## 10. Verification

Each slice receives focused unit/component coverage. Before commit:

- all focused Tier 2 tests pass;
- `npm test` passes;
- `npm run build` passes;
- `npm run lint` passes; and
- `git diff --check` passes.

