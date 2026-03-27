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
## 3. Manual QA Test Plan

### 3.1 HomePage (HOME)

| Test ID | Scenario | Preconditions | Steps | Expected Result | Watch For | Priority |
|---------|----------|---------------|-------|-----------------|-----------|----------|
| HOME-001 | Empty state display | No projects exist (fresh localStorage) | 1. Open app at `/` | "No projects yet. Create one to get started!" message shown | Missing empty state text, layout issues | High |
| HOME-002 | Create project happy path | API key configured | 1. Click "New Project" 2. Enter name "Test App" 3. Enter prompt "Build a task manager" 4. Click "Generate First Draft" | Modal closes, navigates to `/p/:id`, PRD begins generating | Navigation happens before modal close animation completes | Critical |
| HOME-003 | Create project without API key | No API key in localStorage | 1. Click "New Project" 2. Fill in name + prompt 3. Click "Generate First Draft" | Settings modal opens instead of creating project | Silent failure with no feedback to user | Critical |
| HOME-004 | Create project with empty fields | API key set | 1. Click "New Project" 2. Leave name empty 3. Click "Generate First Draft" | Button is disabled; cannot submit | Button enabled despite empty fields | High |
| HOME-005 | Delete project (no confirmation) | At least 1 project exists | 1. Hover over project card 2. Click trash icon | Project deleted immediately without confirmation dialog | Data loss; no way to recover deleted project | High |
| HOME-006 | Navigate to existing project | Project exists | 1. Click on project card | Navigates to `/p/:projectId`, workspace loads with correct stage | Wrong project loads, blank workspace | High |
| HOME-007 | Multiple projects display | 3+ projects created | 1. View home page | All projects shown in grid with names, dates, stage badges | Cards overlap, dates wrong, missing badges | Medium |
| HOME-008 | Project stage badge accuracy | Projects at different stages | 1. View project cards | Each shows correct badge (PRD / PRD Final / etc.) | Stale badge after stage change | Medium |
| HOME-009 | Settings access from home | On home page | 1. Click settings gear icon | Settings modal opens with current API key and model | Modal doesn't open, key not pre-filled | Medium |

### 3.2 Settings (SET)

| Test ID | Scenario | Preconditions | Steps | Expected Result | Watch For | Priority |
|---------|----------|---------------|-------|-----------------|-----------|----------|
| SET-001 | Set API key | Settings modal open | 1. Enter valid Gemini API key 2. Click "Apply Changes" | Key saved to localStorage, modal closes | Key not persisted after page refresh | Critical |
| SET-002 | Change model selection | Settings modal open | 1. Select "Gemini 2.5 Pro" radio 2. Click "Apply Changes" | Model preference saved, used for next generation | Model reverts to Flash on refresh | High |
| SET-003 | Invalid API key | Settings open | 1. Enter "invalid-key-123" 2. Apply 3. Try to generate PRD | Key accepted by settings, but generation fails with clear error | Silent failure or cryptic error message | High |
| SET-004 | API key persistence | Key previously set | 1. Close browser tab 2. Reopen app 3. Open settings | API key field shows saved key (masked) | Key lost after restart | High |
| SET-005 | Cancel without saving | Settings open, key changed | 1. Modify API key 2. Click "Cancel" | Original key preserved, changes discarded | Changed key saved despite cancel | Medium |

### 3.3 PRD Generation (PRD)

| Test ID | Scenario | Preconditions | Steps | Expected Result | Watch For | Priority |
|---------|----------|---------------|-------|-----------------|-----------|----------|
| PRD-001 | Structured PRD generation | Project just created | 1. Wait for async generation to complete | Structured PRD appears with vision, features, architecture, risks sections | JSON parsing failure shows raw error in markdown | Critical |
| PRD-002 | Structured view rendering | PRD generated | 1. View structured PRD tab | Feature cards, architecture section, risks displayed correctly | Missing sections, broken card layout | Critical |
| PRD-003 | Toggle markdown vs structured view | PRD generated | 1. Toggle between markdown and structured views | Both views render correctly, show same content | Content mismatch between views | High |
| PRD-004 | Edit feature in structured view | PRD with features | 1. Click edit on a feature card 2. Change name + description 3. Click save | Feature updated in structured PRD, change persists | Edit lost on view toggle, save fails silently | High |
| PRD-005 | Regenerate PRD | Existing PRD | 1. Click regenerate button 2. Wait for completion | New spine version created, structured view updates | Old version shown, history event missing | High |
| PRD-006 | PRD generation error | Invalid API key | 1. Create project with bad key | Error message displayed: "Error generating PRD: ..." with guidance | Blank screen, unhandled error, spinner stuck | Critical |
| PRD-007 | Very short prompt | API key set | 1. Create project with prompt "app" | PRD generates (quality may be low) but doesn't crash | App crashes on minimal input | Medium |
| PRD-008 | Very long prompt | API key set | 1. Create project with 5000+ character prompt | PRD generates without truncation issues | Prompt cut off, API error for length | Medium |

### 3.4 Branching (BRANCH)

| Test ID | Scenario | Preconditions | Steps | Expected Result | Watch For | Priority |
|---------|----------|---------------|-------|-----------------|-----------|----------|
| BRANCH-001 | Create branch via text selection | PRD visible in markdown view | 1. Select text in PRD 2. Popover appears 3. Type intent "Clarify this section" 4. Submit | Branch created, appears in sidebar with anchor text | Popover doesn't appear, selection lost | High |
| BRANCH-002 | AI reply in branch | Branch exists | 1. Type reply in branch thread 2. Send | AI responds with relevant content in thread | Reply fails silently, message duplicated | High |
| BRANCH-003 | Consolidate branch (local patch) | Branch with messages | 1. Click consolidate 2. Select "Local Patch" 3. Click "Generate Local Patch" 4. Review preview 5. Click "Commit to New Spine" | Anchor text replaced, new spine version created, branch marked merged | Anchor text not found error, patch applied wrong | Critical |
| BRANCH-004 | Consolidate branch (doc-wide) | Branch with messages | 1. Click consolidate 2. Select "Doc-Wide Rewrite" 3. Click "Generate Global Patch" 4. Review 5. Commit | Entire PRD rewritten incorporating branch feedback | Rewrite loses unrelated content | High |
| BRANCH-005 | Anchor text mismatch | PRD edited after branch created | 1. Create branch 2. Edit PRD text that contains anchor 3. Try to consolidate (local) | Error: "Could not locate the exact anchor text..." with suggestion to try doc-wide | Crash, silent failure, corrupted spine | High |
| BRANCH-006 | Delete branch | Branch exists | 1. Click delete on branch | Branch removed from sidebar | Branch persists, orphaned messages | Medium |
| BRANCH-007 | Multiple branches | PRD visible | 1. Create 3 branches on different text selections | All branches listed, anchor highlights visible via Mark.js | Overlapping highlights, wrong anchors | Medium |
| BRANCH-008 | Branch canvas view | Branch exists | 1. Open branch canvas (full-screen) | Draft list on left, preview on right, can generate/apply drafts | Layout broken, drafts not loading | Medium |

