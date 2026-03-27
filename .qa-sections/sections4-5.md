## 4. 30-Minute Smoke Test

> **Purpose:** A time-boxed, high-priority pass to catch the most demo-breaking issues before a live walkthrough or share. If any step fails, stop and fix before proceeding.
>
> **Total estimated time:** 30 minutes

---

### Block 1: Environment Readiness (2 min)

| # | Check | Pass/Fail |
|---|-------|-----------|
| 1.1 | Dev server starts without errors (`npm run dev`, page loads at `localhost:5173`) | [ ] |
| 1.2 | Open Settings modal, confirm a valid Gemini API key is saved | [ ] |
| 1.3 | Console is free of errors on initial load (open DevTools > Console) | [ ] |

---

### Block 2: Project Creation + PRD Generation (5 min)

| # | Check | Pass/Fail |
|---|-------|-----------|
| 2.1 | Click "+" on HomePage, enter a project name and a 1-2 sentence product prompt, submit | [ ] |
| 2.2 | App navigates to `/p/:projectId` without errors | [ ] |
| 2.3 | Loading/generation indicator is visible while PRD is being generated | [ ] |
| 2.4 | PRD generation completes within 60 seconds | [ ] |
| 2.5 | Structured PRD view renders with distinct sections (vision, features, architecture, risks) | [ ] |
| 2.6 | Raw markdown view is also accessible and displays valid content | [ ] |

---

### Block 3: PRD Refinement (5 min)

| # | Check | Pass/Fail |
|---|-------|-----------|
| 3.1 | Select a text range in the PRD and trigger "Create Branch" (context menu or button) | [ ] |
| 3.2 | Branch panel opens, showing the selected text as context | [ ] |
| 3.3 | Type a refinement message and submit; AI reply appears within 30 seconds | [ ] |
| 3.4 | Accept/consolidate the AI suggestion back into the PRD | [ ] |
| 3.5 | Updated PRD reflects the consolidated change in both structured and markdown views | [ ] |

---

### Block 4: Pipeline Progression (2 min)

| # | Check | Pass/Fail |
|---|-------|-----------|
| 4.1 | Mark the current PRD version as "Final" | [ ] |
| 4.2 | Mockups stage tab/button becomes enabled after marking final | [ ] |
| 4.3 | Artifacts stage tab/button becomes enabled after marking final | [ ] |
| 4.4 | Pipeline navigation tabs reflect correct locked/unlocked state | [ ] |

---

### Block 5: Mockup Generation (3 min)

| # | Check | Pass/Fail |
|---|-------|-----------|
| 5.1 | Navigate to Mockups stage, select platform/fidelity/scope options | [ ] |
| 5.2 | Click generate; loading indicator appears | [ ] |
| 5.3 | At least one mockup renders on completion without layout breakage | [ ] |
| 5.4 | Mockup content is relevant to the project prompt (not garbage output) | [ ] |

---

### Block 6: Artifact Generation (5 min)

| # | Check | Pass/Fail |
|---|-------|-----------|
| 6.1 | Navigate to Artifacts stage; artifact type list is visible | [ ] |
| 6.2 | Generate a "Screen Inventory" artifact; structured renderer displays content correctly | [ ] |
| 6.3 | Generate a "User Flows" artifact; structured renderer displays content correctly | [ ] |
| 6.4 | Generate a "Data Model" artifact; structured renderer displays content correctly | [ ] |
| 6.5 | Each generated artifact appears in the artifact list with correct type label | [ ] |

---

### Block 7: Markup Image (3 min)

| # | Check | Pass/Fail |
|---|-------|-----------|
| 7.1 | Select a markup image type from the available options | [ ] |
| 7.2 | Click generate; loading indicator appears | [ ] |
| 7.3 | SVG markup image renders in the viewer without clipping or overflow | [ ] |
| 7.4 | Image content has recognizable structure (labels, boxes, annotations) | [ ] |

---

### Block 8: Export (3 min)

| # | Check | Pass/Fail |
|---|-------|-----------|
| 8.1 | Open the Export modal from the project workspace | [ ] |
| 8.2 | Export PRD as markdown; file downloads with `.md` extension and valid content | [ ] |
| 8.3 | Export full bundle; downloaded archive contains PRD + artifacts | [ ] |
| 8.4 | Open the exported markdown in a text editor; formatting is intact | [ ] |

---

### Block 9: Persistence (2 min)

| # | Check | Pass/Fail |
|---|-------|-----------|
| 9.1 | Hard-refresh the browser (Ctrl/Cmd+Shift+R) on the project workspace page | [ ] |
| 9.2 | Project still appears in the project list on HomePage | [ ] |
| 9.3 | Navigate back into the project; PRD content, artifacts, and mockups are intact | [ ] |
| 9.4 | Branch history and conversation messages are preserved | [ ] |

