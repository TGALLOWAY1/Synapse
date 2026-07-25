# Change Management Remediation Program

**Source audit:** [docs/audits/CHANGE_MANAGEMENT_AUDIT_2026-07-25.md](audits/CHANGE_MANAGEMENT_AUDIT_2026-07-25.md)
**Findings covered:** CM-1 … CM-8
**Status:** planning — no phase started

This document is the systematic way the eight audit findings get addressed. It
converts eight independently-worded findings into **one sequenced program with
a single organizing model**, so the work compounds instead of producing eight
disconnected features.

Read this before starting any CM work. Then read
[docs/architecture/PLANNING_AND_DECISIONS.md](architecture/PLANNING_AND_DECISIONS.md)
and [docs/architecture/VERSIONING_AND_EXPORT.md](architecture/VERSIONING_AND_EXPORT.md),
which carry the invariants each phase must not break.

---

## 1. Organizing model: everything converges on the Change Set

The audit's own recommendation (§5) is the spine of this program. Rather than
fixing each finding locally, every phase moves state toward one durable object:

> **The current approved baseline is authoritative. Open change sets are
> proposals. Every artifact states how it was reconciled to the baseline.
> Closed change sets and baselines are restorable.**

Mapping the findings onto that sentence explains the sequencing:

| Sentence clause | Missing today | Finding |
|---|---|---|
| "the current approved baseline is authoritative" | No baseline object; authority split across latest / final / confirmed / preferred / aligned / applied | CM-2, CM-7 |
| "open change sets are proposals" | Proposals exist but are per-artifact and bounded to four slots | CM-1, CM-5 |
| "every artifact states how it was reconciled" | `marked_current` records an assertion without a disposition or rationale | CM-8 |
| "closed change sets and baselines are restorable" | Restore is whole-version only, with no conflict or impact preview | CM-3, CM-4 |
| (comparison across the above) | Compare shows content deltas, not consequences | CM-6 |

The finding CM numbers are **not** a work order. The order below is.

---

## 2. Program invariants

Every phase is constrained by rules that already hold in this codebase. A phase
that needs to break one of these is mis-designed — redesign the phase.

1. **Append-only history.** Restore, reconciliation, and change-set application
   always append. Nothing in this program may mutate or delete a `SpineVersion`,
   `ArtifactVersion`, `PlanningRecord`, or history event. (CLAUDE.md rule 11)
2. **User authority is user-authored.** Verdicts stay `actor: 'user'`. Model
   output is evidence (`DecisionAssessment`), never a disposition. No phase adds
   a model-authored approval, and no phase adds a composite "coherence score".
   (CLAUDE.md rule 13)
3. **Silence is never evidence.** This is the new rule the audit forces, and it
   is the single most important one in the program: an absent parser, a failed
   binding, or an unsupported category must produce an **explicit
   `unknown — review required`** item. It must never produce an empty result
   that reads as "no impact". Two `continue` statements in
   `src/lib/planning/downstreamUpdatePlanGeneration.ts` (:632, :636) are the
   current violations.
4. **Read-side layers stay derived.** Coverage, alignment, conflict previews,
   and comparison projections are pure `src/lib/` modules, unit-tested,
   advisory, and never persisted. Only user intent and applied results persist.
   (CLAUDE.md rule 10)
5. **New persisted state must travel.** Any new collection (change sets,
   baselines, reconciliation events) wires `ALL_PROJECT_COLLECTIONS`
   (`src/lib/projectBundle.ts`), snapshot collectors/restorers +
   `namespaceSnapshotForRestore`, demo cleanup, and
   `PERSISTENT_STORE_ACTIONS`. (CLAUDE.md rules 5, 6)
6. **PRD writes go through the barrier.** `compareAndAppendStructuredPRD`
   remains the only version-bound path for applying an approved change to the
   spine. Change-set application composes with it; it does not replace it.
   (CLAUDE.md rule 14)
7. **One freshness engine.** `evaluateDependencyGraph` stays the staleness
   source. The dependency registry in Phase 2 is a *coverage* layer above it,
   not a second engine, and no phase re-adds a `stalenessSlice`.
   (CLAUDE.md rule 9)
8. **Sealed records.** New durable change records seal with
   `hashReviewValue` and validate integrity on read, matching
   `sealDownstreamUpdatePlan` / `sealDownstreamUpdatePlanEvent`.

---

## 3. Sequencing

