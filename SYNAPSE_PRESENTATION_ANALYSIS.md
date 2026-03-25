# Synapse Technical Analysis for Infographic and Recruiter Deck

## 1. Executive Summary

Synapse is an AI-native product definition workspace that turns a vague product idea into a structured PRD, then carries that PRD forward into downstream artifacts such as text mockups, implementation-oriented specs, design-system starters, and feedback-driven revisions. It is best understood as a workflow product for transforming early-stage product thinking into a reusable, versioned, and reviewable system of artifacts rather than a one-shot text generator.

What makes it technically interesting is that it treats the PRD as the canonical source object in a broader artifact pipeline. The app is not organized around a single chat thread. It is organized around a persistent project model with versioned PRD spines, anchored branch conversations, immutable derived artifact versions, provenance tracking, staleness detection, and a feedback loop that can reopen PRD work from downstream outputs.

From an engineering perspective, Synapse is nontrivial because it combines:

- Rich client UX for structured editing, markdown rendering, text selection, and version navigation
- LLM orchestration with both schema-constrained and freeform generation
- A reusable artifact/version domain model instead of ad hoc one-off outputs
- A local-first workflow engine with multi-step state transitions and history
- Product-minded UX decisions that hide workflow complexity behind a clean interface

The project demonstrates strong skills in full-stack product engineering, AI-assisted workflow design, prompt orchestration, state modeling, versioned content pipelines, artifact generation, and demo-oriented frontend execution.

### Recruiter Takeaways

- **Full-stack product engineering:** Synapse is a complete interactive product, not a script or backend demo. It includes routing, persistent state, multi-view workspace UI, generation flows, export, and history.
- **AI-assisted artifact generation:** The system uses Gemini for structured PRD generation, text mockups, artifact bundles, and branch consolidation through dedicated generation functions in `src/lib/llmProvider.ts`.
- **Schema-driven prompt/system design:** Structured PRDs, dev plans, and coding prompts are generated with JSON schemas and parsed into typed domain objects, which is a stronger signal than plain freeform prompting.
- **Workflow orchestration:** The project models idea -> PRD -> mockups/artifacts -> feedback -> PRD revision as a connected system rather than isolated buttons.
- **Versioned artifact architecture:** `Artifact`, `ArtifactVersion`, `SourceRef`, `FeedbackItem`, and `HistoryEvent` create a reusable foundation for extensible downstream generation.
- **Rich client architecture:** The workspace merges structured editing, markdown rendering, text-range interaction, sidecar review flows, and version navigation in one React SPA.
- **UX and product judgment:** The structured/markdown toggle, stage gating, feedback cards, compare views, and staleness badges show product thinking beyond CRUD.
- **Presentation-quality output generation:** Although outputs are text-first, they are organized as recruiter- and builder-friendly deliverables such as implementation plans, prompt packs, data models, and design-system starters.
- **Extensibility-aware system design:** The artifact model already anticipates more artifact types and deeper pipelines, even where some parts remain partial.
- **Strong prototype-to-product signal:** The codebase is compact, coherent, builds cleanly, and feels demo-ready while still containing meaningful orchestration logic.

## 2. Project Purpose and User Value

### What Synapse is for

Synapse is intended to help a user take a rough product idea and turn it into a structured, iteratively refined product specification that can drive downstream design and implementation work.

The likely target users are:

- Founders or early-stage product builders shaping a new product concept
- Product managers or product-minded engineers drafting an initial specification
- Designers or frontend engineers exploring possible UI directions from a PRD
- Developers who want build-oriented artifacts, prompt packs, and implementation plans derived from a canonical source

### Core user workflow

The implemented user flow is:

1. Create a project with a name and initial idea prompt.
2. Generate a structured PRD using Gemini JSON mode.
3. View the PRD either as editable structured sections or as markdown.
4. Highlight text and create anchored branches for clarification, expansion, alternatives, or replacements.
5. Consolidate branch work back into a new PRD version.
6. Mark a PRD version as final.
7. Generate text mockups and a bundle of core artifacts from the finalized PRD.
8. Create feedback items from mockups or artifacts.
9. Apply feedback back into the PRD workflow.
10. Review the full project timeline and export the PRD as markdown.

### What outputs it creates

Implemented outputs include:

- Structured PRD object stored on the spine
- Markdown PRD content derived from the structured PRD
- Exported `.md` PRD files with version/final metadata
- Text-based UI mockups with settings such as platform, fidelity, and scope
- Seven core artifact types:
  - Screen Inventory
  - User Flows
  - Component Inventory
  - Implementation Plan
  - Data Model Draft
  - Prompt Pack
  - Design System Starter
- Feedback items linked to artifact versions
- Project history/timeline events

### What pain point it solves

The core pain point is that product definition work is usually fragmented across static docs, chats, whiteboards, and downstream implementation notes. Synapse tries to turn product thinking into an iterative system:

- The PRD becomes editable and branchable instead of fixed prose.
- Downstream outputs stay tied to the specific PRD version they came from.
- Changes to the PRD create visible staleness in derived artifacts.
- Design feedback can re-enter the spec workflow rather than being lost in comments or screenshots.

### Best product framing

Synapse is best framed as a hybrid of:

- an AI-assisted product creation tool
- a structured ideation and design system
- a PRD-to-artifact generator
- an internal workflow engine for specification refinement

The strongest recruiter-facing framing is:

> Synapse is an AI-native product definition workspace that converts an initial idea into a structured PRD and a versioned set of downstream design and implementation artifacts, with branching, consolidation, feedback loops, and artifact provenance built in.

That framing is stronger than calling it a recruiter portfolio tool, because the repo itself is clearly a workflow product. The recruiter value comes from what building it demonstrates, not from the app being specifically targeted at recruiters.

## 3. Architecture Overview

### Architecture narrative

Synapse is primarily a client-side React/Vite application with a rich local domain model and direct Gemini API integration from the browser. The frontend owns nearly all orchestration, state, and workflow logic. Zustand with persistence acts as the local application database. The LLM layer is centralized in a provider module that exposes purpose-built generation functions for PRDs, mockups, artifacts, branch replies, and consolidation.

The most important architectural move is the separation between:

- the canonical PRD spine
- branch discussions attached to that spine
- derived artifact containers and their immutable versions
- feedback and history metadata that connect everything back together

This gives the application a workflow backbone instead of a page-per-feature structure.

### Component breakdown

#### Frontend responsibilities

- Project/session creation and routing
- PRD workspace rendering and stage navigation
- Structured PRD editing and markdown rendering
- Text selection, anchored branching, and branch conversation UI
- Consolidation preview and commit flow
- Mockup generation configuration and version comparison
- Artifact generation, browsing, and staleness display
- Feedback capture and PRD re-entry
- History timeline rendering
- Export and settings management

#### Backend responsibilities

Implemented backend responsibilities are minimal and currently optional:

- Three Vercel serverless handlers exist in `api/`
- They can proxy Gemini requests and accept server-side env keys or `x-api-key`
- The frontend currently does not use them

In practice, the shipping app uses direct browser-to-Gemini calls through `src/lib/llmProvider.ts`.

#### Generation and orchestration layers

- `src/lib/llmProvider.ts` centralizes prompt construction and Gemini calls
- `src/store/projectStore.ts` centralizes workflow state transitions and derived metadata
- `src/components/ProjectWorkspace.tsx` coordinates stage-level rendering and major actions

#### State management

State lives in a single persisted Zustand store keyed by project ID:

- `projects`
- `spineVersions`
- `historyEvents`
- `branches`
- legacy `devPlans`
- legacy `agentPrompts`
- `artifacts`
- `artifactVersions`
- `feedbackItems`

This is effectively a lightweight local domain database.

#### Data models

The main data model types are defined in `src/types/index.ts`:

- `Project`
- `SpineVersion`
- `StructuredPRD`
- `Feature`
- `Branch`
- `BranchMessage`
- `Artifact`
- `ArtifactVersion`
- `SourceRef`
- `FeedbackItem`
- `HistoryEvent`

#### Artifact pipeline

The artifact pipeline is centered on:

- `Artifact` as the logical container
- `ArtifactVersion` as the immutable generated output
- `SourceRef` as provenance metadata
- `getArtifactStaleness()` as a lightweight freshness check against the latest PRD spine

#### Prompt/configuration system

Prompt logic is organized as purpose-built generation functions rather than a generic prompt registry:

- schema-backed generation for structured PRDs, dev plans, and coding prompts
- parameterized text prompt generation for mockups
- subtype-specific system prompts for core artifacts
- consolidation prompts with local and document-wide modes

#### File/document/image handling

- PRDs are represented both as structured objects and markdown text
- Markdown export is handled in-browser via `Blob`
- Mockups and artifacts are text outputs rendered in cards/detail panes
- The repo includes screenshots for major product surfaces in `public/screenshots`

### Simple architecture diagram

```text
User Idea / Project Setup
-> createProject() placeholder spine
-> generateStructuredPRD() with Gemini JSON schema
-> structuredPRDToMarkdown()
-> persisted SpineVersion { structuredPRD + markdown }

PRD Workspace
-> structured editing or markdown rendering
-> text selection / branch creation
-> replyInBranch()
-> consolidateBranch()
-> new SpineVersion + history event

Final PRD
-> MockupsView generateMockup()
-> ArtifactsView generateCoreArtifact()
-> Artifact + ArtifactVersion + SourceRef
-> Staleness + history tracking

Derived Output Review
-> manual feedback capture
-> FeedbackItem
-> apply feedback to PRD as new branch
-> repeat refinement loop
```