### 3.5 Pipeline Navigation (STAGE)

| Test ID | Scenario | Preconditions | Steps | Expected Result | Watch For | Priority |
|---------|----------|---------------|-------|-----------------|-----------|----------|
| STAGE-001 | Disabled stages before final | PRD not marked final | 1. Click "Mockups" tab 2. Click "Artifacts" tab | Both tabs disabled (cursor-not-allowed), cannot navigate | Tabs clickable despite being disabled | High |
| STAGE-002 | Mark PRD final | PRD generated | 1. Click "Mark Final" | PRD marked final, Mockups + Artifacts tabs become enabled | Tabs still disabled, button state wrong | Critical |
| STAGE-003 | Navigate between stages | PRD marked final | 1. Click Mockups 2. Click Artifacts 3. Click History 4. Click PRD | Each stage view loads correctly | Wrong view rendered, state leaks between stages | High |
| STAGE-004 | Stage persists on refresh | On Artifacts stage | 1. Refresh page | Returns to Artifacts stage for this project | Resets to PRD stage | Medium |
| STAGE-005 | Un-finalize PRD after artifacts | Artifacts generated | 1. If possible, un-mark PRD as final | Artifacts should show staleness or warning | Artifacts silently become unreachable | Medium |

### 3.6 Mockups (MOCK)

| Test ID | Scenario | Preconditions | Steps | Expected Result | Watch For | Priority |
|---------|----------|---------------|-------|-----------------|-----------|----------|
| MOCK-001 | Generate mockup (defaults) | PRD final, on Mockups stage | 1. Click generate 2. Use default settings (Desktop/Low-fi/Key Workflow) 3. Wait | Mockup appears with ASCII art layout | Generation hangs, empty output | High |
| MOCK-002 | Generate with different settings | On Mockups stage | 1. Set Mobile / High-fi / Multiple Screens 2. Generate | Output reflects settings (mobile layout, polished detail) | Settings ignored, same output regardless | Medium |
| MOCK-003 | Compare mockup versions | 2+ mockup versions exist | 1. Click compare mode 2. Select two versions | Side-by-side comparison displayed | Layout broken, wrong versions compared | Medium |
| MOCK-004 | Regenerate mockup | Mockup exists | 1. Click regenerate on existing mockup | New version created, old version still accessible | Old version overwritten | Medium |
| MOCK-005 | Extract feedback from mockup | Mockup exists | 1. Click feedback button 2. Fill in title + type 3. Submit | Feedback item created, visible in PRD stage | Feedback orphaned, doesn't appear in list | Medium |

### 3.7 Core Artifacts (ART)

| Test ID | Scenario | Preconditions | Steps | Expected Result | Watch For | Priority |
|---------|----------|---------------|-------|-----------------|-----------|----------|
| ART-001 | Generate single artifact | PRD final, on Artifacts stage | 1. Click generate on "Screen Inventory" | Structured screen inventory renders with groups and cards | JSON parse failure, fallback to raw markdown | Critical |
| ART-002 | Bundle generation (all 7) | PRD final | 1. Click "Generate All" bundle action | All 7 artifacts generate (max 3 concurrent), progress shown per artifact | Some fail silently, stuck in generating state | Critical |
| ART-003 | Bundle partial failure | PRD final, API intermittent | 1. Start bundle generation 2. Observe if any fail | Failed artifacts show error status, successful ones preserved | All artifacts lost on partial failure | High |
| ART-004 | Data Model renderer | Data Model artifact exists | 1. Expand Data Model artifact | Entity tables, relationships, API endpoints render correctly | Table layout broken, missing fields | High |
| ART-005 | Component Inventory renderer | Component Inventory exists | 1. Expand artifact | Categories, component cards with props render | Props display broken, complexity badges wrong | High |
| ART-006 | Refine artifact | Artifact exists | 1. Enter refinement instruction 2. Submit | New version created with refinement applied | Refinement replaces instead of improving | Medium |
| ART-007 | Staleness badge | PRD changed after artifact gen | 1. Regenerate PRD 2. Check artifact staleness badges | Badges show "possibly_outdated" or "outdated" | Badges stuck on "current" despite stale source | High |
| ART-008 | Refresh stale artifact | Artifact shows outdated | 1. Click refresh/regenerate | New version generated from latest PRD | Regenerated from old PRD version | High |
| ART-009 | Artifact version management | Multiple versions exist | 1. Check version list 2. Set different preferred version | Preferred version displayed, badge updates | Wrong version shown as preferred | Medium |
| ART-010 | Validation warnings | Artifact with issues | 1. Generate artifact that may have quality issues | Validation warnings shown (length, structure, headers) | Warnings missing for poor quality output | Low |

### 3.8 Markup Images (MARKUP)

| Test ID | Scenario | Preconditions | Steps | Expected Result | Watch For | Priority |
|---------|----------|---------------|-------|-----------------|-----------|----------|
| MARKUP-001 | Generate Critique Board | PRD final, on Markup tab | 1. Click generate for "Critique Board" | SVG renders with annotation layers (boxes, callouts, markers) | SVG empty, layers mispositioned | High |
| MARKUP-002 | Generate all 5 types | PRD final | 1. Generate each type: Critique Board, Wireframe Callout, Flow Annotation, Screenshot Annotation, Design Feedback | Each renders distinct SVG with appropriate layer types | Same output for all types | Medium |
| MARKUP-003 | SVG export/download | Markup image rendered | 1. Click Download button | SVG file downloads with correct content | Empty file, broken SVG, wrong filename | High |
| MARKUP-004 | Arrow rendering | Markup with arrows | 1. Check generated markup with arrow layers | Arrows render with correct direction, arrowheads, positions | Arrows point wrong direction, missing arrowheads | Medium |
| MARKUP-005 | Number markers | Markup with numbered markers | 1. Check legend display | Numbered circles (1-9) render with legend explaining each | Numbers overlap, legend missing | Medium |
| MARKUP-006 | Text overflow in boxes | Markup with long text callouts | 1. Check boxes and callouts with long text | Text wraps or truncates gracefully | Text overflows box boundaries | Medium |

### 3.9 Export (EXP)

| Test ID | Scenario | Preconditions | Steps | Expected Result | Watch For | Priority |
|---------|----------|---------------|-------|-----------------|-----------|----------|
| EXP-001 | Export PRD as markdown | PRD exists | 1. Click Export 2. Click "Export PRD" | Markdown file downloads with PRD content | Empty file, formatting broken | High |
| EXP-002 | Export full bundle | PRD + artifacts exist | 1. Click "Export Full Bundle" | Single markdown file with PRD + all artifacts + mockups | Missing artifacts, ordering wrong | High |
| EXP-003 | Export structured JSON | Structured PRD exists | 1. Click "Export Structured JSON" | JSON file downloads with typed data | JSON parse error, missing fields | Medium |
| EXP-004 | Export individual artifact | Specific artifact exists | 1. Click download on individual artifact | Artifact content downloads as markdown | Wrong content, preferred version not used | Medium |
| EXP-005 | Export with no content | No artifacts generated | 1. Open export modal | Disabled buttons for missing content, clear indication | Buttons enabled but download empty files | Medium |

