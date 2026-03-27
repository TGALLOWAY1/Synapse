## 8. What Should Be Automated Later

> **Purpose:** A prioritized roadmap of test automation investments. Each recommendation includes what to automate, why it matters, the class of bugs it catches, and a suggested priority level (P0 = must-have before launch, P1 = next sprint, P2 = soon after, P3 = nice-to-have).

---

### 8.1 Unit Tests (Vitest)

Vitest is the recommended runner for Vite-based projects — zero additional bundler config, native TypeScript and ESM support, and sub-second watch-mode feedback.

| # | What to Automate | Why It Matters | Bugs It Catches | Priority |
|---|------------------|----------------|-----------------|----------|
| U-1 | **Zustand store CRUD actions** — `addProject`, `updateProject`, `deleteProject`, `setActiveProject`, etc. | The store is 819 lines with 50+ actions; manual coverage is infeasible. | State not updating, stale references, missing fields on create/update. | P0 |
| U-2 | **Versioning logic** — `addPrdVersion`, `setPreferredPrdVersion`, `addArtifactVersion`, `setPreferredArtifactVersion`. | Version management is a core user-facing feature; regressions silently corrupt data. | Wrong version marked preferred, version list order bugs, version metadata loss. | P0 |
| U-3 | **Staleness detection** — any action that marks downstream content stale when the PRD changes. | Staleness flags control pipeline progression; false negatives let users proceed on outdated content. | Stale flag not set after PRD edit, stale flag not cleared after regeneration. | P0 |
| U-4 | **Storage migration / schema evolution** — roundtrip serialize → deserialize with older localStorage payloads. | Without migration tests, any type change risks bricking returning users' data. | Crash on load after app update, silent data loss during migration. | P1 |
| U-5 | **LLM response parsing — JSON mode** — feed `generateStructuredPRD`, `generateCoreArtifact`, `generateDevPlan` known JSON strings and assert parsed output. | Gemini's structured output may drift or include wrapper text; parsing must be resilient. | JSON parse failures, missing required fields, incorrect type coercion. | P0 |
| U-6 | **LLM response parsing — streaming chunks** — simulate partial SSE chunks for `replyInBranch` and `consolidateBranch`. | Streaming reassembly is fragile; a single off-by-one in chunk concatenation corrupts the response. | Truncated responses, duplicated text, malformed markdown from split UTF-8 sequences. | P1 |
| U-7 | **LLM error handling** — simulate 429 rate-limit, 500 server error, network timeout, invalid API key. | Users see raw errors or infinite spinners if error paths are untested. | Unhandled promise rejections, missing error toasts, stuck loading states. | P1 |
| U-8 | **Artifact validation logic** (`artifactValidation.ts`) — pass artifacts with known quality issues and assert scores. | Validation drives the quality badge shown to users; wrong scores erode trust. | Score inflation/deflation, crash on edge-case artifact shapes. | P1 |
| U-9 | **`structuredPRDToMarkdown` conversion** — roundtrip structured PRD → markdown and verify section headers, content integrity. | Markdown export is user-facing (copy/paste into docs); formatting bugs are visible. | Missing sections, broken markdown syntax, lost content in nested structures. | P1 |
| U-10 | **Type serialization / deserialization** — verify all types in `types/index.ts` survive `JSON.stringify` → `JSON.parse`. | localStorage persistence depends on lossless JSON roundtrip; `Date` objects, `undefined` values, and `Map`/`Set` do not survive naively. | Date fields become strings, optional fields silently dropped, app crash on hydration. | P2 |

---

### 8.2 Integration Tests (Vitest + React Testing Library)

These tests render real React components backed by the real Zustand store (no mocks for state) but stub the Gemini API at the network boundary.

