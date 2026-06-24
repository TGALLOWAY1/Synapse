# Synapse Versioning & Revert — Audit and Implementation Proposal

> Status: **Phase 1 MVP implemented** (was: audit + proposal). The MVP scope in
> §10 has shipped — non-destructive edits, PRD + artifact version history,
> compare/diff, restore-as-new-version, provenance, and downstream-staleness
> warnings. Items under "Future enhancements" remain unbuilt.
> Scope: PRD (spine) versioning, PRD section/inline edits, generated artifacts,
> downstream-artifact staleness, project history/audit log, and snapshots.

---

## 1. Executive Summary

Synapse already has **most of the bones of a real versioning system** — it just
doesn't expose them as a coherent user-facing capability, and one common edit
path silently destroys history.

What exists today:

- **PRDs (spines)** are stored as an append-only array of *full snapshots*
  (`SpineVersion[]`), with `isLatest`/`isFinal` flags and a positional
  "Version N" label. New versions are created on regenerate and on branch
  consolidation. Old versions can be **viewed read-only**, but **cannot be
  reverted to**.
- **Artifacts** have a genuinely good versioning model already — immutable
  `ArtifactVersion` records with `versionNumber`, `parentVersionId`,
  `content`, `metadata`, `generationPrompt`, `isPreferred`, and **`sourceRefs`
  that link each artifact version to the spine version it was generated from**.
  A `setPreferredVersion` store action exists — but **no UI ever calls it**, so
  users can neither see the version list nor switch/revert between artifact
  versions.
- **Staleness** is already computed (`getArtifactStaleness`) by comparing an
  artifact's source-spine ref against the current latest spine, so the data to
  warn "this artifact is older than the PRD" is already there.
- **History/audit** is an append-only `HistoryEvent[]` timeline rendered in
  `HistoryView` and the workspace right rail, but its `diff` field is only a
  one-line placeholder and **inline PRD edits emit no event at all**.

The three load-bearing gaps:

1. **No revert** for either PRDs or artifacts (the artifact half is ~80% built
   in the store and just unexposed).
2. **Inline PRD edits mutate the current version in place** (`savePRD` →
   `updateSpineStructuredPRD`) — no new version, no history event, prior content
   gone. This is the only genuinely *destructive* path and the highest-risk
   defect.
3. **No real compare/diff** — users can't see what changed between versions.

The good news: because spines and artifacts already store **full content
snapshots**, the MVP is mostly *plumbing and UI*, not a storage redesign. The
recommendation is to **lean into full snapshots**, add a thin version-metadata
layer, expose the artifact version history that already exists, make inline
edits create versions instead of overwriting, and add a snapshot-diff viewer
plus a "revert = create new version" action with explicit staleness warnings.

---

## 2. Current-State Audit

### 2.1 PRD / spine versioning

Source: `src/types/index.ts` (`SpineVersion`), `src/store/slices/spineSlice.ts`,
`src/store/slices/branchSlice.ts`.

| Aspect | Current behavior |
| --- | --- |
| Storage | `spineVersions: Record<projectId, SpineVersion[]>` in Zustand, persisted to localStorage. |
| Content | **Full snapshot per version** — both `responseText` (markdown) and `structuredPRD` (object). |
| Version id | Opaque UUID (or legacy `v1`-style). Display label = **array position** ("Version N"), never parsed from id. |
| Flags | `isLatest`, `isFinal`. Exactly one `isLatest`. |
| New version created by | `regenerateSpine()` (full re-gen) and `mergeBranch()` (branch consolidation). Both push a `HistoryEvent`. |
| Lifecycle | `generationPhase: 'running' \| 'complete'`; interrupted runs recovered on rehydrate. |
| Source metadata | `model`, `generationMeta`, `qualityScores`, `sourcePrompt`. **No "who/what changed this" field** (user edit vs AI regen vs revert). |
| Viewing old versions | `ProjectWorkspace.viewedSpineId` → read-only banner ("You are viewing a historical version") + "Return to Latest". Selected from the right-rail History Mode timeline. |
| **Revert** | ❌ **None.** You can view an old spine read-only; there is no action to make it current. |