### Actual external services

- Google Gemini, called directly from the browser in `src/lib/llmProvider.ts`
- Optional Vercel serverless endpoints in `api/` that are currently unused by the UI

## 4. Feature Inventory

### A. User-facing features

#### Project creation and persistent workspaces

- What it does: Lets the user create named product sessions from an initial prompt and persists them locally across reloads.
- Why it matters: Gives the system continuity and makes it feel like a working product instead of a temporary chat.
- Implemented in:
  - `src/components/HomePage.tsx`
  - `src/store/projectStore.ts`
- Recruiter value: Strong signal of complete product thinking.
- **Portfolio Highlight**

#### Structured PRD generation

- What it does: Generates a structured PRD from the initial idea and serializes it into markdown for display/export.
- Why it matters: This is the canonical transformation that powers everything downstream.
- Implemented in:
  - `src/lib/llmProvider.ts`
  - `src/components/HomePage.tsx`
  - `src/components/ProjectWorkspace.tsx`
  - `src/components/StructuredPRDView.tsx`
- Recruiter value: Shows schema-constrained LLM orchestration and typed content pipelines.
- **Portfolio Highlight**

#### Dual PRD views: structured and markdown

- What it does: Lets users switch between an editable structured representation and rendered markdown.
- Why it matters: Combines machine-usable structure with human-readable document output.
- Implemented in:
  - `src/components/ProjectWorkspace.tsx`
  - `src/components/StructuredPRDView.tsx`
  - `src/components/SelectableSpine.tsx`
- Recruiter value: Strong signal of thoughtful representation design.
- **Portfolio Highlight**

#### Text selection and anchored branching

- What it does: Users highlight PRD text, choose an intent, and spawn an active branch thread.
- Why it matters: Converts passive document review into structured iterative refinement.
- Implemented in:
  - `src/components/SelectableSpine.tsx`
  - `src/components/StructuredPRDView.tsx`
  - `src/components/BranchList.tsx`
  - `src/store/projectStore.ts`
- Recruiter value: Shows nuanced interactive UX and stateful workflow design.
- **Portfolio Highlight**

#### Branch conversation and consolidation

- What it does: Supports follow-up discussion on a selected anchor, then merges the branch back via local or document-wide rewrite.
- Why it matters: This is the core refinement loop that differentiates Synapse from a one-shot generator.
- Implemented in:
  - `src/components/BranchList.tsx`
  - `src/components/ConsolidationModal.tsx`
  - `src/lib/llmProvider.ts`
  - `src/store/projectStore.ts`
- Recruiter value: Demonstrates orchestration and version-aware editing workflows.
- **Portfolio Highlight**

#### PRD finalization and export

- What it does: Allows a PRD version to be marked final and exported as markdown with metadata.
- Why it matters: Turns generation into a deliverable artifact.
- Implemented in:
  - `src/components/ProjectWorkspace.tsx`
- Recruiter value: Good product polish and artifact completion signal.

#### Text-based mockup generation

- What it does: Generates mockups from a finalized PRD with settings for platform, fidelity, scope, style, and notes.
- Why it matters: Shows the system expanding from product definition into design exploration.
- Implemented in:
  - `src/components/MockupsView.tsx`
  - `src/lib/llmProvider.ts`
  - `src/store/projectStore.ts`
- Recruiter value: Strong cross-functional signal spanning PM, UX, and engineering.
- **Portfolio Highlight**

#### Mockup version comparison and preferred-version selection

- What it does: Allows multiple mockup versions to be compared side by side and one to be marked preferred.
- Why it matters: Makes design exploration iterative rather than disposable.
- Implemented in:
  - `src/components/MockupsView.tsx`
  - `src/store/projectStore.ts`
- Recruiter value: Demonstrates version-aware UX and artifact lifecycle design.

#### Core artifact generation bundle

- What it does: Generates seven derivative artifacts from the PRD and manages them as versioned outputs.
- Why it matters: This is the clearest expression of Synapse as an artifact engine rather than a PRD editor.
- Implemented in:
  - `src/components/ArtifactsView.tsx`
  - `src/lib/llmProvider.ts`
  - `src/store/projectStore.ts`
- Recruiter value: High signal for systems thinking and extensible product architecture.
- **Portfolio Highlight**

#### Feedback capture and application to PRD

- What it does: Lets users create structured feedback from mockups/artifacts and send it back into the PRD workflow.
- Why it matters: Closes the loop between downstream exploration and upstream specification.
- Implemented in:
  - `src/components/FeedbackModal.tsx`
  - `src/components/FeedbackItemsList.tsx`
  - `src/components/ProjectWorkspace.tsx`
  - `src/store/projectStore.ts`
- Recruiter value: Strong evidence of product workflow design beyond generation alone.
- **Portfolio Highlight**

#### History timeline

- What it does: Displays creation, regeneration, artifact generation, feedback, and consolidation events over time.
- Why it matters: Makes the project evolution visible and auditable.
- Implemented in:
  - `src/components/HistoryView.tsx`
  - `src/store/projectStore.ts`
- Recruiter value: Signals maturity around provenance and workflow traceability.

### B. Technical features

#### JSON-schema-guided structured generation

- What it does: Uses Gemini JSON mode and explicit response schemas for structured PRDs, dev plans, and agent prompts.
- Why it matters: Improves parseability and gives downstream UI stable typed data.
- Implemented in `src/lib/llmProvider.ts`
- Recruiter-worthy: Yes
- **Portfolio Highlight**

#### Reusable artifact container/version system

- What it does: Separates logical artifacts from immutable versions and tracks preferred/current version pointers.
- Why it matters: Makes generation extensible and creates a coherent lifecycle model.
- Implemented in:
  - `src/types/index.ts`
  - `src/store/projectStore.ts`
- Recruiter-worthy: Yes
- **Portfolio Highlight**

#### Provenance tracking via source references

- What it does: Stores which PRD version a mockup or artifact came from.
- Why it matters: Enables staleness detection and evidence-based output lineage.
- Implemented in:
  - `src/types/index.ts`
  - `src/components/MockupsView.tsx`
  - `src/components/ArtifactsView.tsx`
  - `src/store/projectStore.ts`
- Recruiter-worthy: Yes

#### Staleness detection

- What it does: Compares an artifact's referenced source PRD version against the latest spine.
- Why it matters: Gives the user visibility into when derived outputs may no longer match current product intent.
- Implemented in:
  - `src/store/projectStore.ts`
  - `src/components/StalenessBadge.tsx`
  - `src/components/MockupsView.tsx`
  - `src/components/ArtifactsView.tsx`
- Recruiter-worthy: Yes

#### DOM-aware anchor highlighting

- What it does: Uses `mark.js` on rendered markdown/structured content to highlight active branch anchor text across element boundaries.
- Why it matters: Solves a real UI problem that a naive AST or string approach would make awkward.
- Implemented in:
  - `src/components/SelectableSpine.tsx`
  - `src/components/StructuredPRDView.tsx`
- Recruiter-worthy: Yes

#### Automatic history event creation

- What it does: Pushes timeline events during project creation, PRD regeneration, branch consolidation, artifact generation, and feedback actions.
- Why it matters: Converts workflow operations into a visible audit trail.
- Implemented in `src/store/projectStore.ts`
- Recruiter-worthy: Yes

#### Local-first persistence

- What it does: Persists the whole workspace model via Zustand middleware.
- Why it matters: Makes the app immediately usable without backend setup.
- Implemented in `src/store/projectStore.ts`
- Recruiter-worthy: Yes, especially for product prototyping

### C. Hidden sophistication

#### The PRD exists in two synchronized representations

- What it does: Stores both structured data and markdown text for the same spine version.
- Why it matters: This is what makes structured editing, markdown export, and downstream summarization all possible without choosing only one representation.
- Implemented in:
  - `src/types/index.ts`
  - `src/lib/llmProvider.ts`
  - `src/components/StructuredPRDView.tsx`
  - `src/components/ProjectWorkspace.tsx`
- Recruiter-worthy: Very high
- **Portfolio Highlight**

#### Mockups and core artifacts use different lifecycle semantics

- What it does:
  - Mockups create multiple artifact instances plus versions inside a chosen artifact.
  - Core artifacts reuse one canonical artifact per subtype and add new versions.
- Why it matters: This reflects a real product distinction between divergent design exploration and canonical downstream deliverables.
- Implemented in:
  - `src/components/MockupsView.tsx`
  - `src/components/ArtifactsView.tsx`
- Recruiter-worthy: High
- **Portfolio Highlight**

#### Feedback loops are modeled as typed domain data, not comments

- What it does: Feedback is a first-class typed object with status, source version, target artifact type, and history events.
- Why it matters: This is much stronger than a notes field or comment list.
- Implemented in:
  - `src/types/index.ts`
  - `src/store/projectStore.ts`
  - `src/components/FeedbackModal.tsx`
- Recruiter-worthy: High

#### The system hides a workflow engine behind a simple UI

