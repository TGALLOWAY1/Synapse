# Synapse Codebase Audit

**Date:** 2026-03-25
**Auditor:** Senior Full-Stack Engineer / Technical Architect
**Scope:** Artifact quality, speed/performance, markup image capability, UX gaps, implementation plan

---

## 1. Executive Summary

### Current Health

Synapse is a well-structured React SPA (~3,500 LOC across 18 components, 1 store, 1 LLM provider, and 3 serverless functions) that implements a 4-stage PRD generation pipeline. The codebase is clean, TypeScript-strict, and architecturally coherent for an early-stage product. The type system (`src/types/index.ts`) is thoughtfully designed with versioning, lineage tracking, and staleness detection built in from the start.

However, **the product ambition significantly outpaces the current implementation** in three critical areas:

1. **Artifact quality is limited by text-only rendering and shallow prompts.** Every artifact — mockups, screen inventories, design systems, data models — is stored as an opaque markdown string and rendered in a `<pre>` tag. There is no structured intermediate representation, no post-processing, no validation, and no visual rendering layer. The artifacts look like ChatGPT output, not professional design deliverables.

2. **The app feels slow because of sequential LLM calls and zero streaming.** The most painful example: "Generate All" artifacts runs 7 Gemini API calls in a synchronous `for` loop (`ArtifactsView.tsx:85-107`), taking ~21 seconds when it could take ~3 seconds with `Promise.all`. No generation flow uses streaming — users stare at a spinner until the full response returns.

3. **There is zero infrastructure for visual/image output.** No canvas, no SVG generation, no image processing libraries, no file upload. Mockups are ASCII art. The gap between "markup image generation" and the current codebase is significant but bridgeable.

### Biggest Weaknesses

| Area | Severity | Summary |
|------|----------|---------|
| Artifact rendering | **Critical** | All artifacts render as monospace plain text in `<pre>` tags |
| Sequential generation | **Critical** | Bundle generation is 7x slower than necessary |
| No streaming | **High** | Users see no output until full LLM response completes |
| Prompt shallowness | **High** | PRD prompt is 1 sentence; artifact prompts lack examples/constraints |
| No artifact IR | **High** | Content is opaque strings — can't be transformed, validated, or richly rendered |
| No image capability | **High** | Zero visual output support |
| localStorage-only persistence | **Medium** | ~5-10MB limit, no sharing, no backup, data loss on clear |
| No memoization | **Medium** | Store getters filter arrays on every render cycle |

### Biggest Opportunities

1. **Parallelize bundle generation** — immediate ~7x speedup, 30 minutes of work
2. **Add streaming** — transforms perceived latency from "broken" to "fast", ~2 hours
3. **Introduce artifact IR** — unlocks rich rendering, validation, and markup images
4. **Structured artifact rendering** — render data models as diagrams, screen inventories as cards, design systems as swatches
5. **Markup image pipeline** — LLM generates annotation spec → deterministic SVG/HTML renderer → image export

### Foundation Assessment

**The current implementation is a good foundation that needs targeted upgrades, not a rewrite.** The type system, versioning model, staleness tracking, and feedback loop architecture are solid. The main deficits are in the rendering layer (too primitive), the LLM integration layer (no streaming, no parallelism, shallow prompts), and the complete absence of visual output capability.

---

## 2. Current Architecture Overview

### System Architecture (Text Diagram)

```
┌─────────────────────────────────────────────────────────────────┐
│                        BROWSER (Client-Side SPA)                 │
│                                                                   │
│  ┌──────────┐    ┌──────────────┐    ┌────────────────────────┐  │
│  │  React    │───▶│  Zustand     │───▶│  localStorage          │  │
│  │  Router   │    │  Store       │    │  (synapse-projects-    │  │
│  │           │    │  (782 lines) │    │   storage)             │  │
│  │  / ─────▶ HomePage            │    └────────────────────────┘  │
│  │  /p/:id ─▶ ProjectWorkspace   │                                │
│  └──────────┘    └──────┬───────┘                                │
│                         │                                         │
│  ┌──────────────────────▼───────────────────────────────────┐    │
│  │              Component Layer (18 TSX files)                │    │
│  │                                                            │    │
│  │  PRD Stage:    SelectableSpine, StructuredPRDView,        │    │
│  │                BranchList, BranchCanvas,                   │    │
│  │                ConsolidationModal                          │    │
│  │                                                            │    │
│  │  Mockup Stage: MockupsView                                │    │
│  │  Artifact Stage: ArtifactsView                            │    │
│  │  History Stage: HistoryView                               │    │
│  │  Shared: FeedbackModal, FeedbackItemsList,                │    │
│  │          StalenessBadge, PipelineStageBar, SettingsModal   │    │
│  └──────────────────────┬───────────────────────────────────┘    │
│                         │                                         │
│  ┌──────────────────────▼───────────────────────────────────┐    │
│  │           LLM Provider (src/lib/llmProvider.ts)            │    │
│  │                                                            │    │
│  │  callGemini() ──▶ Google Gemini API (v1beta)              │    │
│  │    ├─ generatePRD()           (text mode)                  │    │
│  │    ├─ generateStructuredPRD() (JSON mode)                  │    │
│  │    ├─ generateMockup()        (text mode)                  │    │
│  │    ├─ generateCoreArtifact()  (text mode, 7 subtypes)     │    │
│  │    ├─ consolidateBranch()     (text mode, parallel)        │    │
│  │    ├─ replyInBranch()         (text mode)                  │    │
│  │    ├─ generateDevPlan()       (JSON mode)                  │    │
│  │    └─ generateAgentPrompt()   (JSON mode)                  │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
└───────────────────────────────┬───────────────────────────────────┘
                                │ HTTPS (fetch)
                                ▼
                    ┌───────────────────────┐
                    │  Google Gemini API     │
                    │  gemini-2.5-flash      │
                    │  (or gemini-2.5-pro)   │
                    └───────────────────────┘

┌───────────────────────────────────────────────┐
│  Vercel Serverless (api/)  — UNUSED by SPA    │
│  generate-prd.ts, generate-milestones.ts,     │
│  generate-agent-prompts.ts                    │
│  (3 proxy endpoints, not called by frontend)  │
└───────────────────────────────────────────────┘
```

