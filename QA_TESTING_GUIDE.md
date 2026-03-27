# Synapse User Verification and QA Testing Guide

> **Last updated:** 2026-03-27
> **Codebase version:** Pre-release (v0.0.0)
> **Purpose:** Practical testing guide for verifying Synapse before sharing with users

---

## 1. Product Understanding

### What Synapse Does

Synapse is a client-side React single-page application that transforms a product idea (written as a prompt) into a comprehensive set of structured product artifacts using Google's Gemini AI. It is a **PRD-to-artifact pipeline** with four stages:

1. **PRD Stage** -- Enter a product prompt, generate a structured PRD, refine it through collaborative AI-powered branches
2. **Mockups Stage** -- Generate text-based UI mockups with configurable platform/fidelity/scope settings
3. **Artifacts Stage** -- Generate 7 types of core artifacts (screen inventory, user flows, component inventory, implementation plan, data model, prompt pack, design system) plus 5 types of markup/annotation images
4. **History Stage** -- View a timeline of all project events with diffs

### Architecture Summary

| Layer | Technology | Key Files |
|-------|-----------|-----------|
| Framework | React 19 + TypeScript + Vite 7 | `src/App.tsx`, `src/main.tsx` |
| Routing | React Router v7 (2 routes) | `/` = HomePage, `/p/:projectId` = ProjectWorkspace |
| State | Zustand with persist middleware | `src/store/projectStore.ts` (819 lines) |
| Persistence | localStorage with 500ms debounce | Zustand persist adapter in projectStore |
| AI Provider | Google Gemini API (client-side) | `src/lib/llmProvider.ts` (948 lines) |
| Styling | Tailwind CSS 3 (dark theme) | `tailwind.config.js`, `src/index.css` |
| Deployment | Vercel (SPA + legacy API routes) | `vercel.json` |

### Key Characteristics

- **Fully client-side** -- No backend database; all data in localStorage
- **API key required** -- Users must provide their own Gemini API key
- **No authentication** -- No user accounts; single-user local experience
- **No existing tests** -- Playwright installed but unconfigured; zero test files
- **Dark UI theme** -- Neutral-900 workspace with light content panels
- **23 React components** -- Including views, modals, renderers, and utilities

### Data Model Overview

```
Project
  ├── SpineVersions (PRD versions, one marked isFinal)
  │     └── StructuredPRD (parsed JSON: vision, features, architecture, risks)
  ├── Branches (discussion threads anchored to PRD text)
  │     └── BranchMessages (user/assistant conversation)
  ├── Artifacts (typed containers: prd, mockup, core_artifact, markup_image)
  │     └── ArtifactVersions (versioned content with sourceRefs + isPreferred)
  ├── FeedbackItems (extracted from artifact reviews)
  └── HistoryEvents (audit trail with diffs)
```

---

## 2. Core User Flows to Verify

### Flow 1: First-Time Landing and Onboarding

| Aspect | Detail |
|--------|--------|
| **Goal** | User understands what Synapse does and can get started |
| **Happy path** | Land on `/` → see empty state with "Synapse PRD" heading → click "+" to create project → prompted for API key if missing → enter key in Settings → create project |
| **What could go wrong** | No explanation of what the app does on first visit; empty state may be confusing; API key requirement not immediately obvious; invalid API key accepted silently (validated only on first generation) |
| **Why it matters** | First impression determines whether users continue; unclear onboarding = immediate abandonment |
| **Key files** | `src/components/HomePage.tsx`, `src/components/SettingsModal.tsx` |

### Flow 2: Project Creation and PRD Generation

| Aspect | Detail |
|--------|--------|
| **Goal** | Create a project and get a structured PRD from a prompt |
| **Happy path** | Click "+" → enter project name + prompt → submit → navigate to `/p/:id` → PRD generates asynchronously → structured view appears with features, architecture, risks |
| **What could go wrong** | Navigation happens before PRD is ready (user sees loading/empty); PRD generation fails silently or shows error in markdown; structured PRD JSON parsing fails; prompt too short/vague produces poor output; no loading indicator during generation |
| **Why it matters** | Core value proposition; if this breaks, the entire app is unusable |
| **Key files** | `src/components/HomePage.tsx:16-42`, `src/lib/llmProvider.ts` (generateStructuredPRD), `src/store/projectStore.ts` (createProject) |