- What it does: The user sees tabs and buttons, but the app is really managing versioned domain objects, stage gates, history, and artifact freshness.
- Why it matters: This is product engineering, not just frontend styling.
- Implemented across the workspace modules and store.
- Recruiter-worthy: High

## 5. Core Technical Approaches

### 5.1 Schema-constrained structured generation

- Problem solved: Freeform LLM output is hard to parse, edit, and use downstream.
- How it appears: `generateStructuredPRD()`, `generateDevPlan()`, and `generateAgentPrompt()` all define explicit schemas and ask Gemini for JSON responses.
- Implementation style: Centralized provider with inline schemas and parse-step validation in `src/lib/llmProvider.ts`.
- Why it is interesting: It upgrades the system from "AI writes text" to "AI populates a typed application model".
- Status: Fully implemented for structured PRD generation; dev plan and agent prompt generation exist in code but are not surfaced in the current main UI.

### 5.2 Dual representation: structured PRD plus markdown

- Problem solved: Pure structured data is awkward for document export and freeform reading; pure markdown is awkward for editing and deriving artifacts.
- How it appears: `SpineVersion` can store `structuredPRD`, while `responseText` stores the markdown serialization.
- Implementation style: Deterministic serializer `structuredPRDToMarkdown()` plus editable structured UI in `StructuredPRDView`.
- Why it is interesting: This is one of the strongest architectural moves in the repo because it supports both product ergonomics and machine-oriented downstream generation.
- Status: Fully implemented.

### 5.3 Anchored branch refinement on top of rendered content

- Problem solved: Users need to refine specific sections of a long PRD without rewriting the whole document.
- How it appears: `SelectableSpine` and `StructuredPRDView` use browser text selection, create a branch with an intent, and highlight active anchors using `mark.js`.
- Implementation style: DOM selection plus plain-text anchor storage.
- Why it is interesting: It creates a review-like interface for living documents and gives the app a distinctive interaction model.
- Status: Implemented, but simplified. The current app stores `anchorText` rather than a stable range/offset structure.

### 5.4 Branch consolidation with selectable scope

- Problem solved: A branch conversation needs a controlled path back into the canonical PRD.
- How it appears: `ConsolidationModal` offers local patch vs doc-wide rewrite, uses `consolidateBranch()`, previews output, then creates a new spine version.
- Implementation style: LLM-generated patch preview plus client-side commit step.
- Why it is interesting: It turns conversational refinement into explicit versioned document mutation.
- Status: Implemented, but local patching is text-replace-based and therefore fragile when anchors are ambiguous or formatted.

### 5.5 Generic artifact/version/provenance system

- Problem solved: One-off output lists do not scale when the product starts generating multiple derivative artifact types with histories.
- How it appears: `Artifact`, `ArtifactVersion`, `SourceRef`, and `HistoryEvent` are integrated into the store and shared by mockups and core artifacts.
- Implementation style: Local domain model plus reusable store actions.
- Why it is interesting: This is what makes the project feel like a system instead of a PRD page with extra buttons.
- Status: Implemented and central to the current architecture.

### 5.6 Parameterized prompt composition for mockups

- Problem solved: Mockup generation quality depends on controllable visual assumptions such as platform and fidelity.
- How it appears: `FIDELITY_INSTRUCTIONS`, `PLATFORM_INSTRUCTIONS`, and `SCOPE_INSTRUCTIONS` are combined into the mockup system prompt.
- Implementation style: Prompt-template composition based on user-selected settings.
- Why it is interesting: It demonstrates a productized prompting approach where the user controls generation modes through structured UI, not raw prompt hacking.
- Status: Implemented.

### 5.7 Subtype-specific artifact prompt templates

- Problem solved: Different downstream outputs need different generation logic and framing.
- How it appears: `CORE_ARTIFACT_PROMPTS` maps each subtype to a dedicated system prompt and user prefix.
- Implementation style: Template map keyed by artifact subtype.
- Why it is interesting: This is the clearest expression of Synapse as a multi-artifact generation engine.
- Status: Implemented.

### 5.8 Feedback as a typed re-entry mechanism

- Problem solved: Design and artifact review often becomes disconnected from the canonical PRD.
- How it appears: `FeedbackModal` creates `FeedbackItem`s; `FeedbackItemsList` surfaces them in the PRD stage; `ProjectWorkspace` converts applied feedback into a new branch.
- Implementation style: Domain object plus stage-crossing UI loop.
- Why it is interesting: It is a real workflow bridge between downstream artifacts and upstream product definition.
- Status: Partially implemented. Feedback capture exists, but extraction is manual rather than automatic, and feedback-to-PRD anchoring is weak because it uses the feedback title as the branch anchor.

### 5.9 Local-first workflow orchestration

- Problem solved: A prototype with many state transitions still needs to feel fast and resilient.
- How it appears: Zustand persistence stores projects, spines, branches, artifacts, and feedback locally.
- Implementation style: Single persistent client store.
- Why it is interesting: It gives the app a "working product" feel without backend complexity.
- Status: Implemented.

### 5.10 Optional serverless backend stubs

- Problem solved: In a more production-oriented deployment, LLM calls should be proxied server-side.
- How it appears: Vercel handlers exist for PRD, milestones, and agent prompts.
- Implementation style: Thin request proxies to Gemini.
- Why it is interesting: Shows awareness of the next architectural step even though the current UI remains client-direct.
- Status: Partial and unused in the current main flow.

### Technical Sophistication Assessment

#### What the project already does well

- Strong domain modeling for versioned PRD and artifact workflows
- Effective use of typed structured generation where it matters most
- Clean mapping from product workflow to UI stages
- Good local-first persistence and demo readiness
- Distinct artifact lifecycle concepts rather than one generic output list
- Clear evidence of product and UX thinking

#### What is elegant about the implementation

- Structured PRD plus markdown synchronization
- Artifact/container/version/source-ref/history composition
- Mark.js-based highlighting over rendered content
- Parameterized prompt composition for mockups
- Automatic history events generated by store operations

#### What appears incomplete or fragile

- Branch anchoring is text-based, not stable-range-based
- Local patch application uses naive `String.replace`
- Exploration canvas is mostly a placeholder with mock draft generation
- Feedback extraction is manual, not automated from generated artifacts
- Prompt artifacts/backend proxy layers exist but are not integrated into the main UX
- No automated tests

#### What is especially strong for recruiter presentation

- The architecture around artifact derivation and versioning
- The feedback loop from artifacts back into the PRD
- The structured generation plus structured editing story
- The fact that the repo is product-shaped and demo-shaped, not just technically clever

#### What differentiates it from generic app scaffolding

- The app has a genuine workflow model, not generic forms plus API calls
- The PRD is treated as a system node in a derived artifact graph
- Downstream outputs carry provenance and staleness, which is not typical in generic AI wrappers
- The UI interaction model is specialized to spec refinement rather than chat

## 6. Algorithms, Pipelines, and Orchestration Logic

### Mechanism 1: Project creation -> placeholder spine -> structured generation

- Problem solved: The user needs immediate workspace creation without waiting for the LLM.
- How it works:
  - `createProject()` creates project metadata and a `v1` placeholder spine with `Generating PRD...`
  - `HomePage` asynchronously imports the provider and runs `generateStructuredPRD()`
  - On success, it serializes the result to markdown and updates the same spine
- Inputs: Project name and initial prompt
- Outputs: Persisted project + populated structured/markdown spine
- Tradeoff: Fast UX and immediate routing, but failure handling is client-side only
- Recruiter relevance: Strong asynchronous product workflow signal

### Mechanism 2: Structured PRD editing with deterministic document regeneration

- Problem solved: Users need editable structured sections without losing document output.
- How it works:
  - `StructuredPRDView` edits fields and features directly
  - `savePRD()` regenerates markdown with `structuredPRDToMarkdown()`
  - `updateSpineStructuredPRD()` writes both representations back into the spine
- Inputs: Structured section edits
- Outputs: Updated structured object plus updated markdown text
- Tradeoff: Markdown serialization is deterministic but not user-customizable
- Recruiter relevance: Strong example of data-model-first UI design

### Mechanism 3: DOM selection -> branch creation -> branch reply generation

- Problem solved: Need targeted, contextual refinements rather than whole-document prompts.
- How it works:
  - User highlights visible text
  - Selection is converted into `anchorText`
  - Branch is created with initial intent
  - `replyInBranch()` uses anchor + thread history + user intent to generate reply text
- Inputs: Selected text, branch intent, thread history
- Outputs: Branch object with threaded messages
- Tradeoff: Simpler than stable offsets, but more fragile
- Recruiter relevance: High; it shows specialized interaction design

### Mechanism 4: Consolidation pipeline

- Problem solved: Branch conversations must affect the canonical PRD in a controlled way.
- How it works:
  - `consolidateBranch()` can generate local patch text or a full document rewrite
  - `ConsolidationModal` previews the result
  - Commit creates a new spine version through `mergeBranch()`
- Inputs: Current spine text, branch anchor, conversation context, chosen scope
- Outputs: New PRD spine version + history event
- Tradeoff: Explicit preview improves safety, but exact-match replacement remains fragile
- Recruiter relevance: High; this is workflow orchestration, not simple generation

### Mechanism 5: Mockup artifact lifecycle