### Frontend Structure

| Layer | Files | Role |
|-------|-------|------|
| Entry | `src/main.tsx`, `src/App.tsx` | React 19 root, BrowserRouter with 2 routes |
| Workspace | `ProjectWorkspace.tsx` (471 lines) | Main layout, stage switching, state orchestration |
| PRD Stage | `SelectableSpine.tsx`, `StructuredPRDView.tsx`, `BranchList.tsx`, `BranchCanvas.tsx`, `ConsolidationModal.tsx` | Text selection → branch → consolidation flow |
| Mockup Stage | `MockupsView.tsx` (416 lines) | Settings panel, generation, version compare |
| Artifact Stage | `ArtifactsView.tsx` (228 lines) | 7-artifact grid, bundle generation |
| History Stage | `HistoryView.tsx` | Timeline of events with diff previews |
| Shared | `FeedbackModal.tsx`, `FeedbackItemsList.tsx`, `StalenessBadge.tsx`, `PipelineStageBar.tsx`, `SettingsModal.tsx` | Cross-cutting UI |

### Data Flow: Artifact Generation Lifecycle

```
User clicks "Generate All"
  │
  ▼
ArtifactsView.handleGenerateBundle()          [ArtifactsView.tsx:80-113]
  │
  ├─ for (const meta of CORE_ARTIFACTS)       [SEQUENTIAL — 7 iterations]
  │    │
  │    ▼
  │  generateCoreArtifact(subtype, prd, ...)  [llmProvider.ts:495-514]
  │    │
  │    ▼
  │  callGemini(system, prompt)               [llmProvider.ts:20-56]
  │    │
  │    ▼
  │  fetch() → Gemini API → await response    [NO STREAMING]
  │    │
  │    ▼
  │  return raw markdown string
  │    │
  │    ▼
  │  createArtifact() + createArtifactVersion()  [projectStore.ts:484-616]
  │    │
  │    ▼
  │  Zustand set() → localStorage persist     [FULL STATE SERIALIZATION]
  │
  ▼
UI renders content in <pre> tag               [ArtifactsView.tsx:188-189]
```

### Where Speed Issues Are Introduced

1. **Sequential LLM calls** — `ArtifactsView.tsx:85` `for` loop
2. **No streaming** — `llmProvider.ts:41-55` waits for complete response
3. **Full state serialization** — every `set()` in `projectStore.ts` triggers JSON.stringify of entire store to localStorage
4. **No memoization** — `getArtifacts()`, `getArtifactVersions()` filter full arrays on each call (`projectStore.ts:534-543, 640-643`)
5. **Mark.js re-execution** — `SelectableSpine.tsx:25-45` runs unmark/mark cycle on every render

### Where Markup Image Support Would Naturally Fit

The artifact system already supports typed artifacts with versioned content and metadata. A markup image artifact would slot in as:
- **New `ArtifactType`**: `'markup_image'` in `src/types/index.ts:102`
- **New subtypes**: `'screenshot_annotation'`, `'comparison_board'`, `'wireframe_callout'`, etc.
- **Structured content**: Instead of a markdown string, `ArtifactVersion.content` would hold a JSON annotation spec
- **New renderer**: A dedicated component replacing the `<pre>` tag, using SVG overlays or HTML-to-image
- **New generation flow**: LLM generates structured annotation spec → deterministic renderer produces visual output

---

## 3. Artifact Quality Audit

### Issue AQ-1: All Artifacts Render as Plain Text

**Symptom:** Every generated artifact — screen inventories, data models, design systems, user flows — looks like a ChatGPT text dump. There is no visual differentiation between artifact types.

**Root Cause:** The rendering layer uses a single `<pre>` element for all artifact content.

**Evidence:**
- `ArtifactsView.tsx:188-189`:
  ```tsx
  <pre className="whitespace-pre-wrap text-sm text-neutral-800 font-sans">
      {preferredVersion.content}
  </pre>
  ```
- `MockupsView.tsx:131`:
  ```tsx
  <div className="bg-white rounded-xl border border-neutral-200 p-6 font-mono text-sm
       whitespace-pre-wrap leading-relaxed text-neutral-800 overflow-auto max-h-[600px]">
      {content}
  </div>
  ```
- There is no markdown rendering for artifacts (unlike the PRD view which uses `ReactMarkdown` in `SelectableSpine.tsx:161`).

**Category:** Rendering limitation

