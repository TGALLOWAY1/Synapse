# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Synapse — "From plain-language to product blueprint" — is an AI-native product
definition environment that transforms a plain-language prompt into a
structured PRD, then into UI mockups, downstream artifacts (screen inventory,
data model, etc.), and visual annotations. The product workspace is a fully
client-side React SPA — all PRD/branch/artifact state persists in
localStorage via Zustand. A separate Vercel-hosted backend (under `api/`)
powers a recruiter-portal sub-product with OAuth, MongoDB, and snapshot
storage; do not confuse it with the PRD workspace.

## Documentation rule

**Keep this file in sync with the code in the same change.** Whenever you
add, remove, or meaningfully alter architecture, data flow, state slices,
the LLM pipeline, domain types, or a cross-cutting pattern (e.g. the PRD
selection pipeline), update the relevant section of CLAUDE.md as part of
the same commit — do not leave it for a follow-up. If a change makes an
existing description wrong, fix the description; if it introduces a
pattern others must follow or must not break, document it here as a rule.
Treat docs drift as a defect in the change itself.

### README rule

`README.md` is the **public-facing** description of Synapse and must not drift
from reality. Whenever a change adds, removes, or meaningfully alters a
**user-visible feature, capability, or workflow** — a new pipeline stage, a new
artifact or asset type, a behavior shown in the interactive tour
(`src/components/tour/`), a change to supported models/providers, the safety
gate, preflight clarification, snapshots, or the getting-started flow — review
`README.md` in the same change and update it:

- Keep the feature tour aligned with the live product tour's six-beat narrative
  (Idea → Spec generation → Refine → Versions → Assets → Connections) so the
  README and `/tour` tell the same story.
- Keep referenced screenshots in `public/screenshots/` and the screenshots a
  feature describes consistent with the current UI; if a screenshot no longer
  matches, flag it rather than leaving a misleading image.
- Keep the tech-stack list (models, providers, libraries) accurate — e.g. the
  default Gemini model id and any image model.