```
Phase 0  Guardrails + ledger          (no behavior change)
   |
   +--> Phase 1  Reconciliation vocabulary + honest labels   [CM-7, CM-8]
   |        |
   |        v
   +--> Phase 2  Dependency registry + mandatory coverage    [CM-1]  <- Critical
            |
            v
        Phase 3  Approved baseline + Change Set              [CM-2]
            |
            +--> Phase 4  Requirement IDs + typed trace graph [CM-5]
            |
            +--> Phase 5  Change-set comparison               [CM-6]
            |
            +--> Phase 6  Region-level restore as a patch     [CM-3]
                     |
                     v
                 Phase 7  Per-screen history and restore      [CM-4]
```

Rationale for the order, since it does not follow severity:

- **Phase 1 before Phase 2** even though CM-1 is Critical. Phase 1 defines the
  reconciliation vocabulary (`regenerated | patched | reviewed_unchanged |
  deferred | not_applicable | unknown`) that Phase 2's registry needs for every
  category disposition. Defining it twice is the failure mode this program
  exists to avoid. Phase 1 is also 1–2 weeks and independently shippable.
- **Phase 2 before Phase 3.** A baseline whose change sets are built on
  incomplete impact analysis would ship a *stronger* false claim of coherence
  than today's UI makes. Coverage honesty must precede authority consolidation.
- **Phase 4 and Phase 5 are parallelizable** once Phase 3 lands. Phase 4
  improves detection quality; Phase 5 improves explanation. Neither blocks the
  other.
- **Phase 6 before Phase 7.** Per-screen restore (CM-4) is a specialization of
  region-level restore onto screen overlays. Building it first would produce a
  screen-only mechanism that Phase 6 then has to generalize or duplicate.

Phases 1 and 2a can run concurrently on separate branches. Everything from
Phase 3 onward is sequential against Phase 3's data model.

---

## 4. Phases

Each phase states what it closes, what it explicitly does not close, the
concrete entry points, and how completion is proven.

### Phase 0 — Guardrails and the finding ledger

**Goal:** make later phases provable. No user-visible change.
**Closes:** nothing. **Enables:** every phase.
**Effort:** 0.5–1 week.

**Scope**

1. Characterization tests that pin *today's* behavior at each seam this program
   will change, so a later phase's diff proves intent rather than accident:
   - `revertSpineToVersion` sets `isFinal: false` regardless of source finality
     (`src/store/slices/spineSlice.ts:743`).
   - `markArtifactCurrent` rebases `sourceRefs` and appends `marked_current`
     with no disposition field (`src/store/slices/artifactSlice.ts:389`).
   - `restoreArtifactVersion` defaults to keeping current overlays; the whole
     overlay collection is the restore unit (`src/store/slices/artifactSlice.ts:271`).
   - `generateDownstreamUpdatePlans` emits nothing for an artifact with no bound
     regions, and skips every slot outside `SUPPORTED_SLOTS`
     (`src/lib/planning/downstreamUpdatePlanGeneration.ts:38, :632, :636`).
2. A **coverage guard test**: enumerate `ArtifactSlotKey` and assert every slot
   is either in the downstream coverage registry or in an explicit, commented
   exclusion list. Adding a new artifact slot then *fails the suite* until
   someone records a coverage decision. This is the mechanism that keeps CM-1
   from silently regressing after Phase 2.
3. Add the ledger in §5 of this doc and the working agreement in §6.

**Done when:** the four characterization tests and the coverage guard pass on
`main`, `npm run build` and `npm run lint` are clean, and the ledger is
committed.

**Commit:** `test: pin change-management behavior before remediation`

---

### Phase 1 — Reconciliation vocabulary and honest restore/currency labels

**Goal:** stop the two places where the product's own copy overstates what the
user did.
**Closes:** CM-7, CM-8.
**Effort:** 1–2 weeks.

**Scope**

1. New pure module `src/lib/planning/reconciliation.ts`:
   ```ts
   export type ReconciliationMethod =
       | 'regenerated'
       | 'patched'
       | 'reviewed_unchanged'
       | 'deferred'
       | 'not_applicable'
       | 'unknown';
   ```
   plus display copy, ordering, and a `reconciliationIsResolved` predicate.
   Every later phase imports this; no surface restates the list inline (same
   discipline as `safetyPolicy.ts`).
2. **CM-8** — `markArtifactCurrent` takes a required disposition
   (`reviewed_unchanged`) plus a rationale and the spine version the review was
   performed against. Both land in `VersionProvenance` as new **optional**
   fields (`reconciliation?: { method; rationale?; reviewedAgainstSpineVersionId? }`
   — optional so legacy versions still load, per CLAUDE.md rule 3). The UI stops
   saying "up to date" and says **"Reviewed unchanged against Version N"** with
   the rationale on hover/expand. A legacy `marked_current` version with no
   reconciliation renders as `unknown` — honestly, not as reviewed.