**Severity:** **Critical** — This single issue is the largest contributor to artifacts feeling weak. A well-structured data model rendered in monospace looks indistinguishable from an unstructured brain dump.

**Recommendation:**
1. At minimum, render artifact content through `ReactMarkdown` with `remark-gfm` (already a dependency) instead of `<pre>`.
2. Better: introduce type-specific renderers. A screen inventory should render as a card grid. A data model should render as an entity-relationship table. A design system should render color swatches and typography samples.

---

### Issue AQ-2: PRD Generation Prompt Is Too Generic

**Symptom:** Generated PRDs are structurally sound but lack specificity, actionable detail, and opinionated product thinking.

**Root Cause:** The system prompt for initial PRD generation is a single sentence with no examples, constraints, or quality criteria.

**Evidence:**
- `llmProvider.ts:64`:
  ```typescript
  const system = "You are an expert product manager. Write a comprehensive Product
  Requirements Document (PRD) based on the following user prompt. Use Markdown formatting.
  Include sections for Overview, Goals, Scope, and Technical Approach.";
  ```
- Compare with the structured PRD prompt at `llmProvider.ts:167-170` which is significantly more detailed and produces better output. But the initial `generatePRD()` function (line 62) is what runs first on project creation, and it uses the weaker prompt.

**Category:** Prompt design

**Severity:** **High** — First impressions matter. The initial PRD sets the quality bar for everything downstream.

**Recommendation:**
- The `generatePRD()` function at line 62 appears to be a legacy path — `HomePage.tsx:27-31` actually calls `generateStructuredPRD()` directly. Verify that `generatePRD()` is dead code and remove it, or upgrade its prompt to match the structured version's quality.
- Add few-shot examples or quality criteria to the structured PRD prompt (e.g., "Each feature must include at least one acceptance criterion", "Architecture should specify specific technology choices, not generic patterns").

---

### Issue AQ-3: Core Artifact Prompts Lack Output Structure Enforcement

**Symptom:** Core artifacts (screen inventory, user flows, component inventory, etc.) vary wildly in structure and quality between generations. Some runs produce well-organized markdown; others produce stream-of-consciousness text.

**Root Cause:** The prompts in `CORE_ARTIFACT_PROMPTS` specify what to include but don't enforce output structure. None use JSON mode. There are no examples of good output.

**Evidence:**
- `llmProvider.ts:398-493` — All 7 artifact prompts follow the pattern:
  ```typescript
  system: "You are an expert [role]. Create a [artifact type]...\n\nFor each [item], include:\n- Field 1\n- Field 2\n..."
  ```
- None provide a template or example output
- None use `jsonMode` — they all return free-form markdown via `callGemini(config.system, ...)` at line 510-513
- The `generateCoreArtifact` function at `llmProvider.ts:495-514` has no output validation

**Category:** Prompt design + missing validation

**Severity:** **High** — Without structural enforcement, artifact quality is entirely dependent on LLM mood. Some runs are excellent; others are mediocre.

**Recommendation:**
1. **Short-term:** Add explicit output templates to each prompt. For example, the screen inventory prompt should include: "Format each screen as: `### [Screen Name]\n**Purpose:** ...\n**Components:** ...\n**Navigation:** ...`"
2. **Medium-term:** Switch core artifacts to JSON mode with schemas (like `generateStructuredPRD` and `generateDevPlan` already do). This guarantees structure.
3. **Long-term:** Introduce an Artifact IR (intermediate representation) — see AQ-6.

---

### Issue AQ-4: No Post-Processing or Validation Pipeline

**Symptom:** LLM output goes directly to storage and rendering with zero transformation. Malformed output, truncated responses, or off-topic content is stored and displayed as-is.

**Root Cause:** The generation flow is: `callGemini()` → return string → `createArtifactVersion(content)` → render. There is no validation step.

**Evidence:**
- `ArtifactsView.tsx:50,86` — raw LLM output stored directly:
  ```typescript
  const content = await generateCoreArtifact(subtype, prdContent, structuredPRD);
  // ... no validation ...
  createArtifactVersion(projectId, artifactId, content, ...);
  ```
- JSON-mode functions (`generateStructuredPRD`, `generateDevPlan`, `generateAgentPrompt`) do have `JSON.parse()` with error handling, but only catch parse failures — not semantic quality issues.
- Text-mode functions (`generateMockup`, `generateCoreArtifact`) have zero validation.

**Category:** Missing validation + missing post-processing

**Severity:** **Medium-High** — Doesn't cause crashes, but silently stores low-quality output that the user then has to manually evaluate.

**Recommendation:**
1. Add a lightweight validation step: check response length (too short = likely truncated), check for expected section headers, check for markdown structure.
2. For JSON-mode artifacts, validate required fields exist and have non-empty values.
3. Add a "quality score" to artifact metadata so the UI can flag potentially weak outputs.

---

### Issue AQ-5: Structured PRD Schema Is Too Shallow

**Symptom:** The structured PRD captures high-level vision and features but lacks the depth needed to drive high-quality downstream artifacts. Missing: acceptance criteria, user stories, feature dependencies, priority ranking, technical constraints, non-functional requirements.

**Root Cause:** The schema is minimal.

**Evidence:**
- `llmProvider.ts:138-162` — `structuredPRDSchema`:
  ```typescript
  features: {
      type: "ARRAY",
      items: {
          properties: {
              id, name, description, userValue, complexity
          }
      }
  }
  ```
