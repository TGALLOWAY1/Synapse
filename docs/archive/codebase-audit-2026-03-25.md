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

---

## 5b. UX / Product Gaps

### UX-1: Artifact Stage Feels Like a Text Dump, Not a Design Engine

**What's incomplete:** The artifacts stage (`ArtifactsView.tsx`) presents 7 artifact types in a flat list of expandable cards. Each expands to show a monospace text block. There is no visual differentiation between a "Screen Inventory" and a "Data Model" — both look like the same wall of text.

**What it should feel like:** A professional artifact workspace where each type has its own visual treatment. Screen inventories render as card grids. Data models render as entity-relationship tables. Design systems render color palettes and typography specimens. Implementation plans render as Gantt-like timelines.

**Files affected:** `ArtifactsView.tsx`, new type-specific renderer components

---

### UX-2: No Artifact Editing or Refinement Workflow

**What's incomplete:** Users can generate or regenerate artifacts but cannot refine them. There is no way to say "make the data model more detailed" or "add error states to the screen inventory." Regeneration discards the previous output and starts from scratch.

**Evidence:** `ArtifactsView.tsx:44-78` — `handleGenerateOne()` calls `generateCoreArtifact()` with only PRD context, never passing the current artifact content or user refinement instructions.

**What it should feel like:** A generation → inspection → refinement loop. Users should be able to: (1) generate, (2) review, (3) annotate specific issues, (4) refine with instructions, (5) compare before/after, (6) export.

**Files affected:** `ArtifactsView.tsx`, `llmProvider.ts` (add `refineCoreArtifact()` function)

---

### UX-3: Mockup-to-Artifact Pipeline Is Disconnected

**What's incomplete:** Mockups and core artifacts are separate stages with no direct connection. There's no flow for "I like this mockup — now generate a screen inventory that matches it" or "This data model doesn't align with the mockup screens."

**Evidence:** `ArtifactsView.tsx:365-370` and `MockupsView.tsx:354-361` — each stage receives `prdContent` and `structuredPRD` but neither references the other stage's outputs.

**What it should feel like:** Artifacts should optionally reference mockups as additional context. The screen inventory generator should know about the screens in the mockups. The component inventory should reference components visible in mockups.

**Files affected:** `llmProvider.ts` (artifact generation functions should accept optional mockup content), `ArtifactsView.tsx` (UI to select mockup as context)

---

### UX-4: Export Is PRD-Only and Markdown-Only

**What's incomplete:** The only export function is markdown download of the PRD (`ProjectWorkspace.tsx:120-143`). There is no export for mockups, core artifacts, feedback items, or history.

**What it should feel like:** A comprehensive export workflow that can produce: individual artifact markdown, full project bundle (ZIP with all artifacts), structured JSON export (for integration with other tools), and eventually image exports for markup images.

**Files affected:** `ProjectWorkspace.tsx`, new `ExportModal.tsx` component

---

### UX-5: No Cross-Artifact Navigation or References

**What's incomplete:** Artifacts exist in isolation. There's no way to navigate from a feature in the PRD to its corresponding screens in the screen inventory, or from a component in the component inventory to where it appears in mockups.

**Evidence:** `ArtifactVersion.sourceRefs` (`types/index.ts:115-121`) tracks which spine version an artifact was generated from, but never links artifacts to each other.

**What it should feel like:** Clickable cross-references. "This screen was generated from Feature F3" links to the feature card. "Component Button appears in 4 screens" links to those screens.

**Files affected:** `types/index.ts` (extend `SourceRef`), artifact renderers, `ArtifactsView.tsx`

---

### UX-6: No Bulk Operations or Workflow Automation

**What's incomplete:** Each artifact must be generated individually or via "Generate All." There's no: batch export, batch refresh (update all stale artifacts), template-based generation, or workflow presets.

**Evidence:** `ArtifactsView.tsx:80-113` — `handleGenerateBundle` is the only bulk operation. No bulk export, no bulk staleness refresh.