### 3.10 Feedback (FB)

| Test ID | Scenario | Preconditions | Steps | Expected Result | Watch For | Priority |
|---------|----------|---------------|-------|-----------------|-----------|----------|
| FB-001 | Create feedback item | Artifact exists | 1. Click feedback button 2. Enter title "Add search feature" 3. Select type "Feature Addition" 4. Select target "PRD" 5. Click "Create Feedback" | Feedback created, appears in PRD stage's feedback list | Feedback not visible in list, wrong type | Medium |
| FB-002 | Apply feedback to PRD | Feedback item exists | 1. In PRD stage, see feedback list 2. Click "Apply to PRD" | Branch created from feedback, can consolidate | Branch not created, feedback status unchanged | Medium |
| FB-003 | Dismiss feedback | Feedback exists | 1. Click dismiss/reject on feedback item | Feedback marked rejected, removed from active list | Still shows as open | Low |
| FB-004 | Empty title validation | Feedback modal open | 1. Leave title empty 2. Try to create | "Create Feedback" button disabled | Can submit without title | Medium |

### 3.11 History (HIST)

| Test ID | Scenario | Preconditions | Steps | Expected Result | Watch For | Priority |
|---------|----------|---------------|-------|-----------------|-----------|----------|
| HIST-001 | Timeline display | Multiple events exist | 1. Navigate to History tab | Events grouped by date, chronological order | Wrong order, missing events, ungrouped | Medium |
| HIST-002 | Diff viewing | Spine regenerated | 1. Find regeneration event 2. Expand diff | Diff shows old vs new text | Diff display broken, empty content | Medium |
| HIST-003 | Event types and icons | Various events | 1. Check event icons and colors | Each event type has correct icon and color | Wrong icons, missing type labels | Low |

### 3.12 Persistence (PERSIST)

| Test ID | Scenario | Preconditions | Steps | Expected Result | Watch For | Priority |
|---------|----------|---------------|-------|-----------------|-----------|----------|
| PERSIST-001 | Refresh preserves project | Project with PRD | 1. Generate PRD 2. Refresh page | Project loads, PRD content intact, correct stage | Blank page, missing content, wrong stage | Critical |
| PERSIST-002 | Refresh preserves artifacts | Artifacts generated | 1. Generate artifacts 2. Refresh | All artifacts present with correct preferred versions | Artifacts missing, versions lost | Critical |
| PERSIST-003 | Debounce data loss | Making changes | 1. Make a change 2. Immediately close tab (within 500ms) 3. Reopen | Change may be lost due to debounce | N/A — this is expected behavior; document it | High |
| PERSIST-004 | Large project localStorage | Project with all artifacts + branches | 1. Check localStorage size in DevTools 2. Verify under ~5MB | App functions normally | Quota exceeded error, app breaks | High |
| PERSIST-005 | Corrupted state recovery | N/A | 1. Manually corrupt localStorage JSON 2. Reload app | App handles gracefully (empty state or error message) | White screen, infinite loop, console errors | Medium |
| PERSIST-006 | Navigate to nonexistent project | No project with given ID | 1. Navigate to `/p/fake-id-123` | Graceful handling (redirect to home or error) | Blank workspace, console errors | Medium |

### 3.13 Mobile and Responsive (MOB)

| Test ID | Scenario | Preconditions | Steps | Expected Result | Watch For | Priority |
|---------|----------|---------------|-------|-----------------|-----------|----------|
| MOB-001 | Home page on mobile | Mobile viewport (375px) | 1. View home page | Project cards stack, create button accessible | Overflow, text truncation, button off-screen | High |
| MOB-002 | Workspace sidebar hidden | Mobile viewport | 1. Open project workspace | Right sidebar (branches/history) hidden per `hidden lg:flex` | Sidebar overlaps content, no way to access branches | High |
| MOB-003 | Pipeline stage bar mobile | Mobile viewport | 1. Check stage navigation | Labels may hide (`hidden sm:inline`), icons remain | Buttons too small to tap, bar overflows | Medium |
| MOB-004 | Modal display on mobile | Mobile viewport | 1. Open Settings/Export/Feedback modal | Modal fits screen, scrollable if needed | Modal extends beyond viewport, buttons unreachable | Medium |
| MOB-005 | Text selection on touch | Mobile, PRD view | 1. Try to select text for branch creation | Touch selection triggers popover | Popover doesn't appear, interferes with scroll | Medium |
| MOB-006 | SVG markup on mobile | Mobile, markup image | 1. View generated markup image | SVG scales or scrolls appropriately | SVG overflows, tiny unreadable text | Medium |

### 3.14 Edge Cases (EDGE)

| Test ID | Scenario | Preconditions | Steps | Expected Result | Watch For | Priority |
|---------|----------|---------------|-------|-----------------|-----------|----------|
| EDGE-001 | Special characters in project name | On home page | 1. Create project named `<script>alert('xss')</script>` | Name displayed safely, no script execution | XSS vulnerability, broken display | High |
| EDGE-002 | Rapid generate clicks | On artifacts page | 1. Click generate rapidly 5 times on same artifact | Only one generation runs, subsequent clicks ignored | Multiple generations fire, race condition | High |
| EDGE-003 | Navigate during generation | PRD generating | 1. Start PRD generation 2. Click browser back 3. Navigate forward | Generation completes or cancels gracefully | Orphaned generation, state corruption | High |
| EDGE-004 | Concurrent bundle + individual gen | On artifacts page | 1. Start bundle generation 2. Try to generate individual artifact | Second action blocked or queued | Both run, duplicate artifacts created | Medium |
| EDGE-005 | Unicode/emoji in prompt | API key set | 1. Create project with emoji-heavy prompt "Build a 🎮 gaming app with 日本語 support" | PRD generates handling unicode correctly | Encoding issues, broken rendering | Medium |
| EDGE-006 | Browser back/forward | In workspace | 1. Navigate Home → Project → Home → back → forward | Each navigation state correct | SPA routing breaks, wrong project loads | Medium |
| EDGE-007 | Multiple tabs same project | Project exists | 1. Open project in two tabs 2. Make changes in tab 1 3. Refresh tab 2 | Tab 2 picks up changes from localStorage | Stale data in tab 2, conflicting writes | Medium |
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

- [ ] Deleting a project removes it from the list and localStorage **(critical)**
- [ ] **Known gap:** Project deletion currently has NO confirmation dialog — verify this is still the case and flag if not yet fixed
- [ ] "Mark as Final" behavior is clear (is it reversible? what does it lock?)
- [ ] Overwriting an artifact version does not silently discard the previous version
- [ ] Branch deletion removes the branch without orphaning data
- [ ] No destructive action causes silent data loss without the user's awareness

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
## 6. User Verification Plan