- Problem solved: Design exploration needs variation, settings control, and version history.
- How it works:
  - User selects platform/fidelity/scope/style/notes
  - `generateMockup()` composes prompt instructions from those settings
  - Each new generation creates a mockup artifact
  - Regeneration adds versions to an existing mockup artifact
  - Preferred version and compare mode are tracked in UI/store
- Inputs: Final PRD text + generation settings
- Outputs: Mockup artifact(s), versioned mockup content, source refs, history events
- Tradeoff: Outputs are text-based rather than visual image renderings
- Recruiter relevance: Very high; strong productization of prompt-driven generation

### Mechanism 6: Core artifact bundle generation

- Problem solved: PM and engineering outputs should be derived from the same source specification.
- How it works:
  - `ArtifactsView` iterates across the seven core artifact subtypes
  - Each subtype calls `generateCoreArtifact()` with a subtype-specific system prompt
  - Results are stored in canonical per-subtype artifacts with versions and source refs
- Inputs: PRD markdown + structured PRD summary
- Outputs: Screen inventory, flows, components, implementation plan, data model, prompt pack, design system
- Tradeoff: Sequential generation keeps orchestration simple but could be slow
- Recruiter relevance: Extremely strong because it shows an extensible derivative content engine

### Mechanism 7: Provenance and staleness

- Problem solved: Derived artifacts need visible relationship to the source PRD version.
- How it works:
  - Artifact versions store `SourceRef`
  - `getArtifactStaleness()` compares the referenced PRD version to the latest spine version
  - UI displays a staleness badge when needed
- Inputs: Preferred artifact version and latest spine state
- Outputs: `current`, `possibly_outdated`, or `outdated`
- Tradeoff: Lightweight and pragmatic, but not a semantic dependency graph
- Recruiter relevance: High; shows system-awareness beyond raw generation

### Mechanism 8: Feedback re-entry loop

- Problem solved: Generated outputs should influence the source specification.
- How it works:
  - User manually creates a typed feedback item from a mockup/artifact version
  - Feedback appears in PRD stage
  - Applying feedback creates a new branch and marks feedback accepted
- Inputs: Artifact version, feedback title, description, type, target
- Outputs: Feedback item, new branch, history events
- Tradeoff: Manual capture is usable but less impressive than automated critique extraction
- Recruiter relevance: High; shows workflow closure rather than one-way generation

### Mechanism 9: Timeline orchestration

- Problem solved: The user needs a visible record of how the project evolved.
- How it works:
  - Store actions add `HistoryEvent`s for PRD creation, regeneration, consolidation, artifact generation, and feedback
  - `HistoryView` groups and renders them by date
- Inputs: Store mutations
- Outputs: Human-readable timeline
- Tradeoff: Mostly event-based metadata; no full diff engine for artifacts
- Recruiter relevance: Medium-high; reinforces maturity

### Most Interesting Technical Mechanisms

1. Structured PRD generation using Gemini JSON schema instead of plain text.
2. Dual PRD representation: editable structured data synchronized with exportable markdown.
3. Branchable PRD text selection with active-anchor highlighting across rendered content.
4. Consolidation flow that mints new canonical PRD versions rather than mutating in place.
5. Generic `Artifact` plus `ArtifactVersion` plus `SourceRef` model for downstream outputs.
6. Distinct lifecycle semantics for exploratory mockups versus canonical core artifacts.
7. Staleness detection that ties derived outputs back to the exact PRD version that produced them.
8. Feedback modeled as typed workflow objects that route downstream critique back into upstream specification work.
9. History events created automatically by store actions, giving the app provenance without backend complexity.
10. A compact local-first architecture that still behaves like a multi-stage workflow system.

## 7. End-to-End Workflow Walkthrough

### Step-by-step prose

1. A user starts a new Synapse session with a project name and a rough product idea.
2. The app immediately creates a project and a placeholder `v1` spine in the persisted store.
3. Gemini generates a structured PRD in JSON form.
4. The structured PRD is serialized into markdown and stored alongside the structured object in the same spine version.
5. Inside the workspace, the user toggles between structured editing and markdown reading.
6. When the user highlights a section of the PRD, Synapse spawns a branch thread anchored to that selected text.
7. The branch thread becomes a focused review/refinement lane where the user can ask for clarification, alternatives, or replacements.
8. When the user consolidates the branch, Synapse previews either a local patch or a document-wide rewrite and then mints a new spine version.
9. Once the PRD is marked final, downstream stages become available.
10. In Mockups, the user configures generation settings and produces one or more text-based UI explorations with versions and compare mode.
11. In Artifacts, the user generates a canonical set of product/design/engineering deliverables derived from the PRD.
12. If the user notices issues in mockups or artifacts, they create feedback items.
13. Those feedback items appear back in the PRD stage, where they can be applied as new branches for another refinement pass.
14. Throughout the process, Synapse logs history events and tracks whether artifacts are stale relative to the current PRD.
15. The user can export the final PRD as a deliverable markdown file.

### Concise pipeline diagram

```text
Idea
-> Structured PRD generation
-> Canonical PRD spine
-> Branch refinement and consolidation
-> Final PRD
-> Mockups + Core Artifacts
-> Feedback capture
-> Feedback applied back to PRD
-> New spine version
-> Export / history / reuse
```

### Recruiter-friendly summary version

Synapse takes a raw product idea, turns it into a structured PRD, lets the user refine it through anchored branch discussions, and then uses the finalized spec to generate downstream design and engineering artifacts. Those artifacts stay tied to the PRD version that created them, can surface feedback back into the PRD workflow, and are tracked through a visible project history.

### Branching logic and reusable stages

- Branching happens at the PRD text level through selection-based anchors.
- Consolidation always creates a new spine version rather than editing in place.
- Mockups and artifacts both reuse the same generic artifact/version infrastructure.
- Feedback re-entry converts downstream issues into upstream branch work.
- Staleness and history are orthogonal metadata layers reused across the workflow.

### Where complexity is hidden behind simple UI

- The "Generate Mockup" button creates artifact containers, versions, provenance, and history.
- The "Apply" button on feedback creates a new PRD branch and updates feedback status.
- The structured editor keeps markdown output synchronized automatically.
- The history view is backed by explicit workflow events rather than UI-only state.

## 8. Codebase Deep Dive by Module

### Project and workflow management

#### `src/store/projectStore.ts`

- Purpose: Central domain store and workflow engine for the entire app.
- Inputs/outputs: Receives user actions and generated content; emits persisted project state.
- Interactions: Used by almost every component.
- Important logic:
  - project/spine/branch lifecycle
  - artifact and artifact-version management
  - feedback creation and status transitions
  - history-event creation
  - staleness detection
- Role: Core engine module.
- Slide-worthy: Yes, especially for architecture diagrams.

#### `src/types/index.ts`

- Purpose: Defines the application's domain language.
- Inputs/outputs: Shared type definitions.
- Interactions: Used across store, provider, and UI.
- Important logic: Not runtime logic, but the type system itself reveals the architecture.
- Role: Core architecture contract.
- Slide-worthy: Yes, as a data model panel.

### Generation pipeline and prompt/system logic

#### `src/lib/llmProvider.ts`

- Purpose: Central AI orchestration layer.
- Inputs/outputs: Receives prompts, structured models, settings, and branch context; returns generated structured objects or text artifacts.
- Interactions: Called by the home screen, workspace, branch flows, mockups, and artifacts.
- Important logic:
  - `callGemini()`
  - `generateStructuredPRD()`
  - `structuredPRDToMarkdown()`
  - `replyInBranch()`
  - `consolidateBranch()`
  - `generateMockup()`
  - `generateCoreArtifact()`
- Role: Core engine module.
- Slide-worthy: Absolutely.

#### `api/generate-prd.ts`, `api/generate-milestones.ts`, `api/generate-agent-prompts.ts`

- Purpose: Thin serverless wrappers around Gemini generation.
- Inputs/outputs: HTTP requests for PRD/milestone/prompt generation.
- Interactions: Present in repo, but not wired into the current main frontend flow.
- Important logic: Accept server-side or header-based API keys and proxy requests to Gemini.
- Role: Supporting/future backend boundary.
- Slide-worthy: Only as "next architecture step" or "backend path exists but not primary."

### UI and orchestration

#### `src/components/HomePage.tsx`

- Purpose: Project listing and session creation.
- Inputs/outputs: Accepts project name and initial prompt; creates project and triggers first structured PRD generation.
- Interactions: Entry point to the system.
- Important logic: Asynchronous project bootstrap.
- Role: Supporting orchestration.
- Slide-worthy: Useful for workflow walkthrough.

#### `src/components/ProjectWorkspace.tsx`

- Purpose: Main orchestrator for the entire product workspace.
- Inputs/outputs: Selects current stage, active spine, sidebar mode, export/finalization actions.
- Interactions: Composes nearly all major views.
- Important logic:
  - stage gating
  - structured vs markdown PRD view
  - feedback application
  - export/finalization
  - right-side branches/history rail
- Role: Core orchestration module.
- Slide-worthy: Yes.

#### `src/components/PipelineStageBar.tsx`

- Purpose: PRD -> Mockups -> Artifacts -> History navigation.
- Inputs/outputs: Reads current stage and final-PRD gating.
- Role: Supporting workflow UI.
- Slide-worthy: Good for "product surface" diagrams.

### PRD editing and review

#### `src/components/StructuredPRDView.tsx`

