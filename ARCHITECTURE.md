# Synapse Architecture Analysis

## 1. Repository Map

### Top-Level Folders

| Folder/File | Contents | Role |
|---|---|---|
| `src/` | React frontend application (components, store, lib, types) | **Central** — all UI and client-side generation logic |
| `api/` | Vercel serverless functions (3 endpoints) | **Supporting** — legacy API proxies for Gemini |
| `public/` | Static assets (icons) | Supporting |
| `.claude/` | Claude Code configuration (`launch.json`) | Supporting |
| `.vite/` | Vite cache | Build artifact |

### Key Files by Purpose

#### Entry Points
- `index.html` — SPA shell, loads `src/main.tsx`
- `src/main.tsx` — React bootstrap (StrictMode + `createRoot`)
- `src/App.tsx` — Router with 2 routes: `/` (HomePage) and `/p/:projectId` (ProjectWorkspace)

#### Core Orchestration Logic
- `src/lib/llmProvider.ts` — **Central orchestration file** (~948 lines). Contains all LLM interaction logic: Gemini API calls (sync + streaming), PRD generation, dev plan generation, agent prompt generation, mockup generation, core artifact generation, artifact refinement, markup image generation, and branch consolidation.
- `src/store/projectStore.ts` — **Central state management** (~818 lines). Zustand store with persist middleware. Manages projects, spine versions, branches, dev plans, agent prompts, artifacts, artifact versions, feedback items, and history events.

#### Artifact Generation Logic
- `src/lib/llmProvider.ts` — `generateStructuredPRD()`, `generateDevPlan()`, `generateAgentPrompt()`, `generateMockup()`, `generateCoreArtifact()`, `refineCoreArtifact()`, `generateMarkupImage()`
- `src/lib/schemas/artifactSchemas.ts` — Gemini JSON mode schemas for screen inventory, data model, component inventory
- `src/lib/schemas/markupImageSchema.ts` — Gemini JSON mode schema for markup image annotations
- `src/lib/artifactValidation.ts` — Post-generation quality validation for artifact content

#### UI / Editor Logic
- `src/components/ProjectWorkspace.tsx` — Main workspace view; orchestrates all sub-views (PRD, mockups, artifacts, history)
- `src/components/HomePage.tsx` — Project list + creation modal
- `src/components/SelectableSpine.tsx` — Interactive PRD viewer with text selection → branch creation
- `src/components/StructuredPRDView.tsx` — Structured PRD card-based viewer
- `src/components/MockupsView.tsx` — Mockup generation and version comparison
- `src/components/ArtifactsView.tsx` — Core artifact generation (bundle or individual), refinement, feedback
- `src/components/MarkupImageView.tsx` — Markup/annotation image generation
- `src/components/MarkupImageRenderer.tsx` — Canvas/SVG renderer for markup image specs
- `src/components/BranchCanvas.tsx` — Branch conversation canvas
- `src/components/BranchList.tsx` — Branch sidebar list
- `src/components/ConsolidationModal.tsx` — Branch merge/consolidation UI
- `src/components/ExportModal.tsx` — Export PRD/artifacts as markdown or JSON
- `src/components/FeedbackModal.tsx` — Create feedback items from artifact versions
- `src/components/FeedbackItemsList.tsx` — List/manage feedback items
- `src/components/HistoryView.tsx` — Project event timeline with diffs
- `src/components/FeatureCard.tsx` — Feature display card in structured PRD
- `src/components/MilestoneCard.tsx` — Milestone display (legacy dev plan)
- `src/components/AgentPromptCard.tsx` — Agent prompt display (legacy)
- `src/components/PipelineStageBar.tsx` — Navigation tabs (PRD → Mockups → Artifacts → History)
- `src/components/SettingsModal.tsx` — API key and model configuration
- `src/components/renderers/` — Specialized artifact renderers (ScreenInventory, DataModel, ComponentInventory)

#### Backend / API / Service Logic
- `api/generate-prd.ts` — Vercel serverless function: PRD generation via Gemini
- `api/generate-milestones.ts` — Vercel serverless function: milestone generation via Gemini
- `api/generate-agent-prompts.ts` — Vercel serverless function: agent prompt generation via Gemini

