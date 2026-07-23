# Synapse Versioning V3 — Restore & Rollback: Audit and Proposal

> Status: **Proposal for approval — nothing implemented.** Audited against the
> live codebase on 2026-07-23. Builds on `docs/VERSIONING_AUDIT.md` (Phase 1,
> shipped) and `docs/VERSIONING_V2_PLAN.md` (Phase A, **partially** shipped —
> see the status correction in §2.4: the Update Assets plan dialog described as
> live in prior docs is currently unwired). Scope: whether users can reliably
> understand, compare, and restore earlier project states — full-project
> rollback, artifact-level restoration, and conflict handling.

---

## 1. Executive summary

Phase 1 + Phase A built a genuinely solid foundation: append-only full-snapshot
versions for both PRDs (spines) and artifacts, complete provenance stamping,
restore-as-new-version for both entity kinds, a section-aware PRD diff, an
id-based dependency/freshness engine with change-aware summaries, and an
export manifest. **Nothing in the system deletes history**, and that invariant
is worth protecting in everything below.

But measured against the question "can a user *reliably* get back to a
previous good state?", the audit found six load-bearing defects:

1. **Overlay edits are destructive and invisible to versioning.** Screen
   edits/deletions, extra screens, prompt edits, and plan progress mutate the
   preferred `ArtifactVersion.metadata` in place — no version, several paths
   emit no history event, and the previous state is unrecoverable. Deleting a
   screen by accident is exactly the scenario this task targets, and today it
   cannot be undone.
2. **Artifact restore silently discards newer overlay work.**
   `revertArtifactToVersion` clones the *old* version's metadata, so restoring
   content also reverts every screen edit, dismissed issue, and plan-progress
   tick made since — with no warning and no choice.
3. **There is no project-level restore point.** Rollback is strictly
   per-entity. Restoring "the project as it was before the architecture
   change" means manually reverting the PRD and up to eight artifacts one by
   one, in the right order, with no grouping and no undo.
4. **Restoring a PRD dead-ends in the full-regeneration funnel.** A revert
   lands `isFinal: false`; re-committing runs `startAll`, whose done-check is
   an exact spine-id match — so restoring the very version everything was
   generated from still queues a full rebuild of every artifact. The
   per-asset Update Assets plan built to fix this exists, is tested, and is
   **rendered nowhere**.
5. **The system contradicts itself about staleness after a revert.** The
   badge layer (id-based) marks everything `needs_update`; the alignment layer
   (content-aware) says `aligned`. The revert confirmation warns that a
   content-identical restore "may invalidate" every artifact. Users cannot
   trust warnings that are sometimes false.
6. **Restoring a mockup loses its images.** Rendered images are keyed by
   artifact version id in IndexedDB with no fallback chain, and every
   restore/mark-current appends a clone under a fresh id — so the restored
   version's screens come up image-less. Any new clone-appending mechanism
   (including overlay versioning) inherits this unless image continuity is
   solved first (§4.8).

The proposal keeps the shipped model — append-only snapshots, opaque ids,
positional labels, `sourceRefs` lineage — and adds four capabilities on top:
**overlay versioning** (stop the data loss), a **restore planner** (one guided
surface for the downstream consequences of any restore), **project restore
points** (id-map checkpoints enabling one-click full rollback with undo), and
**comparison depth** (any-two compare, feature/screen-identity diffs,
before/after a decision). Prioritized plan in §9.

---

## 2. Current-state audit (verified)

### 2.1 What exists and works

| Capability | Evidence |
| --- | --- |
| Append-only PRD versions; every user edit/retry/merge/revert appends; provenance (`changeSource`, `editSummary`, `revertedFromVersionId`) stamped on all paths | `spineSlice.ts` (`editSpineStructuredPRD`, `regenerateSpine`, `revertSpineToVersion`), `branchSlice.mergeBranch` |
| PRD restore-as-new-version with confirm modal + downstream warning list | `revertSpineToVersion` (spineSlice.ts:711-769), `RevertConfirmModal` |
| Artifact versions with `versionNumber`, `parentVersionId`, `sourceRefs` (spine + dependency lineage); restore appends an honest clone | `artifactSlice.createArtifactVersion` / `revertArtifactToVersion` |
| `markArtifactCurrentForSpine` — append-clone with fully rebased refs (spine + dependencies + tokensHash) | artifactSlice.ts:263-363 |
| Decision→PRD write barrier records `baselineSpineVersionId` and `resultingSpineVersionId` on every `applied_to_plan` event | `compareAndAppendStructuredPRD` (spineSlice.ts:620-629) |
| Section-aware PRD diff + word diff, computed at view time; nothing persisted | `versionDiff.ts`, `VersionCompareView` |
| Change analysis by stable `Feature.id` (`diffFeatures`, `summarizeSpineChange`, `findFeatureReferences`, affinity annotations) | `spineChangeAnalysis.ts` |
| Dependency/freshness engine with reasons (`prd_changed`, `dependency_changed`, `design_tokens_changed`) + change summaries; alignment projection on top | `artifactDependencyGraph.ts`, `artifactFreshness.ts`, `outputAlignment.ts` |
| Version metadata travels everywhere — all 23 array collections (spineVersions, artifactVersions, historyEvents, planning, downstream, review) ride sync, snapshots, recovery | `projectBundle.ts` `ALL_PROJECT_COLLECTIONS` |
| Version history panels for PRD + artifacts with provenance badges, compare-vs-current, restore | `VersionHistoryPanel`, wired in `ProjectWorkspace` + `ArtifactWorkspace` |
| Export manifest with per-asset version + staleness; stale-export warning banner | `exportManifest.ts`, `ExportModal` |