| # | What to Automate | Why It Matters | Bugs It Catches | Priority |
|---|------------------|----------------|-----------------|----------|
| I-1 | **Project creation → PRD generation → state update flow.** Create a project via the UI, stub a Gemini response, assert the store contains a valid structured PRD and the view renders it. | This is the golden path — if it breaks, the app is unusable. | Form validation gaps, store not wired to component, PRD not rendered after generation. | P0 |
| I-2 | **Branch creation → message → consolidation → spine update.** Select text, open a branch, send a message (stubbed), consolidate, and verify the main PRD reflects the change. | Branch consolidation touches multiple store slices and re-renders the PRD view. | Consolidation silently fails, PRD text not updated, branch status stuck. | P0 |
| I-3 | **Artifact generation → version creation → preferred version logic.** Generate an artifact (stubbed), create a second version, toggle preferred, and verify the renderer shows the correct version. | Multi-version artifacts are a differentiating feature; version switching is error-prone. | Wrong version displayed, version count off-by-one, preferred flag not persisted. | P1 |
| I-4 | **Feedback creation → status transition → PRD application.** Create feedback on a PRD section, transition it through statuses (open → accepted → applied), and verify the PRD updates accordingly. | Feedback-to-PRD application is a multi-step workflow that crosses component boundaries. | Status transition skips a state, applied feedback not reflected in PRD, orphaned feedback entries. | P1 |
| I-5 | **Export content matches displayed content.** Generate a project with PRD + artifacts, trigger export, and diff the exported content against what the renderers display. | Export is the primary output of the tool; divergence from the UI is a silent data integrity bug. | Missing sections in export, stale content exported, encoding issues in exported markdown. | P1 |

---

### 8.3 E2E Tests (Playwright)

Playwright is already installed (`playwright@^1.58.2`) but unconfigured. These tests run a real browser against the dev server and hit the real Gemini API (or a local mock server for CI).

| # | What to Automate | Why It Matters | Bugs It Catches | Priority |
|---|------------------|----------------|-----------------|----------|
| E-1 | **Full project creation → export flow.** Create project, wait for PRD generation, navigate through pipeline stages, export. | Validates the entire happy path end-to-end with real browser behavior, real localStorage, and real rendering. | Routing bugs, race conditions between generation and navigation, export producing empty files. | P0 |
| E-2 | **Pipeline stage progression.** Create project, finalize PRD, verify Mockups stage unlocks, generate mockup, verify Artifacts stage unlocks. | Stage locking/unlocking is a core UX constraint; manual testing is slow due to generation wait times. | Stage accessible before prerequisite is met, stage locked after prerequisite is met, navigation guard regressions. | P1 |
| E-3 | **Branch workflow end-to-end.** Open a project, create a branch from selected text, send multiple messages, consolidate back, verify PRD update. | Branches involve text selection (browser-native), a side panel, streaming responses, and state merging — many moving parts. | Text selection range incorrect, branch panel does not open, consolidation button disabled incorrectly, merged text malformed. | P1 |
| E-4 | **Multi-project management.** Create 3 projects, switch between them, delete one, verify the other two are intact. | Multi-project state isolation bugs only surface when switching contexts. | Active project bleeds into another, deletion removes wrong project, project list not updated after delete. | P2 |

---

### 8.4 Visual Regression Tests (Playwright Screenshots or Chromatic)

Pixel-level comparisons catch CSS regressions that functional tests miss. Playwright's `toHaveScreenshot()` is the zero-cost starting point; Chromatic integrates with Storybook if the team adopts it later.

| # | What to Automate | Why It Matters | Bugs It Catches | Priority |
|---|------------------|----------------|-----------------|----------|
| V-1 | **MarkupImageRenderer SVG output.** Screenshot the rendered SVG for a known mockup payload. | SVG rendering is sensitive to viewBox, font metrics, and stroke widths — invisible to DOM-based assertions. | Clipped SVG, wrong colors, missing text labels, broken gradients. | P2 |
| V-2 | **Structured renderers** — `ScreenInventoryRenderer`, `DataModelRenderer`, `ComponentInventoryRenderer`. | These renderers display complex tabular/graph-like data; layout shifts are common after Tailwind changes. | Overlapping columns, truncated cell content, missing rows, broken responsive layout. | P2 |
| V-3 | **Empty / loading / error states.** Screenshot each major view in its empty, loading, and error variants. | These states are seen frequently (first launch, slow API, invalid key) but rarely tested visually. | Spinner misaligned, empty state text overlapping CTA button, error banner hidden behind other elements. | P2 |
| V-4 | **Mobile responsive breakpoints.** Screenshot at 375px (iPhone SE), 768px (iPad), and 1024px (small laptop). | Tailwind breakpoint changes can silently break mobile layout. | Horizontal scroll on mobile, touch targets too small, hidden navigation. | P3 |

---

### 8.5 Smoke Tests (Playwright)

