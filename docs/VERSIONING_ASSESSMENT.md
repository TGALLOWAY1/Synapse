# Synapse Versioning — Current Assessment & Priority Order

> **Verified against `main` @ `6eec65f` (2026-07-24), immediately after PR #326.**
> This is the single live assessment of the versioning/restore feature. It
> replaces `VERSIONING_AUDIT.md` (Phase 1) and `VERSIONING_V2_PLAN.md` (Phase
> A), both deleted in the same change — their shipped content is described in
> `docs/architecture/VERSIONING_AND_EXPORT.md`, and their unbuilt proposals are
> carried forward below.
>
> Every claim carries `file:line` evidence from the current tree. Re-verify
> before acting on anything here; this document goes stale the moment the code
> moves.

---

## 1. Where versioning stands

**The foundation is sound and should not be redesigned.** PRDs (spines) and
artifacts are append-only arrays of full snapshots with complete provenance;
restore always appends and never deletes history; artifact versions carry
`sourceRefs` lineage to the exact spine and dependency versions they came
from; diffs and freshness are derived at read time and never persisted; and
every versioned collection travels through sync, snapshots and the recovery
bundle. Nothing below proposes changing that model.

**Shipped and verified working** (do not re-litigate):

| Capability | Where |
| --- | --- |
| Append-only spine + artifact versions, full provenance | `spineSlice.ts`, `artifactSlice.ts` |
| Restore-as-new-version for PRD and artifacts | `revertSpineToVersion`, `revertArtifactToVersion` |
| `markArtifactCurrentForSpine` with full ref rebasing | `artifactSlice.ts:282+` |
| Section-aware PRD diff + word diff, computed at view time | `versionDiff.ts`, `VersionCompareView` |
| Change analysis by stable `Feature.id` | `spineChangeAnalysis.ts` |
| Dependency/freshness engine + alignment projection | `artifactDependencyGraph.ts`, `outputAlignment.ts` |
| Two-speed **Sync outputs** flow (Quick + Careful), guarded by a session fingerprint | `outputSyncPlan.ts`, `UpdateAssetsPlanModal` |
| Export version manifest + workflow checkpoint summary | `exportManifest.ts`, `workflowCheckpointSummary.ts` |
| **User overlay edits are versioned** (append-or-amend; destructive ops always append; every write emits an `Edited` event) | `updateArtifactOverlay` (#326) |
| **Images survive version clones** (`imageSourceVersionId` + `effectiveImageVersionId`) | `artifactImageVersion.ts` (#326) |
| **Artifact restore keeps current edits by default**, with explicit opt-in | `revertArtifactToVersion(..., opts)` (#326) |

**The honest summary of what's left:** restore *works* and is no longer
destructive, but it is not yet *trustworthy* — the system contradicts itself
about what a restore invalidated, then abandons the user immediately after
performing one. That is the theme of P1 below.

Two corrections to earlier audit documents, recorded so they are not repeated:
there is **no delete-a-screen action** anywhere in the product (artifact
`content` is never user-editable), and the Update Assets dialog is **not**
dormant — it shipped as the Quick sync surface.

---

## 2. Priority-ordered work

Ranked by user harm × how often it fires, with effort noted. Items within a
band are ordered so earlier ones make later ones easier.

### P1 — Restore is not trustworthy

#### 1. Make staleness truthful, and say it once
**Effort: medium · Risk: medium (shared engine + characterization tests)**

`prd_changed` is still a pure spine-id comparison
(`artifactDependencyGraph.ts:466-479`), and it counts as hard evidence
unconditionally (`:532-539`). Because every restore mints a new spine id
(`spineSlice.ts:724`), **a content-identical restore hard-flags every
artifact** — and `likelyUnaffected` cannot soften it, since
`isLikelyUnaffected` returns false when `!summary.hasChanges`
(`spineChangeAnalysis.ts:249-255`). The change summary needed to know better
is already computed and attached; the verdict just ignores it.

Meanwhile `outputAlignment.ts:131,164-190` independently concludes `aligned`
("the plan version changed, but no structural product change was detected").
The two layers never reconcile, and surfaces are split roughly half and half:

- **Alignment:** artifact header badge (`ArtifactWorkspace.tsx:1311-1320`),
  Project Map node cards (`DependencyGraphView.tsx:374-385`), readiness
  (`ProjectWorkspace.tsx:831,850`).
- **Raw graph:** Screens "Outputs need review" banner
  (`ArtifactWorkspace.tsx:1589-1605`), **the Quick sync modal's own rows**
  (`outputSyncPlan.ts:174-224`), export manifest status column
  (`ExportModal.tsx:176`), the revert warning list
  (`ProjectWorkspace.tsx:1228-1241`), screen and mockup badges
  (`ScreenListView.tsx:780`, `MockupViewer.tsx:364`).

So after a restore the header says **Aligned** while the banner says **Outputs
need review**, and opening Quick sync shows every row amber with **Regenerate
pre-selected** (`outputSyncPlan.ts:224`, `computeRecommendedUpdates` includes
every `needs_update` node). The user is nudged into regenerating outputs that
did not change — real LLM spend and churn — or into per-output "Mark up to
date" busywork to undo a false positive the engine should not have produced.

**Do:** suppress `prd_changed` only on **provable downstream-input equality**,
then pick **one** projection for user-facing text and route every surface in
the list above through it, leaving the engine's statuses as the substrate.
Keep the existing rule that advisory notes never suppress a genuinely hard
state, and keep its tests green.

> **Do NOT key suppression on `summarizeSpineChange`.** The change summary is
> presentation-oriented and deliberately lossy: `renderUxPages`
> (`versionDiff.ts:93-96`) compares only page **name and purpose**, explicitly
> excluding the per-page state fields. But `buildCanonicalPrdSpine`
> (`canonicalPrdSpine.ts:180`) feeds `emptyState`/`loadingState`/`errorState`
> into the canonical spine that drives generation. So a PRD edit touching only
> those fields yields `comparable: true, hasChanges: false` while genuinely
> changing what artifacts would be generated from — keying off it would mark
> real drift as current, which is a worse failure than the false positive this
> item fixes. *(Caught in review of this doc; the same trap applies to any
> future "did anything change?" shortcut built on the diff layer.)*
>
> Compare the **actual generation inputs** instead — e.g. hash the canonical
> spine / structured PRD with the existing `planningContentHash` +
> `stablePlanningStringify` (`planning/planningHash.ts`, already used for
> exactly this kind of version-bound equality check). Fail conservative: when
> either side is unavailable or unhashable (legacy spines with no
> `structuredPRD`), keep the hard `prd_changed`. `summarizeSpineChange` stays
> what it is good at — explaining *what* changed once drift is established.

#### 2. Make restore land somewhere, and disclose what it stranded
**Effort: small–medium · Risk: low**

`handleRestoreSpine` (`ProjectWorkspace.tsx:1243-1250`) calls
`revertSpineToVersion`, closes three modals, and stops. Nothing anywhere reacts
to `changeSource: 'revert'`. Sync outputs is reachable only from three manual
buttons (`ArtifactWorkspace.tsx:1327`, `:1599`,
`DependencyGraphView.tsx:418-434`), so the user must know to go find it.

`revertSpineToVersion` also writes only `spineVersions` + `historyEvents`
(`spineSlice.ts:763-766`), which leaves two things silently wrong:

- **Applied decisions** keep pointing at superseded spines
  (`resultingSpineVersionId`, `types/index.ts:1539,1667-1671`; consumed by
  `downstreamUpdatePlanGeneration.ts:581`, `decisionImpact.ts:797`), so a
  decision still reads as applied although its content was just rolled back.
- **Branches** are anchored by `spineVersionId` and matched by exact equality
  (`branchSlice.ts:22-29,297-300`), so every open branch **disappears from the
  rail** after a restore with no warning and no migration.

**Do:** after a restore, offer the existing Sync outputs plan as a
continuation (P1.1 first, so the plan opens with honest rows and sane
defaults). Extend the restore confirmation beyond its artifact-only warning
(`VersionHistoryPanel.tsx:176-183`) to name the decisions and branches the
restore will strand. Surface only — **never** auto-revert decision events;
user authority stays append-only.

#### 3. Stop cross-tab merges from discarding appended versions
**Effort: small for the append case · medium once same-id divergence is
handled · Risk: medium (silent-loss failure mode if done naively)**

`crossTabMerge.ts:118-136` resolves each project **wholesale**: the side with
the newer `latestProjectActivity` wins and every `ARRAY_COLLECTIONS` entry is
replaced (or deleted). Versions appended in the losing tab are discarded with
no union, no conflict surface, and no warning. The arbiter is a max-timestamp
scan (`:64-84`), so a tab whose only newer work is an appended version loses
to any tab with a fresher unrelated stamp.

This is silent data loss — the same class the project treats as unacceptable
elsewhere.

**Do:** stop replacing `spineVersions` / `artifactVersions` wholesale. Rows
present on only one side must survive the merge; that alone removes the common
case, where each tab appended different versions.

> **Version rows are append-only but NOT immutable, so a plain union by id is
> not sufficient.** Two paths amend an existing version in place, keeping its
> id: `updateArtifactOverlay`'s coalescing branch (overlay edits within a
> session) and `editSpineStructuredPRD`'s `decision_edit` branch
> (`spineSlice.ts:372-385`). Two tabs can therefore hold the *same version id*
> with *different* metadata/content, and a union keyed on id would silently
> drop one tab's edit — reproducing the very loss this item exists to fix.
> *(Caught in review of this doc.)*
>
> So the merge needs an explicit rule for same-id divergent rows. Options,
> cheapest first: prefer the row with the later mutation stamp (requires
> stamping amends, which they do not do today); merge the metadata bags
> key-wise for overlay-edit versions; or treat divergence as a real conflict
> and surface it rather than guessing. Whichever is chosen, it must be
> deliberate — "they're immutable" is not a safe assumption post-#326.

Preserve exactly one `isLatest` / `isPreferred` per entity after the merge.

---

### P2 — The missing capability, and durability

#### 4. Project restore points (one-click rollback with undo)
**Effort: medium–large · Risk: medium**

Rollback is still strictly per-entity. Restoring "the project as it was before
the architecture change" means reverting the PRD and up to eight artifacts by
hand, in the right order, with no grouping and no undo. Every "checkpoint" in
the tree is a *planning readiness* concept (`readinessReview.ts`,
`workflowCheckpointSummary.ts`, `ReadinessCheckpoint.tsx`) — none capture or
restore version state. The only whole-project restore is the owner-token cloud
snapshot (`snapshotClient.ts:675-700`), which wholesale-replaces the project
and is an operator tool, not a user rollback.

**Do:** add a cheap persisted **restore point** — an id-map of
`{ spineVersionId, artifactVersionIds }` plus a name and trigger, capturing
*shape* by reference, not content (single-digit KB). Capture automatically at
plan commit, before the first decision application of a session, before any
multi-artifact regeneration, and **before every restore** (which is what makes
restore undoable), plus a manual "Save restore point". Restoring one is a
single transaction that appends ordinary restore clones for each entity that
differs, stamped with a shared group id and one `ProjectRestored` event —
history stays linear and append-only. Post-restore, offer **Undo** by
restoring the automatically captured pre-restore point.

New persisted collection ⇒ it must travel: `ALL_PROJECT_COLLECTIONS`, snapshot
collectors/restorers + the demo id-remap, demo cleanup, and
`PERSISTENT_STORE_ACTIONS`.

#### 5. Stop losing versions at the storage ceiling
**Effort: small–medium · Risk: low**

On `QuotaExceededError`, recovery runs at most once per episode and can only
prune review/readiness/downstream collections; after that the write is
**discarded** with no retry and no queue (`storage.ts:174-192`), and
`warnQuota` returns early when a toast is already up (`:97`). Newly appended
versions then live in memory only and vanish on refresh. Version history is
deliberately exempt from all pruning (`collectionRetention.ts:299-301`) — the
right call for user data, but it makes unbounded version growth the direct
cause of the episode that then drops writes. The lz-string compression raised
the ceiling; it did not change the failure mode.

**Do:** surface version-storage weight before the cliff (a meter plus an
earlier warning), and make the drop non-silent at the data layer — at minimum
mark the project dirty/unsynced so the durable sync path still carries the
work. Do **not** add a retention cap to user version history.

---

### P3 — Comprehension

#### 6. Comparison depth
**Effort: medium · Risk: low (read-side only)**

- **Any-two compare is impossible.** `toLabel="Current"` is hardcoded and
  there is a single `compareId` (`VersionHistoryPanel.tsx:71,166-173`); every
  caller pins `after` to latest/preferred (`ProjectWorkspace.tsx:2108-2123`,
  `ArtifactWorkspace.tsx:2360-2364`).
- **The system's best identity is unused in diffs.** `diffFeatures` (keyed by
  stable `Feature.id`, `spineChangeAnalysis.ts:59`) feeds staleness headlines
  but is not imported by the compare view, which flattens features to prose
  (`versionDiff.ts:60-71,103`) — so a rename or reorder reads as mass churn
  instead of "Feature X renamed".
- **No structured artifact diff** (screen inventory by stable screen id, data
  model by entity/field) — artifacts diff as one text blob
  (`VersionCompareView.tsx:11-13`).
- **No mockup visual compare**, though every version's images are preserved
  (`MockupVariantsPanel.tsx:588` is explicit that comparisons use metadata,
  not rendered images).
- **No decision before/after view**, even though `applied_to_plan` events
  already store `baselineSpineVersionId` **and** `resultingSpineVersionId`
  (`types/index.ts:1667-1671`) — this one is nearly free: seed the existing
  compare view with two ids that are already persisted.

**Do:** in ascending cost — decision before/after compare, feature-id diff
panel, any-two picker, structured screen/data-model diffs, mockup visual
side-by-side.

#### 7. Version naming and an actionable history
**Effort: small–medium · Risk: low**

Labels are purely positional ("Version N") everywhere
(`ProjectWorkspace.tsx:1206-1209`, `spineSlice.ts:721`, and ~8 other sites
each recomputing `idx + 1`); there is no user-assignable name, so a user
cannot mark a known-good state. `HistoryView.tsx:206-211` and the right-rail
timeline (`ProjectWorkspace.tsx:2617-2650`) still render a **truncated
one-line placeholder** diff, and the only action on any row is "Inspect
readiness review" — you cannot open compare or restore from an event.

**Do:** add an optional user name to versions and restore points (positional
labels stay the identity), subtitle version rows with the deterministic
`summarizeSpineChange` headline, and link history events into the real compare
and restore flows rather than building a second diff renderer.

---

### P4 — Hygiene

#### 8. Retire the exact-id done-check on the blind path
**Effort: small · Risk: low-medium (touches the generation path)**

`isSlotDoneForSpine` is still strict id equality on the preferred version
(`artifactJobController.ts:157-174`), so `pendingSlotsForSpine` (`:730-738`)
treats **every** slot as pending after any restore, and `startAll`
(`ProjectWorkspace.tsx:1534-1547`) regenerates all of them. This is now
largely unreachable — `assetsReady` is spine-independent
(`ProjectWorkspace.tsx:1408-1422`), so the outputs pill opens review instead —
but it still fires whenever any visible slot lacks a version (never generated,
or errored/interrupted), and when it fires it rebuilds content-identical
outputs too. Fold this path into the Sync outputs plan (or make the done-check
content-aware once P1.1 lands).

#### 9. Small debts created or exposed by recent work
**Effort: small · Risk: low**

- **Image GC must respect the new pointer.** The eager-GC item in
  `tasks/TODO.md:132` must treat a version's records as live while any other
  version's `imageSourceVersionId` references it, or GC will re-create the
  orphaning #326 fixed. The invariant is documented at
  `artifactImageVersion.ts:34-35`.
- **`promptEdits` is a dead overlay key** with a live read: nothing writes it,
  yet `artifactDependencyGraph.ts` still treats it as a manual-edit signal.
  Either remove it (and from `OVERLAY_METADATA_KEYS`) or give it a writer.

---

## 3. Explicitly not planned

- **Git-style branching / parallel project lineages.** The single append-only
  chain is what keeps positional labels, one `isLatest`, and one staleness
  baseline coherent. The 90% need ("try a different direction without losing
  this one") is better served by a Duplicate Project action.
- **Diff-only storage.** Full snapshots make restore trivially safe and
  compare trivially correct; PRDs are kilobytes.
- **Per-version server storage or per-version sync merge.** Sync stays
  whole-bundle with explicit conflict resolution.
- **Model-authored version summaries or verdicts.** Change headlines stay
  deterministic; decision authority stays user-only and append-only.
- **A retention cap on user version history.**

---

## 4. Suggested sequencing

P1.1 → P1.2 are one coherent slice and should ship together: fixing the false
positive first means the restore continuation opens a plan that tells the
truth. P1.3 is independent; its append-only half is small and worth taking
early, while the same-id divergence rule deserves its own decision rather than
being bundled in. P2.4 (restore points) is the largest remaining build and
benefits from P1 landing first, because its post-restore Undo depends on the
same continuation surface.