> **Note:** The API endpoints appear to be **legacy/unused** — the client-side `llmProvider.ts` calls Gemini directly from the browser using the user's API key stored in localStorage. The API endpoints exist as server-side alternatives but the current flow bypasses them.

#### Utility / Support
- `src/lib/intentHelper.tsx` — Intent detection for branch messages (clarify/expand/specify/alternative/replace)
- `src/components/StreamingText.tsx` — Streaming text display
- `src/components/SkeletonLoader.tsx` — Loading placeholder
- `src/components/StalenessBadge.tsx` — Staleness indicator for artifacts
- `src/types/index.ts` — All TypeScript type definitions

---

## 2. Likely System Shape

### Frontend (Confirmed)
- **Framework:** React 19 + TypeScript + Vite
- **Routing:** React Router v7 (2 routes: home, project workspace)
- **Styling:** Tailwind CSS 3 + tailwind-merge + clsx
- **Icons:** lucide-react
- **Markdown:** react-markdown + remark-gfm + rehype-raw
- **Text highlighting:** mark.js (for branch anchor highlighting in PRD text)
- **Animation:** @formkit/auto-animate

### Backend (Confirmed — minimal)
- **Deployment:** Vercel (serverless functions + SPA)
- **API:** 3 Vercel serverless endpoints in `api/` — but these are **likely legacy**; the current architecture calls Gemini directly from the client
- **No database** — all state is client-side in localStorage via Zustand persist

### State Management (Confirmed)
- **Zustand** with `persist` middleware and custom debounced localStorage adapter
- Single store (`useProjectStore`) managing all entities:
  - Projects, SpineVersions, Branches, HistoryEvents
  - DevPlans, AgentPrompts (legacy, kept for migration compat)
  - Artifacts, ArtifactVersions, FeedbackItems
- Data migration on rehydration (legacy `devplan`/`prompts` stages → `artifacts`)

### Generation / Orchestration (Confirmed)
- **LLM Provider:** Google Gemini API (default model: `gemini-2.5-flash`, configurable)
- **Client-side direct calls** — API key stored in localStorage, calls made from browser
- **Two call modes:** `callGemini()` (sync JSON response) and `callGeminiStream()` (SSE streaming)
- **JSON mode:** Gemini's `responseMimeType: "application/json"` + `responseSchema` for structured output
- **Generation pipeline functions:**
  - `generateStructuredPRD()` — structured JSON → parsed StructuredPRD
  - `generateDevPlan()` — structured JSON → Milestone[]
  - `generateAgentPrompt()` — structured JSON → GeneratedAgentPrompt
  - `generateMockup()` — free-text markdown
  - `generateCoreArtifact()` — JSON mode for supported types, markdown for others
  - `refineCoreArtifact()` — takes existing content + instruction → refined content
  - `generateMarkupImage()` — structured JSON → MarkupImageSpec
  - `consolidateBranch()` — local or doc-wide PRD patching
  - `replyInBranch()` — conversational reply for branch threads

### Artifact / Document / Image Handling (Confirmed)
- **Artifact types:** `prd`, `mockup`, `prompt`, `core_artifact`, `markup_image`
- **Core artifact subtypes:** screen_inventory, user_flows, component_inventory, implementation_plan, data_model, prompt_pack, design_system
- **Versioning:** Each artifact has multiple ArtifactVersions with preferred version tracking
- **Source refs:** Track which spine version an artifact was generated from (staleness detection)
- **Validation:** Post-generation quality scoring (min length, expected headers, structure checks)
- **Structured renderers:** ScreenInventoryRenderer, DataModelRenderer, ComponentInventoryRenderer parse markdown back into structured cards
- **Markup images:** JSON spec → SVG/canvas rendering via MarkupImageRenderer

### Export / Rendering (Confirmed)
- **Markdown export:** Individual PRD or artifacts as `.md` files
- **JSON export:** Structured export with project + PRD + all artifact contents
- **Blob download:** Client-side file generation via `URL.createObjectURL()`

### Configuration / Prompt / Schema Systems (Confirmed)
- **Settings:** Gemini API key + model stored in localStorage (SettingsModal)
- **Prompt templates:** Hardcoded in `llmProvider.ts` — extensive system instructions per generation type
- **JSON schemas:** `artifactSchemas.ts` and `markupImageSchema.ts` define Gemini structured output schemas
- **Structured PRD schema:** Inline in `llmProvider.ts`