- Purpose: Editable structured PRD interface.
- Inputs/outputs: Reads `StructuredPRD`; writes synchronized structured/markdown updates.
- Interactions: Works with branching and highlighting.
- Important logic:
  - section editing
  - feature CRUD
  - selection-based branch creation
  - mark.js highlighting
- Role: Core product module.
- Slide-worthy: Yes.

#### `src/components/SelectableSpine.tsx`

- Purpose: Markdown PRD renderer with selection-based branching.
- Inputs/outputs: Receives PRD markdown text and emits branch creation actions.
- Important logic:
  - markdown rendering
  - DOM text selection
  - popover placement
  - active-anchor highlighting
- Role: Core product module.
- Slide-worthy: Yes.

#### `src/components/FeatureCard.tsx`

- Purpose: Inline editable feature card inside the structured PRD.
- Role: Supporting module.
- Slide-worthy: Low individually, but useful as part of the structured editor story.

### Branching and consolidation

#### `src/components/BranchList.tsx`

- Purpose: Displays active branches, conversation threads, and actions.
- Inputs/outputs: Reads branches, posts replies, launches consolidation or canvas.
- Important logic:
  - threaded conversation UI
  - intent framing
  - branch deletion
  - reply generation
- Role: Core workflow module.
- Slide-worthy: Yes.

#### `src/components/ConsolidationModal.tsx`

- Purpose: Generates and previews PRD patches from a branch.
- Inputs/outputs: Branch plus spine text in, new spine version out.
- Important logic:
  - scope selection
  - patch generation
  - local/doc-wide commit logic
  - mismatch handling
- Role: Core workflow module.
- Slide-worthy: Yes, especially for the refinement loop diagram.

#### `src/components/BranchCanvas.tsx`

- Purpose: Exploration-canvas overlay for deeper branch work.
- Inputs/outputs: Branch context in, chosen draft applied back to spine.
- Important logic: Currently mock draft generation and selection.
- Role: Partial/aspirational core module.
- Slide-worthy: Only if described honestly as an exploration prototype or scaffold.

### Mockup and artifact generation

#### `src/components/MockupsView.tsx`

- Purpose: Generate and manage text mockups.
- Inputs/outputs: Final PRD in, mockup artifacts and versions out.
- Important logic:
  - settings-driven generation
  - mockup artifact creation
  - regeneration and version comparison
  - preferred version selection
  - feedback entry point
- Role: Core downstream generation module.
- Slide-worthy: Very high.

#### `src/components/ArtifactsView.tsx`

- Purpose: Generate and manage the core artifact bundle.
- Inputs/outputs: Final PRD in, subtype-specific artifacts out.
- Important logic:
  - canonical per-subtype artifact handling
  - bundle generation loop
  - staleness display
  - feedback entry point
- Role: Core downstream generation module.
- Slide-worthy: Very high.

#### `src/components/StalenessBadge.tsx`

- Purpose: Small but meaningful artifact freshness indicator.
- Role: Supporting module.
- Slide-worthy: Useful as a callout in visuals about provenance/freshness.

### Feedback and history

#### `src/components/FeedbackModal.tsx`

- Purpose: Create typed feedback items from artifact versions.
- Role: Supporting workflow module.
- Slide-worthy: Useful as evidence of the feedback loop.

#### `src/components/FeedbackItemsList.tsx`

- Purpose: Surface open feedback in the PRD stage and route it back to PRD work.
- Role: Core loop-closure module.
- Slide-worthy: Yes.

#### `src/components/HistoryView.tsx`

- Purpose: Render timeline/audit trail.
- Role: Supporting workflow module with strong presentation value.
- Slide-worthy: Yes.

### Settings and app shell

#### `src/components/SettingsModal.tsx`

- Purpose: Configure Gemini key and model choice.
- Role: Supporting infrastructure UI.
- Slide-worthy: Low technically, but useful to explain the current client-side integration model.

#### `src/App.tsx` and `src/main.tsx`

- Purpose: SPA shell and routing/bootstrap.
- Role: Supporting module.
- Slide-worthy: Low.

### Tests, demos, and examples

- No automated tests are present.
- Demo evidence comes primarily from:
  - screenshots in `public/screenshots`
  - screenshots copied into `dist/screenshots`
  - planning docs in `README.md`, `PRD.md`, `PLAN.md`, and `PRD_COMPLIANCE.md`

## 9. Artifact and Output Analysis

### Output type: Structured PRD

- Generation path: `generateStructuredPRD()` -> JSON parse -> `StructuredPRD`
- Components involved:
  - `src/lib/llmProvider.ts`
  - `src/components/HomePage.tsx`
  - `src/components/ProjectWorkspace.tsx`
  - `src/store/projectStore.ts`
- Nature: AI-assisted and schema-constrained
- Interesting property: Most downstream value in the app starts here
- Recruiter value: High; demonstrates typed LLM integration

### Output type: Markdown PRD

- Generation path: `structuredPRDToMarkdown()` or branch consolidation rewrite
- Components involved:
  - `src/lib/llmProvider.ts`
  - `src/components/StructuredPRDView.tsx`
  - `src/components/ProjectWorkspace.tsx`
- Nature: Hybrid, deterministic serialization plus AI-driven rewrites
- Interesting property: Human-readable, exportable canonical document
- Recruiter value: High; shows practical artifact delivery

### Output type: Exported PRD file

- Generation path: In-browser blob export from `ProjectWorkspace`
- Nature: Deterministic file export
- Interesting property: Includes version/final/timestamp metadata
- Recruiter value: Medium-high; shows product completeness

### Output type: Text mockups

- Generation path: `generateMockup()` with settings-driven prompt composition
- Components involved:
  - `src/components/MockupsView.tsx`
  - `src/lib/llmProvider.ts`
  - `src/store/projectStore.ts`
- Nature: AI-assisted, parameterized, text-based
- Interesting property: Supports multiple artifacts, per-artifact versions, preferred version selection, and compare mode
- Recruiter value: Very high; this is visually explainable and differentiated

### Output type: Core artifact bundle

- Generation path: `generateCoreArtifact()` using subtype-specific prompts
- Components involved:
  - `src/components/ArtifactsView.tsx`
  - `src/lib/llmProvider.ts`
  - `src/store/projectStore.ts`
- Nature: AI-assisted, template-driven by subtype
- Interesting property: Treats downstream outputs as first-class versioned artifacts with freshness tracking
- Recruiter value: Extremely high

### Output type: Feedback items

- Generation path: User-created typed feedback from mockups/artifacts
- Nature: Manual structured capture
- Interesting property: Designed as a bridge back into PRD work
- Recruiter value: High as a workflow concept, but important to state that extraction is manual in the current implementation

### Output type: Project timeline

- Generation path: Implicit from store events
- Nature: Deterministic metadata view
- Interesting property: Gives the project observable provenance
- Recruiter value: Medium-high

### Output type: Legacy dev plan and agent prompts

- Generation path: Functions and types exist, plus serverless endpoints
- Nature: AI-assisted and schema-backed
- Interesting property: Signals prior or planned expansion from PRD to build planning and coding-agent workflows
- Recruiter value: Medium, but this should be framed carefully because it is not part of the current surfaced main flow

### Best outputs to showcase

#### For a recruiter deck

- Structured PRD view screenshot
- Mockups comparison screenshot
- Core artifacts screenshot
- Architecture diagram of PRD -> artifacts -> feedback -> PRD
- A sample artifact bundle panel listing the seven outputs

#### For a portfolio page

- One strong screenshot of the PRD workspace
- One artifact pipeline diagram
- One short callout on versioned mockups and staleness tracking
- One example of generated output snippets from implementation plan and design system

#### For a product demo

- Start-to-finish flow:
  - idea
  - structured PRD
  - branch refinement
  - mockup generation
  - artifact generation
  - feedback applied back to PRD

#### For a GitHub README

- Existing screenshots are strong
- The README would benefit from one explicit architecture diagram and one "what is implemented vs planned" table

## 10. Engineering Quality Assessment

### Code organization

The codebase is compact and understandable. The main logic is concentrated in three places:

- `src/store/projectStore.ts`
- `src/lib/llmProvider.ts`
- `src/components/ProjectWorkspace.tsx`

That concentration is appropriate for the current size of the product and makes the app relatively easy to reason about.

### Modularity and separation of concerns

Strengths:

- Domain models are explicit and meaningful.
- Store actions encapsulate important state transitions.
- Provider logic is centralized rather than copy-pasted in components.
- Stage-specific views are separated into their own components.

Limitations:

- `ProjectWorkspace.tsx` is large and acts as a high-level coordinator for many concerns.
- The store is becoming large enough that feature-sliced stores or domain modules could eventually help.

### Extensibility

Strong:

- Artifact model is clearly extensible.
- Artifact subtype prompting is easy to expand.
- History and feedback systems are reusable.
- Prompt artifact and serverless paths are already anticipated in types and code.

Weaker:

- Anchor model is not future-proof for rich editing or conflict-aware merging.
- Client-local persistence constrains collaboration and scale.

### Maintainability and naming

- Naming is mostly clear and product-oriented.
- Types are readable.
- Store actions correspond well to domain concepts.
- The presence of legacy types and unused routes/endpoints slightly muddies the picture but does not make the repo confusing.

### Data modeling