---

**Smoke test result:** ______ / 31 checks passed

> If any check in Blocks 2-4 fails, the app is not demo-ready. Blocks 5-9 failures are serious but may be deferrable depending on context.

---

## 5. Full Pre-Release Checklist

> **Purpose:** Comprehensive release-readiness verification. Work through every checkbox before tagging a release or sharing broadly. Items marked **(critical)** are release blockers.

---

### 5.1 Core Flows

- [ ] Create a new project with a name and prompt **(critical)**
- [ ] Generate a PRD from the prompt **(critical)**
- [ ] View the generated PRD in structured view **(critical)**
- [ ] View the generated PRD in raw markdown view
- [ ] Edit the project name after creation
- [ ] Delete a project from the project list
- [ ] Create multiple projects; each maintains independent state
- [ ] Export a PRD as markdown **(critical)**
- [ ] Export a full project bundle **(critical)**

---

### 5.2 PRD & Branching

- [ ] Select text in the PRD to create a branch **(critical)**
- [ ] Branch panel displays the selected text as anchored context
- [ ] Send a message in a branch; AI responds with relevant refinement
- [ ] Accept/consolidate a branch suggestion into the PRD **(critical)**
- [ ] Consolidated changes appear in both structured and markdown views
- [ ] Create multiple branches on different sections of the same PRD
- [ ] Branch conversation history persists across page navigation
- [ ] Dismiss/close a branch without accepting changes
- [ ] Create a new PRD version; version list updates correctly
- [ ] Mark a PRD version as final **(critical)**
- [ ] Switching between PRD versions shows correct content
- [ ] Cannot mark a version as final if one is already final (or replaces it cleanly)

---

### 5.3 Generation Workflows

**Mockups:**
- [ ] Generate a mockup with default settings **(critical)**
- [ ] Change platform option and regenerate; output reflects the change
- [ ] Change fidelity option and regenerate; output reflects the change
- [ ] Change scope option and regenerate; output reflects the change
- [ ] Multiple mockups can coexist in the mockup list
- [ ] Mockup content is relevant to the finalized PRD

**Core Artifacts (7 types):**
- [ ] Generate Screen Inventory **(critical)**
- [ ] Generate User Flows **(critical)**
- [ ] Generate Component Inventory
- [ ] Generate Implementation Plan
- [ ] Generate Data Model
- [ ] Generate Prompt Pack
- [ ] Generate Design System
- [ ] Each artifact type uses its correct structured renderer
- [ ] Artifact versioning works (regenerate an artifact, both versions accessible)
- [ ] Mark a preferred artifact version

**Markup Images (5 types):**
- [ ] Generate each of the 5 markup image types
- [ ] SVG output renders without clipping, overflow, or blank areas
- [ ] Markup images contain recognizable labels/annotations
- [ ] Markup images are visually relevant to the PRD content

---

### 5.4 Persistence & Data Integrity

- [ ] All project data survives a hard refresh (Ctrl/Cmd+Shift+R) **(critical)**
- [ ] All project data survives closing and reopening the browser tab **(critical)**
- [ ] localStorage contains expected keys after project creation
- [ ] Deleting a project removes its data from localStorage
- [ ] Creating 3+ projects does not corrupt any individual project's data
- [ ] Large PRD content (2000+ words) persists without truncation
- [ ] Clearing localStorage and refreshing shows clean empty state (no crash)
- [ ] Corrupted localStorage JSON does not crash the app on load

---

### 5.5 Pipeline Navigation

- [ ] Stages before "Mark Final" are locked: Mockups and Artifacts tabs are disabled **(critical)**
- [ ] After marking final, Mockups and Artifacts stages unlock **(critical)**
- [ ] History stage is always accessible
- [ ] Clicking between pipeline stages preserves content in each stage
- [ ] Direct URL navigation to `/p/:id` loads the correct project and stage
- [ ] Back/forward browser buttons work within the workspace
- [ ] Pipeline stage indicators visually reflect completion state

---

### 5.6 Error States & Recovery

- [ ] Invalid API key shows a clear, actionable error message **(critical)**
- [ ] Network timeout during generation shows an error (not infinite spinner) **(critical)**
- [ ] Rate-limited API response is handled gracefully with user feedback
- [ ] Generation failure does not corrupt existing project data **(critical)**
- [ ] Submitting an empty prompt is prevented or handled with validation
- [ ] Navigating away during generation does not crash the app
- [ ] API error messages do not expose raw stack traces to the user
- [ ] Retry after failure works without requiring a page refresh

---

### 5.7 Empty & Loading States

