# Implementation Plan — Backlog

Deferred features for the structured Implementation Plan artifact. Documented
here per the refactor brief; **not implemented** in the current pass.

## UX

- **Task detail side panel** — click a task row to open a panel with full
  description, status history, and inline editing.
- **Editable task state** — status updates (`todo` → `in_progress` → `done` /
  `blocked`), assignee/ownership, and persistence back to the artifact
  version. Likely needs a non-LLM mutation path on `ArtifactVersion`.
- **Timeline / Gantt view** — render milestones along a horizontal time axis
  derived from `timeframe` strings, with task bars stacked per milestone.
- **Dependency graph visualization** — render task dependencies as a DAG
  (e.g. via `react-flow` or a hand-rolled SVG) instead of inline
  "Depends on:" text.
- **Filter / sort tasks** — by status, milestone, or linked artifact.

## Integration

- **Artifact navigation** — clicking a `Linked: PRD · Mood Input Flow`
  segment should jump to that section in the PRD artifact. Needs a
  cross-artifact anchor scheme.
- **AI task expansion** — "expand this task" action that asks the model to
  break a single task into 3–5 subtasks (returns the same task schema
  shape, merged into the parent milestone).
- **Plan regeneration with diffing** — after a PRD edit, regenerate the
  plan and surface a per-task diff (added / removed / changed status).

## Data model

- **First-class task primitive** — promote `ImplementationPlanTask` to a
  Synapse-wide primitive that other artifacts can reference (e.g. a
  data_model entity referenced by multiple tasks).
- **Stable task IDs across regenerations** — currently the model picks IDs;
  a regeneration may rename them. Could anchor to titles via fuzzy match
  to preserve user state across regenerations.
- **External tracker sync** — export tasks to GitHub Issues / Linear /
  Jira, with bidirectional status sync.
