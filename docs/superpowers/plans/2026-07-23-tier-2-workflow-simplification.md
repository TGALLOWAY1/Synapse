# Tier 2 Workflow Simplification Implementation Plan

**Goal:** Deliver audit items 8–12 by consolidating output correction, removing
redundant verification and critique ceremony, and adding derived checkpoint and
decision-group presentation.

**Architecture:** Reuse canonical freshness, guarded artifact writers,
deterministic update-plan generation, current review projections, and
per-record planning authority. New models are pure read-side projections; no
persisted schema is added.

**Tech stack:** React 19, TypeScript, Zustand 5, React Router 7, Tailwind CSS,
Vitest, Testing Library.

## Scope guard

Implement only
[`2026-07-23-tier-2-workflow-simplification-design.md`](../specs/2026-07-23-tier-2-workflow-simplification-design.md).
Do not implement the Tier 3 rail, slide-over Decision Center, background
propagation proposals, or materiality-based checkpoint blocking.

## Task 1 — Pure output-sync plan

Create a pure planner that:

- builds visible modal rows from `ProjectFreshness`;
- derives recommended Quick defaults;
- distinguishes missing/current/stale/manually-edited outputs;
- maps slots to backing artifact ids;
- applies healed mark-current selections to partial dependency expansion; and
- returns one safe visible-slot regeneration order.

Tests cover upstream expansion, healed upstreams, graph order, missing/error
rows, manual edits, and absence of hidden/retired rows.

## Task 2 — Sync outputs UI and background Careful plans

Generalize `UpdateAssetsPlanModal` to Sync copy and add:

- Quick choices;
- active-run/prerequisite states;
- manually-edited warnings;
- Careful advanced disclosure;
- current per-region plan links; and
- honest unsupported-slot explanations.

Mount it from `ArtifactWorkspace`. Route artifact and Dependency Graph
correction actions to the same opener. Generate deterministic plans
idempotently when drift authority changes, without auto-preparing or applying
proposals.

## Task 3 — Auto-verification presentation

Expose the verification result already created by proposal Apply. Render the
combined applied/verified state, retain advisory review, and show manual Verify
only for non-application changes. Strengthen store/component tests for aligned,
advisory, stale, and manual-edit paths.

## Task 4 — Decision grouping

Add a pure relationship-grouping helper and attach presentation metadata to
`PlanningRecordView`. Nest relationship groups within existing condition
sections in `DecisionCenter`. Preserve exact selection, mobile behavior, and
per-record callbacks.

## Task 5 — Remove critique gate

Delete full-page gate substitution and bulk defer from the critique path.
Render a singular/plural contextual suggestion while leaving start, resume,
retry, re-review, completed findings, and read-only behavior intact.

## Task 6 — Workflow checkpoint summary

Add a pure multi-signal summary projection and a reusable accessible summary
component. Wire:

- one session-local generation-complete dialog/card after active → settled;
- one pre-export summary replacing duplicate alignment/exploratory banners;
- exact source navigation; and
- current trusted commitment/working-plan language.

Do not summarize raw historical critique collections or persist dismissal.

## Task 7 — Documentation and verification

Update:

- `docs/architecture/WORKSPACE_AND_ARTIFACTS.md`;
- `docs/architecture/PLANNING_AND_DECISIONS.md`;
- `docs/architecture/VERSIONING_AND_EXPORT.md`;
- `docs/architecture/SAFETY_AND_VALIDATION.md` if validation-warning
  presentation changes;
- `README.md`; and
- the audit implementation-status note.

Run focused tests after every slice, then the full suite, build, lint, and
diff-check. Review the combined diff for authority, stale-state, selector
stability, mobile accessibility, and copy accuracy before committing.