**What it should feel like:** A "Refresh Stale" button that regenerates only `possibly_outdated` or `outdated` artifacts. A "Export All" that bundles everything. Workflow templates that generate a specific set of artifacts for a given project type.

**Files affected:** `ArtifactsView.tsx`, `ProjectWorkspace.tsx`

---

### UX-7: Settings/Configuration Is Minimal

**What's incomplete:** `SettingsModal.tsx` only handles API key and model selection. There are no project-level settings, no generation preferences, no template management, no user preferences for default mockup settings.

**What it should feel like:** Project settings (default platform, fidelity, style direction), generation preferences (temperature, response length), export preferences (format, quality), and workspace preferences (layout, theme).

**Files affected:** `SettingsModal.tsx`, `types/index.ts` (add project settings type), `projectStore.ts`

---

## 6. Concrete Implementation Plan

### Phase 1: Stabilize and Diagnose (Week 1)

**Goals:** Fix the most painful issues, add instrumentation, establish baselines.

**Files/systems affected:**
- `ArtifactsView.tsx` — parallelize bundle generation
- `ArtifactsView.tsx`, `MockupsView.tsx` — switch to ReactMarkdown rendering
- `llmProvider.ts` — add timing instrumentation
- `projectStore.ts` — add console timing for persistence

**Key tasks:**
1. ✅ Parallelize `handleGenerateBundle` with `Promise.allSettled` (PERF-1)
2. ✅ Replace `<pre>` with `<ReactMarkdown>` in `ArtifactsView.tsx` and `MockupsView.tsx` (PERF-2)
3. ✅ Add per-artifact progress indicators during bundle generation (PERF-3)
4. ✅ Add `console.time` / `performance.mark` around LLM calls and state updates
5. ✅ Verify `generatePRD()` in `llmProvider.ts:62-66` is dead code and remove it if so
6. ✅ Clean up unused Vercel serverless functions in `api/` or mark them for future use

**Risks:** Gemini API rate limits may throttle parallel calls. Use `Promise.allSettled` to handle partial failures.

**Success criteria:** Bundle generation completes in <5s. All artifacts render with markdown formatting. Generation shows per-artifact progress.

---

### Phase 2: Improve Artifact Quality (Weeks 2-3)

**Goals:** Make artifacts consistently strong through better prompts, structured output, and validation.

**Files/systems affected:**
- `llmProvider.ts` — rewrite artifact prompts, add JSON schemas for core artifacts
- `types/index.ts` — add typed content interfaces for each artifact subtype
- New `src/lib/artifactSchemas.ts` — JSON schemas for core artifact types
- New `src/lib/artifactValidation.ts` — validation + quality scoring
- `ArtifactsView.tsx` — add refinement UI

**Key tasks:**
1. ✅ Extend `StructuredPRD` schema with priority, acceptance criteria, dependencies (AQ-5)
2. ✅ Rewrite `CORE_ARTIFACT_PROMPTS` with explicit output templates and examples (AQ-3)
3. ✅ Add JSON-mode schemas for at least: screen_inventory, data_model, component_inventory (AQ-3/AQ-6)
4. ✅ Add `refineCoreArtifact(subtype, currentContent, instruction, prdContent)` to `llmProvider.ts` (AQ-8)
5. ✅ Add "Refine" button + instruction input in `ArtifactsView.tsx` (AQ-8)
6. ✅ Add basic validation: response length check, expected section headers, JSON schema validation (AQ-4)
7. ✅ Pass previous version content to regeneration prompts (AQ-8)

**Risks:** JSON schemas for complex artifacts (user flows, implementation plan) may over-constrain LLM output. Start with simpler types (screen_inventory, data_model).

**Success criteria:** Core artifacts have consistent structure across generations. Users can refine artifacts with instructions. Invalid/truncated output is caught and flagged.

---

### Phase 3: Improve Speed / Perceived Speed (Weeks 3-4)

**Goals:** Make the app feel fast through streaming, optimistic UI, and efficient state management.

