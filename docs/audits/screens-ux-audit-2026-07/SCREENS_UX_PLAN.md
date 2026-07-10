# Screens Artifact — Phased UX Implementation Plan (July 2026)

Derived from [`SCREENS_UX_AUDIT.md`](./SCREENS_UX_AUDIT.md) (screenshot-indexed
findings; issue ids C1/H1–H5/M1–M9/L1–L6 referenced below). **No changes are
implemented yet** — this plan awaits approval.

Guiding constraints (from the audit brief and the codebase's own rules):

- Prefer **removing, merging, or demoting** UI over adding panels/controls.
- Preserve generation, artifact-linking, versioning, snapshot, and overlay
  capabilities untouched — every change below is presentation/read-side, in
  keeping with the Screens view being a read-side layer over
  `screen_inventory`/`user_flows`/`mockup`.
- Keep traceability/implementation metadata **available but secondary**; keep
  Screens about screens, flows, mockups, and review — not a second
  Implementation Plan.
- Honesty rules stand: derived data stays labeled derived; nothing fabricated;
  advisory layers never gate rendering or generation.

---

## Phase 1 — Correct usability, trust, and rendering failures

### 1.1 Reconcile the contradictory project-readiness verdicts (C1)

- **Problem observed:** "0 of 6 screens pass the derived readiness checks / READY
  FOR DEVELOPMENT 0%" renders directly above green "Ready for implementation
  planning" (twice) and amber "0 ready · 6 review recommended" — three verdicts
  about the same six accepted screens.
- **Where:** S-12 desktop segs 1–3 (`ScreenCoveragePanel`, `ScreenPreflightPanel`).
- **Intended outcome:** one unambiguous answer to "is this artifact ready?", with
  every remaining number consistent with it.
- **Proposed change:** make the Phase-4A review gate
  (`buildScreenArtifactReviewReadiness`) the **single headline verdict** of the
  metadata section. The "Ready for Development" progress bar and the "0 of 6
  pass" headline stop counting the `implementation_ready` user status (which is
  no longer settable from Screens — S-12's 0% exists *because* the UI counts a
  status the UI removed). Count sign-off (accepted+) instead; keep the per-metric
  rows (they were already green and correct). Downstream/handoff rollups stop
  rendering their own verdict banners inside Screens (see 2.2) so only one
  verdict remains.
- **Components/routes:** `src/components/experience/ScreenCoveragePanel.tsx`;
  message-building in `src/lib/screenReadiness.ts` (`buildScreenCoverageSummary`
  `readyCount`/`buildMessage`) and/or presentation-only remapping in the panel.
- **Mobile implications:** shrinks a 4,357 px section; no layout change.
- **Data/state implications:** none persisted — all derived at read time. The
  pure `deriveScreenReadiness` statuses are unchanged; only what the *panel*
  counts as "ready" changes.
- **Regression risk:** medium — `screenReadiness` tests assert current
  counts/messages; `readyWithWarnings` gating must keep excluding overrides from
  the all-clear. Update unit tests deliberately, not incidentally.
- **Validation:** unit tests for the new rollup sentence; re-capture S-12 on the
  demo — expect one verdict, no 0%-vs-green contradiction.

### 1.2 Fix raw markdown / raw-id leakage in flow surfaces (M1)

- **Problem observed:** literal `**Related Features:**` with visible asterisks
  and `[f1]`-style ids in the Flow tab description; bracket-arrow branch
  notation "[condition] → [outcome]" in step cards.
- **Where:** S-30f (desktop+mobile), S-34f, S-20 seg2.
- **Intended outcome:** flow descriptions read as prose; features appear as
  names; branches read as "If … → then …" rows.
- **Proposed change:** route the flow-description string through the same
  chip/markdown renderer the User Flows GOAL block uses (or strip the
  `**…**`/`[fN]` syntax and resolve ids to feature names via the PRD `features`
  list before display). Present `parseDecisionBranches` output with its existing
  styled component in step cards instead of raw text.
- **Components:** `ScreenDetailView` flow-tab header; `UserFlowsRenderer` step
  cards / `DecisionBranches`; shared feature-name resolution already exists in
  the join/readiness layers.
- **Mobile implications:** same fix applies; none additional.
- **Data/state implications:** none.
- **Regression risk:** low — display-only; snapshot tests on renderers may need
  updating.