3. **CM-7** — `revertSpineToVersion` keeps `isFinal: false` (correct today) but
   records `restoredFromApprovedVersionId` when the source was final, and the
   restore confirmation + resulting version label read **"Restored draft from
   approved Version N"**. Add an explicit "Re-approve this draft" affordance
   that routes through the existing finalize path rather than inheriting
   approval implicitly.

**Explicitly not closed:** neither change proves semantic consistency — that is
Phase 2's coverage work and Phase 3's baseline. Phase 1 only guarantees the copy
matches the evidence.

**Tests:** reconciliation vocabulary unit tests; store tests for the new
provenance on both actions; legacy-record tests (no reconciliation field →
`unknown`, no crash); component tests for both labels.
**Docs:** VERSIONING_AND_EXPORT.md (restore labelling, reconciliation
provenance), PLANNING_AND_DECISIONS.md (vocabulary source of truth). README:
user-visible copy change — review per the README rule.

**Commits:** `feat: record reconciliation method on artifact currency`,
`feat: label restored PRD drafts as unapproved`

---

### Phase 2 — Dependency registry and mandatory impact coverage

**Goal:** make "reviewed" mean "every required dependency category has a
disposition", not "the four supported slots that happened to bind".
**Closes:** CM-1 (Critical).
**Effort:** 4–8 weeks. Ship as 2a → 2b → 2c.

**Phase 2a — the registry and `unknown` items (2–3 weeks)**

1. New `src/lib/planning/dependencyRegistry.ts` declaring the **required
   categories** the audit §3 table names: user stories, journeys/flows, screens,
   navigation, data entities, APIs/integrations, architecture, acceptance
   criteria, implementation tasks, testing obligations, analytics/success
   metrics. Each entry declares its detection source (artifact slot, PRD
   section, or *none yet*) and whether detection is `structural`, `lexical`, or
   `absent`.
2. Replace the two silent `continue` statements in
   `downstreamUpdatePlanGeneration.ts` with `unknown — review required` items.
   `isLikelyUnaffected` is demoted from a suppression boundary to a **certainty
   downgrade**: it may mark an item `possible`, never remove it.
3. Extend `DownstreamUpdateRegion`'s `artifact_review` fallback with a
   `category_unmapped` reason so a required category with no artifact still
   produces a review item.

**Phase 2b — coverage projection and surface (1–2 weeks)**

4. Derived (never persisted) `dependencyCoverage.ts`: for a given change,
   every required category resolves to `affected | possibly_affected |
   unaffected_with_evidence | unknown_review_required`, each carrying the
   evidence that justified it.
5. The Sync outputs / downstream plan review surface renders coverage by
   category, not only by artifact, so an omitted category is visible as a row
   rather than as an absence.

**Phase 2c — the completeness gate (1–2 weeks)**

6. "Change complete" (and build-readiness treatment of the change) is blocked
   while any required category is `unknown_review_required` with no user
   disposition. Consistent with the codebase's existing gates, the block is a
   *readiness* statement, not a generation block — exploration stays available.

**Explicitly not closed:** CM-5. Detection quality is unchanged here; Phase 2
only guarantees that weak detection surfaces as an explicit unknown rather than
as silence.

**Tests:** registry completeness against `ArtifactSlotKey` (extends the Phase 0
guard); a regression test per removed `continue` proving an item is now emitted;
coverage projection unit tests for all four states; a scenario test reproducing
audit §3 scenario 1 (delete a major feature) asserting analytics/metrics, API
contracts, navigation, and acceptance criteria all appear as unknown rather than
absent.
**Docs:** PLANNING_AND_DECISIONS.md (registry + `unknown` semantics),
WORKSPACE_AND_ARTIFACTS.md (coverage surface).

**Commits:** `feat: emit explicit unknown-impact items instead of silence`,
`feat: project required dependency coverage per change`,
`feat: gate change completion on unresolved coverage`

---

### Phase 3 — Approved baseline and the Change Set object

**Goal:** one answerable authority question.
**Closes:** CM-2. **Depends on:** Phase 1 (vocabulary), Phase 2 (coverage).
**Effort:** 4–6 weeks.

**Scope**

1. New sealed, append-only collections: `changeSets` and `changeSetEvents`,
   modeled directly on the existing downstream-plan pattern
   (`sealDownstreamUpdatePlan` / integrity validation / `actor: 'user'` events).
   A change set holds: title, rationale, author, status, originating baseline,
   the requirement/decision delta, per-category dispositions, and the artifact
   versions created by application.
