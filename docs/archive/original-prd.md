# PRD — Synapse v1 (PRD Iteration Canvas)

**Spine Version:** v1  
**Status:** DRAFT  
**Exported:** 2026-02-23

## Table of contents

1.  Overview
2.  Goals
3.  Non-goals
4.  Canonical mental model
5.  Spine
6.  Branching model
7.  Exploration canvases
8.  Canonical intents
9.  Consolidation and scope handling
10. Versioning model
11. Sidebar history
12. Export
13. Final labeling
14. Node types and required behaviors
15. LLM integration
16. Consolidation engine specifics
17. MVP development plan
18. Backlog / open questions
19. Consistency note

## Overview

Synapse v1 is a **spec-driven PRD generation and refinement canvas**. It turns:

**Idea → Iteratively refined PRD → Executable implementation plan**

The core UX is a **document with executable margins**:

  * A single authoritative **Spine** (Prompt + PRD response)
  * **Branches** anchored to specific text ranges in the spine
  * Explicit consolidation actions that patch the spine
  * Linear version history with diff/snippet provenance

Synapse v1 is intentionally minimal: no mind-map behavior, no free-floating nodes, no complex merge trees.

**Important v1 constraint update:**  
Synapse v1 treats the **prompt as session-initial**. Branching is for refining the **PRD response**, not for evolving the prompt into a new generation. If the user wants a meaningfully different prompt, they start a **new session/project**.

## Goals

### Primary goals

  * Generate a **high-quality first-draft PRD** from a user’s project idea.
  * Enable **surgical iteration** by anchoring branches to **any text range** (down to a single word; numbers allowed).
  * Allow multiple branches in parallel, including **multiple branches per anchor**.
  * Allow users to **selectively consolidate** branches back into the spine **without invalidating other branches**.
  * Provide **traceable evolution** via version timeline + snippet diffs.
  * Support **multiple projects**, each with its own workspace.
  * Export clean Markdown with version + FINAL/DRAFT + timestamp header.

### Secondary goals

  * Make replacing repeated incorrect details (e.g., tech stack) **safe** and ergonomic via document-wide patches (with preview/guardrails).
  * Support focused “what-if” analysis in a way that doesn’t crush margin real estate (see Exploration canvases).

## Non-goals (v1)

  * No automatic consolidation conflict detection/resolution (backlog consideration).
  * No auto-reanchoring across versions (manual reattach required).
  * No branch carry-forward across versions (branches remain version-scoped).
  * No multi-user real-time collaboration / CRDT.
  * No complex merge tree (linear spine history only).
  * **No prompt branching / prompt-driven regeneration from branches.**
  * No JSON export.

Backlog (explicit):

  * Streaming responses
  * Conflict detection
  * Auto re-anchoring / carry-forward
  * Prompt branching + “regen spine while preserving branch viability”

## Canonical mental model

### What Synapse is

  * A structured PRD document (the **Spine**)
  * With executable margins (**Branches**)
  * That can optionally modify the spine through explicit actions

Analogies:

  * Academic margin annotations
  * Code review comments that can rewrite code
  * A living technical document with traceable evolution

### What Synapse is not

  * Not a mind map
  * Not a radial graph exploration tool
  * Not “many ideas → one summary” synthesis-first

### Layout constraint (critical)

  * Spine: left
  * Branches: right (margin model)
  * Anchors: attached to text ranges
  * No radial / symmetric graph layout

## Spine

### Contents

The spine contains:

  * Prompt (session-initial, versioned only for display)
  * Generated PRD response

### Response properties

  * Linear
  * Structured (Problem, Goals, Requirements, UX, Tech Plan, Milestones, Risks, etc.)
  * Sentence-level / text-range anchorable
  * Authoritative at any given version

### Prompt rule

  * The prompt is **not iteratively revised via branches** in v1.
  * If the user wants a new prompt direction, they should **start a new session/project**.

### First-draft failure recovery (required)

To avoid “first output is garbage” dead-ends, the spine supports:

  * **Retry / Regenerate (Latest Only)**
      * Available only when the spine has **no branches yet** (un-branched state).
      * Re-runs generation with the same prompt (optionally with a “Try again” system instruction).
      * Creates a new spine version entry (“Regenerated spine”) for provenance.
  * **Abandon Session / Start New**
      * Quickly exits the current canvas and creates a fresh project/session prompt flow.
      * This is the canonical path for a new prompt.

## Branching model

### Anchoring model

All branches must:

  * Attach to a specific text range in the spine
  * Reference a stable anchor (AnchorRef)
  * Encode intent

No free-floating branches in v1.

### AnchorRef (indices-based)

Users can highlight any text in:

  * promptText
  * responseText

Selection UX rules:

  * Minimum selection: a word (numbers allowed)
  * UI provides shortcut to “select sentence”