---

## 3. Key Entry Points

| File | Purpose | Why Important |
|---|---|---|
| `src/main.tsx` | React app bootstrap | Root render entry |
| `src/App.tsx` | Router definition | Defines the 2 views: HomePage and ProjectWorkspace |
| `src/components/HomePage.tsx` | Project creation & listing | Entry point for new projects; triggers initial PRD generation |
| `src/components/ProjectWorkspace.tsx` | Main workspace orchestrator | Controls all pipeline stages (PRD, Mockups, Artifacts, History); manages regeneration, branching, consolidation, export |
| `src/lib/llmProvider.ts` | All LLM generation functions | Central generation pipeline; every AI-powered feature routes through this |
| `src/store/projectStore.ts` | Global state store | All data operations; persistence; migration |
| `src/types/index.ts` | Type definitions | Defines the entire domain model |
| `src/components/SelectableSpine.tsx` | Interactive PRD text viewer | Core UX innovation — text selection creates branch discussions |
| `src/components/ArtifactsView.tsx` | Core artifact management | Bundle generation, individual generation, refinement, validation |
| `src/components/MockupsView.tsx` | Mockup generation & comparison | Version comparison, multi-fidelity generation |
| `src/components/MarkupImageView.tsx` | Markup image generation | Visual annotation artifacts |
| `src/components/MarkupImageRenderer.tsx` | SVG rendering of markup specs | Renders LLM-generated annotation specs |
| `src/components/ConsolidationModal.tsx` | Branch merge into spine | Local vs doc-wide consolidation |
| `src/components/ExportModal.tsx` | Export functionality | Markdown + JSON export |
| `src/lib/schemas/artifactSchemas.ts` | Gemini JSON schemas | Defines structured output for 3 artifact types |

---

## 4. Initial Architecture Narrative

### What Synapse Is

**SynapsePRD** is a client-side React application for AI-assisted product requirements development. It uses Google's Gemini API to generate structured PRDs (Product Requirements Documents) from a text prompt, then produces a suite of derivative artifacts (mockups, screen inventories, data models, component inventories, implementation plans, prompt packs, design systems, and annotated visual diagrams).

### How It Works End-to-End

```
User enters product idea (text prompt)
  → HomePage.createProject() creates project + initial SpineVersion in Zustand store
  → llmProvider.generateStructuredPRD() calls Gemini with JSON mode schema
  → Gemini returns StructuredPRD JSON → parsed → stored as spine.structuredPRD
  → structuredPRDToMarkdown() converts to markdown → stored as spine.responseText
  → User lands on ProjectWorkspace viewing PRD

User interacts with PRD via SelectableSpine:
  → Text selection → popover → type intent → creates Branch
  → Branch messages → llmProvider.replyInBranch() for AI responses
  → ConsolidationModal → llmProvider.consolidateBranch() → new SpineVersion
  → Spine versions tracked with isLatest/isFinal flags

User navigates pipeline stages (PipelineStageBar):
  PRD → Mockups → Artifacts → History

Mockups stage:
  → User configures platform/fidelity/scope
  → llmProvider.generateMockup() → free-text markdown stored as Artifact + ArtifactVersion
  → Version comparison supported

Artifacts stage:
  → 7 core artifact types available (individual or bundle generation)
  → llmProvider.generateCoreArtifact() with JSON mode for 3 types, markdown for others
  → Structured JSON → structuredArtifactToMarkdown() → stored
  → Specialized renderers (ScreenInventory, DataModel, ComponentInventory) parse markdown back to cards
  → Validation via artifactValidation.ts scores quality
  → Refinement via llmProvider.refineCoreArtifact()
  → Feedback system: FeedbackModal creates FeedbackItems → can become branches

Markup Images:
  → llmProvider.generateMarkupImage() → MarkupImageSpec JSON
  → MarkupImageRenderer renders as SVG on canvas

Export:
  → ExportModal: individual markdown files or bundled JSON

All state persisted to localStorage via Zustand persist with debounced writes.
No backend database — fully client-side architecture.
```

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                     Browser Client                       │
│                                                          │
│  ┌──────────┐    ┌─────────────────┐    ┌────────────┐  │
│  │ HomePage  │───▶│ ProjectWorkspace │───▶│ Export     │  │
│  │ (create)  │    │ (orchestrator)   │    │ (md/json)  │  │
│  └──────────┘    └────────┬────────┘    └────────────┘  │
│                           │                              │
│          ┌────────────────┼────────────────┐             │
│          ▼                ▼                ▼             │
│  ┌──────────────┐ ┌────────────┐ ┌──────────────────┐   │
│  │ PRD View     │ │ Mockups    │ │ Artifacts View   │   │
│  │ (Selectable  │ │ View       │ │ (7 core types +  │   │
│  │  Spine +     │ │ (gen/      │ │  bundle gen +    │   │
│  │  Branches +  │ │  compare)  │ │  refine + valid) │   │
│  │  Consolidate)│ │            │ │                  │   │
│  └──────┬───────┘ └─────┬──────┘ └────────┬─────────┘   │
│         │               │                 │              │
│         └───────────────┼─────────────────┘              │
│                         ▼                                │
│              ┌────────────────────┐                      │
│              │  llmProvider.ts    │                      │
│              │  (Gemini API      │                      │
│              │   client-side     │                      │
│              │   direct calls)   │                      │
│              └────────┬─────────┘                       │
│                       │                                  │
│              ┌────────▼─────────┐                       │
│              │ projectStore.ts  │                       │
│              │ (Zustand +       │                       │
│              │  localStorage)   │                       │
│              └──────────────────┘                       │
└─────────────────────────────────────────────────────────┘
                        │
                        ▼ (HTTPS from browser)
              ┌──────────────────┐
              │ Gemini API       │
              │ (generative-     │
              │  language.       │
              │  googleapis.com) │
              └──────────────────┘
