# Synapse Versioning V2 — Capability Audit, Scenario Analysis & Improvement Plan

> Status: **Proposal — awaiting approval. No implementation yet.**
> Builds on `docs/VERSIONING_AUDIT.md` (Phase 1, shipped: non-destructive edits,
> version history panels, compare/diff, restore-as-new-version, provenance,
> staleness warnings). This document audits what shipped against ten real
> product-revision scenarios and proposes the next increment.

---

## 1. Current-State Map

### 1.1 Answers to the ten investigation questions

**1. Where project (PRD) versions are stored.**
`spineVersions: Record<projectId, SpineVersion[]>` in the Zustand store
(`src/store/slices/spineSlice.ts`), append-only full snapshots. Each
`SpineVersion` (`src/types/index.ts:652-698`) carries the full markdown
(`responseText`) and structured object (`structuredPRD`), plus `isLatest`,
`isFinal`, `generationMeta`, `safetyReview`, optional `provenance`
(`VersionProvenance`), and optional `canonicalSpine` (attached on final settle,
`spineSlice.ts:283-292`).

**2. Where artifact versions are stored.**
`artifactVersions: Record<projectId, ArtifactVersion[]>`
(`src/store/slices/artifactSlice.ts`). `ArtifactVersion`
(`src/types/index.ts:1121-1134`): `versionNumber` (1-based monotonic),
`parentVersionId`, full `content`, `metadata` bag, `sourceRefs`,
`generationPrompt`, `isPreferred`, optional `provenance`. The parent
`Artifact.currentVersionId` points at the preferred version.

**3. How PRD versions are created and selected.**
Every creation path appends and flips prior versions' `isLatest` to false:
`regenerateSpine` (spineSlice.ts:62-107), `mergeBranch`
(branchSlice.ts:66-126), `editSpineStructuredPRD` (spineSlice.ts:309-366 — the
chokepoint for all inline edits and single-section retries),
`revertSpineToVersion` (spineSlice.ts:371-420). Ids are opaque UUIDs; display
labels derive from **array position** (`Version ${idx + 1}`,
`ProjectWorkspace.tsx:252-254`). Selection = `isLatest` (one per project) plus
a read-only `viewedSpineId` for historical viewing. The only in-place mutation
is `updateSpineStructuredPRD` (spineSlice.ts:257-301), reserved for the live
streaming settle of an in-flight generation.

**4. How artifact dependency metadata is represented.**
`SourceRef` (`src/types/index.ts:1101-1107`): `{ sourceArtifactId,
sourceArtifactVersionId, sourceType: ArtifactType | 'spine', anchorInfo? }`.
`artifactJobController.runCoreArtifactSlot` stamps one `spine` ref (the exact
`SpineVersion.id` generated from) plus one `core_artifact` ref per satisfied
`dependsOn` input (artifactJobController.ts:326-339); `runMockupSlot` does the
same for `MOCKUP_DEPENDENCIES`, with the design_system ref carrying the
`tokensHash` in `anchorInfo` (artifactJobController.ts:474-497). Version
metadata also records `dependencyStatus`, `validationBlockers`,
`generatedFromIncompletePrd`, `spineContextUsed`, and (design_system)
`tokens`/`tokensHash`.

**5. How the dependency graph determines freshness/lineage.**
`src/lib/artifactDependencyGraph.ts` (pure, derived from
`CORE_ARTIFACT_PIPELINE` + `MOCKUP_DEPENDENCIES`). `evaluateDependencyGraph`
(lines 378-534): spine-ref ≠ latest spine id → hard `needs_update`
(`prd_changed`); recorded dependency ref ≠ that dep's current preferred version
→ `needs_update` (`dependency_changed`); mockup tokensHash drift →
`needs_update` (`design_tokens_changed`); legacy versions with no recorded ref
fall back to a timestamp heuristic → advisory `update_recommended`. Upstream
trouble propagates transitively as `impactedBy` (blue "Impacted" pill).
`computeUpdateOrder`/`computeRecommendedUpdates` give topological batch order;
actions route to the existing `retrySlot`/`regenerateSlots`.

**6. How user edits, regenerations, and artifact updates are handled.**
PRD edits/retries append versions via `editSpineStructuredPRD` with
`provenance.changeSource` (`user_edit` / `ai_section_retry`) and `Edited`
history events. Artifact regeneration appends via `createArtifactVersion`
(artifactSlice.ts:89-169). Artifact *content* has no user-edit path; the two
user-edit mechanisms are metadata **overlays** on the preferred version —
`metadata.screenEdits` (screen metadata) and `metadata.promptEdits` (legacy
prompt packs) via `updateArtifactVersionMetadata` — which create **no version
and no history event** (artifactSlice.ts:280-303).