**Files/systems affected:**
- `llmProvider.ts` — add `callGeminiStream()` function
- New `src/components/StreamingText.tsx` — token-by-token rendering component
- `projectStore.ts` — add debounced persistence, memoized selectors
- `ArtifactsView.tsx`, `MockupsView.tsx`, `BranchList.tsx` — integrate streaming
- `package.json` — no new dependencies needed (fetch streaming is native)

**Key tasks:**
1. ✅ Implement `callGeminiStream()` using Gemini `streamGenerateContent` endpoint (PERF-4)
2. ✅ Create `StreamingText` component that displays tokens as they arrive
3. ✅ Integrate streaming into mockup generation, core artifact generation, and branch replies
4. ✅ Add `useShallow` selectors for Zustand subscriptions (PERF-5)
5. ✅ Debounce localStorage persistence to max 1 write per 500ms (PERF-6)
6. ✅ Add skeleton screens for all loading states
7. ✅ Memoize `MarkupImageRenderer` and artifact card components

**Risks:** Streaming requires managing partial state (content arriving in chunks). Need to handle: connection drops mid-stream, user navigating away during stream, store updates during stream.

**Success criteria:** First content visible within 500ms of generation start. No visible jank during state updates. localStorage writes don't block rendering.

---

### Phase 4: Add Markup Image Artifacts (Weeks 5-7)

**Goals:** Introduce visual annotation artifacts as a first-class type.

**Files/systems affected:**
- `types/index.ts` — add `MarkupImageSpec`, `AnnotationLayer`, `MarkupImageSubtype`
- `llmProvider.ts` — add `generateMarkupImage()` with JSON schema
- New `src/components/MarkupImageRenderer.tsx` — SVG-based annotation renderer
- New `src/components/MarkupImageView.tsx` — generation/display/export wrapper
- `ArtifactsView.tsx` or `ProjectWorkspace.tsx` — integrate markup image stage
- `PipelineStageBar.tsx` — optionally add markup images as a substage
- `package.json` — add `html-to-image`

**Key tasks:**
1. ✅ Define `MarkupImageSpec` and `AnnotationLayer` types
2. ✅ Build `MarkupImageRenderer` — renders SVG from spec (supports: boxes, arrows, callouts, labels, number markers, connectors, highlight regions, text blocks)
3. ✅ Add `generateMarkupImage()` to `llmProvider.ts` with JSON schema
4. ✅ Build `MarkupImageView` with generate/regenerate/export actions
5. ✅ Implement PNG export via `html-to-image`
6. ✅ Add 3 markup image subtypes: `screenshot_annotation`, `critique_board`, `wireframe_callout`
7. ✅ Test with various PRD inputs and source artifacts

**Risks:** LLM-generated layout specs may have positioning issues (overlapping elements, off-canvas placements). Add post-processing to clamp positions and detect overlaps. Gemini JSON mode may not handle the complex nested schema well — may need to simplify schema or add a two-pass approach (generate content first, then layout).

**Success criteria:** Users can generate visual annotation artifacts from PRD context. Annotations render correctly in SVG. Export to PNG works at 2x resolution.

---

### Phase 5: Polish / Export / Editing Workflows (Weeks 8-10)

**Goals:** Complete the product experience with editing, cross-references, comprehensive export, and interactive annotation editing.

**Files/systems affected:**
- New `src/components/AnnotationEditor.tsx` — interactive drag-and-drop editor
- New `src/components/ExportModal.tsx` — comprehensive export workflow
- Type-specific renderers for each core artifact subtype
- `types/index.ts` — extend `SourceRef` for cross-artifact references
- `ArtifactsView.tsx` — type-specific rendering
- `package.json` — add `@dnd-kit/core`, `file-saver`