This is one of the strongest areas of the project. `Project`, `SpineVersion`, `Branch`, `Artifact`, `ArtifactVersion`, `SourceRef`, `FeedbackItem`, and `HistoryEvent` create a coherent system model that is richer than typical prototype code.

### State management quality

Zustand with persistence is a pragmatic choice here. It keeps the app fast to build and easy to inspect. For a demo-stage product this is strong. For a production multi-user system it would need to move behind a real persistence layer.

### UI architecture

The UI architecture is product-strong:

- stage-based navigation
- main workspace plus right-side rail
- structured and markdown modes
- contextual selection popovers
- version comparison and history

The UI is not just component-deep. It reflects workflow depth.

### Backend boundaries

This is the biggest architecture caveat:

- The current shipped behavior calls Gemini directly from the browser using a locally stored API key.
- Optional serverless handlers exist, but are not wired into the main app.

That is fine for a prototype and honest portfolio story, but it is not the same as production-grade backend mediation.

### Testability and debugability

- `npm run lint` passes.
- `npm run build` succeeds.
- There are no automated tests.
- The build warns that `src/lib/llmProvider.ts` is both dynamically and statically imported, so the intended code-splitting does not happen.
- The build also warns about a large client chunk around 525 kB minified JS.

Overall: good prototype hygiene, not hardened production QA.

### Production readiness

Ready for:

- demos
- recruiter presentations
- personal portfolio
- single-user local experimentation

Not yet ready for:

- secure multi-user deployment
- robust merge/conflict handling
- high-confidence enterprise use
- heavy artifact history at scale

### Technical debt and fragile areas

- Text anchors are stored as raw strings, not stable locations.
- Local consolidation uses naive string replacement.
- Feedback application uses feedback title as branch anchor, which may not exist in the PRD.
- Exploration canvas is largely mocked.
- Legacy dev-plan/agent-prompt layers remain in the code but are not integrated into the main workflow.
- No automated test coverage.

### What This Project Says About the Engineer

This project signals:

- Strong product-engineering instincts
- Comfort combining AI systems with interactive software design
- Ability to design a system around real workflow objects rather than screens alone
- Good sense for building polished, demo-worthy interfaces with meaningful internal structure
- A bias toward extensible domain modeling over throwaway prompt hacks

It suggests maturity in roles such as:

- Product engineer
- Founding engineer
- Full-stack engineer on AI-enabled products
- Frontend-heavy engineer with systems/design sensibility
- Platform-minded builder for internal tools or creative workflow products

The most differentiated part of the work is not "used an LLM." It is the way the engineer modeled iterative specification work as a connected system of canonical sources, derived artifacts, and feedback-driven revision.

## 11. Visuals Worth Turning Into Infographics

### Proposed visual 1: "Idea to Artifact Engine"

- Purpose: Show the complete product story at a glance.
- What it should show:
  - idea input
  - structured PRD
  - branch refinement
  - final PRD
  - mockups
  - core artifacts
  - feedback loop
- Why recruiter-useful: It immediately communicates that Synapse is a workflow system, not a single generator.
- Source material:
  - `src/components/HomePage.tsx`
  - `src/components/ProjectWorkspace.tsx`
  - `src/components/MockupsView.tsx`
  - `src/components/ArtifactsView.tsx`
- Suggested structure: Left-to-right pipeline with feedback arrow returning upstream.

### Proposed visual 2: "Canonical PRD Spine and Branches"

- Purpose: Explain the unique refinement model.
- What it should show:
  - main PRD spine
  - text highlight
  - anchored branch threads
  - consolidation back into a new spine version
- Why recruiter-useful: This is one of the most differentiating product mechanics.
- Source material:
  - `src/components/SelectableSpine.tsx`
  - `src/components/BranchList.tsx`
  - `src/components/ConsolidationModal.tsx`
  - `src/store/projectStore.ts`
- Suggested structure: Central PRD column, side branch cards, merge arrow to next version.

### Proposed visual 3: "Dual PRD Representation"

- Purpose: Show the technical elegance of structured data plus markdown.
- What it should show:
  - JSON-like structured PRD object
  - deterministic markdown serializer
  - structured editor UI
  - markdown view/export
- Why recruiter-useful: Shows the strongest underlying technical design decision.
- Source material:
  - `src/lib/llmProvider.ts`
  - `src/components/StructuredPRDView.tsx`
  - `src/components/ProjectWorkspace.tsx`
- Suggested structure: Split diagram with "machine-friendly" and "human-friendly" sides.

### Proposed visual 4: "Artifact Model and Provenance"

- Purpose: Explain why Synapse is more than a PRD editor.
- What it should show:
  - `Artifact`
  - `ArtifactVersion`
  - `SourceRef`
  - `HistoryEvent`
  - `FeedbackItem`
  - staleness badge
- Why recruiter-useful: This is the best architecture slide for engineering managers.
- Source material:
  - `src/types/index.ts`
  - `src/store/projectStore.ts`
- Suggested structure: Entity relationship diagram with arrows from PRD versions to artifact versions.

### Proposed visual 5: "Mockup Generation Controls"

- Purpose: Show productized prompting.
- What it should show:
  - platform
  - fidelity
  - scope
  - style
  - notes
  - generated mockup outputs
  - compare mode
- Why recruiter-useful: Demonstrates configurable LLM UX, not just a prompt textbox.
- Source material:
  - `src/components/MockupsView.tsx`
  - `src/lib/llmProvider.ts`
- Suggested structure: Control panel on left, output/version compare on right.

### Proposed visual 6: "Seven Core Artifacts"

- Purpose: Make the downstream value concrete.
- What it should show:
  - screen inventory
  - user flows
  - component inventory
  - implementation plan
  - data model
  - prompt pack
  - design system starter
- Why recruiter-useful: Helps non-engineers see breadth and helps engineers see systems thinking.
- Source material:
  - `src/components/ArtifactsView.tsx`
  - `src/lib/llmProvider.ts`
- Suggested structure: Seven-card grid with one-line descriptions.

### Proposed visual 7: "Feedback Loop from Artifacts Back to PRD"

- Purpose: Highlight closed-loop workflow.
- What it should show:
  - artifact/mockup output
  - feedback item creation
  - PRD feedback queue
  - new branch
  - consolidation
- Why recruiter-useful: It is a strong answer to "what makes this more than a generator?"
- Source material:
  - `src/components/FeedbackModal.tsx`
  - `src/components/FeedbackItemsList.tsx`
  - `src/components/ProjectWorkspace.tsx`
- Suggested structure: Circular loop or looped arrow diagram.

### Proposed visual 8: "System Components and Responsibilities"

- Purpose: Give engineering managers a clean architecture summary.
- What it should show:
  - HomePage
  - ProjectWorkspace
  - llmProvider
  - projectStore
  - PRD views
  - MockupsView
  - ArtifactsView
  - HistoryView
  - optional serverless API layer
- Why recruiter-useful: Quickly maps the repo into mental modules.
- Source material: main source tree
- Suggested structure: Layered or modular architecture diagram.

### Proposed visual 9: "Versioning and Staleness Lifecycle"

- Purpose: Explain artifact freshness and evolution.
- What it should show:
  - spine version changes
  - artifact versions tied to source versions
  - stale badge after PRD updates
- Why recruiter-useful: Signals system maturity.
- Source material:
  - `src/store/projectStore.ts`
  - `src/components/StalenessBadge.tsx`
  - `src/components/MockupsView.tsx`
  - `src/components/ArtifactsView.tsx`
- Suggested structure: Timeline with branching artifact nodes.

### Proposed visual 10: "What Makes Synapse Smart"

- Purpose: Turn technical differentiators into a portfolio-friendly panel.
- What it should show:
  - schema-constrained generation
  - branch-based refinement
  - artifact provenance
  - feedback loop
  - local-first persistence
  - recruiter-friendly outputs
- Why recruiter-useful: Great infographic panel.
- Source material: whole repo
- Suggested structure: Six-icon feature panel.

### Top 8 Visuals for an Infographic

1. Idea to Artifact Engine
2. Canonical PRD Spine and Branches
3. Dual PRD Representation
4. Artifact Model and Provenance
5. Seven Core Artifacts
6. Feedback Loop from Artifacts Back to PRD
7. Mockup Generation Controls
8. Versioning and Staleness Lifecycle

### Top 12 Slides for a PowerPoint

1. What Synapse Is
2. Problem Synapse Solves
3. End-to-End Workflow
4. Canonical PRD Spine and Branch Model
5. Structured PRD plus Markdown Architecture
6. Mockup Generation Pipeline
7. Core Artifact Bundle
8. Artifact Versioning, Provenance, and Staleness
9. Feedback Loop and Revision Flow
10. Engineering Architecture and Main Modules
11. What Makes It Differentiated from Generic AI Wrappers
12. Engineering Strengths, Gaps, and Next Steps

## 12. Slide Deck Blueprint

### Slide 1: Synapse

- Slide goal: Establish the product in one sentence.
- Key bullets:
  - AI-native product definition workspace
  - Turns ideas into structured PRDs and downstream artifacts
  - Supports branching, consolidation, mockups, artifacts, and feedback loops
- Suggested visual: Hero screenshot of PRD workspace plus short architecture ribbon.
- Speaker notes: Lead with the system-level framing, not "I made a PRD generator."