**Critical defect — inline edits overwrite in place.** In
`StructuredPRDView.tsx`, every edit (`savePRD` → `updateSpineStructuredPRD`,
feature edits via `FeatureCard`, text-section edits, add/remove feature) and
`spineSlice.updateSpineText` **mutate the current `SpineVersion` in place**.
No new version is created and **no `HistoryEvent` is recorded**. The previous
content is unrecoverable. This is the single most important thing to fix.

**No section-level versioning.** Single-section retry
(`regeneratePrdSection` → `ProjectWorkspace.handleRetrySection`) shallow-overlays
the new slice onto the current `structuredPRD` in place — again, no version, no
history entry.

### 2.2 Artifact versioning

Source: `src/types/index.ts` (`Artifact`, `ArtifactVersion`, `SourceRef`),
`src/store/slices/artifactSlice.ts`.

This model is already strong:

```ts
ArtifactVersion = {
  id; artifactId; versionNumber; parentVersionId;
  content; metadata; sourceRefs; generationPrompt; isPreferred; createdAt;
}
```

- `createArtifactVersion()` appends an immutable version, increments
  `versionNumber`, unmarks the previous `isPreferred`, sets the artifact's
  `currentVersionId`, and pushes a `HistoryEvent`
  (`ArtifactGenerated`/`ArtifactRegenerated`). Reads happen inside `set()` for
  concurrency safety (7 artifacts generate in parallel).
- **`sourceRefs` already link an artifact version to its source spine version**
  (`sourceType: 'spine'`, `sourceArtifactVersionId` = spine id). This is the
  backbone for "Generated from PRD vX" and for staleness.
- `setPreferredVersion()` already exists and does exactly what a revert needs
  (re-points `currentVersionId` + `isPreferred` to an older version).

**Gap:** `setPreferredVersion` has **no UI caller** (confirmed: referenced only
in the store, its types, and tests). `ArtifactWorkspace` always renders
`getPreferredVersion(...)` and offers only "Regenerate". There is **no version
list, no switcher, no compare, no revert** surfaced for artifacts — even though
the store fully supports it.

### 2.3 Downstream / staleness

Source: `src/store/slices/stalenessSlice.ts`.

`getArtifactStaleness(projectId, artifactId)` returns
`'current' | 'possibly_outdated' | 'outdated'`:

- Finds the artifact's preferred version → its `spine` source ref.
- Compares that ref's spine id to the **current `isLatest`** spine.
  Match ⇒ `current`; mismatch ⇒ `possibly_outdated`.
- Mockups additionally compare a recorded `tokensHash` against the current
  design-system tokens.

So the moment a *new latest spine* exists (regenerate, merge, or — once
implemented — a revert that creates a new spine), downstream artifacts
correctly flag as `possibly_outdated`. The mechanism is sound; it just needs to
be **driven by revert** and **surfaced more loudly** at revert time.

### 2.4 History / audit log

Source: `src/types/index.ts` (`HistoryEvent`), `src/components/HistoryView.tsx`,
right-rail timeline in `ProjectWorkspace.tsx`.

- Append-only `historyEvents: Record<projectId, HistoryEvent[]>`.
- Types: `Init`, `Regenerated`, `Consolidated`, `ArtifactGenerated`,
  `ArtifactRegenerated`, `FeedbackCreated`, `FeedbackApplied`,
  `GenerationFailed`.
- `HistoryEvent.diff` exists but is only populated on branch merges, and even
  then with a **placeholder** (`after: "(Consolidated changes)"`). The UI shows
  only `diff.matches[0]` (a single before/after line, truncated).