- The `Feature` type in `types/index.ts:29-35` only has: `id, name, description, userValue, complexity`
- No fields for: acceptance criteria, dependencies, priority, user stories, edge cases, technical constraints

**Category:** Schema design

**Severity:** **Medium** — The shallow PRD limits the quality ceiling of all downstream artifacts. Screen inventories can't reference user stories. Implementation plans can't express dependencies.

**Recommendation:**
- Extend `Feature` with: `priority: 'must' | 'should' | 'could'`, `acceptanceCriteria: string[]`, `dependencies: string[]` (feature IDs)
- Add to `StructuredPRD`: `nonFunctionalRequirements: string[]`, `constraints: string[]`, `userStories: { persona: string, action: string, benefit: string }[]`
- This enriches the context passed to downstream artifact generators

---

### Issue AQ-6: No Artifact Intermediate Representation (IR)

**Symptom:** Artifacts are opaque markdown strings. They can't be programmatically queried, validated, transformed, or richly rendered. You can't ask "which screens reference the login feature" because the screen inventory is just text.

**Root Cause:** `ArtifactVersion.content` is typed as `string` (`types/index.ts:140`). There is no structured representation for any artifact type except PRD.

**Evidence:**
- `types/index.ts:140`: `content: string`
- `ArtifactVersion.metadata` is `Record<string, unknown>` — used only for mockup settings, not for structured artifact data
- Only `StructuredPRD` has a dedicated type and schema. The other 7 artifact types have no structured form.

**Category:** Schema design (architectural)

**Severity:** **High** — This is the architectural blocker for: rich rendering, cross-artifact references, markup image generation, structured editing, and export to multiple formats.

**Recommendation:**
Introduce typed artifact content. For example:

```typescript
type ScreenInventoryItem = {
    name: string;
    purpose: string;
    components: string[];
    navigation: { from: string[]; to: string[] };
    priority: 'core' | 'secondary' | 'supporting';
    featureRefs: string[]; // links to StructuredPRD feature IDs
};

type ScreenInventoryContent = {
    format: 'screen_inventory_v1';
    groups: { name: string; screens: ScreenInventoryItem[] }[];
};
```

Store structured content in `ArtifactVersion.content` as JSON (parsed at render time), and generate a markdown view from it for display/export. This inverts the current model: instead of storing markdown and trying to extract structure, store structure and render markdown from it.

---

### Issue AQ-7: Mockup Generation Produces Text, Not Visuals

**Symptom:** "Mockups" are ASCII wireframes or structured text descriptions. They don't look or feel like mockups.

**Root Cause:** The generation prompt asks for text-based mockups, and there is no visual rendering pipeline.

**Evidence:**
- `llmProvider.ts:351-354` — Fidelity instructions:
  ```typescript
  low: 'Use simple ASCII wireframes with boxes, lines, and placeholder text...',
  mid: 'Use structured text descriptions with clear component names...',
  high: 'Provide detailed, polished descriptions including typography, spacing...'
  ```
- Even "high fidelity" mockups are text descriptions, not visual outputs
- `MockupsView.tsx:131` renders mockup content in `font-mono whitespace-pre-wrap`

**Category:** Rendering limitation + generation approach

**Severity:** **High** — For a product that aspires to be a "compelling artifact-generation product," text mockups are a fundamental gap.

**Recommendation:**
1. **Short-term:** Render high-fidelity mockup descriptions as styled HTML components rather than monospace text. Parse section headers, component lists, and layout descriptions into visual blocks.
2. **Medium-term:** Generate mockups as structured layout specs (JSON) that a deterministic renderer turns into visual HTML. Then use html-to-image for export.
3. **Long-term:** Integrate with a design tool API or visual generation model.

---

### Issue AQ-8: No Artifact Iteration/Refinement Controls

**Symptom:** Users can only "Generate" or "Regenerate" an artifact. There's no way to say "make the data model more detailed" or "add authentication to the screen inventory." Regeneration starts from scratch.

**Root Cause:** The generation functions don't accept refinement instructions. `generateCoreArtifact()` at `llmProvider.ts:495-514` takes only `(subtype, prdContent, structuredPRD)` — no previous version content, no user feedback.

**Evidence:**
- `ArtifactsView.tsx:44-78` (`handleGenerateOne`) — regeneration calls the same function with the same inputs; previous version content is never passed to the LLM
- No "refine" or "edit instruction" UI element exists in `ArtifactsView.tsx`
- Contrast with branches (`BranchList.tsx`) which support iterative conversation — artifacts have no equivalent

**Category:** UX workflow gap + generation limitation

**Severity:** **Medium-High** — Without refinement, users are stuck in a generate-and-hope loop. This is one of the biggest product gaps.

**Recommendation:**
1. Add a "Refine" action that sends the current artifact content + user instruction to the LLM
2. Include the previous version's content in the prompt context for regeneration
3. Support inline editing of artifact content (already exists for PRD via `StructuredPRDView`; extend to other types)

---

### Summary: Root Cause Breakdown

| Root Cause Category | Issues | Combined Severity |
|---------------------|--------|-------------------|
| **Rendering limitations** | AQ-1, AQ-7 | Critical |
| **Prompt design** | AQ-2, AQ-3 | High |
| **Schema/IR design** | AQ-5, AQ-6 | High |
| **Missing validation** | AQ-4 | Medium-High |
| **UX workflow gaps** | AQ-8 | Medium-High |

