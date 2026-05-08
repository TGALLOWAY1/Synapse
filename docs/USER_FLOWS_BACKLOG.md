# User Flows Artifact — Deferred Work

The 2026-05 User Flows UX pass focused on a safe, display-level
improvement. The following items were intentionally deferred; this
document is the canonical place to track them.

## Larger architectural items

- **Schema-level normalization of issues.** Today the artifact stores
  `**Error Paths:**` and per-step error sub-bullets as free-text
  markdown, and the renderer classifies each line into
  `alternate_path | edge_case | validation_warning | failure_mode |
  unresolved_reference` at display time. Moving the classification into
  the generation prompt + a structured JSON schema would eliminate
  ambiguity, make staleness checks more precise, and enable proper
  search/filtering, but it touches `coreArtifactService.ts`,
  `artifactSchemas.ts`, and the persistence layer. Defer until we have
  data on how reliable the display-time classifier is.

- **Canonical feature catalog integration.** The drawer currently
  reads `Feature[]` from the current spine `StructuredPRD`. If we
  build a true cross-artifact feature catalog (with stable ids,
  per-feature pages, and screen/state linking), the drawer should
  read from that instead of the PRD slice.

- **Cross-artifact reference inspector.** Today only feature
  references are clickable. Screens (`[Importer]`) and states could
  also become first-class typed tokens that resolve to the Screen
  Inventory and Component Inventory artifacts respectively.

## UI features deferred

- **Flow node editing.** The journey nodes are read-only. A future
  pass could allow inline rename / re-type / drag-reorder, with edits
  flowing back to the underlying markdown via a structured update
  path.

- **Visual graph editor.** A full graph editor (drag and drop, branch
  visualization, multi-path layouts) is deferred. The current
  horizontal scroll + alternate-path counter is the minimum viable
  visualization.

- **Bookmark / share / overflow actions.** The flow header surfaces
  bookmark / share / more buttons, but they are placeholders that do
  not yet wire into anything. Plumb them once we have a story for
  saving filtered views, deep-linking flows, or exporting individual
  flows.

- **Deep linking from flow nodes to mockups.** When a node maps to a
  Screen Inventory entry, it should be possible to click through to
  the matching mockup. Requires deterministic id correspondence
  between the User Flows artifact and the Screen Inventory artifact.

- **Export to Mermaid / BPMN / FigJam.** Worth doing once the
  journey representation stabilizes — premature now.

- **Auto-generated user journey diagrams from PRD diffs.** Tied to
  the broader staleness story.

## Display-only TODOs

- **Bare-token feature refs.** Today the renderer matches `[f1]` but
  not bare `f1` — the bracket form is too easy to over-match against
  identifiers like `fps` or `f5key`. We may revisit if authors push
  back, ideally by also accepting the explicit `feature:f1` form.

- **Drawer pin persistence.** The pin state is component-local and
  resets on artifact remount. If users find themselves frequently
  pinning, we could persist it in the project store.

- **Flow validation engine with severity levels.** A future engine
  could lint flows for unresolved references, missing success
  outcomes, or steps without an actor. The classifier in
  `parseFlow.ts:classifyIssue` is a first sketch; a real engine would
  need a dedicated rules module.