- **No event is recorded for inline edits**, so the audit trail has holes
  exactly where in-place mutation happens.
- No revert event type. No per-version "source of change" attribution.

### 2.5 Persistence & snapshots

- **Versioning state is 100% client-side** in localStorage via Zustand
  `persist` (debounced, quota-guarded, namespaced per user via `userScope.ts`).
  Mockup/screen images live in IndexedDB (too big for localStorage).
- **Cloud snapshots** (`SnapshotsPanel.tsx`, `snapshotClient.ts`,
  `api/snapshots`) are a **whole-project** backup to Vercel Blob, gated by an
  owner token, used mainly to pin the public demo project. Loading a snapshot
  **replaces the entire project**. This is *project-level backup/restore*, not
  per-version history, and is owner-only — not the per-artifact/per-PRD revert
  this task is about. It should not be conflated with versioning.

### 2.6 Diff library

None installed (`package.json` has `react-markdown`, `remark-gfm`, but no diff
package). A diff capability must be added or hand-rolled.

---

## 3. Gaps & Risks

| # | Gap / Risk | Severity | Notes |
| --- | --- | --- | --- |
| G1 | Inline PRD edits overwrite the current version in place; no version, no history | **High (data loss)** | `savePRD`, `updateSpineText`, section retry. Silent and unrecoverable. |
| G2 | No revert for PRDs | High | Read-only viewing exists; no "make current". |
| G3 | Artifact version history & revert not exposed in UI | High | Store is ready (`setPreferredVersion`); only UI missing. |
| G4 | No real compare/diff between versions | Medium | Only a 1-line placeholder on merge events. |
| G5 | No change-source attribution on versions | Medium | Can't tell user-edit vs AI-regen vs revert. |
| G6 | Staleness computed but not surfaced at the moment of revert | Medium | Risk of silently stale downstream artifacts after a PRD revert. |
| G7 | Section retry overwrites in place | Low–Medium | Same class as G1, smaller blast radius. |
| G8 | localStorage quota | Low–Medium | Full snapshots grow storage; already quota-guarded with a toast, but version retention should be bounded. |
| R1 | Revert that mutates history (anti-goal) | — | Must be prevented by design: revert creates a *new* version. |

---

## 4. Recommended Versioning Model

**Recommendation: keep full content snapshots; do not move to diff-only
storage.** Rationale:

- Spines and artifacts already store full content — no migration of existing
  data needed.
- Full snapshots make revert trivially safe (copy old content into a new
  version) and compare trivially correct (diff two full texts at view time).
- Diff-only storage adds reconstruction complexity and corruption risk for a
  portfolio-scale app where PRDs are kilobytes, not megabytes. **Compute diffs
  on the fly at compare time; store snapshots.**

Granularity recommendation:

- **PRD: document-level (whole-spine) versioning.** This already exists; extend
  it so *edits* and *reverts* also create versions. Section-level versioning is
  over-engineering for the MVP — the per-section retry can simply create a new
  whole-spine version with an edit summary naming the section.
- **Artifact: artifact-level versioning.** Already exists and is correct. Expose
  it.
- **Project-level restore points:** leave to the existing cloud-snapshot
  feature; do **not** build a second project-level system.

Unifying concept: treat **`SpineVersion`** and **`ArtifactVersion`** as the two
"versioned entities". Both already are append-only, full-snapshot, parent-linked
records. The work is to (a) add a small, shared **version-metadata** shape, (b)
guarantee *every* content change appends a version, and (c) build shared
**history / compare / revert** UI that works against either entity.

---

## 5. Version Metadata

Add a single optional, backward-compatible metadata block usable by both
`SpineVersion` and `ArtifactVersion`. Keep all fields optional so legacy
localStorage records keep working.