**Key tasks:**
1. ✅ Build type-specific renderers (screen inventory → card grid, data model → table, design system → swatches)
2. ✅ Build interactive annotation editor for markup images (drag-to-place, resize, edit text)
3. ✅ Build export modal with: individual markdown, individual PNG, full project ZIP, JSON export
4. ✅ Add image upload for markup image source (file input → data URI)
5. ✅ Add cross-artifact navigation (feature → screens → components)
6. ✅ Add "Refresh Stale" bulk operation
7. ✅ Add project-level settings (defaults for platform, fidelity, style)

**Risks:** Interactive annotation editing is a significant UX challenge. Start with simple move/resize and iterate. Cross-artifact references require a graph data structure — may need to extend the store.

**Success criteria:** Users can edit markup image annotations interactively. All artifact types have visually distinct rendering. Export produces professional-grade output. Cross-artifact navigation works for at least PRD features → screen inventory.

---

## 7. Specific Code-Level Recommendations

### 7.1 Files/Modules to Split

| Current File | Problem | Recommended Split |
|-------------|---------|-------------------|
| `llmProvider.ts` (514 lines) | Mixes API transport, prompt templates, schemas, and generation logic | Split into: `src/lib/geminiClient.ts` (API transport + streaming), `src/lib/prompts/` directory (one file per artifact type), `src/lib/schemas/` directory (JSON schemas), `src/lib/generators.ts` (orchestration) |
| `projectStore.ts` (782 lines) | Single monolithic store with 30+ actions | Split by domain: `src/store/projectStore.ts` (projects, spines), `src/store/artifactStore.ts` (artifacts, versions), `src/store/feedbackStore.ts` (feedback items), `src/store/historyStore.ts` (events). Use Zustand slices pattern. |
| `ProjectWorkspace.tsx` (471 lines) | Orchestrates all stages, manages 12+ state variables | Extract stage-specific state into custom hooks: `useSpineState()`, `useBranchState()`, `usePipelineState()` |
| `types/index.ts` (224 lines) | All types in one file | Split into: `types/project.ts`, `types/artifact.ts`, `types/feedback.ts`, `types/markup.ts` (new) |

### 7.2 Interfaces/Types to Introduce

```typescript
// src/types/artifact-content.ts — Typed artifact content (replaces opaque strings)

interface ScreenInventoryContent {
    format: 'screen_inventory_v1';
    groups: { name: string; screens: ScreenItem[] }[];
}

interface DataModelContent {
    format: 'data_model_v1';
    entities: DataEntity[];
    relationships: DataRelationship[];
}

interface ComponentInventoryContent {
    format: 'component_inventory_v1';
    categories: { name: string; components: ComponentItem[] }[];
}

interface DesignSystemContent {
    format: 'design_system_v1';
    colors: ColorPalette;
    typography: TypographyScale;
    spacing: SpacingSystem;
    components: ComponentPattern[];
}

// Union type for all structured content
type ArtifactContent =
    | ScreenInventoryContent
    | DataModelContent
    | ComponentInventoryContent
    | DesignSystemContent
    | MarkupImageSpec
    | string; // fallback for unstructured content
```

```typescript
// src/types/generation.ts — Generation pipeline types

interface GenerationRequest {
    type: ArtifactType;
    subtype?: CoreArtifactSubtype;
    prdContent: string;
    structuredPRD: StructuredPRD;
    previousContent?: string;          // For refinement
    userInstruction?: string;           // For refinement
    mockupContext?: string;             // Cross-artifact reference
}

interface GenerationResult {
    content: string;
    contentType: 'markdown' | 'json';
    qualityScore?: number;             // 0-100 based on validation
    warnings?: string[];               // Validation warnings
    generationTimeMs: number;
}

interface StreamingGenerationCallbacks {
    onChunk: (text: string) => void;
    onComplete: (result: GenerationResult) => void;
    onError: (error: Error) => void;
}
```

### 7.3 Abstractions to Add

**1. Artifact Renderer Registry**

Instead of a single `<pre>` tag for all artifacts, create a registry of type-specific renderers:

```typescript
// src/lib/artifactRenderers.ts
const RENDERERS: Record<CoreArtifactSubtype, React.FC<{ content: string }>> = {
    screen_inventory: ScreenInventoryRenderer,
    data_model: DataModelRenderer,
    component_inventory: ComponentInventoryRenderer,
    implementation_plan: ImplementationPlanRenderer,
    user_flows: UserFlowsRenderer,
    prompt_pack: PromptPackRenderer,
    design_system: DesignSystemRenderer,
};
```

**2. Generation Pipeline Abstraction**

Wrap the generate → validate → store → render flow in a reusable pipeline:

```typescript
// src/lib/generationPipeline.ts
async function generateAndStore(request: GenerationRequest): Promise<GenerationResult> {
    const startTime = performance.now();
    const raw = await callGemini(buildPrompt(request));
    const validated = validate(request.subtype, raw);
    const result = { content: validated, generationTimeMs: performance.now() - startTime };
    storeArtifactVersion(request, result);
    return result;
}
```

### 7.4 Dead Code and Coupling to Remove

| Item | Location | Action |
|------|----------|--------|
| `generatePRD()` function | `llmProvider.ts:62-66` | Appears unused — `HomePage.tsx` calls `generateStructuredPRD()` directly. Verify and remove. |
| `DevPlan` / `AgentPrompt` legacy types | `types/index.ts:57-98` | Marked as "legacy — kept for backward compat." If migration is complete, remove along with store actions at `projectStore.ts:412-480`. |
| `api/generate-prd.ts`, `api/generate-milestones.ts`, `api/generate-agent-prompts.ts` | `api/` directory | Not called by the frontend SPA. Either integrate as the backend proxy (PERF-7) or remove. |
| Duplicated `getIntentHelper()` | `SelectableSpine.tsx:61-85` and `BranchList.tsx:57-88` | Extract to shared utility `src/lib/intentHelper.ts` |
| `useNavigate` in `BranchList.tsx:3` | `BranchList.tsx:18` | Imported but the navigate call at line 110 goes to a route (`/p/${projectId}/branch/${branch.id}`) that doesn't exist in `App.tsx`. Dead code path. |

### 7.5 Rendering Boundaries to Clean Up

The current rendering is tangled — `ProjectWorkspace.tsx` manages state for all stages and passes props down. Each stage should own its state:

```
CURRENT:
  ProjectWorkspace (manages all state)
    ├─ StructuredPRDView (receives structuredPRD, readOnly)
    ├─ MockupsView (receives prdContent, structuredPRD)
    └─ ArtifactsView (receives prdContent, structuredPRD)

RECOMMENDED:
  ProjectWorkspace (manages only navigation + spine state)
    ├─ PRDStage (owns branch, consolidation, feedback state)
    │   ├─ StructuredPRDView
    │   ├─ BranchList
    │   └─ ConsolidationModal
    ├─ MockupsStage (owns mockup generation, comparison state)
    │   └─ MockupsView
    └─ ArtifactsStage (owns artifact generation, expansion state)
        ├─ ArtifactsView
        └─ MarkupImageView (new)
```

### 7.6 Caching and Concurrency Changes

1. **Prompt-hash caching:** Before calling Gemini, hash `(systemPrompt + userPrompt)`. Check an in-memory `Map<string, string>` for cached responses. This prevents identical regenerations from hitting the API.

2. **Concurrent generation limiter:** When parallelizing bundle generation, add a concurrency limit (e.g., 3 simultaneous Gemini calls) to avoid rate limiting:
   ```typescript
   // Simple concurrency limiter
   async function withConcurrency<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
       const results: T[] = [];
       const executing: Promise<void>[] = [];
       for (const task of tasks) {
           const p = task().then(r => { results.push(r); });
           executing.push(p);
           if (executing.length >= limit) await Promise.race(executing);
       }
       await Promise.all(executing);
       return results;
   }
   ```

