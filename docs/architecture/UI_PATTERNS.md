# UI Patterns: Selection, Progress, Tour & Metrics

> Extracted from CLAUDE.md. The PRD highlight→branch selection pipeline, PRD progress timeline, GenerationProgress modes, the interactive product tour, and orchestration metrics.

### PRD highlight → branch selection pipeline

The core PRD-refinement gesture — highlight PRD text, get a contextual
action dialog (Clarify / Expand / Specify / Alternative / Replace), spawn
a history-tracked branch — is detection-source-agnostic and works on
both desktop and touch. The selection pipeline now has a single consumer,
`StructuredPRDView.tsx` (the structured PRD renderer); legacy spines with no
`structuredPRD` render as read-only markdown with no selection/branch UI. Do
not reintroduce per-component `onMouseUp` selection logic.

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
  pipeline sections (`DEFAULT_PRD_SECTIONS`) into **dependency waves**
  (topological levels): a single-section wave is a sequential row, a
  multi-section wave is a "Running concurrently" group whose children are the
  parallel sections (labeled `2A`, `2B`, …). This is purely graph-derived, so
  it supports arbitrary graphs, multiple concurrent groups, and any step
  count. Overlays live status/timing/model onto the static waves;
  `formatModelName()` renders the actual configured Gemini id (e.g.
  `gemini-3-flash-preview` → "Gemini 3 Flash (preview)") — no hardcoded model
  names. `summarizeSteps()` derives the header count/percent/status.
  The executor emits a `section_ready` event when a section's deps are
  satisfied, so the grid distinguishes two waiting states: **`pending`** =
  waiting on dependencies (shows "Waits on: …"), **`queued`** = deps satisfied,
  waiting for a free concurrency slot. `mapStatus()` keeps these distinct;
  leaves also carry `dependsOn` (resolved to titles) and `retryCount`.
- **`ProgressTimeline.tsx`** / `TimelineStep.tsx` / `ConcurrentGroup.tsx` —
  presentation. Status icons (completed/in-progress/queued/failed/pending — the
  amber `queued` ring is distinct from the plain `pending` ring), an
  always-visible model chip, a "Retried ×N" badge, and
  explicitly-labeled times (`Actual:`/`Est. ~`/`Elapsed:`). A 1s ticker injects
  live `Elapsed:` from `startedAt` (re-stamped on each `generating` transition,
  so retries show fresh elapsed). **`StepBody` puts only the step title + timing
  block on the header row and renders the description, `Waits on:` note, and
  model chip full-width *below* it — so on a narrow phone the detail text and
  model names use the whole card instead of being squeezed into a thin column
  beside the timing block (the old single-row layout truncated model names to
  "Gemini 3.1…" and wrapped descriptions into 2–3-word lines with an empty right
  gutter). `ConcurrentGroup` also trims its nested indentation at `sm:` (dashed
  padding, branch connector width, child gaps) to reclaim mobile width. Do not
  move the description/model chip back beside the timing block.**
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
  **Restricted projects retry under their original constraints:** the caller
  passes the spine's persisted `safetyReview`, and `regeneratePrdSection`
  re-appends the reconstructed restriction directive to the idea exactly as
  `generateStructuredPRD` does on a full run (the stored `promptText` is the
  raw idea, so without this the retry would silently drop the constraints).
  Pass `safetyReview` from any new retry call site.

The card is shown while `isPRDActivelyGenerating || hasFailedSection`, so a
partial-failure run (which returns a partial PRD without setting
`generationError`) keeps its Run again affordance visible.

**Partial-failure persistence:** the live section grid is transient, so the
pipeline also records failed section ids in
`generationMeta.failedSections` (set by `progressivePrdPipeline`, stored on
the spine via the normal `onResult` path). When non-empty, `ProjectWorkspace`
renders an amber "This PRD is incomplete" banner above the PRD with a
per-section "Run again" button wired to the same `handleRetrySection` flow —
this survives refresh, unlike the timeline. A successful single-section retry
removes its id from the list (see `handleRetrySection`).

**Incomplete-PRD generation gate** (`src/lib/artifactGenerationGate.ts`, pure).
A partial PRD (`generationMeta.failedSections` non-empty) must not silently
drive downstream artifact generation. `evaluateSpineGenerationGate(spine, opts)`
is the code-level guardrail (defense-in-depth alongside the UI, mirroring the
safety-blocked check): it returns `allowed:false` for a safety-blocked spine, a
spine with no `structuredPRD`, or an incomplete spine that is neither
acknowledged (`acknowledgeIncomplete`) nor already `isFinal` (the durable record
of acknowledgement, so resume/retry after reload still work). `startAll` /
`regenerateSlots` early-return when the gate disallows. On the finalize edge,
`ProjectWorkspace.handleToggleFinal` interposes an explicit "Generate assets from
an incomplete PRD?" confirmation before `markSpineFinal` + `startAll`; only
"Generate anyway" proceeds (passing `acknowledgeIncomplete`). Any artifact/mockup
version generated while `failedSections` is non-empty is stamped
`metadata.generatedFromIncompletePrd` + `incompletePrdSections` for provenance.

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

