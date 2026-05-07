# Prompt Pack — Backlog

Deferred ideas for the Prompt Pack artifact. None of these are implemented
today; the current focus (see commit history of `PromptPackRenderer.tsx` and
`coreArtifactService.ts`) is on making prompts trustworthy, editable, and
self-contained. Everything below is intentionally NOT in scope until the
core Prompt Pack experience has been validated in real usage.

## 1. Full prompt orchestration graph

Treat the Prompt Pack as a DAG instead of a flat list. Each prompt would
declare its inputs (other prompts' outputs, named artifacts, source files)
and outputs. The UI would visualize the graph and let the user run a
sub-graph end-to-end. Depends on stable prompt IDs and on a result-storage
model that today does not exist.

## 2. Dependency-aware execution

Once #1 exists, run prompts in topological order, blocking dependents until
prerequisites complete. Surface partial-failure recovery: if Prompt 3 fails,
allow re-running just 3 + downstream without re-running 1 and 2. Requires a
job runner that calls external coding agents (Cursor / Claude Code) which
Synapse doesn't currently invoke from the browser.

## 3. Automatic model routing

Replace the user-facing "Recommended target" reason with an automatic
routing decision. Rough sketch: a small classifier (keyword/heuristic, then
later an LLM) maps `(category, complexity, output_type)` to a target tool
and model. Should remain overridable. Depends on capturing better signal at
generation time (we currently emit one free-text Reason line).

## 4. Evaluation / retry loop

After a prompt is executed, capture the output and run an automated
evaluator (rubric-based LLM critique) to score success. On low score,
auto-revise the prompt and retry. Requires #1 (orchestration), an output
capture mechanism, and a defined rubric per prompt category.

## 5. Prompt quality scoring

Score each prompt at generation time on dimensions like specificity,
self-containedness, presence of test cases, and feature coverage. Display
the score as a chip and gate "Copy" on a minimum threshold. Lightweight
version: keyword heuristics. Heavy version: LLM judge call. Should reuse
the deferred PRD quality rubric infrastructure rather than inventing a new
one.

## 6. Multi-agent workflows

Bundle multiple prompts into a planner → coder → reviewer pipeline that the
user runs as one "workflow." Each stage has its own model/tool target.
Requires #1 + #2 + an external agent transport. Probably the right home
for advanced features like self-critique loops.

## 7. Prompt version history

Per-prompt revision history with diffs, author timestamps, and "restore to
this version" actions. Today edits are a single overlay on top of the
generated body — there is no history beyond the original. Storing a list
would balloon `ArtifactVersion.metadata`; this likely wants a dedicated
`promptEditHistory` slice.

## 8. Compiled prompt preview vs. source prompt diff

When the prompt body contains template tokens (e.g. `{{feature.name}}`),
show the compiled output beside the source template with a syntax-aware
diff. Requires a templating layer the Prompt Pack does not have.

## 9. Batch execution support

Run all prompts (or a selected subset) in one click against a chosen
target. Requires the same external-agent transport as #2 and #6.

## 10. Cross-prompt context sharing

Let prompts opt into a shared "system context" block (e.g. coding
standards, repo layout, available scripts) that prepends each prompt body
on copy. Today every prompt restates context inline, which is intentional
for self-containedness — this would be a power-user shortcut to reduce
duplication. Needs careful UX so users don't accidentally copy a prompt
without the shared context.

---

## Out of scope (explicitly)

- Replacing the whole artifact system or generation pipeline.
- A separate prompt-orchestration product surface.
- Anything that changes how `screen_inventory`, `data_model`,
  `component_inventory`, etc. are generated, stored, or rendered.
