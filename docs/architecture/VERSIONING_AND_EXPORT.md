# Version History, Revert & Export

> Extracted from CLAUDE.md. Export modal + manifest, version history/compare/revert components, change-aware staleness, provenance, and the re-finalize Update Assets plan.

### Export (`ExportModal.tsx`)

The Export dialog downloads the PRD, individual artifacts, a combined bundle,
or structured JSON. It also offers a **"Copy for coding agent"** preset
(`buildAgentHandoff` in `src/lib/exportHandoff.ts`): an instruction preamble +
PRD + build-relevant core artifacts (mockups excluded), with copy and download.
Copy-to-clipboard (via `src/lib/utils/copyToClipboard.ts`, Clipboard API with
an `execCommand` fallback) is available on the PRD and full bundle too.

**The default PRD export is ONE coherent three-part document** mirroring the
in-app Overview/Features/Decisions views: `renderPremiumMarkdown`
(`src/lib/services/prdMarkdownRenderer.ts`) emits `# Part I — Product Overview`
→ `# Part II — Feature Specification` → `# Part III — Decisions and Validation`
→ `# Appendices` (Architecture & Additional Context holding legacy technical
sections, a Traceability Index, domain grounding, and the "Where the Detail
Lives" handoff appendix). It is composed from pure per-part builders
(`overviewLines`/`featuresLines`/`decisionsLines`/`appendixLines`), and
`renderPrdSectionMarkdown(prd, 'overview'|'features'|'decisions')` renders a
single part for the **section-specific export** option (not the default).
`ExportModal` renders the PRD from the canonical `structuredPRD` object via
`renderPremiumMarkdown` (falling back to stored `responseText` for legacy
PRDs with no structured payload), so the three-part structure is guaranteed
regardless of the saved markdown. The renderer is still the source of
`SpineVersion.responseText`, so reordering it is presentation-only —
downstream artifacts consume the `StructuredPRD` object by field, never the
markdown; no consumer parses it by heading.

**Exports are version-aware.** `src/lib/exportManifest.ts` (pure) builds an
**export manifest** — per asset: version number, generated-from PRD version
label, and staleness at export time — rendered by `renderManifestMarkdown` into
the top of the full markdown bundle, a `manifest` field in the structured JSON,
and (via `HandoffInput.manifestMarkdown`) between the preamble and the PRD in
the agent handoff. When any exported asset is stale, `ExportModal` shows an
amber warning banner (same pattern as the cloud-at-risk banner) naming the
assets; exports are never blocked — the manifest keeps the document honest.
Keep the manifest in sync if export composition changes.

### Version history & revert (`src/components/versions/`)

Shared, presentation-only components for browsing, comparing, and restoring
versions of **both** PRDs (spines) and artifacts:

- `VersionHistoryPanel` — props-driven modal listing versions (label,
  current/preferred badge, change-source badge, edit summary) with per-row
  **Compare** / **Restore**; orchestrates the compare → confirm flow internally.
- `VersionCompareView` — section-aware inline diff for PRDs, word diff for
  artifact text. Read-only except for opening the restore confirmation.
- `RevertConfirmModal` — non-destructive restore confirmation; the PRD variant
  warns which downstream artifacts will be marked possibly outdated (computed by
  the caller via `evaluateProjectFreshness` — the artifacts currently
  `up_to_date` with the latest spine).

Diffs are computed on the fly from stored snapshots by **`src/lib/versionDiff.ts`**
(pure, jsdiff-backed: `diffText`, `diffStructuredPRD`, `getDiffSummary`) —
nothing extra is persisted. Wiring: `ProjectWorkspace` exposes PRD history (a
**Version History** overflow-menu item) and adds **Compare with current** /
**Restore this version** to the read-only historical-version banner;
`ArtifactWorkspace` shows a **Version history** button + a "Generated from PRD
Version X" chip + `FreshnessBadge` (driven by `useProjectFreshness`) above each
generated artifact. Restores route
to `revertSpineToVersion` / `revertArtifactToVersion`. **Revert always appends a
new version and never deletes history.** See `docs/VERSIONING_AUDIT.md` for the
Phase 1 design and `docs/VERSIONING_V2_PLAN.md` for the change-awareness layer
(Phase A implemented).

**Change-aware staleness (`src/lib/spineChangeAnalysis.ts`, pure).** The "what
changed" layer behind every stale flag: `diffFeatures` (by stable `Feature.id`
— added/removed/renamed/changed), `summarizeSpineChange` (section diffs via
`versionDiff` + a deterministic one-line headline — never an LLM call),
`ARTIFACT_SECTION_AFFINITY`/`isLikelyUnaffected` (advisory "no changes in the
sections this asset chiefly derives from" — identity/safety sections sit in
every affinity set so the note only fires on genuinely narrow changes, and it
must NEVER suppress a hard `needs_update`), `findFeatureReferences`
(conservative removed-feature reference scan; whole-word, ≥4-char needles), and
`makeSpineChangeResolver` (memoized "since spine X vs latest" resolver).
`evaluateDependencyGraph` accepts an optional `spineChangeFor` input and
attaches a `changeSummary` to `prd_changed` reasons + a node-level
`likelyUnaffected` flag (only when the PRD change is the sole reason). Surfaced
in the graph detail panel ("What changed: …", removed-feature still-referenced
warnings), the `FreshnessBadge` tooltip, and the artifact-header strip.
Everything is computed at read time from stored snapshots — nothing persisted.

