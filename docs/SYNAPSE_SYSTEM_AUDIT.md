# Synapse — "How It Actually Works" System Audit

> Source material for redesigning the **Meet Synapse** (`/about`) onboarding.
> Reverse-engineered from the live codebase (branch `claude/synapse-audit-onboarding-J170Q`), not from marketing copy.
> Every major claim carries a route/component reference and a confidence level (High / Medium / Low).
>
> **⚠️ Headline corrections (read first):**
> 1. The README/CLAUDE.md/current onboarding describe a **"Markup Image" annotation feature** (5 annotation types, `MarkupImageSpec → SVG`). **It does not exist** — verified by exhaustive grep (no spec type, renderer, canvas, toolbar; only one orphaned `markup_image` label). Do not put it in the new onboarding.
> 2. **Mockups have no HTML generation and no chat/refine loop.** A mockup is a *deterministic spec* derived from the Screen Inventory + Component Inventory, optionally rendered to PNG images via **OpenAI gpt-image-2**. There is **no mockup config modal** — platform/fidelity/scope are auto-derived.
> 3. **Per-artifact natural-language "Refine" is dead code** (`refineCoreArtifact` is defined/exported but has no UI caller). The only iteration on an artifact is whole-slot **regenerate**.
> 4. **The homepage at `/` is login-gated** — a first-time visitor sees the recruiter-portal LoginPage, not the PRD creator.
> See Deliverable 11 for the full accuracy table.

---

# Deliverable 1 — Executive Summary

### What is Synapse?

Synapse is an **AI-native product-definition environment** that turns a plain-language product idea into a **structured PRD**, and then carries that PRD forward into **UI mockups** and **seven developer-ready engineering artifacts** — all inside a single, fully client-side React workspace. The tagline in the actual UI is *"From plain-language to product blueprint"* (`HomePage.tsx:265-270`). State lives entirely in the browser (Zustand + `localStorage`; mockup images in IndexedDB); the app calls Google Gemini directly from the browser, with no product-side backend. *(Confidence: High)*

What makes it more than a chat wrapper is its **document model**. The PRD is not a blob of markdown — it's a typed `StructuredPRD` object generated section-by-section through a **10-section dependency DAG**, rendered deterministically to markdown. On top of that document sits a **highlight-to-branch refinement loop**: select any passage, pick an intent, have a threaded AI conversation about just that passage, then consolidate the result back into a new version of the document. Everything is versioned and logged to a history timeline. *(Confidence: High)*

The journey has a hard gate in the middle. You refine the PRD freely, but **nothing downstream generates until you "Mark as Final."** Marking final unlocks the **Workspace** stage and kicks off parallel artifact generation. A **code-level safety classifier** runs before any generation and can block a project entirely, replacing the PRD with a Safety Review. *(Confidence: High)*

### Primary job-to-be-done

> *"I have a product idea in my head. Give me a rigorous, structured, editable product blueprint — and the downstream engineering artifacts to start building — without me writing the PRD, the screen list, the data model, and the implementation plan by hand."*

The user is hiring Synapse to **collapse the gap between an idea and a buildable spec**, and to keep that spec **coherent and versioned** as it evolves. The differentiator in the JTBD is *structure + traceability*, not just *text generation*. *(Confidence: High)*

### What differentiates Synapse

| Compared to | Synapse's actual difference (evidence-based) |
|---|---|
| **ChatGPT / Claude** | Output is a **typed, versioned document with a dependency graph**, not a chat transcript. Refinement is anchored to specific passages (branches) and merged back; history is tracked. *(High)* |
| **Lovable / Bolt / v0** | Synapse stops at the **specification layer** — PRD, screen inventory, data model, component inventory, implementation plan, prompt pack. It produces *mockups* (HTML + optional AI images) but **does not generate a running app or production code**. It's "define the product," not "ship the app." *(High)* |
| **Figma AI** | Synapse is **spec-first, not canvas-first**. Mockups are downstream of the PRD and exist to validate it, not to be the deliverable. No vector design canvas. *(High)* |
| **Traditional PRD tools (Notion/Confluence templates, Productboard)** | The PRD is **AI-generated against a quality rubric**, **section-regenerable**, and **mechanically linked** to downstream artifacts with **staleness detection** when the spine changes. *(High)* |

---

# Deliverable 2 — Actual User Journey

> Routes: `/` (HomePage) → `/p/:projectId` (ProjectWorkspace). Onboarding lives at `/about`.

### Step 1 — Describe the idea
- **Name:** Project Creation / Entry Point
- **Purpose:** Capture the raw idea + target platform.
- **User Action:** Enter a **project name** (required) and a product idea in the textarea; pick **App** or **Web** (`ProjectPlatform`, defaults to **App**); optionally upload a `.md/.txt` brief (appended to the prompt) or click **Enhance** to have the AI rewrite the rough prompt into a richer brief. Submit is disabled until both name and prompt are non-empty.
- **AI Action:** (Enhance only) `enhancePrompt()` rewrites the prompt via Gemini. On submit, if no `GEMINI_API_KEY` is stored, the Settings modal opens and no project is created.
- **Output:** A staged prompt + platform selection.
- **Evidence:** `HomePage.tsx:84, 95-101, 247-251, 264-265, 398-440` *(Confidence: High)*
- **⚠️ Gate:** The homepage is only reachable when logged in (`App.tsx:16-29`); otherwise `/` renders `LoginPage`. *(High)*

---

### Step 2 — Generate the PRD (drops you into the workspace)
- **Name:** Structured PRD Generation
- **Purpose:** Turn the prompt into a structured product spec.
- **User Action:** Click **"Generate PRD →"**. The app immediately navigates to `/p/:projectId` — generation happens *in the workspace*, not on a loading screen.
- **AI Action:** `generateStructuredPRD()` runs a **safety classification first**, then a **10-section concurrent DAG** (each section a separate Gemini JSON-mode call across fast/strong model tiers). Sections paint in progressively as they complete.
- **Output:** A `StructuredPRD` object (spine version `v1`), rendered to markdown; a live **Progress Timeline** shows the DAG filling in across concurrency waves.
- **Evidence:** `HomePage.tsx:95-170`, `prdService.ts:38-90`, `progressivePrdGeneration.ts:83-94`, `components/progress/*` *(Confidence: High)*