AnchorRef schema:

``` 
type AnchorRef = {

  spineId: string

  promptVersionId: string

  target: "prompt" | "response"

  start: number

  end: number

  selectedText: string

}

```

### Multiple branches per anchor

A single anchor can have **0..N** branches attached.

Example:

  * Anchor → Clarify → branch thread → consolidate
  * Anchor → Expand → options → consolidate later
  * Anchor → Replace → local or document-wide patch

### Branch conversation model

Each branch is a self-contained thread:

  * user message
  * assistant reply
  * user follow-up
  * assistant reply
  * …

Branch conversation does not modify the spine until consolidation.

## Exploration canvases

### Problem being solved

Margin real estate is limited. Horizontal “side-by-side mini-rows” inside the right margin will quickly cause cramped UI or horizontal scrolling on laptops.

### V1 solution: “Dive Into” exploration canvases

Instead of stacking exploratory branches horizontally in the margin, Synapse v1 introduces a **secondary canvas** pattern:

  * Any branch can be flagged **Exploratory**
  * Exploratory branches show a **Dive Into** action
  * **Dive Into** opens a dedicated exploration canvas (TouchDesigner-like) for deeper work

This keeps the main PRD iteration flow readable while still enabling deep exploration.

### Exploration canvas properties

  * The exploration canvas is **separate from the spine**.
  * It can contain multiple nodes and threads (still minimal in v1), optimized for:
      * Option comparisons (UX variants, architectures, tradeoffs)
      * NB3 prompt iterations
      * Decision matrices
  * It is *not* a full mind map; it is a focused “workspace” tied to one exploratory branch.

### How exploration consolidates back to the spine (v1 recommendation)

Exploration canvases consolidate indirectly via a **Decision Artifact**:

  * The exploration canvas produces a structured **Decision Artifact** node:
      * **Decision summary** (1–3 bullets)
      * **Chosen option**
      * **Tradeoffs**
      * **Patch-ready text** (recommended)
      * Optional: **Acceptance criteria** / **requirements diffs**

Then the user can:

  * **Apply to Spine** (creates/updates a standard branch on the relevant anchor with patch-ready text), and then
  * Consolidate via normal consolidation flow (local/doc-wide patch)

This approach:

  * Avoids regenerating the spine
  * Keeps other branches valid
  * Preserves provenance from exploration → applied branch → spine version

## Canonical intents

### Final intent set

  * Clarify
  * Expand
  * Specify
  * Alternative
  * Replace

### Intent helper text (required UI)

When a branch is created, the node shows **light grey italic helper text** under the intent label.

Recommended v1 copy:

  * **Clarify**  
    \*\**Ask for precision, fix ambiguity, or correct a specific detail tied to this text.*
  * **Expand**  
    \*\**Add depth or options. Generate UX ideas, NB3 prompts, or elaborations.*
  * **Specify**  
    \*\**Turn this into implementable requirements: constraints, acceptance criteria, data/API details.*
  * **Alternative**  
    \*\**Propose a different approach or architecture and explain tradeoffs.*
  * **Replace**  
    \*\**Suggest a concrete change. The system will apply locally or across the document during consolidation.*

## Consolidation & scope handling

### Consolidation is user-selected

User can select branches to consolidate:

  * Consolidate Selected (primary)
  * Consolidate This Anchor (optional convenience)
  * Consolidate All Open (secondary convenience)

### Preserve existing branch applicability (critical)

Consolidating some branches must not ruin other branches.

Therefore (v1):

  * Consolidation produces **patches** to the PRD response text
  * **No regeneration** of the response spine via branch consolidation
  * Non-consolidated branches remain tied to their originating spine version and remain usable

### Replace scope (negotiated, guarded)

Replace does not pre-decide scope. The system evaluates:

  * overlap (local span)
  * repetition (multi-occurrence)
  * risk level (short/common tokens like “app” are high-risk)

Possible outcomes:

  * Apply locally
  * Apply document-wide (patch) **with guardrails + preview**
  * (No prompt revise + regenerate in v1)

Scope is not an intent; it is a resolution mechanism.

### Consolidation verbs & UX (minimal v1)

Branch-level actions:

1.  **Consolidate**
      * opens scope modal
      * options:
          * apply to selected text only (default)
          * apply document-wide (if relevant + passes guardrails)
      * produces a new spine version
      * after consolidation:
          * branch disappears from canvas
          * logged in history
          * marked applied
2.  **Delete Branch**
      * removes from canvas
      * does not affect spine
      * preserved in history log (with optional permanent delete per history rules)
3.  **Keep Open**
      * default state

Spine-level actions:

  * Consolidate Selected Branches
  * **Retry/Regenerate (Latest only, un-branched)**
  * **Abandon Session / Start New**

