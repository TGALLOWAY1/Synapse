# Decision Center Implementation Plan

## Goal

Ship a coherent Planning Intelligence foundation with durable decisions, explicit impact preview, guarded application to versioned PRD content, and a responsive first-class Decision Center.

## Phase 0: Protect existing version semantics

1. Add regression tests proving section retry preserves assumption verdicts and feature confirmations.
2. Add regression tests proving structured PRD edits and reverts rebuild canonical-spine metadata for the new spine ID.
3. Centralize append-version behavior used by decision application so structured content, rendered markdown, canonical spine, provenance, finality, and history cannot diverge.
4. Ensure branch consolidation cannot create a half-populated modern spine.
5. Validate with targeted versioning, retry, canonical-spine, and staleness suites.

Commit: `fix: preserve planning context across PRD revisions`

## Phase 1: Decision domain and persistence

1. Add typed decision, event, source-reference, option, recommendation, and assessment models.
2. Add pure projection and invariant helpers.
3. Add a Zustand decision slice with append-only actions and demo capability guards.
4. Add lazy idempotent import from current PRD assumptions.
5. Thread the decision slice through project bundle extraction/merge/overwrite/change detection, recovery, namespace handling, server sync selection, snapshots, and foreign-ID restore.
6. Add legacy bundle/snapshot compatibility tests and ID-rewrite tests.
7. Update `CLAUDE.md` architecture and persistence documentation.

Commit: `feat: add durable planning decision register`

## Phase 2: Deterministic impact engine and guarded apply

1. Add a pure decision-to-PRD patch model and validation schema.
2. Add deterministic previews for imported assumption confirmation/correction and straightforward custom answers.
3. Derive affected PRD sections and artifact slots from real spine-change/dependency logic.
4. Store version-bound preview assessments.
5. Add stale-baseline checks and decision-projection checks.
6. Add guarded apply that appends a new PRD version, rebuilds canonical context, records provenance, and appends an applied event.
7. Ensure artifacts are never regenerated or overwritten by apply.
8. Add tests for ready, stale, invalid, applied, duplicate apply, and no-op cases.

Commit: `feat: preview and apply decision impact safely`

## Phase 3: Model-assisted reasoning

1. Add schema-constrained fast extraction/normalization for new PRD decision candidates.
2. Add strong-model assessment for options, tradeoffs, recommendation, semantic inconsistency, and ambiguous PRD patches.
3. Record model/provider provenance and evidence references.
4. Add conservative merge/detail-loss/feature-ID guards around model patches.
5. Add deterministic fallback and explicit error states.
6. Add mocked transport tests; do not require live provider keys in CI.

Commit: `feat: add source-backed decision reasoning`

## Phase 4: Decision Center UI

1. Add URL-addressable Project subview state for PRD and Decisions.
2. Add a compact Decisions entry point and factual unresolved count.
3. Implement desktop queue/detail layout and mobile list/detail navigation.
4. Implement Needs review and Decision log projections.
5. Implement select, custom answer, defer, reject premise, reopen, and revise flows.
6. Implement recommendation/tradeoff/source/history disclosures.
7. Implement impact-preview before/after display and explicit Apply to plan.
8. Implement empty, complete, loading, stale, failed, read-only, local-only, and cross-device-conflict states.
9. Add component and routing tests, including keyboard/focus behavior.

Commit: `feat: ship responsive Decision Center`

## Phase 5: Existing workflow integration

1. Import decisions after PRD generation settles without duplicating records.
2. Point the existing PRD Review & Confirm surface into the shared decision service or replace it with a Decision Center entry point where duplication would remain.
3. Preserve the legacy derived log for confirmed features and deferred scope until explicit migration exists.
4. Surface post-apply artifact consequences through the existing update-plan/Project Map mechanisms.
5. Ensure project finalization remains advisory rather than blocked by unresolved decisions in the first release.
6. Update README feature narrative and screenshots where required.

Commit: `feat: connect decisions to Synapse planning flows`

## Phase 6: Independent validation and polish

1. Run targeted tests after each phase and the full test suite at integration points.
2. Run `npm run build` and `npm run lint` before every implementation commit as required by `CLAUDE.md`.
3. Run the app with realistic project data and inspect desktop/mobile flows.
4. Capture the required viewport matrix and review against current Synapse screenshots, not the reference mockup alone.
5. Delegate independent product, architecture, accessibility, and regression reviews.
6. Resolve high-severity findings and rerun all gates.

Commit: `test: validate Decision Center end to end`

## Migration and rollback

- All new fields and bundle arrays are optional on read and default to empty.
- Legacy PRD assumptions remain intact.
- Imports are idempotent and reversible by removing only imported decision records, never PRD content.
- Apply uses existing append-only PRD history, so reverting uses existing version restoration.
- No backend schema migration is required; server data remains the project-bundle envelope.
- No artifact content is mutated by a decision apply.

## Completion criteria

- Decision lifecycle, preview, apply, persistence, and responsive UX work end to end.
- Human decisions cannot be confused with AI recommendations.
- Prior reasoning and versions are preserved.
- Stale previews are blocked.
- Affected artifacts are accurate and remain user-controlled.
- Existing projects, snapshots, demo routes, sync conflicts, PRD generation, artifact generation, and version history remain functional.