### Who Should Test

| Tester Type | Why They Matter | What They'll Catch |
|-------------|-----------------|-------------------|
| **Product Manager** | Core target user; understands PRD workflows | Feature gaps, workflow friction, missing capabilities |
| **Developer** | Will use generated artifacts to build | Artifact quality issues, missing technical detail, export problems |
| **Designer** | Evaluates visual output quality | Mockup quality, markup image usefulness, visual polish |
| **Non-technical friend** | Tests discoverability and clarity | Confusing UX, unclear terminology, broken onboarding |
| **Someone on mobile** | Tests responsive experience | Layout breaks, touch issues, inaccessible features |

### Specific Tasks to Assign

Give testers these tasks **without explaining how to do them**:

1. "Create a new project for a recipe-sharing mobile app and generate a product spec"
2. "Find a section of the generated spec you disagree with and suggest an improvement"
3. "Generate mockups for your project — try both mobile and desktop"
4. "Generate all the product artifacts and check if the screen list looks right"
5. "Export your project so you could share it with a teammate"
6. "Create a second project and switch between them"
7. "Close the browser and come back — is your work still there?"

### What NOT to Explain in Advance

- Don't explain what "Mark Final" means or why stages are disabled
- Don't explain the branching system
- Don't explain artifact types or what "staleness" means
- Don't explain the pipeline stages
- Don't point out where the settings are
- Let them discover (or fail to discover) features naturally

### What to Observe

Watch for these signals while they use the app:

- **Hesitation**: Where do they pause and look confused?
- **Misclicks**: What do they click expecting something different?
- **Questions**: What do they ask you about? (These are UX failures)
- **Workarounds**: Do they try to accomplish something the app doesn't support?
- **Abandonment**: At what point do they stop or give up?
- **Delight**: What makes them say "oh cool" or "that's nice"?
- **Errors**: Do they hit any error states? How do they react?
- **Recovery**: When something fails, can they figure out what to do next?

### Post-Test Questions

**Open-ended:**
1. "What did you think this app was for?"
2. "What was the most confusing part?"
3. "What would you want it to do that it doesn't?"
4. "Would you use this? Why or why not?"

**Specific:**
5. "Did the generated PRD feel useful or generic?"
6. "Were you able to figure out how to improve the PRD?"
7. "Did the export contain what you expected?"
8. "How did it feel on your device (speed, layout)?"

### Distinguishing Bug vs Confusing UX vs Missing Feature

| Category | Signal | Example | Action |
|----------|--------|---------|--------|
| **Bug** | Something doesn't work as designed | "I clicked Generate and nothing happened" | Fix it |
| **Confusing UX** | Works but user can't figure it out | "I didn't know I had to mark the PRD final first" | Improve affordances/copy |
| **Missing Feature** | User wants something that doesn't exist | "I want to undo that change" | Evaluate and prioritize |

### Collecting Feedback

1. Have testers fill out the **Tester Feedback Template** (Section 11) after each session
2. Take notes during observation using the **Observer Checklist** below
3. Record screen if possible (with consent)
4. Group findings into: Bugs, UX Issues, Feature Requests
5. Prioritize by frequency (how many testers hit it) and severity

### Lightweight Tester Script

Copy-paste this to send to testers:

> **Hey! I'd love your help testing a new tool I'm building.**
>
> Synapse helps you turn a product idea into a structured spec with AI.
>
> **What I need from you (15-20 minutes):**
> 1. Go to [APP URL]
> 2. Click the settings gear icon and paste this API key: [KEY]
> 3. Try to create a project for any app idea you have
> 4. Explore — generate a spec, try to improve it, generate artifacts, export your work
> 5. Try it on your phone too if you can
>
> **After you're done**, please answer these quick questions:
> - What did you think the tool was for?
> - What was confusing?
> - What broke or didn't work?
> - What did you like?
> - Would you use this? (1 = no way, 5 = definitely)
>
> Don't worry about being nice — honest feedback helps the most. Thanks!

### Observer Checklist

Use this while watching someone test:

```
Observer: _______________  Tester: _______________  Date: ___________

FIRST IMPRESSION
[ ] Did they understand what the app does within 30 seconds?
[ ] Did they find the "New Project" button?
[ ] Did they figure out the API key setup?

CORE FLOW
[ ] Did they successfully create a project?
[ ] Did they read/understand the generated PRD?
[ ] Did they try to edit or refine anything?
[ ] Did they discover the branching feature?
[ ] Did they figure out "Mark Final"?
[ ] Did they navigate to other stages?

GENERATION
[ ] Did they generate mockups?
[ ] Did they generate artifacts?
[ ] Did they explore the markup images?

OUTPUT
[ ] Did they try to export?
[ ] Were they satisfied with the output quality?

PROBLEMS
[ ] Confusion points: _________________________________
[ ] Errors encountered: _______________________________
[ ] Features they looked for but couldn't find: ________
[ ] Things they tried to do but couldn't: _____________

OVERALL
[ ] Engagement level: Low / Medium / High
[ ] Would they use again: Yes / Maybe / No
[ ] Biggest takeaway: _________________________________
```

---

## 7. Highest-Risk Areas / Likely Failure Points

### Risk 1: localStorage Persistence Fragility

**Location:** `src/store/projectStore.ts` — `createDebouncedStorage()` adapter and `persist` middleware

**Risk:** All user data lives in localStorage with a 500ms debounce. There is no backup, no export-on-save, and no quota detection.

**Symptoms:**
- Data loss if browser closes within 500ms of a change
- `QuotaExceededError` on large projects with many artifacts (localStorage limit ~5MB)
- Corrupted JSON leaves app in broken state on next load

**Manual test:** Create a project, generate all artifacts, check `localStorage` size in DevTools (Application → Local Storage → look at `synapse-projects-storage` entry size). If approaching 4MB+, try adding more content and watch for failures.

**Severity:** Critical

---

### Risk 2: Generation State Management Race Conditions

**Location:** Multiple components use independent `useState<boolean>` for generation state:
- `ProjectWorkspace.tsx`: `isGenerating` (line ~26)
- `ArtifactsView.tsx`: `generatingSubtype`, `bundleStatus`
- `MockupsView.tsx`: `isGenerating`
- `MarkupImageView.tsx`: `generatingSubtype`

**Risk:** No centralized state machine. If a user navigates away during generation and back, the `isGenerating` state resets to `false` (component unmounts) while the generation Promise is still running. When it resolves, it may write to stale state references or the wrong project.

**Symptoms:**
- Generation spinner disappears but content appears later
- Generated content appears in wrong artifact slot
- "Generate" button re-enabled while generation is in progress
- Duplicate artifacts from rapid clicks

**Manual test:** Start generating an artifact, quickly switch to a different pipeline stage, switch back. Check if generation state is consistent.

**Severity:** High

---

### Risk 3: Branch Consolidation Anchor Mismatch