2. An **approved baseline** pointer: the spine version plus the planning-record
   state that a change set was proposed against and applied onto. Baselines are
   derived identities over existing versions where possible — persist the
   pointer, not a copy.
3. Wire both collections through `ALL_PROJECT_COLLECTIONS`, snapshot
   collect/restore + `namespaceSnapshotForRestore`, project sync, demo cleanup,
   and `PERSISTENT_STORE_ACTIONS` (invariant 5). Add the legacy-bundle test that
   proves a pre-Phase-3 snapshot still restores.
4. Every artifact header and version row states **baseline identity +
   reconciliation method** — "Reconciled to Baseline 4 · patched" rather than a
   bare green state.
5. Existing per-artifact downstream plans and proposals become *children* of a
   change set. Pre-existing plans without a change set keep working and display
   as "ungrouped" — no migration that rewrites history.

**Explicitly not closed:** CM-6 — the compare surface is Phase 5.

**Tests:** seal/validate round-trips; append-only invariants; bundle/snapshot/
sync travel tests; legacy compatibility; capability-guard tests for demo.
**Docs:** PLANNING_AND_DECISIONS.md, PROJECT_SYNC.md, SNAPSHOTS_AND_DEMO.md,
STATE_AND_AUTH.md, and CLAUDE.md's collection list.

**Commits:** `feat: add durable change sets and approved baselines`,
`feat: state baseline and reconciliation on every artifact`

---

### Phase 4 — Durable requirement IDs and a typed trace graph

**Goal:** conceptual changes stop escaping detection.
**Closes:** CM-5. **Depends on:** Phase 3.
**Effort:** 4–8 weeks. Parallelizable with Phase 5.

**Scope**

