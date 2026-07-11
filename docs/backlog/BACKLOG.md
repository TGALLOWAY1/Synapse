# Synapse Backlog

Single source of truth for deferred work across Synapse. Consolidates the
former per-area backlogs:

- `docs/backlog/CODEBASE_CLEANUP_BACKLOG.md` (codebase cleanup)
- `docs/backlog/prompt-pack-backlog.md` (Prompt Pack artifact)
- `docs/USER_FLOWS_BACKLOG.md` (User Flows artifact)
- `src/components/renderers/ImplementationPlanRenderer.BACKLOG.md`
- `src/components/renderers/ScreenInventoryRenderer.BACKLOG.md`

Items are grouped by **area**, then ordered by **risk × value**: lowest-risk
high-value items first within each section. Status legend: `[ ]` open,
`[~]` in progress, `[x]` done.

---

## 1. Codebase cleanup

From the [2026-05-08 cleanup audit](../audits/SYNAPSE_CODEBASE_CLEANUP_AUDIT.md).
Phase 1 already applied in commit `claude/synapse-codebase-audit-tIUSS`.

### Phase 2 — Low-risk consolidation

- [ ] **Merge `prdPipeline.ts` into `progressivePrdPipeline.ts`.** After the
  May 2026 cleanup `prdPipeline.ts` only re-exports types
  (`PrdPipelineOptions`, `PrdPipelineResult`, `PRD_SCHEMA_VERSION`). Two
  files import from it. Wait until `progressivePrdPipeline.ts` is stable for
  one release cycle, then inline and delete.
- [ ] **Resolve "Password reset is coming soon" tooltip** at
  `src/components/LoginPage.tsx:321`. Either implement (requires email-token
  plumbing in `api/auth/`) or remove the disabled link.
- [ ] **Reconcile CLAUDE.md vs reality on "intent classification."** CLAUDE.md
  describes feedback intent classification on `feedbackSlice`; no such code
  exists. Either implement it or update CLAUDE.md.

### Phase 3 — Folder organization (low-medium risk)

- [ ] **Move flat `src/lib/*.ts` helpers into `src/lib/utils/`.** Targets
  (~10): `mockupValidation.ts`, `mockupQuality.ts`, `mockupParsing.ts`,
  `mockupDefaults.ts`, `mockupAlignmentCritique.ts`, `mockupPlaceholders.ts`,
  `screenInventoryNormalize.ts`, `jsonRepair.ts`, `textCleanup.ts`,
  `errors.ts`, `concurrency.ts`, `groundingFields.ts`. Update ~30 import
  sites.
- [ ] **Do NOT undertake a top-down `features/*` reorg.** Audit §6 has the
  rationale; flag if a future case appears.

### Phase 4 — Higher-risk / needs tests first

- [ ] **Add E2E smoke tests for the four uncovered hot paths.** Mock the LLM
  transport but exercise the orchestration glue end-to-end:
  - PRD generation (`runProgressivePrdPipeline`)
  - Mockup generation (`mockupService` → `MockupViewer`)
  - Branch consolidation (`branchService.consolidateBranch`)
  - Staleness detection (`stalenessSlice` against the current spine)
- [ ] **Resolve `TODO(tailwind-hardening)` at
  `src/components/mockups/buildMockupSrcDoc.ts:30`.** Replace CDN-loaded
  Tailwind in the iframe sandbox with a vendored / pre-built stylesheet.

### Phase 5 — Sunsetting live shims

- [ ] **Remove `GEMINI_MODEL_MIGRATION_KEY` shim** in `src/App.tsx:32-49`
  after **2026-07-01** (3-month soak from the 2026-04 sentinel).
- [ ] **Eventually retire `onRehydrateStorage` legacy stage migration** in
  `src/store/projectStore.ts:42-58` once analytics show no projects in
  legacy stages for 60+ days.
