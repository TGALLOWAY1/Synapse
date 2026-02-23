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
