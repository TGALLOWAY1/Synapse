# LLM Trace Viewer

A **developer-only** debugging surface that makes every LLM interaction in
Synapse transparent — the prompt sent, the context that built it, the model,
the raw response, validation/parsing, retries, and how the prompt was
assembled. It is intended for investigating generation quality, prompt
contamination, hallucinations, orchestration bugs, and unexpected artifact
generation.

It has **no effect on normal application behavior** and is invisible to every
non-owner user.

## Access control

The viewer lives at **`/developer/llm-trace`** and is gated by `RequireOwner`
(`src/App.tsx`): a signed-in session **and** possession of the
`SYNAPSE_OWNER_TOKEN` in `localStorage` (`synapse-owner-token`) — the exact
client signal the Cloud Snapshots panel already uses to gate owner
affordances. A non-owner is redirected to `/`. The route is surfaced only in
the Settings modal's owner-gated **Developer** section.

This is a client-side UX gate for a **purely client-side** feature: traces are
read from local IndexedDB, never a server, so there is no server data to
protect. It is consistent with how the rest of the app gates owner-only UI.

## Capture

- **Chokepoint.** Every LLM call in the app flows through
  `callGemini` / `callGeminiStream` (`src/lib/geminiClient.ts`). Both call
  `beginTrace()` at the start and `finishSuccess`/`finishError` at the end.
- **Off by default.** `isTraceCaptureEnabled()` is false unless the viewer's
  **Capture** toggle is on (localStorage `synapse-llm-trace`) or the URL carries
  `?llmtrace`. When off, `beginTrace` returns a zero-cost no-op handle — nothing
  is stored and there is no overhead on the generation path.
- **Storage.** Enabled traces go to an in-memory registry (subscribable by the
  viewer via `useLlmTraces` / `useSyncExternalStore`) **and** IndexedDB
  (`synapse-llm-traces`, capped at 1000, pruned oldest-first) so past
  generations survive a reload. It is acceptable for this store to consume disk
  while capture is enabled.
- **Secrets are redacted at capture time** (`traceRedaction.ts`, pure and
  unit-tested): the values of secret-named keys (api key, authorization,
  bearer, cookie, session/client/encryption secret, owner token, password …)
  are masked, and credential-shaped substrings (Gemini `AIza…`, OpenAI `sk-…`,
  GitHub `ghp_…`, `Bearer …`) are scrubbed from all free text. A secret never
  reaches the registry or disk. **Do not weaken this.**

## Enrichment (`JsonModeConfig.traceMeta`)

A raw auto-captured trace already carries the request, response, model, timing,
tokens, and finishReason. Call sites add human labels via `traceMeta`
(`LlmTraceMeta`):

| field | meaning |
| --- | --- |
| `sessionId` | groups all calls of one generation run into a session |
| `stage` | coarse pipeline stage: `PRD`, `Artifact`, `Safety`, `Preflight` |
| `purpose` | human label, e.g. "Generate Permissions & Roles" |
| `artifact` | the section/artifact id being generated |
| `projectId` / `projectName` | project identity |
| `inputs` | concise human-readable input summary lines |
| `contextItems` | structured "what fed the prompt" list |
| `promptPieces` | prompt-assembly components + whether each was present |

Wired into: PRD sections (via `ModelProvider.generateText`), core artifacts
(`generateCoreArtifact` `traceContext`), consistency review, safety
classification, preflight questions/summary, and single-section retry. One
`sessionId` per PRD run / artifact-bundle run groups a whole generation; calls
with no explicit sessionId group heuristically by stage+project within an idle
gap (`traceSessions.ts`, pure).

## The viewer (`src/components/developer/LlmTraceViewerPage.tsx`)

- **Left sidebar** — a session-grouped, filterable chronological list of every
  captured call (purpose, model, time, duration, token counts, status). Filters:
  full-text search, stage, model, errors-only, retries-only.
- **Main inspector** — a tabbed view of the selected call: **Overview**,
  **Input Summary**, **Prompt** (system + user, copyable), **Context**,
  **Raw Request** (redacted), **Raw Response** (untruncated), **Parsed Result**,
  **Validation** (parse/finish/retry/warnings), **Prompt Construction** (the
  ✓/✕ assembly breakdown — the key tool for debugging prompt contamination).
- **Diff mode** — pick any two calls and compare purpose / model / prompt /
  context / response side by side (useful for comparing retries).
- **Export** — download the current filtered set or a single call as a
  **standalone, offline HTML report** (`traceExport.ts`, pure) that embeds all
  displayed information and references no external resources.
- **Clear** — wipe the in-memory registry and IndexedDB.

## Files

| file | role |
| --- | --- |
| `src/lib/trace/traceTypes.ts` | shared type contract |
| `src/lib/trace/traceRedaction.ts` | pure secret redaction (unit-tested) |
| `src/lib/trace/traceStore.ts` | IndexedDB persistence (capped, prunable) |
| `src/lib/trace/traceRecorder.ts` | capture engine + in-memory registry + enable flag |
| `src/lib/trace/traceSessions.ts` | pure session grouping / filtering / diff (unit-tested) |
| `src/lib/trace/traceExport.ts` | pure standalone-HTML report builder (unit-tested) |
| `src/components/developer/useLlmTraces.ts` | subscribe + hydrate hook |
| `src/components/developer/LlmTraceViewerPage.tsx` | the page |

## Non-goals / rules

- Never log or expose secrets — redaction is mandatory and applied before
  storage.
- Never gate generation behavior on trace state; capture is observational only.
- Keep the pure modules (`traceRedaction`, `traceSessions`, `traceExport`) free
  of store/DOM/React imports so they stay unit-testable.
