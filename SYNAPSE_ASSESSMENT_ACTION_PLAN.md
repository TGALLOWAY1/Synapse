# Synapse Assessment Action Plan

## Executive Summary

The `SYNAPSE_CODEBASE_ASSESSMENT.md` identified 5 major issues and several secondary findings. This document records the validation results, what was fixed, what was deferred, and why.

**Result:** 8 validated findings fixed across 5 commits. 15 automated tests added. All lint errors resolved. Build, typecheck, lint, and tests now pass cleanly.

---

## Validated Findings

### Finding: Renderer fallback path is dead code
- **Assessment claim:** `ArtifactContentRenderer` compares a JSX element to null — the markdown fallback never executes.
- **Validation result:** Confirmed. `<StructuredRenderer content={content} />` returns a React element object (never null), so the `if (rendered !== null)` check is always true. The individual renderers (e.g., `ScreenInventoryRenderer`) correctly return null when content isn't JSON, but the dispatcher never sees that because JSX creation != component rendering.
- **Severity:** High
- **Confidence:** High
- **Root cause:** Misunderstanding of React's JSX evaluation model. `React.createElement()` returns an element descriptor, not the rendered output.
- **User impact:** When structured artifacts are stored as markdown (the common path — `generateCoreArtifact` converts JSON to markdown via `structuredArtifactToMarkdown`), the structured renderer would fail to parse, but instead of falling back to markdown rendering, it would render nothing or show broken output.
- **Chosen action:** Replaced the JSX null-check with an `isJsonString()` check before dispatching to structured renderers. If content isn't valid JSON, goes straight to ReactMarkdown.
- **Files touched:** `src/components/renderers/index.tsx`
- **Tests added:** 5 tests in `src/components/renderers/__tests__/index.test.tsx`

### Finding: API key exposed in URL query string
- **Assessment claim:** Gemini API key is passed as `?key=` in URLs, visible in browser history, proxy logs, and network tab.
- **Validation result:** Confirmed. Both `callGemini` (line 26) and `callGeminiStream` (line 80) used `?key=${apiKey}` in the URL.
- **Severity:** High
- **Confidence:** High
- **Root cause:** Direct use of Google's simplest auth method (query param) instead of header-based auth.
- **User impact:** API key visible in browser history, network tab URLs, corporate proxy logs, and screenshots. If a user shares a screenshot or screen recording of their dev tools, their API key is leaked.
- **Chosen action:** Moved API key from URL query parameter to `x-goog-api-key` HTTP header, which the Gemini API supports natively. Key no longer appears in URLs.
- **Files touched:** `src/lib/llmProvider.ts`
- **Tests added:** None (requires live API to test; verified by code inspection)

### Finding: Conditional useState violates React rules-of-hooks
- **Assessment claim:** (Found during validation, not in original assessment) `ProjectWorkspace.tsx` calls `useState` on line 122, after an early return on line 51.
- **Validation result:** Confirmed. ESLint flagged this as `react-hooks/rules-of-hooks` violation.
- **Severity:** High
- **Confidence:** High
- **Root cause:** The `useState(false)` for `isExportOpen` was added after the early return guard, likely during a later edit.
- **User impact:** If `projectId` ever transitions from defined to undefined (e.g., during navigation), React's hook ordering breaks, causing a crash or undefined behavior.
- **Chosen action:** Moved the `useState` declaration up to the hook block (before any early returns).
- **Files touched:** `src/components/ProjectWorkspace.tsx`

### Finding: ESLint errors on main branch
- **Assessment claim:** Lint currently fails on main branch.
- **Validation result:** Partially confirmed. Lint was failing because `npm install` hadn't been run (missing `@eslint/js`). After install, there are 5 real errors — not a systemic config problem.
- **Severity:** High
- **Confidence:** High
- **Root cause:** 5 distinct issues: conditional hook (above), Math.random() in render (SkeletonLoader), two fast-refresh mixed-export warnings (StreamingText, intentHelper).
- **User impact:** No quality gate means regressions go undetected.
- **Chosen action:** Fixed all 5:
  1. Moved conditional useState (ProjectWorkspace)
  2. Replaced `Math.random()` with deterministic index-based widths (SkeletonLoader)
  3. Extracted `useStreamingText` hook to `src/lib/useStreamingText.ts` (StreamingText)
  4. Added eslint-disable for intentHelper.tsx (intentional mixed exports)