**The `waiting` prop overrides all three drive modes and is REQUIRED for a
`queued` (not-yet-started) slot.** A queued artifact slot has an empty
`progressLog`, so without `waiting` it falls into the timer-driven fallback and
**fabricates progress** — rotating stage labels and marching the bar on a timer
while no work is happening (the "Queued — will start as a slot frees up"
subtitle beside a moving progress bar and a late stage label like "Documenting
decision points…"). When `waiting` is true the component renders an honest
not-started state: the rotation timer is disabled, `barWidthPct` is 0, every
stage dot is inert (`activeDotIndex === -1`, a preview of the pipeline with none
active/complete), the title dot doesn't pulse, and no work-stage label is shown
(only the `subtitle`). Both queued renders in `ArtifactWorkspace` (the Screens
row and the generic artifact/mockup slot) pass `waiting={status === 'queued'}`;
any new queued-slot progress render must do the same. Do NOT drive
`GenerationProgress` with stages for a slot that hasn't started without
`waiting`. Regression: `src/components/__tests__/GenerationProgressWaiting.test.tsx`.

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

**Public portfolio demo:** `/tour` and `/about` are deliberately **outside the
auth gate** in `App.tsx` (no `RequireAuth`), so the tour is a standalone,
linkable demo that exposes no user data or keys. SPA fallback to `index.html`
on direct load/refresh is provided by `vercel.json` `rewrites` (Vercel) and
`public/_redirects` (Netlify / compatible static hosts) — keep both in sync if
routing changes. `TourPage.tsx`'s header carries Synapse branding + an "Open
Synapse" CTA back to `/` so it reads as a product demo, not an internal page.

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

### Orchestration metrics (`src/lib/metrics/`, `src/components/metrics/`)

A measurable view of the concurrent multi-agent workflows. **Important context:
PRD section generation was already genuinely concurrent** (the DAG executor —
see the LLM layer) before this; the metrics layer makes that concurrency
*visible*, it did not introduce it. See `docs/ORCHESTRATION_AND_METRICS.md`.

- **Token capture.** **Both** `callGemini` and `callGeminiStream` read Gemini's
  `usageMetadata` (the streaming path off the final SSE chunk) and surface it via
  an optional `JsonModeConfig.onUsage` callback (both still return the same
  `string` — no call site breaks). The PRD section worker threads it through
  `ModelProvider.generateText` → `makeJsonProvider` and emits it on the
  `section_completed` event. **New provider call sites that want token metrics
  must forward `onUsage`.** (The artifact-bundle `WorkflowRun` node observations
  in `artifactJobController` still don't record tokens even though the transport
  now reports them — wiring that through is the remaining TODO.)
- **Pure metric math** (`src/lib/metrics/`, unit-tested, no store/LLM access):
  `workflowMetrics.ts` (sequential estimate, actual runtime, speedup, max/avg
  concurrency via interval sweep, critical path via memoized DFS),
  `modelPricing.ts` (approximate per-model $/1M-token table → cost **estimates**,
  surfaced as "est."), and `buildWorkflowRun.ts` (assembles a `WorkflowRun` from
  per-node observations; derives `parallelGroupId` as a topological wave when not
  supplied). Both pipelines feed `buildWorkflowRun` so PRD and artifact runs are
  computed identically.
- **Recording is decoupled + defensive.** `progressivePrdPipeline` accumulates
  per-section node observations from the lifecycle events it already emits and
  fires `onWorkflowRun(run)` once at completion (threaded through `prdService`);
  `artifactJobController.executeJob` does the same for the artifact bundle.
  Identity (projectId/projectName) is stamped at the call site
  (`runPrdGeneration.ts`, `ProjectWorkspace.handleRegenerate`) before
  `recordWorkflowRun`. **All run assembly is wrapped in try/catch — metrics can
  never break a generation run.**
- **Dashboard** at `/metrics` (auth-gated route in `App.tsx`, linked from the
  Settings modal and the workspace overflow menu): `MetricsPage` (stable
  `EMPTY_RUNS` selector fallback per the Selector-stability rule),
  `MetricsOverviewCards`, `WorkflowRunsTable`, `WorkflowRunDetail` (Gantt bars +
  node table). **No synthetic/demo data** — a fresh user sees an empty state.

