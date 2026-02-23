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

---

## S3: Anchors + Branch Creation
**PRD Sections Satisfied:**
- **Invariants:** 
  - "Thread Topology" established (Branches are threaded conversations anchored to text).
  - Version-scoped Branches (Branches are tied to `spineVersionId` in state).
- **E2 Anchors & Local Adjustments:**
  - Users can highlight text in the spine to create a branch.
  - Branch data model implemented with messages.
  - Sidebar rendering of branch cards with mock LLM replies.

**QA Steps (S3):**
1. Open a generated PRD.
2. Highlight a word or sentence.
3. In the popover, type an instruction (e.g. "make this sound like a pirate") and click "Branch".
4. Observe the new Branch card in the middle column.
5. Wait for the mock LLM assistant to reply.
6. Type a follow-up reply in the Branch card input and submit.
7. Attempt to click "Regenerate" in the top bar - it should be disabled because a branch exists.

---

## S4: Consolidation Engine
**PRD Sections Satisfied:**
- **Invariants:**
  - "Spine Authority" verified (consolidation mints a new authoritative Spine).
- **E3 Synthesis Engine:**
  - Implementation of local vs doc-wide patch generation concepts (mocked).
  - Merging branch state back into project spine hierarchy.

**QA Steps (S4):**
1. In an active branch, click the "Consolidate" button.
2. Wait for the mock LLM to generate patches.
3. Toggle between "Local Scope" and "Doc-Wide Scope" previews.
4. Click "Commit to New Spine".
5. Observe the Spine versions increment and the branch disappear from the active view.
6. Check the History tab to see the "Consolidated" event.