### 2.2 Reliability defects

**D1 (P0) — Overlay edits mutate in place; several emit no event.**
`updateArtifactVersionMetadata` (artifactSlice.ts:405-453) spreads a patch
onto the current version's metadata under the same version id. All user-edit
overlays route through it: `screenEdits` (screen detail edits *and screen
deletion*, ArtifactWorkspace.tsx:737), `extraScreens` (:763, **no history
event**), `screenLinks` (:715, silent), `dismissedScreenIssues` (:724,
silent), `promptEdits`, `planProgress`. No version is appended; the prior
overlay state is overwritten. **A deleted screen, a lost prompt edit, or
cleared plan progress is unrecoverable through any history surface, and some
of these leave no audit trace at all.**

**D2 (P0) — Artifact restore drops current overlays.**
`revertArtifactToVersion` clones `content`, `metadata`, and `sourceRefs` from
the *source* (old) version (artifactSlice.ts:218-220). Restoring older content
therefore silently reverts every overlay edit made since — the exact
"restore one artifact without overwriting unrelated newer work" failure. The
confirm modal for artifact restore shows no warning at all
(`staleArtifactTitles` is forced empty, VersionHistoryPanel.tsx:177).

**D3 (P1) — No multi-entity restore.** All revert actions are per-entity.
The only whole-project restore is the owner-token cloud snapshot
(`restoreSnapshot`, snapshotClient.ts:675+), which wholesale-replaces every
collection — a backup facility, not a user rollback (and it discards all
newer work without itemizing it).

**D4 (P1) — The post-restore/regeneration funnel.** Every appended spine —
edit, decision, revert — is `isFinal: false`. The Build surface requires a
committed plan; re-committing runs `artifactJobController.startAll`, whose
pending filter is an exact spine-id match on the preferred version's spine
ref (`isSlotDoneForSpine`, artifactJobController.ts:158-174). Restoring the
PRD version all assets were generated from still regenerates *everything*.
The surgical alternative exists as dormant machinery — see §2.4.

