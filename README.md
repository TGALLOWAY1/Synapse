# Synapse v1

Synapse v1 is a spec-driven PRD generation and refinement canvas.

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