**7. Id stability across versions.**
- `Feature.id` — **stable and canonical**; copied verbatim into the spine
  (`canonicalPrdSpine.ts` `buildFeatures`), protected by consistency-review
  guards and prompt rules. The strongest identity in the system.
- Screen ids (`ScreenItem.id`) — deterministic (`assignStableScreenIds`,
  `screenInventoryNormalize.ts:92-109`): stored id → name slug → `-2`/`-3`
  dedup; stable across reads and never derived from display renames.
- Canonical-spine seed ids (`scr-`/`ent-` via `slugId`,
  `canonicalPrdSpine.ts:96-107`) — deterministic from (name, order), but
  **shift when names/order change**; self-flagged as interim.
- Spine + artifact version ids — opaque random UUIDs by design; ordering comes
  from array position / `versionNumber`.

**8. Whether version metadata survives persistence, sync, export, reload.**
**Yes, on every path.** The store `partialize` strips only transient slices
(`projectStore.ts:39-46`); `ProjectBundle` (`projectBundle.ts:16-26`) carries
whole `spineVersions`/`artifacts`/`artifactVersions` arrays to `/api/projects`;
snapshots collect the same (+ per-version IndexedDB images) and remap artifact
version ids on demo restore (`snapshotClient.ts:556-602`); the recovery
download reuses `ProjectBundle`. No truncation anywhere; the one ceiling is the
server's **8 MB request-body reject** (`api/projects.js:47`, HTTP 413). Old
mockup images are **kept** per version id in IndexedDB (no GC), which is what
makes old-vs-new visual comparison possible at all.

**9. Where stale artifacts are detected.**
Two parallel systems: (a) `stalenessSlice.getArtifactStaleness`
(`current | possibly_outdated | outdated`, spine-ref + mockup tokensHash
comparison) feeding `StalenessBadge`; (b) the richer dependency-graph evaluator
(§1.1.5) feeding the Project Map. Both operate at **whole-version
granularity** — any new latest spine flips *every* downstream artifact,
regardless of what changed.

**10. Where the UI exposes version history/comparison.**
`src/components/versions/` (`VersionHistoryPanel`, `VersionCompareView`,
`RevertConfirmModal`) — PRD history from the `ProjectWorkspace` overflow menu +
historical-version banner (Compare with current / Restore); artifact history
from the "Version history" button + "Generated from PRD Version X" chip +
`StalenessBadge` in `ArtifactWorkspace` (:625-655, 1510-1538). `HistoryView`
shows the event timeline but only a truncated one-line diff placeholder
(HistoryView.tsx:96-101). Compare is hardwired to **historical ↔ current**;
artifacts and mockups get a flat word diff of `content`.

### 1.2 The load-bearing workflow finding: the re-finalize regeneration funnel

This is the single most important current-behavior fact for every scenario
below, verified end to end:

1. Every appended spine version — edit, section retry, revert, merge — is
   stamped **`isFinal: false`** (spineSlice.ts:334, 394; branchSlice.ts:100).
2. The Assets workspace only renders when `activeSpine?.isFinal`
   (ProjectWorkspace.tsx:905). So the moment a user edits a finalized PRD,
   **the entire Assets workspace — including the dependency graph and all its
   selective-update actions — disappears**, replaced by the PRD stage.
3. To get assets back the user must **Mark Final** again →
   `finalizeAndGenerate` → `artifactJobController.startAll` with the *new*
   spine id (ProjectWorkspace.tsx:568-587).
4. `startAll`'s pending-slot filter treats "done" as *done for this spine
   version* — `isSlotDoneForSpine` requires a `spine` sourceRef equal to the
   current spine id (artifactJobController.ts:138-154, 696). No artifact ever
   matches a freshly appended spine, so **every artifact and mockup regenerates
   from scratch on every re-finalize — even for a one-word typo fix**.
5. The graph's per-artifact "Update selected" flow, staleness reasons, and
   update ordering are all unreachable during this funnel, because the surface
   that hosts them is hidden while `isFinal` is false.

Net effect: the system quietly implements "any PRD change = regenerate the
whole project," which is expensive, slow, discards the user's mental model of
which assets were fine, and is precisely the trust-eroding behavior this task
targets. (It *is* history-safe — old artifact versions and images are kept —
but the user experiences a wall of regeneration, not a surgical update.)

### 1.3 Other known gaps (evidence-backed)