### Consolidation conflicts

Conflict detection/resolution deferred to backlog.

## Versioning model

### Linear spine versions

Spine versions are a single linear chain:  
v1 → v2 → v3 → …

No version branching in v1.

### Version scoping rules

Branches are tied to a specific spine version.

If spine changes:

  * old branches remain tied to old version
  * no auto-reanchor
  * hidden when viewing latest version (unless user inspects history)

If user wants to reuse an older branch:

  * must manually reattach to a new anchor

### Latest-only branching

Users cannot create branches on older versions.  
Branching is allowed only on the latest version.

When viewing older version:

  * highlighting disabled
  * intent toolbar disabled
  * sticky “Return to Latest” CTA

## Sidebar history

### Sidebar tabs

  * **Versions**
  * **Branches (Latest-only)**

### Versions tab requirements

Each version entry includes:

  * Spine vX label
  * timestamp
  * short description (“Applied 2 branches”, “Regenerated spine”)
  * expandable before/after snippet (minimal diff)
  * for doc-wide patches: match count + preview info

Clicking a version:

  * loads that version into the spine node (read-only mode)
  * margin shows only branches tied to that version

### Branches tab (latest-only)

Shows only branches tied to the latest spine version.

Includes filters:

  * All
  * By intent
  * Exploratory only

### Delete semantics

Deleted branches can be permanently removed from the Branches panel/history.

Rules:

  * “Delete” removes branch from canvas immediately
  * Branch history entry is removable via “Delete Permanently”
  * Applied branch provenance remains in Versions timeline events

### Diff model (minimal)

Each consolidation event logs:

  * before/after snippet for affected span(s)
  * if document-wide:
      * **match count**
      * **sample previews** (see replacement guardrails)

No full line-by-line diffs in v1.

## Export

Export mechanisms:

  * Export Markdown (.md)
  * Copy Markdown to clipboard

Export includes only PRD content (no prompt text).

Export header includes:

  * project name (if known)
  * spine version label
  * FINAL/DRAFT
  * timestamp

Filename:

  * project-name-prd-vX.md

## Final labeling

“Mark as Final”:

  * labels a spine version as FINAL
  * does not hard-lock editing
  * if user continues editing, subtle warning appears
  * further consolidation creates a new version defaulting to DRAFT

FINAL is version-scoped, not project-scoped.

## Node types & required behaviors

### Node types (minimal)

v1 uses three node types:

1.  **Spine Node**
2.  **Branch Node**
3.  **Exploration Canvas Node** (entered via “Dive Into” from an exploratory branch)

No commit/resolution nodes.

### Spine node (fields)

  * spineId
  * promptVersionId
  * promptText
  * responseBlocks\[\]
  * responseText
  * createdAt
  * modelInfo (optional)

### Spine node (behaviors)

  * scrollable PRD view
  * text-range highlighting creates anchors
  * displays version label (Prompt v1 / Spine v7)
  * selecting spine updates sidebar to spine history
  * prompt expand/collapse control
  * prompt is highlightable
  * **Retry/Regenerate** visible only when:
      * spine is latest AND
      * branch count == 0

### Branch node (fields)

  * branchId
  * intent ∈ {Clarify, Expand, Specify, Alternative, Replace}
  * isExploratory
  * anchorRef
  * content (thread)
  * createdAt
  * (optional) explorationCanvasId (if Dive Into has been used)

### Branch node (behaviors)

  * displays intent + exploratory styling
  * shows anchor context preview (selected text + surrounding snippet)
  * selecting branch updates sidebar to branch history
  * if exploratory:
      * shows **Dive Into**
      * shows **Apply to Spine** (when Decision Artifact exists)

### Exploration canvas node (fields)

  * explorationCanvasId
  * originatingBranchId
  * nodes\[\] (minimal internal graph)
  * decisionArtifact (optional)
  * createdAt

### Exploration canvas behaviors

  * node workspace for comparison and iteration
  * generates a **Decision Artifact** (structured output)
  * **Apply to Spine** creates/updates a standard branch on a selected anchor

## LLM integration

### Swap-friendly provider abstraction

Provider interface should allow easy substitution.

Conceptual interface:

  * generatePRD(promptText, options)
  * replyInBranch(context, options)
  * (optional) assistDecisionArtifact(explorationContext, options)

Default for v1: Ollama provider.  
Provider selection is config-driven.

### Branch reply shaping (PRD-optimized)

Assistant replies are intent-shaped and include patch-ready output where applicable:

  * A “Suggested replacement for selected text:” block (when applicable)
  * 1–3 bullets of rationale
  * Up to 2 follow-up questions max

Replies are instant in v1 (streaming is backlog).

## Consolidation engine specifics

### Replacement capture