- **Files touched:** `src/components/ProjectWorkspace.tsx`, `src/components/SkeletonLoader.tsx`, `src/components/StreamingText.tsx`, `src/lib/useStreamingText.ts` (new), `src/lib/intentHelper.tsx`

### Finding: Debounced localStorage loses data on tab close
- **Assessment claim:** 500ms debounce means recent changes aren't written if user closes tab quickly.
- **Validation result:** Confirmed. The `createDebouncedStorage` adapter uses a setTimeout with no flush mechanism.
- **Severity:** Medium
- **Confidence:** High
- **Root cause:** Performance optimization (debounce) without safety net for page unload.
- **User impact:** If a user makes a change and closes the browser tab within 500ms, that change is silently lost. Example: user finalizes their PRD, closes tab immediately — finalization state is lost.
- **Chosen action:** Added `beforeunload` event listener that synchronously flushes any pending write. Also tracks `pendingName` alongside `pendingValue` so the flush knows which key to write to.
- **Files touched:** `src/store/projectStore.ts`

### Finding: Legacy DevPlan/Prompts badges on HomePage
- **Assessment claim:** Homepage displays legacy stage badges ("Dev Plan", "Prompts") for dead product features.
- **Validation result:** Confirmed. `HomePage.tsx` lines 70-79 used `getLatestDevPlan` and `getAgentPrompts` to determine badge labels.
- **Severity:** Medium
- **Confidence:** High
- **Root cause:** Badge logic was written when the pipeline had DevPlan/Prompts stages. Those stages were replaced by the Artifacts stage, but the badge logic was never updated.
- **User impact:** Confusing product narrative. Users see "Dev Plan" or "Prompts" labels that don't correspond to any accessible feature in the current product.
- **Chosen action:** Replaced legacy badge logic with current pipeline stages (PRD, PRD Final, Mockups, Artifacts, History) based on `project.currentStage`. Removed `getLatestDevPlan` and `getAgentPrompts` from store destructuring.
- **Files touched:** `src/components/HomePage.tsx`

### Finding: Unnecessary type assertion in HomePage
- **Assessment claim:** `Object.values(projects).map((project: unknown)` then casts to Project.
- **Validation result:** Confirmed. `projects` is typed as `Record<string, Project>`, so `Object.values()` returns `Project[]`.
- **Severity:** Low
- **Confidence:** High
- **Chosen action:** Removed the `unknown` annotation and `as Project` cast. Direct iteration over typed values.
- **Files touched:** `src/components/HomePage.tsx`

### Finding: Dynamic import missing error handling
- **Assessment claim:** The outer `import()` in `handleCreateProject` has no `.catch()`, so chunk load failures are silent.
- **Validation result:** Confirmed. Only the inner `generateStructuredPRD()` call had error handling.
- **Severity:** Low
- **Confidence:** High
- **User impact:** If the network fails during chunk loading (e.g., poor connection), the user navigates to a project that shows "Generating PRD..." forever with no error message.
- **Chosen action:** Added `.catch()` on the outer `import()` call that writes an error message to the spine.
- **Files touched:** `src/components/HomePage.tsx`

---

## False / Outdated / Already-Fixed Findings

| Assessment Claim | Reality |
|-----------------|---------|
| "Lint currently fails on main branch" — implied systemic config issue | Lint only fails because `npm install` wasn't run. After install, 5 real errors exist (now all fixed). |
| "Settings modal messaging says key never leaves your machine" — implied this is misleading | Actually true: key stays in localStorage and goes to Google directly. The real issue is URL exposure, not "leaving the machine." |
| "State mutations are synchronous and broad; no transactional safeguards" | Zustand mutations are synchronous by design. This is normal and correct for client-side state management. Not a real problem. |
| "Presence of serverless API suggests secure backend path" | The API directory is clearly labeled legacy. It's dead code, not a misleading architecture signal. |

---

## Immediate Fixes Implemented

| # | Fix | Commit | Files Changed |
|---|-----|--------|---------------|
| 1 | Resolve all 5 ESLint errors (conditional hook, render purity, fast-refresh) | `5416d2d` | 5 files |
| 2 | Fix renderer fallback — markdown path was unreachable | `d95a2d7` | 1 file |
| 3 | Move Gemini API key from URL to x-goog-api-key header | `6884534` | 1 file |
| 4 | Flush localStorage on unload + remove legacy badges + fix type assertion + import error handling | `1810edd` | 2 files |
| 5 | Add Vitest test framework with 15 tests | `4065b64` | 6 files |

---

## Deferred Issues and Why