---

## 4. Speed / Performance Audit

### Latency Budget (Target vs Actual)

```
Flow: "Generate All" Artifacts (7 subtypes)
─────────────────────────────────────────────
                           CURRENT         TARGET
User clicks button         0ms              0ms
Show optimistic UI         N/A              0ms     ← add skeleton/progress
API call #1 (Gemini)       ~3s              ~3s     (stream first tokens at ~200ms)
API call #2                ~6s              ~3s     ← parallelize
API call #3                ~9s              ~3s
API call #4                ~12s             ~3s
API call #5                ~15s             ~3s
API call #6                ~18s             ~3s
API call #7                ~21s             ~3s
Store + persist            ~200ms           ~50ms   ← batch writes
UI render                  ~100ms           ~50ms   ← memoize
─────────────────────────────────────────────
TOTAL                      ~21-25s          ~3-5s
Perceived (with streaming) ~21-25s          ~0.5s   (first content visible)
```

---

### Quick Wins (< 1 day each)

#### PERF-1: Parallelize Bundle Artifact Generation

**What is slow:** Generating all 7 core artifacts takes ~21 seconds.

**Where:** `ArtifactsView.tsx:80-113`
```typescript
// CURRENT — sequential
for (const meta of CORE_ARTIFACTS) {
    const content = await generateCoreArtifact(meta.subtype, prdContent, structuredPRD);
    // ... store result ...
}
```

**Why it's slow:** Each Gemini API call takes ~3s. Running 7 in sequence = ~21s. These calls are completely independent.

**Impact:** Actual latency (7x improvement). Perceived latency (significant — progress shown per-artifact).

**Fix:**
```typescript
// RECOMMENDED — parallel with progressive UI updates
const promises = CORE_ARTIFACTS.map(async (meta) => {
    const content = await generateCoreArtifact(meta.subtype, prdContent, structuredPRD);
    // Store immediately when each completes (progressive)
    const existing = getExistingArtifact(meta.subtype);
    let artifactId = existing?.id;
    if (!existing) {
        artifactId = createArtifact(projectId, 'core_artifact', meta.title, meta.subtype).artifactId;
    }
    createArtifactVersion(projectId, artifactId!, content, ...);
    return { subtype: meta.subtype, success: true };
});
const results = await Promise.allSettled(promises);
```

**Expected impact:** ~21s → ~3-4s (limited by slowest single call + Gemini rate limits)

**Implementation complexity:** Low — ~30 minutes

---

#### PERF-2: Render Artifacts with ReactMarkdown Instead of `<pre>`

**What is slow:** Not a latency issue per se, but monospace `<pre>` rendering makes large artifacts feel like a wall of undifferentiated text, which makes the app feel "heavy" and unresponsive — a perceived performance issue.

**Where:**
- `ArtifactsView.tsx:188-189` — `<pre>` for core artifacts
- `MockupsView.tsx:131` — `<div className="font-mono whitespace-pre-wrap">` for mockups

**Why:** ReactMarkdown with remark-gfm is already a dependency and used in `SelectableSpine.tsx:161`. Markdown rendering adds visual hierarchy (headers, lists, code blocks, tables) that makes scanning fast.

**Fix:** Replace `<pre>{content}</pre>` with `<ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>`.

**Expected impact:** Significant perceived speed improvement. Users can scan structured markdown 3-5x faster than monospace text.

**Implementation complexity:** Low — ~15 minutes

---

#### PERF-3: Add Optimistic UI and Progress Indicators for Generation

**What is slow:** During generation, the only feedback is a "Generating..." button label. For bundle generation, there's no per-artifact progress.

**Where:** `ArtifactsView.tsx:129` — single "Generating Bundle..." label for the entire operation

**Why it's slow:** Without progress feedback, 3 seconds feels like 10 seconds. With progress feedback, 10 seconds feels like 5.

**Fix:**
1. Show a skeleton/placeholder for each artifact being generated
2. For bundle generation, update each artifact card as it completes (already possible with parallel approach from PERF-1)
3. Add a progress counter: "Generating 3 of 7..."

**Expected impact:** Large perceived speed improvement

**Implementation complexity:** Low — ~1 hour

---

### Medium-Effort Improvements (1-3 days each)

#### PERF-4: Add Streaming Support to LLM Calls

**What is slow:** Users see zero output until the complete LLM response returns (~2-5 seconds per call).

**Where:** `llmProvider.ts:20-56` — `callGemini()` uses a single `fetch()` → `response.json()` pattern. No streaming.

**Why it's slow:** The Gemini API supports streaming via `streamGenerateContent`. The current implementation waits for the full response body before returning any text.