3. **Generation abort controller:** Pass an `AbortController` signal to `fetch()` calls so users can cancel in-flight generations:
   ```typescript
   const callGemini = async (system, prompt, jsonMode?, signal?: AbortSignal) => {
       const response = await fetch(url, { method: 'POST', ..., signal });
       // ...
   };
   ```

### 7.7 Instrumentation/Logging to Add

```typescript
// src/lib/telemetry.ts
const telemetry = {
    generation: (subtype: string, durationMs: number, tokenCount?: number) => {
        console.log(`[GEN] ${subtype}: ${durationMs}ms${tokenCount ? ` (${tokenCount} tokens)` : ''}`);
        // In production: send to analytics
    },
    storeWrite: (action: string, durationMs: number, stateSize: number) => {
        console.log(`[STORE] ${action}: ${durationMs}ms (${(stateSize / 1024).toFixed(1)}KB)`);
    },
    render: (component: string, durationMs: number) => {
        if (durationMs > 16) { // Frame budget exceeded
            console.warn(`[RENDER] ${component}: ${durationMs}ms (slow)`);
        }
    },
};
```

### 7.8 Schema Validation Improvements

Add runtime validation for JSON-mode LLM responses:

```typescript
// src/lib/validation.ts
function validateScreenInventory(raw: unknown): ScreenInventoryContent | null {
    if (!raw || typeof raw !== 'object') return null;
    const obj = raw as Record<string, unknown>;
    if (obj.format !== 'screen_inventory_v1') return null;
    if (!Array.isArray(obj.groups)) return null;
    // Validate each group has name + screens array
    // Validate each screen has required fields
    return obj as ScreenInventoryContent;
}
```

Consider using `zod` for runtime validation if schemas grow complex. Current dependencies don't include it, but it's lightweight (~14KB) and eliminates manual validation code.

---

## 8. Highest-Leverage Next Steps (Top 10)

These are ordered by impact — the first few items alone would transform the product experience.

### 1. Parallelize bundle artifact generation
**File:** `ArtifactsView.tsx:80-113`
**Effort:** 30 minutes | **Impact:** 7x speed improvement on the most-used heavy operation
**Why first:** This is the single highest-ROI change in the codebase. One `for` loop → `Promise.allSettled`.

### 2. Replace `<pre>` rendering with ReactMarkdown for all artifacts
**Files:** `ArtifactsView.tsx:188`, `MockupsView.tsx:131`
**Effort:** 15 minutes | **Impact:** Artifacts immediately look 3x more professional
**Why second:** Zero-risk change that transforms visual quality using an existing dependency.

### 3. Add streaming support to LLM calls
**Files:** `llmProvider.ts` (new `callGeminiStream`), new `StreamingText.tsx` component
**Effort:** 4 hours | **Impact:** Perceived latency drops from seconds to milliseconds
**Why third:** This is the change that makes the app *feel* fast. Users see content appear instantly instead of waiting for a spinner.

### 4. Add artifact refinement capability
**Files:** `llmProvider.ts` (new `refineCoreArtifact`), `ArtifactsView.tsx` (add refine UI)
**Effort:** 3 hours | **Impact:** Transforms artifacts from one-shot generation to iterative refinement
**Why fourth:** This is the biggest product gap. Without refinement, users are stuck in generate-and-hope loops.

### 5. Upgrade core artifact prompts with output templates
**File:** `llmProvider.ts:398-493` (rewrite `CORE_ARTIFACT_PROMPTS`)
**Effort:** 2 hours | **Impact:** Consistent artifact structure across generations
**Why fifth:** Better prompts + the markdown rendering from step 2 = dramatically better artifact output with zero architectural changes.

### 6. Switch core artifacts to JSON mode with schemas
**Files:** `llmProvider.ts`, new `src/lib/schemas/`, `types/index.ts`
**Effort:** 1-2 days | **Impact:** Enables structured rendering, validation, and cross-referencing
**Why sixth:** This is the architectural foundation for type-specific renderers (step 8) and markup images (step 9).