Lightweight, fast tests (under 30 seconds total) designed to run on every commit or deploy preview. They assert only that the app boots and core navigation works — no Gemini API calls required.

| # | What to Automate | Why It Matters | Bugs It Catches | Priority |
|---|------------------|----------------|-----------------|----------|
| S-1 | **App loads without errors.** Navigate to `/`, assert no uncaught exceptions in the console, assert the page title or heading is visible. | Catches build-time breakage (bad import, missing env var, syntax error) before any deeper test runs. | White screen of death, missing chunk files, hydration mismatch. | P0 |
| S-2 | **Project creation succeeds.** Fill in the new project form, submit, assert navigation to `/p/:projectId`. | Validates the most critical user action without waiting for LLM generation. | Form submit handler broken, router misconfigured, store action throws. | P0 |
| S-3 | **Navigation between routes works.** Visit `/`, create a project (or seed localStorage), navigate to the project page, navigate back to `/`. | Catches routing regressions, lazy-load failures, and guard logic bugs. | Blank page on route change, back button broken, lazy chunk 404. | P1 |
| S-4 | **Settings modal opens and closes.** Click the settings icon, assert the modal is visible, close it, assert it is hidden. | Settings is the entry point for API key configuration — if it breaks, no generation works. | Modal z-index hidden behind other elements, close button not wired, body scroll lock not released. | P1 |

---

## 9. Test Environment and Setup Checklist

> **Purpose:** Everything a new tester needs to go from zero to running Synapse locally, including how to configure it, reset state, and inspect internals.

---

### 9.1 Prerequisites

| Requirement | Details |
|-------------|---------|
| **Node.js** | v18 or later (v20 LTS recommended). Verify with `node -v`. |
| **npm** | v9 or later (ships with Node 18+). Verify with `npm -v`. |
| **Gemini API Key** | Required for any generation feature. Free tier is sufficient for testing. |
| **Browser** | Chrome (primary), plus Firefox, Safari, and Edge for cross-browser passes. |
| **Git** | For cloning the repo. Any recent version. |

---

### 9.2 Local Setup Steps

```bash
# 1. Clone the repository
git clone <repo-url> && cd Synapse

# 2. Install dependencies
npm install

# 3. Start the dev server
npm run dev
# → App is available at http://localhost:5173

# 4. (Optional) Run a production-like build
npm run build && npm run preview
# → Preview server at http://localhost:4173
```

No `.env` file is required. The Gemini API key is entered at runtime through the Settings modal and stored in localStorage — it is never committed to the repository.

---

### 9.3 Obtaining a Gemini API Key