**Fix:**
1. Add a `callGeminiStream()` function that uses `streamGenerateContent` endpoint
2. Accept an `onChunk(text: string)` callback
3. For text-mode generations (mockups, core artifacts, branch replies), stream tokens to the UI
4. For JSON-mode generations, streaming is less useful (partial JSON can't be displayed), but the response can still start faster

**Expected impact:** Perceived latency drops from ~3s to ~200ms (time to first token). This is the single highest-impact perceived speed improvement.

**Implementation complexity:** Medium — ~4 hours. Requires new streaming UI components (token-by-token text display).

---

#### PERF-5: Memoize Zustand Store Selectors

**What is slow:** Every component that calls `getArtifacts()`, `getArtifactVersions()`, `getBranchesForSpine()`, etc. triggers array filtering on every render. In `ArtifactsView.tsx`, the render function calls `getExistingArtifact()` (line 41-42), `getArtifactVersions()` (line 149), and `getArtifactStaleness()` (line 151) — **for every artifact card, on every render**.

**Where:**
- `projectStore.ts:534-537` — `getArtifacts` filters full array
- `projectStore.ts:640-643` — `getArtifactVersions` filters full array
- `projectStore.ts:376-379` — `getBranchesForSpine` filters full array
- `projectStore.ts:742-762` — `getArtifactStaleness` does multiple lookups + filters per call

**Why it's slow:** These are O(n) scans called redundantly. With 7 artifacts × multiple versions, this is noticeable during state updates. Each `set()` call triggers re-render of all subscribed components.

**Fix:**
1. Use Zustand's `useShallow` selector or manual `useMemo` in components
2. Consider indexing artifacts by type/subtype in the store instead of filtering
3. For `getArtifactStaleness`, cache the result and invalidate only when spine or artifact versions change

**Expected impact:** Eliminates unnecessary re-renders and re-computations. Most noticeable in the artifacts grid.

**Implementation complexity:** Medium — ~3 hours

---

#### PERF-6: Debounce/Batch localStorage Persistence

**What is slow:** Every `set()` call in the Zustand store triggers full state serialization to localStorage via the `persist` middleware. During bundle generation, this means 14+ serialization cycles (7 `createArtifact` + 7 `createArtifactVersion`).

**Where:** `projectStore.ts:96-782` — every `set()` call. The persist middleware at line 766 wraps the entire store.

**Why it's slow:** `JSON.stringify` on the full state tree (all projects, all versions, all artifacts) runs synchronously on the main thread. As data grows, this becomes a measurable frame drop.

**Fix:**
1. Use `partialize` option in Zustand persist to exclude computed/derivable data
2. Debounce persistence (e.g., persist at most once every 500ms)
3. Consider IndexedDB (via `idb-keyval`) for larger data — no 5-10MB limit, async writes

**Expected impact:** Eliminates main-thread jank during rapid state updates

**Implementation complexity:** Medium — ~2 hours for debounce, ~4 hours for IndexedDB migration

---

### Major Architectural Improvements (1+ weeks)

#### PERF-7: Move LLM Calls to a Backend with Request Queuing

**What is slow:** Direct browser-to-Gemini calls expose the API key client-side and don't support server-side optimizations (caching, request deduplication, rate limit management).

**Where:** `llmProvider.ts:20-56` — API key read from localStorage, sent in URL query string

**Why it matters:** Beyond security (API key in URL is logged in browser history, network inspector, and any proxy), a backend enables: response caching for identical prompts, request queuing to respect rate limits, background generation with webhook notifications, and shared generation across devices.

**Fix:**
1. Route all LLM calls through the existing Vercel serverless functions (already set up in `api/`)
2. Add response caching (content-hash of prompt → cached response)
3. Add request queuing for bundle generation (server controls parallelism within rate limits)

**Expected impact:** Enables caching (~instant for repeated prompts), better rate limit handling, and removes API key from client

**Implementation complexity:** High — ~1 week. The `api/` directory already has 3 endpoint stubs that could be expanded.

---

#### PERF-8: Implement Progressive/Partial Rendering for Large Artifacts

**What is slow:** Large artifacts (especially "Doc-Wide Rewrite" in consolidation and multi-screen mockups) can be 5,000+ characters. Rendering the full content at once causes a layout shift and feels slow.

**Where:**
- `ConsolidationModal.tsx:150-152` — renders full doc-wide patch
- `MockupsView.tsx:131-133` — renders full mockup content
- `ArtifactsView.tsx:187-189` — renders full artifact content

**Fix:**
1. For streaming (PERF-4), render incrementally as tokens arrive
2. For stored content, use virtualization for very long artifacts (react-window or similar)
3. Add collapsible sections within artifacts (e.g., each screen in a screen inventory is collapsible)

**Expected impact:** Smooth rendering of large content without layout jank

**Implementation complexity:** Medium-High — ~2 days

---

### Performance Issue Priority Matrix

| ID | Issue | Actual Latency | Perceived Latency | Impact | Effort | Priority |
|----|-------|---------------|-------------------|--------|--------|----------|
| PERF-1 | Parallelize bundle gen | **7x improvement** | High | Critical | Low | **#1** |
| PERF-2 | Markdown rendering | None | High | High | Low | **#2** |
| PERF-3 | Progress indicators | None | High | High | Low | **#3** |
| PERF-4 | Streaming | Moderate | **Transformative** | Critical | Medium | **#4** |
| PERF-5 | Memoize selectors | Moderate | Moderate | Medium | Medium | **#5** |
| PERF-6 | Batch persistence | Moderate | Low | Medium | Medium | **#6** |
| PERF-7 | Backend LLM proxy | Low | Low (enables caching) | Medium | High | **#7** |
| PERF-8 | Progressive rendering | Low | Moderate | Low-Med | Med-High | **#8** |

---

## 5. Markup Image Capability Audit

### Current State: Nothing Exists

The codebase has **zero image generation, processing, or rendering capability**:

- **No image libraries** in `package.json` — no canvas, sharp, jimp, html-to-image, dom-to-image, or SVG manipulation libraries
- **No `<canvas>` elements** anywhere in the component tree
- **No SVG generation** — no programmatic SVG construction in any file
- **No file upload** — no image input mechanism in the UI
- **No image storage** — localStorage stores only JSON text; no blob/binary support
- **Mockups are text** — `MockupsView.tsx` renders ASCII art / structured descriptions in monospace font
- **No export to image** — only export is markdown download (`ProjectWorkspace.tsx:120-143`)

### What Pieces Already Exist That Could Support Markup Images

Despite the lack of image capability, several existing patterns are leverageable:

| Existing Piece | How It Helps |
|----------------|-------------|
| **Artifact versioning system** (`types/index.ts:135-146`) | Markup images can be versioned artifacts with the same lineage tracking |
| **`ArtifactVersion.metadata`** (`types/index.ts:141`) | Can store annotation data, source image references, render settings |
| **`ArtifactVersion.content`** as JSON string | Already used for structured PRD; can hold annotation spec |
| **`CoreArtifactSubtype` union** (`types/index.ts:104-111`) | Easily extended with markup image subtypes |
| **`ArtifactType` union** (`types/index.ts:102`) | Can add `'markup_image'` as a new type |
| **Feedback system** (`FeedbackModal.tsx`) | Users can extract feedback from markup images back to PRD |
| **Staleness tracking** (`projectStore.ts:742-762`) | Markup images would be stale when source PRD changes |
| **ReactMarkdown** (already a dependency) | Can render captions and labels within annotation layouts |
| **Lucide icons** (already a dependency) | Can supply annotation icons (arrows, circles, etc.) |

### What Is Missing

1. **A rendering engine** — Something that takes a structured annotation spec and produces a visual output (SVG, canvas, or HTML composition)
2. **An annotation data model** — Typed definitions for overlays, callouts, arrows, boxes, labels, connectors
3. **An image input mechanism** — File upload, URL reference, or screenshot capture
4. **An annotation editor** — Interactive UI for placing/editing overlays on a source image
5. **An image export pipeline** — Converting the rendered annotation to a downloadable PNG/SVG
6. **LLM-to-annotation generation** — Prompts and schemas for generating annotation specs from PRD context

### Recommended Technical Design

#### Rendering Approach Analysis

| Approach | Pros | Cons | Fit for Synapse |
|----------|------|------|----------------|
| **SVG composition** | Resolution-independent, precise positioning, CSS-stylable, exportable | Complex for raster image backgrounds, limited text wrapping | **Best for V1** — clean, exportable, no dependencies |
| **Canvas-based** | Pixel-perfect, good for raster, fast rendering | Not resolution-independent, harder to make interactive, no CSS | Overkill for annotation overlays |
| **HTML-to-image** (html-to-image / html2canvas) | Use existing React components, natural styling | Quality issues, font rendering problems, CORS for external images | **Best for V2** — leverages existing component system |
| **Server-side composition** (sharp / canvas on Node) | High quality, no browser limitations | Requires backend, adds latency, more infrastructure | **V3** — for production-grade export |
| **LLM-generated layout spec + deterministic renderer** | AI does the creative work, renderer is predictable | Requires good schema design, LLM may generate invalid specs | **Core approach** — pairs with any renderer |

**Recommendation:** Use **LLM-generated layout spec + SVG composition** for V1. The LLM generates a structured JSON annotation spec. A deterministic React/SVG component renders it. For export, use `html-to-image` to capture the rendered output as PNG.

#### Should Markup Images Be a First-Class Artifact Type?

**Yes.** Markup images should be a new `ArtifactType = 'markup_image'` with their own subtypes:

```typescript
type MarkupImageSubtype =
    | 'screenshot_annotation'    // Annotated UI screenshot
    | 'comparison_board'         // Before/after with highlights
    | 'wireframe_callout'        // Labeled wireframe
    | 'critique_board'           // Product critique with callouts
    | 'flow_annotation'          // User flow with numbered steps
    | 'design_feedback';         // Visual feedback with arrows/notes
```

This means markup images get: versioning, staleness tracking, feedback extraction, and history events — all for free from the existing artifact system.

#### Annotation Data Model

```typescript
// The structured content stored in ArtifactVersion.content (as JSON string)
interface MarkupImageSpec {
    version: 'markup_v1';
    canvas: {
        width: number;
        height: number;
        backgroundColor: string;
    };
    source?: {
        type: 'url' | 'data_uri' | 'artifact_ref';
        value: string;              // URL, base64, or artifact ID
        fit: 'contain' | 'cover' | 'fill';
    };
    layers: AnnotationLayer[];
    exportSettings: {
        format: 'png' | 'svg';
        scale: number;              // 1x, 2x, 3x
        includeCaption: boolean;
    };
}

interface AnnotationLayer {
    id: string;
    type: 'box' | 'arrow' | 'callout' | 'label' | 'connector'
        | 'highlight' | 'number_marker' | 'text_block' | 'divider';
    position: { x: number; y: number };
    size?: { width: number; height: number };
    style: {
        color: string;
        borderColor?: string;
        borderWidth?: number;
        borderRadius?: number;
        opacity?: number;
        fontSize?: number;
        fontWeight?: 'normal' | 'bold';
    };
    content?: string;               // Text content for labels/callouts
    // Type-specific properties
    arrow?: {
        from: { x: number; y: number };
        to: { x: number; y: number };
        headStyle: 'filled' | 'open' | 'none';
    };
    connector?: {
        fromLayerId: string;
        toLayerId: string;
        style: 'straight' | 'elbow' | 'curved';
    };
    numberMarker?: {
        number: number;
        description: string;         // Shown in caption/legend
    };
}
```

#### How This Integrates with Current Artifact Generation Flows

```
User clicks "Generate Critique Board" (new action in MockupsView or ArtifactsView)
  │
  ▼
generateMarkupImage(subtype, prdContent, sourceArtifact?)   [NEW in llmProvider.ts]
  │
  ├─ System prompt: "Generate a structured annotation spec..."
  ├─ JSON mode with MarkupImageSpec schema
  ├─ Context: PRD content + optional source artifact content
  │
  ▼
LLM returns MarkupImageSpec JSON
  │
  ▼
createArtifact(projectId, 'markup_image', title, subtype)
createArtifactVersion(projectId, artifactId, JSON.stringify(spec), ...)
  │
  ▼
MarkupImageRenderer component parses spec and renders SVG
  │
  ▼
User can: export as PNG, refine annotations, extract feedback
```

### Proposed Architecture

#### V1: Minimal (1-2 weeks)

**Goal:** Generate and display annotation-based visual artifacts from PRD context.

**Components:**
1. **`MarkupImageSpec` type** — annotation data model (in `types/index.ts`)
2. **`generateMarkupImage()`** — LLM generation function with JSON schema (in `llmProvider.ts`)
3. **`MarkupImageRenderer.tsx`** — SVG-based renderer that takes a `MarkupImageSpec` and produces visual output
4. **`MarkupImageView.tsx`** — Wrapper with generate/regenerate/export actions
5. **Export** — `html-to-image` library to capture SVG as PNG download

**V1 Limitations:** No image upload (source images referenced by URL only). No interactive annotation editor. LLM-generated layouts only.

**New dependencies:** `html-to-image` (~15KB)

#### V2: Stronger (3-4 weeks additional)

**Goal:** Interactive annotation editing, image upload, comparison boards.

**Components added:**
1. **Interactive annotation editor** — drag-to-place overlays on a canvas, resize/reposition
2. **Image upload** — file input → base64 data URI → stored in `ArtifactVersion.metadata`
3. **Comparison boards** — side-by-side before/after with synced annotation layers
4. **Template library** — pre-built annotation layouts for common patterns (critique, feedback, wireframe review)
5. **Rich export** — SVG download, PNG at multiple scales, copy-to-clipboard

**New dependencies:** `@dnd-kit/core` (drag-and-drop), potentially `react-resizable` for overlay sizing

### Markup Image Artifact Spec Example

```json
{
    "version": "markup_v1",
    "canvas": {
        "width": 1280,
        "height": 800,
        "backgroundColor": "#f5f5f5"
    },
    "source": {
        "type": "url",
        "value": "https://example.com/screenshot-dashboard.png",
        "fit": "contain"
    },
    "layers": [
        {
            "id": "box-1",
            "type": "highlight",
            "position": { "x": 50, "y": 120 },
            "size": { "width": 300, "height": 60 },
            "style": {
                "color": "rgba(239, 68, 68, 0.15)",
                "borderColor": "#ef4444",
                "borderWidth": 2,
                "borderRadius": 8
            }
        },
        {
            "id": "callout-1",
            "type": "callout",
            "position": { "x": 380, "y": 100 },
            "size": { "width": 240, "height": 80 },
            "style": {
                "color": "#ffffff",
                "borderColor": "#ef4444",
                "borderWidth": 1,
                "borderRadius": 8,
                "fontSize": 13
            },
            "content": "Navigation bar lacks breadcrumbs. Users will lose context in nested views.",
            "connector": {
                "fromLayerId": "callout-1",
                "toLayerId": "box-1",
                "style": "elbow"
            }
        },
        {
            "id": "number-1",
            "type": "number_marker",
            "position": { "x": 45, "y": 115 },
            "style": {
                "color": "#ef4444",
                "fontSize": 14,
                "fontWeight": "bold"
            },
            "numberMarker": {
                "number": 1,
                "description": "Missing breadcrumb navigation"
            }
        },
        {
            "id": "arrow-1",
            "type": "arrow",
            "position": { "x": 700, "y": 400 },
            "style": {
                "color": "#3b82f6",
                "borderWidth": 2
            },
            "arrow": {
                "from": { "x": 700, "y": 400 },
                "to": { "x": 700, "y": 300 },
                "headStyle": "filled"
            },
            "content": "CTA should be above the fold"
        },
        {
            "id": "caption-1",
            "type": "text_block",
            "position": { "x": 50, "y": 750 },
            "size": { "width": 1180, "height": 40 },
            "style": {
                "color": "#525252",
                "fontSize": 12
            },
            "content": "Dashboard v2 critique — Generated from PRD v3 | 3 issues identified | Priority: Navigation, CTA placement, Data density"
        }
    ],
    "exportSettings": {
        "format": "png",
        "scale": 2,
        "includeCaption": true
    }
}
```
