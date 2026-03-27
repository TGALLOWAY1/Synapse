# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Synapse is an AI-native product definition environment that transforms PRDs (Product Requirements Documents) into a dynamic pipeline: structured PRD generation, UI mockups, downstream artifacts, and visual annotations. It is a fully client-side React SPA with no backend database — all state persists in localStorage via Zustand.

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Start Vite dev server at http://localhost:5173
npm run build        # TypeScript check + Vite production build (tsc -b && vite build)
npm run lint         # ESLint (flat config, TS/TSX files only)
npm run preview      # Preview production build
npx tsc --noEmit     # Type-check without emitting
```

No test framework is configured. Playwright is listed as a dev dependency but no test scripts or test files exist.

## Tech Stack

- React 19 + TypeScript + Vite 7
- Tailwind CSS 3 + tailwind-merge + clsx for styling
- Zustand 5 with `persist` middleware (debounced localStorage)
- Google Gemini API called directly from the browser (API key stored in localStorage)
- React Router v7 (2 routes: `/` home, `/p/:projectId` workspace)
- Deployed to Vercel (SPA + serverless functions)

## Architecture

### Two Central Files

1. **`src/lib/llmProvider.ts`** (~950 lines) — All LLM interaction logic. Every AI feature routes through here: PRD generation, mockup generation, 7 core artifact types, artifact refinement, markup image generation, branch consolidation. Uses two call modes: `callGemini()` (sync JSON) and `callGeminiStream()` (SSE streaming). Some artifact types use Gemini's JSON mode (`responseMimeType: "application/json"` + `responseSchema`).

2. **`src/store/projectStore.ts`** (~820 lines) — Single Zustand store (`useProjectStore`) managing all entities: Projects, SpineVersions, Branches, Artifacts, ArtifactVersions, FeedbackItems, HistoryEvents. Includes data migration logic for legacy `devplan`/`prompts` stages.

### Pipeline Flow

```
User prompt → HomePage.createProject() → generateStructuredPRD() → SpineVersion stored
  → PRD stage: SelectableSpine (text selection → branch creation → AI conversation → consolidation)
  → Mockups stage: MockupsView (platform/fidelity/scope config → generateMockup())
  → Artifacts stage: ArtifactsView (7 core types, bundle/individual gen, refinement, validation)
  → History stage: HistoryView (chronological timeline with diffs)
```

### Key Patterns

- **Spine versioning**: PRD evolves through SpineVersions with `isLatest`/`isFinal` flags. Branches fork from highlighted text and consolidate back via `consolidateBranch()`.
- **Artifact versioning**: Each artifact tracks multiple ArtifactVersions with a preferred version. Source refs enable staleness detection against the current spine.
- **Structured output**: Three artifact types (screen_inventory, data_model, component_inventory) use Gemini JSON mode with schemas in `src/lib/schemas/artifactSchemas.ts`, then convert to markdown via `structuredArtifactToMarkdown()`. Dedicated renderers in `src/components/renderers/` parse markdown back to card layouts.
- **Markup images**: `generateMarkupImage()` produces a MarkupImageSpec JSON → `MarkupImageRenderer.tsx` renders as SVG.
- **No backend DB**: All persistence is client-side localStorage. The `api/` directory contains 3 Vercel serverless functions that are legacy/unused — the client calls Gemini directly.

### Component Organization

- `src/components/ProjectWorkspace.tsx` — Main workspace orchestrator for all pipeline stages
- `src/components/SelectableSpine.tsx` — Interactive PRD viewer (text selection → branch creation)
- `src/components/ArtifactsView.tsx` — Core artifact management (bundle gen, individual gen, refine, validate)
- `src/components/MockupsView.tsx` — Mockup generation and version comparison
- `src/components/MarkupImageView.tsx` + `MarkupImageRenderer.tsx` — Visual annotation artifacts
- `src/components/ConsolidationModal.tsx` — Branch merge into spine (local vs doc-wide)
- `src/components/ExportModal.tsx` — Markdown and JSON export
- `src/types/index.ts` — All TypeScript type definitions for the domain model
- `src/lib/intentHelper.tsx` — Intent classification for branch messages
- `src/lib/artifactValidation.ts` — Post-generation quality scoring