```

---

## 5. Most Important Files to Read Next

### Workflow / Project Management
1. `src/components/ProjectWorkspace.tsx` — Full workspace orchestration (remaining ~400 lines of UI logic)
2. `src/components/ConsolidationModal.tsx` — Branch merge flow details
3. `src/components/BranchCanvas.tsx` — Branch conversation UI
4. `src/components/BranchList.tsx` — Branch management sidebar
5. `src/components/PipelineStageBar.tsx` — Pipeline navigation logic

### Generation Pipeline
6. `src/lib/llmProvider.ts` — Already read in full; deepest generation logic understood
7. `src/lib/artifactValidation.ts` — Already read; validation scoring understood

### Prompt / System Logic
8. `src/lib/schemas/artifactSchemas.ts` — Already read; Gemini schemas understood
9. `src/lib/schemas/markupImageSchema.ts` — Already read
10. `src/lib/intentHelper.tsx` — Already read; intent classification understood

### Artifact Creation & Rendering
11. `src/components/ArtifactsView.tsx` — Full artifact management (remaining ~300 lines)
12. `src/components/MockupsView.tsx` — Full mockup flow (remaining ~300 lines)
13. `src/components/MarkupImageView.tsx` — Markup image generation flow
14. `src/components/MarkupImageRenderer.tsx` — SVG rendering implementation
15. `src/components/renderers/ScreenInventoryRenderer.tsx` — Structured screen rendering
16. `src/components/renderers/DataModelRenderer.tsx` — Structured data model rendering
17. `src/components/renderers/ComponentInventoryRenderer.tsx` — Structured component rendering

### UI / Rendering
18. `src/components/StructuredPRDView.tsx` — Structured PRD card view
19. `src/components/FeatureCard.tsx` — Feature display
20. `src/components/HistoryView.tsx` — Timeline with diffs
21. `src/components/FeedbackModal.tsx` — Feedback creation flow
22. `src/components/FeedbackItemsList.tsx` — Feedback management
23. `src/components/StreamingText.tsx` — Streaming text display
24. `src/components/ExportModal.tsx` — Full export logic (remaining lines)
25. `src/components/SettingsModal.tsx` — Settings implementation

### Configuration
26. `src/App.css` / `src/index.css` — Global styles
27. `vite.config.ts` — Build configuration
28. `PLAN.md` / `PRD.md` — Product documentation (for understanding intent vs implementation)