**Provenance is complete.** Every version-creating path stamps
`provenance.changeSource`: `ai_generation` (initial settle in
`updateSpineStructuredPRD` when none exists; `createArtifactVersion` default
for v1), `ai_regeneration` (`regenerateSpine`; `createArtifactVersion` default
for v2+), `branch_merge` (`mergeBranch`), plus the existing `user_edit` /
`ai_section_retry` / `revert` and the new **`marked_current`**. User overlay
edits (screenEdits/promptEdits) pass `opts.historyDescription` through
`updateArtifactVersionMetadata` to record an `Edited` history event, and the
graph treats a non-empty overlay as manually-edited. New version-creating code
paths must stamp a changeSource.

**"Mark as up to date" (`artifactSlice.markArtifactCurrentForSpine`).** The
escape hatch for trivial PRD changes: appends a CLONED preferred version whose
`sourceRefs` are **rebased** — spine ref → the confirmed spine version AND
every `core_artifact` ref → that dependency's current preferred version
(refreshing a recorded design tokensHash `anchorInfo`). Rebasing only the spine
ref would leave the graph still reporting `dependency_changed`; never do a
partial rebase. Emits a `MarkedCurrent` history event. Exposed in the graph
detail panel and the artifact-header strip when stale.

**Re-finalize goes through the Update Assets plan.** When Mark-as-Final runs
and downstream assets already exist (and no generation job is active),
`ProjectWorkspace.finalizeAndGenerate` does NOT call `startAll` — it evaluates
the dependency graph against the spine being finalized and opens
`UpdateAssetsPlanModal` (`src/components/versions/`): a "what changed" header
(vs the assets' newest baseline PRD version) and a per-asset choice —
Regenerate / Mark up to date / Decide later — defaulted from
`computeRecommendedUpdates`. Confirm finalizes, applies mark-current FIRST
(healing confirmed upstreams), then regenerates the selection expanded via
`expandSelectionWithTroubledUpstreams` (a selected dependent must never rebuild
from a stale unselected visible input; marked-current upstreams count as
healed) through the existing `regenerateSlots` path. Cancel aborts the finalize
(spine stays non-final). First finalize and job-active re-finalizes keep the direct
`startAll` path. Do not reintroduce a blind full regeneration on re-finalize.