- **Validation:** re-capture S-30f/S-20; assert no `**` or `[f` appears in
  rendered flow text (component test).

### 1.3 Fix duplicated feature names in flow GOAL blocks (M2)

- **Problem observed:** desktop renders each related feature twice — chip
  ("F1 Image and Prompt Ingestion") + the same name as plain text; mobile
  renders it once (chip "F1" + name).
- **Where:** S-20 seg0 desktop vs. S-20 mobile seg0/1.
- **Intended outcome:** each feature appears once, identically on both viewports.
- **Proposed change:** in the goal-text feature-chip renderer, drop the
  duplicated plain-text name when the chip already carries it (align desktop to
  the mobile behavior, or chips show `F1` + one name).
- **Components:** `UserFlowsRenderer` (goal/related-features chip rendering).
- **Mobile implications:** none (already correct).
- **Data/state implications:** none. **Regression risk:** low.
- **Validation:** re-capture S-20 desktop; component test on the chip renderer.

### 1.4 Remove the stale "Ready to accept" suggestion on accepted screens (H4, part 1)

- **Problem observed:** card details show "REVIEW Accepted · Ready to accept" —
  a system suggestion that is meaningless once the user has accepted.
- **Where:** S-11 desktop/mobile.
- **Intended outcome:** one plain-language review line: "Accepted" /
  "Needs review — 2 items" / "Draft".