```ts
// src/types/index.ts
export type VersionChangeSource =
  | 'ai_generation'      // initial PRD / artifact generation
  | 'ai_regeneration'    // full regenerate
  | 'ai_section_retry'   // single PRD section re-run
  | 'branch_merge'       // consolidation back into the spine
  | 'user_edit'          // inline edit in the workspace
  | 'revert'             // restore of an earlier version
  | 'consistency_review';// optional final reconciliation pass

export type VersionProvenance = {
  changeSource?: VersionChangeSource;
  editSummary?: string;            // optional human-readable "what changed"
  revertedFromVersionId?: string;  // set when changeSource === 'revert'
  model?: string;                  // AI-generated versions
  prompt?: string;                 // AI-generated versions (already on artifacts)
};
```

Mapping to the existing model (no breaking changes):

- `SpineVersion`: add optional `provenance?: VersionProvenance`. (`model`,
  `sourcePrompt`, `generationMeta` already exist and stay.) `id`, `projectId`,
  `createdAt`, and positional version number already cover the rest of the
  task's checklist.
- `ArtifactVersion`: already has `versionNumber`, `parentVersionId`,
  `generationPrompt`, `sourceRefs` (incl. the **link to source PRD version**),
  `metadata`. Add `provenance` (or fold `changeSource`/`editSummary` into the
  existing `metadata` bag to avoid a type change — either is fine; a typed field
  is cleaner).

Task-checklist coverage:

| Requested metadata | Where it lives |
| --- | --- |
| Version id | `SpineVersion.id` / `ArtifactVersion.id` |
| Project id | `projectId` |
| Artifact/PRD id | `artifactId` (artifacts); spine is per-project |
| Artifact type | `Artifact.type` / `subtype` |
| Version number | positional (spine) / `versionNumber` (artifact) |
| Timestamp | `createdAt` |
| Source of change | **new** `provenance.changeSource` |
| Edit summary | **new** `provenance.editSummary` |
| Parent version id | `parentVersionId` (artifacts); positional predecessor (spine) |
| Content snapshot | `responseText`/`structuredPRD` (spine), `content` (artifact) |
| Prompt/model metadata | `model`, `sourcePrompt`/`generationPrompt`, `provenance` |
| Link to source PRD version | `ArtifactVersion.sourceRefs` (`sourceType: 'spine'`) — **already present** |

---

## 6. Compare UX

Add a **Compare** view reachable from the history timeline / version list.

- **Default: section-aware inline diff for the structured PRD.** Because the PRD
  is structured, the best UX is *per-section* diffing (Vision, Core Problem,
  Features, Architecture, Risks, …): render each section's old vs new text with
  intra-text **additions highlighted green, deletions red/strikethrough**, and
  collapse unchanged sections to a "No changes" chip. This reads far better than
  diffing one giant markdown blob.
- **Secondary: side-by-side** toggle (old left, new right) for users who prefer
  it; on mobile it stacks vertically (old above new) following the existing
  responsive bottom-sheet pattern.
- **Artifacts** (markdown content): inline word-diff of the two versions'
  rendered text, same component.
- **Selection of versions:** "Compare current ↔ any previous" by default, plus a
  two-dropdown mode to compare **any two historical versions**.
- **Section summary header:** "3 sections changed · 1 added · 0 removed" derived
  from the diff, so users get the gist before scrolling.

Implementation note: use a small diff library (see §7) to produce token/word
diffs; render through the existing `react-markdown` pipeline with added/removed
spans. Diffs are computed at view time from stored snapshots — nothing extra is
persisted.

---

## 7. Revert UX

Design principles (directly from the task): **revert never deletes history;
revert creates a new version; destructive-looking actions are explicit.**

Flow:

1. From a version in the history list (or the read-only "viewing historical
   version" banner that already exists), user clicks **Restore this version**.
2. **Confirmation step** (modal) shows: which version is being restored, a
   one-line summary of what will change vs current, and — for PRDs — a
   **staleness warning**: "Restoring this PRD will mark N downstream artifacts as
   possibly outdated: Screen Inventory, Data Model, …". Offer "Restore only" vs
   "Restore and regenerate downstream" (the latter can be a future enhancement;
   MVP just warns).
3. On confirm, **append a new version** whose content equals the selected old
   version, with `provenance: { changeSource: 'revert', revertedFromVersionId }`
   and an auto `editSummary` ("Reverted to Version 2"). For spines this becomes
   the new `isLatest`; for artifacts this is implemented by
   `setPreferredVersion` **plus** appending a fresh version record so the
   timeline shows the revert as its own event (preferred approach: append a new
   `ArtifactVersion` cloning the old content, rather than only re-pointing
   `isPreferred`, so the audit log is honest and `versionNumber` keeps
   incrementing).
4. Record a new `HistoryEvent` (`type: 'Reverted'`).
5. History before the revert is untouched — the restored-from version still sits
   in the timeline.

This reuses existing machinery: spine revert ≈ `regenerateSpine`'s append
pattern but copying old content; artifact revert ≈ `createArtifactVersion` with
the old content. `getArtifactStaleness` then naturally flags downstream
artifacts because a new latest spine exists.

---

## 8. Downstream Artifact Handling

Answers to the task's explicit questions:

- **Should artifacts be tied to the PRD version they were generated from?**
  **Yes — and they already are**, via `ArtifactVersion.sourceRefs`
  (`sourceType: 'spine'`). Keep and surface it.
- **Should reverting the PRD mark downstream artifacts stale?**
  **Yes.** Because revert creates a *new latest spine*, `getArtifactStaleness`
  already returns `possibly_outdated` for artifacts whose source ref points at
  the old spine. Surface this in the confirmation modal and as the existing
  staleness badge.
- **Should users be able to restore artifacts independently?**
  **Yes.** Artifact revert is independent of PRD revert (artifact-level
  versioning). Expose per-artifact history + restore.
- **Should regenerating artifacts create new artifact versions?**
  **Yes — it already does** (`createArtifactVersion`). No change needed.
- **Should artifacts display "Generated from PRD vX"?**
  **Yes.** Resolve the artifact version's spine source ref to its positional
  label and show a "Generated from PRD Version X" chip near the artifact header,
  alongside the existing staleness badge.

Recommendation: do **not** auto-regenerate downstream artifacts on PRD revert in
the MVP (cost, surprise, and possible safety re-gating). Warn + badge now;
one-click "regenerate stale artifacts" is a future enhancement.

---

## 9. Technical Implementation Plan

### 9.1 Types (`src/types/index.ts`)

- Add `VersionChangeSource`, `VersionProvenance` (see §5).
- Add optional `provenance?: VersionProvenance` to `SpineVersion` and
  `ArtifactVersion`.
- Add `'Reverted'` and `'Edited'` to `HistoryEventType`.
- Extend `HistoryEvent.diff` usage (no shape change needed — the `matches`
  array already supports multiple before/after pairs; populate it for real).

### 9.2 Store (`src/store/`)

- **`spineSlice.ts`**
  - New `editSpineStructuredPRD(projectId, spineId, structuredPRD, opts)` that
    **appends a new SpineVersion** (clone + apply edit) with
    `provenance.changeSource = 'user_edit'` and an `editSummary`, pushes an
    `Edited` `HistoryEvent`, and flips `isLatest`. Replace the in-place
    `updateSpineStructuredPRD`/`updateSpineText` for *user edits* (keep the
    in-place variant for live streaming generation, which legitimately patches
    the in-flight version).
  - New `revertSpineToVersion(projectId, sourceSpineId)` — append a new version
    cloning the source content, `changeSource = 'revert'`, push `Reverted`
    event. Reads inside `set()` (concurrency rule).
- **`artifactSlice.ts`**
  - New `revertArtifactToVersion(projectId, artifactId, sourceVersionId)` —
    append a cloned `ArtifactVersion` (so `versionNumber` increments and the
    timeline is honest), set it preferred + `currentVersionId`, push `Reverted`
    event, carry the source version's `sourceRefs` forward.
  - Keep `setPreferredVersion` for lightweight switching, but the user-facing
    "Restore" should use the append-clone variant.
- **Persistence/retention:** add an optional cap (e.g. keep last N=20 spine
  versions + all preferred-or-recent artifact versions) with a pure helper, to
  bound localStorage growth. Guarded by the existing quota toast.

### 9.3 Diff library

Add **`diff`** (jsdiff, ~10kB, zero deps, battle-tested) for word/line diffs.
Wrap it in `src/lib/versionDiff.ts`:

- `diffText(before, after): DiffSegment[]` (word-level).
- `diffStructuredPRD(before, after): SectionDiff[]` — per-known-section
  word diffs + added/removed/changed classification + a summary count.

Keep it pure and unit-tested. (If avoiding a dependency is preferred, a small
LCS word-diff is ~60 lines — but `diff` is the pragmatic recommendation.)

### 9.4 UI — new components

- `src/components/versions/VersionHistoryPanel.tsx` — list of versions for a
  spine **or** an artifact (props-driven), showing version number, timestamp,
  change-source badge, edit summary, and **Compare** / **Restore** actions.
  Reuse the responsive popover/sheet pattern from `SelectionActionDialog`.
- `src/components/versions/VersionCompareView.tsx` — section-aware inline diff
  (+ side-by-side toggle), driven by `versionDiff.ts`.
- `src/components/versions/RevertConfirmModal.tsx` — confirmation + downstream
  staleness warning (calls `getArtifactStaleness` for each artifact).

### 9.5 UI — modify existing

- `ArtifactWorkspace.tsx` — add a "Version history" affordance next to
  "Regenerate"; render `VersionHistoryPanel` for the selected artifact; add the
  "Generated from PRD Version X" chip + staleness badge (staleness already
  available).
- `ProjectWorkspace.tsx` — on the read-only historical-version banner, add a
  **Restore this version** button → `RevertConfirmModal`; wire the right-rail
  timeline entries to open Compare.
- `StructuredPRDView.tsx` / `FeatureCard` — route `savePRD` through the new
  `editSpineStructuredPRD` (versioning edit) instead of in-place
  `updateSpineStructuredPRD`; optionally prompt for a short edit summary.
- `HistoryView.tsx` — render `Reverted`/`Edited` event types; link events to the
  Compare view; show real (multi-line) diffs when present.
- `ProjectWorkspace.handleRetrySection` — append a version with
  `changeSource = 'ai_section_retry'` and an editSummary naming the section.

### 9.6 Tests (`src/store/__tests__`, `src/lib/__tests__`, `src/components/__tests__`)

- `versionDiff.test.ts` — word diff + structured-PRD section diff correctness,
  empty/identical/added-section cases.
- `spineSlice.versioning.test.ts` — edit appends a version (not in-place);
  revert appends a new latest with `changeSource='revert'` and preserves
  history; positional labels stay correct.
- `artifactSlice.revert.test.ts` — revert appends a cloned version, sets
  preferred, increments `versionNumber`, carries `sourceRefs`, history honest.
- `stalenessAfterRevert.test.ts` — reverting the spine flips downstream
  artifacts to `possibly_outdated`.
- Component test: `VersionHistoryPanel` lists versions and fires restore;
  `RevertConfirmModal` lists stale downstream artifacts.

### 9.7 Migration / backfill

- All new fields are **optional** → existing localStorage data loads unchanged.
- On `onRehydrateStorage`, optionally backfill `provenance.changeSource` for
  existing spines/artifacts using available signals (`safetyReview`,
  `generationMeta`, merge history) — purely cosmetic; safe to skip.
- No server/DB migration: versioning is client-side. Cloud snapshots already
  serialize the whole store, so they capture the new fields automatically.

---

## 10. MVP Scope vs Future

### MVP (ship first)

1. **Stop the bleeding (G1):** route all inline PRD edits and section retries
   through an **append-a-version** path (`editSpineStructuredPRD`) with a
   `HistoryEvent`. No more in-place overwrites for user edits.
2. **Expose artifact version history (G3):** `VersionHistoryPanel` in
   `ArtifactWorkspace` listing existing `ArtifactVersion`s, with switch +
   restore (the store already supports this).
3. **PRD revert (G2):** `revertSpineToVersion` + a **Restore this version**
   button on the existing read-only banner, with `RevertConfirmModal`.
4. **Compare current ↔ previous (G4):** section-aware inline diff via
   `versionDiff.ts`.
5. **Downstream staleness on revert (G6):** warn in the confirm modal + show
   "Generated from PRD Version X" chip (staleness already computed).
6. **Provenance + history events (G5):** `changeSource` + `editSummary` +
   `Reverted`/`Edited` events.

This is achievable without touching the storage format or the backend.

### Future enhancements

- Compare **any two** historical versions (not just vs current).
- One-click **"regenerate stale downstream artifacts"** after a PRD revert.
- Section-level versioning / per-section restore.
- Named, user-created **restore points** ("checkpoints") distinct from
  auto-versions, with retention pinning.
- Visual diff for mockups/images (thumbnail before/after).
- Server-side per-version history (if/when projects move off localStorage).
- "Branch from an old version" (fork instead of revert).

---

## 11. Testing Checklist

- [ ] Inline PRD edit creates a **new** version; previous content still
      retrievable; positional labels correct.
- [ ] Section retry creates a version tagged `ai_section_retry`.
- [ ] PRD revert appends a new latest version; history before revert intact;
      `changeSource='revert'`, `revertedFromVersionId` set.
- [ ] Artifact revert appends a cloned version, increments `versionNumber`,
      sets preferred, carries `sourceRefs`.
- [ ] Reverting a PRD flips downstream artifacts to `possibly_outdated`.
- [ ] Compare view: identical versions show "no changes"; added/removed sections
      classified correctly; word-level highlights correct.
- [ ] `RevertConfirmModal` lists exactly the artifacts that will go stale.
- [ ] "Generated from PRD Version X" chip resolves the correct positional label.
- [ ] Legacy localStorage projects (no `provenance`) load and render without
      errors.
- [ ] localStorage retention cap (if added) never drops the `isLatest`/preferred
      version and never throws on quota.
- [ ] Mobile: history panel, compare, and revert modal use the responsive
      sheet/stacked layouts.
- [ ] `npm run build` (tsc), `npm run lint`, `npm test` all green.

---

## 12. Manual Setup / Migration Steps

- **Dependency:** `npm install diff` (+ `@types/diff` if not bundled) — only new
  dependency required.
- **No environment, backend, or DB changes.** Versioning is client-side
  localStorage; the recruiter-portal backend and cloud snapshots are untouched.
- **No data migration required** — all new fields are optional and
  backward-compatible. Existing projects gain provenance lazily (or via the
  optional cosmetic backfill).
- **Docs:** update `CLAUDE.md` (state-slice + versioning sections) and review
  `README.md` if a user-visible "version history / revert" capability ships
  (it is README-worthy per the README rule).

---

### Appendix — Key files referenced

- Types: `src/types/index.ts`
- Store: `src/store/slices/spineSlice.ts`, `artifactSlice.ts`,
  `branchSlice.ts`, `stalenessSlice.ts`
- UI: `src/components/ProjectWorkspace.tsx`, `ArtifactWorkspace.tsx`,
  `StructuredPRDView.tsx`, `FeatureCard.tsx`, `HistoryView.tsx`,
  `SnapshotsPanel.tsx`
- Snapshots (project-level backup, not per-version): `src/lib/snapshotClient.ts`,
  `api/snapshots`