**Location:** `src/components/ConsolidationModal.tsx` and `src/lib/llmProvider.ts` — `consolidateBranch()`

**Risk:** Local consolidation relies on finding the exact `anchorText` in the current spine text. If the PRD has been edited or regenerated since the branch was created, the anchor text won't be found.

**Symptoms:**
- Error banner: "Could not locate the exact anchor text in the document"
- User stuck in consolidation modal with no clear resolution
- Suggestion to "try Doc-Wide Rewrite" may rewrite more than intended

**Manual test:** Create a branch → edit the PRD near the anchor text → try to consolidate with "Local Patch" → verify error message appears and doc-wide fallback works.

**Severity:** High

---

### Risk 4: Structured PRD JSON Parsing Failures

**Location:** `src/lib/llmProvider.ts` — `generateStructuredPRD()` which uses Gemini JSON mode with a schema

**Risk:** Gemini's JSON mode can return malformed or unexpected structures. The structured PRD is parsed and rendered by `StructuredPRDView.tsx` with feature cards, architecture sections, etc. Missing fields crash renderers.

**Symptoms:**
- Blank structured view with console error
- Missing feature cards or sections
- Error text displayed in markdown view instead of structured view
- `Cannot read property 'map' of undefined` errors

**Manual test:** Generate PRDs with unusual prompts (very short, non-English, technical jargon). Check if structured view renders without errors.

**Severity:** High

---

### Risk 5: Bundle Generation Concurrency Issues

**Location:** `src/components/ArtifactsView.tsx` — bundle generation with `withConcurrency(tasks, 3)`

**Risk:** 7 artifacts generated with max 3 concurrent. If some fail and others succeed, the UI must correctly show partial results. Each artifact's status (`pending`/`generating`/`done`/`error`) is tracked in `bundleStatus` state.

**Symptoms:**
- Some artifacts stuck in "generating" state after failure
- Error artifacts not clearly marked
- Successful artifacts lost when one fails
- Bundle status doesn't update to reflect completion

**Manual test:** Start bundle generation. If possible, simulate a failure (e.g., temporarily invalidate API key mid-generation by changing it in DevTools). Verify partial results are preserved and error states are clear.

**Severity:** High

---

### Risk 6: SVG Markup Rendering Edge Cases

**Location:** `src/components/MarkupImageRenderer.tsx` (~263 lines)

**Risk:** Complex SVG rendering with arrow math (calculating arrowhead positions), text positioning in boxes/callouts, and multiple layer types. Generated `MarkupImageSpec` from Gemini may have coordinates outside canvas bounds, overlapping elements, or unsupported layer types.

**Symptoms:**
- Arrows pointing wrong direction or off-canvas
- Text overflowing box boundaries
- Elements rendered at negative coordinates
- SVG blank or extremely small
- Number markers overlapping
- Download produces broken SVG

**Manual test:** Generate all 5 markup image types. For each, verify: layers render within canvas, arrows have visible arrowheads, text is readable, numbered markers are sequential, download produces valid SVG.

**Severity:** Medium

---

### Risk 7: Export Content vs Display Content Mismatch

**Location:** `src/components/ExportModal.tsx`

**Risk:** Export builds content from current Zustand state. The "preferred" version may not match what's displayed if version switching has bugs. Bundle export concatenates all artifacts — ordering and completeness not guaranteed.

**Symptoms:**
- Exported markdown missing sections
- Exported JSON missing fields or containing null values
- Bundle export has duplicate or missing artifacts
- Exported content differs from what user sees in UI

**Manual test:** Generate all artifacts, set non-default preferred versions on some, export bundle. Open exported file and verify it matches the in-app display.

**Severity:** Medium

---

### Risk 8: Pipeline Stage Gating Edge Cases

**Location:** `src/components/PipelineStageBar.tsx` — `hasPRD` prop controls disabled state

**Risk:** Mockups and Artifacts tabs require `hasPRD` (spine marked final). But what happens if: PRD is un-finalized after artifacts exist? Artifacts become inaccessible but still exist in store. There's no clear UX for this situation.

**Symptoms:**
- Artifacts tab disabled but artifacts exist (data stranded)
- No warning when un-finalizing that downstream content will become inaccessible
- Staleness badges not updated when PRD finalization status changes

**Manual test:** Generate artifacts → un-finalize PRD (if possible) → check if artifacts are still accessible or if any warning is shown.

**Severity:** Medium

---

### Risk 9: No Confirmation on Destructive Actions

**Location:** `src/components/HomePage.tsx` — delete button, `src/components/BranchList.tsx` — branch deletion

**Risk:** Project deletion has no confirmation dialog. A single click permanently destroys all project data (PRD, branches, artifacts, history). Branch deletion similarly has no confirmation.

**Symptoms:**
- Accidental data loss
- No undo mechanism
- User panic when project disappears

**Manual test:** Create a project with generated artifacts. Hover over it on home page and click delete. Verify it's immediately gone with no confirmation and no way to recover.

**Severity:** High

---

### Risk 10: Mobile Layout — Hidden Sidebar and Dense UIs

**Location:** `src/components/ProjectWorkspace.tsx` — right sidebar uses `hidden lg:flex`

**Risk:** On screens below the `lg` breakpoint (1024px), the entire right sidebar (branches, history tabs) is hidden. There's no hamburger menu or alternative access. Branch-related workflows are completely inaccessible on mobile.

**Symptoms:**
- No way to view, create, or manage branches on mobile
- No access to history sidebar on mobile
- Dense artifact views difficult to read on small screens
- Modals may extend beyond viewport

**Manual test:** Use Chrome DevTools device emulation (iPhone 14, iPad). Navigate through all stages. Verify branches can or cannot be accessed. Check modal positioning.

**Severity:** High

---

### Risk 11: Staleness Detection Logic

**Location:** `src/store/projectStore.ts` — `getArtifactStaleness()` method

**Risk:** Staleness is determined by comparing an artifact's `sourceRefs` (which reference a specific spine version) against the latest spine. If sourceRefs are not set correctly during generation, or if the comparison logic has edge cases (e.g., artifacts without sourceRefs), badges may be inaccurate.

**Symptoms:**
- "Current" badge on stale artifacts
- "Outdated" badge on fresh artifacts
- No badge shown at all
- Badge doesn't update after PRD regeneration

**Manual test:** Generate artifacts → regenerate PRD → check all artifact staleness badges → regenerate one artifact → verify its badge changes to "current" while others remain "outdated."

**Severity:** Medium

---

### Risk 12: API Key in Plaintext localStorage

**Location:** `src/components/SettingsModal.tsx`, `src/lib/llmProvider.ts` — `localStorage.getItem('GEMINI_API_KEY')`

**Risk:** The Gemini API key is stored in plaintext in localStorage. Any browser extension, XSS vulnerability, or shared computer scenario could expose the key.

**Symptoms:**
- Key visible in DevTools → Application → Local Storage
- Potential unauthorized API usage if key is compromised

