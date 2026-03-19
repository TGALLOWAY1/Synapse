# Synapse

Synapse is a spec-driven PRD generation, mockup, and artifact pipeline — powered by LLM generation at every stage.

<img width="1430" height="837" alt="image" src="https://github.com/user-attachments/assets/5448db70-e98d-4571-81c1-112a1cb14986" />

## Features

### PRD Canvas
- Create projects with an initial prompt and generate structured PRDs via LLM
- Spine versioning with full history tracking
- Branch-based refinement: highlight text, create branches, discuss in threads
- Consolidation engine merges branch insights back into the PRD
- Mark PRD as Final, export as Markdown

### Mockups
- Generate text-based UI mockups from the finalized PRD
- Configurable settings: platform (desktop/mobile/responsive), fidelity (low/mid/high), scope (single screen/multi-screen/key workflow)
- Optional style direction and emphasis notes
- Version management with side-by-side comparison
- Preferred version selection
- Staleness detection when the source PRD changes

### Core Artifacts
- Generate 7 structured artifacts derived from the PRD:
  - **Screen Inventory** — all screens and views implied by the PRD
  - **User Flows** — primary user journeys and flow sequences
  - **Component Inventory** — reusable UI components
  - **Implementation Plan** — milestone-oriented build sequence
  - **Data Model Draft** — entities, relationships, and data needs
  - **Prompt Pack** — downstream prompts for coding, critique, testing
  - **Design System Starter** — foundational UI system draft
- Generate individually or all at once ("Generate All" bundle)
- Regenerate any artifact when the PRD evolves
- Staleness badges show which artifacts may need regeneration

### Feedback Loop
- Extract structured feedback from any mockup or artifact version
- 8 feedback categories: Feature Addition, Workflow Refinement, IA/Navigation, Missing State, Visual System, Ambiguous Requirement, Implementation Consideration, Naming/Wording
- Open feedback items appear on the PRD stage with one-click "Apply to PRD" (creates a branch)
- Mark feedback as incorporated or dismissed

### Project History
- Full-page timeline of all project events grouped by date
- Tracks PRD creation, regeneration, consolidation, artifact generation, feedback creation, and feedback application
- Diff previews for consolidation events

## Run Instructions

1. Install dependencies: `npm install`
2. Set your Gemini API key (see **Setup Checklist** below)
3. Run development server: `npm run dev`
4. Build for production: `npm run build`

## Setup Checklist

> **Manual steps you need to complete before using Synapse:**

- [ ] **Get a Gemini API key** — Go to [Google AI Studio](https://aistudio.google.com/apikey) and create an API key
- [ ] **Configure the API key** — Open the Settings modal (gear icon in the workspace header) and paste your Gemini API key
- [ ] **Verify LLM generation works** — Create a test project and confirm the PRD generates successfully
- [ ] **Test Mockup generation** — Navigate to the Mockups tab, configure settings, and generate a mockup
- [ ] **Test Core Artifacts** — Navigate to the Artifacts tab and generate at least one artifact (or use "Generate All")
- [ ] **Test Feedback loop** — Extract feedback from a mockup, then check it appears on the PRD stage with the "Apply" action
- [ ] **Clear legacy localStorage** (if upgrading from a previous version) — Old `devplan`/`prompts` stage data will auto-migrate, but you may want to clear browser storage for a clean start

## QA Checklist

### S1: Project Setup & Shell
- [x] Home page loads and shows project list.
- [x] Can create a new project with title and initial prompt.
- [x] Workspace page loads with Spine (left), Branches (right), and History sidebar.
- [x] Projects persist across browser refreshes (LocalStorage).

### S2: Spine Generation & Controls
- [x] Creating a project triggers a mock LLM generation delay.
- [x] "Regenerate" button creates a new Spine version and records a history event.
- [x] "Abandon Session" returns user to the Home page.
- [x] Side "Versions" panel lists initialized and regenerated spine events.

### S3: Anchors and Branches
- [x] Users can highlight text in the spine to summon a popover.
- [x] Users can type an intent in the popover and hit 'Branch' to create a new branch.
- [x] Branches appear in the middle column, and users can reply to them in a thread.
- [x] Regenerating the spine is disabled if there are active branches on the latest spine.

### S4: Consolidation Engine
- [x] Click "Consolidate" on an active branch to open the modal.
- [x] Modal shows loading state while "synthesizing patches".
- [x] Two patches are shown: Local and Doc-Wide.
- [x] Committing a patch creates a new Spine version and closes the modal.
- [x] The new Spine is set as active, and the Branch is marked as merged.

### S5: Version Sidebar + Constraints
- [x] Consolidated events in the right sidebar show a small diff preview of what changed.
- [x] Clicking a past spine version in the right sidebar switches the workspace to view it.
- [x] A yellow warning banner explains the view is Read-Only.
- [x] Text highlighting to spawn new branches is disabled while viewing historical spines.
- [x] Clicking "Return to Latest" restores the active latest spine.

### S6: Exploration Canvases
- [x] Click the Expand (Maximize) icon on an active branch to dive into the Canvas view.
- [x] A dedicated route `/p/:projectId/branch/:branchId` loads the Branch context.
- [x] Clicking "Generate Approaches" synthesizes multiple mock Drafts.
- [x] Clicking a Draft selects it.
- [x] Clicking "Apply to Spine" merges the selected draft into the Spine, creating a new authoritative version and returning the user to the workspace.

### S7: Export & Final Polish
- [x] Click "Mark Final" inside the workspace top bar (for active spine only). It highlights green.
- [x] Viewing historical spines hides the "Mark Final" button.
- [x] Click "Export" to download a Markdown file of the currently viewed spine.
- [x] The downloaded file is named `projectname-prd-vX.md`.
- [x] The exported file includes a header with the version number, date, and FINAL/DRAFT status.

### S8: Mockups & Artifacts (New)
- [ ] Pipeline navigation shows 4 tabs: PRD, Mockups, Artifacts, History.
- [ ] Mockups tab generates text-based mockups with configurable settings.
- [ ] Generated mockups display in expandable cards with version info.
- [ ] Side-by-side comparison works when 2+ versions exist.
- [ ] "Extract Feedback" opens the feedback modal with category selection.
- [ ] Artifacts tab shows 7 core artifact types with generate/regenerate buttons.
- [ ] "Generate All" creates all 7 artifacts sequentially.
- [ ] Staleness badges appear when the source PRD has been updated since generation.
- [ ] History tab shows a full timeline of all events grouped by date.
- [ ] Feedback items appear on the PRD stage with Apply/Incorporate/Dismiss actions.
- [ ] "Apply to PRD" creates a branch from the feedback content and opens the branches panel.