### 7. Add per-artifact progress indicators
**File:** `ArtifactsView.tsx`
**Effort:** 1 hour | **Impact:** Bundle generation feels responsive even before streaming
**Why seventh:** Cheap win that complements the parallelization from step 1.

### 8. Build type-specific artifact renderers
**Files:** New `src/components/renderers/` directory
**Effort:** 1 week | **Impact:** Each artifact type gets visual treatment appropriate to its content
**Why eighth:** Depends on JSON mode (step 6). Screen inventories as card grids, data models as tables, design systems as swatches.

### 9. Implement markup image V1 (LLM spec → SVG renderer)
**Files:** New types, new `MarkupImageRenderer.tsx`, `llmProvider.ts` extension
**Effort:** 1-2 weeks | **Impact:** Introduces visual annotation artifacts — a fundamentally new capability
**Why ninth:** Depends on JSON mode infrastructure (step 6) and renderer architecture (step 8).

### 10. Add comprehensive export (markdown, PNG, ZIP bundle)
**Files:** New `ExportModal.tsx`, `package.json` (add `html-to-image`, `file-saver`)
**Effort:** 3 days | **Impact:** Makes Synapse output usable in external workflows
**Why tenth:** Export is the bridge between generation and real-world use. Without it, artifacts are trapped in the app.

---

## 9. Appendix: Evidence

### Files Inspected

| File | Lines | Purpose | Key Findings |
|------|-------|---------|-------------|
| `src/App.tsx` | ~15 | Router | 2 routes: `/` (HomePage), `/p/:id` (ProjectWorkspace) |
| `src/main.tsx` | ~10 | Entry | React 19, StrictMode |
| `src/types/index.ts` | 224 | Type definitions | All core types; Feature type lacks priority/criteria |
| `src/lib/llmProvider.ts` | 514 | LLM integration | All Gemini calls; no streaming; sequential bundle gen; generic prompts |
| `src/store/projectStore.ts` | 782 | State management | Zustand + localStorage; full serialization on every set(); no memoization |
| `src/components/ProjectWorkspace.tsx` | 471 | Main workspace | 12+ state vars; all stage orchestration; only export is markdown |
| `src/components/ArtifactsView.tsx` | 228 | Artifact grid | Sequential for-loop bundle gen (line 85); `<pre>` rendering (line 188) |
| `src/components/MockupsView.tsx` | 416 | Mockup generation | Text-only mockups; monospace rendering (line 131); good settings UI |
| `src/components/SelectableSpine.tsx` | 214 | PRD text selection | mark.js re-runs every render (line 25-45); duplicated getIntentHelper |
| `src/components/BranchList.tsx` | 188 | Branch threads | Duplicated getIntentHelper; dead navigate route (line 110) |
| `src/components/ConsolidationModal.tsx` | 186 | Branch merge | Scope selection (local/doc-wide); string.replace for local patch |
| `src/components/HomePage.tsx` | 179 | Project list | Calls generateStructuredPRD directly (not generatePRD) |
| `src/components/StructuredPRDView.tsx` | ~300 | Structured PRD display | Inline editing; feature cards; good structured rendering |
| `src/components/HistoryView.tsx` | ~150 | Timeline | Groups events; shows diffs; no pagination |
| `src/components/FeedbackModal.tsx` | 130 | Feedback extraction | 8 feedback types; targets PRD/mockup/artifact |
| `src/components/FeedbackItemsList.tsx` | 84 | Feedback list | Apply/dismiss actions; color-coded types |
| `src/components/StalenessBadge.tsx` | ~30 | Staleness indicator | Green/amber/red badges |
| `src/components/PipelineStageBar.tsx` | ~60 | Stage navigation | 4 stages with active state |
| `src/components/SettingsModal.tsx` | ~80 | Settings | API key + model only |
| `src/components/FeatureCard.tsx` | ~60 | Feature display | Inline editing; complexity badge |
| `src/components/BranchCanvas.tsx` | ~200 | Full-screen branch | Resizable split view |
| `api/generate-prd.ts` | 60 | Vercel function | Unused by frontend |
| `api/generate-milestones.ts` | 63 | Vercel function | Unused by frontend |
| `api/generate-agent-prompts.ts` | 69 | Vercel function | Unused by frontend |
| `package.json` | ~40 | Dependencies | React 19, Vite 7, Zustand 5, no image libs |
| `vite.config.ts` | ~10 | Build config | Basic React plugin |
| `tailwind.config.js` | ~10 | Styling | Minimal config + typography plugin |
| `vercel.json` | ~15 | Deployment | SPA rewrites |