**Manual test:** Set API key, then open DevTools → Application → Local Storage → check `GEMINI_API_KEY` is visible in plaintext. Note: the settings modal labels this "stored locally" but doesn't mention plaintext.

**Severity:** Medium (acceptable for MVP, should be documented)

---

## 8. What Should Be Automated Later

> **Purpose:** A prioritized roadmap of test automation investments. Each recommendation includes what to automate, why it matters, the class of bugs it catches, and a suggested priority level (P0 = must-have before launch, P1 = next sprint, P2 = soon after, P3 = nice-to-have).

---

### 8.1 Unit Tests (Vitest)

Vitest is the recommended runner for Vite-based projects — zero additional bundler config, native TypeScript and ESM support, and sub-second watch-mode feedback.

| # | What to Automate | Why It Matters | Bugs It Catches | Priority |
|---|------------------|----------------|-----------------|----------|
| U-1 | **Zustand store CRUD actions** — `createProject`, `deleteProject`, `createArtifact`, `createArtifactVersion`, etc. | The store is 819 lines with 50+ actions; manual coverage is infeasible. | State not updating, stale references, missing fields on create/update. | P0 |
| U-2 | **Versioning logic** — `createArtifactVersion`, `setPreferredVersion`, `getLatestArtifactVersion`, spine versioning via `regenerateSpine`. | Version management is a core user-facing feature; regressions silently corrupt data. | Wrong version marked preferred, version list order bugs, version metadata loss. | P0 |
| U-3 | **Staleness detection** — any action that marks downstream content stale when the PRD changes. | Staleness flags control pipeline progression; false negatives let users proceed on outdated content. | Stale flag not set after PRD edit, stale flag not cleared after regeneration. | P0 |
| U-4 | **Storage migration / schema evolution** — roundtrip serialize → deserialize with older localStorage payloads. | Without migration tests, any type change risks bricking returning users' data. | Crash on load after app update, silent data loss during migration. | P1 |
| U-5 | **LLM response parsing — JSON mode** — feed `generateStructuredPRD`, `generateCoreArtifact`, `generateDevPlan` known JSON strings and assert parsed output. | Gemini's structured output may drift or include wrapper text; parsing must be resilient. | JSON parse failures, missing required fields, incorrect type coercion. | P0 |
| U-6 | **LLM response parsing — streaming chunks** — simulate partial SSE chunks for `replyInBranch` and `consolidateBranch`. | Streaming reassembly is fragile; a single off-by-one in chunk concatenation corrupts the response. | Truncated responses, duplicated text, malformed markdown from split UTF-8 sequences. | P1 |
| U-7 | **LLM error handling** — simulate 429 rate-limit, 500 server error, network timeout, invalid API key. | Users see raw errors or infinite spinners if error paths are untested. | Unhandled promise rejections, missing error toasts, stuck loading states. | P1 |
| U-8 | **Artifact validation logic** (`artifactValidation.ts`) — pass artifacts with known quality issues and assert scores. | Validation drives the quality badge shown to users; wrong scores erode trust. | Score inflation/deflation, crash on edge-case artifact shapes. | P1 |
| U-9 | **`structuredPRDToMarkdown` conversion** — roundtrip structured PRD → markdown and verify section headers, content integrity. | Markdown export is user-facing (copy/paste into docs); formatting bugs are visible. | Missing sections, broken markdown syntax, lost content in nested structures. | P1 |
| U-10 | **Type serialization / deserialization** — verify all types in `types/index.ts` survive `JSON.stringify` → `JSON.parse`. | localStorage persistence depends on lossless JSON roundtrip; `Date` objects, `undefined` values, and `Map`/`Set` do not survive naively. | Date fields become strings, optional fields silently dropped, app crash on hydration. | P2 |

---

### 8.2 Integration Tests (Vitest + React Testing Library)

These tests render real React components backed by the real Zustand store (no mocks for state) but stub the Gemini API at the network boundary.

| # | What to Automate | Why It Matters | Bugs It Catches | Priority |
|---|------------------|----------------|-----------------|----------|
| I-1 | **Project creation → PRD generation → state update flow.** Create a project via the UI, stub a Gemini response, assert the store contains a valid structured PRD and the view renders it. | This is the golden path — if it breaks, the app is unusable. | Form validation gaps, store not wired to component, PRD not rendered after generation. | P0 |
| I-2 | **Branch creation → message → consolidation → spine update.** Select text, open a branch, send a message (stubbed), consolidate, and verify the main PRD reflects the change. | Branch consolidation touches multiple store slices and re-renders the PRD view. | Consolidation silently fails, PRD text not updated, branch status stuck. | P0 |
| I-3 | **Artifact generation → version creation → preferred version logic.** Generate an artifact (stubbed), create a second version, toggle preferred, and verify the renderer shows the correct version. | Multi-version artifacts are a differentiating feature; version switching is error-prone. | Wrong version displayed, version count off-by-one, preferred flag not persisted. | P1 |
| I-4 | **Feedback creation → status transition → PRD application.** Create feedback on a PRD section, transition it through statuses (open → accepted → applied), and verify the PRD updates accordingly. | Feedback-to-PRD application is a multi-step workflow that crosses component boundaries. | Status transition skips a state, applied feedback not reflected in PRD, orphaned feedback entries. | P1 |
| I-5 | **Export content matches displayed content.** Generate a project with PRD + artifacts, trigger export, and diff the exported content against what the renderers display. | Export is the primary output of the tool; divergence from the UI is a silent data integrity bug. | Missing sections in export, stale content exported, encoding issues in exported markdown. | P1 |

---

### 8.3 E2E Tests (Playwright)

Playwright is already installed (`playwright@^1.58.2`) but unconfigured. These tests run a real browser against the dev server and hit the real Gemini API (or a local mock server for CI).

| # | What to Automate | Why It Matters | Bugs It Catches | Priority |
|---|------------------|----------------|-----------------|----------|
| E-1 | **Full project creation → export flow.** Create project, wait for PRD generation, navigate through pipeline stages, export. | Validates the entire happy path end-to-end with real browser behavior, real localStorage, and real rendering. | Routing bugs, race conditions between generation and navigation, export producing empty files. | P0 |
| E-2 | **Pipeline stage progression.** Create project, finalize PRD, verify Mockups stage unlocks, generate mockup, verify Artifacts stage unlocks. | Stage locking/unlocking is a core UX constraint; manual testing is slow due to generation wait times. | Stage accessible before prerequisite is met, stage locked after prerequisite is met, navigation guard regressions. | P1 |
| E-3 | **Branch workflow end-to-end.** Open a project, create a branch from selected text, send multiple messages, consolidate back, verify PRD update. | Branches involve text selection (browser-native), a side panel, streaming responses, and state merging — many moving parts. | Text selection range incorrect, branch panel does not open, consolidation button disabled incorrectly, merged text malformed. | P1 |
| E-4 | **Multi-project management.** Create 3 projects, switch between them, delete one, verify the other two are intact. | Multi-project state isolation bugs only surface when switching contexts. | Active project bleeds into another, deletion removes wrong project, project list not updated after delete. | P2 |

