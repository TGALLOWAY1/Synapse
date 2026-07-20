# The Experience Workspace (Screens)

> Extracted from CLAUDE.md. The screen-centric Screens view: stable ids, join layer, readiness/review/downstream/handoff phases (2–5C), mockup variants (3A–3D), overlays, and URL-addressable selection.

### The Experience workspace (Screens) — read-side consolidation

The old **Screen Inventory** and **Mockups** sidebar rows are consolidated into
one screen-centric **Screens** view (`selected === 'screens'`, a
`WorkspaceSelection` value, NOT an artifact slot). **This is a read-side view
layer only**: the `screen_inventory`, `user_flows`, and `mockup` artifacts keep
generating, persisting, and versioning exactly as before — no schema, prompt,
pipeline, sync, or snapshot change. Do not add persisted state for this view.

- **Stable screen ids** — every screen has a canonical `ScreenItem.id`,
  stamped by `assignStableScreenIds` inside `normalizeScreenInventory`
  (`src/lib/screenInventoryNormalize.ts`): existing content id → slug of the
  name → deterministic `-2`/`-3` suffix on duplicates, in document order.
  Because generation persists the normalized shape, **new inventories store
  their ids**, while legacy artifacts derive the *same* ids on every read (no
  regeneration/migration required — derivation is deterministic from stored
  content and never from a user-facing rename). `MockupScreen.sourceScreenId`
  (optional, back-compat) records the inventory screen a mockup screen was
  derived from (`generateMockup` stamps it; `mockupParsing.coerceScreen`
  round-trips it).
- **Join layer** — `src/lib/screenExperience.ts` (pure; no store/IDB/React;
  unit-tested in `src/lib/__tests__/screenExperience.test.ts`).
  `buildScreenIndex(inventory, flows, mockupPayload)` joins the three parsed
  artifact contents into a `ScreenExperienceIndex` with **`byId` (canonical,
  rename-safe) and `bySlug` (name-based, first-wins)** lookups. Mockup screens
  match by `sourceScreenId` first, then slugified `MockupScreen.name` (legacy
  fallback). Flow steps are markdown and only know names, so they match by
  exact slug of the parsed `[Screen Name]` step title (`stepScreenSlug`).
  **`stepScreenSlug` canonicalizes the `scr-` screen-seed prefix**
  (`stripScreenSeedPrefix` in `journeyNode.ts`) so a step whose bracket carries
  the canonical spine seed id (`[scr-infographic-library]` — a form the
  user_flows model sometimes emits instead of the human name, since the spine
  prompt tells it to "reuse screen seed ids") still joins to the
  `infographic-library` screen at read time (fixing already-final artifacts
  without regeneration). Because it is the single shared key for the
  flow→screen join, journey grouping, AND flow-node navigation, normalizing it
  there keeps all three consistent. The display mirrors this:
  `prettyScreenTitle` (also `journeyNode.ts`) renders a seed-id step title as
  its human name ("Infographic Library") in the flow renderer. The user_flows
  prompt was also tightened to write the human display name in the bracket, so
  new generations avoid the drift at the source. Only the `scr-` prefix (with a
  `-`/`_` separator) is stripped, so a real name like "Scribble Pad" is never
  touched.
  Screen selection/navigation uses the **id**; per-screen images stay keyed by
  the slug of the *stored* (generated) name, so both survive display renames.
  Missing artifacts degrade gracefully; a missing inventory returns the
  module-level `EMPTY_SCREEN_EXPERIENCE_INDEX` (stable reference —
  Selector-stability rule). Slug collisions keep **all** screens as items
  (unique ids), resolve `bySlug` to the first, and are surfaced via
  `index.collisions` (warning banner in the list).