### 1. Split god modules (llmProvider + projectStore)
- **Severity:** High | **Risk of deferral:** Medium
- **Why defer:** This is a high-churn refactor touching ~1,800 lines across the two most critical files. Needs its own focused PR with careful migration to avoid regressions. The current fixes reduce immediate risk without requiring the split.
- **Recommended approach:** Split `llmProvider.ts` into `geminiClient.ts` (transport), `prompts/` (prompt templates), `artifactService.ts` (orchestration). Split `projectStore.ts` into Zustand slices per entity group.

### 2. Server-side API proxy
- **Severity:** Medium | **Risk of deferral:** Low (mitigated by header fix)
- **Why defer:** Moving to a server-side proxy is an architectural decision requiring backend infrastructure. The header fix removes the worst exposure (key in URLs). For a portfolio/demo app, the current approach is acceptable.

### 3. Compare mode state scoping (MockupsView)
- **Severity:** Medium | **Risk of deferral:** Low
- **Why defer:** Compare mode works for the common case (single artifact selected). The state bleed issue only manifests when rapidly switching between artifacts while in compare mode. Needs UX design work to determine the right behavior.

### 4. Error boundaries
- **Severity:** Medium | **Risk of deferral:** Low
- **Why defer:** Good practice but low urgency. A rendering crash in one component takes down the whole app, but this is acceptable for a demo-stage product. Should be added when the app handles real user data.

### 5. Full test coverage
- **Severity:** High | **Risk of deferral:** Medium
- **Why defer:** 15 tests covering renderer dispatch and store CRUD provide a baseline. Full coverage (integration tests, e2e) requires significant investment. The test framework is now in place, making incremental additions easy.

### 6. Remove legacy store code (DevPlan/AgentPrompt entities)
- **Severity:** Low | **Risk of deferral:** Low
- **Why defer:** The store still holds `devPlans` and `agentPrompts` data structures for backward compatibility with existing localStorage data. Removing them requires a migration strategy for users who have existing projects. The UI surface (badges) has been cleaned up — the store code is dead but harmless.

---

## Risks / Follow-ups

1. **API key header compatibility:** The `x-goog-api-key` header is supported by the Gemini API, but should be verified in production deployment (Vercel). If CORS preflight behavior differs, the header approach may need adjustment.

2. **localStorage quota:** No quota checking exists. Large projects with many artifacts could exceed the 5-10MB localStorage limit. Consider adding a warning when storage exceeds 80% capacity.

3. **Concurrent generation race conditions:** Multiple artifact generations can run simultaneously (via `withConcurrency`). If the component unmounts during generation, `setState` calls on unmounted components produce warnings. Consider adding `AbortController` support.

4. **Build chunk size:** The production build is 566KB (gzipped 171KB). The dynamic import in HomePage doesn't help because `llmProvider` is statically imported elsewhere. Consider manual chunks in Vite config.

---

## Recommended Next 3-5 PRs

### PR 1: Split llmProvider into domain modules
- Extract `geminiClient.ts` (callGemini, callGeminiStream, API key management)
- Extract `prompts/` directory (system prompts per artifact type)
- Extract `artifactService.ts` (generateCoreArtifact, refineCoreArtifact, validation orchestration)
- Keep `llmProvider.ts` as a thin re-export layer during migration

### PR 2: Split projectStore into Zustand slices
- Create `projectSlice.ts` (projects, spine versions)
- Create `branchSlice.ts` (branches, consolidation)
- Create `artifactSlice.ts` (artifacts, versions, staleness)
- Create `feedbackSlice.ts` (feedback items)
- Combine via Zustand's slice pattern

### PR 3: Add error boundaries and improve error UX
- Add a top-level `ErrorBoundary` component
- Add per-section error boundaries (PRD view, Artifacts view, Mockups view)
- Improve error messages for common failures (API key invalid, rate limited, network error)
- Add retry buttons for failed generations

### PR 4: Integration tests for critical user flows
- Test: Create project → generate PRD → finalize → switch to artifacts stage
- Test: Create branch → add messages → consolidate back to spine
- Test: Generate artifact → create version → compare versions
- Test: Export project as markdown

### PR 5: Remove legacy code and clean up dead paths
- Remove DevPlan/AgentPrompt store actions and state
- Remove `api/` serverless functions (confirmed unused)
- Remove `generateDevPlan` and `generateAgentPrompt` from llmProvider
- Add data migration to strip legacy entities from localStorage
- Remove AgentPromptCard and MilestoneCard components