- **Provenance is incomplete.** `VersionChangeSource` declares
  `ai_generation | ai_regeneration | branch_merge | consistency_review`, but no
  production path stamps them — `regenerateSpine`, `mergeBranch`, and
  `createArtifactVersion` leave `provenance` undefined. Only `user_edit`,
  `ai_section_retry`, and `revert` are recorded.
- **No change-content awareness anywhere.** `versionDiff.diffStructuredPRD`
  computes section-level diffs, but nothing connects it to staleness: the graph
  can say *"generated from Version 2, now on Version 4"* but never *what*
  changed between them. Features/entities are flattened to text blobs before
  diffing — no diff by `Feature.id` (added/removed/renamed) despite feature ids
  being the system's most stable identity.
- **No feature-level impact analysis.** The only feature-content check is
  `detectStaleFeatureNames` (`artifactPromptBuilder.ts:115-129`), a prompt-
  hygiene name-presence scan. Nothing answers "which artifacts referenced the
  feature I just deleted?" — even though artifacts carry structured
  traceability (`Related Features:` lines, `traceabilityMappedFeatures`
  metadata) that makes this answerable.
- **Exports are version-blind.** `ExportModal`/`buildAgentHandoff` always take
  the preferred version with **no staleness check, no warning, and no version
  manifest** — the only version metadata exported anywhere is `versionNumber`
  in the Structured JSON path (ExportModal.tsx:120). A `possibly_outdated`
  data model exports into the agent handoff silently.
- **Compare limitations.** Only historical ↔ current (both `getCompareInput`
  call sites hardwire `after` to latest/preferred); JSON-mode artifacts
  (screen/data/component inventory) diff as one markdown blob; mockup compare
  is a text diff even though every version's images are preserved in
  IndexedDB (`mockupImageStore.ts:3-7`).
- **Two staleness systems.** `stalenessSlice` (3-state) and the graph
  evaluator (richer) implement overlapping rules that must be kept manually in
  sync (already a documented consistency rule in CLAUDE.md).
- **Overlay edits are invisible to versioning.** `screenEdits`/`promptEdits`
  mutate preferred-version metadata in place — no version, no event, no
  divergence signal ("this artifact was hand-tuned after generation").
- **HistoryView diff placeholder** — one truncated line, no link into the real
  compare view.
- **Growth ceilings** — no retention cap on versions (8 MB server body limit
  is a reject-not-truncate cliff) and no image GC across regenerations
  (`tasks/TODO.md:131-135`).

---

## 2. User Scenario Gap Analysis

Legend: ✅ supported · 🟡 partially supported · ❌ unsupported.

### Scenario 1 — Downstream artifact reveals an underspecified feature

| Capability | Status |
| --- | --- |
| Return to PRD and edit the feature | ✅ PRD stage, `StructuredPRDView`/`FeatureCard` edits |
| Edit creates a new PRD version | ✅ `editSpineStructuredPRD` appends, `user_edit` provenance |
| Downstream marked potentially stale | ✅ `prd_changed` / `possibly_outdated` (whole-version) |
| See which artifacts came from the old version | ✅ "Generated from PRD Version X" chip; graph detail |
| Regenerate affected artifacts | 🟡 exists in the graph — but unreachable during the funnel (§1.2); the practical path regenerates **everything** |
| Compare old vs new artifact versions | 🟡 vs current only; text-blob diff |
| **Understand *what* changed and what it affects** | ❌ no change summary attached to staleness anywhere |

What confuses the user today: after fixing one feature, they are ejected from
the Assets view, re-finalize, and watch all seven artifacts + mockups
regenerate. Nothing says "you changed Features → user flows and screens are
affected; the data model likely isn't."

**Needed:** change-aware staleness (spine-version diff surfaced on every stale
flag) + a guided, selective update flow at the re-finalize edge.

### Scenario 2 — Deleting a feature after seeing UX/mockups

| Capability | Status |
| --- | --- |
| Delete feature from canonical model | ✅ FeatureCard remove → new version |
| New PRD version created | ✅ |
| Identify artifacts that referenced the deleted feature | ❌ nothing scans references, despite traceability data existing |
| Show downstream as stale/incompatible | 🟡 wholesale `prd_changed`, no reason "feature X removed" |
| Prevent deleted features reappearing | 🟡 regeneration uses the canonical spine (deleted feature absent), so regenerated artifacts are clean; but a **stale artifact the user keeps** still shows the feature with no flag |
| Preserve prior versions / compare pre- vs post-delete | ✅ history kept; 🟡 compare is text-only, feature deletion appears as scattered word-diff noise, not "Feature 'X' removed" |