- **Screen Detail is a lightweight product-DESIGN review surface, not an
  implementation dashboard (design-review simplification).** The Screen Detail
  view answers ONE question — "does this screen accurately represent the intended
  user experience?" — so everything implementation-leaning is either progressively
  disclosed or moved to the Implementation Plan artifact. The load-bearing rules:
  - **One review action: Confirm Screen** (`ScreenConfirmPanel`). It replaces the
    old three-action panel (Request changes / Accept / Mark ready to build). It is
    a plain toggle: **Needs review → [Confirm screen]**, and once confirmed
    **Screen confirmed · Confirmed from PRD Version N → [Edit again]**. Confirming
    maps to the `accepted` `reviewStatus` (preserving the data model + the sign-off
    signature); **editing a confirmed screen automatically returns it to Needs
    Review** (both `Edit again` and saving the edit form). `implementation_ready`
    is no longer settable from Screens (an implementation concern) but legacy
    screens carrying it still render as confirmed. The pure `screenReviewWorkflow`
    lib (statuses, issues, freshness, artifact gate) is UNCHANGED — only the UI
    collapsed to one action.
  - **Review Notes (`ScreenReviewNotes`)** — the calm, collapsed, action-oriented
    replacement for the old "Readiness Issues" panel AND the standalone "Risks &
    Edge Cases" section. Collapsed behind a one-line banner ("N items may benefit
    from review"); expanded, every row has an obvious next action — a generic note
    → Edit / Go to Flow / Go to Mockups + "Mark addressed" (dismiss); a risk → a
    "How should this be handled?" resolution box → Mark resolved. Dismissed issue
    ids and risk resolutions persist on NEW additive `ScreenReviewMeta` fields
    `dismissedIssues?: string[]` / `riskResolutions?: Record<string,string>` (the
    resolutions are structured product-owner input downstream artifacts can
    consume). A generated `proposedHandling` pre-fills the box but still needs
    owner confirmation.
  - **Developer Handoff moved OUT of Screens into the Implementation Plan
    artifact.** The Handoff tab (`ScreenHandoffView`) and the Overview's "Developer
    Handoff" section are removed; `ScreenDetailTab` is now `overview | flow |
    mockups` only (no `?screenTab=handoff`). All handoff GENERATION libs are
    preserved and untouched (`screenImplementationHandoff.ts`,
    `screenHandoffExport.ts`, `screenArtifactTraceBridge.ts`) and still power the
    list-level rollups in `ScreenCoveragePanel` / card details — only the per-screen
    handoff UI left Screens. Surfacing it inside the Implementation Plan renderer is
    a deferred follow-up.
  - **"Freshness" → "PRD sync" language.** The Mockups tab presents variant
    freshness in user terms (`In sync with PRD` / `May need regeneration` /
    `Needs regeneration` / `Generated before version tracking` — the unknown
    state is plain provenance, never "sync unknown"/"freshness" jargon) via a
    local `PRD_SYNC_LABELS` map in
    `MockupVariantsPanel`; the pure `mockupVariantTrust` `FRESHNESS_LABELS`
    constant is unchanged (still used by the non-UI export/handoff libs).
  - **Overview order (mobile-first):** Purpose + User goal → Primary mockup (the
    screen itself, inline near the top) → Review Notes → Acceptance checklist (a
    concise checklist; the full generated explanation sits behind a "Show generated
    details" disclosure) → PRD features (collapsed) → Screen details (collapsed:
    navigation, core UI regions, data, states). The noisy provenance badges
    ("Derived / Estimated / Mapped at generation / For your information") are gone.
    The `ScreenDownstreamImpactSection` component (which used to render this
    data inline in Screen Detail) has been **deleted as unreachable UI** —
    Screen Detail never rendered it after this simplification pass; the
    underlying `screenDownstreamImpact.ts` derivation lib is unchanged and
    still feeds the list/coverage/preflight surfaces below.
- **Views** — `src/components/experience/`: `ScreenListView` (a **flow-first**
  list — screens are the primary focus, implementation/traceability/readiness
  data is kept but visually secondary), `ScreenDetailView` +
  `ScreenDetailTabs` (per-screen **Overview / Flow / Mockups** tabs). They
  reuse existing pieces rather than duplicating them: Overview = the
  simplified `ScreenOverviewPanel` (see the design-review simplification above;
  the legacy `ScreenCard` survives in the standalone
  `ScreenInventoryRenderer` fallback) + the upload gallery; Flow =
  `FlowJourney`/`StepCard`/`FeatureDetailDrawer` with the current screen's
  steps highlighted (`highlightedStepIndices`) plus a per-flow "This screen
  appears in" context block (repeated appearances labeled "— Step N
  (appearance i of k)"; decision steps flag unspecified branch outcomes).
  The `FlowJourney` timeline **groups consecutive steps that share a screen**
  (`buildJourneyGroups` in `journeyNode.ts`, grouped by `stepScreenSlug`) into
  one card: the screen name shows once as the header (with a "Steps N–M"
  range), and each step reads as a sub-row **labeled by its user action** (the
  "— User action → System response" half the flat node list hid), so a screen
  owning several sequential steps is no longer repeated node-after-node. It is
  **pure presentation over the same parsed `user_flows` steps** — no schema,
  prompt, or persistence change, so it fixes legacy/demo flows without
  regeneration. The header navigates to the screen (slug-gated, unchanged),
  and single-step screens collapse to one
  row (keep `buildJourneyGroups` keyed on the same slug navigation uses, or a
  group header could point at the wrong screen). **The journey is the SINGLE
  rendering of a flow's steps** (2026-07 audit): `FlowJourney` takes an
  optional `renderStepDetail(stepIndex)` and sub-rows (plus a "Step detail"
  toggle on single-step cards) **expand in place** to a `StepCard` in
  `embedded` mode — both `UserFlowsRenderer` (whose duplicate "Step-by-step
  flow" card list was removed) and the Screen Detail Flow tab (whose
  per-screen StepCard dump was removed; it links out via `onOpenUserFlows`)
  pass it. Without the prop, rows keep the legacy scroll-to-card behavior;
  Mockups = the **Phase 3A `MockupVariantsPanel`**
  (`src/components/experience/MockupVariantsPanel.tsx`): a viewport × state
  **variant gallery** driven by `buildScreenMockupVariants`
  (`src/lib/mockupVariants.ts`, pure), with a derived summary row
  ("N of M recommended variants generated · K missing · coverage unknown for
  legacy mockup"), selectable variant cards (generated vs. missing, visually
  distinct), and a **selected-variant detail panel**. The primary generated
  Default variant renders the existing `MockupScreenImage` (its
  generate/upload/regenerate actions are untouched); missing variants are
  honest placeholders (NO per-variant generation in Phase 3A — no dead
  "Generate variant" button); a `buildMockupSpecCoverage` panel shows spec
  coverage or an honest "Coverage unknown" for legacy mockups. See the
  "Mockup variants (Phase 3A)" bullet below. Shared priority-chip styles live in
  `src/components/renderers/screenPriority.ts`
  (own module — the react-refresh/only-export-components rule forbids constant
  exports from component files).
- **Flow-first list IA (`ScreenListView` + `src/lib/screenFlowView.ts`, pure,
  unit-tested).** The Screens list leads with the product experience — what
  screens exist, how they connect, and which flow they belong to — and keeps
  every implementation/traceability/readiness/review signal reachable but
  visually secondary. `screenFlowView.ts` is the pure presentation layer:
  `deriveScreenConnections(item)` reads a screen's own contract for connection
  **names, not counts** (outgoing = `exitPaths[].target`, incoming =
  `entryPoints`, plus joined `relatedFlows` titles); `buildScreenGroups(index,
  mode)` groups screens `'flow'` (primary-flow assignment — the flow where a
  screen appears earliest — with a trailing "Other screens" bucket for
  flow-less screens, screens ordered by step within a flow), `'section'`, or
  `'priority'`; `hasFlowGrouping`/`flowFilterOptions` drive the defaults. The
  header is deliberately **minimal — only two controls, `Flow` and `Status`
  selects** (a UX-simplification pass: search, Priority/Sort/Group selects, and
  the Advanced drawer were all removed to surface the screens immediately and
  cut mobile clutter). Grouping is no longer user-configurable — screens are
  **always grouped by flow** when flows exist (`section` otherwise). The
  long-tail filter *ids* (`has_blockers` / `review_recommended` /
  `outdated_review` / `downstream_review` / `handoff_ready` / `handoff_blocked`
  / `missing_mockups` / `has_risks`) still exist in `screenMatchesFilter` (they
  drive the detail disclosures + preflight) but are **no longer exposed as UI
  controls**. Each card shows **one prominent badge
  (priority)** + title + purpose + a mini flow strip ("Next → …" from
  `deriveScreenConnections`, else "Part of <flow>") + a single muted readiness
  badge; **all other metadata** (review, traceability, handoff, mockup
  coverage, states, risks, downstream impact) moves behind a per-card **"Show
  details"** disclosure. The **old global metadata/action toolbar** that sat
  above the list (Generated-from-PRD chip, screen-inventory Version history +
  staleness / Mark-up-to-date, Mockup history, Regenerate Mockup, and the
  design-drift banner) is **removed**; those artifact-level controls are passed
  to `ScreenListView` as an `artifactControls` prop (`ScreenArtifactControls`)
  and rendered **once, as an "Artifact metadata & actions" block inside the
  collapsed "Project readiness & metadata" section** (the 2026-07 Screens UX
  audit moved them out of each card's "Show details" — repeating artifact-wide
  actions per card implied a per-screen scope they never had; the per-card
  details keep only a quiet per-screen Source/provenance row). Their underlying
  scope is unchanged (version history is the
  screen_inventory artifact's, mockup history/regeneration the mockup
  artifact's — one shared handler set), so there is no data-model / versioning /
  mockup-pipeline change. Color is reserved for priority + genuine warnings
  (blockers/risks/stale/blocked). The **Screen Coverage & Readiness**,
  implementation-preflight, and handoff-export panels are collapsed by default
  under a single "Project readiness & metadata" section (kept mounted, hidden
  via CSS) so the screens stay the focus. This is presentation-only over the
  existing join/readiness/review/handoff/downstream layers — no schema, prompt,
  pipeline, or persistence change.
- **Readiness & coverage layer (`src/lib/screenReadiness.ts`, pure,
  unit-tested — no store/LLM/persistence).** Computed at read time over the
  join layer: per-screen **gap detection** (`detectScreenGaps`: missing
  purpose / traceability / navigation / states, **invalid (stale) feature
  refs when a PRD feature list is supplied**, states without behavior, P0
  without mockup, **contract-recommended state variants without mockups**,
  risks without recorded handling, **flow decisions without parseable branch
  outcomes**, no flow refs) rolls into a
  per-screen **readiness status** (`deriveScreenReadiness` → draft /
  needs_review / accepted / implementation_ready).
  **Mockup variants are an optional enhancement, never a readiness
  requirement.** Synapse deliberately generates ONE primary
  implementation-quality mockup per screen (a missing P0 primary mockup is
  still `missing_mockup_p0`, review-triggering) and offers the extra viewport ×
  state variants on demand. So `OPTIONAL_ENHANCEMENT_GAPS`
  (`missing_state_variants`) is **excluded from status scoring**:
  `deriveScreenReadiness` scores off `gaps.filter(g => !OPTIONAL_ENHANCEMENT_GAPS.has(g.kind))`
  while still returning the full gap list (incl. the optional variant gap) so
  the detail view can surface it as an opportunity. A screen with every
  required asset is `implementation_ready` even when its optional variants are
  ungenerated. `missing_state_variants` is NOT in `REVIEW_TRIGGER_GAPS`. Never
  re-add variant gaps to readiness scoring — they are additive documentation.
  A **user-set status** —
  the optional `reviewStatus` field on the existing `ScreenMetadataEdit`
  overlay — always wins (`source: 'user'`) but never hides derived warnings
  (an `accepted_with_warnings` gap is appended); a derived status is always
  presented as estimated (`source: 'derived'`, `ReadinessBadge` renders an
  "estimated" suffix). `buildReadinessIndex(index, features?)` computes the
  variant/decision inputs itself. `buildScreenCoverageSummary` feeds the list
  panel — PRD-feature coverage estimated from `featureRefs` id tokens (plus
  `mustWithoutPrimaryScreen`: must-priority features only covered by P2/P3
  screens), a **recommended-state-variant rollup** (`stateVariants`, null for
  legacy specs), flow
  representation (requires the FULL parsed flows list, since the index only
  records matched flows), P0/mockup/state counts, open risks (riskDetails
  with a `proposedHandling` don't count), a **confirmed count** (`ready` counts
  user sign-off — `accepted` OR `implementation_ready` — plus derived
  implementation_ready; counting only the legacy `implementation_ready` status
  read "0 of N ready" on fully confirmed projects, the 2026-07 audit's worst
  trust failure),
  and one deterministic readiness sentence. **Review vocabulary is
  Draft / Needs review / Confirmed** (`REVIEW_STATUS_LABELS` maps both
  `accepted` and the legacy `implementation_ready` to "Confirmed"; the status
  filter no longer exposes a separate "Ready" option, though the
  `screenMatchesFilter` ids survive). Also here:
  `buildScreenTraceability` (featureRefs resolved against PRD `features`;
  **confidence `explicit` (every ref resolves) / `estimated` / `missing`** +
  `invalidRefIds` — "explicit" is still a generation-time claim, label it
  "mapped at generation", never "verified"), `deriveAcceptanceCriteria`
  (deterministic restatement of intent/exits/states/risks — capped, deduped,
  labeled derived), `buildScreenHandoff` (re-projection of existing fields
  only; route/accessibility have no data source and render "Not specified"),
  `buildMockupSpecCoverage` (token-overlap spec-to-spec comparison — present
  as "in the mockup spec", NEVER as visual detection of the image), and the
  list filters (`SCREEN_LIST_FILTERS`/`screenMatchesFilter`: All / P0 / Draft /
  Needs review / Accepted / Ready / Has blockers / Review recommended /
  Missing mockups / Has risks — `screenMatchesFilter` takes an optional
  `ScreenFilterReview` so the review-status/blocker filters key off the Phase 4A
  review model). **Honesty rule:
  everything derived is an estimate — keep the "estimated"/"derived" labels
  and "Not specified"/"Review recommended" fallbacks; never fabricate risk
  severity, mockup variants, routes, or per-state mockup coverage, and never
  present a derived status as user-confirmed.** All of it stays advisory —
  nothing gates rendering or generation. **A user override of
  `implementation_ready` over unresolved review-trigger gaps is counted in
  `summary.readyWithWarnings` and excluded from the "all screens pass"
  rollup** (`buildMessage` uses `ready − readyWithWarnings`; `ScreenCoveragePanel`
  gates its green all-clear on `readyWithWarnings === 0`) so a human override
  can never make the artifact-level summary read clean while warnings remain.
- **Phase 4A — screen review & approval workflow (`src/lib/screenReviewWorkflow.ts`,
  pure, unit-tested).** Turns the Screens artifact from a reference surface into a
  review workflow, layered ON TOP of the readiness/variant/trust layers (never
  changing them). It deliberately keeps **two distinct concepts** — do not
  collapse them: **(1) USER review status** — the human sign-off, persisted in the
  existing `ScreenMetadataEdit.reviewStatus` overlay
  (draft/needs_review/accepted/implementation_ready); and **(2) SYSTEM readiness**
  (`SystemReadinessStatus`: ready / needs_review / blocked) — Synapse's derived
  estimate from the issue set, never overridden by the buttons. A screen can be
  user-Accepted while system readiness says "review recommended", or user-Draft
  while the system says "ready to accept". `deriveScreenReviewIssues` reuses
  `detectScreenGaps` + `resolveAcceptanceCriteria`/`resolveScreenHandoff` +
  precomputed mockup/freshness signals to produce **`ScreenReviewIssue`s**
  (severity `blocking` | `review` | `info`, categorized) with a `recommendedAction`.
  Blocking = missing purpose, missing traceability/navigation on a **primary**
  (P0/P1) screen, P0 without a default mockup, a required state with no behavior,
  no derivable acceptance criteria, an unresolved high-severity risk on a P0
  screen. Review = stale mockups, unresolved risks,
  decisions without branch outcomes, thin handoff, stale
  PRD refs. Info = freshness/coverage unknown (legacy metadata — NEVER a
  blocker), no flow refs, **and the optional mockup-variant nudges (`mockup_mobile_missing`,
  `mockup_state_variants_missing`)** — additional viewport/state variants are
  generated on demand, so a missing one is `info` (discoverable) and must NEVER
  be `review`/`blocking` (that would let optional design coverage reduce a
  screen's system readiness). Only the P0 *primary* mockup gates. `buildScreenReviewModel`/`buildScreenReviewModelForItem`/
  `buildScreenReviewIndex` assemble the per-screen `ScreenReviewModel` (status +
  systemReadiness + issues + counts + `acceptedOverWarnings` + freshness +
  checklist progress); the views use the `-ForItem`/`-Index` wrappers (which build
  the variant grid), pure tests use the low-level fn with explicit signals.
  **Supporting review record** rides a NEW additive overlay field
  `ScreenMetadataEdit.review` (`ScreenReviewMeta` in `src/types`: checklist, note,
  override reason, sign-off `signature`, transition timestamps, plus the Review
  Notes fields `dismissedIssues?: string[]` / `riskResolutions?: Record<string,
  string>` added by the design-review simplification) — status stays in
  `reviewStatus`, so all existing wiring is untouched; `readScreenEdits` parses it
  defensively and preserves unknown keys. **Review freshness (re-review after
  acceptance):** `buildScreenReviewSignature` captures `computeScreenReviewHash`
  (a self-contained FNV-1a hash of the substantive spec — purpose/intent/priority/
  states/nav/UI/risks/criteria/traceability/handoff, **excluding the display-only
  `name` rename and overlay-only fields** so a pure rename never trips it) at
  accept/implementation-ready; `compareReviewFreshness` → `current` | `outdated` |
  `unknown` (**no stored signature = `unknown`, legacy records NEVER falsely
  outdated**, mirroring mockup freshness). **Artifact-level readiness gate:**
  `buildScreenArtifactReviewReadiness`/`summarizeArtifactReviewReadiness` roll the
  models up — **P0 screens are the gate**: ready iff every P0 screen is
  user-signed-off (accepted/implementation_ready) AND no P0 screen carries
  blocking issues. It is a **readiness signal, NOT a hard lock** — nothing gates
  rendering or generation. UI (**since the design-review simplification above,
  the Screen Detail surface for this lib is `ScreenConfirmPanel` (single Confirm)
  + `ScreenReviewNotes`, NOT the retired `ScreenReviewPanel`**): the confirm
  toggle + the collapsed action-oriented Review Notes, review status +
  issue counts in each `ScreenListView` card's "Show details" disclosure, and a
  "Review readiness" rollup + gate
  callout in `ScreenCoveragePanel`. Persistence flows through the existing
  `handleSaveScreenEdit` → `updateArtifactVersionMetadata` overlay path
  (timestamps/signatures stamped in `ScreenDetailView`, not the pure module).
  Language stays calm ("Review recommended", never "Invalid").
- **Phase 4B — downstream impact tracking + Screens preflight
  (`src/lib/screenDownstreamImpact.ts`, pure, unit-tested).** Layers ON TOP of
  the Phase 4A review layer (never changing it) to answer "an accepted screen
  changed — now what?". All **derived, never persisted** (a stale persisted
  verdict is worse than none). `buildScreenDownstreamImpact(input)` maps a
  screen's review signals to the downstream artifacts a change/blocker may have
  invalidated, one entry per **`DownstreamArtifactKind`** (mockups / data_model /
  implementation_plan / prompt_pack / user_flows / design_system / export),
  highest severity per kind (`blocking` | `review` | `info`). Conservative,
  explainable rules: (1) an **accepted/implementation-ready screen that changed
  after sign-off** (`reviewFreshness === 'outdated'` — from Phase 4A's
  `compareReviewFreshness`) → Mockups (review), Implementation Plan (review, or
  **blocking** when a P0 was already `implementation_ready`), Data Model (review,
  only when the screen carries data requirements — `outputData` / handoff
  data-deps), Prompt Pack (info); (2) a **P0 screen with blockers** → Implementation
  Plan **blocking**; (3) **stale mockup variants** (Phase 3C freshness, surfaced as
  the `mockup_freshness_stale` review issue) → Mockups review; (4) **unknown
  mockup freshness** (legacy metadata) → **info, never a blocker**. A draft/
  unsigned screen never produces the change-driven impacts.
  `screenDownstreamInputFromModel(item, model)` derives the input from the Phase 4A
  `ScreenReviewModel` (so the two layers can't drift). `buildScreensDownstreamImpactRollup`
  rolls per-screen impacts up to `overallStatus` **ready / review_recommended /
  not_ready** — **not_ready** iff the Phase 4A gate isn't ready OR any P0
  accepted/impl-ready screen is outdated OR any P0 has a blocking downstream
  impact; **review_recommended** for review-level impacts with a clean P0 gate;
  **ready** otherwise. `buildRecommendedNextActions` produces a prioritized list
  (P0 blockers → re-review outdated accepted P0 → accept remaining P0 → stale P0
  mockups → implementation plan → supporting screens → unknown legacy mockups),
  **capped to 5**. `buildScreensPreflight` assembles the implementation/export
  preflight (blocking / review / info / recommended next steps / export-snapshot
  caveats — e.g. the Phase 3D variant-image cross-device-sync gap).
  `analyzeScreensDownstream(index, reviewModels, artifactReview)` is the single
  entry point the workspace calls. **UI:** the `ScreenDownstreamImpactSection`
  component (which rendered the impacted-artifact list / calm empty states) has
  been **removed** — per the design-review simplification it was never shown in
  Screen Detail after this pass, so downstream-impact data now surfaces only via
  a compact downstream note in each `ScreenListView`
  card's "Show details" disclosure (only when a blocking/review impact exists —
  info-only shows nothing), a
  **Downstream impact** section in `ScreenCoveragePanel` (which, per the
  2026-07 audit, renders NOTHING when `overallStatus === 'ready'` — the old
  always-on green "Ready for implementation planning" banner duplicated and
  could contradict the Phase 4A review gate above it), and a collapsible
  **`ScreenPreflightPanel`** ("Implementation preflight") in the collapsed
  project-metadata section. Two list filters — **Outdated review**
  (`reviewFreshness === 'outdated'`)
  and **Downstream review** (`downstreamReviewNeeded`) — extend
  `SCREEN_LIST_FILTERS` / `ScreenFilterReview` (surfaced in the Advanced filter
  drawer) (the caller supplies the new
  signals; `screenReadiness.ts` must NOT import `screenDownstreamImpact` — that
  would cycle). **No export/finalization hook was added**: there is no
  Screens-specific export/share/finalize action today (the PRD Mark-as-Final /
  UpdateAssetsPlan flow is PRD-level, not per-artifact), so the local preflight
  panel is the Phase 4B decision surface — a safer choice than hooking into an
  unrelated flow. Everything stays **advisory** — nothing gates rendering or
  generation, and legacy artifacts (no review data) show no impact/blocker.
- **Phase 5A — implementation handoff packages + build-task bridge
  (`src/lib/screenImplementationHandoff.ts`, pure, unit-tested).** Layers ON TOP
  of the Phase 4A review + Phase 4B downstream layers (never changing them) to
  turn an accepted screen into a **developer-ready build contract**. All
  **derived, never persisted**. `buildScreenImplementationHandoff({item,
  reviewModel, variants, downstream?, features?})` produces a
  `ScreenImplementationHandoff`: **route** (explicit generated `handoff.route` →
  small keyword map → slugified title, tagged `explicit`/`derived`/`missing`),
  **components** (handoff `primaryComponents` → core UI regions → mockup UI
  elements → title, PascalCased), **state** (handoff `stateVariables` +
  per-non-default-state status vars), **events** (handoff `events` + exit-path +
  flow user-action handlers, `on…`-named), **data dependencies** (handoff
  data/api deps + `outputData`, keyword-classified entity/api/storage/…, with a
  "No linked data model entities found" review warning when empty — **there is no
  real Data Model trace; everything is estimated, never claimed as verified**),
  **mockup references** (variants holding a real image / accepted, with Phase 3C
  freshness + coverage), **acceptance criteria** (`resolveAcceptanceCriteria`),
  a **QA checklist** (rendering/interaction/state/data/accessibility/responsive/
  error_handling/acceptance, restated from the spec), and a small **build-task
  list** (route/component/state/data/mockup/qa/accessibility, each with a
  `priority` and a `source`). Individual derivers (`deriveHandoffRoute`/
  `…Components`/`…State`/`…Events`/`…DataDependencies`/`…QaChecklist`/
  `…BuildTasks`/`…Readiness`) are exported for pure testing. **Readiness**
  (`deriveHandoffReadiness` → `ready` | `review_recommended` | `blocked`):
  blocked on the clear cases (system-readiness blockers, unsigned/outdated/
  downstream-blocking P0, no acceptance criteria, no route/component guidance on
  a primary screen); review-recommended is the honest common state (accepted
  with review items, stale mockups, missing data trace, thin handoff); ready
  requires sign-off + no blockers + minimal guidance. **UNKNOWN mockup
  freshness (legacy metadata) and a missing optional mobile variant are
  deliberately NOT review reasons** (2026-07 audit): unknown is info and
  variants are optional everywhere else, and counting them made every accepted
  screen on a legacy project read "review recommended" — both still surface in
  the QA checklist only.
  `buildScreensHandoffRollup(handoffs, p0Ids)` rolls up ready/review/blocked
  **gated on P0** (the export panel uses `renderScreensHandoffExportMarkdown`
  from `screenHandoffExport.ts` — see Phase 5C below; the per-screen
  `renderHandoffMarkdown` copy export was deleted as dead code once that panel
  shipped); `buildHandoffPreflightContribution` feeds the Phase 4B preflight via the
  structural `PreflightContribution` param on `buildScreensPreflight` /
  `analyzeScreensDownstream` (screenDownstreamImpact **never imports** the handoff
  module — that would cycle; the caller passes the contribution in). **UI (per
  the design-review simplification above, the per-screen Handoff tab
  (`ScreenHandoffView`) and its `?screenTab=handoff` route were REMOVED from
  Screens and the developer handoff moved to the Implementation Plan artifact —
  the lib below is fully preserved and now surfaces only via the list-level
  rollups):** a **handoff readiness** row in each
  `ScreenListView` card's "Show details" disclosure; **Handoff ready / Handoff
  blocked** Advanced-drawer filters
  (`SCREEN_LIST_FILTERS` + `ScreenFilterReview.handoffReadiness`); and an
  **Implementation handoff** rollup section in `ScreenCoveragePanel` — since
  the 2026-07 audit a single quiet line ("N of M screens ready to package",
  amber only when screens are genuinely `blocked`; no verdict banner, no
  "Handoff trace" strip, and no per-card HANDOFF row — the review gate is the
  one verdict inside Screens). Everything
  stays **advisory** — nothing gates rendering or generation, and legacy/sparse
  screens degrade to "Not specified" / review warnings, never crash. **No
  Implementation Plan bridge was added in Phase 5A** (deliberately — the plan
  artifact is not mutated or coupled; a trace-backed plan bridge is deferred to
  Phase 5B) and no Screens-specific export/finalization hook was added (the local
  Handoff tab + copy action is the decision surface, mirroring Phase 4B).
- **Phase 5B — trace-backed Data Model + Implementation Plan bridge
  (`src/lib/screenArtifactTraceBridge.ts`, pure, unit-tested).** Layers ON TOP
  of the Phase 5A handoff (never changing it) to make the handoff trustworthy: a
  **READ-ONLY correlation** between a screen and the already-loaded **Data Model**
  and **Implementation Plan** artifacts. It never mutates, fetches, or regenerates
  a downstream artifact. `buildScreenArtifactTraceBridge(ctx, dataModel, plan)`
  produces a `ScreenArtifactTraceBridge`: per-entity **Data Model matches**
  (`ScreenDataModelMatch` — evidence order: shared PRD **feature ref** →
  `explicit`; a data-dependency/component **naming the entity** → `strong`;
  **field-name** overlap → strong/weak field matches; bare **token overlap** →
  `weak`; else dropped) and per-task **Implementation Plan matches**
  (`ScreenImplementationPlanMatch` — milestone **explicitly links the screen** or
  a task links a shared **feature id** → `explicit`; **route path** / exact
  **component name** / exact **screen title** in a task → `strong`; component/title
  **token overlap** → `weak`), each with a `TraceConfidence`
  (`explicit`/`strong`/`weak`/`estimated`/`missing`) and a plain-language reason.
  `overall.confidence` is the **weaker of the two present traces** (a chain is
  only as strong as its weakest link). **Honesty rules stand:** a token overlap is
  `weak`, never "confirmed"; a **missing artifact** (`null`) is an info note, never
  a review nag; a **present-but-unmatched** artifact is review-worthy, never a
  hard blocker. Content resolvers `resolveDataModelForTrace` / `resolvePlanForTrace`
  (pure) accept the structured JSON shapes AND markdown (the standard data_model
  storage format is markdown via `structuredArtifactToMarkdown`, so the resolver
  recovers each entity's `**Related Features:**` line so explicit shared-feature
  matches still fire; the plan resolver maps milestone deliverables into
  pseudo-tasks) so stored/legacy artifacts still correlate by
  feature/name/route/title. Plan matching also honors task-level
  `linkedArtifacts.mockups` (screen names) in addition to milestone
  `linkedArtifacts.screens`. **Absent vs. unmatched:** an ABSENT artifact
  (`null`) yields `missing` confidence with an "artifact not available" warning
  and is NEVER surfaced as a coverage gap — preflight review items and the
  rollup `p0PlanMissing` / `p0DataModelMissing` counts are warning-gated on the
  present-but-unmatched wording, so a new/partial project isn't flagged before
  the downstream artifact exists.
  - **Handoff integration** (`screenImplementationHandoff.ts`).
    `buildScreenImplementationHandoff` gained optional `dataModel` /
    `implementationPlan` inputs — **`undefined` (omitted) → no bridge (Phase 5A
    behavior, for legacy/test callers); `null` → artifact absent (info, no nag);
    content → correlate.** The workspace always passes both (resolved off the
    `data_model` / `implementation_plan` preferred versions). When present, the
    bridge **upgrades** each estimated `HandoffDataDependency` in place
    (`source: 'data_model_trace'` + `matchedEntity`/`matchedField`/`confidence` —
    never fabricates a match), exposes `implementationPlanReferences` and the full
    `traceBridge`, adds trace-review **readiness** signals
    (`dataModelTraceMissing` / `planBridgeMissing` (accepted P0 only) /
    `traceConfidenceWeakForP0` — all **review-recommended, never blocking**; they
    fire only when the relevant artifact was PRESENT), and folds trace guidance
    into `buildHandoffPreflightContribution` (the since-deleted
    `renderHandoffMarkdown` used to render matching `## Trace Confidence` /
    `## Data Model Support` / `## Related Implementation Plan Items` sections;
    the Phase 5C export below covers this ground now). `buildScreensHandoffRollup` gained a
    `ScreensTraceRollup` (strong/estimated/missing counts + P0 plan/data-model
    gaps; null when no screen carried a bridge).
  - **UI.** The per-screen `ScreenHandoffView` (which rendered the **Trace
    confidence** summary, **Data Model support** matches, **Related implementation
    plan items**, per-dependency trace tags, and trace notes) was **removed from
    Screens with the rest of the developer handoff** (design-review
    simplification); the trace-bridge lib is preserved for the deferred
    Implementation Plan surfacing.
    each `ScreenListView` card's "Show details" disclosure surfaces a trace
    concern (only on a real concern — "No plan match" / "Trace needs review",
    never on a strong trace);
    `ScreenCoveragePanel`'s handoff section shows the trace rollup. **No new list
    filters** were added (the details disclosure + preflight
    carry the signal). Everything stays **advisory**; nothing gates rendering or
    generation, and screens with no downstream artifacts degrade to `missing`
    with an info note, never a crash. **No downstream artifact is mutated and no
    new export/finalization flow was added** — the Handoff tab + copy action is
    the decision surface (a full trace-aware export is a Phase 5C follow-up).