---

### 8.4 Visual Regression Tests (Playwright Screenshots or Chromatic)

Pixel-level comparisons catch CSS regressions that functional tests miss. Playwright's `toHaveScreenshot()` is the zero-cost starting point; Chromatic integrates with Storybook if the team adopts it later.

| # | What to Automate | Why It Matters | Bugs It Catches | Priority |
|---|------------------|----------------|-----------------|----------|
| V-1 | **MarkupImageRenderer SVG output.** Screenshot the rendered SVG for a known mockup payload. | SVG rendering is sensitive to viewBox, font metrics, and stroke widths — invisible to DOM-based assertions. | Clipped SVG, wrong colors, missing text labels, broken gradients. | P2 |
| V-2 | **Structured renderers** — `ScreenInventoryRenderer`, `DataModelRenderer`, `ComponentInventoryRenderer`. | These renderers display complex tabular/graph-like data; layout shifts are common after Tailwind changes. | Overlapping columns, truncated cell content, missing rows, broken responsive layout. | P2 |
| V-3 | **Empty / loading / error states.** Screenshot each major view in its empty, loading, and error variants. | These states are seen frequently (first launch, slow API, invalid key) but rarely tested visually. | Spinner misaligned, empty state text overlapping CTA button, error banner hidden behind other elements. | P2 |
| V-4 | **Mobile responsive breakpoints.** Screenshot at 375px (iPhone SE), 768px (iPad), and 1024px (small laptop). | Tailwind breakpoint changes can silently break mobile layout. | Horizontal scroll on mobile, touch targets too small, hidden navigation. | P3 |

---

### 8.5 Smoke Tests (Playwright)

Lightweight, fast tests (under 30 seconds total) designed to run on every commit or deploy preview. They assert only that the app boots and core navigation works — no Gemini API calls required.

| # | What to Automate | Why It Matters | Bugs It Catches | Priority |
|---|------------------|----------------|-----------------|----------|
| S-1 | **App loads without errors.** Navigate to `/`, assert no uncaught exceptions in the console, assert the page title or heading is visible. | Catches build-time breakage (bad import, missing env var, syntax error) before any deeper test runs. | White screen of death, missing chunk files, hydration mismatch. | P0 |
| S-2 | **Project creation succeeds.** Fill in the new project form, submit, assert navigation to `/p/:projectId`. | Validates the most critical user action without waiting for LLM generation. | Form submit handler broken, router misconfigured, store action throws. | P0 |
| S-3 | **Navigation between routes works.** Visit `/`, create a project (or seed localStorage), navigate to the project page, navigate back to `/`. | Catches routing regressions, lazy-load failures, and guard logic bugs. | Blank page on route change, back button broken, lazy chunk 404. | P1 |
| S-4 | **Settings modal opens and closes.** Click the settings icon, assert the modal is visible, close it, assert it is hidden. | Settings is the entry point for API key configuration — if it breaks, no generation works. | Modal z-index hidden behind other elements, close button not wired, body scroll lock not released. | P1 |

---

## 9. Test Environment and Setup Checklist

> **Purpose:** Everything a new tester needs to go from zero to running Synapse locally, including how to configure it, reset state, and inspect internals.

---

### 9.1 Prerequisites

| Requirement | Details |
|-------------|---------|
| **Node.js** | v18 or later (v20 LTS recommended). Verify with `node -v`. |
| **npm** | v9 or later (ships with Node 18+). Verify with `npm -v`. |
| **Gemini API Key** | Required for any generation feature. Free tier is sufficient for testing. |
| **Browser** | Chrome (primary), plus Firefox, Safari, and Edge for cross-browser passes. |
| **Git** | For cloning the repo. Any recent version. |

---

### 9.2 Local Setup Steps

```bash
# 1. Clone the repository
git clone <repo-url> && cd Synapse

# 2. Install dependencies
npm install

# 3. Start the dev server
npm run dev
# → App is available at http://localhost:5173

# 4. (Optional) Run a production-like build
npm run build && npm run preview
# → Preview server at http://localhost:4173
```

No `.env` file is required. The Gemini API key is entered at runtime through the Settings modal and stored in localStorage — it is never committed to the repository.

---

### 9.3 Obtaining a Gemini API Key

