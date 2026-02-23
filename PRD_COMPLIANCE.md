# PRD Compliance Mapping

## S1: Project shell + routing + persistence
**PRD Sections Satisfied:**
- **Overview:** Minimal structure initiated.
- **E1 Skeleton:** Routes (`/`, `/p/[projectId]`), LocalStorage persistence via Zustand, Spine/Branch layout shell.

**QA Steps (S1):**
1. Load `/` to view the project list.
2. Click "New Project", enter a name and prompt, and submit.
3. Verify routing to `/p/[projectId]` and that the workspace shell loads the project details.
4. Refresh the page to verify LocalStorage persistence.

---

## S2: Spine generation + retry/abandon
**PRD Sections Satisfied:**
- **Invariants:** 
  - "Spine Authority" established (latest un-branched spine represents source of truth).
  - Version history model initialized (tracking events in store).
- **E1 Skeleton:**
  - Mock LLM provider interface created.
  - "Retry/Regenerate" control added (creates new spine version).
  - "Abandon Session" control added (redirects to start).
  - Sidebar history visually lists versions.

**QA Steps (S2):**
1. Create a new project.
2. Observe "Generating PRD..." state followed by mock LLM response.
3. View the sidebar History tab to see "Spine v1 created" event.
4. Click "Regenerate" and observe generating state -> new mock response -> "Spine v2" history event.
5. Click "Abandon Session" and observe redirect to Home page.