- **Proposed change:** render the system-readiness hint only when it *disagrees
  actionably* with the user status (e.g. user-Draft + system-ready → "Ready to
  confirm"); suppress it when user status ≥ the suggestion. Pure presentation in
  the card-details REVIEW row; `ScreenReviewModel` unchanged.
- **Components:** `ScreenListView` `CardDetails`.
- **Mobile implications:** shorter row. **Data/state:** none.
- **Regression risk:** low. **Validation:** re-capture S-11; RTL test for the
  three status combinations.

### 1.5 Mobile text-wrap fixes (L2, L6 partial)

- **Problem observed:** "Review notes / 4 items may benefit from review" wraps
  into centered two-line jumble; SPEC COVERAGE status labels wrap mid-phrase
  ("In mockup / spec").
- **Where:** S-30 mobile seg1, S-30m mobile seg1.
- **Intended outcome:** left-aligned single-purpose header; non-wrapping status
  labels.
- **Proposed change:** flex layout (title left, count as sub-line) for the
  Review-notes header; `whitespace-nowrap`/shorter label ("In spec") for spec
  coverage statuses on narrow widths.
- **Components:** `ScreenReviewNotes` header; `MockupVariantsPanel` spec-coverage
  rows.
- **Data/state:** none. **Regression risk:** minimal.
- **Validation:** re-capture S-30/S-30m mobile.

---

## Phase 2 — Simplify hierarchy and the review flow

### 2.1 Prune the card "Show details" panel to design-review content (H2 partial, H4 part 2, M3, M9-adjacent)

- **Problem observed:** eight labeled rows per card (REVIEW / TRACEABILITY /
  HANDOFF / MOCKUPS / STATES / RISKS / METADATA / ACTIONS) re-import the
  pre-rework dashboard; amber "HANDOFF Needs review" on accepted screens; raw
  feature ids; artifact-wide actions repeated per card.
- **Where:** S-11 desktop/mobile.
- **Intended outcome:** details answer "anything I should look at before opening
  this screen?" in ≤4 rows, without implementation verdicts.
- **Proposed change:**
  - Keep: CONNECTED TO; a single review line (per 1.4); RISKS ("2 to review →
    opens Review notes"); a one-line provenance ("From PRD Version 1").
  - Change: TRACEABILITY shows feature *names* ("Covers: Image & Prompt
    Ingestion, …"); MOCKUPS reads "Primary ready · 2 optional states available".
  - Remove from cards: the HANDOFF row (its data stays reachable via the
    Implementation Plan / metadata section, per 2.2) and the per-card ACTIONS
    row — Version history / Mockup history / Regenerate mockup move to a single
    artifact-controls row rendered once (inside "Project readiness & metadata"
    or a small toolbar next to the filters), restoring honest artifact-wide
    scope.
- **Components:** `ScreenListView` (`CardDetails`, `ScreenArtifactControls`
  placement); no change to the underlying handlers.
- **Mobile implications:** expanded cards drop from ~900 px to ~400 px; removes
  the triple-stacked buttons per card.
- **Data/state implications:** none — `artifactControls` prop already carries the
  one shared handler set.
- **Regression risk:** medium-low — ensure the relocated controls remain
  reachable on mobile (the old global toolbar was removed for clutter; one
  compact row in the metadata section avoids regressing that decision).
- **Validation:** re-capture S-11; RTL tests that version-history/regenerate
  remain invocable from the list view.

### 2.2 Move implementation verdicts out of Screens; keep one advisory pointer (H2)

- **Problem observed:** Implementation Handoff rollup ("0 ready · 6 review
  recommended", amber banner), Implementation preflight panel, and the handoff
  export panel — three implementation surfaces inside Screens, restating each
  other and contradicting the review gate.
- **Where:** S-12 segs 2–3.
- **Intended outcome:** Screens carries design-review state; implementation
  readiness lives with the Implementation Plan (which already owns readiness/
  coverage surfaces); the handoff export remains reachable without shouting.
- **Proposed change:** in the Screens metadata section, collapse the handoff
  rollup + preflight into a single quiet row: "Implementation handoff: 6 screens
  ready to package · view in Implementation Plan" (neutral tone; amber only for
  genuine blockers per the existing severity model). Surface
  `buildScreensHandoffRollup`/`ScreenPreflightPanel` content inside the
  Implementation Plan renderer (the audit's misplaced-content finding matches
  the codebase's own deferred TODO to surface handoff there). The export panel
  (`ScreensHandoffExportPanel`) moves with it or stays as the last collapsed row
  — but stops rendering its own verdict banner.
- **Components:** `ScreenListView` metadata section; `ScreenCoveragePanel`
  (handoff/downstream sections); `renderers/implementationPlan/ConsolidatedPlanView`
  (new consumer of already-derived rollups); all pure libs
  (`screenImplementationHandoff`, `screenDownstreamImpact`, `screenHandoffExport`)
  unchanged.
- **Mobile implications:** metadata section shrinks substantially.
- **Data/state implications:** none persisted; derived models are already pure
  and caller-supplied, so re-homing the surface is a wiring change. Respect the
  no-import-cycle rules (caller passes contributions in).
- **Regression risk:** medium — the Implementation Plan renderer gains content;
  keep it behind a collapsed section there too. Preserve "advisory, never
  gating".
- **Validation:** re-capture S-12 + an Implementation Plan capture; existing pure
  lib tests untouched.

### 2.3 Reframe optional variants everywhere as on-demand options (H1, M5 partial)

- **Problem observed:** "1 of 3 recommended variants generated · 2 missing",
  amber **Missing** pills, "1 / 3 recommended" in card details, "Additional
  state mockups available" as a review note — while the coverage panel calls the
  same things "OPTIONAL … available on demand".
- **Where:** S-30m, S-11, S-31, S-12 seg1.
- **Intended outcome:** one vocabulary: a screen has **a primary mockup**
  (required for P0; its absence is the only warning-worthy state) and **optional
  state/viewport mockups** that can be generated on demand. Nothing optional
  renders in amber or as "missing".
- **Proposed change:** Mockups tab header becomes "Primary mockup" +
  an "Optional states" group ("Empty Library · not generated — generate on
  demand" with a neutral outline card and, when a key exists, the generate
  action; keyless keeps the explanatory disabled state). Replace "Missing"
  pills with "Available"; drop "recommended N" counters from card details
  (2.1 already rewrites that row); Review notes stop listing variant
  availability (it belongs to the Mockups tab — M7 partial).
- **Components:** `MockupVariantsPanel`, `ScreenListView` `CardDetails`,
  `ScreenReviewNotes` (filter out `mockup_state_variants_missing` /
  `mockup_mobile_missing` info items), copy only — `mockupVariants.ts` derivation
  and `OPTIONAL_ENHANCEMENT_GAPS` scoring rules unchanged (they already exclude
  variants from readiness; this aligns the copy with that rule).
- **Mobile implications:** fewer pills per card; no layout change.
- **Data/state implications:** none.
- **Regression risk:** low-medium — keep the `missing_state_variants` gap
  discoverable in the detail view (as the neutral "Optional states" group), per
  the honesty rules.
- **Validation:** re-capture S-30m/S-11/S-31; copy-level RTL assertions
  (no "missing"/amber for optional variants).

### 2.4 One acceptance concept per screen (M5)

- **Problem observed:** per-variant "Mark accepted" sits beside the screen-level
  Confirm, an unexplained second acceptance model.
- **Where:** S-30m seg1.
- **Intended outcome:** Confirm screen is the only acceptance; per-variant state
  is informational ("Generated / Not generated / Superseded").
- **Proposed change:** demote "Mark accepted" out of the variant detail header —
  either remove the control (preferred; the overlay key survives for legacy
  data) or tuck it into the variant's overflow as "Mark reviewed". No new
  status; `mockupVariantStatus` overlay values remain readable.
- **Components:** `MockupVariantsPanel` detail header.
- **Data/state implications:** overlay writes stop being offered; existing
  persisted values still render. **Regression risk:** low.
- **Validation:** re-capture S-30m; check a legacy-marked variant still displays
  its state.

### 2.5 Neutral, honest acceptance-criteria presentation (M4)

- **Problem observed:** derived criteria all render with green pass-check
  circles the user never verified; some items are implementation-grade.
- **Where:** S-30 seg1, S-34 seg1.
- **Intended outcome:** criteria read as a review checklist, not as passed tests.
- **Proposed change:** neutral bullets/unchecked-circle icons + retitle
  "Acceptance criteria" (from "Acceptance checklist"); keep the "Show generated
  details" disclosure. (Optional later: make them user-checkable and feed the
  existing review checklist meta — *not* in this pass; it adds state.)
- **Components:** `ScreenOverviewPanel` criteria block.
- **Data/state:** none. **Regression risk:** minimal.
- **Validation:** re-capture S-30/S-34.

### 2.6 Review-notes banner counts only actionable items (M7)

- **Problem observed:** "4 items may benefit from review" = 2 real risks + 2
  info nags, inflating review pressure on a confirmed screen.
- **Where:** S-30, S-31.
- **Intended outcome:** banner reflects decisions awaiting the user:
  "2 risks to resolve"; zero-state stays quiet.
- **Proposed change:** count only risk/review-severity items in the collapsed
  banner (info items visible once expanded, or relocated per 2.3); wording
  "N risks to resolve" / "N items to review".
- **Components:** `ScreenReviewNotes`. **Data/state:** none.
- **Regression risk:** low. **Validation:** re-capture S-30.

---

## Phase 3 — Screens, Flows, and Mockups as one connected experience

### 3.1 De-duplicate the Flow tab (H5, part 1)

- **Problem observed:** appears-in digest + full journey + full step-by-step
  cards for the whole flow = 4.3–5.3k px for one screen; the step cards are a
  verbatim copy of the User Flows artifact.
- **Where:** S-30f desktop/mobile.
- **Intended outcome:** the Flow tab answers "where does this screen sit in its
  flows?" in one viewport-ish height, and hands off to User Flows for the full
  document.
- **Proposed change:** keep "THIS SCREEN APPEARS IN" + the highlighted Flow
  Journey (grouped rows). Remove the embedded step-by-step card list; journey
  sub-rows expand in place (or link) for step detail, plus one "Open this flow
  in User Flows →" link. Multiple flows render as journey blocks, not full
  documents.
- **Components:** `ScreenDetailView` flow tab (composition of
  `FlowJourney`/`StepCard`); `FlowJourney` already supports highlighting.
- **Mobile implications:** biggest single mobile win (~5,250 px → ~1,800 px).
- **Data/state:** none. **Regression risk:** medium-low — step-level anchors from
  journey rows must still resolve (in-place expansion preserves them).
- **Validation:** re-capture S-30f both viewports; navigation test journey row →
  step detail.

### 3.2 Single rendering of steps on the User Flows page (H5, part 2)

- **Problem observed:** the artifact page renders the journey *and* a
  "STEP-BY-STEP FLOW" section repeating all steps as full cards.
- **Where:** S-20 segs 1–3.
- **Intended outcome:** the journey is the flow's one spine; step detail is its
  expansion.
- **Proposed change:** fold step-card content (USER/SYSTEM lines, branches) into
  expandable journey rows — the journey already shows USER lines; expansion adds
  SYSTEM + branches. Remove the standalone duplicate section. Branch rendering
  per 1.2.
- **Components:** `UserFlowsRenderer`, `FlowJourney`/`StepCard`.
- **Mobile implications:** halves a 4,313 px page.
- **Data/state:** none (parsed `user_flows` markdown unchanged).
- **Regression risk:** medium — flow-node → step scroll targets and the
  screen-detail highlighting reuse these components; keep ids stable.
- **Validation:** re-capture S-20; test flow-node navigation still lands.

### 3.3 Make the flow switcher legible navigation (L4)

- **Problem observed:** flows 2–4 hide behind an unlabeled dot rail with status
  dots; the page appears to contain one flow.
- **Where:** S-20 seg0.
- **Intended outcome:** users see there are four flows and switch by name.
- **Proposed change:** replace/augment the dot rail with named items (numbered
  title list on desktop; the existing "CORE EXPERIENCE · 1 OF 4" card on mobile
  becomes a select). Reuse the Artifact Outline pattern
  (`ArtifactOutlineNav`/`useArtifactOutline`) rather than a new nav style, per
  the codebase rule.
- **Components:** `UserFlowsRenderer` rail.
- **Mobile implications:** replaces the hamburger-ish flow card with a standard
  control. **Data/state:** none. **Regression risk:** low.
- **Validation:** re-capture S-20 both viewports.

### 3.4 One mockup frame, one action set (cross-view consistency)

- **Problem observed:** the Overview's PRIMARY MOCKUP and the Mockups tab's
  Default variant render the same image with different frames/actions; an
  orphaned bottom card holds "Copy image prompt / Upload image" (M8).
- **Where:** S-30 seg0/seg2 vs. S-30m seg1.
- **Intended outcome:** the mockup card looks and acts the same in both places;
  no orphan actions.
- **Proposed change:** extract one presentational mockup-card frame (image +
  provenance line + Regenerate; overflow holds Copy image prompt / Upload
  image). Overview uses it under "PRIMARY MOCKUP"; the Mockups tab uses it for
  the Default variant. Delete the orphan card; anchor "Reset to generated /
  Edit details" into the Purpose card header (M8 part 2).
- **Components:** `ScreenOverviewPanel`, `MockupVariantsPanel`,
  `MockupScreenImage` wrapper (its generate/upload internals untouched).
- **Data/state:** none. **Regression risk:** medium-low — the upload path must
  keep writing to the same image keys (`storageName` threading unchanged).
- **Validation:** re-capture S-30/S-30m; upload + regenerate smoke test in a
  keyed project.

### 3.5 Desktop list density (M9, L1, L3)

- **Problem observed:** single-card flow groups leave an empty right column;
  EDITED chips on every card; two positive-signal styles per footer row.
- **Where:** S-10 desktop segs 0–1.
- **Intended outcome:** the six screens read as one connected set with minimal
  chrome.
- **Proposed change:** lone-card groups span full width (or the list goes
  single-column at `lg` with the connection strip given the saved room); EDITED
  moves into "Show details" (METADATA row); footer merges to one muted line
  ("Accepted · Mockup ready").
- **Components:** `ScreenListView` grid + `ScreenCard` footer.
- **Mobile implications:** none (already single column).
- **Regression risk:** low. **Validation:** re-capture S-10 desktop.

---

## Phase 4 — Terminology and visual consistency

### 4.1 Retire "freshness"/"sync-unknown" jargon for plain provenance language (H3)

- **Problem observed:** "PRD sync unknown" ×3 on one tab, "Mockup freshness
  unknown", "no freshness metadata", "may be out of date or unverified" ×4.
- **Where:** S-30m, S-31, S-12 segs 2–3.
- **Intended outcome:** sync state reads as provenance, in one place, once:
  known-current → "Matches PRD Version 1"; known-stale → "Generated from PRD
  Version 1 — PRD has changed since"; unknown/legacy → "Generated before Synapse
  tracked PRD versions — regenerate to link it". Never the word "freshness";
  "legacy" only in developer docs.
- **Proposed change:** copy-level replacement in `PRD_SYNC_LABELS`
  (`MockupVariantsPanel`), review-note issue copy, preflight sentences
  (deduplicated: one sentence listing screens, not one sentence per screen —
  fixes the ×4 repetition), and the coverage rollup. The pure
  `mockupVariantTrust` `FRESHNESS_LABELS` constant stays (non-UI consumers), per
  the existing pattern of mapping at the UI edge.
- **Components:** `MockupVariantsPanel`, `ScreenReviewNotes`,
  `ScreenPreflightPanel`, `ScreenCoveragePanel`.
- **Data/state:** none. **Regression risk:** low — copy + a dedupe.
- **Validation:** re-capture S-30m/S-12; grep the rendered demo pages for
  "freshness"/"sync unknown" (expect zero).

### 4.2 One review vocabulary (H4 completion)

- **Problem observed:** Accepted / Ready to accept / ready to build / Ready for
  implementation planning / Handoff ready coexist.
- **Where:** S-11, S-12 seg2.
- **Intended outcome:** two words users ever see in Screens: **Needs review** and
  **Confirmed** (plus Draft where user-set). Implementation-planning language
  appears only in the Implementation Plan (per 2.2).
- **Proposed change:** map `reviewStatus`/`systemReadiness` to that vocabulary at
  every Screens surface (badges, filters, coverage counts). The Status filter
  options become Draft / Needs review / Confirmed. Underlying statuses
  (`accepted`, `implementation_ready`) are untouched — legacy values keep
  rendering as Confirmed.
- **Components:** `ReadinessBadge`, `ScreenListView` filter labels,
  `ScreenCoveragePanel` copy, `ScreenConfirmPanel` (already correct).
- **Data/state:** none. **Regression risk:** low-medium — filter ids stay stable,
  labels only.
- **Validation:** re-capture S-10/S-11/S-12; filter behavior test.

### 4.3 Reserve amber/red for genuine risk (visual consistency)

- **Problem observed:** amber used for optional variants ("Missing"), handoff
  rollups, legacy-mockup info, flow "Medium risk" pill — alongside genuine risks;
  warnings feel disproportionate (S-11, S-12, S-20, S-30m).
- **Intended outcome:** color communicates severity consistently: amber = a
  decision the user should make (unresolved risk, stale P0); neutral = info and
  optional; red = blocking only.
- **Proposed change:** audit-driven color pass over the surfaces already being
  edited in Phases 2–3 (no new components): optional/unknown → neutral gray,
  info tone for legacy provenance, amber kept for unresolved risks and genuine
  stale/blocked states. Risk severity labels gain consequence framing ("Medium
  severity — may confuse users during processing") where the generated
  `riskDetails` provide it.
- **Components:** the pill/badge classes in the components touched above.
- **Regression risk:** low. **Validation:** side-by-side re-captures; a
  color-usage checklist in the PR description.

### 4.4 Micro-polish batch (L5, L6, M6)

- Storage/snapshot note in Mockups tab → info tooltip/disclosure
  (`MockupVariantsPanel`).
- Suggested risk handling renders as real pre-filled text with "Use suggestion",
  not gray placeholder (`ScreenReviewNotes`).
- Mobile workspace header: reclaim height (collapse the demo banner after first
  view or shorten copy; show more of the project title).
- Each is copy/CSS-level; validate by re-capturing S-30m/S-31/S-10 mobile.

---

## Sequencing, risk posture, validation harness

- **Order:** Phase 1 is shippable independently and removes the trust failures;
  Phase 2 before Phase 3 (pruning defines what the connected experience must
  carry); Phase 4 rides along with whatever surfaces each earlier phase touches.
- **Everything is read-side.** No schema, prompt, pipeline, snapshot, or sync
  changes anywhere in this plan; pure derivation libs change only where a rollup
  *sentence* is produced (1.1). Overlay fields are never dropped — only writers/
  presentation move.
- **Validation harness:** the capture script used for this audit (viewport
  expansion + segments) should be checked in as `scripts/capture-screens-audit.mjs`
  alongside `capture-demo-screenshots.mjs`, so every phase re-runs the same
  captures against a preview deployment and diffs against this audit's baseline.
  Unit/RTL tests per item above; `npm run build` + `npm run lint` gate as always.
- **Out of scope (deliberately):** new flow *diagram* visualizations (the list
  journey works; the dot-rail fix and de-duplication are cheaper and address the
  observed problems), per-variant generation UX changes beyond copy, any change
  to the review data model, and any Screens-specific export/finalize flow.