- [ ] **Eventually retire `qualityScores` field** on `SpineVersion` and its
  conditional setters in `src/store/slices/spineSlice.ts:121, 143`. Pure
  backward-compat; defer indefinitely unless a v3 schema rev forces a clean
  break.

### Optional / opportunistic

- [ ] Extract LLM retry logic from `geminiClient.ts` and `openaiClient.ts`
  into `src/lib/utils/retry.ts` if a third LLM client is added.
- [ ] Reconsider `@formkit/auto-animate` (2 imports) and `date-fns` (1
  import) the next time dependency churn happens.

---

## 2. User Flows artifact

The 2026-05 User Flows UX pass focused on a safe, display-level
improvement. The following items were intentionally deferred.

### Architectural

- [ ] **Schema-level normalization of issues.** Today the artifact stores
  `**Error Paths:**` and per-step error sub-bullets as free-text markdown,
  and the renderer classifies each line into
  `alternate_path | edge_case | validation_warning | failure_mode |
  unresolved_reference` at display time. Moving classification into the
  generation prompt + structured JSON schema would eliminate ambiguity,
  improve staleness checks, and enable search/filter — but it touches
  `coreArtifactService.ts`, `artifactSchemas.ts`, and persistence. Defer
  until display-time classifier reliability data exists.
- [ ] **Canonical feature catalog integration.** The drawer reads `Feature[]`
  from the current spine `StructuredPRD`. If a true cross-artifact feature
  catalog (stable ids, per-feature pages, screen/state linking) is built,
  the drawer should read from that.
- [ ] **Cross-artifact reference inspector.** Today only feature references
  are clickable. Screens (`[Importer]`) and states could become first-class
  typed tokens that resolve to Screen Inventory and Component Inventory.

### UI features

- [ ] **Flow node editing.** Inline rename / re-type / drag-reorder on
  read-only journey nodes, with edits flowing back to the underlying
  markdown via a structured update path.
- [ ] **Visual graph editor** (drag/drop, branching, multi-path layouts).
  Current horizontal-scroll + alternate-path counter is the MVP.
- [ ] **Bookmark / share / overflow actions.** Header buttons exist as
  placeholders; plumb them once there's a story for saving filtered views,
  deep-linking flows, or exporting individual flows.
- [ ] **Deep linking from flow nodes to mockups.** Requires deterministic id
  correspondence with Screen Inventory.
- [ ] **Export to Mermaid / BPMN / FigJam.** Worth doing once the journey
  representation stabilizes.
- [ ] **Auto-generated user-journey diagrams from PRD diffs.** Tied to the
  broader staleness story.

### Display-only

- [ ] **Bare-token feature refs.** Renderer matches `[f1]` but not bare
  `f1` (over-matches `fps`, `f5key`). Revisit if authors push back; ideally
  also accept the explicit `feature:f1` form.
- [ ] **Drawer pin persistence.** Pin state is component-local; persist in
  the project store if users pin frequently.
- [ ] **Flow validation engine with severity levels.** A real engine would
  lint flows for unresolved references, missing success outcomes, or steps
  without an actor. `parseFlow.ts:classifyIssue` is a first sketch.

---

## 3. Prompt Pack artifact

Current focus: prompts that are trustworthy, editable, and self-contained.
Nothing below is in scope until the core experience is validated in real
usage.

- [ ] **Full prompt orchestration graph.** Treat the Prompt Pack as a DAG;
  each prompt declares inputs (other prompts' outputs, named artifacts,
  source files) and outputs. UI visualizes the graph and allows running a
  sub-graph end-to-end. Depends on stable prompt IDs and a result-storage
  model that does not exist today.
- [ ] **Dependency-aware execution.** Run prompts in topological order with
  partial-failure recovery. Requires a job runner that calls external coding
  agents (Cursor / Claude Code) which Synapse doesn't currently invoke from
  the browser.
