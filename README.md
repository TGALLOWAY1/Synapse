# Synapse 

Synapse v1 is a spec-driven PRD generation and refinement canvas.

<img width="1430" height="837" alt="image" src="https://github.com/user-attachments/assets/5448db70-e98d-4571-81c1-112a1cb14986" />

## Run Instructions
1. Install dependencies: `npm install`
2. Run development server: `npm run dev`
3. Build for production: `npm run build`

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