---

### Step 2b — (Branch) Safety block
- **Name:** Safety Review
- **Purpose:** Refuse disallowed projects coherently (not section-by-section).
- **User Action:** None — automatic.
- **AI Action:** If the classifier returns `disallowed`, `SafetyBlockedError` is thrown before any section runs; if `allowed_with_restrictions`, a restriction directive is appended to every section prompt.
- **Output:** For blocked: a **Safety Review** doc replaces the PRD and downstream generation is hard-disabled. For restricted: PRD renders with a `SafetyBoundariesCard`.
- **Evidence:** `classifyProjectSafety.ts`, `prdService.ts:59-72`, `SafetyReviewView.tsx`, `SafetyBoundariesCard.tsx` *(Confidence: High)*

---

### Step 3 — Read & refine the PRD (the core loop)
- **Name:** PRD Refinement via Highlight-to-Branch
- **Purpose:** Iterate on specific passages without regenerating the whole doc.
- **User Action:** **Highlight any text** in the PRD → a contextual action dialog appears → pick an intent (**Clarify / Expand / Specify / Alternative / Replace**) or type a custom instruction → have a threaded conversation in the branch panel.
- **AI Action:** `createBranch` seeds a branch anchored to the selected text; `replyInBranch` returns suggestions including a "Suggested replacement" block.
- **Output:** An **active Branch** with a message thread, keyed to the current spine version.
- **Evidence:** `useSelectionPopover.ts`, `SelectionActionDialog.tsx:10`, `SelectableSpine.tsx`, `StructuredPRDView.tsx`, `BranchList.tsx` *(Confidence: High)*

---

### Step 4 — Consolidate the branch
- **Name:** Consolidation
- **Purpose:** Merge a branch's decisions back into the document as a new version.
- **User Action:** Click **"Consolidate to Document"**, choose **Local Patch** (rewrite just the anchor) or **Doc-Wide Rewrite** (rewrite the whole PRD).
- **AI Action:** `consolidateBranch()` runs a Gemini pass; commit replaces text and creates a **new spine version** (`isLatest` flips), marks the branch `merged`, and logs a `Consolidated` history event.
- **Output:** A new PRD version; branch closed.
- **Evidence:** `ConsolidationModal.tsx`, `branchService.ts:10-48`, `branchSlice.ts:66-120` *(Confidence: High)*
- **⚠️ Caveat:** Merge only updates the **markdown** (`responseText`), not `structuredPRD`, so the Structured View can go stale after a consolidation. *(Confidence: High)*

---

### Step 5 — (Optional) Regenerate
- **Name:** Whole-PRD or Single-Section Regeneration
- **Purpose:** Re-roll the document or fix one failed/weak section.
- **User Action:** **Regenerate** (whole PRD; disabled while branches exist or viewing an old version) or, on a failed section, **Run again**.
- **AI Action:** Whole: full DAG re-run, new version. Single: `regeneratePrdSection()` re-runs one section using the current PRD as context, shallow-overlays the new slice.
- **Output:** New spine version (whole) or in-place section update (single).
- **Evidence:** `ProjectWorkspace.tsx:175-298`, `prdSectionRetry.ts:41-109` *(Confidence: High)*

---

### Step 6 — Mark as Final (the pivotal gate)
- **Name:** Finalize PRD
- **Purpose:** Lock the spine and unlock downstream generation.
- **User Action:** Click **Mark as Final** (CheckCircle).
- **AI Action:** Sets `spine.isFinal = true`, advances `currentStage` to `workspace`, and calls `artifactJobController.startAll()` to begin artifact generation.
- **Output:** Workspace stage unlocked; artifact jobs running.
- **Evidence:** `ProjectWorkspace.tsx:309-327`, `artifactJobController.ts:114-156` *(Confidence: High)*
- **Note:** This gate is **non-obvious in the UI** and is a top onboarding teaching priority.

---