If a change touches a user-visible feature but you are unsure whether the
README needs an edit, **surface it to the user** ("this looks like a
README-worthy change — want me to update it?") rather than silently letting the
README go stale. Significant new features should never ship without a
corresponding README update or an explicit decision to skip it.

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Vite dev server at http://localhost:5173
npm run build        # tsc -b && vite build (TS check is part of build)
npm run lint         # ESLint flat config, TS/TSX only
npm run preview      # Preview production build
npm test             # vitest run (one-shot)
npx vitest <file>    # Run a single test file in watch mode
npx tsc --noEmit     # Type-check without emitting
```

Tests live in `src/lib/__tests__/` and `api/_lib/__tests__/`. There is no
Playwright suite despite the dev dependency.

## Tech Stack

- React 19 + TypeScript + Vite 7
- Tailwind CSS 3 + tailwind-merge + clsx
- framer-motion (page/drag transitions in the interactive product tour)
- Zustand 5 with `persist` middleware (debounced localStorage)
- Google Gemini API called directly from the browser; key in localStorage
- React Router v7 (workspace, recruiter portal, admin pages, the interactive
  product tour at `/tour` + `/about` alias, /privacy)
- Deployed to Vercel (SPA + Node serverless functions under `api/`)

## Architecture

### Two parallel sub-products

This repo holds **two separate products** that share the Vite build but
otherwise have nothing in common — keep that distinction in mind:

1. **PRD workspace** (the "real" Synapse product) — `src/components/HomePage.tsx`
   and `src/components/ProjectWorkspace.tsx` mounted at `/` and
   `/p/:projectId`. State is 100% client-side localStorage. Calls Gemini
   directly. Never touches the `api/` backend.

2. **Recruiter portal** — `src/components/LoginPage.tsx`,
   `src/components/RecruiterAdminPage.tsx`, mounted at `/admin/recruiters`
   plus the `/api/auth/*`, `/api/session`, `/api/activity`,
   `/api/snapshots`, `/api/admin/recruiters` endpoints. Server-side state
   in MongoDB; OAuth via Google/GitHub/LinkedIn; auth glue lives in
   `src/lib/recruiterApi.ts` and `src/lib/snapshotClient.ts`. Backend
   handlers are in `api/` (Node serverless), with shared helpers in
   `api/_lib/`.

### LLM layer (`src/lib/`)

- **`geminiClient.ts`** — low-level Gemini transport. Two modes:
  `callGemini()` (sync JSON) and `callGeminiStream()` (SSE). Both wrap fetch
  in `fetchWithRetry` for connection-level transient errors;
  `callGeminiStream` *also* wraps the entire fetch+reader in a stream-level
  retry, so a mid-stream mobile-network drop reconnects from byte zero.
  Stream callers should implement `StreamCallbacks.onRestart` to reset any
  chunk-derived state (char counters, phase trackers) when the stream is
  re-attempted. `isRetryableNetworkError` is exported for callers that
  need to reason about retry policy.

- **`services/`** — one file per AI feature. Importing through the
  `llmProvider.ts` barrel keeps legacy call sites stable.
  - `prdService.ts` + `prdPipeline.ts` — PRD generation. Pipeline is now
    **single-pass**: Pass A streams a structured PRD (Gemini JSON mode with
    `prdSchemas.structuredPRDSchema`) with the quality rubric baked into
    the system prompt; markdown is rendered deterministically from the
    JSON via `prdMarkdownRenderer.ts`. The legacy multi-pass scoring +
    revision passes were removed — old projects in localStorage retain
    their saved `qualityScores`, but no new generation writes them.
  - `mockupService.ts` + `mockupImageService.ts` — mockup HTML and image
    generation.
  - `coreArtifactService.ts` — the 7 core artifact types
    (screen_inventory, data_model, component_inventory, user_flows,
    implementation_plan, prompt_pack, design_system). Three of these
    (screen/data/component inventory) use Gemini JSON mode with schemas in
    `schemas/artifactSchemas.ts`, then convert to markdown via
    `structuredArtifactToMarkdown()` for storage; renderers in
    `src/components/renderers/` parse that markdown back to card layouts.
    The `component_inventory` renderer is a mobile-first, searchable
    component library (sticky search + category/complexity/used-in
    filters, expandable cards with live previews) decomposed under
    `src/components/renderers/componentInventory/`. Its schema/types carry
    optional `accessibility`, `previewType`, and per-prop `required`
    fields (all backward-compatible — older saved inventories lack them);
    when absent, `inferPreview.ts` derives a `previewType` and a
    heuristic, review-flagged accessibility contract at render time so
    every card still shows a preview and a dedicated a11y block.
    `componentInventoryParse.ts` round-trips all these fields through
    markdown.
  - `branchService.ts` — branch consolidation back into the spine.
  - `preflightService.ts` — optional pre-PRD clarification (see "Preflight
    clarification" below). `generatePreflightQuestions()` (safety-gated) and
    `generatePreflightSummary()`; both inject transports for tests and degrade
    to fallbacks (generic question set / local recap) on non-safety failure.
  - `artifactJobController.ts` — concurrency control for artifact bundle
    generation.
- **`prompts/prdPrompts.ts`** — strategy system instruction; the
  `RUBRIC_DEFINITION` "quality bar" is appended so Pass A self-targets the
  rubric in its first response. `SAFETY_OVERRIDE` is prepended ahead of all
  formatting/rubric text in every section preamble (`prdSectionPrompts.ts`) as
  defense-in-depth.

### Safety gate (`src/lib/safety/`)

Every PRD generation path runs through one chokepoint —
`generateStructuredPRD()` in `prdService.ts` — which calls
`classifyProjectSafety()` **before** any section runs. This is a hard,
**code-level** guardrail (not just a prompt): it stops Synapse from emitting a
malformed PRD where each section independently refuses ("I cannot fulfill this
request…").

- The classifier (`classifyProjectSafety.ts`) returns a `SafetyClassificationResult`
  (`allowed` | `allowed_with_restrictions` | `disallowed`) via Gemini JSON mode
  (`schemas/safetySchemas.ts`). Transport is injectable for tests.
- **`disallowed`** → `generateStructuredPRD` throws `SafetyBlockedError`; the
  pipeline never runs. Call sites (`HomePage`, `ProjectWorkspace.handleRegenerate`)
  catch it and persist a `blocked` `SpineVersion.safetyReview` (+ a canonical
  Safety Review markdown as `responseText`) via `setSpineSafetyReview`.
- **`allowed_with_restrictions`** → a restriction directive is appended to the
  prompt; the run records a `restricted` review and the PRD renders with a
  `SafetyBoundariesCard`.
- **Fail-closed:** if classification can't be determined (non-config transport
  error or unparseable output) the request is treated as `disallowed`. Genuine
  *config* errors (api key / auth / billing / permissions) are re-thrown to the
  normal error path.
- **UI / downstream gating keys off `SpineVersion.safetyReview.status === 'blocked'`:**
  `ProjectWorkspace` renders `SafetyReviewView` instead of the PRD,
  `handleToggleFinal` no-ops, the workspace render guard excludes it, and
  `artifactJobController.startAll` early-returns — so a blocked spine can never
  drive workspace/screens/architecture/implementation artifacts. Domain types
  (`SafetyClassification`, `SafetyClassificationResult`, `SpineSafetyReview`)
  live in `src/types`; the safety module re-exports them.

### Preflight clarification (`src/lib/services/preflightService.ts`, `src/components/preflight/`)

An **optional** pre-PRD step. After entering an idea on `HomePage`, a
`PreflightModeChoice` sheet offers **Generate Immediately** (unchanged path),
**Quick** (5 questions), or **Deep** (10 questions). Quick/Deep create the
project + spine, seed a `PreflightSession` via `initPreflightSession`, and
navigate to `/p/:projectId` **without** starting PRD generation.

- **State lives on the spine** — `SpineVersion.preflightSession`
  (`PreflightMode`/`PreflightQuestion`/`PreflightStatus`/`PreflightSession` in
  `src/types`), persisted with `spineVersions` (resumable across refresh; no
  `partialize` change). Store actions are on `spineSlice`
  (`initPreflightSession`, `setPreflightQuestions`, `setPreflightAnswer`,
  `setPreflightIndex`, `setPreflightSummary`, `completePreflightSession`,
  `setPreflightError`).
- **Hosted in the workspace.** `ProjectWorkspace` renders `PreflightView`
  (one question per card, progress, Skip/Back/Next, pinned safe-area CTA,
  AI-generated summary → Edit answers / Generate PRD) instead of the PRD/
  progress view while `preflightSession` exists, is not `completed`, has no
  `structuredPRD`, and isn't `blocked`.
- **Safety runs first.** `generatePreflightQuestions()` calls
  `classifyProjectSafety()` before producing any questions — a `disallowed`
  idea throws `SafetyBlockedError`, which `PreflightView` persists as a blocked
  `safetyReview` so the existing `SafetyReviewView` shows and no questions/PRD
  are produced. Non-safety failures fall back to a generic question set
  (flagged `usedFallback`) / a deterministic local summary, never blocking.
- **PRD integration.** Generation goes through the shared
  `src/lib/runPrdGeneration.ts` helper (used by both HomePage and
  `PreflightView`). On **Generate PRD**, `completePreflightSession` runs, then
  `generateStructuredPRD` is called with an `options.preflight`
  (`PreflightContext`) — answered/skipped responses + summary/assumptions/
  unknowns. `prdService` appends `buildClarificationPromptBlock()` (the
  authoritative-intent instruction; skipped → open unknowns) to the prompt
  **after** the safety gate, so every section receives it via `ctx.idea`.

### State (`src/store/`)

`useProjectStore` is one Zustand store composed from 8 slices in
`src/store/slices/`:

- `projectSlice` — Project CRUD, current stage
- `spineSlice` — SpineVersion CRUD, structured PRD updates, generation
  errors. Branches fork from highlighted spine text and consolidate
  back via `branchService.consolidateBranch()`. Spine versioning uses
  `isLatest`/`isFinal` flags.
- `branchSlice` — Branches and their messages
- `artifactSlice` — Artifacts + ArtifactVersions; preferred-version
  tracking; source-ref staleness detection against the current spine
- `feedbackSlice` — FeedbackItems with intent classification
- `stalenessSlice` — Staleness checks
- `generationJobsSlice` — Per-project job tracking (transient; stripped
  from persistence)
- `prdProgressSlice` — Live progress event log for the PRD generation UI
  (transient; stripped from persistence). Consecutive-duplicate-deduped.

The store's `partialize` strips `jobs` and `prdProgress` so they don't
persist. `onRehydrateStorage` migrates legacy `currentStage` values
(`devplan`/`prompts`/`mockups`/`artifacts` → `prd` or `workspace`).

### Pipeline flow

```
User prompt → HomePage.handleCreateProject() → PreflightModeChoice
              ↓ (Generate Immediately) ──────────────┐
              ↓ (Quick / Deep)                        │
              PreflightView: questions → answers →     │
              summary → Generate PRD                   │
              ↓                                        ↓
              runPrdGeneration() → generateStructuredPRD()
              ↓
              Pass A streams structured JSON → onPartial paints draft
              ↓
              SpineVersion stored, currentStage='prd'
  PRD stage:       SelectableSpine / StructuredPRDView — text selection →
                   branch creation → AI conversation → consolidateBranch()
                   merges into spine (local or doc-wide scope, see
                   ConsolidationModal). Selection → action dialog runs
                   through the shared touch-aware pipeline (see "PRD
                   highlight → branch selection pipeline" below).
  Assets stage:    ArtifactWorkspace (bundle/individual gen, refine, validate)
                   + MockupsView (platform/fidelity/scope config)
                   + MarkupImageView (MarkupImageSpec → SVG via
                   MarkupImageRenderer). The `'workspace'` pipeline stage is
                   labeled **"Assets"** in `PipelineStageBar` (label-only; the
                   stage key/route is still `workspace`).
  History stage:   HistoryView — chronological timeline with diffs
```

### Post-finalization transition (Mark Final → Assets)

Marking a spine final must not dump the user back on something that looks like
the PRD again. `ProjectWorkspace.handleToggleFinal` (on the finalize edge)
starts artifact generation and shows `FinalizationSuccessModal` ("PRD
Finalized" — *being created* vs *ready*, keyed off an `assetsReady` presence
check of the 7 core artifacts + mockups) **without** switching stage. Its
**Open Assets** action (`handleOpenAssets`) switches `currentStage` to
`workspace` and arms a one-shot `finalizeAutoOpen` flag passed to
`ArtifactWorkspace` as `autoOpenIntent`. `ArtifactWorkspace` consumes it once
(via `onAutoOpenConsumed`): it auto-selects the first **non-PRD** artifact —
preferring `done`, then `generating`, then `queued`, else the first slot in
`CORE_ARTIFACT_DISPLAY_ORDER` (data_model → … → prompt_pack, then mockups) — and
opens the mobile drawer (`useIsMobile`-gated, so it never reopens after the user
closes it; desktop keeps the persistent side rail). While the overall run is in
flight, an idle slot renders a centered `BuildAssetsLoading` ("Creating your
build assets…") instead of an empty state.

### PRD highlight → branch selection pipeline

The core PRD-refinement gesture — highlight PRD text, get a contextual
action dialog (Clarify / Expand / Specify / Alternative / Replace), spawn
a history-tracked branch — is detection-source-agnostic and works on
both desktop and touch. Both PRD renderers (`SelectableSpine.tsx` for
markdown PRDs, `StructuredPRDView.tsx` for structured PRDs) share one
pipeline; do not reintroduce per-component `onMouseUp` selection logic.

- **`src/lib/selectionPopover.ts`** — pure, framework-free helpers:
  `isValidSelection` (rejects null / collapsed / empty / out-of-container
  selections), `getSelectionInfo` (text + bounding rect), and
  `computePopoverPosition` (viewport clamp + flip-above math for the
  desktop popover). These are unit-tested in isolation.
- **`src/lib/useSelectionPopover.ts`** — the React hook owning detection.
  Listens on `document` for **`pointerup`** (mouse/pen/touch, short read
  delay) *and* **`selectionchange`** (debounced — the mobile long-press +
  drag-handle route, which never fires a matching `mouseup`). Validates
  against a `containerRef`; a *collapsing* selection never auto-dismisses
  an open dialog (focusing the mobile input collapses the native range) —
  dismissal is explicit via `clear()`. Supports a **`manualCommit`** mode
  (the mobile path): instead of surfacing a valid selection immediately, it
  only *tracks* it (exposed as `pendingText`) and waits for an explicit
  `commit()` to surface it as `selection`. This stops the Synapse action
  sheet from popping on the first selected word and fighting the native iOS
  Copy/Look Up/Translate toolbar. Desktop (`manualCommit` omitted/false) is
  unchanged — selections surface instantly.
- **`src/lib/useIsMobile.ts`** — `matchMedia` hook at the Tailwind `md`
  breakpoint (jsdom-safe).
- **`src/components/MobileSelectionToolbar.tsx`** — mobile-only control that
  drives the manual-commit flow. **Idle:** a pinned "Select text to edit"
  button (until tapped, the PRD is plain readable text with untouched native
  iOS selection — the hook is `enabled: false`). **Active:** a persistent
  footer ("Select text, then tap Edit selection") echoing `pendingText`, with
  **Edit selection** (→ `commit()`) and **Cancel** (→ exit mode + `clear()`).
  Both renderers wire it identically: `mobileSelectMode` state gates the hook
  via `enabled: … && (!isMobile || mobileSelectMode)` and
  `manualCommit: isMobile && mobileSelectMode`, and the toolbar is hidden while
  the action sheet (or, in `StructuredPRDView`, an inline edit) is open. Mode
  resets on dismiss / successful branch.
- **`src/components/SelectionActionDialog.tsx`** — shared presentation:
  desktop = floating popover anchored to the selection rect; mobile =
  bottom sheet with `env(safe-area-inset-*)` insets and ≥44px tap
  targets. Both call the same branch handlers — there is no parallel
  edit path. The branch/history flow itself (`createBranch` →
  `replyInBranch` → `addBranchMessage`) is unchanged by this layer.

`index.html` carries `viewport-fit=cover` so safe-area insets resolve on
notched devices.

### PRD progress timeline (`src/components/progress/`)

The PRD generation path renders a single **responsive** `ProgressTimeline`
card (used on both mobile and desktop — there is no separate mobile/desktop
component). It is driven directly by the live `prdSectionStatus` store slice
(not by parsing the `prdProgress` message log):

- **`buildGenerationSteps.ts`** — pure adapter. `computeWaves()` groups the
  10 pipeline sections (`DEFAULT_PRD_SECTIONS`) into **dependency waves**
  (topological levels): a single-section wave is a sequential row, a
  multi-section wave is a "Running concurrently" group whose children are the
  parallel sections (labeled `2A`, `2B`, …). This is purely graph-derived, so
  it supports arbitrary graphs, multiple concurrent groups, and any step
  count. Overlays live status/timing/model onto the static waves;
  `formatModelName()` renders the actual configured Gemini id (e.g.
  `gemini-3-flash-preview` → "Gemini 3 Flash (preview)") — no hardcoded model
  names. `summarizeSteps()` derives the header count/percent/status.
- **`ProgressTimeline.tsx`** / `TimelineStep.tsx` / `ConcurrentGroup.tsx` —
  presentation. Status icons (completed/in-progress/failed/pending), an
  always-visible model chip, and explicitly-labeled times (`Actual:`/`Est.
  ~`/`Elapsed:`). A 1s ticker injects live `Elapsed:` from `startedAt`.
  Mobile collapses per-step detail behind chevrons and shows a `View full
  history >` link (navigates to the History stage); desktop shows
  description/model/status/est/actual/retry and concurrent groups without
  expansion, plus inline `[Current Run] [History]` tabs (History renders the
  `prdProgress` message log inline). Failed steps stay expanded with a red
  `Run again` button.
- **Single-section retry** (`src/lib/services/prdSectionRetry.ts`) —
  `regeneratePrdSection()` re-runs **only** a failed section using the
  current PRD as upstream context, shallow-overlays the new slice onto the
  existing `StructuredPRD` (sections own disjoint top-level fields), and the
  caller (`ProjectWorkspace.handleRetrySection`) writes it back via
  `updateSpineStructuredPRD` — every other section stays intact. The shared
  `parseSectionJson()` helper (in `progressivePrdGeneration.ts`) is reused by
  both the DAG worker and the retry path. `SECTION_DESCRIPTIONS` (next to
  `SECTION_TITLES` in `prdSectionPrompts.ts`) supplies the row descriptions.

The card is shown while `isPRDActivelyGenerating || hasFailedSection`, so a
partial-failure run (which returns a partial PRD without setting
`generationError`) keeps its Run again affordance visible.

### Other-flow progress UI (`src/components/GenerationProgress.tsx`)

The mockup / artifact / consolidation flows still use `GenerationProgress`.
Long-running LLM operations show a stages panel. The component supports
three drive modes, in priority order:

1. **State-driven** (`progress` prop is a number) — bar tracks the value
   directly, timer disabled.
2. **History-driven** (`history` prop is non-empty) — prominent label and
   stage-dot index derive from the latest progress message by
   first-three-words substring match against stage labels; walks
   backwards through history if the latest message is transient
   ("Connection dropped — retrying…", "Sending request to model…")
   so the indicator doesn't yank to the wrong stage.
3. **Timer-driven** (fallback) — labels rotate on `minDuration` timers.

When supplying `history`, the stage label strings in
`generationStages.ts` must be a substring-prefix match for the strings
emitted via `onProgress` for the indicator to track. Don't include
mutable detail (char counts, timestamps) in progress messages — that
defeats the store's consecutive-dedupe and floods the history list.

### Interactive product tour (`src/components/tour/`)

"Meet Synapse" is a fully interactive product tour (mounted at `/tour`, with
`/about` kept as a backward-compatible alias) — **not** a static infographic
page. It rebuilds six onboarding screens as native UI and teaches the workflow
through interaction. All content is demo-only (`tourData.ts`); it never touches
the Gemini pipeline, the `api/` backend, or the Zustand project store.

- **Two modes, one source of truth.** `src/lib/useTourState.ts` is a
  `useReducer` (`tourReducer` + `initialTourState`, both exported for tests)
  holding `{ activeIndex, mode, direction }`. **Guided** mode (first-timers)
  is a linear story; **Overview** mode (returning users) shows
  `TourProgressRail` to jump to any section. Every navigation input — `TourNav`
  buttons, the dot rail, overview tabs, desktop Arrow keys (listener in
  `TourPage`, ignored while typing), and mobile swipe — funnels through
  `dispatch`. `RESTART` replays guided mode.
- **Completion persistence** lives in `src/lib/tourPersistence.ts`
  (`synapse-tour-completed` localStorage flag, defensive try/catch) —
  deliberately *not* in the project store. Reaching the last screen marks it
  completed; completed users default to Overview mode. The retired
  `synapse-meet-dismissed` key is swept in `App.tsx`'s migration block.
- **Transitions & gestures.** `TourContainer` uses framer-motion
  `AnimatePresence` + a `motion.div` with direction-aware slide/fade variants;
  `drag="x"` (mobile + motion-allowed only) commits via the pure
  `shouldCommitSwipe()` in `src/lib/swipeMath.ts` (offset/velocity → next/prev).
  Only the active screen is mounted; each `screens/Screen*.tsx` is
  `React.lazy`-loaded so all six never load at once (verify: separate chunks in
  `vite build` output). Because only the active screen mounts, screens reset by
  remounting — do not add `isActive`-based reset effects (they trip the
  `react-hooks/set-state-in-effect` lint rule); use async timer callbacks +
  unmount cleanup for animated sequences.
- **Reduced motion.** `src/lib/usePrefersReducedMotion.ts` (jsdom-safe, mirrors
  `useIsMobile`) plus framer-motion's own handling: screens render their final
  state instantly, drag is disabled, transitions collapse to a fade. Every
  interaction must remain usable without animation.
- **Screens** (`screens/`): Idea, SpecGeneration, Refine (reuses the
  Clarify/Expand/Specify/Alternative/Replace action set mirrored from
  `SELECTION_ACTIONS`), Versions, Assets (the hero — Mark as Final →
  sequential asset generation → `ArtifactDrawer` previews), Connections
  (`NodeGraph` PRD→assets dependency graph + recent-activity timeline). Shared
  pieces in `components/`: `ScreenShell`, `GenerationStep`, `RefineMenu`,
  `ArtifactDrawer` (mobile bottom-sheet / desktop side-drawer, mirrors
  `SelectionActionDialog`'s responsive pattern), `NodeGraph`.

### Domain types

`src/types/index.ts` is the single source of truth for the domain model
(Project, SpineVersion, Branch, Artifact, ArtifactVersion, FeedbackItem,
HistoryEvent, etc.). Keep optional fields optional even when only one
code path uses them — legacy localStorage data may not have them.