- [ ] **Automatic model routing.** Replace user-facing "Recommended target"
  with a classifier (heuristic, then LLM) mapping
  `(category, complexity, output_type)` to a target tool/model. Should
  remain overridable. Needs better generation-time signal.
- [ ] **Evaluation / retry loop.** Capture prompt output, run a rubric-based
  LLM critic, auto-revise on low score. Requires DAG, output capture, and
  per-category rubric.
- [ ] **Prompt quality scoring** (specificity, self-containedness, test-case
  presence, feature coverage). Display as a chip; gate "Copy" on threshold.
  Should reuse the deferred PRD quality-rubric infrastructure rather than
  invent a new one.
- [ ] **Multi-agent workflows.** Bundle prompts into a planner → coder →
  reviewer pipeline with per-stage targets. Requires DAG + execution +
  external transport.
- [ ] **Prompt version history.** Per-prompt diffs, timestamps,
  "restore to this version." Today edits are a single overlay; storing
  history likely wants a dedicated `promptEditHistory` slice rather than
  bloating `ArtifactVersion.metadata`.
- [ ] **Compiled-prompt preview vs source-prompt diff.** When a prompt body
  contains `{{feature.name}}`-style tokens, show compiled output beside
  source with syntax-aware diff. Requires a templating layer.
- [ ] **Batch execution.** Run all (or a selected subset) of prompts against
  a chosen target in one click. Same external-agent transport as above.
- [ ] **Cross-prompt context sharing.** Optional shared "system context"
  block (coding standards, repo layout, scripts) that prepends each prompt
  body on copy. Today every prompt restates context inline (intentional for
  self-containedness); UX must not let users copy a prompt without context.

**Out of scope:** replacing the artifact system / generation pipeline; a
separate prompt-orchestration product surface; changes to how
`screen_inventory`, `data_model`, `component_inventory`, etc. are
generated/stored/rendered.

---

## 4. Implementation Plan artifact

### UX

- [ ] **Task detail side panel.** Click a task row to open a panel with full
  description, status history, inline editing.
- [ ] **Editable task state.** Status updates
  (`todo` → `in_progress` → `done` / `blocked`), assignee/ownership, and
  persistence back to the artifact version. Likely needs a non-LLM mutation
  path on `ArtifactVersion`.
- [ ] **Timeline / Gantt view.** Render milestones along a horizontal time
  axis derived from `timeframe` strings; task bars stacked per milestone.
- [ ] **Dependency graph visualization.** Render task dependencies as a DAG
  (e.g. `react-flow` or hand-rolled SVG) instead of inline "Depends on:"
  text.
- [ ] **Filter / sort tasks** by status, milestone, or linked artifact.

### Integration

- [ ] **Artifact navigation.** Clicking a `Linked: PRD · Mood Input Flow`
  segment jumps to that section in the PRD artifact. Needs a cross-artifact
  anchor scheme (shared with Screen Inventory below).
- [ ] **AI task expansion.** "Expand this task" action that asks the model
  to break a single task into 3–5 subtasks (returns the same task schema
  shape, merged into the parent milestone).
- [ ] **Plan regeneration with diffing.** After a PRD edit, regenerate the
  plan and surface a per-task diff (added / removed / changed status).

### Data model

- [ ] **First-class task primitive.** Promote `ImplementationPlanTask` to a
  Synapse-wide primitive that other artifacts can reference (e.g. a
  data_model entity referenced by multiple tasks).
- [ ] **Stable task IDs across regenerations.** Currently the model picks
  IDs; regeneration may rename them. Anchor to titles via fuzzy match to
  preserve user state across regenerations.