**D5 (P1) — Contradictory staleness after revert.** `revertSpineToVersion`
mints a new spine UUID, and the engine's `prd_changed` check is pure id
comparison (artifactDependencyGraph.ts:465), so a content-identical restore
hard-flags every artifact `needs_update` in `FreshnessBadge`, the graph, and
the export manifest (confirmed as current intended behavior by
artifactFreshness.test.ts:124). The alignment layer computes the truth —
`outputAlignment.ts:172-190` reports `aligned` ("plan version changed, but no
structural product change") — but the badge layer never reconciles with it,
and `getStaleArtifactTitles` (ProjectWorkspace.tsx:685-698) makes the revert
confirm over-warn. Two vocabularies, opposite answers, same screen.

**D6 (P2) — Restore leaves planning and branches unreconciled.** Spine revert
touches only `spineVersions` + `historyEvents`. Decisions already
`applied_to_plan` against the now-superseded versions still read as applied
though their content is no longer in the latest spine; open branches stay
anchored to superseded spine ids and are silently stranded
(`getBranchesForSpine` filters by exact id). Nothing surfaces either fact at
restore time. (Per the authority model, decision events must *never* be
auto-reverted — but the user should see what a restore disconnects.)

**D7 (P3) — Silent persistence failure is the real history-loss vector.**
Version history is exempt from all retention pruning (correct), but on
localStorage quota exhaustion the recovery sweep can only shed
review/readiness collections; after that, `safeSetItem` swallows quota errors
— newly appended versions live in memory only and vanish on refresh (a sticky
toast warns, but the data-layer loss is silent). The 8 MB sync body limit is
a reject-not-truncate cliff on the same growth curve.

**D8 (P3) — Whole-project sync vs. restore.** Sync is whole-bundle
last-writer-wins per revision with explicit conflict resolution. A revert
competing with newer work on another device either 409s into a project-level
conflict or, if it wins, replaces the other device's bundle; "Use cloud"
resolution discards the local device's entire version history. No per-version
merge exists (and building one is out of scope) — but conflict resolution
currently offers no restore point to fall back on.

**D9 (P1) — Append-clones orphan per-version images today.** Mockup,
screen-inventory, and mockup-variant images live in IndexedDB keyed
`versionId:screenId:quality` (mockupImageStore.ts:31-39), and viewers resolve
strictly by the displayed version's id with no fallback chain
(`MockupScreenImage.tsx:56`). `revertArtifactToVersion` and
`markArtifactCurrentForSpine` mint new version ids without copying or
aliasing image records — so restoring (or confirming-current) a mockup
version yields a preferred version whose screens render **image-less**,
degrading to the per-screen generate/upload state. The Screens architecture
already works around exactly this for coverage: `extraScreens` was made an
overlay *because* "appending a version would orphan every existing render"
(SCREENS_EXPERIENCE.md, mockup-coverage rule). Any mechanism in this
proposal that appends clones of image-bearing versions — overlay versioning,
artifact restore, mark-current, checkpoint restore — must solve image
continuity first (§4.8), and the fix also repairs today's restore behavior.

### 2.3 Usability gaps

- **Compare is hardwired to "vs current"** — both call sites pin the `after`
  side (VersionHistoryPanel.tsx:165-167). "Compare the project before and
  after decision X" is impossible even though `applied_to_plan` events
  already store both spine ids.
- **The compare view ignores the system's stable identities.** Features,
  entities, and UX pages are flattened to prose before diffing
  (versionDiff.ts:63-96) — a renamed feature reads as word-churn noise, not
  "Feature renamed". `diffFeatures` (by `Feature.id`) exists in
  `spineChangeAnalysis.ts` but is not wired into the compare view. No
  structured screen-inventory diff (stable screen ids exist), no mockup
  visual compare (every version's images are preserved in IndexedDB).
- **Versions have no user-meaningful names.** All labels are positional
  ("Version N"); `editSummary` is auto-generated. Nothing lets a user pin or
  name a known-good state ("Before architecture pivot").
- **History surfaces are inert and fragmented.** `HistoryView` and the
  right-rail timeline render one-line placeholder diffs and offer no
  compare/restore action (the only route is timeline → read-only banner →
  restore). PRD history, per-artifact history, and the event feed are three
  disconnected surfaces; no single place answers "what changed in this
  project, and how do I go back?"
- **`decision_edit` coalescing hides intermediate states.** Consecutive
  Decision Center answers amend the latest spine in place under the same id
  (guarded: never on final or artifact-referenced versions —
  spineSlice.ts:410-454). Acceptable by design, but a checkpoint boundary
  before the *first* decision application would preserve a "before decisions"
  restore target (see §4.5).

### 2.4 Status correction — dormant machinery and doc drift

`docs/VERSIONING_V2_PLAN.md` and `docs/architecture/VERSIONING_AND_EXPORT.md`
describe the re-finalize **Update Assets plan** as shipped
(`finalizeAndGenerate` → `UpdateAssetsPlanModal`). In the current tree that
wiring does not exist: `finalizeAndGenerate` is gone (finalize became the
readiness-commitment flow: `commitReadinessReview` →
`FinalizationSuccessModal` → `startAssetGeneration` → `startAll`,
ProjectWorkspace.tsx:917-1014), and `UpdateAssetsPlanModal`,
`evaluateProjectFreshness`'s `asOfSpineId` option, and
`expandSelectionWithTroubledUpstreams` are referenced **only by tests and the
barrel export** — zero live render/call sites. The component and its logic
are healthy dormant machinery; the docs are drifted. This proposal treats
re-wiring them (at both the re-commit edge and the new restore edge) as part
of the plan (§9 R2), and the drifted docs should be corrected in the same
change that lands it.

---

## 3. Scenario walkthroughs (today's behavior)

**S1 — "I accidentally deleted a screen / feature / requirement."**
- *Feature or requirement (PRD)*: recoverable. The deletion appended a spine
  version; Version History → Compare → Restore works. The diff, however,
  shows word-churn rather than "Feature 'X' removed", and restore drops into
  the D4 funnel.
- *Screen (screen-inventory overlay) / extra screen / prompt edit*:
  **unrecoverable** (D1). No version, sometimes no event, no undo.

**S2 — "I changed the architecture; restore the previous approach."**
The PRD side works (S1a). But "the previous approach" is PRD + data model +
implementation plan + screens *together*: the user must revert each entity
manually (D3), the restored PRD hard-flags everything stale (D5), and
re-committing regenerates all assets — including ones the user wanted to keep
from the restored era (D4). High-friction, low-confidence.

**S3 — "I revised the PRD; downstream UX/screens/plans were better before."**
Artifact-level restore exists and doesn't touch the PRD — good. But it
silently reverts newer overlay work (D2), shows no warning, and the restored
artifact immediately reads `needs_update` because its spine ref points at an
older spine id — with no "keep it and confirm current" offer at restore time
(the mark-current action exists but is only discoverable from staleness
surfaces).

**S4 — "Compare the project before and after a major decision."**
Not possible as a flow. The data is fully present — `applied_to_plan` events
carry `baselineSpineVersionId` → `resultingSpineVersionId` — but no surface
links a decision to a compare, and compare can't take two arbitrary versions
anyway. Consecutive coalesced decision edits (§2.3) also blur individual
decisions' boundaries within one version.

**S5 — "Restore one artifact without overwriting unrelated newer work."**
Restoring artifact A never touches artifact B or the PRD — correct. Within
the artifact, D2 makes the promise false: overlays are newer work and they
are overwritten.

**S6 — "Restoring an old version would create conflicts / invalidate
downstream artifacts."**
The system never blocks (correct) and warns (partially): the PRD revert modal
lists artifacts that "may" go stale — over-broadly (D5) — and offers no
remediation path; artifact restore warns of nothing. After confirming, the
user is left to discover consequences via badges, then the D4 funnel. Planning
records and branches disconnect silently (D6). Cross-device, a restore is an
ordinary whole-bundle push (D8).

---

## 4. Proposed versioning model

Guiding principles (all already established in this codebase — the proposal
extends them, never replaces them):

- **Append-only forever.** Every restore appends; history is never mutated or
  deleted (cross-cutting rule 11).
- **Full snapshots + read-time derivation.** No diff storage, no persisted
  staleness, no new engines (rules 9, 10).
- **Additive, optional fields only.** Legacy localStorage data loads
  unchanged (rule 3). New persisted collections wire the full travel chain
  (rule 6).
- **User authority is untouchable.** Restores never write or revert
  `DecisionEvent`s; planning consequences are surfaced, not auto-fixed
  (rule 13).
- **No VCS vocabulary.** "Restore point", "restore", "keep", "changed" — not
  branch/HEAD/rebase.

### 4.1 What should be versioned

| Layer | Today | Proposed |
| --- | --- | --- |
| PRD spine | Versioned (append-only) | Unchanged |
| Artifact content | Versioned (append-only) | Unchanged |
| **Artifact overlays** (screenEdits, extraScreens, promptEdits, planProgress, screenLinks, dismissedScreenIssues) | **Mutated in place** | **Versioned** via append-or-amend (below) |
| Project shape (which versions are preferred together) | Not captured | **Restore points** — persisted id-maps (§4.5) |
| Planning records / decisions | Append-only event log (its own complete history) | Unchanged — never versioned, never reverted |
| Derived layers (freshness, alignment, readiness, diffs) | Computed at read time | Unchanged — never persisted |

**Overlay versioning (fixes D1).** Route all overlay writes through one new
store action (`updateArtifactOverlay`) that follows the precedented
append-or-amend pattern from `editSpineStructuredPRD`'s `decision_edit`
branch:

- If the preferred version is itself an overlay-edit version (provenance
  `changeSource: 'user_edit'` + a new optional `provenance.overlayEdit: true`)
  and is not referenced by any downstream artifact's `sourceRefs`, **amend it
  in place** — consecutive tweaks in an editing session coalesce into one
  version instead of one version per keystroke.
- Otherwise **append a clone** of the preferred version carrying the merged
  metadata (existing merge-from-current rule so unknown overlay keys survive
  — rule 12), stamped `user_edit` + `overlayEdit`, with an `editSummary`
  naming the surface ("Edited screen 'Checkout'", "Removed screen 'Cart'").
- **Destructive overlay operations always append** (screen delete, extra
  screen removal, prompt reset) — the pre-deletion state must be its own
  restorable version, never coalesced away.
- Every overlay write emits an `Edited` history event (fixing the silent
  `extraScreens`/`screenLinks`/`dismissedScreenIssues` paths).

Storage cost is modest: overlay-bearing artifacts are text; amend-coalescing
bounds version count; quota behavior is unchanged (and §9 R5 addresses the
growth curve). **Prerequisite:** for image-bearing artifacts (mockups —
including `extraScreens` — screen inventory, variants), overlay appends
depend on the image-continuity indirection in §4.8; without it, every
appended version would orphan its renders (the exact reason
SCREENS_EXPERIENCE.md currently forbids appending a version for mockup
coverage).

### 4.2 Naming and labels

- **Keep positional labels as identity** ("Version N" from array position /
  `versionNumber`) — never parsed from ids (rule 11). They stay the primary
  label everywhere.
- **Add an optional user-assigned `name`** to `SpineVersion`,
  `ArtifactVersion`, and restore points ("Before architecture pivot").
  Rendered as `Version 6 — "Before architecture pivot"`. Renaming is a
  metadata write, never a new version.
- **Auto-subtitle every PRD version row** with the deterministic headline
  from `summarizeSpineChange` vs. its predecessor ("1 feature removed ·
  Architecture changed") — the list becomes scannable without opening diffs.
  Never an LLM call.
- Provenance badges stay as shipped (Generated / Regenerated / Edited /
  Restored / Branch merge / Decisions / Confirmed current), plus restore
  points get trigger labels (Manual / Before restore / Plan committed /
  Decision applied).

### 4.3 Comparison

- **Any-two selection.** `VersionHistoryPanel` gains a second picker; the
  compare view already takes arbitrary before/after inputs — only the call
  sites pin `after` to current today.
- **Identity-aware PRD diff.** Wire `diffFeatures` (stable `Feature.id`) into
  `VersionCompareView`: a "Features" panel listing Added / Removed / Renamed /
  Changed per feature, above the existing per-section word diffs. Same
  treatment later for entities and UX pages.
- **Structured artifact diffs** where stable ids exist: screen inventory
  diffed by stable screen id (added/removed/changed fields), data model by
  entity/field. Prose artifacts keep the word diff.
- **Overlay-aware diff.** When two artifact versions differ in overlays, show
  a distinct "Your edits" section (screens edited/deleted, progress changes)
  instead of burying overlay JSON in a content diff.
- **Before/after a decision (fixes S4).** In the Decision Center's resolved
  view, a decision whose `applied_to_plan` event exists gets **"Compare plan
  before / after this decision"** → `VersionCompareView` seeded with
  `baselineSpineVersionId` ↔ `resultingSpineVersionId`. Pure UI over data
  already persisted. Additionally, create an automatic restore point before
  the *first* decision application in a session (§4.5) so the coalesced-edit
  window always has a stable "before" anchor.
- **History becomes actionable.** `HistoryView` and the right-rail timeline
  drop the placeholder one-liners and link each version-bearing event into
  the real compare view (and restore, via the existing confirm flow).
- **Mockup visual compare** (later phase): side-by-side per-screen image
  gallery for two versions — all images are already preserved per version id
  in IndexedDB.

### 4.4 Dependencies and truthful staleness

Keep the id-based `sourceRefs` lineage and the single freshness engine
exactly as they are (rule 9). Two reconciliations:

1. **Restores re-baseline what they provably didn't change.** When a restore
   appends the new spine, the same transaction applies
   `markArtifactCurrentForSpine` semantics (append-clone, fully rebased refs)
   to every artifact whose preferred version's spine ref pointed at the
   restored-*from* spine id — i.e., artifacts generated from exactly the
   content being restored. Restoring the state everything was built from then
   yields **zero** stale badges, honestly (each confirmation is a labeled
   version + `MarkedCurrent` event). Anything not provably matched stays
   stale, as today. Comparison is by spine-version id (exact), optionally
   extended to the structured-PRD content hash the planning layer already
   computes (`planningContentHash`) — never a heuristic.
2. **One user-facing vocabulary.** The alignment projection
   (`getProjectOutputAlignment`) becomes the presentation source for every
   user-facing staleness surface (badges, revert warnings, export banner);
   the engine's statuses/reasons remain the substrate and remain untouched.
   Concretely: `FreshnessBadge` and `getStaleArtifactTitles` consume
   alignment states, so a version-id-only drift with no structural change
   reads "Plan version changed — no content change detected · Confirm" as an
   advisory, not a red `needs_update`. This is presentation reconciliation on
   top of the engine — not a second engine, and advisory notes still never
   suppress genuinely hard states (existing rule, kept tested).

### 4.5 Full-project rollback: restore points

A new lightweight persisted collection — **`projectCheckpoints`** — capturing
the *shape* of the project at a moment, by reference only (no content
duplication; single-digit KBs):

```ts
type ProjectCheckpoint = {
  id: string;
  projectId: string;
  createdAt: string;
  name?: string;                       // user-assigned
  trigger: 'manual' | 'pre_restore' | 'plan_commit'
         | 'decision_apply' | 'pre_regeneration';
  spineVersionId: string;              // isLatest at capture
  artifactVersionIds: Record<string /* slotKey */, string>; // preferred ids
  designTokensHash?: string;
  decisionEventRef?: { recordId: string; eventId: string }; // trigger context
};
```

- **Automatic capture** at the moments users later wish they could return to:
  plan commit (finalize), immediately before applying the first decision
  impact of a session, before any multi-artifact regeneration, and before
  every restore (`pre_restore` — this is what makes restore undoable).
  **Manual capture** ("Save restore point…") with a name, from the History
  stage and the PRD overflow menu. Auto-captures dedupe: no new checkpoint if
  the id-map is unchanged.
- **Restoring a checkpoint** is one store transaction (all reads inside
  `set()`, rule 1) that: (1) captures a `pre_restore` checkpoint; (2) appends
  a revert clone of the checkpoint's spine (existing `revertSpineToVersion`
  semantics) if the latest differs; (3) for each artifact whose preferred
  version differs, appends a restore clone (`revertArtifactToVersion`
  semantics, overlay policy per §4.6) re-pointed at the new spine per §4.4;
  (4) stamps every appended version's provenance with a shared
  `restoreGroupId`; (5) emits one `ProjectRestored` history event naming the
  checkpoint. History stays fully linear and append-only — a checkpoint
  restore is just a batch of ordinary restores that travel together.
- **Undo** is first-class: the post-restore toast/banner offers "Undo
  restore", which restores the automatically captured `pre_restore`
  checkpoint. No special machinery — the same transaction in reverse.
- **Retention:** checkpoints are id-maps, cheap, and never pruned while any
  referenced version exists (versions are never pruned today, so effectively
  never). Manual/named checkpoints are always pinned.

This deliberately does **not** introduce branching or parallel lineages
(explicitly deferred in V2, still right): one linear chain, one `isLatest`,
one staleness baseline.

### 4.6 Artifact-level restoration

`revertArtifactToVersion` gains an explicit **overlay policy** (fixes D2):

- **Default: "Keep my edits"** — the restore clone takes the old version's
  `content` and `sourceRefs` but merges the *current* preferred version's
  overlay metadata on top (spread-merge, unknown keys survive — rule 12).
  Overlay entries referencing screens absent from the restored content are
  retained harmlessly (readers already tolerate unknown keys).
- **Option: "Also restore that version's edits"** — today's behavior, now
  opt-in and labeled.
- The restore confirm for artifacts stops being warning-free: it states the
  overlay choice, and — when the artifact has dependents (e.g. design system
  → mockups; screen inventory → downstream) — lists them via the existing
  dependency graph, with the same planner treatment as §4.7.

### 4.7 Conflict handling: the restore planner

One guided surface — resurrecting the dormant `UpdateAssetsPlanModal`
machinery (`asOfSpineId` evaluation, `computeRecommendedUpdates`,
`expandSelectionWithTroubledUpstreams`) — wired at **three edges**:

1. **PRD restore** (single-version or checkpoint): after the confirm, before
   the transaction commits, show the plan: the change summary of what
   restoring alters ("Restores Version 3 · 2 features return, Architecture
   reverts"), then each downstream asset grouped by *real* impact:
   - **Unchanged by this restore** (content-identical / auto-re-baselined,
     §4.4) — no action needed;
   - **Likely unaffected** (advisory affinity note) — default "Keep &
     confirm current";
   - **Affected** (structural change touches its sections / references a
     removed feature) — default "Regenerate", ordered by the graph's
     topological batches; per-row override to Keep / Decide later.
   Restore itself is **never blocked** and never silently regenerates —
   "Decide later" leaves honest stale badges.
2. **Plan re-commit** (the D4 funnel): re-commit with existing assets routes
   through the same planner instead of blind `startAll` (first
   commit unchanged). This is the V2 §3.3 design, finally wired, now sharing
   one component with the restore edge.
3. **Artifact restore with dependents** (§4.6).

Planning and branch consequences are **surfaced, never auto-fixed** (D6): the
planner includes an advisory section listing decisions whose
`resultingSpineVersionId` is being superseded ("3 decisions were applied
after this point — they remain recorded; review them in the Decision Center",
deep-linked) and branches anchored to superseded versions (offer archive;
re-anchoring is a later enhancement). No decision events are written.

**Sync (D8):** a restore is an ordinary revisioned push — the existing 409 /
conflict-banner model already prevents silent clobbering. Two cheap
safeguards: capture a local checkpoint automatically before either conflict
resolution ("Use cloud" no longer silently destroys the local timeline —
there's a restore point and the existing recovery download), and include
checkpoints in `ALL_PROJECT_COLLECTIONS` so they travel. Per-version merge of
diverged bundles stays out of scope.

### 4.8 Image continuity across append-clones (fixes D9)

Every mechanism above that appends a clone of an image-bearing version
(mockup, screen inventory, mockup variants) must keep that version's rendered
images reachable. Copying 1–3 MB IndexedDB records per clone would multiply
storage; instead, add **read-time indirection**:

- New optional `metadata.imageSourceVersionId` on `ArtifactVersion`, stamped
  by every clone-appending action (`revertArtifactToVersion`,
  `markArtifactCurrentForSpine`, overlay appends, checkpoint restores) with
  the id whose images the clone inherits — the source version's own
  `imageSourceVersionId` if set (chains collapse to the origin at write time,
  so lookup is always one hop), else the source version's id.
- Image consumers (`MockupScreenImage`, screen-inventory and variant
  viewers) resolve the **effective image version id**
  (`metadata.imageSourceVersionId ?? version.id`) before building keys. New
  generations on a clone write under the clone's own id and shadow inherited
  records per screen/quality (read own-id first, then inherited).
- The image **sync collector** (`projectImageSync.ts`) and **snapshot
  collectors** (`snapshotClient.ts`) already iterate all versions, and
  records live once under the origin id, so captured sets stay complete
  without duplication; the demo restore id-remap must rewrite
  `imageSourceVersionId` alongside version ids (same remap pass).
- `extraScreens` keeps its documented rationale satisfied: with indirection,
  the overlay-append path no longer orphans renders, so it can join overlay
  versioning (§4.1) instead of being excluded from it. The SCREENS_EXPERIENCE
  "never a new ArtifactVersion" rule for mockup coverage is superseded by
  this mechanism and must be updated in the same change that lands it.
- Future image GC (the existing TODO) must treat a version's images as live
  while any version's `imageSourceVersionId` points at it.

This is a prerequisite inside R1 (overlay versioning would otherwise regress
mockups) and independently fixes today's image-less mockup restores (D9).

---

## 5. Critical user flows (target behavior)

**F1 — Undo a deleted screen (minutes ago).**
Screens view → the deletion appended a version + `Edited` event → artifact
header "Version history" → newest rows read "Removed screen 'Cart'" →
Restore previous version (default keeps other newer edits) → screen back, no
other work touched. *(Enabled by R1.)*

**F2 — Roll the whole project back past an architecture change.**
History stage → Restore points → "Plan committed — Jul 20" (or a named manual
point) → Restore → planner shows "Architecture reverts; Data Model &
Implementation Plan return to their Jul 20 versions; Screens unchanged" →
confirm → one `ProjectRestored` event, all badges truthful, toast offers
Undo. *(R3, planner from R2.)*

**F3 — Keep the PRD, bring back yesterday's screens.**
Screens artifact → Version history → compare (screen-id diff: "3 screens
removed since") → Restore with "Keep my edits" default → planner notes
dependents → choose "Keep & confirm current" → restored version marked
current for today's PRD; nothing else regenerates. *(R1 + R2.)*

**F4 — Compare before/after a decision.**
Decision Center → resolved decision → "Compare plan before / after this
decision" → seeded compare (feature-id panel + section diffs). *(R4.)*

**F5 — Restore the PRD everything was generated from.**
PRD Version History → Restore Version 4 → planner: "All 8 assets were
generated from this exact version — they'll be confirmed current
automatically" → confirm → zero stale badges, re-commit regenerates nothing.
*(R2.)*

**F6 — Restore that genuinely invalidates downstream.**
Restore removes a feature added later → planner: "Feature 'Referrals' will be
removed. Still referenced by: User Flows, Screens (2), Implementation Plan" →
defaults: those three Regenerate (ordered), others Keep → user unchecks User
Flows ("Decide later") → restore commits; User Flows carries an honest
"references removed feature" stale reason until acted on. *(R2, reference
scan already exists in `findFeatureReferences`.)*

---

## 6. Recommended UI behavior

- **One entry point per altitude, all reachable in ≤2 clicks:** per-artifact
  history where it is today; PRD history where it is today; the **History
  stage becomes the project-level home** — restore points list (named +
  automatic) above the event timeline, every version-bearing event linking
  into compare/restore. No fourth surface.
- **Restore is always: pick → see consequences → confirm → undo.** Every
  restore path funnels through the planner (even when the planner has nothing
  to say — then it's a one-line confirm). Post-restore toast with Undo.
- **Warnings must be true.** The over-broad "may invalidate everything" list
  is replaced by the planner's three honest groups (§4.7). A warning that
  can't distinguish "provably unchanged" from "affected" trains users to
  ignore it.
- **Labels:** positional identity + optional name + deterministic change
  headline + provenance badge (§4.2). Restore-created versions read
  "Version 9 — Restored from Version 3" and checkpoint restores group under
  one event.
- **Copy explains append-only once, where it matters:** "Restoring creates a
  new version — nothing is deleted" stays in the confirm (already shipped
  copy), and the version list renders restore clones normally so the model
  teaches itself.
- Responsive: reuse the existing modal/sheet patterns; no new paradigms.

---

## 7. Data-model implications

All additive and optional; zero migrations; legacy projects load unchanged.

| Change | Where | Notes |
| --- | --- | --- |
| `provenance.overlayEdit?: boolean`, `provenance.restoreGroupId?: string`, optional `name?: string` on versions | `src/types/index.ts` (`VersionProvenance`, `SpineVersion`, `ArtifactVersion`) | Optional fields; display-only consumers. |
| `ProjectCheckpoint` + `projectCheckpoints: Record<projectId, ProjectCheckpoint[]>` | types + new store slice | **Must wire the full travel chain** (rule 6): `ALL_PROJECT_COLLECTIONS`, snapshot collectors/restorers + `namespaceSnapshotForRestore` (id-map remapping on demo restore — same pattern as artifact-version remap), demo cleanup, `PERSISTENT_STORE_ACTIONS` guard. |
| `updateArtifactOverlay` store action | `artifactSlice` | Append-or-amend per §4.1; all reads inside `set()` (rule 1); existing `updateArtifactVersionMetadata` becomes internal. |
| `restoreProjectCheckpoint` store action | new slice / `projectSlice` | One transaction per §4.5; stamps `changeSource: 'revert'` on every appended version (rule 11). |
| Overlay policy param on `revertArtifactToVersion` | `artifactSlice` | Default keep-current-overlays (merge). |
| `metadata.imageSourceVersionId?: string` + effective-image-id resolution | types; clone-appending actions in `artifactSlice`; `MockupScreenImage` / screen-inventory / variant viewers; demo-restore id remap in `snapshotClient` | §4.8. One-hop chain (collapsed at write time); image stores and sync/snapshot collectors unchanged; SCREENS_EXPERIENCE.md coverage rule updated in the same change. |
| `HistoryEventType` += `ProjectRestored`, `CheckpointCreated` | types + emitters + `HistoryView`/timeline config maps | |
| Alignment-driven presentation for badges/warnings | `FreshnessBadge`, `ProjectWorkspace.getStaleArtifactTitles`, `ExportModal` | Consumes existing `getProjectOutputAlignment`; engine untouched. |
| Planner wiring | `ProjectWorkspace` (restore + re-commit edges), `UpdateAssetsPlanModal` (already built) | Plus `asOfSpineId` goes live; docs drift in `VERSIONING_AND_EXPORT.md` / `VERSIONING_V2_PLAN.md` corrected in the same change. |

Deliberately **not** added: content-diff storage, per-feature version chains,
parallel lineages/branching, persisted staleness, decision-event mutation,
a second freshness engine, server-side per-version storage.

---

## 8. Risks

| Risk | Mitigation |
| --- | --- |
| **Storage growth** from overlay versions + restore/mark-current clones (quota cliff D7, 8 MB sync ceiling) | Amend-coalescing bounds overlay versions; clones are text-only; R5 adds a storage meter + earlier warning. If needed later: content-pointer dedup for byte-identical clones (deferred — adds reconstruction complexity). Never prune user versions. |
| **Auto-re-baseline masking real drift** (§4.4) if the "provably unchanged" test is loose | Exact spine-id match (optionally exact structured hash) only — never affinity heuristics; unit-tested both directions; each re-baseline is a visible `MarkedCurrent` version, so it's auditable and reversible. |
| **The re-commit edge is load-bearing** (safety gate, incomplete-PRD gate, design-preset gate ordering) | Planner slots in *after* existing gates, exactly where `startAll` fires; regression tests on gate ordering; fallback flag to plain `startAll`. |
| **Overlay amend-coalescing loses intermediate states** | Destructive ops always append; amend only on unreferenced overlay-edit versions (precedented guard); session-bounded. |
| **Checkpoint restore mid-generation** | Disable restore while a generation job is active (same guard other structural actions use). |
| **Image indirection misses a consumer** — a viewer, exporter, or sync path that builds `versionId:` keys directly would still see clones as image-less | Single shared resolver (`effectiveImageVersionId(version)`) used by all key builders; unit test that every clone-appending store action stamps `imageSourceVersionId`; the demo-restore remap round-trip test covers the rewritten field. |
| **Vocabulary unification regressing the "advisory never suppresses hard states" rule** | Presentation layer only; engine statuses unchanged; the existing tests for that rule stay green and gain the new badge-consumer cases. |
| **Demo/snapshot id remapping for checkpoints** (id-maps reference version ids that get remapped on demo restore) | Reuse the existing `rewriteIds`/version-remap machinery in `snapshotClient`; test the remap round trip. |
| **User confusion: "restore created Version 9"** | Consistent copy + provenance badges + grouped `ProjectRestored` event; undo toast makes the model safe to explore. |
| **Sync conflicts around restores** (D8) | Pre-resolution auto-checkpoint + existing recovery download; whole-bundle model unchanged and documented. |

---

## 9. Incremental implementation plan (priority order)

Each phase is independently shippable, `npm run build`/`lint`/`test` gated,
and updates the affected `docs/architecture/*` topic docs + README (rule:
restore points and the planner are README-worthy) in the same change.

### R1 — Stop the silent data loss (P0, small–medium)
**Image continuity first** (`imageSourceVersionId` + shared effective-id
resolver, §4.8 — also fixes today's image-less mockup restores, D9); then
overlay versioning (`updateArtifactOverlay`, append-or-amend, destructive ops
always append), history events for all overlay writes, overlay-preserving
artifact restore (default "Keep my edits" + opt-in old-overlays), artifact
restore confirm gains the overlay choice. Store + types + focused tests; no
new collections. *This alone fixes S1 (screens), S5, and D9.*

### R2 — Truthful restore + the planner (P1, medium)
Wire the dormant planner at the PRD-restore and plan-re-commit edges
(`asOfSpineId`, `computeRecommendedUpdates`,
`expandSelectionWithTroubledUpstreams` go live); auto-re-baseline
provably-unchanged artifacts inside the restore transaction; alignment-driven
presentation for badges/revert warnings/export; advisory planning/branch
sections in the planner; correct the drifted docs (§2.4). *Fixes D4, D5, S6,
F5; ends the full-regeneration funnel.*

### R3 — Project restore points (P1, medium)
`projectCheckpoints` collection + full travel-chain wiring (rule 6); auto
captures (plan commit, first decision-apply, pre-regeneration, pre-restore) +
manual named capture; `restoreProjectCheckpoint` transaction with
`restoreGroupId` + `ProjectRestored` event; History stage restore-points UI;
post-restore Undo. *Fixes D3, S2; delivers one-click full rollback.*

### R4 — Comparison & naming depth (P2, medium)
Any-two compare pickers; feature-id diff panel in `VersionCompareView`;
structured screen-inventory diff by stable screen id; overlay-aware "Your
edits" diff section; decision before/after compare in the Decision Center;
optional version/checkpoint names; deterministic headline subtitles in
version lists; `HistoryView`/timeline events link into compare. *Fixes S4 and
the comprehension gaps.*

### R5 — Durability & cross-device hardening (P3, small–medium)
Version-storage meter + earlier quota warning (D7); pre-conflict-resolution
auto-checkpoint (D8); mockup visual side-by-side compare; branch
stranded-state surfacing/archive; evaluate content-pointer dedup for clones.

**Recommended approval scope:** R1 immediately (data loss), then R2 → R3 as
the core deliverable of this proposal. R4/R5 can trail. If a single cut is
needed, defer R4's structured diffs before anything in R1–R3.

---

## Appendix — key evidence index

- Overlay in-place mutation: `src/store/slices/artifactSlice.ts:405-453`;
  callers `ArtifactWorkspace.tsx:715-763`.
- Artifact restore drops overlays: `artifactSlice.ts:218-220`; no warning:
  `VersionHistoryPanel.tsx:177`.
- Spine revert: `spineSlice.ts:711-769` (new UUID at :723; planning/branches
  untouched).
- Full-regeneration funnel: `artifactJobController.ts:158-174`
  (`isSlotDoneForSpine` exact-id match); commit path
  `ProjectWorkspace.tsx:917-1014`.
- Dormant planner: `UpdateAssetsPlanModal.tsx` (tests/barrel only),
  `artifactFreshness.ts:57,124` (`asOfSpineId`, test-only),
  `artifactDependencyGraph.ts:599` (`expandSelectionWithTroubledUpstreams`,
  test-only).
- Id-based staleness vs alignment: `artifactDependencyGraph.ts:465` vs
  `outputAlignment.ts:172-190`; over-broad warning
  `ProjectWorkspace.tsx:685-698`; intended-behavior test
  `artifactFreshness.test.ts:124`.
- Decision↔spine linkage: `spineSlice.ts:620-629` (`applied_to_plan` events);
  in-place decision coalescing `spineSlice.ts:410-454`.
- Quota/silent write failure: `src/store/storage.ts:88-121`,
  `projectStore.ts:177-200`; retention exemptions
  `src/lib/collectionRetention.ts:26-29`.
- Sync LWW/conflict: `api/projects.js:242-259`,
  `src/store/projectServerSync.ts:186-207,611-645`,
  `projectBundle.ts:174-202`.
- Image keying/orphaning (D9): `src/lib/mockupImageStore.ts:31-39`,
  `src/components/mockups/MockupScreenImage.tsx:56` (no fallback chain),
  `docs/architecture/SCREENS_EXPERIENCE.md` mockup-coverage rule
  ("appending a version would orphan every existing render").