1. Go to [https://aistudio.google.com/apikey](https://aistudio.google.com/apikey).
2. Sign in with a Google account.
3. Click **Create API Key** and select or create a Google Cloud project.
4. Copy the generated key (starts with `AIza...`).
5. In Synapse, open the **Settings** modal (gear icon, top-right), paste the key into the **API Key** field, and save.

> **Tip:** The free tier provides generous rate limits for manual QA. If you hit 429 rate-limit errors during heavy testing, wait 60 seconds or switch to a second key.

---

### 9.4 Configuring Settings

Open the **Settings** modal (gear icon in the top navigation bar):

| Setting | What to Enter | Notes |
|---------|---------------|-------|
| **API Key** | Your Gemini API key | Required for all generation features. |
| **Model** | Select from the available Gemini models | Different models vary in speed and output quality; use the default for standard QA. |

Settings are persisted in localStorage alongside project data.

---

### 9.5 Browser Coverage Matrix

| Browser | Priority | Notes |
|---------|----------|-------|
| **Chrome (latest)** | Primary | All development and primary QA happens here. |
| **Firefox (latest)** | Secondary | Test at least the smoke test suite and one full project flow. |
| **Safari (latest, macOS)** | Secondary | Known differences in `localStorage` quota, `fetch` streaming, and CSS grid. |
| **Edge (latest)** | Low | Chromium-based; expect near-identical behavior to Chrome. Spot-check only. |

---

### 9.6 Mobile Testing

Synapse uses Tailwind responsive breakpoints. Test mobile layouts using:

1. **Chrome DevTools Device Mode** — Toggle the device toolbar (`Ctrl+Shift+M` / `Cmd+Shift+M`). Test at these presets:
   - iPhone SE (375 x 667)
   - iPhone 14 Pro (393 x 852)
   - iPad (768 x 1024)
2. **Real Devices** — If available, test on a physical iPhone (Safari) and Android phone (Chrome). Focus on touch interactions: tap targets, scroll behavior, and modal dismissal.

> **Note:** Synapse is a desktop-first productivity tool. Mobile is a secondary concern, but the app should remain usable (no horizontal scroll, no overlapping elements, all controls reachable).

---

### 9.7 How to Reset Application State

All Synapse data lives in a single localStorage entry. To reset to a clean slate:

**Option A — Browser DevTools:**
1. Open DevTools → **Application** tab → **Local Storage** → `http://localhost:5173`.
2. Right-click the key `synapse-projects-storage` → **Delete**.
3. Reload the page.

**Option B — Console one-liner:**
```javascript
localStorage.removeItem('synapse-projects-storage'); location.reload();
```

**Option C — Nuclear reset (all sites):**
- DevTools → Application → Local Storage → right-click the origin → **Clear**.

> **Warning:** Resetting state deletes all projects, PRDs, branches, artifacts, and settings. There is no undo.

---

### 9.8 How to Inspect Application State

The Zustand store persists its entire state tree to localStorage as JSON. To inspect it:

1. Open DevTools → **Application** tab → **Local Storage** → `http://localhost:5173`.
2. Click the `synapse-projects-storage` key.
3. The value is a JSON object. Copy it into a JSON formatter (or use DevTools' built-in preview) to explore.

Key things to look for:
- `state.projects` — array of all projects.
- `state.activeProjectId` — which project is currently selected.
- Each project contains `prdVersions`, `branches`, `artifacts`, `mockups`, and `feedback`.
- `state.version` — the store schema version (relevant for migration testing).

---

### 9.9 Debug Tooling

| Tool | What It Shows | How to Access |
|------|---------------|---------------|
| **Browser Console** | Debounced storage writes log when the store persists to localStorage. Uncaught errors and React warnings also appear here. | DevTools → Console. Filter by `[store]` or `[persist]` if log noise is high. |
| **Network Tab** | All Gemini API calls (`generativelanguage.googleapis.com`). Inspect request payloads (prompt, generation config) and response bodies (generated JSON/text). | DevTools → Network. Filter by `generativelanguage` to isolate API traffic. |
| **React DevTools** (optional) | Component tree, props, and Zustand hook values. Useful for debugging why a component is not re-rendering. | Install the React DevTools browser extension. |
| **Application Tab** | localStorage contents (see Section 9.8). Also shows service workers, cache storage, and cookies (Synapse uses none of these). | DevTools → Application. |

---

### 9.10 Seed Data and Example Projects

Synapse does not ship with seed data or example projects. Every test run starts from an empty state (after a localStorage reset). To create test data:

1. **Manually** — Create a new project via the UI with a short prompt (e.g., "A simple to-do list app"). Wait for PRD generation, then proceed through the pipeline.
2. **localStorage injection** — Copy a known-good `synapse-projects-storage` JSON blob and paste it into localStorage via the Console. Reload the page. This is useful for skipping generation steps when testing downstream features (mockups, artifacts, export).

> **Tip:** Save a few localStorage snapshots at different pipeline stages (fresh project, finalized PRD, generated mockups, generated artifacts) so you can quickly jump to the stage you need to test.

---

### 9.11 Architecture Notes for Testers

| Aspect | Detail |
|--------|--------|
| **No backend / no database** | Synapse is a pure client-side SPA. There is no server, no database, and no authentication. All data lives in the browser's localStorage. |
| **No feature flags** | Every feature is always on. There are no toggles, A/B tests, or staged rollouts to worry about. |
| **No database reset needed** | Since there is no database, the only "reset" is clearing localStorage (Section 9.7). |
| **API calls are client-side** | Gemini API calls go directly from the browser to Google's API. There is no backend proxy. This means the API key is visible in the Network tab — this is expected for a client-side tool. |
| **Vercel deployment** | Production and preview deploys are hosted on Vercel. Each PR gets a unique preview URL. Test preview deployments the same way you test locally — the only difference is the URL. |
| **No environment variables at build time** | The app does not read from `.env` or process environment variables. All configuration (API key, model selection) is entered at runtime via the Settings modal. |