### Slide 2: The Problem

- Slide goal: Explain why Synapse exists.
- Key bullets:
  - Product ideas usually fragment across docs, chats, and ad hoc notes
  - Static PRDs do not evolve well into design and engineering outputs
  - Review feedback rarely reconnects cleanly to the canonical spec
- Suggested visual: Before/after workflow comparison.
- Speaker notes: Emphasize fragmentation and lack of traceability.

### Slide 3: Product Workflow

- Slide goal: Show the full system loop.
- Key bullets:
  - Idea -> Structured PRD
  - PRD -> branch refinement
  - Final PRD -> mockups + artifacts
  - Feedback -> back into PRD
- Suggested visual: Left-to-right pipeline with loopback arrow.
- Speaker notes: This is the highest-level "how it works" slide.

### Slide 4: The Canonical PRD Spine

- Slide goal: Show the project's central concept.
- Key bullets:
  - One authoritative PRD spine per version
  - Text-range branches for localized refinement
  - Consolidation always creates a new PRD version
- Suggested visual: Spine with side branches and merge arrow.
- Speaker notes: This is the most unique interaction model in the repo.

### Slide 5: Structured PRD plus Markdown

- Slide goal: Highlight the strongest technical design choice.
- Key bullets:
  - PRD is stored as typed structured data
  - Same PRD is rendered/exported as markdown
  - Structured edits deterministically regenerate document output
- Suggested visual: Split diagram of JSON-like model and markdown document.
- Speaker notes: This slide signals strong representation design and systems thinking.

### Slide 6: Mockup Generation

- Slide goal: Show Synapse moving beyond spec generation.
- Key bullets:
  - Final PRD feeds text-based mockup generation
  - User controls platform, fidelity, scope, style, and emphasis
  - Mockups are versioned and comparable
- Suggested visual: Mockups screenshot with settings annotations.
- Speaker notes: Position this as design exploration, not pixel-perfect rendering.

### Slide 7: Artifact Bundle

- Slide goal: Show downstream value.
- Key bullets:
  - Generates seven build-oriented artifacts from the same PRD
  - Covers UX, frontend, backend, planning, prompting, and design systems
  - Keeps outputs tied to source PRD versions
- Suggested visual: Seven-card artifact grid.
- Speaker notes: This is where the product becomes more than a document tool.

### Slide 8: Artifact Versioning and Provenance

- Slide goal: Communicate technical depth.
- Key bullets:
  - `Artifact` and `ArtifactVersion` separate logical outputs from immutable generations
  - `SourceRef` tracks which PRD version created each output
  - Staleness badges warn when artifacts no longer match the latest PRD
- Suggested visual: Data model/provenance diagram.
- Speaker notes: Good slide for engineering managers and startup founders.

### Slide 9: Feedback Loop

- Slide goal: Show closed-loop workflow design.
- Key bullets:
  - Feedback can be created from mockups and artifacts
  - Open feedback returns to the PRD stage
  - Applying feedback creates a new branch for revision
- Suggested visual: Circular loop diagram with feedback cards.
- Speaker notes: This is one of the strongest product-thinking signals.

### Slide 10: Engineering Architecture

- Slide goal: Map the repo into technical layers.
- Key bullets:
  - React/Vite frontend
  - Zustand local domain store
  - Gemini orchestration layer
  - Optional serverless API stubs
  - Local-first persistence and export
- Suggested visual: Layered component architecture.
- Speaker notes: Mention that current shipping flow is client-direct to Gemini.

### Slide 11: What Makes Synapse Different

- Slide goal: Differentiate from generic AI wrappers.
- Key bullets:
  - Canonical PRD spine rather than generic chat
  - Branch-based document refinement
  - Versioned artifact derivation with provenance
  - Feedback-driven re-entry into source specification
- Suggested visual: "Generic AI app" vs "Synapse" comparison table.
- Speaker notes: Keep this grounded and specific.

### Slide 12: Engineering Signal and Roadmap

- Slide goal: Translate the project into recruiter language while staying honest.
- Key bullets:
  - Demonstrates product engineering, AI workflows, and systems design
  - Build and lint pass; UI is polished and demo-ready
  - Future upgrades: stable anchors, backend mediation, auto-feedback extraction, tests
- Suggested visual: Strengths on left, next steps on right.
- Speaker notes: End on strong present-tense capabilities with credible future direction.

## 13. Recruiter-Facing Soundbites

### 10 short portfolio bullets

- Built an AI-native product definition workspace that turns raw ideas into structured PRDs and downstream build artifacts.
- Designed a versioned PRD "spine" model with anchored branch conversations and explicit consolidation into new document versions.
- Implemented schema-constrained LLM generation for structured PRDs using Gemini JSON mode and typed TypeScript models.
- Added a dual-representation architecture that keeps structured PRD data synchronized with exportable markdown.
- Built text-based UI mockup generation with configurable platform, fidelity, and workflow scope.
- Created a reusable artifact/version/provenance model for derived outputs like user flows, data models, and design-system starters.
- Added artifact staleness tracking so downstream outputs can signal when the source PRD has changed.
- Designed a feedback loop that routes mockup and artifact insights back into the canonical PRD workflow.
- Shipped a polished React/Vite product with persisted local state, routing, history tracking, and markdown export.
- Built a compact but extensible AI workflow system in roughly 5k lines of TypeScript/TSX/CSS.

### 10 recruiter-friendly technical bullets

- Modeled the application around canonical sources, derived artifacts, and provenance instead of page-local state.
- Centralized LLM orchestration in a dedicated provider module rather than embedding prompt logic inside UI components.
- Used TypeScript domain models to define project, PRD, branch, artifact, feedback, and history lifecycles explicitly.
- Implemented immutable artifact versions with preferred-version selection and per-project persistence.
- Built stage-based UX that gates downstream generation on PRD finalization.
- Used `mark.js` to highlight branch anchors across rendered markdown content without custom AST work.
- Added side-by-side mockup version comparison and artifact freshness indicators to support iterative review.
- Logged workflow mutations as history events to create an inspectable timeline of project evolution.
- Prototyped a future serverless backend boundary while keeping the current product locally runnable and fast to demo.
- Verified the repo builds and lints cleanly, with production warnings mainly around chunk size and code splitting.

### 5 impressive but honest one-liners

- Synapse treats the PRD as a living system object, not a static text file.
- The project’s strongest technical idea is its versioned artifact pipeline built around a canonical PRD spine.
- This is more than an AI wrapper because generated outputs carry lineage, freshness, and feedback back into the source workflow.
- The implementation is strongest where structured generation meets product UX: typed PRDs, versioned artifacts, and branch-based refinement.
- Synapse is demo-ready today as a single-user product workflow tool, with clear room to harden into a broader platform.

### 5 concise descriptions of the system at different lengths

#### 1 sentence

Synapse is an AI-native workspace that converts product ideas into structured PRDs and a versioned set of downstream design and engineering artifacts.

#### 2 sentences

Synapse starts with a rough product idea, generates a structured PRD, and lets the user refine it through anchored branch discussions and versioned consolidation. From that canonical PRD, it creates text mockups, implementation-oriented artifacts, and feedback loops that route downstream insights back into the spec.

#### 50 words

Synapse is a React-based AI workflow product for structured product definition. It transforms an idea into a typed PRD, supports branch-based refinement, generates text mockups and core build artifacts, tracks provenance and staleness, and feeds artifact review back into the PRD so the specification evolves as a system.

#### 100 words

Synapse is an AI-native product definition environment built in React, TypeScript, and Zustand. It generates a structured PRD from an initial idea, stores that PRD as both typed data and markdown, and lets users refine specific sections through anchored branch conversations. Once a PRD is finalized, Synapse can generate text-based mockups plus a bundle of downstream artifacts such as user flows, component inventories, implementation plans, data models, prompt packs, and design-system starters. Those outputs are versioned, tied back to the exact PRD version that produced them, and can surface feedback back into the PRD workflow for another revision cycle.

#### 200 words

Synapse is a compact but ambitious AI product workflow system that turns early product thinking into a reusable artifact pipeline. A user begins with a rough prompt, and Synapse generates a structured Product Requirements Document using Gemini JSON mode. That PRD is stored as both typed application data and exportable markdown, which lets the app provide two complementary editing modes: a structured editor for direct changes and a markdown view for reading, exporting, and text selection.

What makes the system more interesting than a generic AI app is how it models iteration. Users can highlight specific PRD text to create anchored branch discussions, explore alternatives, and consolidate changes back into new canonical PRD versions. Once a version is marked final, the PRD becomes the source for downstream artifact generation, including text-based mockups and a bundle of product, design, and engineering documents. Each artifact is versioned and linked back to the PRD version that created it, enabling staleness detection and history tracking. Feedback from those artifacts can then return to the PRD stage as new branch work. The result is an AI-native product definition workspace with real workflow structure, not just a prompt box.

## 14. Evidence Table