1. Go to [https://aistudio.google.com/apikey](https://aistudio.google.com/apikey).
2. Sign in with a Google account.
3. Click **Create API Key** and select or create a Google Cloud project.
4. Copy the generated key (starts with `AIza...`).
5. In Synapse, open the **Settings** modal (gear icon, top-right), paste the key into the **API Key** field, and save.

> **Tip:** The free tier provides generous rate limits for manual QA. If you hit 429 rate-limit errors during heavy testing, wait 60 seconds or switch to a second key.

---

### 9.4 Configuring Settings

Open the **Settings** modal (gear icon in the top navigation bar):

| Setting | What to Enter | Notes |
|---------|---------------|-------|
| **API Key** | Your Gemini API key | Required for all generation features. |
| **Model** | Select from the available Gemini models | Different models vary in speed and output quality; use the default for standard QA. |

Settings are persisted in localStorage alongside project data.

---

### 9.5 Browser Coverage Matrix

| Browser | Priority | Notes |
|---------|----------|-------|
| **Chrome (latest)** | Primary | All development and primary QA happens here. |
| **Firefox (latest)** | Secondary | Test at least the smoke test suite and one full project flow. |
| **Safari (latest, macOS)** | Secondary | Known differences in `localStorage` quota, `fetch` streaming, and CSS grid. |
| **Edge (latest)** | Low | Chromium-based; expect near-identical behavior to Chrome. Spot-check only. |

---

### 9.6 Mobile Testing

Synapse uses Tailwind responsive breakpoints. Test mobile layouts using:

1. **Chrome DevTools Device Mode** — Toggle the device toolbar (`Ctrl+Shift+M` / `Cmd+Shift+M`). Test at these presets:
   - iPhone SE (375 x 667)
   - iPhone 14 Pro (393 x 852)
   - iPad (768 x 1024)
2. **Real Devices** — If available, test on a physical iPhone (Safari) and Android phone (Chrome). Focus on touch interactions: tap targets, scroll behavior, and modal dismissal.

> **Note:** Synapse is a desktop-first productivity tool. Mobile is a secondary concern, but the app should remain usable (no horizontal scroll, no overlapping elements, all controls reachable).

---

### 9.7 How to Reset Application State

All Synapse data lives in a single localStorage entry. To reset to a clean slate:

**Option A — Browser DevTools:**
1. Open DevTools → **Application** tab → **Local Storage** → `http://localhost:5173`.
2. Right-click the key `synapse-projects-storage` → **Delete**.
3. Reload the page.

**Option B — Console one-liner:**
```javascript
localStorage.removeItem('synapse-projects-storage'); location.reload();
```

**Option C — Nuclear reset (all sites):**
- DevTools → Application → Local Storage → right-click the origin → **Clear**.

> **Warning:** Resetting state deletes all projects, PRDs, branches, artifacts, and settings. There is no undo.

---

### 9.8 How to Inspect Application State

The Zustand store persists its entire state tree to localStorage as JSON. To inspect it:

1. Open DevTools → **Application** tab → **Local Storage** → `http://localhost:5173`.
2. Click the `synapse-projects-storage` key.
3. The value is a JSON object. Copy it into a JSON formatter (or use DevTools' built-in preview) to explore.

Key things to look for:
- `state.projects` — map of all projects keyed by project ID.
- Active project is determined by the URL route parameter (`/p/:projectId`), not a stored field.
- `state.spineVersions` — PRD versions keyed by project ID.
- `state.branches` — discussion branches keyed by project ID.
- `state.artifacts` — artifact containers keyed by project ID.
- `state.artifactVersions` — versioned content keyed by project ID.
- `state.feedbackItems` — feedback items keyed by project ID.

---

### 9.9 Debug Tooling

| Tool | What It Shows | How to Access |
|------|---------------|---------------|
| **Browser Console** | Debounced storage writes log when the store persists to localStorage. Uncaught errors and React warnings also appear here. | DevTools → Console. Filter by `[store]` or `[persist]` if log noise is high. |
| **Network Tab** | All Gemini API calls (`generativelanguage.googleapis.com`). Inspect request payloads (prompt, generation config) and response bodies (generated JSON/text). | DevTools → Network. Filter by `generativelanguage` to isolate API traffic. |
| **React DevTools** (optional) | Component tree, props, and Zustand hook values. Useful for debugging why a component is not re-rendering. | Install the React DevTools browser extension. |
| **Application Tab** | localStorage contents (see Section 9.8). Also shows service workers, cache storage, and cookies (Synapse uses none of these). | DevTools → Application. |

---

### 9.10 Seed Data and Example Projects

Synapse does not ship with seed data or example projects. Every test run starts from an empty state (after a localStorage reset). To create test data:

1. **Manually** — Create a new project via the UI with a short prompt (e.g., "A simple to-do list app"). Wait for PRD generation, then proceed through the pipeline.
2. **localStorage injection** — Copy a known-good `synapse-projects-storage` JSON blob and paste it into localStorage via the Console. Reload the page. This is useful for skipping generation steps when testing downstream features (mockups, artifacts, export).

> **Tip:** Save a few localStorage snapshots at different pipeline stages (fresh project, finalized PRD, generated mockups, generated artifacts) so you can quickly jump to the stage you need to test.

---

### 9.11 Architecture Notes for Testers

| Aspect | Detail |
|--------|--------|
| **No backend / no database** | Synapse is a pure client-side SPA. There is no server, no database, and no authentication. All data lives in the browser's localStorage. |
| **No feature flags** | Every feature is always on. There are no toggles, A/B tests, or staged rollouts to worry about. |
| **No database reset needed** | Since there is no database, the only "reset" is clearing localStorage (Section 9.7). |
| **API calls are client-side** | Gemini API calls go directly from the browser to Google's API. There is no backend proxy. This means the API key is visible in the Network tab — this is expected for a client-side tool. |
| **Vercel deployment** | Production and preview deploys are hosted on Vercel. Each PR gets a unique preview URL. Test preview deployments the same way you test locally — the only difference is the URL. |
| **No environment variables at build time** | The app does not read from `.env` or process environment variables. All configuration (API key, model selection) is entered at runtime via the Settings modal. |

---

## 10. Bug Report Template

Copy and paste the template below for each bug found during testing.

```markdown
### Bug Report

- **Bug ID:** BUG-___
- **Title:** [Short description of the issue]
- **Severity:** [ ] Critical / [ ] High / [ ] Medium / [ ] Low
- **Area:** [ ] HomePage / [ ] PRD / [ ] Branches / [ ] Mockups / [ ] Artifacts / [ ] Markup Images / [ ] Export / [ ] Settings / [ ] History / [ ] Persistence / [ ] Mobile

**Steps to Reproduce:**
1.
2.
3.

**Expected Result:**


**Actual Result:**


**Screenshots/Recordings:**
[Attach or link if applicable]

**Browser / Device:**
- Browser:
- Version:
- OS:
- Device (if mobile):

**Console Errors (if any):**
```
[Paste any console errors here]
```

**localStorage state relevant?** [ ] Yes / [ ] No
- If yes, describe:

**Reproducibility:** [ ] Always / [ ] Sometimes / [ ] Once

**Notes:**

```

---

## 11. Tester Feedback Template

Use this template to collect feedback from non-technical testers after they complete a testing session.

```markdown
### Tester Feedback Form

- **Tester Name:**
- **Date:**
- **Task Attempted:** [e.g., "Create a new project and generate a PRD"]

**Were you able to complete it?** [ ] Yes / [ ] Partially / [ ] No

**What was confusing?**


**What broke or didn't work?**


**What did you like?**


**How would you rate the experience?** [ ] 1 / [ ] 2 / [ ] 3 / [ ] 4 / [ ] 5
_(1 = very frustrating, 5 = smooth and enjoyable)_

**Would you use this tool again?** [ ] Yes / [ ] Maybe / [ ] No

**Any other thoughts?**

```

---

## 12. Recommended Next Steps

A prioritized action plan based on the QA analysis of Synapse.

### 1. Immediate (before sharing with users)

- Run the 30-minute smoke test (Section 4) end to end and document any failures.
- Fix any critical bugs found during the smoke test before proceeding.
- Verify the API key flow works correctly: entering a key, persisting it in localStorage, and using it for generation calls to Gemini.

### 2. Short-term (first week)

- Run the full manual QA test plan (Section 3) and pre-release checklist (Section 5) across Chrome, Firefox, and Safari.
- Conduct 3-5 user verification sessions using the Tester Feedback Template (Section 11) with people unfamiliar with the app.
- Set up a Playwright config and write the first 5 automated smoke tests covering: app load, project creation, PRD generation trigger, navigation between sections, and export.
- Add a confirmation dialog for project deletion to prevent accidental data loss.

### 3. Medium-term (first month)

- Add unit tests for the Zustand store — this is the highest-ROI testing investment since the store manages all application state and persistence.
- Add integration tests for generation workflows (PRD, mockups, artifacts) to catch regressions in the AI pipeline.
- Add visual regression tests for SVG renderers used in mockups and markup images.
- Implement localStorage quota detection and warnings so users are alerted before they hit browser storage limits.
- Add error boundaries around generation components to prevent a single failed generation from crashing the entire app.

### 4. Longer-term

- Consider backend persistence (Supabase or Firebase) for data safety — localStorage-only storage is the single biggest risk to user trust.
- Add undo/redo support for editing PRDs, mockups, and artifacts.
- Add unsaved changes detection with a prompt before navigating away or closing the tab.
- Add collaborative features so multiple users can work on the same project.
- Expand automated test coverage to 70%+ across unit, integration, and end-to-end tests.