### Step 7 — Workspace: Artifacts
- **Name:** Downstream Artifact Generation
- **Purpose:** Produce the 7 engineering artifacts.
- **User Action:** Marking the PRD final auto-starts a **bundle** of all 8 slots (7 artifacts + mockup). Per-slot **Retry/Regenerate** on error; browse each artifact in the workspace left rail. (There is **no** per-artifact natural-language refine in the UI — `refineCoreArtifact` exists but is unwired.)
- **AI Action:** `generateCoreArtifact()` per type. Five use Gemini **JSON mode** (`screen_inventory`, `data_model`, `component_inventory`, `design_system`, `implementation_plan`); `user_flows` and `prompt_pack` stream markdown. Generation runs in **topological layers** (≤4 core concurrent): L1 screen/data/impl/design → L2 user_flows/component → L3 prompt_pack. Each version is auto-**validated** (warnings stored on metadata).
- **Output:** Versioned artifacts. **Note:** validation warnings are computed but **not surfaced in the UI**, and **only mockups show a staleness badge** (core artifacts don't).
- **Evidence:** `coreArtifactService.ts:370`, `artifactJobController.ts:458`, `coreArtifactPipeline.ts:270`, `artifactValidation.ts:36`, `ArtifactWorkspace.tsx` *(Confidence: High)*

---

### Step 8 — Workspace: Mockups
- **Name:** UI Mockup Generation
- **Purpose:** Visualize screens from the finalized PRD.
- **User Action:** Mockup is one of the auto-generated bundle slots. **There is no config modal** — `buildAutoMockupSettings()` hardcodes scope `key_workflow`, maps platform from the project (`app→mobile`, else `desktop`), and picks fidelity by PRD richness. The user can **Regenerate Mockup** and, per screen, **Generate high quality** / **Redo** images. The `MockupSettings` fields `style`, `safeMode`, `selectedSections`, `fidelity:'low'`, and non-`key_workflow` scopes exist in the type but are **unreachable** from the UI.
- **AI Action:** `generateMockup()` is **deterministic** — it reads the preferred Screen Inventory + Component Inventory, selects screens by scope, and emits a `MockupPayload` spec (`mockup_spec_v1`). **No LLM call.** Separately, if an `OPENAI_API_KEY` is set, `artifactJobController` fire-and-forgets `gpt-image-2` PNG generation per screen (`mockupImageService` builds the prompt from screen elements + design tokens; images stored in **IndexedDB**).
- **Output:** A `mockup` artifact = `MockupScreen[]` (name/purpose/coreUIElements/componentRefs) + optional per-screen images at low/medium/high quality. Versioned; staleness-tracked (incl. design-token drift).
- **Evidence:** `mockupService.ts:156`, `mockupDefaults.ts:330`, `mockupImageService.ts:41`, `openaiClient.ts:12`, `MockupViewer.tsx`, `types/index.ts:667-700` *(Confidence: High)*

---

### Step 9 — Convert Implementation Plan to Tasks
- **Name:** Task Export
- **Purpose:** Turn the implementation plan into trackable tasks.
- **User Action:** On the Implementation Plan artifact, click **Convert to Tasks**; edit the list; export.
- **AI Action:** None — **deterministic** parser (`extractTasksFromMarkdown`) infers type/priority/complexity by heuristics. Export targets: **Markdown**, **GitHub**, **Linear** (Linear may be mocked).
- **Output:** Editable task list + export.
- **Evidence:** `taskExtractor.ts`, `ConvertToTasksModal.tsx`, `ArtifactWorkspace.tsx:293-307` *(Confidence: High)*

---

### Step 10 — History & version viewing (throughout)
- **Name:** History Timeline
- **Purpose:** Audit and revisit every change.
- **User Action:** Open **History** stage or the sidebar History Mode; click an event to view that spine version read-only; **Return to latest**.
- **AI Action:** None.
- **Output:** Chronological log (Init, Regenerated, Consolidated, Artifact*, Feedback*, GenerationFailed) with inline diff snippets.
- **Evidence:** `HistoryView.tsx`, `ProjectWorkspace.tsx:712-748`, `types/index.ts:769-794` *(Confidence: High)*

---

### Step 11 — (Owner-only) Cloud Snapshots
- **Name:** Snapshot save/restore
- **Purpose:** Persist a whole project (state + images) across devices.
- **User Action:** Overflow menu → **Cloud Snapshots** (only visible with owner token).
- **AI Action:** None — pushes to Vercel Blob.
- **Output:** Restorable project bundle.
- **Evidence:** `SnapshotsPanel.tsx`, `snapshotClient.ts`, README §6 *(Confidence: High)*

---

# Deliverable 3 — System Map

```
                 Product Idea (prompt + platform, optional Enhance)
                              │   [HomePage]
                              ▼
                 ┌─────────────────────────┐
                 │  SAFETY CLASSIFIER       │── disallowed ─▶ Safety Review (PRD blocked)
                 └─────────────────────────┘
                              │ allowed / allowed_with_restrictions
                              ▼
            10-SECTION PRD DAG  (concurrent, fast+strong tiers)
            product_basics → thesis/grounding → features →
            data_model/ux_loops → architecture → risks/impl_plan → metrics
                              │  [Progress Timeline streams sections in]
                              ▼
        ┌──────────────  STRUCTURED PRD (spine v1)  ──────────────┐
        │                  [PRD stage]                            │
        │  Highlight → Intent → Branch → Conversation             │◀── Feedback cards (apply → branch)
        │            └────── Consolidate ──────┐                  │
        │                                      ▼                  │
        │                          New spine version (v2, v3…)    │
        └──────────────────────────┬──────────────────────────────┘
                                    │  ★ MARK AS FINAL  (the gate)
                                    ▼
                         ┌──────── WORKSPACE stage ────────┐
                         │                                 │
                  7 CORE ARTIFACTS                    UI MOCKUPS
            screen_inventory, user_flows,      deterministic spec (from
            component_inventory, data_model,   screen+component inventory) +
            implementation_plan, prompt_pack,  optional gpt-image-2 images
            design_system
                         │                                 │
                  Convert to Tasks                    (staleness vs spine)
                  (MD / GitHub / Linear)
                                    │
                                    ▼
                         HISTORY (every event, all stages, with diffs)
                                    │
                                    ▼
                    Cloud Snapshots (owner-only persistence)
```
*(Confidence: High. Note: "Mockups" and "Artifacts" both live under the single `workspace` stage; "markup/SVG annotation" is NOT in this map because it doesn't exist.)*

---

# Deliverable 4 — Stage Inventory

`PipelineStage = 'prd' | 'workspace' | 'history' | 'mockups' | 'artifacts'` — the last two are **legacy** (no longer settable; migrated to `workspace`/`prd` on rehydrate). The active UI (`PipelineStageBar`) exposes exactly three tabs: **PRD**, **Workspace** (locked until `isFinal`), **History**. *(Evidence: `types/index.ts:3`, `PipelineStageBar.tsx:10-21`, `projectStore.ts:39-58`; Confidence: High)*

### Stage A — Entry / Project Creation *(pre-stage, on `/`)*
- **Purpose:** Capture idea + platform, optionally enhance.
- **Inputs:** Free-text prompt, platform (web/mobile).
- **Outputs:** New project + spine v1, navigation into workspace.
- **User Controls:** Prompt textarea, platform toggle, Enhance, Generate PRD, recent-projects list, Settings.
- **AI Responsibilities:** Optional prompt enhancement.
- **Typical Iteration:** Re-edit prompt, re-enhance, pick examples.
- **Evidence:** `HomePage.tsx` *(High)*

### Stage 1 — PRD (`currentStage === 'prd'`)
- **Purpose:** Generate, read, and refine the structured PRD.
- **Inputs:** Prompt + platform → DAG; user highlights/branches/feedback.
- **Outputs:** Versioned `StructuredPRD` spines; branches; consolidated versions.
- **User Controls:** Structured/Markdown view, highlight-to-branch, Regenerate, single-section Run again, Mark Final, Export, feedback apply, view old versions.
- **AI Responsibilities:** Safety classification, 10-section generation, branch replies, consolidation rewrites.
- **Typical Iteration:** Highlight → intent → consolidate; section regenerate; whole regenerate.
- **Evidence:** `ProjectWorkspace.tsx`, `StructuredPRDView.tsx`, `SelectableSpine.tsx`, `BranchList.tsx`, `FeedbackItemsList.tsx` *(High)*

### Stage 2 — Workspace (`currentStage === 'workspace'`, gated by `isFinal`)
- **Purpose:** Produce downstream artifacts + mockups.
- **Inputs:** The finalized spine (+ upstream artifacts as context).
- **Outputs:** 7 core artifacts (versioned), a mockup spec (+ optional gpt-image-2 images), task exports.
- **User Controls:** Left-rail slot navigation; per-slot **Retry/Regenerate**; per-screen image quality controls; **Convert to Tasks**; Cancel All / Resume bundle. (No per-artifact NL refine; no mockup config modal.)
- **AI Responsibilities:** Core-artifact generation (JSON-schema + streaming markdown) and image-prompt assembly. Mockup *spec* is deterministic (no LLM).
- **Typical Iteration:** Regenerate a slot; regenerate the whole mockup; bump a screen image to high quality.
- **Evidence:** `ArtifactWorkspace.tsx`, `coreArtifactService.ts`, `mockupService.ts:156`, `ConvertToTasksModal.tsx` *(High)*

### Stage 3 — History (`currentStage === 'history'`)
- **Purpose:** Audit log + version revisiting.
- **Inputs:** All recorded `HistoryEvent`s.
- **Outputs:** Chronological timeline; read-only old-version viewing.
- **User Controls:** Click event → view version; Return to latest; date grouping.
- **AI Responsibilities:** None.
- **Typical Iteration:** Compare against earlier states (snippet-level only — no true side-by-side diff).
- **Evidence:** `HistoryView.tsx`, `ProjectWorkspace.tsx:712-748` *(High)*

---

# Deliverable 5 — Artifact Inventory

> Synapse generates **three families**: the **PRD** (the spine), the **7 core artifacts**, and **mockups**. There is **no markup/SVG artifact**.

### PRD (the spine)
- **Purpose:** The structured product spec; source of truth for everything downstream.
- **Inputs:** Prompt + platform.
- **Generated From:** Project description via the 10-section DAG.
- **Typical User Actions:** Highlight-to-branch, consolidate, regenerate, mark final.
- **Dependencies / Influences:** Drives **all** artifacts + mockups.
- **Example Value:** A vision/users/features/architecture/risks doc with per-feature priority, acceptance criteria, and dependencies.
- **Evidence:** `StructuredPRD` `types/index.ts:56-92`; `prdService.ts` *(High)*

### Screen Inventory (`screen_inventory`)
- **Purpose:** Enumerate app screens with priority + intent.
- **Inputs/Generated From:** Finalized spine. **JSON schema → card grid.**
- **User Actions:** Generate, refine, regenerate.
- **Dependencies:** Feeds component_inventory, user_flows, implementation_plan, mockups.
- **Evidence:** `coreArtifactService.ts`, `ScreenInventoryRenderer.tsx`, `artifactSchemas.ts` *(High)*

### User Flows (`user_flows`)
- **Purpose:** Step/journey flows between screens.
- **Generated From:** Spine + screen_inventory. **Streaming markdown → flow renderer.**
- **Dependencies:** Depends on screen_inventory.
- **Evidence:** `UserFlowsRenderer.tsx`, `renderers/userFlows/*` *(High)*

### Component Inventory (`component_inventory`)
- **Purpose:** Reusable component library (searchable, filterable, with previews + a11y).
- **Generated From:** Spine + screen_inventory. **JSON schema → searchable card library.**
- **Dependencies:** Depends on screen_inventory; feeds mockups + prompt_pack.
- **Evidence:** `ComponentInventoryRenderer.tsx`, `renderers/componentInventory/*` *(High)*

### Data Model (`data_model`)
- **Purpose:** Entities, fields, relationships.
- **Generated From:** Spine. **JSON schema → entity tables.**
- **Dependencies:** Feeds implementation_plan.
- **Evidence:** `DataModelRenderer.tsx`, `dataModelMarkdown.ts` *(High)*

### Implementation Plan (`implementation_plan`)
- **Purpose:** Milestones/tasks roadmap; the source for task export.
- **Generated From:** Spine. **JSON mode → markdown with a `synapse-plan` JSON fence.**
- **User Actions:** **Convert to Tasks** (MD/GitHub/Linear).
- **Evidence:** `ImplementationPlanRenderer.tsx`, `taskExtractor.ts` *(High)*

### Prompt Pack (`prompt_pack`)
- **Purpose:** Reusable prompts (targets include mockup, coding, ux_critique, testing, launch_copy).
- **Generated From:** Spine + screen + component + design_system. **Generated last (fast tier).**
- **Evidence:** `PromptPackRenderer.tsx`, `PromptTarget` `types/index.ts:759-766` *(High)*

### Design System (`design_system`)
- **Purpose:** Tokens, type scale, spacing — also feeds mockup image generation.
- **Generated From:** Spine. **Streaming markdown → token swatches.**
- **Dependencies:** Its `tokensHash` drives mockup staleness.
- **Evidence:** `DesignSystemRenderer.tsx`, `stalenessSlice.ts:36-53` *(High)*

### Mockups (`Artifact.type === 'mockup'`)
- **Purpose:** Visualize screens.
- **Inputs:** Auto-derived settings + the preferred Screen Inventory & Component Inventory (+ design tokens for images).
- **Generated From:** A **deterministic spec** (no LLM) from screen/component inventories; optional **gpt-image-2** PNGs.
- **User Actions:** Regenerate mockup; per-screen generate/redo image quality; view.
- **Dependencies:** Consumes screen_inventory/component_inventory/design_system; tracks staleness incl. design-token drift.
- **Evidence:** `mockupService.ts:156`, `mockupImageService.ts`, `MockupViewer.tsx` *(High)*

---

# Deliverable 6 — Refinement & Branching Model *(most important)*

### How does branching work?
Highlight PRD text → action dialog → `createBranch` seeds a branch **anchored to that text and keyed to the current spine version**, with the chosen intent as the first message. You converse in the branch (`replyInBranch`), then **consolidate** to merge it into a new spine version (branch → `merged`). Branch statuses defined: `active | resolved | rejected | merged`, but only `active` and `merged` are ever set. *(Evidence: `branchSlice.ts:18-120`, `branchService.ts`; Confidence: High)*

### How does highlighting work?
One **detection-source-agnostic** pipeline shared by both PRD renderers. A hook listens on `document` for `pointerup` (mouse/pen/touch) **and** debounced `selectionchange` (mobile long-press). Validates the selection is inside the PRD container. Desktop = floating popover anchored to the selection; mobile = bottom sheet with ≥44px targets. *(Evidence: `useSelectionPopover.ts`, `selectionPopover.ts`, `SelectionActionDialog.tsx`; Confidence: High)*

### What refinement intents exist?
Exactly **five**, from `SELECTION_ACTIONS` (`SelectionActionDialog.tsx:10`):
**Clarify · Expand · Specify · Alternative · Replace** — plus a free-text custom instruction. Intent helper text (`intentHelper.tsx`) is cosmetic guidance matched by string prefix, **not an AI classifier**. *(Confidence: High)*

### What happens when content is regenerated?
- **Whole PRD:** new spine version, `isLatest` flips, all branches/old-version-viewing disabled during the run.
- **Single section:** `regeneratePrdSection()` re-runs one section with the current PRD as context and shallow-overlays the new slice (sections own disjoint fields) — every other section stays intact.
*(Evidence: `spineSlice.ts:37-73`, `prdSectionRetry.ts`; Confidence: High)*

### What becomes stale?
**Artifacts** (not the PRD) go stale relative to the spine. `getArtifactStaleness` derives state purely (no stored flag): missing data → `outdated`; spine source-ref mismatch → `possibly_outdated`; mockups also compare design-system `tokensHash`. It returns `current` / `possibly_outdated` only (never `outdated` from a spine mismatch). *(Evidence: `stalenessSlice.ts:10-57`, `StalenessBadge.tsx`; Confidence: High)*

### How are dependencies managed?
Two layers: (1) the **PRD DAG** with real `dependencies` per section (`progressivePrdGeneration.ts:83-94`); (2) the **artifact registry** declares dependencies, but at runtime bundle generation only enforces "prompt_pack last" + a concurrency cap of 3 — individual generation uses whatever upstream context exists. So artifact dependencies are **partly aspirational**. *(Evidence: `artifactJobController.ts`, `coreArtifactService.ts`; Confidence: High)*

### How is history tracked?
Distributed writes across slices into one `HistoryEvent` log: `Init, Regenerated, Consolidated, ArtifactGenerated, ArtifactRegenerated, FeedbackCreated, FeedbackApplied, GenerationFailed`. History **persists** (unlike `jobs`/`prdProgress`). *(Evidence: `types/index.ts:769-794`, `HistoryView.tsx`; Confidence: High)*

### How are versions compared?
**There is no true diff/compare view.** "Diff" is only a precomputed `before`/`after` snippet stored on a Consolidated event — and the `after` is the literal placeholder string `"(Consolidated changes)"`. The `matchMode/matchCount/sampleText` diff fields are never populated. Old versions are viewable read-only but **not side-by-side**. *(Evidence: `branchSlice.ts:108`, `HistoryView.tsx:86-91`; Confidence: High)*

### How is feedback tracked?
8 manual feedback types (no AI classifier); statuses `open/accepted/rejected/incorporated`. **Applying** feedback spawns a branch (`[Feedback: …]`) — funneling into the branching pipeline. **⚠️ The creator UI (`FeedbackModal`) is orphaned — imported nowhere — so users currently cannot create feedback items in the running app**; only the consumption list is wired. *(Evidence: `feedbackSlice.ts`, `FeedbackItemsList.tsx`, `FeedbackModal.tsx` unreferenced; Confidence: High)*

### What user mental model should be taught?
> **"Your PRD is a living document, not a chat. Highlight to question a passage; the system tracks that conversation as a branch and merges the decision back as a new version. Everything is versioned and logged. When the PRD is right, Mark it Final — that's what unlocks mockups and engineering artifacts."**

The four pillars: **Structured document · Highlight-to-branch refinement · Versioned history · The Final gate.**

---

# Deliverable 7 — Information Architecture

```
Project
├── Settings (Gemini key, fast/strong models, optional OpenAI key) [browser-level]
├── Spine Versions (v1, v2, …)            ← isLatest / isFinal flags
│   ├── StructuredPRD (10 sections, typed)
│   ├── responseText (rendered markdown)
│   ├── safetyReview (none | restricted | blocked)
│   └── Branches (anchored to a spine version)
│       └── BranchMessages (user / assistant thread)
│             └── Consolidation → new Spine Version
├── Feedback Items (8 types; apply → branch)   [creation UI orphaned]
├── Artifacts
│   ├── core_artifact (7 subtypes) → ArtifactVersions (+ staleness, quality)
│   │     └── implementation_plan → Tasks → export (MD/GitHub/Linear)
│   └── mockup → MockupScreens (HTML + optional gpt-image-2 images in IndexedDB)
├── History Events (Init, Regenerated, Consolidated, Artifact*, Feedback*, Failed)
└── Cloud Snapshot (owner-only; whole project + images → Vercel Blob)
```
*(Confidence: High)*

---

# Deliverable 8 — Feature Inventory

| Feature | Purpose | User Value | Frequency | Criticality |
|---|---|---|---|---|
| Prompt + platform creation | Start a project | Zero-to-spec entry | Once/project | Critical |
| Enhance prompt | Improve rough prompts | Better PRDs | Occasional | Medium |
| Safety classifier | Block disallowed projects | Coherent refusal | Automatic | Critical (system) |
| 10-section PRD DAG | Generate structured PRD | The core output | Once + regen | Critical |
| Progress Timeline | Show DAG generating live | Trust/transparency | Every gen | High (signature UX) |
| Structured vs Markdown view | Read PRD two ways | Readability | Constant | High |
| Highlight-to-branch | Targeted refinement | Precise iteration | Very frequent | Critical |
| 5 refinement intents | Guide the ask | Faster refinement | Very frequent | High |
| Consolidation (local/doc-wide) | Merge branch → version | Coherent evolution | Frequent | Critical |
| Whole regeneration | Re-roll PRD | Fresh start | Occasional | Medium |
| Single-section retry | Fix one section | Surgical recovery | On failure | High |
| Mark as Final | Unlock downstream | The pivotal gate | Once/spine | Critical |
| 7 core artifacts | Engineering specs | Buildable outputs | Per project | Critical |
| Artifact bundle gen | Generate all on finalize | Speed | Per finalize | High |
| Artifact regenerate (per slot) | Re-roll one artifact | Recovery | Occasional | High |
| Staleness detection (mockups only) | Flag outdated mockups | Coherence | Passive | Medium |
| Mockups (deterministic spec) | Visualize screens | Validation | Per project | High |
| Mockup AI images (gpt-image-2) | Hi-fi previews | Polish/demo | Optional (needs OpenAI key) | Medium |
| Convert to Tasks | Plan → trackable tasks | Handoff | Occasional | Medium |
| History timeline | Audit/revisit | Traceability | Occasional | High |
| Cloud Snapshots | Cross-device persistence | Durability | Owner-only | Low (gated) |
| ProjectDrawer | Switch projects | Multi-project | Occasional | Medium |

*(Confidence: High)*

---

# Deliverable 9 — Recommended Onboarding Narrative

If a new user had 30 seconds, teach these **7 concepts**, ranked:

1. **Idea → Structured PRD in one step.**
   *Why:* It's the core promise — a typed, rigorous spec from one prompt.
   *Supporting UI:* HomePage prompt box + the live Progress Timeline filling in 10 sections.

2. **The PRD is a living, versioned document — not a chat.**
   *Why:* Reframes expectations vs ChatGPT.
   *Supporting UI:* StructuredPRDView + version labels + History.

3. **Highlight any text to refine it (branching).**
   *Why:* The signature interaction; how iteration actually happens.
   *Supporting UI:* Selection action dialog (Clarify/Expand/Specify/Alternative/Replace).

4. **Branches consolidate back into new versions.**
   *Why:* Closes the loop; explains why nothing is lost.
   *Supporting UI:* ConsolidationModal + History "Consolidated" events.

5. **"Mark as Final" is the gate that unlocks everything downstream.**
   *Why:* Currently non-obvious; users get stuck here.
   *Supporting UI:* The Mark-Final button + PipelineStageBar advancing to Workspace.

6. **One PRD → 7 engineering artifacts + mockups.**
   *Why:* The payoff; the breadth of output.
   *Supporting UI:* Artifact grid + MockupViewer.

7. **Everything is versioned and traceable; artifacts know when they're stale.**
   *Why:* The differentiator vs ad-hoc AI docs.
   *Supporting UI:* History timeline + staleness badges.

*(Do NOT teach: markup/SVG annotation — it doesn't exist.)*

---

# Deliverable 10 — Screen-by-Screen Explanation Content

### Screen: Home / Create
- **One sentence:** Describe your product idea and Synapse drafts a complete structured PRD.
- **Supporting details:** Pick Web or Mobile; optionally let AI enhance your prompt first.
- **User does:** Types an idea, picks platform, clicks Generate.
- **AI does:** (Optionally) enriches the prompt; then runs safety + PRD generation.
- **Why it matters:** This single action is the whole zero-to-spec promise.

### Screen: PRD Generating (Progress Timeline)
- **One sentence:** Watch your PRD build section-by-section across parallel AI passes.
- **Supporting details:** 10 sections, grouped into concurrency waves, each with a live model + timing chip.
- **User does:** Waits (and can retry a failed section).
- **AI does:** Runs the 10-section dependency DAG.
- **Why it matters:** Transparency builds trust; it's a signature UX moment.

### Screen: PRD Canvas
- **One sentence:** Read and refine a structured PRD by highlighting any passage.
- **Supporting details:** Structured or Markdown view; per-feature priority, acceptance criteria, dependencies.
- **User does:** Highlights text → picks an intent → converses → consolidates.
- **AI does:** Answers in-branch and rewrites passages on consolidation.
- **Why it matters:** This is how iteration works — precise, tracked, reversible.

### Screen: Branch / Consolidation
- **One sentence:** Every refinement is a tracked conversation that merges back as a new version.
- **Supporting details:** Local Patch (just the passage) or Doc-Wide rewrite.
- **User does:** Reviews suggestions, picks scope, consolidates.
- **AI does:** Produces the merged text.
- **Why it matters:** Coherent evolution without losing history.

### Screen: Mark as Final → Workspace
- **One sentence:** Lock the PRD to unlock mockups and engineering artifacts.
- **Supporting details:** Finalizing starts parallel artifact generation automatically.
- **User does:** Clicks Mark as Final.
- **AI does:** Begins generating the 7 artifacts.
- **Why it matters:** The pivotal gate — teach it explicitly.

### Screen: Artifacts
- **One sentence:** One finalized PRD becomes seven developer-ready artifacts.
- **Supporting details:** Screen inventory, user flows, components, data model, implementation plan, prompt pack, design system; refine in natural language.
- **User does:** Generates, refines, converts the plan to tasks.
- **AI does:** Generates schema-validated and streamed artifacts.
- **Why it matters:** The buildable payoff.

### Screen: Mockups
- **One sentence:** See your screens rendered as a structured mockup, optionally with AI-generated images.
- **Supporting details:** Settings are auto-derived from the PRD (no config step); add an OpenAI key to render screen images.
- **User does:** Reviews the mockup; regenerates; bumps a screen image to high quality.
- **AI does:** Assembles the mockup spec deterministically; optionally renders images via gpt-image-2.
- **Why it matters:** Validate the spec visually without leaving the workspace.

### Screen: History
- **One sentence:** Every change is logged and every version is revisitable.
- **Supporting details:** Typed events with snippet diffs; view old versions read-only.
- **User does:** Browses, reopens past versions.
- **AI does:** Nothing.
- **Why it matters:** Traceability is the differentiator.

---

# Deliverable 11 — Accuracy Audit

Comparing the **current `/about` onboarding** (5 infographic slides in `src/components/infographics/`) to reality:

| Existing Claim (current onboarding) | Accurate? | Notes |
|---|---|---|
| Entry: Describe → Select Platform → Enhance → Enter Workspace | ✅ Mostly | Accurate. Minor: you enter the workspace *during* generation, not after. |
| PRD sections shown as: Vision, Users, Problem, Features, Architecture, Risks, Constraints | ⚠️ Partial | Real generation sections are 10: Product Basics, Product Thesis, Domain Grounding, Features, Data Model, UX & Loops, Architecture, Risks, Metrics & Scope, Implementation Plan. The slide lists *rendered* headings, not the actual pipeline. |
| Each feature includes Value, Priority (MoSCoW), Complexity, Acceptance Criteria, Dependencies | ✅ Yes | Matches the structured feature shape. |
| Branching loop: Highlight → Choose intent → AI conversation → Consolidate → Commit version → Mark stale | ✅ Mostly | Accurate loop. "Mark stale" applies to *artifacts*, not part of the branch commit itself. |
| Intents: Clarify, Expand, Specify, Replace, Alternative | ✅ Exact | Matches `SELECTION_ACTIONS`. |
| User actions: Structured View, Markdown View, Highlight to Branch, Mark Final | ✅ Yes | Accurate. |
| Mockups — Platform: Mobile/Desktop/Responsive | ⚠️ Misleading | The *type* has mobile/desktop/responsive, but **there is no mockup config UI** — `buildAutoMockupSettings` auto-derives platform from the project. The user never picks. |
| Mockups — Fidelity: Low/Mid/High | ⚠️ Misleading | Type values exist, but **auto-derived** by PRD richness; `'low'` is never auto-selected and the user can't choose. |
| Mockups — Scope: Single Screen / Multi-Screen / Key Workflow | ⚠️ Misleading | Labels *match* the type (`single_screen/multi_screen/key_workflow`), but scope is **hardcoded to `key_workflow`** — not user-selectable. |
| Mockup actions: Regenerate, **Compare Versions**, **Extract Feedback** | ❌ Overstated | Only Regenerate (whole mockup) + per-screen image quality exist. No side-by-side compare. Feedback **creation UI is orphaned**. |
| Mockups → "Feedback to PRD" loop | ⚠️ Partial | The apply-feedback→branch path exists, but the *create-feedback* entry point is unwired. |
| Mockups generate **HTML** | ❌ Wrong | No HTML and no LLM call — mockup is a deterministic spec; visuals come from gpt-image-2 images (needs OpenAI key). |
| Artifacts: 7 types (Screen Inventory, User Flows, Component Inventory, Implementation Plan, Data Model, Prompt Pack, Design System) | ✅ Exact | Matches `CoreArtifactSubtype`. |
| Generation controls: Generate All, Generate One, Refine, Refresh Stale | ⚠️ Partial | "Generate All" (bundle) ✅ and per-slot regenerate ✅, but **"Refine" is dead** (`refineCoreArtifact` unwired) and there's no explicit "Refresh Stale" button. |
| **"Markup Image Types": Critique Board, Wireframe Callout, Flow Annotation, Screenshot Annotation, Design Feedback** | ❌ **Does not exist** | **No markup/SVG artifact, no `MarkupImageSpec`, no renderer, no UI. Remove entirely.** Only a `markup_image` *label* survives (`ProjectWorkspace.tsx:155`). |
| History timeline: Init, Regenerated, Consolidated, Artifact Generated/Regenerated, Feedback Created/Applied | ✅ Yes | Matches `HistoryEventType` (also missing `GenerationFailed`). |
| History user actions: View version, **See diffs**, Return to latest | ⚠️ Partial | View version ✅, Return to latest ✅. "See diffs" = snippet-only placeholder (`"(Consolidated changes)"`), not a real diff. |

**Missing capabilities (exist but not represented):**
- Single-section **Run again** retry. *(High)*
- **Safety review / blocking** flow. *(High)*
- **Convert to Tasks** → GitHub/Linear export. *(High)*
- **AI mockup images via gpt-image-2** (separate OpenAI key). *(High)*
- **Cloud Snapshots** (owner-only). *(High)*
- **Live Progress Timeline** with concurrency waves. *(High)*
- **ProjectDrawer** multi-project switching. *(Medium)*

**Features represented but non-existent / overstated:**
- ❌ Markup image types (5) — **does not exist**.
- ❌ "Compare Versions" / "See diffs" — **no real diff/compare**.
- ❌ Mockup HTML generation / config modal — **neither exists**; spec is deterministic, settings auto-derived.
- ❌ Per-artifact natural-language "Refine" — **dead code**, no UI.
- ⚠️ "Extract Feedback" from mockups — **creator UI orphaned**.

**Other significant realities not in the onboarding (must inform redesign):**
- 🔒 **The homepage is login-gated** — first-time visitors at `/` see the recruiter LoginPage, not the PRD creator. *(High)*
- Mockup images require a **separate OpenAI key**; without it, mockups have no visuals. *(High)*
- Only **mockups** show a staleness badge; validation warnings are stored but never shown. *(Medium)*
- `BranchCanvas` "Exploration" returns **hardcoded placeholder drafts** (no LLM) yet can mutate the spine. *(High)*

**Outdated workflows:** The onboarding implies a 7-section PRD; reality is a 10-section concurrent DAG. CLAUDE.md additionally describes a "single-pass" pipeline — the code is actually **multi-section DAG** (CLAUDE.md is stale on this point too).

---

# Deliverable 12 — JSON Summary

```json
{
  "coreWorkflow": [
    "Describe idea + pick platform (optional Enhance)",
    "Safety classification (can block)",
    "Generate structured PRD via 10-section concurrent DAG",
    "Refine PRD: highlight text -> intent -> branch conversation",
    "Consolidate branch -> new spine version",
    "Mark as Final (unlocks downstream)",
    "Generate 7 core artifacts + mockups",
    "Convert implementation plan to tasks (MD/GitHub/Linear)",
    "Review History; revisit versions"
  ],
  "majorStages": [
    { "id": "create", "name": "Entry / Project Creation", "route": "/", "confidence": "High" },
    { "id": "prd", "name": "PRD", "route": "/p/:projectId", "confidence": "High" },
    { "id": "workspace", "name": "Workspace (Artifacts + Mockups)", "route": "/p/:projectId", "gate": "Mark as Final", "confidence": "High" },
    { "id": "history", "name": "History", "route": "/p/:projectId", "confidence": "High" }
  ],
  "artifacts": [
    { "id": "prd", "name": "Structured PRD (spine)", "render": "structured+markdown", "confidence": "High" },
    { "id": "screen_inventory", "name": "Screen Inventory", "render": "json-schema/cards", "confidence": "High" },
    { "id": "user_flows", "name": "User Flows", "render": "markdown/flow", "confidence": "High" },
    { "id": "component_inventory", "name": "Component Inventory", "render": "json-schema/library", "confidence": "High" },
    { "id": "data_model", "name": "Data Model", "render": "json-schema/tables", "confidence": "High" },
    { "id": "implementation_plan", "name": "Implementation Plan", "render": "markdown", "convertsTo": "tasks", "confidence": "High" },
    { "id": "prompt_pack", "name": "Prompt Pack", "render": "markdown", "confidence": "High" },
    { "id": "design_system", "name": "Design System", "render": "markdown/tokens", "feeds": "mockup-images", "confidence": "High" },
    { "id": "mockup", "name": "UI Mockups", "render": "html+gpt-image-2", "config": ["platform","fidelity","scope"], "confidence": "High" }
  ],
  "prdSections": ["Product Basics","Product Thesis","Domain Grounding","Features","Data Model","UX & Loops","Architecture","Risks","Metrics & Scope","Implementation Plan"],
  "refinementActions": ["Clarify","Expand","Specify","Alternative","Replace","Custom instruction","Consolidate (local)","Consolidate (doc-wide)","Regenerate PRD","Retry section","Refine artifact"],
  "userConcepts": [
    "Idea becomes a structured PRD in one step",
    "PRD is a living, versioned document (not a chat)",
    "Highlight any text to refine it (branching)",
    "Branches consolidate into new versions",
    "Mark as Final is the gate that unlocks downstream",
    "One PRD yields 7 artifacts + mockups",
    "Everything is versioned, logged, and staleness-aware"
  ],
  "screens": [
    { "id": "home", "title": "Home / Create" },
    { "id": "prd_generating", "title": "PRD Generating (Progress Timeline)" },
    { "id": "prd_canvas", "title": "PRD Canvas" },
    { "id": "branch_consolidation", "title": "Branch / Consolidation" },
    { "id": "mark_final", "title": "Mark as Final -> Workspace" },
    { "id": "artifacts", "title": "Artifacts" },
    { "id": "mockups", "title": "Mockups" },
    { "id": "history", "title": "History" }
  ],
  "doesNotExist": [
    "Markup/SVG annotation artifact (MarkupImageSpec) and its 5 types",
    "Mockup HTML generation and any mockup config modal",
    "Per-artifact natural-language Refine (refineCoreArtifact unwired)",
    "True side-by-side version diff/compare",
    "Reachable feedback-creation UI (FeedbackModal orphaned)"
  ],
  "notableCaveats": [
    "Homepage at / is login-gated (recruiter LoginPage) for logged-out visitors",
    "Mockups are a deterministic spec; visuals via gpt-image-2 need a separate OpenAI key",
    "Mockup platform/fidelity/scope are auto-derived, not user-selectable (scope hardcoded key_workflow)",
    "Consolidation updates markdown only, not structuredPRD",
    "Only mockups show a staleness badge; validation warnings stored but not shown",
    "BranchCanvas 'Exploration' uses hardcoded placeholder drafts (no LLM)",
    "CLAUDE.md/README describe a single-pass pipeline + markup + HTML-mockup feature that no longer match the code"
  ]
}
```

---

## Evidence & Confidence Notes
- **High-confidence** items are corroborated by direct file reads and/or multiple independent code audits.
- **Markup-image absence** verified by exhaustive grep across `src/` (no `MarkupImageSpec`, no renderer/view/canvas/toolbar components; only one orphaned `markup_image` label).
- **Medium-confidence** items: exact mockup variant/chat UI internals, `'prompt'` artifact type usage, cascade completeness of `deleteProject`.
- Screenshots were not captured (no running instance in this audit); all references are route + component + line citations, which are more precise for verification than screenshots.