- [~] **External tracker sync.** Export tasks to GitHub Issues / Linear /
  Jira with bidirectional status sync. _Partial: one-way export to GitHub
  Issues (PAT-based) and Markdown shipped via `ConvertToTasksModal` +
  `src/lib/services/taskExport/`. Follow-ups itemised below._
  - [ ] **Real Linear export.** The old mocked provider (fake `LIN-MOCK-*`
    success) was **deleted** per audit finding SYN-014 — a simulated
    external integration misrepresents the product. Building the real one
    is a from-scratch item: a new `linearExporter.ts` provider registered
    in `EXPORT_PROVIDERS` (re-add `'linear'` to `ExportTargetId`),
    `LINEAR_API_KEY` (and optional `LINEAR_TEAM_ID`) inputs in
    `SettingsModal.tsx` next to the GitHub fields, a real
    `https://api.linear.app/graphql` `issueCreate` mutation per task, and
    a label-resolution pass (Linear stores labels as IDs, not strings —
    same shape as `fetchExistingLabels` in `githubExporter.ts`). ~1–2 days.
  - [ ] **GitHub OAuth with `repo` scope.** Today the export uses a
    user-supplied PAT in `localStorage` — same security posture as the
    Gemini key. `api/_lib/github.js` only has `read:user`/`user:email`
    scopes, so a separate OAuth app + token-storage backend is needed
    (reuse the recruiter portal's MongoDB plumbing under `api/_lib/`).
    Replace the `localStorage.getItem('GITHUB_TOKEN')` lookups in
    `githubExporter.ts` with a fetch against the new endpoint; the
    export client adapts cleanly because the token is already injected
    via `GithubExportDeps`. ~3 days.
  - [ ] **LLM-augmented acceptance criteria.** Today criteria are
    deterministic (milestone `Definition of Done` + plan-wide
    `definitionOfDone` array + title-derived fallbacks). When a task
    yields fewer than ~3 criteria, fall back to a single `callGemini`
    JSON-mode call to expand. Keep deterministic as primary so tests
    stay cheap and offline behaviour is unchanged. ~half a day.
  - [ ] **Bidirectional sync.** Once tasks are persisted (see
    "First-class task primitive" above), store `externalUrl`/`externalId`
    on the persisted task and add a "Refresh status" action that hits
    `GET /repos/{owner}/{repo}/issues/{number}` per linked task and
    updates local status. Webhook-driven sync needs a backend endpoint
    + auth and probably isn't worth it before there's user demand.
  - [ ] **Sub-issue / parent-child hierarchy.** Currently a flat list,
    one task per deliverable. Modelling parent (epic) / child cleanly
    across all three providers blows up the export contract: Linear
    handles it natively, GitHub needs tracking-issue checklists or the
    sub-issues beta API, Markdown is fine either way. Defer until a
    user explicitly asks. ~2 days when picked up.

---

## 5. Screen Inventory artifact

### UX

- [ ] **Clickable Linked-Feature pills.** Tapping a feature pill (e.g.
  `f8 Ingredient Aggregation`) opens a side panel with the full feature
  description, originating PRD section, and other screens that reference
  it. Requires an artifact-wide feature lookup and a generic side-panel
  primitive that doesn't yet exist (shared need with Implementation Plan
  cross-artifact navigation).
- [ ] **Filter / sort screens** by priority (P0 → P3), linked feature, or
  flow membership, scoped to a section or to the whole artifact.
- [ ] **Mini-map / overview visualization.** Top-of-artifact diagram of all
  screens and the journeys between them, using `flowSummary` per section
  plus `entryPoints` / `exitPaths` per screen. Hand-rolled SVG or
  `react-flow` graph.
- [ ] **Audience modes** — PM / Design / Engineering toggles that re-rank or
  hide subsections (e.g. Engineering hides Intent and Outputs, emphasizes
  States and Risks).

### Data quality

- [ ] **Validation overlays.** Surface orphan screens (no entry points),
  dead-end exits (target not present in inventory), missing required states
  (e.g. an "input" screen with no error state). Per-card warning chip plus
  section-header summary count.

### Integration

- [ ] **Artifact navigation.** Clicking a Linked-Feature pill jumps to the
  feature's anchor inside the PRD artifact once a cross-artifact anchor
  scheme exists.

---