1. Stable requirement identifiers on PRD features/sections that survive
   rewording (the audit's "durable requirement IDs"). Assigned at generation,
   preserved across the write barrier, section retry, branch consolidation, and
   restore.
2. A typed trace graph: requirement → artifact region edges, built from
   generation-time provenance rather than re-derived lexically at review time.
   This is the durable half; `spineChangeAnalysis` lexical matching becomes the
   supplemental half.
3. Detection precedence: structural trace > deterministic reference > lexical
   evidence. **Low-confidence semantic analysis may never be the sole reason to
   omit a category** — it can only lower certainty (this is Phase 2a's rule,
   enforced here with real trace data behind it).

**Tests:** ID stability across every version-creating path (this is the
regression-prone part — one test per path); trace-graph unit tests; the audit's
scenario 2 (reworded core workflow) asserting flows/screens are still detected.
**Docs:** LLM_PIPELINE.md (IDs in generation), PLANNING_AND_DECISIONS.md
(precedence), SCREENS_EXPERIENCE.md (trace bridge interaction).

**Commit:** `feat: trace requirements to artifact regions durably`

---

### Phase 5 — Change-set comparison

**Goal:** compare consequences, not snapshots.
**Closes:** CM-6. **Depends on:** Phase 3.
**Effort:** 3–5 weeks. Parallelizable with Phase 4.

**Scope**

1. Extend `src/components/versions/VersionCompareView.tsx` with a baseline /
   change-set mode alongside the existing version mode. Keep the existing
   section-aware PRD diff — it is not the problem; the missing context is.
2. The comparison payload is a derived projection: requirements added / changed
   / removed, decision rationale, affected categories, per-category disposition,
   applied patches, outstanding reviews, and what was deliberately preserved.
3. Version history gains change-set grouping so related PRD, screen, data, and
   task versions read as one product decision.

**Tests:** projection unit tests; a comparison scenario covering applied,
deferred, and unknown dispositions in one change set.
**Docs:** VERSIONING_AND_EXPORT.md.

**Commit:** `feat: compare approved baselines and change sets`

---

### Phase 6 — Region-level restore as a proposed patch

**Goal:** recover one thing without rolling back unrelated work.
**Closes:** CM-3. **Depends on:** Phase 3 (restore becomes a change set).
**Effort:** 4–8 weeks.

**Scope**

1. Restore stops being "clone this whole version" and becomes "propose this
   region against current content". Region granularity: PRD section/requirement,
   screen, route, entity, field.
2. A conflict preview before approval — what in current state the restore would
   overwrite — plus the Phase 2 coverage preview for downstream impact.
3. Application appends exactly as today (invariant 1) and is recorded as a
   change set with `changeSource: 'revert'` provenance retained.
4. Whole-version restore remains available and unchanged. Region restore is an
   addition, not a replacement.

**Tests:** conflict detection unit tests; append-only assertions; the audit's
scenario 4 (revert navigation, keep the data-model change) as an end-to-end
store test.
**Docs:** VERSIONING_AND_EXPORT.md.

**Commit:** `feat: restore individual regions as reviewed patches`

---

### Phase 7 — Per-screen history and restore

**Goal:** the specific recovery users attempt most.
**Closes:** CM-4. **Depends on:** Phase 6.
**Effort:** 2–4 weeks.

**Scope**

1. Per-screen history derived from artifact overlay versions (`screenEdits`,
   extra-screen state) — derived, not a new persisted collection.
2. "Restore this screen" applies Phase 6's patch mechanism to one screen.
3. The restore dialog states explicitly what comes back: generated content,
   screen edits, links, approvals, images — resolving each through
   `effectiveImageVersionId` (CLAUDE.md rule 12b).

**Tests:** per-screen history projection; single-screen restore preserving
unrelated screen edits; image continuity through the clone.
**Docs:** SCREENS_EXPERIENCE.md, VERSIONING_AND_EXPORT.md.

**Commit:** `feat: restore a single screen from its own history`

---

## 5. Finding ledger

Update the row in the **same commit** that lands the work. A phase is not done
while its rows say otherwise.

| ID | Severity | Phase | Status | Closed by |
|---|---|---|---|---|
| CM-1 | Critical | 2 | Not started | — |
| CM-2 | High | 3 | Not started | — |
| CM-3 | High | 6 | Not started | — |
| CM-4 | Medium | 7 | Not started | — |
| CM-5 | High | 4 | Not started | — |
| CM-6 | Medium | 5 | Not started | — |
| CM-7 | Medium | 1 | Not started | — |
| CM-8 | Medium | 1 | Not started | — |

Status values: `Not started` · `In progress` · `Narrowed` · `Closed`.
Use **Narrowed** (not Closed) when a phase reduces severity without meeting the
finding's recommended change — the audit itself uses that distinction for CM-4
after PR #326, and losing it is how a program starts overstating its own
progress. Record *why* in the "Closed by" cell, not just a commit hash.

---

## 6. Working agreement

**Definition of done for every phase**

- [ ] `npm run build` passes (`tsc -b` — never `tsc --noEmit`; see CLAUDE.md).
- [ ] `npm run lint` passes.
- [ ] `npm test` passes, including the Phase 0 characterization tests. A
      characterization test that a phase *intentionally* invalidates is updated
      in that phase's commit, with the reason in the commit body.
- [ ] New pure logic has unit tests in the matching `__tests__/` directory.
- [ ] Prompt changes update `src/lib/__tests__/promptSurfaces.test.ts` snapshots
      in the same commit (CLAUDE.md rule 7).
- [ ] Architecture docs updated in the same commit (CLAUDE.md documentation rule).
- [ ] README reviewed if the phase changes a user-visible capability
      (Phases 1, 2b, 2c, 5, 6, 7 do).
- [ ] No new top-level `api/*.js` file — the repo sits at 11 of Vercel's 12
      function cap. None of these phases should need a serverless endpoint; if
      one appears to, that is a design signal to re-check invariant 4.
- [ ] Ledger row(s) in §5 updated.

**Before starting a phase**

1. Re-verify the finding against current `main` — the audit revalidated against
   PRs #326–#328 for exactly this reason, and two findings moved. Do not build
   against a stale finding.
2. Confirm the phase's dependencies (§3) have landed.
3. Confirm no invariant (§2) has to bend. If one does, redesign or amend §2
   deliberately in its own commit.

**After a phase**

Re-run the audit's scenarios (audit §3) that the phase claims to affect, and
record the outcome in the ledger. `docs/QA_CHECKLIST.md` covers the manual pass
for anything the unit suite cannot reach.

---

## 7. Explicitly out of scope

These are decided, not deferred by omission:

- **No composite coherence score.** Coverage is reported per category with
  evidence. A single "project coherence: 78%" number would create exactly the
  false confidence CM-1 warns about. (Invariant 2)
- **No model-authored approvals or dispositions.** The model proposes and
  supplies evidence; the user disposes. (CLAUDE.md rule 13)
- **No automatic artifact rewriting on change-set application.** Application
  creates versions only for actions the user approved. (Audit §5E)
- **No destructive restore.** Region restore proposes a patch; it never removes
  history. (Invariant 1)
- **No second staleness engine.** Coverage layers over
  `evaluateDependencyGraph`; it does not replace or shadow it. (CLAUDE.md rule 9)