### Flow 3: PRD Refinement via Branches

| Aspect | Detail |
|--------|--------|
| **Goal** | Improve specific parts of the PRD through conversational threads |
| **Happy path** | Select text in PRD → popover appears → enter intent → branch created → AI replies → continue conversation → consolidate branch → changes merged into PRD spine |
| **What could go wrong** | Text selection doesn't trigger popover (DOM selection issues); anchor text highlighting breaks after PRD edits; consolidation fails if anchor text no longer exists in spine; branch messages lost during consolidation; Mark.js highlighting inconsistent |
| **Why it matters** | Differentiating feature; collaborative refinement is core to the product's value |
| **Key files** | `src/components/SelectableSpine.tsx`, `src/components/BranchList.tsx`, `src/components/BranchCanvas.tsx`, `src/components/ConsolidationModal.tsx` |

### Flow 4: Marking PRD as Final and Stage Progression

| Aspect | Detail |
|--------|--------|
| **Goal** | Lock the PRD and unlock Mockups and Artifacts stages |
| **Happy path** | Click "Mark Final" → PRD locked → Mockups and Artifacts tabs become enabled → navigate to next stage |
| **What could go wrong** | "Mark Final" unclear (what does it mean? is it reversible?); pipeline stage buttons disabled without explanation; user tries to edit finalized PRD and gets confused; un-finalizing after generating artifacts creates stale state |
| **Why it matters** | Gate between authoring and generation; confusion here blocks all downstream work |
| **Key files** | `src/components/ProjectWorkspace.tsx`, `src/components/PipelineStageBar.tsx` |

### Flow 5: Mockup Generation

| Aspect | Detail |
|--------|--------|
| **Goal** | Generate text-based UI mockups from the PRD |
| **Happy path** | Navigate to Mockups stage → configure settings (platform/fidelity/scope) → click Generate → mockup appears → compare versions side by side |
| **What could go wrong** | Generation takes long with no progress indicator; settings don't affect output meaningfully; version comparison layout broken on small screens; mockup content quality varies wildly; regeneration doesn't clearly differ from original |
| **Why it matters** | Visual artifact that users will evaluate and share; quality here affects perceived product value |
| **Key files** | `src/components/MockupsView.tsx`, `src/lib/llmProvider.ts` (generateMockup) |

### Flow 6: Core Artifact Generation (Bundle and Individual)

| Aspect | Detail |
|--------|--------|
| **Goal** | Generate structured product artifacts from the PRD |
| **Happy path** | Navigate to Artifacts stage → click "Generate All" for bundle generation → 7 artifacts generate (max 3 concurrent) → each appears with structured rendering → can refine individual artifacts |
| **What could go wrong** | Bundle generation partially fails (some artifacts succeed, others fail); concurrency limit causes UI confusion; artifact content doesn't reflect PRD accurately; structured renderers (ScreenInventory, DataModel, ComponentInventory) fail to parse JSON output; staleness badges incorrect after PRD changes; refinement input unclear |
| **Why it matters** | Highest-value output of the entire app; these artifacts are what users export and use |
| **Key files** | `src/components/ArtifactsView.tsx`, `src/components/renderers/`, `src/lib/llmProvider.ts` (generateCoreArtifact, refineCoreArtifact), `src/lib/artifactValidation.ts` |

### Flow 7: Markup Image Generation and Rendering

| Aspect | Detail |
|--------|--------|
| **Goal** | Generate visual annotation diagrams (SVG-rendered) |
| **Happy path** | Navigate to Markup Images tab → select type (Critique Board, Wireframe Callout, etc.) → click Generate → SVG renders with layers (boxes, arrows, callouts, markers) → export SVG |
| **What could go wrong** | Generated MarkupImageSpec has invalid layer coordinates; SVG rendering breaks with certain layer combinations; arrow math produces wrong positions; text overflow in boxes/callouts; export produces broken SVG; canvas dimensions don't match content |
| **Why it matters** | Visual output that is immediately visible; rendering bugs are obvious and embarrassing |
| **Key files** | `src/components/MarkupImageView.tsx`, `src/components/MarkupImageRenderer.tsx`, `src/lib/llmProvider.ts` (generateMarkupImage), `src/lib/schemas/markupImageSchema.ts` |