**Needed:** feature-level diff by `Feature.id` (added/removed/renamed/changed)
+ a deleted-feature reference scan across preferred artifact content and
traceability metadata → an explicit impact list ("'Social sharing' removed —
referenced by User Flows, Screens (2 screens), Implementation Plan (1
milestone)").

### Scenario 3 — Tech stack change after implementation planning

Today the stack lives in the PRD's prose `architecture` field (plus whatever
the implementation plan generated). A stack change is just another PRD edit:
downstream flips wholesale, with no signal that this is an
architecture-class change affecting `data_model`/`implementation_plan`
specifically and not, say, `design_system`.

**Needed (now):** section-level change classification — `diffStructuredPRD`
already isolates the Architecture section; map changed sections → affected
artifact subtypes so the stale reason reads "Architecture changed → Data
Model, Implementation Plan need review; Design System unaffected by this
change." **Deferred:** a structured tech-stack entity with its own version
lineage. The PRD deliberately keeps architecture at decision level
(CLAUDE.md: the artifacts own the detail); a structured stack object is a
generation-pipeline change, not a versioning change, and shouldn't block this
work.

### Scenario 4 — Design system change after mockups exist

This is the **best-supported scenario today**: the design system is already a
versioned first-class dependency. `DesignDirectionControl` +
`ChangeDirectionModal` change direction with an explicit downstream warning;
regeneration produces a new `tokensHash`; the mockup's recorded design ref
(`anchorInfo`) drifts → hard `design_tokens_changed`; the Mockups view shows
the amber "Design system changed … Regenerate the mockups" banner; a
token-identical regen correctly keeps mockups current (hash beats version id).

Remaining gaps: 🟡 old-vs-new **visual** comparison doesn't exist (text diff of
mockup specs only), even though both versions' images are preserved; 🟡 the
design_system version doesn't record **which preset** produced it
(`Project.designSystemPreset` is current-state only), so history can't say
"Modern SaaS → Consumer Mobile". Both are cheap additions. **Answer to the key
question: design system versions are already first-class dependencies — keep
that model; don't invent a parallel one.**

### Scenario 5 — User edits one artifact directly

Artifact *content* editing doesn't exist; the overlay edits that do exist
(screen metadata, prompt edits) mutate preferred-version `metadata` in place —
no version, no event, no divergence flag. The graph shows a `manuallyEdited`
pencil only off `provenance.changeSource === 'user_edit'`, which overlays never
set.

**Needed (now):** record overlay edits as history events + a lightweight
"customized after generation" signal on the artifact (regeneration already
starts overlays clean, which is correct — but the user should be warned that
regenerating discards their customizations). **Deferred:** full artifact
content editing and "push change upstream to PRD" — a product feature in its
own right, out of versioning scope.

### Scenario 6 — Compare two versions of the same artifact

✅ PRD: section-aware + word-level, good. 🟡 Artifacts: single text blob —
acceptable for prose artifacts, poor for JSON-mode artifacts where "screens
added/removed" is the real question. ❌ Compare any-two (both call sites pin
`after` = current). ❌ Mockup visual compare. ❌ Feature-level diff. Impact
analysis attached to a diff: ❌.

