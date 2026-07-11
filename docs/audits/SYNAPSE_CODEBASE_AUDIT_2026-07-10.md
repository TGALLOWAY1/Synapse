# Synapse codebase and product audit

**Audit date:** 2026-07-10  
**Repository state:** `main` at `61611e5`  
**Runtime reviewed:** local Vite development server and [synapse-prd.vercel.app](https://synapse-prd.vercel.app/)  
**Method:** documentation and source review, clean dependency installation, lint/test/build validation, manual browser journeys at desktop and mobile widths, screenshot review, and source tracing from observed behavior  
**Constraint:** audit only. No application code was changed.

## Resolution log

The sections below are the point-in-time audit record and are left as written.
Fixes applied after the audit are tracked here and in a **Resolution** block
appended to each affected finding.

| Finding | Status | Resolved by | Summary |
| --- | --- | --- | --- |
| SYN-001 | 🟡 Partially resolved (2026-07-10) | PR [#269](https://github.com/TGALLOWAY1/Synapse/pull/269), commits `9730d65`, `63887ce`, `fdd3aed`, branch `fix/demo-read-only-capabilities` | The public demo now has one centralized read-only capability policy enforced in UI and durable mutation boundaries. Persistent PRD, artifact, review, generation, design, image, task, workflow, and export-state changes are denied while exploration remains available. **Reset Demo and baseline restoration remain open** as the intentionally deferred portion of SYN-001. See the Resolution block under SYN-001. |
| SYN-002 | ✅ Resolved (2026-07-10) | PR [#267](https://github.com/TGALLOWAY1/Synapse/pull/267), commit `59a92d5`, branch `claude/demo-route-hydration-jyalya` | Demo hydration moved to the route boundary: `DemoRouteGate` wraps `ProjectWorkspace` on `/p/<DEMO_PROJECT_ID>` and runs `loadDemoProject()` before mount; entry buttons navigate only. See the Resolution block under SYN-002. |
| SYN-003–SYN-018 | Open | — | — |

## 1. Executive summary

## Development-stage assumptions

**Clarification applied after the point-in-time review:** Synapse is pre-launch. It has no active production users and no production user projects or historical data to preserve. Breaking internal schemas, artifact metadata, internal APIs, fixtures, and seeded data is acceptable when it produces a cleaner, more reliable intended architecture.

Development `localStorage`, IndexedDB records, cached snapshots, and local projects may be invalidated or cleared. Seeded demo projects and pinned snapshots may be regenerated or republished. Existing fixtures and tests may be rewritten around the canonical model, and obsolete compatibility layers may be deleted. Create a migration only when it is materially simpler or safer than resetting development data—not because of hypothetical user impact. Prefer one canonical representation over old/new adapters or compatibility windows; use a quick repository/code-path check when an active consumer is uncertain.

**Regression boundary:** breaking obsolete development data is acceptable. Breaking the intended current product experience is not. Continue strong regression protection for the public recruiter-facing demo; authentication and project isolation; current project creation, generation, and intended cloud sync; security boundaries; artifact dependency correctness; promised versioning behavior; responsive and accessible UI; build/lint/unit/integration/E2E behavior; and canonical seeded projects or demo fixtures used for product validation.

Synapse is healthier than its size and domain complexity initially suggest. A clean install produces a passing TypeScript production build, a clean lint run, and **1,495 passing Vitest tests across 162 files**. The codebase has several strong foundations: project data is namespaced per user, cloud sync is local-first with explicit revision-conflict handling, interrupted generations are reconciled after reload, artifact generation is dependency-aware, partial PRD output is not silently treated as complete, and server APIs consistently enforce session ownership. The live Data Model and Implementation Plan views were visually strong on both desktop and mobile, and the deployed journey produced no browser-console errors during the audit.

The highest-value risks are concentrated around product truthfulness and consistency, especially in **View Demo**:

- The public “read-only” demo is actually mutable. Un-finalizing its PRD disables Assets, and that mutation survives refresh.
- A cold direct link to the demo route does not hydrate the demo; hydration only happens in the entry-button handlers.
- The demo says its primary mockup is “Generated” and “aligned” while the image is absent and the UI asks the visitor to upload one or configure an OpenAI key.
- The tour presents a polished multi-version story that does not match the live demo’s one-version, partially restored state.
- There is no end-to-end test that protects the public demo contract, so unit-tested pieces can still compose into a contradictory experience.

Two systemic issues matter beyond the demo. First, artifact freshness is calculated by two different engines: artifact headers and exports use a spine-centric three-state getter, while the Dependency Graph and update plan also consider upstream artifact-version drift. The same artifact can therefore be “Current” in one surface and “Needs update” in another. Second, user-authored screen and prompt edits update an existing `ArtifactVersion` record in place; a history event is appended, but the historical content is not. That undercuts the product’s versioning promise.

The most concrete security issue is local and fixable: the legacy Design System Markdown renderer enables unsanitized raw HTML. Generated or restored content can therefore create arbitrary elements such as an `iframe` with `srcdoc`. Removing raw-HTML parsing is preferable to introducing a large sanitization policy because its only current purpose is a hex-color annotation that can be rendered safely in React.

The main simplification opportunities are not a rewrite. They are: make demo mode a single explicit boundary; consolidate freshness behind one evaluator; separate immutable content revisions from mutable workflow overlays; route-split the workspace; and progressively extract controller/state-selection responsibilities from the two 1,400–1,800-line workspace components. Most urgent fixes are local or cross-component. The state/version issues are cross-artifact and require coordinated replacement plus deliberate regression coverage, not preservation of discarded development records.

No P0 issue was found. Seven P1 findings should be addressed before treating the demo as a dependable first-class acquisition surface.

## 2. System map

### Application areas and routes

- React 19 + TypeScript SPA, built with Vite 7 and styled with Tailwind CSS.
- `src/App.tsx` statically imports all major routes: authentication/home (`/`), public tour (`/tour`), project workspace (`/p/:projectId`), metrics, developer LLM trace, privacy, and recruiter administration.
- `ProjectWorkspace` owns PRD review/finalization, top-level stage changes, downstream update planning, and workspace shell behavior.
- `ArtifactWorkspace` owns artifact navigation and coordinates the PRD-derived asset views: Design System, User Flows, Screens, Data Model, Implementation Plan, and the derived Dependency Graph.

### Core data and persistence flow

1. `src/store/projectStore.ts` composes ten Zustand slices.
2. Durable state is persisted to a user-scoped localStorage key through a 500 ms debounced storage adapter. Generation jobs and PRD progress/status are intentionally excluded.
3. `src/store/projectServerSync.ts` reconciles signed-in projects with `/api/projects`, then pushes live changes after a 1.5 second debounce.
4. Server revision conflicts stop automatic overwrites and require an explicit keep-local/use-cloud resolution.
5. Mockup and screen images are stored separately through IndexedDB/Blob reference paths and synchronized by `projectImageSync`.
6. Generation progress is transient; interrupted PRD generation is converted to a settled error on rehydrate so the UI does not remain indefinitely “Generating.”

### Artifact relationship model

- The finalized PRD (`SpineVersion`) is the foundation for every generated artifact.
- `screen_inventory` has no core-artifact dependency.
- `user_flows` depends on `screen_inventory`.
- Hidden `component_inventory` depends on `screen_inventory` and remains a generation input for mockups.
- `design_system` and `data_model` depend directly on the PRD.
- `implementation_plan` depends on `screen_inventory` and `data_model`.
- Mockups depend on `screen_inventory`, hidden `component_inventory`, and `design_system`.
- Prompt Packs are a current, critical part of the Implementation Plan: the consolidated plan exposes them for implementation work. The separate `prompt_pack` artifact subtype is retired from new generation because its content is folded into that canonical Implementation Plan representation. Retain the adapter and renderer path that serves the current consolidated plan; only delete obsolete standalone persistence compatibility after confirming it is not needed by current exports or canonical fixtures.
- `src/lib/coreArtifactPipeline.ts` is the canonical dependency definition; `src/lib/artifactDependencyGraph.ts` derives the visible graph from it and collapses hidden nodes transitively.

### State concepts

| Concept | Source | Persisted? | Control |
| --- | --- | --- | --- |
| Project stage | `Project.currentStage` | Yes | System/user navigation |
| PRD final/latest | `SpineVersion.isFinal`, `isLatest` | Yes | User/system |
| Artifact lifecycle | `Artifact.status`, `currentVersionId` | Yes | System/user |
| Artifact content revision | `ArtifactVersion` | Yes | Generation/restore |
| Provenance/source refs | `ArtifactVersion.sourceRefs`, `provenance` | Yes | Generation system |
| Screen/prompt edits | `ArtifactVersion.metadata.screenEdits` / `promptEdits` | Yes, in-place | User |
| Plan progress/review overlays | Artifact-version metadata | Yes, in-place | User |
| Simple freshness | `getArtifactStaleness()` | Derived | Spine ref + mockup token hash |
| Dependency status | `evaluateDependencyGraph()` | Derived | Spine, hard dependencies, token drift, job state |
| Screen readiness/review | `screenReadiness` / `screenReviewWorkflow` | Mixed overlay + derived | User and system |
| Generation jobs/progress | generation slices | No | System |
| Cloud sync state | sync store + per-user sync metadata | Mixed | System/user conflict resolution |

The important boundary problem is that “freshness” is duplicated, while user content edits and workflow bookkeeping both ride mutable metadata on an otherwise versioned record.

### Demo architecture

- The owner pins a public snapshot; the browser fetches `/api/snapshots?demo=1`.
- `loadDemoProject()` restores it under the stable `DEMO_PROJECT_ID` and namespaces image/version identifiers.
- Project and image cloud sync explicitly exclude that ID.
- Hydration is initiated by `LoginPage` and `HomePage` demo buttons, not by the demo route itself.
- The restored demo then runs through the ordinary project/workspace Zustand state and ordinary mutation handlers. Demo checks are scattered through sync, generation, design setup, and workspace UI rather than enforced at a single read-only boundary.

### Major shared UI and test systems

- Reusable artifact renderers and experience views handle structured/generated content.
- Provenance, staleness, readiness, review, and sync each have their own badges or controls; presentation is not yet based on one canonical artifact health model.
- Vitest and Testing Library cover stores, generation/orchestration, normalization, dependency graphs, renderers, and utilities.
- Playwright is installed for screenshot scripts, but there is no Playwright configuration, E2E test suite, or `test:e2e` command.

## 3. Validation results

### Command results

| Check | Result | Evidence / qualification |
| --- | --- | --- |
| Dependency installation | Pass after escalation | The existing `node_modules` was incomplete. Initial build/tests reported missing `framer-motion`, `@vercel/blob/client`, `diff`, and `mongodb`. A sandboxed `npm ci` then failed with `ENOTFOUND`; the approved network-enabled retry installed 478 packages cleanly. The initial failures were environment/install drift, not product regressions. |
| Type checking | Pass | `npm run build` runs `tsc -b` before Vite; TypeScript completed successfully. There is no separate `typecheck` script. |
| Lint | Pass | `npm run lint`. |
| Unit/integration tests | Pass | `npm test`: 162 files, 1,495 tests, all passing in 22.45 seconds. “Integration” tests are not separately tagged, so this count includes store/component orchestration tests. |
| End-to-end tests | Not present | No Playwright config or E2E/spec path and no E2E package script. Screenshot capture scripts are not semantic assertions. |
| Production build | Pass with warnings | Vite 7.3.2 transformed 3,121 modules in 9.13 seconds. Entry JS was 1,968.35 kB minified / 575.88 kB gzip; CSS was 466.52 kB / 60.14 kB gzip. Vite warned that the entry chunk exceeds 500 kB. |
| Dependency audit | 10 advisories | `npm audit --json`: 2 low, 4 moderate, 4 high, 0 critical. Most are tooling or feature-specific paths; see SYN-015. |

### Build warnings traced

- Tailwind generated invalid CSS from regex text in `src/lib/services/dataModelMarkdown.ts` (lines 434, 722, and 754). Its content scanner interprets `[-:|\s]` as an arbitrary-property class and emits `.-\:\|\\s { -: |\s; }`.
- `toastStore` and `llmProvider` are both statically and dynamically imported, so their dynamic imports do not create split chunks.
- The main entry bundle is large because `src/App.tsx` statically imports every major route.

### Runtime review

- **Local Vite `/`:** rendered “Couldn’t reach the server” because `npm run dev` cannot serve `/api/auth/session`. The public `/tour` remained usable. This is a documentation/setup mismatch, not a frontend crash.
- **Deployed demo journey:** login → demo → PRD → Screens → screen detail → Mockups → Data Model → Implementation Plan → version history. No browser-console errors were observed during the journey.
- **Demo load:** one manual warm-browser observation was approximately 2.6 seconds from CTA to workspace. This is not a statistically useful performance benchmark and should not be treated as one.
- **Mutation/refresh:** un-finalizing the demo immediately disabled Assets; refreshing preserved that state. The state was manually restored during the audit.
- **Incomplete content:** a primary mockup displayed “Generated” while no image existed and the fallback requested an upload/OpenAI key.
- **Mobile widths reviewed:** 430, 390, and 360 CSS pixels, plus 1,440 desktop. The 360 Screens view overflowed horizontally. Data Model and Implementation Plan remained coherent at 390–430. A dedicated 1,024/768 pass was not completed.
- **Console:** no errors on the deployed representative journey. The browser automation interface did not expose a complete request waterfall, so network conclusions are limited to visible failures and source tracing.

### Accessibility review

Manual semantic/DOM inspection found definite missing labels/error associations on the authentication form and incomplete tab semantics/small progress targets in the tour. This was not a full WCAG audit: no automated axe run, screen-reader session, contrast measurement, 200% zoom sweep, or reduced-motion test was completed.

### Screenshot catalog

The reviewed evidence is in [`screenshots-2026-07-10`](./screenshots-2026-07-10/). Key captures:

| Surface | Desktop | Mobile |
| --- | --- | --- |
| Entry/loading | — | [Login + demo loading](./screenshots-2026-07-10/17-demo-loading-mobile-390.png) |
| Demo PRD | [PRD](./screenshots-2026-07-10/03-demo-prd-desktop-1440.png) | — |
| Screens | [Overview](./screenshots-2026-07-10/04-demo-screens-overview-desktop-1440.png) | [360 px overflow](./screenshots-2026-07-10/12-demo-screens-overview-mobile-360.png) |
| Screen detail | [Detail](./screenshots-2026-07-10/05b-demo-screen-detail-viewport-desktop-1440.png) | [Detail](./screenshots-2026-07-10/13-demo-screen-detail-mobile-390.png) |
| Mockup | [Mockup view](./screenshots-2026-07-10/06-demo-mockup-view-desktop-1440.png) | [Missing image warning](./screenshots-2026-07-10/15-demo-mockup-missing-image-mobile-390.png) |
| Data Model | [Data Model](./screenshots-2026-07-10/07-demo-data-model-desktop-1440.png) | [Data Model](./screenshots-2026-07-10/11-demo-data-model-mobile-430.png) |
| Implementation Plan | [Plan](./screenshots-2026-07-10/08-demo-implementation-plan-desktop-1440.png) | [Plan](./screenshots-2026-07-10/10-demo-implementation-plan-mobile-390.png) |
| Version history | [One-version drawer](./screenshots-2026-07-10/09-demo-version-history-desktop-1440.png) | — |
| Guided tour | [Step 1](./screenshots-2026-07-10/18-interactive-tour-step1-desktop-1440.png) | [Step 1](./screenshots-2026-07-10/19-interactive-tour-step1-mobile-390.png), [generation](./screenshots-2026-07-10/20-interactive-tour-generation-mobile-390.png), [final](./screenshots-2026-07-10/21-interactive-tour-final-mobile-390.png) |

Three early “full-page” browser captures (`01`, `02`, and `05`) were visually corrupted by the capture tool and are intentionally excluded as evidence.

## 4. Prioritized findings

### P0 — Critical

No P0 finding was supported by the evidence gathered.

### P1 — High

## [SYN-001] The public demo is mutable and a destructive state change survives refresh

**Status: 🟡 Partially resolved — 2026-07-10, PR [#269](https://github.com/TGALLOWAY1/Synapse/pull/269) (`fix/demo-read-only-capabilities`; commits `9730d65`, `63887ce`, `fdd3aed`). Persistent mutation prevention is complete; Reset Demo remains open. See the Resolution block below.**

**Labels**

- Importance: P1 — High
- Bug severity: S2 — Significant
- Effort: S–M (replacement preferred)
- Confidence: High
- Category: Demo
- Scope: Cross-component
- Change type: Fix

**Observed evidence**

The login page and documentation describe a public/read-only demo, but the deployed demo exposes the ordinary Final button. Clicking “Final” un-finalized the demo, changed the control to “Mark Final,” disabled Assets, and the changed state remained after reload. `ProjectWorkspace.handleToggleFinal()` (`src/components/ProjectWorkspace.tsx:546-568`) contains no demo guard; the button at lines 870-878 is also not hidden/disabled for the demo. The nearby demo banner explicitly says regenerate/refine mutators remain active (lines 1093-1101). `loadDemoProject()` returns the cached project immediately when its source snapshot ID matches the pointer, so local mutations remain authoritative (`src/store/slices/projectSlice.ts:182-188`). Cloud sync exclusions prevent server corruption, but not local demo corruption.

**Why it matters**

The first public product experience can be put into a broken state by a normal visible action. Visitors cannot distinguish deliberate interactivity from accidental mutation, there is no reset, and subsequent visits inherit the damage. This directly harms demo trust.

**Likely root cause**

Demo mode is implemented as an ordinary restored project with scattered exclusions for expensive/server operations, not as an explicit immutable session or capability policy.

**Concrete recommendation**

Create one demo capability boundary (for example `DemoPolicy`/`useProjectCapabilities`) and make all product mutations consult it. Preserve navigation, tabs, expansion, filtering, and other ephemeral exploration. Disable or hide persistent mutations, explain the limitation once, and add “Reset demo” that discards only the demo namespace and reloads the pinned snapshot. Do not fork the entire workspace into demo-only components.

**Acceptance criteria**

- Persistent demo actions cannot change PRD finality, content, artifact versions, reviews, or generated assets.
- Refresh and repeat entry always produce the pinned baseline.
- Reset is deterministic and does not touch signed-in projects.
- Controls communicate read-only status without repeated warning clutter.

**Dependencies and risks**

Inventory mutation entry points beyond `ProjectWorkspace`, including metadata overlays and task export. Avoid blocking harmless UI state. This should precede demo content polish.

**Suggested validation**

Add an E2E test that opens the demo anonymously, attempts representative mutations, reloads, and asserts the original final/version/artifact state. Test reset with a deliberately corrupted local demo cache.

**Resolution — read-only capability boundary (2026-07-10 — PR [#269](https://github.com/TGALLOWAY1/Synapse/pull/269), branch `fix/demo-read-only-capabilities`)**

Implemented the mutation-prevention portion of this finding without creating a
demo-only workspace or second store:

- **One authoritative capability model.** `src/lib/projectCapabilities.ts`
  defines `ProjectCapabilities`, `getProjectCapabilities`, and the reusable
  `assertProjectCapability` domain guard. `DEMO_PROJECT_ID` may explore but is
  denied every durable capability: project/PRD edits, finality, artifact edits,
  review state, generation, Design System management, workflow persistence,
  and external export state. Missing/unknown projects fail conservatively.
  `src/hooks/useProjectCapabilities.ts` is the React adapter; components do not
  accumulate new raw demo-id mutation checks.
- **Project and PRD boundaries.** Project deletion/stage persistence, Design
  System setup, spine text/structured edits, regeneration, finality, version
  restoration, product metadata, preflight state, safety/generation results,
  and branch create/reply/merge/delete actions assert capabilities before
  writing. Demo Project/Assets/History navigation uses component-local state,
  preserving exploration without persisting `currentStage`.
- **Artifact and review boundaries.** Artifact create/update/delete, version
  creation/preference/restoration, mark-current confirmation, metadata overlays,
  feedback status, screen edits, prompt edits, review/checklist/confirmation
  state, warning dismissals, relinks, plan progress, and mockup coverage overlays
  are rejected before changing durable state.
- **Generation and image boundaries.** `artifactJobController.startAll`,
  `regenerateSlots`, `retrySlot`, and `resumeIfNeeded` reject the demo before a
  job or paid request starts. The legacy mockup image store, variant image store,
  coverage-sidecar writer, Screen Inventory upload writer, and preferred-upload
  writer also assert capabilities before network or IndexedDB writes.
- **Tasks, workflow, and external-export state.** Task extraction/save, status,
  removal, recorded GitHub/Linear/Markdown export references, and persisted
  orchestration metrics are guarded. The Convert-to-Tasks entry point is absent
  for the demo, so its external provider workflow cannot be started from the
  public project. Local copy/download exports that do not mutate project state
  remain available.
- **Intentional UI treatment.** Mutation-only controls are hidden: Final,
  regenerate/retry, PRD and artifact edit/refine, restore, mark-current, review
  and confirmation, Design System direction, uploads/replacements, task
  management, branch refinement, and dependency-graph update actions. Where a
  visible disabled generation affordance still explains the product, it carries
  the accessible reason “This example project is read-only.” Version history,
  comparisons, tabs, filters, sorting, expansion, dependency inspection, screen
  details, and mockup viewing remain usable.
- **One read-only explanation.** `DemoReadOnlyNotice` adds a single accessible
  workspace-level `role="status"` message explaining that visitors can explore
  the complete example without changing the saved project; artifact surfaces do
  not repeat warning clutter.
- **Architecture documentation.** `CLAUDE.md` now records the policy as the
  required boundary for future durable mutation domains.

*Acceptance status:* mutation-prevention criteria are met: the demo cannot
change PRD finality/content, artifact content or versions, screen/prompt edits,
reviews/confirmations, workflow metadata, Design System state, generated assets,
uploads, tasks, or external-export claims through protected actions. Ordinary
projects retain the same representative editing operations. Navigation and
inspection remain available. The original acceptance criterion requiring a
deterministic Reset Demo / baseline reload is **not met in this batch** and is
the reason SYN-001 remains partially rather than fully resolved.

*Tests:* `src/lib/__tests__/projectCapabilities.test.ts` covers demo, ordinary,
missing-project, and exploration policy; `src/store/__tests__/demoReadOnlyMutations.test.ts`
covers finality, PRD edits, screen/review metadata, generation/regeneration,
Design System, workflow state, and ordinary-project parity;
`src/components/__tests__/DemoReadOnlySurfaces.test.tsx` covers the notice,
hidden generation/update/restore controls, dependency inspection, and version
comparison. Existing affected component/store fixtures were updated to use
real project identities under the new conservative unknown-project rule.

*Validation:* `npm run lint` passed; `npm test` passed **1,545 tests across 167
files**; `npm run build` passed with only the pre-existing generated-CSS,
mixed static/dynamic import, and large-chunk warnings. Browser verification used
the local application with the deployed public snapshot at 1,440 px and 390 px:
PRD, Assets, Screens filters, screen detail, Mockups, Design System history,
Data Model, and Implementation Plan remained explorable; mutation controls were
absent; the 390 px journey had no horizontal overflow. The browser declined the
final ordinary-project/console-inspection leg, so ordinary-project parity is
supported by the passing store/component tests rather than claimed as a browser
result.

*Commits:* `9730d65` (`refactor(demo): add centralized project capabilities`),
`63887ce` (`fix(demo): prevent persistent mutations in public projects`), and
`fdd3aed` (`test(demo): cover read-only capability enforcement`).

*Deliberately deferred:* Reset Demo, clearing only the local demo namespace,
automatic baseline restoration after earlier cache corruption, image-manifest
validation, and the full committed Playwright demo contract. Those remain the
follow-up needed to close the remaining portion of SYN-001.

## [SYN-002] A cold direct demo URL does not hydrate the demo project

**Status: ✅ Resolved — 2026-07-10, PR [#267](https://github.com/TGALLOWAY1/Synapse/pull/267) (`fix(demo): hydrate public demo at route boundary`, commit `59a92d5`). See the Resolution block at the end of this finding.**

**Labels**

- Importance: P1 — High
- Bug severity: S2 — Significant
- Effort: S
- Confidence: High
- Category: Reliability
- Scope: Cross-component
- Change type: Fix

**Observed evidence**

`ProjectRoute()` special-cases `DEMO_PROJECT_ID` only to render `ProjectWorkspace` (`src/App.tsx:89-98`). It does not call `loadDemoProject()`. Hydration occurs only in the demo-button handlers in `LoginPage` and `HomePage`. On a new browser, `ProjectWorkspace` cannot find the project and follows its missing-project recovery path back to `/` (`src/components/ProjectWorkspace.tsx:161-173`). This is a deterministic code-path trace. The browser tool later blocked an additional cold-context navigation, so this exact case was not claimed as a second runtime reproduction.

**Why it matters**

Bookmarks, shared recruiter links, refreshes after storage clearing, and external campaign links can fail even though the demo route is intentionally public. The stable demo URL is not actually a self-contained entry point.

**Likely root cause**

Data loading is coupled to CTA event handlers rather than route ownership. The route assumes a cache precondition it does not establish.

**Concrete recommendation**

Move demo hydration into a route-level loader component/hook that owns loading, unavailable, retry, and success states. Keep the entry buttons as navigation only. Ensure the workspace mounts only after hydration succeeds. Do not add a second demo store.

**Acceptance criteria**

- Opening `/p/<DEMO_PROJECT_ID>` in a clean browser loads the demo.
- Refreshing that URL works with and without a cache.
- Snapshot unavailable/network failure produces a useful retry/return state, not a silent bounce.

**Dependencies and risks**

Coordinate with SYN-001 so hydration can reset/validate the demo baseline. Avoid double fetches under React Strict Mode.

**Suggested validation**

Playwright tests in clean contexts for direct link, cached refresh, unavailable pointer, retry, and browser back/forward.

**Resolution (2026-07-10 — PR [#267](https://github.com/TGALLOWAY1/Synapse/pull/267), commit `59a92d5`, branch `claude/demo-route-hydration-jyalya`)**

Implemented exactly along the recommended shape — a route-level loader that owns
the complete initialization contract, with no second demo store and no
duplicated snapshot-restoration logic:

- **`src/components/DemoRouteGate.tsx` (new).** `App.tsx`'s `ProjectRoute` now
  wraps the demo branch in `DemoRouteGate` (and is exported for route tests).
  The gate calls the existing store action `loadDemoProject()` and mounts
  `ProjectWorkspace` **only after** hydration reports the demo available, so
  the workspace's missing-project recovery path (`ProjectWorkspace.tsx`
  "Project not found" toast + bounce to `/`) can no longer fire for the demo.
  While restoring it renders an accessible `role="status"` "Loading demo
  project…" state; on failure (`available: false` with no cache, or a thrown
  restore error) it renders a `role="alert"` "Unable to load demo" state with
  **Retry** (re-enters the loading phase and re-runs hydration) and **Return
  home** (Link to `/`) — never a silent redirect.
- **`src/lib/demoRouteHydration.ts` (new).** A module-level single-flight
  wrapper (`hydrateDemoProject()`) so React Strict Mode's double effect
  invocation shares ONE `loadDemoProject()` pass — the audit's "avoid double
  fetches under Strict Mode" risk. The in-flight promise clears on settle, so
  Retry and later remounts (back/forward) run a fresh pass; the store's
  pointer probe keeps a repeat pass cheap when the cache is current.
- **Namespace-switch guard (new behavior, discovered during the fix).** The
  gate waits for the auth session to settle (`authStore.loading === false`)
  before hydrating: `authStore.setUser` → `applyProjectUser` wipes and
  rehydrates the project store's localStorage namespace, which would discard a
  demo restored mid-transition. The old button-only flow never raced this
  (buttons were clickable only after session resolution); a direct URL load
  does.
- **Entry buttons are navigation-only.** The `LoginPage`/`HomePage` demo
  button handlers no longer call `loadDemoProject()` (their spinner state and
  failure toasts were removed); they `navigate('/p/<DEMO_PROJECT_ID>')` and
  the route loader is the single source of truth.
- **Cache/freshness policy is untouched.** All decisions stay inside
  `loadDemoProject()` (`src/store/slices/projectSlice.ts`): pointer match →
  reuse cache; missing cache → fetch + restore; stale pointer → re-fetch and
  overwrite; failed fetch with a known-valid cache → keep serving the cache.
- **Docs.** `CLAUDE.md`'s demo section now documents the route-owned rule
  ("do not re-add `loadDemoProject()` calls to button handlers").

*Acceptance criteria:* all three met — clean-browser direct URL loads the
demo; refresh works with and without a cache; failure produces the explicit
retry/return state instead of a bounce.

*Validation:* committed **Vitest** suites rather than a committed Playwright
suite (the audit's Batch 1 brief excluded adding an application-wide
Playwright suite): `src/components/__tests__/DemoRouteGate.test.tsx` (cold
load, valid cache, stale pointer, snapshot failure, restore-throw,
pointer-probe failure over cache, Retry, Return home, Strict Mode
single-pass, auth-settle guard) and
`src/components/__tests__/DemoEntryRouting.test.tsx` (route-boundary
hydration, ordinary-project routing signed in/out, Login/Home button
navigation). The suggested browser scenarios were additionally verified with
an ad-hoc Playwright script against the dev server (API mocked at the network
layer): direct link, warm refresh, cleared-storage refresh, stale pointer,
failure → Retry → Return home, both entry pages, back/forward, desktop +
390 px mobile — 22/22 checks. `npm run lint` / `npm test` (1,533 tests) /
`npm run build` all passed.

*Deliberately out of scope (still open):* the SYN-001 read-only/reset policy
(the gate is the natural place to later validate/reset the demo baseline —
the coordination point this finding's "Dependencies and risks" anticipated);
the SYN-006 committed E2E demo contract; SYN-003 image-completeness handling
(an `imagesComplete: false` partial restore still opens by design, and the
gate surfaces no indicator for it — recorded as a follow-up in PR #267).

## [SYN-003] Mockup “Generated” status does not require an actual image

**Labels**

- Importance: P1 — High
- Bug severity: S2 — Significant
- Effort: M
- Confidence: High
- Category: Demo
- Scope: Cross-artifact
- Change type: Fix

**Observed evidence**

The demo’s Document Library mockup says the primary Desktop/Default variant is “Generated” and coverage is aligned, yet no image is displayed. The view instead warns that GPT Image 2 has no OpenAI key and asks the visitor to create/upload an image ([desktop](./screenshots-2026-07-10/06-demo-mockup-view-desktop-1440.png), [mobile](./screenshots-2026-07-10/15-demo-mockup-missing-image-mobile-390.png)). `loadDemoSnapshotPublic()` tolerates failed image downloads and returns `imagesComplete: false` (`src/lib/snapshotClient.ts:486-517`); `loadDemoProject()` restores that partial snapshot anyway. Separately, `buildVariant()` defines `legacyGenerated` from the existence of `item.mockupScreen`, not the image store (`src/lib/mockupVariants.ts:296-310`), and `hasImage` repeats that assumption at line 346.

**Why it matters**

The demo makes a falsifiable success claim while displaying a failure state. Coverage metadata is also spec-to-spec, not visual verification, making “aligned” look more authoritative than it is. This is one of the clearest signals that the demo is a development shortcut rather than a curated product story.

**Likely root cause**

Generation specification, image presence, coverage metadata, and snapshot transport completeness are modeled as loosely related signals. The UI treats a legacy spec slot as proof of image generation.

**Concrete recommendation**

Make actual image presence a requirement for `generated`, with one authoritative image/status model. Delete `legacyGenerated` and overlapping legacy/screen/variant representations where they are not needed by the intended application; consolidate them if that makes the model simpler. Regenerate or repin the public demo, invalidate old demo caches, clear development IndexedDB/localStorage, and rewrite fixtures/seeded data to the canonical representation. Reject incomplete snapshots rather than indefinitely supporting partial legacy shapes; remove obsolete mockup specs with no active consumer. At demo pin time validate a required-image manifest; at runtime retain a known-complete current-format cache or show one honest degraded state.

**Acceptance criteria**

- Every demo variant labeled “Generated” renders an image.
- Failed image hydration cannot overwrite a known-complete cached demo.
- Coverage copy identifies whether it is manifest/spec evidence or visual verification.
- Pinning an incomplete demo snapshot fails with actionable owner feedback.

**Dependencies and risks**

Image records span legacy mockup, screen, and variant stores. First identify the current demo and generation consumers, then replace the overlapping model in one focused change. No migration is warranted for obsolete local records.

**Suggested validation**

Unit-test status derivation with spec/no image, image/no sidecar, and complete records. Integration-test partial snapshot fallback. E2E-test that every visible “Generated” primary demo card has a rendered image.

## [SYN-004] Legacy Design System Markdown permits unsanitized raw HTML

**Labels**

- Importance: P1 — High
- Bug severity: S2 — Significant
- Effort: S
- Confidence: High
- Category: Security
- Scope: Cross-component
- Change type: Fix

**Observed evidence**

`FallbackMarkdown` passes generated/restored Design System Markdown through `react-markdown` with `rehypeRaw` and no sanitizer (`src/components/renderers/DesignSystemRenderer.tsx:711-721`). The preprocessing function injects raw `<span data-hex>` HTML (`:461-466`), and the fallback component forwards other span properties (`:481-487`). A local render probe confirmed malicious input survives as an `iframe` with `srcdoc`. `vercel.json` allows same-origin frames and includes `'unsafe-inline'` in `script-src`, increasing the impact of script-capable raw content. The official `react-markdown` guidance describes raw HTML as dangerous for untrusted content and recommends sanitization; `rehype-sanitize` recommends sanitizing after unsafe transforms: [react-markdown security guidance](https://github.com/remarkjs/react-markdown#security), [rehype-sanitize](https://github.com/rehypejs/rehype-sanitize).

**Why it matters**

LLM output, legacy persisted artifacts, or imported snapshots can create active or deceptive same-origin content. Even if current CSP behavior limits one payload, arbitrary HTML can still produce phishing UI, unwanted frames, tracking requests, or a future exploitable combination.

**Likely root cause**

Raw HTML was enabled to render hex swatches, broadening the trust boundary for a narrow presentation feature.

**Concrete recommendation**

Remove `rehypeRaw` and the `rehype-raw` dependency. Tokenize hex values into React nodes/components without converting the whole Markdown document to trusted HTML. Render all source HTML as text/omit it under `react-markdown` defaults. Sanitization is a fallback only if a demonstrated product requirement truly needs a restricted HTML subset.

**Acceptance criteria**

- `<script>`, `<iframe>`, `srcdoc`, event handlers, and raw `<img>` HTML cannot create DOM elements from artifact content.
- Hex swatches still render.
- The current canonical seeded Design System and demo remain readable.

**Dependencies and risks**

Prefer deletion: remove the legacy Markdown fallback entirely when it has no intended current consumer, remove `rehypeRaw`/`rehype-raw`, delete obsolete raw-HTML fixtures, and convert the canonical seed/demo to structured data. Do not retain intentional raw HTML from development snapshots. If a current canonical path still requires fallback rendering, keep only a safe non-raw renderer.

**Suggested validation**

Renderer tests with malicious HTML and safe hex-token visualization, plus a browser CSP regression test. Validate the canonical demo rather than preserving old raw-HTML snapshots.

## [SYN-005] Two freshness engines can give the same artifact incompatible statuses

**Labels**

- Importance: P1 — High
- Bug severity: S2 — Significant
- Effort: M (broad call sites; no data migration)
- Confidence: High
- Category: State model
- Scope: Cross-artifact
- Change type: Consolidate

**Observed evidence**

`getArtifactStaleness()` returns only `current`, `possibly_outdated`, or `outdated` based on current-version existence, the referenced PRD, and a mockup token hash (`src/store/slices/stalenessSlice.ts:10-57`). Artifact headers, Screens controls, Project readiness counts, and exports call this getter. `evaluateDependencyGraph()` separately returns `up_to_date`, `needs_update`, `update_recommended`, `missing`, `error`, or `generating`; it checks both PRD drift and every hard upstream artifact version (`src/lib/artifactDependencyGraph.ts:413-556`). Dependency Graph and the Finalize/Update Assets plan use the richer evaluator. Therefore, if `data_model` is regenerated without a new PRD, an existing Implementation Plan can remain “Current” in its header/export while the graph correctly says its dependency changed and it “Needs update.”

**Why it matters**

Freshness is a core trust promise. Contradictory labels make users unsure which artifact is safe to act on and make downstream automation depend on which helper a component happened to import.

**Likely root cause**

The earlier spine-only model remained in the store after a richer graph evaluator was introduced. Presentation and workflow call sites were not migrated together.

**Concrete recommendation**

Replace both freshness implementations with one canonical evaluator. Change internal status types and persisted metadata shapes freely, migrate all consumers together where that is safer than transitional adapters, and delete `stalenessSlice`, obsolete selectors, duplicate mappings, timestamp-only provenance handling, and manual “mark current” behavior when they do not fit the desired model. Rewrite project fixtures, provenance, and seeded artifacts; reset local development projects on schema change. Characterization tests define desired canonical behavior, not contradictory historical behavior.

**Acceptance criteria**

- Header, export, graph, Screens metadata, readiness, and update plan derive from the same evaluation result.
- Regenerating a hard dependency changes all relevant surfaces consistently.
- One documented status vocabulary maps system evidence separately from user review/readiness.

**Dependencies and risks**

This touches gating and regeneration decisions. Retain the mockup token/design-system dependency rules and the distinction between system freshness, user review, and implementation readiness. The risk is broad call-site behavior, not migration: use focused commits and characterization tests, then make the coordinated cutover.

**Suggested validation**

Table-driven tests for PRD drift, hard-dependency drift, identical token regeneration, missing refs, manual mark-current, and in-flight/error jobs; one integration test should assert all consuming surfaces agree.

## [SYN-006] There is no end-to-end contract protecting the public demo

**Labels**

- Importance: P1 — High
- Bug severity: N/A — Not a bug
- Effort: M
- Confidence: High
- Category: Testing
- Scope: Application-wide
- Change type: Test

**Observed evidence**

The suite has strong unit coverage and all 1,495 tests pass, yet three major demo defects coexist. `loadDemoProject.test.ts` validates pointer/cache behavior and explicitly accepts `imagesComplete: false`; it does not mount the route/workspace or verify images. `TourPage.test.tsx` covers initial mode, arrows, and returning mode. `scripts/capture-demo-screenshots.mjs` captures pixels but does not fail on semantic contradictions. There is no E2E config or command.

**Why it matters**

The demo is a cross-layer contract: route hydration, public snapshot API, IndexedDB restoration, derived statuses, responsive UI, and mutation isolation. Unit tests cannot prove those pieces compose correctly. This gap allowed a fully green suite while the primary mockup was missing and the demo could be persistently broken.

**Likely root cause**

Test investment is concentrated in pure domain/store behavior and renderer fragments; screenshot tooling was not turned into a small assertion-driven release gate.

**Concrete recommendation**

Add a minimal Playwright suite using the already-installed dependency. Protect the canonical implementation: cold direct demo entry, current-format cached refresh, read-only behavior, real images behind every `Generated` status, navigation through PRD/Screens/Data Model/Plan/history, no console errors, honest incomplete current-format image hydration, and no horizontal overflow on desktop or mobile. Regenerate deterministic E2E fixtures and replace old demo snapshots/caches as schemas change; test only supported formats. Keep visual snapshots sparse and stable; prefer semantic assertions.

**Acceptance criteria**

- One command runs the demo E2E contract locally/CI.
- Tests use a deterministic pinned fixture or validated deployed snapshot.
- Console errors, route bounce, missing generated images, persistent mutation, and horizontal page overflow fail CI.

**Dependencies and risks**

Implement after the canonical demo fixture is available; do not add compatibility tests for intentionally invalidated caches/snapshots. Avoid testing third-party LLM generation.

**Suggested validation**

Run the suite in clean and cached contexts at 1,440 and 360 px; repeat several times to expose snapshot/image races.

## [SYN-007] Authentication inputs have no programmatic labels or error associations

**Labels**

- Importance: P1 — High
- Bug severity: N/A — Not a bug
- Effort: S
- Confidence: High
- Category: Accessibility
- Scope: Local
- Change type: Fix

**Observed evidence**

Name, email, and password fields in `src/components/LoginPage.tsx:227-302` use icons and placeholders only. There are no `<label>` elements, `aria-label`, or `aria-labelledby` values. Validation messages are visual `<p>` elements without `id`/`aria-describedby`; invalid inputs do not expose `aria-invalid`. Placeholders disappear after typing and are not a label substitute.

**Why it matters**

The authentication form is the entrance to every non-demo workflow. Screen-reader users cannot reliably identify fields or associate errors with them. Voice-control targeting is also weakened. This is a definite accessibility failure on a core path, not a stylistic preference.

**Likely root cause**

The visual design treated placeholder text and icons as the field-label system without a semantic equivalent.

**Concrete recommendation**

Add explicit labels (visually hidden if the design must remain unchanged), stable IDs, `aria-invalid`, and `aria-describedby` for field-specific errors. Use an announced form-level error for server failures. Preserve autocomplete attributes and visible focus styles.

**Acceptance criteria**

- Every input has a stable accessible name before and after typing.
- Invalid fields expose error state and reference their message.
- Submission/server errors are announced once and focus moves appropriately when needed.

**Dependencies and risks**

Low visual risk. Ensure tab switching does not leave stale error references.

**Suggested validation**

Testing Library `getByRole('textbox', {name: ...})` assertions, keyboard-only sign-in/sign-up, and VoiceOver or NVDA verification of invalid submissions.

### P2 — Medium

## [SYN-008] The tour and live demo tell incompatible product stories

**Labels**

- Importance: P2 — Medium
- Bug severity: S3 — Moderate
- Effort: M
- Confidence: High
- Category: Content or copy consistency
- Scope: Cross-component
- Change type: Clarify

**Observed evidence**

The entry page gives “Take the tour” and “Demo project” similar prominence without explaining the difference. The tour uses a musician-product narrative, shows a rich v1–v4 history, and ends with all five artifacts current ([tour final](./screenshots-2026-07-10/21-interactive-tour-final-mobile-390.png)). The live demo is “AI Learn Graphics V2,” exposes only Version 1 in its history ([history](./screenshots-2026-07-10/09-demo-version-history-desktop-1440.png)), and contains a legacy/unverified missing mockup. Both surfaces are individually understandable, but they do not reinforce one coherent “idea to connected artifacts” story.

**Why it matters**

Visitors must mentally restart when moving from tour to demo, and the polished fictional history makes the real workspace look less complete. The current CTA hierarchy does not help visitors choose between a short guided explanation and an open-ended example.

**Likely root cause**

Tour content and pinned demo content evolved independently and are released on different update paths.

**Concrete recommendation**

Choose one canonical example dataset/story for both surfaces, or explicitly label them as different examples and explain their purposes (“2-minute guided tour” versus “Explore a complete example project”). Pin a demo with multiple meaningful revisions and complete images. Do not add more onboarding layers.

**Acceptance criteria**

- CTA labels state format/time/value.
- Names, artifact counts, version claims, and final status are internally consistent within and across the chosen story.
- The first demo screen suggests a short recommended navigation path without blocking exploration.

**Dependencies and risks**

Depends on demo stabilization and snapshot validation. Content changes should not hard-code logic around one fixture.

**Suggested validation**

Five-user comprehension check: ask what each CTA does, what changed between versions, and whether all artifacts are complete; repeat desktop/mobile screenshot review.

## [SYN-009] The Flow filter causes horizontal overflow at 360 px

**Labels**

- Importance: P2 — Medium
- Bug severity: S3 — Moderate
- Effort: XS
- Confidence: High
- Category: Mobile
- Scope: Local
- Change type: Fix

**Observed evidence**

At a 360 px viewport the Screens page shows a bottom horizontal scrollbar and clips the Flow select’s right edge ([screenshot](./screenshots-2026-07-10/12-demo-screens-overview-mobile-360.png)). Its measured select box extended from x=16 to approximately x=413. `ScreenListView` wraps the control row, but `SelectControl` (`src/components/experience/ScreenListView.tsx:382-404`) gives the native select no `min-w-0`, `max-w-full`, or constrained mobile width. A long seeded flow option controls intrinsic width.

**Why it matters**

The narrowest supported mobile surface becomes harder to scan and can shift the whole page laterally. Long generated names make this a real product-data case, not a contrived CSS string.

**Likely root cause**

Wrapping was applied to the parent without constraining the intrinsic width of native form controls.

**Concrete recommendation**

Make the label/select `min-w-0 max-w-full`; use a bounded width or full-width first row on narrow screens, and truncate the selected display where the browser permits. Preserve the accessible label and native selection behavior.

**Acceptance criteria**

- `document.documentElement.scrollWidth <= clientWidth` at 320/360/390/430 px with very long flow names.
- Both filters remain visible, keyboard-accessible, and comfortable to tap.

**Dependencies and risks**

Native select rendering varies by platform; test Safari/iOS as well as Chromium.

**Suggested validation**

Component fixture with a 100-character flow name plus E2E width assertions and mobile screenshots.

## [SYN-010] User content edits mutate an existing artifact version in place

**Labels**

- Importance: P2 — Medium
- Bug severity: S2 — Significant
- Effort: L
- Confidence: High
- Category: Versioning
- Scope: Cross-artifact
- Change type: Redesign existing behavior

**Observed evidence**

Screen and legacy prompt edits call `updateArtifactVersionMetadata()` from `ArtifactWorkspace`. The store maps over the current versions and patches the same record’s metadata (`src/store/slices/artifactSlice.ts:397-410`). It can append an `Edited` history event, but that event points to the unchanged `artifactVersionId` (`:416-433`). The prior edit value is therefore not recoverable or comparable. Review/checklist/progress overlays also use metadata, but they have different versioning semantics from content edits.

**Why it matters**

Users see a history entry without an immutable historical state. A later edit rewrites what the earlier event refers to, weakening comparisons, reverts, auditability, and the product promise that edits participate in version history.

**Likely root cause**

Metadata became a convenient shared persistence channel for both content customization and mutable workflow state.

**Concrete recommendation**

Redesign `ArtifactVersion` around the explicit boundary: content-changing screen/prompt edits append immutable, comparable, restorable revisions, while review state, checklist progress, dismissals, and similar workflow state live in a separately mutable keyed record. Avoid versioning every checkbox. Invalidate development project data, delete the mixed metadata representation, and rebuild canonical demo/test projects under the new model instead of adding compatibility adapters or a migration for obsolete local projects.

**Acceptance criteria**

- Two content edits produce two restorable/compareable states.
- Revert never changes historical records.
- Review/progress changes do not create noisy content versions.
- History events resolve to the exact state they describe.

**Dependencies and risks**

Requires a product decision about what counts as content. Preserve current sync, project isolation, exports, and screen joins under the new schema; rewrite their canonical fixtures and contracts. Migration complexity is not a risk because there is no production data.

**Suggested validation**

Store tests for edit/edit/compare/revert; new canonical fixtures; cross-device sync conflict tests; and a UI journey through screen edit history.

## [SYN-011] The anonymous entry route downloads a 576 kB gzip application bundle

**Labels**

- Importance: P2 — Medium
- Bug severity: N/A — Not a bug
- Effort: M
- Confidence: High
- Category: Performance
- Scope: Application-wide
- Change type: Refactor

**Observed evidence**

The production build reports one main JS asset of 1,968.35 kB minified / 575.88 kB gzip and warns that it exceeds 500 kB. `src/App.tsx:5-16` statically imports the project workspace, tour, metrics, developer trace, admin, privacy, and supporting route trees. Only smaller tour internals are split. Thus a signed-out visitor pays for much of the workspace before choosing a tour or demo. No runtime CPU profile was taken, so this finding is limited to measured transfer/build structure.

**Why it matters**

The login/demo acquisition surface is sensitive to mobile network latency. It also makes any large workspace dependency affect every route’s cache and startup cost.

**Likely root cause**

Route components were added as direct imports without a route-level lazy boundary.

**Concrete recommendation**

Use `React.lazy`/`Suspense` at route boundaries, starting with ProjectWorkspace, developer/admin, metrics, tour, and privacy. Keep the entry/auth shell and global error/toast infrastructure eager. Do not micro-split individual icons or small controls until measurements justify it.

**Acceptance criteria**

- Entry route no longer downloads workspace/developer route chunks before navigation.
- Main initial gzip size drops materially; record before/after build artifacts.
- Route transitions show a stable accessible loading shell and recover from chunk-load failure.

**Dependencies and risks**

Chunking can expose circular imports or loading flashes. The `toastStore`/`llmProvider` mixed imports should be cleaned only where needed for real splits.

**Suggested validation**

Build chunk comparison, browser network trace on cold login and demo navigation, and slow-4G interaction screenshots. Set a pragmatic initial-route budget after the first split.

## [SYN-012] Workspace components combine orchestration, domain derivation, and presentation

**Labels**

- Importance: P2 — Medium
- Bug severity: N/A — Not a bug
- Effort: XL (staged)
- Confidence: High
- Category: Architecture
- Scope: Cross-component
- Change type: Refactor

**Observed evidence**

`ArtifactWorkspace.tsx` is 1,782 lines and `ProjectWorkspace.tsx` is 1,473. `DependencyGraphView.tsx` is 1,012; Screen Detail/List are 875/846. The two workspace files coordinate navigation, jobs, provenance, image lookup, status calculation, modal state, mutation handlers, and rendering. Both call `useProjectStore()` without a selector and destructure many functions; numerous other components do the same. Whole-store subscriptions can re-render these large coordinators on unrelated progress/state updates. No React profiler capture was made, so rerender cost is a maintainability/performance risk, not a measured latency claim.

**Why it matters**

Cross-cutting changes such as demo read-only behavior and freshness semantics require edits in large, coupled files. Broad subscriptions also make future performance regressions difficult to locate.

**Likely root cause**

Product workflows accumulated in page components while pure domain helpers evolved beside them; controller boundaries and narrow selectors did not keep pace.

**Concrete recommendation**

Refactor incrementally around demonstrated seams: route/demo loader, finalize/update-plan controller, artifact-health selector, and per-artifact view models. Replace whole-store hooks with narrow selectors and shallow comparison. Keep pure derivation in existing `src/lib` modules. Do not create a generic framework or rewrite the store. Incremental commits are for reviewability and regression isolation—not rollout or preservation of historical records.

**Acceptance criteria**

- Workspace components primarily compose view models and views.
- A progress update does not rerender unrelated artifact trees (verified with Profiler).
- Demo/freshness rules have one call path rather than branches across render code.
- Existing behavior and tests remain intact per extraction commit.

**Dependencies and risks**

High regression surface; execute after correctness tests for demo and freshness. Effort is XL only as a program—each extraction should be S/M.

**Suggested validation**

React Profiler before/after representative generation and navigation; selector tests; existing suite plus demo E2E after every seam extraction.

## [SYN-013] The documented local workflow no longer runs the authenticated product

**Labels**

- Importance: P2 — Medium
- Bug severity: N/A — Not a bug
- Effort: S
- Confidence: High
- Category: Developer experience
- Scope: Application-wide
- Change type: Clarify

**Observed evidence**

`CONTRIBUTING.md` says the PRD workspace “never touches” `api/`, needs no backend/`.env`, and runs with `npm run dev`. `docs/architecture.md` calls Synapse fully client-side with no backend database and lists three routes. Current `App.tsx` resolves `/api/auth/session` before rendering home; plain Vite cannot serve it, so local `/` shows “Couldn’t reach the server.” The code now includes authentication, Mongo persistence, provider vaults, snapshots, Blob images, and more routes. The README badge says 838 tests while the clean suite has 1,495.

**Why it matters**

A new contributor following canonical docs cannot reach the main workspace and may misdiagnose correct auth behavior as a regression. Architecture decisions are made against an obsolete system description.

**Likely root cause**

Documentation remained tied to the original local-only SPA while backend/auth/sync features were added incrementally.

**Concrete recommendation**

Replace obsolete architecture/setup descriptions with the current system map and make one intended-stack workflow canonical. Document the command that serves both frontend and `/api` functions (likely `vercel dev`) and required environment categories; explicitly label `npm run dev` as tour/static-frontend-only if retained. Update route/test counts. Avoid duplicating setup instructions or preserving outdated setup paths for compatibility.

**Acceptance criteria**

- A clean clone following one guide can open the authenticated product and public tour/demo.
- Architecture docs name auth, local/cloud persistence, images, snapshots, provider boundaries, and conflict handling.
- Commands and test badge match package behavior.

**Dependencies and risks**

Verify the supported local backend command/env list on a clean machine before publishing; do not copy secrets or imply Vite proxies that do not exist.

**Suggested validation**

Time a clean-clone setup by someone unfamiliar with the repo; run every documented command verbatim.

## [SYN-014] A mocked Linear provider reports fake production success

**Labels**

- Importance: P2 — Medium
- Bug severity: S3 — Moderate
- Effort: XS
- Confidence: High
- Category: UI/UX
- Scope: Cross-component
- Change type: Delete

**Observed evidence**

`src/lib/services/taskExport/linearExporter.ts:91-115` registers `Linear (mocked)`, always reports ready, and returns successful `LIN-MOCK-*` external IDs without contacting Linear. The shipped task-conversion UI exposes this provider and reports that the result is mocked.

**Why it matters**

Honest labeling reduces deception, but simulated external success is still an avoidable development artifact in a product that emphasizes traceable handoff. It adds provider code, tests, and UI choice without completing a real workflow.

**Likely root cause**

A contract-preview stub remained registered after exporter architecture work.

**Concrete recommendation**

Remove Linear from the production provider registry and delete the fake-success adapter. If the generated payload is useful, offer an explicitly local “Download Linear-ready JSON” export through the existing file export model, not a simulated integration.

**Acceptance criteria**

- No UI reports an external issue as created without a network response.
- GitHub/Markdown/current real exports remain unchanged.
- Linear contract builder is retained only if a real consumer or download path exists.

**Dependencies and risks**

Check analytics or product commitments before deletion. This does not require building a real Linear integration.

**Suggested validation**

Provider-registry unit test and task-export UI smoke test confirming only supported destinations appear.

## [SYN-015] Dependency advisories need routine upgrades, not emergency remediation

**Labels**

- Importance: P2 — Medium
- Bug severity: N/A — Not a bug
- Effort: S
- Confidence: Medium
- Category: Security
- Scope: Infrastructure or platform
- Change type: Fix

**Observed evidence**

`npm audit --json` reports 10 advisories: 2 low, 4 moderate, 4 high, none critical. Direct packages include React Router 7.13.1, UUID 13.0.0, PostCSS 8.5.6, and Vite 7.3.2; transitive findings include `undici`, Babel, `brace-expansion`, and `js-yaml`. The high React Router advisories target data/RSC/prerender/single-fetch paths not used by this `BrowserRouter` app. The UUID issue affects v3/v5/v6 buffer handling while the repository imports v4. Vite advisories are primarily Windows dev-server paths. These qualifications reduce current exploitability but do not justify leaving versions stale.

**Why it matters**

Untriaged advisories create noise and can become applicable as usage changes. Build/dev dependencies still affect contributors and CI.

**Likely root cause**

Normal package drift, including transitive ranges.

**Concrete recommendation**

Upgrade direct packages to patched compatible versions in one maintenance change, inspect lockfile changes, and document why currently non-applicable advisories are closed. Do not use `--force` across major versions or claim an active exploit without a reachable path.

**Acceptance criteria**

- Audit count is reduced to zero or remaining items have a dated, feature-specific rationale.
- Build, tests, demo E2E, and local dev pass on macOS and CI; Vite dev behavior is checked on Windows if supported.

**Dependencies and risks**

Router and Vite upgrades can alter behavior. `undici` fixes may depend on upstream `@vercel/blob`/jsdom releases.

**Suggested validation**

Record before/after `npm audit`, lockfile diff, full validation suite, and direct/deployed routing smoke tests.

### P3 — Low

## [SYN-016] Production build succeeds but emits invalid generated CSS and ineffective split hints

**Labels**

- Importance: P3 — Low
- Bug severity: S4 — Minor
- Effort: XS
- Confidence: High
- Category: Developer experience
- Scope: Local
- Change type: Fix

**Observed evidence**

Tailwind scans regex literals `[-:|\s]` in `dataModelMarkdown.ts` and emits an invalid arbitrary-property rule. Vite reports the parse warning but completes the build. It also warns that dynamic imports of `toastStore` and `llmProvider` cannot split because those modules are statically imported elsewhere.

**Why it matters**

Warnings normalize noise and can hide future build regressions. The invalid rule is not product CSS, but it is shipped output.

**Likely root cause**

Tailwind’s broad content scanner interprets source regex text as a class candidate; mixed import styles imply splitting that does not happen.

**Concrete recommendation**

Move/express the regex so Tailwind does not recognize an arbitrary-property token, or add the narrowest supported blocklist. Make the two imports consistently static unless route splitting proves a dynamic boundary useful.

**Acceptance criteria**

- Build emits neither warning and generated CSS contains no `-: |\s` declaration.
- Markdown parsing behavior and toast/provider loading are unchanged.

**Dependencies and risks**

Avoid broad scanner exclusions that could remove real classes.

**Suggested validation**

Production build plus focused data-model Markdown tests and a grep of emitted CSS.

## [SYN-017] Tour progress controls use incomplete tab semantics and undersized targets

**Labels**

- Importance: P3 — Low
- Bug severity: N/A — Not a bug
- Effort: S
- Confidence: High
- Category: Accessibility
- Scope: Local
- Change type: Standardize

**Observed evidence**

`TourNav` marks every progress-dot button as `role="tab"` with `aria-selected`, but all remain in the default tab order and there are no `aria-controls`/tabpanel relationships (`src/components/tour/TourNav.tsx:37-64`). On mobile, inactive buttons measured about 10×26 px with centers roughly 18 px apart; this does not provide a 24×24 standalone target and makes six dots fiddly. The large previous/next buttons are good.

**Why it matters**

The control announces a tab pattern without implementing its expected keyboard model, and the tiny direct-step targets are uncomfortable on touch. This is contained because previous/next alternatives work.

**Likely root cause**

Visual progress indicators were upgraded into clickable controls without completing either tab semantics or target sizing.

**Concrete recommendation**

Either implement a real tablist (roving `tabIndex`, arrow keys, controlled tabpanel) or use ordinary named buttons/list semantics. Give each direct-step control at least a 24×24 hit area without overlap, preserving the small visual dot inside.

**Acceptance criteria**

- Screen readers receive an accurate pattern.
- Keyboard interaction follows that pattern.
- Target boxes meet WCAG 2.2 minimum size/spacing and remain visually compact.

**Dependencies and risks**

Changing semantics may require adjusting TourPage headings/focus after step changes.

**Suggested validation**

Keyboard/VoiceOver pass, Testing Library role assertions, and 360 px target-box measurement.

## [SYN-018] A disabled “Forgot password?” control advertises a nonexistent workflow

**Labels**

- Importance: P3 — Low
- Bug severity: S4 — Minor
- Effort: XS
- Confidence: High
- Category: Simplification
- Scope: Local
- Change type: Delete

**Observed evidence**

The sign-in form renders a disabled “Forgot password?” button whose tooltip says reset is coming soon (`src/components/LoginPage.tsx:314-326`). `docs/auth.md` also records password reset as future work.

**Why it matters**

A dead recovery affordance is frustrating precisely when a user cannot sign in. It adds visual noise and creates a false expectation without offering recovery.

**Likely root cause**

Future-work UI shipped before the supporting auth flow.

**Concrete recommendation**

Remove the button until a real recovery workflow exists. Do not replace it with another disabled placeholder.

**Acceptance criteria**

- The sign-in page contains only actionable controls.
- No documentation implies password reset is available.

**Dependencies and risks**

Confirm there is no support process that relies on the visible wording.

**Suggested validation**

Login screenshot and accessible-controls smoke test.

### P4 — Optional

No separate P4 recommendation is warranted. Lower-value cleanup is recorded below rather than inflated into findings.

## 5. View Demo audit

### Entry and initialization

The entry page is visually polished and makes both a guided tour and an open demo available without authentication. Loading feedback is clear—the CTA changes to “Loading demo…” with a spinner while the page remains stable ([capture](./screenshots-2026-07-10/17-demo-loading-mobile-390.png)). The hierarchy is ambiguous, however: both CTAs appear like equivalent routes into the same story, and neither states expected duration or level of freedom. More importantly, the demo’s stable route is not self-hydrating (SYN-002).

### Content and navigation

The artifact sidebar communicates the intended workflow well. Screens, Data Model, and Implementation Plan show substantial connected content rather than empty shells. The Data Model’s desktop entity graph/table and its mobile cards are especially effective; Implementation Plan also preserves readable hierarchy on mobile. Screen detail’s Overview/Flow/Mockups tabs make the path from product intent to UI artifact understandable.

The story breaks at the mockup: a “Generated” primary variant has no image and asks the anonymous viewer for an OpenAI key. Version history contains only Version 1, so the product’s version/diff/downstream-impact value is asserted by the tour rather than demonstrated by the actual workspace. The demo banner focuses on API-key limitations instead of telling visitors what to explore.

### Visual and mobile quality

At 1,440 px the workspace is dense but coherent. Core content generally has more visual weight than metadata. At 390–430 px the Data Model, Implementation Plan, screen detail, and mockup fallback are readable and well stacked. At 360 px the Screens Flow selector exceeds the viewport and creates page-level horizontal scroll (SYN-009). Some secondary controls remain compact, but only the tour progress targets were documented as a definite minimum-target issue.

### Reliability and data isolation

The public snapshot is isolated from server project/image sync by explicit `DEMO_PROJECT_ID` exclusions, so the audit found no path for an anonymous visitor to overwrite the owner’s pinned source. Local isolation is weaker: demo content is stored in the same Zustand structures and ordinary mutation handlers remain active. A visitor can corrupt their cached copy and no reset exists (SYN-001). Failure-tolerant image hydration prioritizes fresh partial data over a stale complete cache, which is an unsuitable trade for a curated public demo (SYN-003).

### Implementation boundary assessment

Demo-only checks appear in `App`, project/image sync, design setup, project workspace, generation paths, and data loaders. Many exclusions are individually sensible, but there is no single capability definition answering “what may an anonymous demo visitor do?” The correct simplification is a policy/route boundary reused by ordinary components—not a forked demo application.

### Recommended first fixes

1. Enforce read-only persistent state and add deterministic reset (SYN-001).
2. ~~Hydrate at the route boundary (SYN-002).~~ ✅ Done — PR [#267](https://github.com/TGALLOWAY1/Synapse/pull/267) (`DemoRouteGate`; see the SYN-002 Resolution block).
3. Reject/preserve against incomplete pinned image manifests and make status image-aware (SYN-003).
4. Add the small E2E demo contract (SYN-006).
5. Then align the tour/demo dataset and polish the first-screen path (SYN-008).

## 6. Simplification and deletion candidates

### Confirmed safe candidates

- **Delete `src/App.css`.** It is the untouched Vite starter stylesheet and has no import/reference in the source tree.
- **Delete the disabled “Forgot password?” UI** until recovery exists (SYN-018).
- **Remove `rehype-raw` and its package dependency** when implementing SYN-004. The only demonstrated need is internally injected hex spans, which can be rendered safely without raw HTML.
- **Remove the mocked Linear provider from the production registry** and delete fake external-success behavior (SYN-014). Retain only a pure payload builder if a real download/test consumer remains.
- **Remove ineffective dynamic-import indirection** for `toastStore`/`llmProvider` if route-splitting work confirms they must stay eager (SYN-016).

### Likely candidates requiring validation

- **`src/lib/services/prdPipeline.ts` compatibility shim.** Current imports appear primarily type-oriented while progressive generation owns implementation and a duplicate schema-version constant. Consolidate types/constants into the active module only after checking external/private imports and fixtures.
- **Expired Gemini model migration in `src/App.tsx:126-147`.** Confirm no current reachable path depends on it, then delete the sentinel block and retired banner-key sweep; telemetry/adoption is unnecessary for development-only state.
- **Legacy Design System fallback paths.** Check the canonical demo and current generation path. If neither needs it, delete the Markdown side, raw-HTML fixtures, and dual-renderer complexity; regenerate canonical structured data.
- **Repeated status badges/copy.** Once SYN-005 establishes canonical health, delete component-specific mapping tables and duplicate “current/outdated” derivation rather than wrapping them in another abstraction.

### Retain only with a concrete current consumer

- **Prompt Pack adapters and `implementationPlanAdapter`.** Retain: the current consolidated Implementation Plan consumes and presents Prompt Packs for implementation work (including its Prompts tab and supported export path). The deletion candidate is only obsolete standalone `prompt_pack` persistence compatibility after a direct check confirms it is not needed by canonical fixtures or exports.
- **Hidden `component_inventory`.** It is not visible, but mockup generation consumes it. `expandWithHiddenDependencyClosure()` prevents mockups from rebuilding against stale hidden data.
- **Image namespace/IndexedDB/Blob restore logic.** Retain its namespace isolation and current public-snapshot restore consumer; simplify representations freely after its current route/generation consumers are verified.
- **Project conflict/revision handling and pagehide/visibility persistence.** These protect local work and cross-device consistency; simplify only with equivalent failure tests.
- **Legacy stage migration in `onRehydrateStorage`.** Delete unless a current canonical fixture or reachable active path still emits a retired stage; reset development projects instead of a compatibility window.
- **Defensive partial-generation/safety gates.** These are user-visible reliability controls, not ornamental complexity.

## 7. Cross-cutting themes

| Theme | Evidence | Findings |
| --- | --- | --- |
| Demo is data, not yet a product boundary | CTA handlers hydrate; route does not; ordinary mutators stay active; sync exclusions are scattered; partial snapshots are accepted | SYN-001, 002, 003, 006, 008 |
| Status truth is fragmented | Spine-only freshness, graph freshness, readiness, review state, image/spec coverage, and sync status use different derivations and vocabularies | SYN-003, 005, 010 |
| Unit strength masks integration gaps | 1,495 tests pass while direct link, mutation persistence, missing generated images, and mobile overflow escape | SYN-001, 002, 003, 006, 009 |
| Version record has mixed semantics | Immutable generated content and mutable content/workflow overlays share `ArtifactVersion.metadata` | SYN-005, 010 |
| Page components became controllers | Large workspaces own state selection, business rules, derivation, network/generation coordination, modals, and rendering | SYN-001, 005, 012 |
| Acquisition paths need first-class constraints | Large eager bundle, ambiguous tour/demo story, inaccessible auth labels, and dead recovery control all affect the first visit | SYN-007, 008, 011, 018 |
| Documentation and shipped architecture diverged | Backend/auth/sync now gate the workspace, while canonical docs describe a three-route client-only app | SYN-013 |
| Compatibility must prove a current consumer | Hidden component inventory and image namespace isolation have identified current consumers; prompt-pack adapters and rehydrate migrations require direct verification, not hypothetical old projects | Simplification section |

The dominant systemic issue is not excessive feature count; it is that newer, richer product concepts were layered beside older helpers and boundaries. Consolidation should follow demonstrated semantic seams, with obsolete paths deleted after confirming no current consumer—not hidden behind more adapters.

## 8. Recommended execution sequence

### Phase 1 — Stabilize

**Findings:** SYN-001, SYN-002, SYN-003, SYN-004, SYN-006
**Expected outcome:** The public demo always opens, cannot be persistently damaged, never claims a missing image is generated, generated Markdown cannot create raw active HTML, and a CI-visible browser contract protects the canonical fixture.
**Estimated effort:** 6–9 engineering days total; parallelizable after policy decisions.  
**Dependencies:** Define demo persistent-vs-ephemeral capabilities; identify the canonical demo image manifest. Convert the canonical Design System directly; do not inventory obsolete local snapshots.
**Recommended commit boundaries:**

1. Raw Markdown security fix + renderer tests.
2. Route-owned demo loader and error/retry state.
3. Central demo capability policy + mutation guards.
4. Demo reset/cache policy.
5. Image-aware variant status + snapshot pin validation.
6. Semantic demo E2E suite against the new canonical snapshot.

### Phase 2 — Simplify

**Findings:** SYN-005, SYN-010, SYN-012, SYN-014, SYN-018; deletion candidates  
**Expected outcome:** One artifact-health truth, explicit version/workflow boundaries, fewer fake/dead paths, and smaller controller responsibilities.  
**Estimated effort:** 1.5–3 weeks staged; do not bundle unrelated refactors into one branch.
**Dependencies:** Characterization/E2E tests from Phase 1; content-versus-workflow versioning decision; canonical fixtures only.
**Recommended commit boundaries:**

1. Characterize both freshness engines.
2. Replace both freshness engines and update all consumers in one focused branch.
3. Delete `stalenessSlice`, duplicate mappings, and obsolete selectors.
4. Define immutable content revisions separately from workflow overlays; reset and rebuild development fixtures.
5. Extract finalize/update-plan and artifact-health controllers with narrow selectors.
6. Delete mocked Linear, dead auth affordance, and confirmed unused CSS.

### Phase 3 — Standardize

**Findings:** SYN-007, SYN-009, SYN-017 plus presentation work enabled by SYN-005  
**Expected outcome:** Shared semantics and responsive constraints across entry, filters, status displays, and tour controls.  
**Estimated effort:** 3–5 days.  
**Dependencies:** Canonical health vocabulary should be settled before widespread badge/header changes.  
**Recommended commit boundaries:**

1. Auth labels/error announcements.
2. Intrinsic-width/mobile filter constraints.
3. Tour progress semantics and targets.
4. Shared artifact-health presentation mapping.

### Phase 4 — Polish View Demo

**Findings:** SYN-008 and visual/content follow-through from SYN-001–003  
**Expected outcome:** Tour and demo tell one believable story, demonstrate multiple versions and complete artifacts, and guide the visitor without extra onboarding machinery.  
**Estimated effort:** 2–4 days after a stable snapshot pipeline.  
**Dependencies:** Demo read-only/reset, route hydration, and pin-time image validation must already be reliable.  
**Recommended commit boundaries:**

1. Canonical example content and multi-version snapshot.
2. CTA copy/hierarchy and first-screen recommended path.
3. Desktop/mobile screenshot review and content corrections.

### Phase 5 — Harden

**Findings:** SYN-011, SYN-013, SYN-015, SYN-016
**Expected outcome:** Cross-layer regressions fail CI, entry payload is materially smaller, local setup is reproducible, and maintenance warnings/advisories are controlled.  
**Estimated effort:** 5–8 days.  
**Dependencies:** Stable demo fixture; supported local backend command; baseline bundle/network measurements.  
**Recommended commit boundaries:**

1. Route-level lazy loading + accessible fallbacks.
2. Build-warning cleanup.
3. Dependency maintenance upgrade.
4. Canonical architecture/setup documentation and badge updates.

## 9. Priority matrix

| ID | Recommendation | Importance | Severity | Effort | Confidence | Category | Scope | Dependency |
| -- | -------------- | ---------: | -------: | -----: | ---------: | -------- | ----- | ---------- |
| SYN-001 | Enforce read-only demo policy and reset | P1 | S2 | M | High | Demo | Cross-component | Before demo polish |
| SYN-002 | Hydrate demo at route boundary | P1 | S2 | S | High | Reliability | Cross-component | Coordinate with 001 |
| SYN-003 | Replace image-status models; require complete canonical snapshot | P1 | S2 | S–M | High | Demo | Cross-artifact | Canonical manifest/current consumers |
| SYN-004 | Delete unsafe raw-HTML path; use structured canonical data | P1 | S2 | S | High | Security | Cross-component | Current renderer check |
| SYN-005 | Replace freshness engines with one evaluator | P1 | S2 | M | High | State model | Cross-artifact | Desired-behavior characterization |
| SYN-006 | Add semantic canonical-demo E2E contract | P1 | N/A | M | High | Testing | Application-wide | Canonical fixture after 003/004 |
| SYN-007 | Label auth fields and associate errors | P1 | N/A | S | High | Accessibility | Local | None |
| SYN-008 | Align tour/demo story and versions | P2 | S3 | M | High | Content consistency | Cross-component | Stable complete demo |
| SYN-009 | Constrain Screens filters on narrow widths | P2 | S3 | XS | High | Mobile | Local | None |
| SYN-010 | Redesign immutable content versions and workflow overlays | P2 | S2 | M–L | High | Versioning | Cross-artifact | Product decision/canonical fixtures |
| SYN-011 | Route-split eager application bundle | P2 | N/A | M | High | Performance | Application-wide | Baseline measurement |
| SYN-012 | Extract controllers and narrow Zustand selectors | P2 | N/A | XL | High | Architecture | E2E/characterization first |
| SYN-013 | Rewrite local setup and architecture docs | P2 | N/A | S | High | Developer experience | Verify supported command |
| SYN-014 | Remove mocked Linear fake success | P2 | S3 | XS | High | UI/UX | Product confirmation |
| SYN-015 | Apply scoped dependency upgrades | P2 | N/A | S | Medium | Security | Full regression suite |
| SYN-016 | Remove invalid CSS and ineffective split warnings | P3 | S4 | XS | High | Developer experience | Can join build work |
| SYN-017 | Correct tour progress semantics/targets | P3 | N/A | S | High | Accessibility | None |
| SYN-018 | Remove disabled password-reset affordance | P3 | S4 | XS | High | Simplification | None |

## 10. Top ten recommended actions

1. **Guarantee complete mockup imagery and truthful generated status (SYN-003).** Replace the overlapping model, regenerate the canonical demo, and invalidate obsolete development data. This removes the most damaging visible contradiction. Effort S–M.
2. **Remove raw HTML from Design System rendering (SYN-004).** Delete `rehype-raw` and obsolete fallback content, then render canonical structured data safely. This closes the clearest content-security boundary. Effort S.
3. **Add the canonical demo E2E release gate (SYN-006).** Once 003/004 establish the supported fixture, lock in cold entry, current-format caching, read-only behavior, imagery, navigation, and responsive behavior in CI. Effort M.
4. **Unify artifact freshness (SYN-005).** Replace both engines in a focused cutover, delete duplicate status layers, and use characterization tests to define the desired behavior. Effort M.
5. **Make demo persistence read-only and resettable (SYN-001).** A public visitor must not alter its cached product experience. Effort M.
6. **Make the demo URL self-hydrating (SYN-002).** Shared links must work from a clean browser. Effort S.
7. **Make content edits genuinely versioned (SYN-010).** Rebuild the canonical schema so history resolves to immutable content while workflow stays mutable. Effort M–L; no old-project migration.
8. **Fix authentication semantics (SYN-007).** The core sign-in path needs programmatic labels and announced errors. Primarily a fix; visible design can remain unchanged while assistive technology becomes usable. Effort S. Ship independently.
9. **Route-split the application (SYN-011).** The measured 575.88 kB gzip entry bundle is avoidably eager. Primarily a performance refactor; visible outcome is faster initial entry on constrained networks with stable loading shells. Effort M. Measure before/after.
10. **Align the tour and pinned demo into one complete story (SYN-008).** Once reliability is fixed, this produces the largest polish gain: meaningful multi-version history, complete artifacts, and clear CTA choice. Primarily polish/content; visible outcome is a coherent first impression. Effort M. Do last among the top ten so content is built on stable behavior.

The immediate order remains **SYN-003 → SYN-004 → SYN-006 → SYN-005** because it first makes the visible canonical demo truthful, then closes the concrete content-security boundary, locks those supported formats in a browser contract, and finally undertakes the broader freshness cutover with reliable regression coverage. The absence of users removes the need to delay any of these for migrations, telemetry, or compatibility windows.

---

This audit intentionally does not recommend a rewrite or a broad feature expansion. The strongest path is to make the existing connected-artifact workflow truthful and deterministic, consolidate the few duplicated domain concepts that can contradict each other, and put a thin cross-layer test boundary around the public story.