### Flow 8: Export and Download

| Aspect | Detail |
|--------|--------|
| **Goal** | Export project artifacts as markdown or JSON files |
| **Happy path** | Click Export button → modal shows options (PRD markdown, individual artifacts, full bundle, structured JSON) → click download → file downloads correctly |
| **What could go wrong** | Export content doesn't match what's displayed (preferred version mismatch); JSON export missing fields; markdown formatting broken; file naming inconsistent; large exports fail silently |
| **Why it matters** | Exit point for user value; if exports are broken, all generation work is wasted |
| **Key files** | `src/components/ExportModal.tsx` |

### Flow 9: Feedback Loop (Artifact → PRD)

| Aspect | Detail |
|--------|--------|
| **Goal** | Extract feedback from artifact reviews and feed it back into the PRD |
| **Happy path** | View artifact → click feedback button → fill in feedback form (type, title, description) → feedback appears in PRD stage sidebar → apply to PRD as branch or mark incorporated |
| **What could go wrong** | Feedback items orphaned if source artifact deleted; status transitions inconsistent; "Apply to PRD" creates branch but user doesn't realize they need to consolidate; feedback list empty state confusing |
| **Why it matters** | Closes the refinement loop; without this, the tool is one-shot rather than iterative |
| **Key files** | `src/components/FeedbackModal.tsx`, `src/components/FeedbackItemsList.tsx`, `src/store/projectStore.ts` (feedback actions) |

### Flow 10: Project Management (List, Navigate, Delete)

| Aspect | Detail |
|--------|--------|
| **Goal** | Manage multiple projects from the home page |
| **Happy path** | Home page shows project cards → click to open → use back button to return → delete unwanted projects |
| **What could go wrong** | Delete has no confirmation dialog (data loss risk); project cards show stale info; navigating to deleted/invalid project shows blank page; browser back button behavior inconsistent with SPA routing |
| **Why it matters** | Basic project management; data loss from accidental deletion is unacceptable |
| **Key files** | `src/components/HomePage.tsx`, `src/App.tsx` |

### Flow 11: Settings and API Key Management

| Aspect | Detail |
|--------|--------|
| **Goal** | Configure Gemini API key and model selection |
| **Happy path** | Click settings gear → enter API key → select model → close modal → key persists across sessions |
| **What could go wrong** | Invalid API key accepted (no validation); key visible in localStorage (no encryption); changing model mid-project affects generation quality; settings not accessible during generation |
| **Why it matters** | Required for any generation; broken settings = broken app |
| **Key files** | `src/components/SettingsModal.tsx`, `src/lib/llmProvider.ts` (getApiKey, getModel) |

### Flow 12: History and Audit Trail

| Aspect | Detail |
|--------|--------|
| **Goal** | Review timeline of all project changes |
| **Happy path** | Navigate to History tab → see chronological events → expand diffs for spine changes → understand project evolution |
| **What could go wrong** | History events missing for some actions; diff display broken for large changes; events not sorted correctly; history grows unbounded with no pagination |
| **Why it matters** | Transparency and undo-ability; users need to understand what changed and when |
| **Key files** | `src/components/HistoryView.tsx`, `src/store/projectStore.ts` (history actions) |

### Flow 13: Data Persistence and Recovery

| Aspect | Detail |
|--------|--------|
| **Goal** | Work persists across page refreshes and browser sessions |
| **Happy path** | Make changes → close tab → reopen → all data intact → correct project/stage loaded |
| **What could go wrong** | 500ms debounce means very recent changes lost on crash; localStorage quota exceeded for large projects (~5MB limit); state migration fails on schema changes; corrupted localStorage leaves app in broken state |
| **Why it matters** | Users lose trust immediately if work disappears; persistence bugs are catastrophic |
| **Key files** | `src/store/projectStore.ts` (persist middleware, onRehydrateStorage) |