**Needed:** any-two selection (small UI change — the panel already lists all
versions); structured diffs for screen_inventory (by stable screen id) and
data_model (entities/fields by name); mockup image side-by-side; a
`summarizeSpineChange` one-liner ("2 features changed, 1 removed ·
Architecture edited").

### Scenario 7 — Rollback to an earlier version

✅ Solid (Phase 1): revert appends a new version (`revert` provenance +
`revertedFromVersionId` + `Reverted` event), history untouched,
`RevertConfirmModal` lists artifacts that will go stale. Two gaps: 🟡 the
revert lands `isFinal: false` → same funnel as any edit (§1.2), so "restore
the version everything was generated from" still regenerates everything;
🟡 the confirm modal says *which* artifacts go stale but not *what will change*
(the spine diff between current and the restore target is computable).

### Scenario 8 — Branch / explore alternatives

Branches today are text-anchored AI conversation threads that merge back into
the single linear spine chain (branchSlice.ts, branchService.ts) — **not**
project-level lineage. There is no project duplication either.

**Recommendation: linear history is enough for now — do not build Git-like
branching.** The append-only single-chain model is the source of the system's
simplicity (positional labels, one `isLatest`, one staleness baseline);
parallel lineages would fork every store slice, the dependency graph baseline,
sync, and snapshots. The 90% use case ("try a different direction without
losing this one") is served by a **Duplicate Project** action (copy all nine
slices under a new project id — the snapshot `rewriteIds` machinery already
proves the remap pattern). Propose as a later phase; explicitly defer true
branching.

### Scenario 9 — Export / share

❌ The weakest area relative to effort required. No version manifest, no
staleness warning, stale artifacts included silently, and the agent handoff —
the export most likely to be *acted on* by a coding agent — carries no
provenance at all.

**Needed:** a generated manifest (project, PRD version label + timestamp, per
artifact: version number, generated-from PRD version, staleness at export
time) prepended/attached to bundle + JSON + handoff exports; an amber warning
in `ExportModal` when any included artifact is stale (mirroring the existing
`cloudAtRisk` banner pattern), with "export anyway / update first" choices.

### Scenario 10 — Dependency graph as the version-impact interface

The graph is already the right surface: derived, deterministic statuses with
reasons, impact propagation, ordered batch updates. Three things keep it from
being the *main* interface: (1) it's invisible exactly when needed most
(§1.2 funnel); (2) reasons are version-granular ("PRD changed") with no
content ("Features changed: X removed"); (3) "recommended next actions" stop
at "update N impacted" — no notion of "this change likely doesn't affect this
artifact" and no per-artifact "keep as-is, mark current" escape hatch.

---

## 3. Proposed Versioning Model

**Core principle: keep the shipped model — append-only full snapshots, opaque
UUID ids, positional labels, sourceRef lineage — and add a *change-awareness
layer computed at read time*, not new persisted version machinery.** Every
proposal below that matters for the MVP is derivable from data already
persisted (spine versions are full snapshots; diffs are already computed on
the fly). This keeps migrations at zero and honors the codebase's
optional-fields-only compatibility rule.

| Concern | Model decision |
| --- | --- |
| PRD versions | Unchanged (append-only `SpineVersion[]`). Complete the provenance stamping (`ai_generation`, `ai_regeneration`, `branch_merge`). |
| Artifact versions | Unchanged (`ArtifactVersion` + `sourceRefs`). Add `marked_current` re-baselining (below) and overlay-edit history events. |
| Feature versions | **No separate feature-version store.** `Feature.id` is stable; feature history is derivable by diffing consecutive spine snapshots (`diffFeatures` by id). Persisting per-feature version chains would duplicate the spine snapshots. |
| Design system versions | Already first-class (artifact versions + tokensHash refs). Add `metadata.designSystemPreset` stamping at generation so direction history is legible. |
| Tech stack / architecture versions | **Not a separate entity now.** Represent as *classified spine changes* (Architecture-section diff → architecture-class staleness reasons). Revisit only if a structured stack object enters the generation pipeline. |
| Dependency lineage | Unchanged (`sourceRefs` chain). Legacy versions keep the timestamp heuristic. |
| Staleness states | Keep the graph's status set; **enrich reasons with change content** (`changedSections`, `featureChanges`) and add an advisory *scoped-impact* signal ("no changes in the sections this asset derives from"). |
| Manual edits | Overlay edits emit history events + a `customized` signal; artifact content editing deferred. |
| Regeneration events | Unchanged mechanically; the *entry point* changes — re-finalize with existing assets routes through an update-plan dialog instead of blind `startAll`. |
| Rollbacks | Unchanged (append-clone); enrich the confirm modal with the spine diff summary. |
| Branching | **Deferred.** Linear history + (later) Duplicate Project. |

### 3.1 The change-awareness layer (new, pure)

A new pure module `src/lib/spineChangeAnalysis.ts` (or an extension of
`versionDiff.ts` — same rules: framework-free, unit-tested, nothing persisted):

- `diffFeatures(before, after): FeatureDiff` — keyed by `Feature.id`:
  `{ added: Feature[], removed: Feature[], renamed: {id, from, to}[],
  changed: {id, name, fields: string[]}[] }`. This is the system's first use
  of its most stable identity for user-facing diffing.
- `summarizeSpineChange(beforeSpine, afterSpine): SpineChangeSummary` —
  `{ sections: SectionDiff[] (reusing diffStructuredPRD), features:
  FeatureDiff, headline: string }` where `headline` is a deterministic
  one-liner ("1 feature removed · Features, UX Pages changed").
- `SECTION_ARTIFACT_AFFINITY` — a conservative, documented map from PRD section
  keys to the artifact subtypes that *primarily* derive from them (e.g.
  `features`/`uxPages` → screen_inventory, user_flows, mockup;
  `domainEntities`/`architecture` → data_model, implementation_plan;
  everything → implementation_plan). Used only for **advisory annotations**
  ("likely unaffected by this change"), never to suppress a hard
  `needs_update` — every artifact really is generated from the whole PRD, so
  the honest claim is "the sections this asset chiefly derives from didn't
  change," not "this asset is current."
- `findFeatureReferences(feature, artifactVersions): FeatureReference[]` —
  scans preferred versions' content (name/id token match, reusing the
  conservative matching style of `artifactTraceabilityRepair.ts`) plus
  structured traceability metadata, returning per-artifact hit lists for the
  deleted/renamed-feature impact panel.