- [ ] HomePage with no projects shows a meaningful empty state (not a blank page)
- [ ] Project workspace before PRD generation shows appropriate placeholder
- [ ] Mockups stage with no mockups shows an empty state with generate action
- [ ] Artifacts stage with no artifacts shows an empty state with generate actions
- [ ] Loading spinners/skeletons appear during all AI generation calls
- [ ] Loading indicators disappear once generation completes or fails
- [ ] No flash of unstyled content (FOUC) on initial page load

---

### 5.8 Mobile & Responsive

- [ ] HomePage renders without horizontal scroll at 375px width
- [ ] Project workspace is usable at 768px width (tablet)
- [ ] Settings modal is fully visible and interactive on mobile
- [ ] Export modal is fully visible and interactive on mobile
- [ ] Text in structured PRD view does not overflow its container on small screens
- [ ] Pipeline stage tabs/navigation is accessible on narrow viewports
- [ ] Touch targets (buttons, links) are at least 44x44px on mobile

---

### 5.9 Browser Compatibility

**Chrome (latest):**
- [ ] All core flows pass
- [ ] localStorage persistence works
- [ ] No console errors

**Firefox (latest):**
- [ ] All core flows pass
- [ ] localStorage persistence works
- [ ] No console errors

**Safari (latest):**
- [ ] All core flows pass
- [ ] localStorage persistence works (check Safari's storage limits)
- [ ] No console errors

**Edge (latest):**
- [ ] All core flows pass
- [ ] localStorage persistence works
- [ ] No console errors

---

### 5.10 Performance Feel

- [ ] HomePage loads and is interactive within 2 seconds
- [ ] Project workspace loads and shows content within 2 seconds
- [ ] Switching between pipeline stages feels instant (< 300ms)
- [ ] Typing in branch message input has no perceptible lag
- [ ] Scrolling through a long PRD is smooth (no jank)
- [ ] Rendering a large artifact (50+ items) does not freeze the UI
- [ ] SVG markup images render without visible delay after data is available
- [ ] No memory leaks during repeated generation cycles (check DevTools > Memory)

---

### 5.11 Visual Consistency

- [ ] Dark theme is applied consistently across all views and modals
- [ ] No light-background "flash" elements that break the dark theme
- [ ] Font sizes and weights are consistent across headings and body text
- [ ] Spacing and padding are uniform across cards, panels, and sections
- [ ] Icons render correctly (no missing glyphs or fallback squares)
- [ ] Scrollbars are styled or hidden consistently
- [ ] Modal overlays dim the background and prevent interaction behind them
- [ ] Active/selected states are visually distinct (tabs, list items, buttons)

---

### 5.12 Destructive Actions

- [ ] Deleting a project requires confirmation before executing **(critical)**
- [ ] Deleting a project actually removes it from the list and localStorage
- [ ] "Mark as Final" warns or confirms if it will lock editing
- [ ] Overwriting an artifact version does not silently discard the previous version
- [ ] Clearing the API key from settings warns if projects exist
- [ ] No destructive action is reachable with a single unintentional click

---

### 5.13 Accessibility Basics

- [ ] All interactive elements are reachable via keyboard Tab navigation
- [ ] Focused elements have a visible focus ring/outline
- [ ] Modals trap focus and can be closed with Escape
- [ ] Buttons and links have accessible labels (not empty or icon-only without aria-label)
- [ ] Color contrast meets WCAG AA for body text (4.5:1 ratio)
- [ ] Generation status changes are announced to screen readers (aria-live or equivalent)
- [ ] Form inputs have associated labels
- [ ] Images and SVGs have alt text or aria-label where meaningful

---

### 5.14 Export & Output Quality

- [ ] Exported PRD markdown opens correctly in GitHub, VS Code, or any markdown viewer
- [ ] Exported markdown preserves headings, lists, bold/italic formatting
- [ ] Exported bundle contains all expected files (PRD + generated artifacts)
- [ ] Exported file names are sanitized (no special characters that break file systems)
- [ ] Export works for a project with only a PRD (no artifacts yet)
- [ ] Export works for a project with PRD + mockups + all artifact types
- [ ] Downloaded files are non-empty and have correct MIME types
- [ ] Re-importing or reviewing exported content matches what was shown in-app

---

### 5.15 State Consistency

- [ ] Editing the PRD in markdown view updates the structured view after save/consolidation **(critical)**
- [ ] Structured view sections match the raw markdown content exactly
- [ ] Preview of an artifact matches its saved/persisted version
- [ ] Switching between editor and preview does not lose unsaved input
- [ ] Branch consolidation updates all views (structured, markdown, preview)
- [ ] Artifact version marked as "preferred" is the one shown by default
- [ ] History stage events reflect all actions taken (generation, edits, branching)
- [ ] Project list metadata (name, last modified) stays in sync with workspace changes