## 6. UI Components artifact (hidden from the assets list — revisit)

**Decision (2026-07-02):** The **UI Components** artifact (`component_inventory`)
was **hidden from the assets list** because it has no hard dependents and isn't
useful to surface directly right now.

- **What changed.** `component_inventory` is now a **hidden artifact**, declared
  in `HIDDEN_ARTIFACT_SUBTYPES` (`src/lib/coreArtifactPipeline.ts`) — the single
  source of truth for "generated but not surfaced." That set drives: the sidebar
  omission (`ArtifactWorkspace.buildSlotMetas` filters it out, so no row / mobile
  header / auto-open / count), the finalize readiness gate
  (`ProjectWorkspace.assetsReady` excludes hidden subtypes), and the auto-resume
  decision (`artifactJobController.resumeIfNeeded` only wakes for visible pending
  slots). Users no longer see or create it directly.
- **What deliberately did *not* change.** It is **still generated** — it remains
  in `CORE_ARTIFACT_PIPELINE` and in `MOCKUP_DEPENDENCIES`
  (`src/lib/services/artifactJobController.ts`), because **mockups softly consume
  it**: `generateMockup` uses it to tag which reusable components appear on each
  screen (`componentRefs`), which feed the gpt-image mockup prompts
  (`mockupImageService`). It degrades gracefully when absent, but keeping it
  generating preserves richer mockup prompts. `startAll` still includes it in its
  pending set so it's best-effort regenerated alongside visible artifacts.
- **Why the readiness/resume gates matter (Codex review, PR #189).** Because a
  hidden artifact has no visible row, it must never *gate* user-facing state: if
  `component_inventory` errored while visible assets finished, an un-excluded
  `assetsReady` would leave the success modal stuck on "assets are being
  created," and an un-filtered `resumeIfNeeded` would silently retry it on every
  remount with no status/retry affordance. Both gates now exclude hidden slots.

### Revisit checklist

- [ ] **Decide the artifact's future.** Options: (a) re-expose it if a hard
  dependent or clear user value emerges; (b) fully remove it — drop it from
  `CORE_ARTIFACT_PIPELINE` **and** `MOCKUP_DEPENDENCIES`/`generateMockup`,
  accepting that mockup prompts lose per-screen component tagging; (c) keep the
  current hidden-but-generated state.
- [ ] **If fully removing:** also prune the renderer wiring
  (`ComponentInventoryRenderer` + `src/components/renderers/componentInventory/`),
  the schema (`componentInventorySchema`), the parser (`componentInventoryParse.ts`),
  model routing (`artifactModelSettings.ts`), and the README / tour mentions.
  (The Design System renderer's old "Downstream Usage Status" section — which
  referenced `component_inventory` — has already been removed; that surface is
  now covered by the Dependency Graph artifact.)
- [ ] **If re-exposing:** remove `'component_inventory'` from
  `HIDDEN_ARTIFACT_SUBTYPES` (it already sits in `ARTIFACT_GROUPS`, so the row,
  readiness gate, and auto-resume all come back automatically) and re-add the
  README assets bullet + mermaid node.

---

## Cross-cutting themes

A few of the items above show up in multiple artifact sections — surfacing
them here so they get planned together rather than one-off:

- **Cross-artifact anchor scheme.** Implementation Plan, Screen Inventory,
  and User Flows all want clickable links between artifacts. Should land as
  one piece of infrastructure (stable artifact-section ids + a generic
  side-panel primitive), not three.
- **Stable IDs across regenerations.** Implementation Plan tasks, Screen
  Inventory screens, and Prompt Pack prompts each have the same problem.
  A shared "fuzzy-match by title to preserve user state across LLM
  regenerations" utility is probably the right primitive.
- **Reusable rubric / scoring infrastructure.** PRD scoring was removed,
  but the Prompt Pack still wants a rubric-based scorer; if that lands, it
  should be designed for reuse rather than bolted onto one artifact.
