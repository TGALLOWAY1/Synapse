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