During consolidation:

  * if branch contains “Suggested replacement…” block, use it
  * otherwise prompt the user to provide replacement text in the modal

### Local patch

Process:

1.  verify anchor integrity:
      * selectedText matches substring at \[start:end\]
2.  if mismatch:
      * error: “Anchor no longer matches. Reattach branch.”
3.  apply patch to responseText
4.  rebuild responseBlocks and responseText for new version
5.  create new spine version v(n+1)
6.  applied branch disappears
7.  log before/after snippet in Versions

### Document-wide patch (guarded; no naive exact-replace)

**Problem:** naive “replace all occurrences of selectedText” can corrupt words (e.g., replacing app → system changes approach → systemroach).

#### v1 document-wide patch rules (required)

Document-wide patch is only enabled when:

1.  **Match preview exists**
      * System computes all matches and shows them in a preview list before apply.
2.  **Boundary-safe matching is used by default**
      * If selectedText is a single token or appears as a word-like unit, use **word boundaries** by default:
          * Regex form: \\b\<escapedSelectedText\>\\b
      * For multi-word phrases, system uses a safe phrase match (still previewed).
3.  **User can choose match mode (explicit toggle)**
      * **Whole word / token match** (default; boundary-checked)
      * **Exact substring match** (danger mode; requires extra confirmation)
      * (Backlog) Advanced regex
4.  **Preview UI shows “would change” examples**
      * Show total match count N
      * Show at least first 10 matches with context (e.g., ±30 chars)
      * For large N, allow pagination/search
5.  **Commit confirmation requires acknowledging scope**
      * “Apply to N matches” with the selected match mode

Process:

1.  compute matches with chosen match mode
2.  render preview list
3.  user confirms
4.  apply replacements to those matched spans only (not blind global string replace)
5.  create new spine version and log event:
      * match mode
      * N
      * 1–3 sample before/after snippets

### Regenerate / retry (latest un-branched only)

This is not “prompt branching.” It is failure recovery.

Process:

1.  ensure latest spine has 0 branches
2.  call generatePRD() again with same promptText (+ optional “retry” hint)
3.  create new spine version
4.  Versions log:
      * “Regenerated spine”
      * before/after snippet (optional) or just provenance marker

## MVP development plan

### E1 — Skeleton + PRD generation + spine rendering (multi-project)

  * Routes:
      * / Projects list
      * /p/\[projectId\] Canvas workspace
  * LocalStorage persistence:
      * projectsIndex
      * project:{id}
  * PRD generation via Ollama (swap-friendly provider interface)
  * Prompt expand/collapse in spine node
  * Sidebar collapsed by default; versions entry “Spine v1 created”
  * **Retry/Regenerate** enabled only when branch count == 0
  * **Abandon session / start new** from project menu

### E2 — Anchors + branch creation

  * highlight prompt/response → floating intent picker
  * create branch node with helper text
  * exploratory toggle
  * delete supported (with history semantics)
  * persists per project (localStorage)

### E3 — Branch assistant replies + margin organization

  * replyInBranch() provider method
  * intent-shaped replies
  * group by anchor
  * branch stacks collapse past N=4
  * jump-to-anchor helper

### E4 — Consolidation engine + versions + history snippets

  * consolidate selected branches
  * local patch
  * doc-wide patches with:
      * boundary-safe match by default
      * preview list of affected matches
      * explicit match-mode selection
  * new spine versions
  * applied branches disappear
  * versions timeline logs snippet diffs

### E5 — Version sidebar + latest-only branching enforcement

  * Versions + Branches tabs
  * older versions read-only; highlight disabled; “Return to Latest”
  * Branches tab is latest-only with filters
  * permanent delete from Branches panel
  * regeneration events visible (“Regenerated spine”)

### E6 — Exploration canvases

  * exploratory branch “Dive Into”
  * exploration canvas workspace
  * Decision Artifact generation
  * “Apply to Spine” creates a standard branch with patch-ready text

### E7 — Export + FINAL label

  * Copy markdown + export .md
  * header includes version/final/timestamp
  * filename pattern project-name-prd-vX.md

## Backlog / open questions

  * Consolidation conflict detection and resolution UX
  * Auto re-anchoring branches across versions (safe carry-forward)
  * Streaming responses
  * Richer diff visualization (line-by-line)
  * Semantic doc-wide replacements (carefully guarded)
  * Prompt branching + regeneration while preserving branch viability (requires re-anchoring strategy)

## Consistency note

This PRD resolves prior internal tension by making prompt-branching/regeneration a **non-goal for v1**. In v1:

  * branches patch the PRD response (local/doc-wide),
  * regeneration is only allowed as **failure recovery** when no branches exist,
  * meaningful prompt changes happen by starting a **new session/project**.
