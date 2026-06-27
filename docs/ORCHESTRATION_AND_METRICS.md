# Orchestration & Workflow Metrics

This document describes how Synapse runs its multi-agent workflows
concurrently and how the orchestration **Metrics** dashboard (`/metrics`)
measures that concurrency.

## TL;DR — was concurrency working before this change?

**Yes.** PRD section generation was already genuinely concurrent before any of
the metrics work. The earlier suspicion that it ran "sequentially despite the
intended architecture" was not borne out by the code. What was missing was
**measurement**, **token/cost capture**, and a **user-facing surface** — which
is what this change adds. No generation behavior was rewritten.

## How PRD generation runs (the evidence)

PRD generation is a **dependency-graph (DAG) executor**, not document-order
generation:

- `src/lib/services/progressivePrdGeneration.ts` → `runDag()` builds the
  dependency graph from `DEFAULT_PRD_SECTIONS` (10 schema-aligned sections),
  validates it (Kahn's algorithm, rejects cycles/unknown deps), then dispatches
  every section whose dependencies are satisfied **up to per-tier concurrency
  caps**. In-flight section promises are collected and awaited together
  (`await Promise.all(running)`); the loop unblocks on *any* completion
  (`waitForTick`) to dispatch more. There is **no `await`-in-loop**
  serialization.
- Caps default to `maxFastConcurrency: 4` / `maxStrongConcurrency: 3`
  (`progressivePrdPipeline.ts`). Low-risk sections use the fast (Flash) model,
  high-risk the strong (Pro) model — each tier has an independent slot budget so
  one tier's rate limit doesn't starve the other.
- Dependencies are **true data dependencies only** (a section lists another
  only when it consumes that section's output as prompt context), so the graph
  fans out aggressively.

Downstream artifacts are also concurrent: `artifactJobController.ts` runs the 7
core artifacts in **dependency layers** (`CORE_CONCURRENCY_PER_PROJECT = 4`,
`Promise.all` within each layer); the mockup runs after the core layers.

Regression guard: `src/lib/__tests__/progressivePrdGeneration.test.ts` includes
a wall-clock test that runs the full section graph through a fixed-delay
provider and asserts the elapsed time is well under the sequential sum — it
**fails if the DAG is ever accidentally serialized**.

## What this change added

1. **Real token capture.** `callGemini` now reads Gemini's `usageMetadata`
   (`promptTokenCount` / `candidatesTokenCount` / `totalTokenCount`) and
   surfaces it via an optional `onUsage` callback on `JsonModeConfig`. The PRD
   section worker threads this through `ModelProvider.generateText` and emits it
   on the `section_completed` event. (Artifact token capture is a TODO — see
   `tasks/TODO.md`.)
2. **A persisted `WorkflowRun` model** (`src/types/index.ts`) recorded per run
   and stored in a new `metricsSlice` (`workflowRuns`, keyed by projectId, per
   user, capped at 50/project).
3. **Pure metric math** in `src/lib/metrics/` (`workflowMetrics.ts`,
   `modelPricing.ts`, `buildWorkflowRun.ts`) — unit-tested.
4. **A dashboard** at `/metrics` (`src/components/metrics/`): overview cards, a
   recent-runs table, and a per-run Gantt + node table.

Recording is fully decoupled and defensive: the pipeline assembles a
`WorkflowRun` from the section lifecycle events it already emits and fires an
`onWorkflowRun` callback; `runPrdGeneration.ts` / `ProjectWorkspace` stamp the
project identity and persist it via `recordWorkflowRun`. Any error in metric
assembly is swallowed — **metrics can never break a generation run**.

## Metric definitions

All timings are milliseconds, derived from per-node start/end timestamps.

| Metric | Formula | Meaning |
| --- | --- | --- |
| **Sequential Estimate** | `Σ node.durationMs` | Hypothetical runtime if every node ran one-after-another. The baseline. |
| **Actual Runtime** | `max(node.completedAt) − min(node.startedAt)` (or the explicit run window) | Real wall-clock time the run took. |
| **Parallel Time Saved** | `sequentialEstimate − actualRuntime` (≥ 0) | Wall-clock time saved by running concurrently. |
| **Speedup Ratio** | `sequentialEstimate ÷ actualRuntime` | e.g. 2.5× = finished 2.5× faster than serial. |
| **Max Concurrency** | sweep-line peak overlap of node intervals | Most agents in flight at once. |
| **Average Concurrency** | `totalNodeRuntime ÷ actualRuntime` | Average agents in flight over the run. |
| **Critical Path** | longest dependency chain weighted by node duration | Theoretical runtime floor even with infinite concurrency. |
| **Estimated Cost** | `Σ (inTok·inPrice + outTok·outPrice)` per node | Approximate USD from `modelPricing.ts`. **Estimate only.** |

### Interpreting sequential estimate vs actual runtime

The headline story is `Sequential Estimate` (what serial execution *would* have
cost) versus `Actual Runtime` (what the concurrent executor *did* cost). Their
ratio is the **Speedup**, and their difference is **Time Saved**. A speedup near
1× means little overlap happened (e.g. a near-linear dependency chain, or only
one section ran); a higher speedup means independent work genuinely fanned out.

## Where to find it

`/metrics` (auth-gated). Linked from the **Project Settings** modal ("Metrics")
and the workspace overflow menu ("Orchestration Metrics"). The page shows an
empty state until a real run is recorded — there is **no synthetic/demo data**.

## Known limitations

- **Artifact runs have no token data yet** (timing/concurrency only) — core
  artifact services don't thread `onUsage`. Cost shows $0 for those nodes.
- **Costs are estimates** from a static price table; they ignore context
  caching, batch discounts, and provider rounding.
- **Streaming first-token latency is not captured** (PRD sections use JSON mode,
  not streaming, for the recorded path).
- **No DAG-internal retry tracking** — `retryCount` reflects manual retries only.
- Metrics are **client-side / per-browser** (localStorage), like the rest of the
  PRD workspace; they are not aggregated server-side.

See `tasks/TODO.md` for the follow-up backlog.