`evaluateDependencyGraph` gains an optional input (the resolved before/after
`StructuredPRD` for each stale node's spine ref → current spine) and attaches
`changeSummary` to `prd_changed` reasons. Cost note: diffs run per stale node
per evaluation — memoize by `(fromSpineId, toSpineId)` pair; spine pairs are
few.

### 3.2 Re-baselining: "Mark as still current"

The missing escape hatch for trivial upstream changes. Per stale artifact, a
user action that **appends a cloned `ArtifactVersion`** (same content/metadata)
whose `sourceRefs` spine ref points at the **current** spine, with
`provenance.changeSource: 'marked_current'` (new union member) and an
`editSummary` ("Confirmed current for PRD Version 4"). Because it's an honest
append — same pattern as `revertArtifactToVersion` — history stays truthful,
`isSlotDoneForSpine` starts passing for the new spine (so re-finalize stops
regenerating it), and the graph/staleness flip to current. Trade-off: a
content-identical version row per confirmation; acceptable (text-only) and
clearly labeled by its provenance badge.

### 3.3 The re-finalize flow (fixing §1.2)

Keep the `isFinal: false` reset (it correctly forces an explicit "this is
final" decision after content changes). Change what finalization *does* when
assets already exist:

- In `finalizeAndGenerate`, when any artifact versions exist for the project,
  do **not** call `startAll` blindly. Instead evaluate the dependency graph
  against the new spine and open an **Update Assets plan dialog**: the spine
  change summary on top ("What changed: 1 feature removed …"), then each
  artifact with its status, reason (now change-aware), affinity annotation,
  and a checkbox — defaults from `computeRecommendedUpdates`. Actions:
  **Update selected** (→ `regenerateSlots`, which already handles ordering +
  hidden closure + unhealthy-dependency expansion via `planSlotRetry`
  semantics), **Mark selected as current** (§3.2), or **Update everything**
  (today's behavior, one click away).
- First finalize (no artifacts) is unchanged — `startAll` as today.
- The Assets workspace remains gated on `isFinal` (unchanged), but the user
  now passes through a surgical decision instead of a silent full rebuild.

---

## 4. Recommended User Experience

- **Version history** stays where it is (PRD overflow menu; artifact header
  button) — Phase 1 placed these well. Add: any-two compare pickers in
  `VersionHistoryPanel`; the spine-change headline as a per-version subtitle
  (so the list reads "Version 3 — Edited · 1 feature removed" instead of just
  "Edited PRD").
- **Stale labels** keep `StalenessBadge`, but the badge (and the graph node
  detail) gains the change summary: hover/tap → "Generated from Version 2.
  Since then: Feature 'Social sharing' removed; UX Pages changed." Advisory
  affinity note where applicable: "No changes in the sections this asset
  chiefly derives from."
- **Regeneration** funnels through the Update Assets plan dialog (§3.3) at the
  re-finalize edge; inside the workspace the existing graph actions stay, plus
  the per-artifact **Mark as still current** action (graph detail panel +
  artifact header next to the staleness badge).
- **Deleted features** get an explicit impact panel: when
  `summarizeSpineChange` detects removals, the plan dialog (and the graph's
  Change Impact tab) lists each removed feature with the artifacts that still
  reference it ("still shown in: User Flows, Screens (Checkout, Cart)"). A
  stale artifact that references a removed feature upgrades its reason text to
  "references removed feature 'X'".
- **Dependency graph** becomes the version-impact home: node detail's
  "Why update?" shows the change summary; the History tab links each version
  row into the real `VersionCompareView` (also fixing the HistoryView
  placeholder by linking, not by building a second diff renderer).
- **Exports** show a version manifest block (PRD version + timestamp; per
  artifact: version, generated-from PRD version, staleness) and an amber
  banner when stale content is included — "3 assets may be out of date with
  the current PRD" with **Review in Project Map** / **Export anyway**. The
  manifest is included in the bundle markdown (a header section), the JSON
  export (a `manifest` field), and the agent handoff preamble (one line per
  artifact), so an outside reader can see exactly what they're holding.
- **Rollback** confirm modal adds the diff summary of what restoring will
  change, alongside the existing stale-artifact list.

Clarity rule throughout: never invent VCS vocabulary — the UI says "changed /
may be outdated / update / mark as current / restore", not
"rebase / HEAD / branch".

---

## 5. Data Model and State Changes

All additions are **optional fields or new pure modules** — zero migrations,
legacy data loads unchanged (the established compatibility rule).

| Change | Where | Notes |
| --- | --- | --- |
| `VersionChangeSource` += `'marked_current'` | `src/types/index.ts` | Union extension; display maps in `VersionHistoryPanel` gain a label. |
| Stamp missing provenance | `spineSlice.regenerateSpine` (`ai_regeneration` on settle), `branchSlice.mergeBranch` (`branch_merge`), `artifactJobController` → `createArtifactVersion` (`ai_generation`/`ai_regeneration` by versionNumber), consistency-review apply (`consistency_review`) | Uses existing typed fields that were never written. |
| `markArtifactCurrentForSpine(projectId, artifactId, spineVersionId)` | `artifactSlice` | Append-clone with re-pointed spine ref + provenance; mirrors `revertArtifactToVersion` (reads inside `set()` per the concurrency rule). |
| Overlay-edit events | `updateArtifactVersionMetadata` callers (screenEdits/promptEdits paths) | Push an `Edited` `HistoryEvent` with artifact ids; no shape change. |
| `metadata.designSystemPreset` | design_system generation (`coreArtifactService`/job controller) | Stamped at generation from the project; display-only. |
| `SpineChangeSummary`, `FeatureDiff`, `FeatureReference` types | new `src/lib/spineChangeAnalysis.ts` | Pure module; nothing persisted. |
| `DependencyStaleReason.changeSummary?` | `artifactDependencyGraph.ts` | Evaluation-output-only type (not persisted). |
| Export manifest types | `src/lib/exportManifest.ts` (new, pure) | Built at export time from live state. |

Deliberately **not** added: `branchId`, `isCanonical`, per-feature version
records, a `sourceTechStackVersionId`, content hashes. The names in the task
prompt map onto existing fields: `versionId`→`id`, `parentVersionId` exists,
`sourcePrdVersionId`→spine `sourceRef`, `sourceArtifactVersionIds`→
`core_artifact` refs, `createdBy`/`createdReason`/`changeSummary`→
`provenance.changeSource`/`editSummary`, `stalenessStatus`→derived (never
persisted), `supersedes`→`revertedFromVersionId` + `parentVersionId`.

---

## 6. Diff and Comparison Strategy

| Diff type | Approach | When |
| --- | --- | --- |
| Textual (prose artifacts, PRD sections) | Existing jsdiff word-level (`diffText`) | Shipped |
| PRD structured | Existing section-aware (`diffStructuredPRD`) | Shipped |
| **Feature-level** | New `diffFeatures` by `Feature.id` (added/removed/renamed/changed-fields) | **Now (MVP)** — powers change-aware staleness, deletion impact, history subtitles |
| **Human-readable change summary** | Deterministic `headline` from `summarizeSpineChange` — no LLM call (guaranteed, free, honest) | **Now (MVP)** |
| **Dependency impact diff** | Change summary attached to graph stale reasons + affinity annotation | **Now (MVP)** |
| Compare any-two versions | Two-picker mode in `VersionHistoryPanel`/`VersionCompareView` | Phase 2 |
| Screen-inventory structured diff | Parse both versions (`normalizeScreenInventory` — ids are stable/deterministic), diff screens by id: added/removed/changed fields | Phase 2 |
| Data-model structured diff | Reuse `dataModelMarkdown` parser; entities by name, fields/relationships per entity | Phase 2 |
| Mockup visual compare | Side-by-side per-screen image gallery for two versions (images already preserved per `versionId:screenId:quality`); match screens via `sourceScreenId`/slug like `screenExperience` | Phase 2 |
| Implementation-plan task diff | Per-milestone/task add/remove/change (backlog item exists) | Deferred |
| Content hashing for exact drift | `contentHash` on versions | Deferred (documented graph limitation; not needed for the above) |

---

## 7. Phased Implementation Plan

### Phase A — Change-aware staleness & guided updates (**the recommended MVP**)

**Goal:** every stale flag explains *what changed*; a PRD revision after
finalize leads to a surgical, ordered, user-controlled update instead of a
silent full regeneration; deleted features have a visible blast radius;
exports stop being version-blind.

- **A1. Pure change analysis.** `src/lib/spineChangeAnalysis.ts`
  (`diffFeatures`, `summarizeSpineChange`, `SECTION_ARTIFACT_AFFINITY`,
  `findFeatureReferences`) + unit tests. No UI yet. *Risk: low (pure).*
- **A2. Change-aware graph reasons.** Thread spine snapshots into
  `evaluateDependencyGraph`; attach `changeSummary` + affinity annotation to
  `prd_changed` reasons; memoize per spine pair. Update `DependencyGraphView`
  detail panel + `StalenessBadge` tooltip + the artifact-header chip area.
  Files: `artifactDependencyGraph.ts`, `DependencyGraphView.tsx`,
  `StalenessBadge.tsx`, `ArtifactWorkspace.tsx`. *Risk: evaluation cost —
  bounded by memoization; advisory annotations must not suppress hard states
  (tested).*
- **A3. Update Assets plan dialog at re-finalize.** New
  `src/components/versions/UpdateAssetsPlanModal.tsx`; change
  `ProjectWorkspace.finalizeAndGenerate` to route through it when artifact
  versions exist (first finalize unchanged). Actions wire to existing
  `regenerateSlots` / new `markArtifactCurrentForSpine`. *Risk: the finalize
  edge is load-bearing (design-preset gate, incomplete-PRD gate) — the dialog
  slots in after those gates; regression tests on the gate ordering. Rollback:
  a flag falling back to plain `startAll`.*
- **A4. `markArtifactCurrentForSpine`** in `artifactSlice` + graph/artifact-
  header action + `'marked_current'` provenance label. *Risk: users
  over-marking — mitigated by keeping it per-artifact and reversible (the
  artifact goes stale again on the next real change; history shows the
  confirmation).*
- **A5. Provenance completion + overlay-edit events.** Stamp the four missing
  change sources; emit history events from screenEdits/promptEdits saves.
  *Risk: none (write-only additions).*
- **A6. Export manifest + stale warning.** `src/lib/exportManifest.ts`;
  `ExportModal` banner + manifest inclusion in bundle/JSON/handoff.
  *Risk: none; snapshot the handoff preamble change in `promptSurfaces.test`
  if it's covered there.*
- **A7. Docs.** Update `CLAUDE.md` (staleness/finalize/provenance sections),
  `VERSIONING_AUDIT.md` status note, this doc's status; README review (the
  update-plan dialog is user-visible → README rule applies).

**Migration/back-compat:** zero migrations. Legacy spines without
`structuredPRD` on one side of a diff → change summary degrades to "content
changed" (text-level); legacy artifacts without refs keep the timestamp
heuristic and never get a change summary (advisory only, as today).
**Testing:** unit tests for A1 (the bulk), graph-evaluation tests for A2,
store tests for A4/A5, one component test for the plan dialog's
default-selection logic, ExportModal manifest test. No broad UI snapshot
bloat. **Validation:** `npm run build` + `npm run lint` + `npm test`
(pre-push gate).

### Phase B — Comparison depth

Any-two compare; structured screen-inventory + data-model diffs; mockup visual
before/after; `HistoryView` events link into `VersionCompareView`; revert
modal shows the restore diff summary. Files: `versions/` components,
`versionDiff.ts` extensions, new `mockups/MockupVersionCompare.tsx`,
`HistoryView.tsx`. Independent of A; can ship separately.

### Phase C — Consolidation & durability

Unify `stalenessSlice` onto the graph evaluator (one rule set);
`designSystemPreset` stamping; version-retention policy (cap non-preferred,
non-latest history with pinning; respects the 8 MB sync ceiling) + image GC
hooks (ties into the existing TODO). Duplicate Project (exploration
affordance) lands here if wanted.

### Deferred (explicitly out of scope)

True project branching / parallel lineages; server-side per-version storage;
structured tech-stack entity; artifact content editing + push-upstream;
LLM-written change narratives (deterministic summaries only); content hashing.

---

## 8. Recommended MVP

**Phase A, with A1–A3 as the essential core and A4–A6 as strongly recommended
small additions.** If a cut is needed, drop A4 first (mark-as-current), then
A6 (export manifest) — never A1–A3, which are the trust core: *what changed,
what it affects, and a controlled way to act on it.*

Why this MVP: it directly hits every success criterion — what version an
artifact came from (shipped, now enriched), whether it's current (now with
reasons that name the change), what changed between versions (feature-level,
deterministic), which artifacts a PRD/feature/design change affects (change-
aware reasons + deletion impact + existing tokensHash rule), how to regenerate
(the plan dialog + existing graph ordering), whether old artifacts are
preserved (already true — now visible via provenance completion), and whether
an export contains stale content (manifest + warning). It requires **no new
persisted version machinery, no migrations, and no backend changes**, and it
converts the single worst current behavior (the silent full-regeneration
funnel) into the product's most trust-building moment.