- **Phase 5C — trace-aware Screens handoff export + finalization preflight
  (`src/lib/screenHandoffExport.ts`, pure, unit-tested).** Layers ON TOP of the
  Phase 5A/5B handoffs + Phase 4B preflight (never changing them) to turn the
  trace-backed handoff into a practical, exportable implementation *package* —
  the Phase 5C follow-up the 5B note deferred. All **derived, never persisted**;
  it MUTATES no artifact and does NOT rewrite Synapse's global export system.
  `buildScreensHandoffExportPackage(input)` composes the already-derived pieces
  (per-screen `ScreenImplementationHandoff`s incl. their Phase 5B trace bridges,
  the Phase 4A review models, and the Phase 4B `ScreensPreflightModel` already
  folded with the handoff contribution) into a **schema-versioned**
  (`schemaVersion: 1`) `ScreensHandoffExportPackage`: `summary` (screen/P0/
  accepted/impl-ready/blocked/review counts + trace-confidence buckets + mockup
  generated/missing/stale/unknown counts), `preflight` (blocking/review/info/
  next-actions, verbatim from Phase 4B), per-screen projections
  (route/components/state/events/data deps — trace-tagged when upgraded to
  `data_model_trace` — acceptance/QA/build-tasks, mockup **references only**,
  trace matches + warnings, issues by severity), and a `manifest` (PRD / Screens
  / Data Model / Implementation Plan / Design System version ids + present
  artifacts + honesty `caveats`). **Export status** (`deriveScreensExportStatus`
  → `ready` | `review_recommended` | `not_ready`) is the **more conservative
  fold** of the Phase 4B preflight status and the Phase 5A/5B handoff-rollup
  status (mapping the rollup's `blocked` → `not_ready`) — so it can never
  contradict the preflight the user already sees, and an **absent Data Model /
  Implementation Plan artifact is a manifest caveat, never an automatic
  `not_ready`** (the Phase 5B rule holds: only a PRESENT-but-unmatched artifact
  is review-worthy). **Honesty rules stand:** correlation is label/token-based,
  not proof; **NO binary mockup image data is embedded** — only labels/freshness/
  coverage references travel (both renderers assert this); legacy unknown mockup
  freshness is a caveat, never a blocker; `SCREENS_HANDOFF_EXPORT_CAVEATS` (the
  standing honesty caveats) is always included so UI + markdown + JSON read the
  same. `renderScreensHandoffExportMarkdown` (copy/paste-ready — summary →
  preflight → manifest → per-screen sections incl. Data Model Support / Related
  Implementation Plan Items) and `renderScreensHandoffExportJson`
  (`JSON.stringify(pkg, null, 2)`) are the two export formats;
  `screensHandoffExportFilename` builds the download name. **UI:**
  `ScreensHandoffExportPanel` (`src/components/experience/`) — a local,
  collapsible panel rendered by `ScreenListView` inside the collapsed
  project-metadata section, below `ScreenPreflightPanel`: an export-readiness
  header + status banner (calm,
  **non-blocking** even when `not_ready` — it still exports, mirroring the
  Phase 4B "decision surface, never a gate" rule), summary stat tiles, Copy /
  Download for Markdown and JSON (clipboard → textarea fallback, Phase 5A
  pattern), and a "What's included & caveats" disclosure. `ArtifactWorkspace`
  supplies the memoized `exportManifest` (version ids + artifact presence) and
  `projectName`; the panel stamps `exportedAt` (via `new Date()`) at build time
  so the pure builder stays deterministic. Everything stays **advisory** —
  nothing gates rendering or generation; demo/keyless projects export the same
  (no key needed). **No server-side export storage, no persisted export state**
  (an optional "last exported" overlay was deliberately skipped — the package
  itself is enough and a stale exported-status is worse than none).
- **Phase 2 — source-grounded screen contracts.** New screen_inventory
  generations emit an explicit contract per screen (all fields optional &
  back-compat on `ScreenItem`/`ScreenState` in `src/types`): structured
  states (`type` (`ScreenStateType`), `systemBehavior`, `required`,
  `needsMockup`, per-state `acceptanceCriteria`), structured
  **`riskDetails`** (`severity` + `proposedHandling` — normalization derives
  the legacy `risks` string list from these when absent, so old consumers
  keep working; the schema no longer asks for plain `risks`), screen-level
  **`acceptanceCriteria`**, and a **`handoff`** spec (`ScreenHandoffSpec`:
  route/routeParams/primaryComponents/stateVariables/events/data+api
  dependencies/accessibility+responsive notes). The prompt instructs the
  model to omit fields the PRD doesn't support — the UI shows "Not
  specified", never invented detail. **Resolution order everywhere: user
  overlay → source contract fields → Phase 1 derived values → safe
  fallbacks** — `resolveAcceptanceCriteria` / `resolveScreenHandoff` return a
  `source: 'generated' | 'derived'` tag the UI must surface ("From generated
  spec" vs "Derived from this spec"). Round-trip lives in
  `screenInventoryNormalize.ts` (parse + `screenInventoryToMarkdown`) and the
  Gemini schema in `artifactSchemas.ts` — extend all three together (JSON
  mode can't emit properties absent from the schema). Legacy artifacts keep
  rendering through the Phase 1 derived layer — never require contract
  fields.
- **Per-state mockup variant tracking is metadata-based, never visual.**
  Two layers build on the same `mockupVariantStatus` overlay keys and must stay
  compatible:
  - **Readiness layer** — `buildMockupVariantRows(item, platform?)`
    (`screenReadiness.ts`) derives one row for the default view (status
    `generated` iff the screen joins a mockup screen) plus one per documented
    non-default state (`required` iff `state.needsMockup`); a default-`type`
    state folds into the default row. Rows carry a deterministic id
    (`default` / `state:<slug>`) — the overlay key for the user-set
    **`mockupVariantStatus`** map (`'accepted' | 'not_needed'`) on
    `ScreenMetadataEdit`. A missing **state** row (never the default row —
    that's `missing_mockup_p0`'s job, and counting it would downgrade legacy
    mockup-less P2/P3 screens) left `missing` while `required` produces the
    `missing_state_variants` gap; `accepted`/`not_needed` resolve it. **That gap
    is OPTIONAL (`OPTIONAL_ENHANCEMENT_GAPS`) — it is surfaced for discovery but
    excluded from readiness scoring, so it never downgrades a screen's status**
    (see the Readiness & coverage layer above).
  - **Phase 3A discovery layer (`src/lib/mockupVariants.ts`, pure,
    unit-tested)** — `buildScreenMockupVariants(item, {platform, mobileRelevant})`
    adds a **viewport dimension** (desktop / mobile / tablet) on top of states,
    for the Mockups-tab gallery + screen-card summary + coverage-panel rollup.
    A legacy single-image mockup normalizes to **`Desktop · Default`**
    (`source: 'legacy'`, `coverageStatus: 'unknown'` — no per-variant coverage
    metadata was ever captured). **The primary Default variant's `generated`
    status is gated on ACTUAL image presence, not the spec join alone (SYN-003).**
    `buildScreenMockupVariants` takes an optional
    `BuildVariantOptions.defaultImagePresence` (`present` | `absent` | `checking`
    | `unknown`) — the authoritative image-store evidence for the Default slot,
    derived by the pure `src/lib/mockupImagePresence.ts`
    (`deriveDefaultImagePresence`: ANY record in the AI mockup store OR the
    screen-inventory upload store → `present`; both stores settled + none →
    `absent`; otherwise `checking`). The Default is `generated`/`legacy` only when
    the spec join exists AND presence `!== 'absent'`; an image-absent default is
    honest `missing` with **`source: 'derived_missing'`**, `coverageStatus:
    'unknown'`, and a "spec exists but no rendered image was found" note.
    `checking` keeps it `generated` (no flap mid-hydration) and the UI shows a
    neutral "Checking…" pill (`imagePresence` rides on every
    `DerivedMockupVariant`). **Unset / `'unknown'` = EXACT legacy behavior**, so
    un-wired callers and pure tests are unchanged. Callers resolve presence from
    the reactive stores and pass it down: `ArtifactWorkspace` builds a memoized
    `defaultImagePresenceByScreen(screenId)` (loading `mockupImageStore` +
    `screenInventoryImageStore` for the mockup version — the list/coverage views
    used to never load them) and threads it into
    `buildMockupVariantCoverageSummary` / `buildScreenReviewIndex` (both gained a
    per-screen `defaultImagePresenceByScreen` option) and `ScreenListView`;
    `ScreenDetailView` derives its own for the open screen. `mockupImageStore`
    gained a `loadedVersions` settled-signal (set on BOTH the records-found and
    the empty path) so a consumer can tell "no image yet, still loading" from
    "provably absent". **Deliberate non-change:** `screenReadiness.ts`
    `buildMockupVariantRows` / the `missing_mockup_p0` gap stay SPEC-derived —
    readiness gaps are work-planning signals in pure batch derivations with no
    reactive store access; making them device-image-aware would flip statuses
    transiently during hydration and conflate "asset missing on this device" with
    "work not done". The variant layer is the visual-truth surface.
    Recommendations are DERIVED estimates:
    `Desktop · Default` for every primary screen, `Mobile · Default` **only
    when the project is `mobileRelevant`** (mobile-first / responsive — then on
    every screen, P0 included), and important documented states. **A web/desktop
    project (`mobileRelevant` false) recommends NO Mobile variant — not even for
    its P0 screens** — so it never surfaces "mobile coverage" gaps for a
    platform that ships no mobile UI; `buildMockupVariantCoverageSummary` counts
    a P0 screen toward `p0Total` only when a Mobile default is actually
    recommended, so the "Mobile coverage (P0)" panel row stays hidden for
    non-mobile projects. Do **not** re-gate the Mobile recommendation on
    priority alone.
    **Overlay-key compatibility**: the primary-viewport Default reuses `default`
    and primary-viewport states reuse `state:<slug>` (shared with the readiness
    layer); only the secondary-viewport default introduces `${viewport}:default`.
    `summarizeScreenVariants` (per-screen card) and
    `buildMockupVariantCoverageSummary` (artifact rollup: recommended
    generated/total, **`additionalGenerated`/`additionalTotal`** — recommended
    variants EXCLUDING each screen's primary Default row, i.e. the optional
    "expanded coverage" pool the panel shows separately from required primary
    mockups — P0 mobile coverage, legacy-unknown count) drive the UI.
    This layer is **display/discovery only — it never changes review status.**
    In `MockupVariantsPanel` the gallery leads with the primary Default and
    groups the rest under **"Optional variants — generate on demand"**; a
    non-generated variant reads neutral "Not generated / Available on demand",
    never an amber "Missing", and the per-variant **"Mark accepted" action was
    removed** (Confirm Screen is the one acceptance; the `mockupVariantStatus`
    overlay's `accepted` value still renders for legacy data, and "Not needed"
    + Undo remain).
    The **Screen Coverage & Readiness panel (`ScreenCoveragePanel`) presents
    these variants as optional, NOT a checklist**: a green "Ready for
    Development" section lists the required implementation assets (PRD links,
    flows, primary mockups, states, open risks, ready count) with a progress
    bar, and a separate neutral "Expanded Design Coverage" section frames the
    additional variants positively ("N generated · M available on demand", an
    "Optional" bar, a discovery card pointing at the per-screen Mockups tab) —
    no warning color, no "recommended" ratio. Keep required vs. optional split;
    orange/amber is reserved for genuine implementation risk (uncovered PRD
    features, a P0 without its primary mockup, unhandled risks).
  - **Phase 3B single-variant generation (`src/lib/mockupVariantRequest.ts`
    pure + `src/lib/mockupVariantImageStore.ts` IDB +
    `src/store/mockupVariantImageStore.ts` Zustand +
    `src/components/experience/MockupVariantImage.tsx`)** — the Mockups tab can
    now GENERATE / regenerate / retry ONE specific non-default variant
    (`Mobile · Default`, `Desktop · Empty History`, …). The **default variant
    (`id === 'default'`) still RENDERS through the legacy `MockupScreenImage`
    path** (keys `versionId:screenId:quality`, coverage stays "unknown") — in
    `MockupVariantsPanel` the `isPrimaryImageSlot` router mounts it even for an
    image-absent (`derived_missing`) default, because that component is also the
    generate/upload CTA. Its `generated` *status*, though, is now gated on real
    image presence (`defaultImagePresence` — see the Phase 3A bullet), NOT the
    spec join alone. Every OTHER variant uses a **dedicated, independent** per-variant
    IDB store keyed **`versionId:screenId:variantId:quality`** so generating one
    variant never overwrites another. `buildVariantGenerationRequest` assembles a
    variant-scoped request (viewport + state + core regions/actions/criteria/
    risks, derived only from existing screen-contract fields);
    `buildVariantImagePrompt` scopes the gpt-image-2 prompt to that exact viewport
    + state (forbids other states / a generic default; realistic mobile viewport;
    explicit empty/loading/error/permission/success guidance);
    `buildVariantCoverageManifest` captures a **generation-time coverage
    manifest** (`MockupCoverageManifest` in `src/types`) — a deterministic,
    structured self-report of what the render was ASKED to include (`estimated:
    true`), **never a visual inspection**. The manifest is stored WITH the variant
    image and threaded back into the derived model
    (`buildScreenMockupVariants`'s optional `generatedVariants` map →
    `source: 'variant'`, real `coverageStatus`), the screen cards, and the
    artifact rollup (`buildMockupVariantCoverageSummary`'s
    `generatedVariantsByScreen` → `manifestBackedGenerated`, counted separately
    from `legacyUnknownMockups`). **Honesty rules stand:** legacy mockups without
    a manifest stay "unknown"; UI copy says "Coverage manifest captured during
    generation … not a visual inspection", never "visually verified"; never show
    "covered" without structured metadata. Generation is gated on an OpenAI key
    (`hasOpenAIKey`) + `gpt_image` image mode — demo / keyless users see a
    disabled action with a clear explanation, never a silent failure. The
    per-variant store's image BYTES stay in its own dedicated IndexedDB store
    (never in `imageRefsStore` or the legacy mockup store); Phase 3D made the
    RECORDS portable through owner snapshots (see the Phase 3D bullet) but the
    variant store is still **not on the per-user `/api/projects` cross-device
    sync path** — do not entangle it with `imageRefsStore`.
  - **Phase 3C variant trust — freshness, history, default sidecar
    (`src/lib/mockupVariantTrust.ts`, pure).** A generated variant is captured
    with a **`MockupVariantSourceSignature`** — a deterministic snapshot of the
    inputs that materially affect its image: a **screen-contract hash**
    (`computeScreenContractHash`, keyed off the SAME screen-spec fields
    `buildVariantGenerationRequest` uses — viewport + state + core UI regions +
    user actions + acceptance criteria + risks; **excludes** overlay-only UI
    metadata like notes/reviewStatus/variant marks so cosmetic edits never trip a
    false stale warning) plus the **design-system tokens hash** and the
    **PRD/spine + screen-inventory + design-system version ids** at generation
    time. `buildVariantSourceSignature` (used at BOTH storage and comparison so
    they can't drift) is stored on `MockupVariantImageRecord.sourceSignature` +
    `generatedFrom`. `compareVariantFreshness(stored, current)` →
    **`current` | `possibly_stale` | `stale` | `unknown`**: contract-hash or
    design/PRD **hash** mismatch → `stale`; version-id changed but no hash to
    confirm → `possibly_stale`; **no stored signature → `unknown` (legacy /
    pre-3C records are NEVER falsely stale)**. Freshness is threaded into the
    derived model (`DerivedMockupVariant.freshness`) via a
    **`VariantTrustContext`** (current versions/hash) passed from
    `ArtifactWorkspace` → Screen views; a rollup
    (`summarizeVariantFreshness` → `MockupVariantCoverageSummary.freshness`
    `{current, review, unknown}`) feeds the coverage panel. UI: freshness badges
    + a calm explanation + a metadata-only **Source comparison** section (never a
    visual diff) in `MockupVariantsPanel`; a compact "Freshness: N to review"
    chip on screen cards.
    **Variant history:** the store's `generate` preserves the previous
    successful record as the newest **`history`** entry on regeneration (capped,
    newest-first); a **failed regeneration never appends history and never erases
    the current record**. Shown in a collapsible, local-only history section
    (view-only — no restore).
    **Default coverage sidecar:** the default variant KEEPS the legacy
    `MockupScreenImage` image path; on a NEW default (re)generation the panel
    captures a metadata-only sidecar record (`variantId: 'default'`, empty
    `dataUrl`, coverage manifest + source signature) keyed
    `versionId:screenId:default:quality` via `putSidecar` — wired through an
    optional `onGenerated` callback on the legacy image store/component (other
    callers unaffected). **Old defaults with no sidecar stay coverage-unknown; no
    fabricated coverage, and the legacy default image is never moved into the
    variant store.**
    **Storage clarity (updated by Phase 3D):** the Mockups tab and per-variant
    detail now state that generated variant images are saved on this device AND
    included in project snapshots (restorable on another device from a saved
    snapshot); they do not yet auto-sync across devices.
  - **Phase 3D — portable variant image snapshots
    (`src/lib/mockupVariantSnapshot.ts`, pure except the injected-IDB restore).**
    Generated variant images, coverage manifests, source signatures,
    `generatedFrom` provenance, and variant history now travel in owner
    **snapshots** (and therefore the demo) — closing the Phase 3C local-only
    gap. `buildMockupVariantImageSnapshot(records)` serializes the dedicated
    variant IDB store into a **schema-versioned** (`schemaVersion: 1`),
    size-guarded transport (`MockupVariantImageSnapshot`);
    `validateMockupVariantImageSnapshot` / `estimateMockupVariantSnapshotSize`
    are the pure guards. **Wire path reuses the existing per-image blob
    channel** (NO server change — `api/snapshots.js` hashes any key and persists
    `project` verbatim): `splitVariantSnapshotImages` moves image bytes out of
    the JSON envelope under `vimg:`-prefixed keys (never collide with
    mockup/screen keys) so nothing crosses Vercel's ~4.5 MB cap; the stripped
    metadata rides INSIDE `SnapshotProjectBundle.mockupVariantImages`;
    `joinVariantSnapshotImages` re-attaches bytes on load (a failed per-image
    fetch drops just that image, never the restore, and factors into the demo's
    `imagesComplete`). **Safety:** only `image/png|jpeg|webp` (never SVG);
    per-image cap 8 MB, total cap 50 MB, history cap 10 — oversized/unsafe
    records are skipped with calm warnings (surfaced in `SnapshotsPanel` after
    save). **Restore is CONSERVATIVE merge, not a clobber**
    (`restoreMockupVariantImageSnapshot` + pure `mergeVariantRecords`): per key —
    no local → restore; duplicate → keep one; snapshot newer → snapshot current,
    local folds to history; local newer → keep local, snapshot folds to history;
    inconclusive → keep local, snapshot to history + warning; an imageless
    incoming never replaces a successful local image; history dedupes by
    (image, generatedAt) and is capped. A malformed variant section is skipped
    without ever breaking the surrounding project restore. Restore updates the
    reactive cache via the new `useMockupVariantImageStore.mergeRecords`.
    **Non-default variants require a real safe image to restore** (they render
    an `<img>`); only the `variantId === 'default'` **sidecar** is metadata-only
    (no image — the legacy default image path is untouched, old defaults without
    a sidecar stay coverage-unknown). Demo restore under `DEMO_PROJECT_ID`
    namespaces variant records via `namespaceVariantSnapshot` (remap versionId +
    rebuild the composite key + `generatedFrom`, idempotent), invoked from
    `namespaceSnapshotForRestore`. Still **not** on the `/api/projects`
    cross-device sync path — that remains the documented next step.
  `parseDecisionBranches` (arrow-form +
  if/otherwise) powers both the branch-aware Flow-tab rendering
  (`DecisionBranches`) and the `decision_missing_branches` gap — an
  unparseable decision renders the raw text with an honest "branch outcomes
  not specified" nudge, never an invented branch.
- **Screen metadata edits are an overlay, never a content rewrite.** User
  edits (name / purpose / userIntent / priority / notes / **reviewStatus** —
  the readiness override above — / **mockupVariantStatus** — the per-variant
  override above) are stored per
  canonical screen id in the screen_inventory **ArtifactVersion's
  `metadata.screenEdits`** (`ScreenMetadataEdit` / `readScreenEdits` in
  `screenExperience.ts`, persisted via the existing
  `updateArtifactVersionMetadata` — the prompt_pack `promptEdits` pattern).
  **`readScreenEdits` preserves unknown overlay keys verbatim and every
  writer must merge from the existing edit** (the edit form spreads
  `item.edit` before setting its own fields; the variants card merges
  `mockupVariantStatus`) so a read-modify-write never drops fields written by
  newer code.
  `buildScreenIndex` applies the overlay to produce the *effective*
  `item.screen` while keeping `item.baseScreen` (stored content) as the source
  of every join and image key — so **renames cannot orphan mockups, flow refs,
  or uploaded images**. `ScreenImageGallery`/`ScreenCard` take a
  `storageName`/`imageStorageName` (the base generated name) so upload buckets
  keep their original slug after a display rename. An overlay equal to the
  generated content clears itself (saved as null); "Reset to generated"
  removes it. Edits are per-version — regenerating the inventory starts clean,
  same as promptEdits. Do NOT rewrite `ArtifactVersion.content` for edits.
- **Screen selection is URL-addressable:** `/p/:projectId?screen=<canonical
  id>[&screenTab=flow|mockups]`. The query param is the **single source of
  truth** for the open Screen Detail (via `useSearchParams`); the rendered
  view is *derived* (`activeSelection = screen param ? 'screens' : selected`)
  — never synced by a setState-in-effect. Deep links, refresh, and browser
  back/forward all work; tab switches use `replace` so history is one entry
  per screen; unknown/stale ids miss `byId` and fall back to the list;
  unrelated query params (debug flags) are preserved. `ProjectWorkspace` has a
  one-shot mount effect that switches a deep-linked project to the `workspace`
  stage when the spine is final (otherwise the param is inert). Artifact-row
  selection (`selected`) stays local component state — only the screen
  dimension lives in the URL. Screen journey nodes in **User Flows** navigate
  to Screen Detail when the node is a `screen` kind AND its slug is in
  `availableScreenSlugs` (threaded through `ArtifactContentRenderer` →
  `UserFlowsRenderer` → `FlowJourney.onNavigateToScreen`); otherwise the
  original scroll-to-step behavior is preserved.
- **Mockup coverage is explicit and overlay-based.** The Screens list shows
  "Mockups: X of N screens covered". Uncovered screens get an **Add to
  mockups** action (Mockups tab) and the list header offers a confirmed
  **Generate missing mockups** batch. Both write user-added `MockupScreen`s
  into the *current* mockup ArtifactVersion's **`metadata.extraScreens`**
  overlay (`readExtraMockupScreens`/`mergeExtraScreens`/
  `mockupScreenFromInventoryScreen` in `mockupParsing.ts`) — **never a new
  ArtifactVersion**, because per-screen images are keyed by
  `versionId:screenId:quality`, so appending a version would orphan every
  existing render. Adding coverage is free; **image generation is never
  automatic** — it's the standard per-screen action, or the batch flow which
  fires low-quality drafts only after an explicit cost-labeled confirm and
  only when an OpenAI key exists (keyless → upload sheets). Every consumer of
  a mockup payload in the workspace must read the *effective* payload
  (`mergeExtraScreens(tryParsePayload(v), v.metadata)`).
- **Reference validation is advisory, never blocking.** `buildScreenIndex`
  emits `index.issues` (`ScreenReferenceIssue`): `unmatched_flow_step`
  (screen-kind journey steps matching no screen, grouped per name),
  `unmatched_mockup_screen`, `slug_collision`, and `legacy_name_match`
  (mockup matched by name only — works, but rename-fragile). The Screens list
  renders them in the collapsed `ReferenceWarningsPanel`
  (`src/components/experience/ReferenceWarningsPanel.tsx`) with two persisted
  repairs: **Relink/Pin** writes `metadata.screenLinks`
  (mockupScreenId → canonical screenId) on the **mockup** version — the
  highest-priority mockup match, above `sourceScreenId` and name — and
  **Ignore** appends the issue key to `metadata.dismissedScreenIssues` on the
  **inventory** version. Matching runs in three passes (links →
  sourceScreenId → name) so an explicit repair always beats a coincidental
  name match. Rendering must never be gated on validation results.
- **Status/fallbacks:** the Screens sidebar dot and generation/error states map
  to the **`screen_inventory` slot** (its retry re-runs that slot, since it no
  longer has its own row); the Mockups tab surfaces the `mockup` slot's
  generating/error states. **But the Screens row is fed by TWO slots** —
  `screen_inventory` (the screen "breakdown") and `mockup` — which settle at
  different times (the breakdown almost always lands well before the mockups).
  So the row's dot is **not** a plain `StatusDot` of `screen_inventory`: it uses
  `ScreensStatusDot(inventory, mockup)` (exported from `ArtifactWorkspace.tsx`,
  unit-tested), which shows the breakdown's raw status until the breakdown is
  `done`, then — while mockups are still `generating`/`queued` (or `error`/
  `interrupted`) — pairs the breakdown's green check with the mockups' live
  spinner/warning (plus a "Breakdown ready · mockups generating…" sub-label on
  the row and a matching tooltip) instead of a flat "done". Once mockups finish
  (or were never requested → `idle`) the check stands alone. Used in both the
  sidebar row and the mobile header. Do **not** revert the Screens dot to a bare
  `screen_inventory` `StatusDot` — that misled users into thinking mockups were
  ready when only the breakdown was. A screen_inventory version whose content isn't
  parseable structured JSON (legacy markdown) falls back to the standalone
  `ScreenInventoryRenderer` path inside the Screens view. The legacy
  `screen_inventory` and `mockup` renderMain branches remain intact and
  internally reachable — do not delete them.