### Target Architecture (Text Diagram)

```
┌─────────────────────────────────────────────────────────────────────┐
│                        BROWSER (Client-Side SPA)                     │
│                                                                       │
│  ┌────────────┐    ┌──────────────┐    ┌──────────────────────────┐  │
│  │  React     │    │  Zustand     │    │  IndexedDB               │  │
│  │  Router    │    │  Store       │    │  (async, no size limit)  │  │
│  │            │    │  (sliced)    │    │                          │  │
│  └──────┬─────┘    └──────┬───────┘    └──────────────────────────┘  │
│         │                 │                                           │
│  ┌──────▼─────────────────▼─────────────────────────────────────┐    │
│  │              Stage Components (lazy-loaded)                    │    │
│  │                                                                │    │
│  │  PRDStage          MockupsStage        ArtifactsStage         │    │
│  │  MarkupImageStage  HistoryStage        ExportModal            │    │
│  └──────────┬───────────────────────────────────────────────────┘    │
│             │                                                         │
│  ┌──────────▼───────────────────────────────────────────────────┐    │
│  │           Renderer Registry                                    │    │
│  │  ScreenInventoryRenderer  │  DataModelRenderer                │    │
│  │  ComponentRenderer        │  DesignSystemRenderer             │    │
│  │  MarkupImageRenderer      │  MarkdownFallbackRenderer         │    │
│  └──────────┬───────────────────────────────────────────────────┘    │
│             │                                                         │
│  ┌──────────▼───────────────────────────────────────────────────┐    │
│  │           Generation Pipeline                                  │    │
│  │  ┌─────────────┐  ┌──────────┐  ┌───────────┐  ┌──────────┐ │    │
│  │  │ Prompt      │→ │ Gemini   │→ │ Validate  │→ │ Store +  │ │    │
│  │  │ Builder     │  │ Stream   │  │ + Score   │  │ Render   │ │    │
│  │  └─────────────┘  └──────────┘  └───────────┘  └──────────┘ │    │
│  └──────────────────────────────────────────────────────────────┘    │
│             │                                                         │
│  ┌──────────▼───────────────────────────────────────────────────┐    │
│  │           Export Pipeline                                      │    │
│  │  Markdown  │  JSON  │  PNG (html-to-image)  │  ZIP Bundle    │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                       │
└───────────────────────────┬───────────────────────────────────────────┘
                            │ HTTPS (fetch + streaming)
                            ▼
              ┌──────────────────────────┐
              │  Vercel Edge Functions    │
              │  (proxy + cache + queue)  │
              └──────────┬───────────────┘
                         ▼
              ┌──────────────────────────┐
              │  Google Gemini API        │
              │  (streaming endpoint)     │
              └──────────────────────────┘
```

### Key Metrics to Track Post-Implementation

| Metric | Current (Estimated) | Target |
|--------|-------------------|--------|
| Bundle generation time | ~21s | <5s |
| Time to first visible content | ~3s | <500ms |
| Artifact re-render time | ~100ms | <16ms |
| localStorage write time | ~50ms (growing) | <10ms (debounced) |
| Max stored data size | ~5MB (localStorage limit) | Unlimited (IndexedDB) |
| Artifact types with structured rendering | 0 of 7 | 7 of 7 |
| Image/visual artifact types | 0 | 3+ |
| Export formats | 1 (markdown) | 4 (md, json, png, zip) |

---

*End of Audit*