| Claim / Insight | Why it matters | Supporting files/modules | Confidence | Good candidate for slide/infographic? |
| --- | --- | --- | --- | --- |
| Synapse is built around a canonical PRD spine with versioned revisions. | This is the central system story. | `src/types/index.ts`, `src/store/projectStore.ts`, `src/components/ProjectWorkspace.tsx` | High | Yes |
| The PRD is stored as both structured data and markdown. | This enables editing, export, and downstream derivation. | `src/types/index.ts`, `src/lib/llmProvider.ts`, `src/components/StructuredPRDView.tsx` | High | Yes |
| The app supports anchored branch discussions from selected PRD text. | This differentiates Synapse from static docs and chat-only tools. | `src/components/SelectableSpine.tsx`, `src/components/StructuredPRDView.tsx`, `src/components/BranchList.tsx` | High | Yes |
| Branch work consolidates into new PRD versions rather than mutating in place. | Shows workflow and history maturity. | `src/components/ConsolidationModal.tsx`, `src/store/projectStore.ts` | High | Yes |
| Synapse generates text mockups from the PRD with configurable fidelity/platform/scope. | Strong evidence of productized prompt design. | `src/components/MockupsView.tsx`, `src/lib/llmProvider.ts` | High | Yes |
| Synapse has a reusable artifact/version/provenance model. | This is one of the strongest engineering signals in the repo. | `src/types/index.ts`, `src/store/projectStore.ts`, `src/components/ArtifactsView.tsx` | High | Yes |
| Derived artifacts track staleness relative to the latest PRD. | Shows system-awareness and workflow polish. | `src/store/projectStore.ts`, `src/components/StalenessBadge.tsx` | High | Yes |
| The feedback loop routes downstream critique back into upstream PRD work. | Demonstrates closed-loop workflow design. | `src/components/FeedbackModal.tsx`, `src/components/FeedbackItemsList.tsx`, `src/components/ProjectWorkspace.tsx` | High | Yes |
| The exploration canvas is currently more scaffold than full engine. | Important to present honestly. | `src/components/BranchCanvas.tsx`, `PRD.md`, `PRD_COMPLIANCE.md` | High | No |
| Feedback extraction is manual, not automated. | Prevents overstating AI sophistication. | `src/components/FeedbackModal.tsx`, `README.md` | High | Yes |
| The current main app calls Gemini directly from the browser; serverless endpoints exist but are not integrated. | Important architectural tradeoff. | `src/lib/llmProvider.ts`, `api/*.ts` | High | Yes |
| The codebase is compact but meaningful: about 5.1k LOC across 26 TS/TSX modules. | Good portfolio framing for scope and density. | Source tree and line counts | High | Yes |
| Build and lint succeed, but the build warns about chunk size and ineffective code splitting. | Balanced engineering quality assessment. | `npm run build`, `npm run lint` | High | Yes |
| Legacy dev plan and agent prompt layers remain in the repo. | Signals system evolution and partially implemented breadth. | `src/types/index.ts`, `src/store/projectStore.ts`, `src/lib/llmProvider.ts`, `api/` | High | Maybe |

## 15. Gaps, Weaknesses, and Future Opportunities

### Honest current limitations

- Branch anchors are raw text, not stable offset-based references.
- Local consolidation uses naive string replacement, which is vulnerable to repeated phrases and formatting mismatches.
- Feedback extraction is manual despite the README language suggesting a more automatic loop.
- The exploration canvas currently generates mocked approaches rather than real decision artifacts.
- Serverless API handlers exist, but the main user flow still sends the Gemini API key from the browser.
- There are no automated tests.
- There is no shared backend persistence, auth, collaboration, or server-side job orchestration.
- The build produces a large client chunk and a code-splitting warning.
- Some legacy modules and types remain, which slightly blurs the current product scope.

### Strong next-step opportunities

- Replace `anchorText` with a stable `AnchorRef` model using offsets or AST-aware ranges.
- Add safe match previews and conflict-aware consolidation logic closer to the PRD spec.
- Route generation through the existing Vercel layer to improve security and deployment realism.
- Implement automated feedback extraction or critique generation from mockups/artifacts.
- Finish the prompt-artifact workflow and expose prompt generation in the current UI.
- Upgrade the exploration canvas into a real decision artifact workspace.
- Add integration tests around project creation, branching, consolidation, artifact generation, and export.
- Add semantic diffs and richer version provenance for artifacts, not just PRD consolidation.
- Introduce collaboration or backend persistence if the product is intended to become multi-user.

### Portfolio-enhancing improvements

- Add one or two seeded example projects so a reviewer can open the app and immediately inspect a full workflow.
- Generate a polished demo dataset and highlight it in the README.
- Add screenshot callouts that explicitly map UI surfaces to underlying technical mechanisms.
- Add a single slide-like architecture diagram to the README.
- Surface the implemented-vs-planned distinction more clearly in documentation.

## 16. Final Presentation-Ready Extraction

### A. Best recruiter messages

- Synapse is an AI-native product definition workspace, not just a PRD generator.
- It turns a raw idea into a structured PRD and a versioned set of downstream artifacts.
- The project demonstrates strong product-engineering thinking through branching, consolidation, provenance, and feedback loops.
- The most differentiated technical idea is the canonical PRD spine feeding a derived artifact system.

### B. Best technical highlights

- Schema-constrained PRD generation with typed TypeScript models
- Dual structured-data plus markdown representation for the PRD
- Branch-based document refinement anchored to selected text
- Versioned artifact model with provenance and staleness tracking
- Feedback loops that route artifact insights back into PRD revision

### C. Best visuals to create

- Idea -> PRD -> Mockups/Artifacts -> Feedback -> PRD loop
- PRD spine and branch consolidation diagram
- Artifact model/provenance diagram
- Seven core artifacts panel
- Mockup generation controls and compare mode

### D. Best architecture diagram to draw

```text
React Workspace UI
-> ProjectWorkspace orchestration
-> Zustand persisted domain store
-> Gemini provider functions
-> PRD spines / branches / artifacts / feedback / history
-> Exported markdown and versioned downstream outputs
```

Add a side note:

- Current shipping flow is browser-direct to Gemini
- Optional Vercel proxy layer exists but is not the primary path yet

### E. Best workflow story to tell

Start with the idea-to-PRD transformation, then show how Synapse makes the PRD editable, branchable, and versioned. From there, show how a finalized PRD becomes the source for mockups and core artifacts, then close the loop by showing feedback from those artifacts generating a new PRD branch. That story best captures both product value and technical depth.

### F. Best evidence-backed claims

- Synapse uses typed structured generation, not only freeform text generation.
- Synapse models derived outputs as versioned artifacts with source provenance.
- Synapse includes a closed-loop workflow where downstream outputs can influence the source PRD.
- Synapse has a richer interaction model than a generic AI wrapper because it supports branching, consolidation, staleness, and history.

### G. Best concise project description

Synapse is a React and TypeScript product workflow system that turns a rough product idea into a structured PRD and a versioned set of downstream design and engineering artifacts. Its strongest differentiator is a canonical PRD spine that supports branch-based refinement, artifact provenance, staleness tracking, and feedback loops back into the source specification.

## 17. Stretch Goal Answers

### What makes Synapse different from a generic AI product generator?

Synapse is different because it does not stop at "generate me a document." It treats the PRD as the canonical source in a larger artifact system. The repo shows explicit support for:

- iterative branch-based refinement
- versioned canonical source updates
- downstream artifact generation
- artifact provenance and staleness
- feedback loops back into the source spec

Most generic AI generators produce one isolated artifact per prompt. Synapse models relationships between artifacts over time.

### What technical story should I tell about Synapse in an interview?

The strongest interview story is:

> I wanted to build a system where a product idea could evolve as a connected workflow instead of disappearing into static docs and ad hoc chats. So I modeled a canonical PRD spine, added typed structured generation on top of Gemini, let users branch from specific sections of the PRD, and built a versioned artifact system that derives mockups and implementation-ready outputs from the current spec. The interesting challenge was not just calling an LLM, but designing the data model and UI so generated outputs could stay connected to their source and feed revisions back into it.

If asked about tradeoffs, say:

- I chose a local-first Zustand architecture to keep the product fast and demoable.
- I used schema-constrained generation for the PRD because downstream workflows needed typed data.
- I intentionally kept mockups text-based in v1 to explore workflow value before solving rendering complexity.
- The next architectural upgrades would be stable anchors, backend-mediated generation, and stronger merge safety.

### Which parts of Synapse are most visually impressive and should be turned into screenshots/mockups first?

Prioritize these in order:

1. PRD workspace in structured view, showing the canonical spine concept.
2. Mockups compare view, because it makes the artifact/version story visually obvious.
3. Core Artifacts view with several generated artifact cards expanded.
4. PRD feedback loop view, because it best communicates closed-loop workflow.
5. History view, because it reinforces versioning and provenance.

If you can only show three screens in a portfolio:

- PRD workspace
- Mockups compare
- Artifacts view

Those three together tell the clearest "idea -> spec -> derivative outputs" story.

## Appendix: Repo Facts Used in This Analysis

- Main stack: React 19, Vite, TypeScript, Zustand, Tailwind CSS, Lucide, Mark.js
- Approximate source size: 5,117 total lines across `src/` and `api/`
- Main logic concentration:
  - `src/store/projectStore.ts`
  - `src/lib/llmProvider.ts`
  - `src/components/ProjectWorkspace.tsx`
- Verification performed:
  - `npm run build` succeeded
  - `npm run lint` succeeded
- Build warnings observed:
  - ineffective dynamic import/code splitting around `src/lib/llmProvider.ts`
  - large production chunk warning around the main JS bundle
