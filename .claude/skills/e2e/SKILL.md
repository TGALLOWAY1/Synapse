---
name: e2e
description: Run a live end-to-end check of Synapse — boot the app, generate a real project via Gemini (or replay a saved one), capture full-height screenshots of every stage, artifact, and sub-tab, and visually assess them for gaps and defects. Use when asked to e2e test, take screenshots, visually verify, or critique the live product experience, or after changes to the PRD generation flow, workspace, or major UI surfaces.
---

# Live E2E run + visual assessment

Full reference: `docs/E2E_LIVE_TESTING.md`. This skill is the loop:
scope → run → look at the screenshots → report/critique → fix → re-run.

## 0. Scope the run (ask first)

Unless the user already specified these, ask via AskUserQuestion before
running anything:

1. **Viewport** — desktop (default), mobile, or both → `--viewport=`.
2. **Scope** — pick one:
   - **A. Full pipeline** (new project, real generation): the default live
     run. Add `--interactions` if they want the interactive loop captured
     (PRD select→edit dialog→branch conversation→consolidation, answering a
     decision) — ~2 extra Gemini calls. Add `--skip-assets` for a cheaper
     PRD-only pass.
   - **B. Existing project subset** (zero LLM spend): replay a previous
     run's `state.json` with `--state=<file>` and narrow with `--views=`.
     Find dumps with `ls e2e-results/*/state.json` (each live run exports
     one). If none exists, a live run must happen first — say so.
   - **C. Branch-diff only**: determine affected views from
     `git diff --name-only main...HEAD`, map to view slugs (table below),
     then run a B-style subset (or a live `--views=` run if no state dump
     exists).
3. **Critique** — do they want a written visual critique (`critique.md` in
   the run dir), and should you also fix the top findings and re-run the
   affected subset?

View slugs for `--views=`: `prd`, `challenge`, `design-system`,
`user-flows`, `screens`, `data-model`, `implementation-plan`,
`dependency-graph`, `history`.

Component → view-slug mapping for scenario C (directionally — when in doubt
include the view):

| Changed under | Affected views |
|---|---|
| `src/components/prd/`, `StructuredPRDView`, `SelectionActionDialog`, `BranchList`, `ConsolidationModal` | `prd` |
| `src/components/review/`, `src/components/planning/` | `challenge` |
| `src/components/experience/`, `src/components/mockups/`, `screen*` libs | `screens` |
| `src/components/renderers/userFlows/` | `user-flows` |
| `src/components/renderers/dataModel/`, `DataModelRenderer` | `data-model` |
| `src/components/renderers/implementationPlan/` | `implementation-plan` |
| `src/components/dependency/` | `dependency-graph` |
| `DesignSystemRenderer` / design-system renderers | `design-system` |
| `HistoryView`, `src/components/versions/` | `history` |
| `ArtifactWorkspace`, `ProjectWorkspace`, `PipelineStageBar` (shell) | all — run without `--views` |

## 1. Run

```bash
npm run e2e                  # live: real Gemini PRD + asset bundle (needs a key)
npm run e2e -- --skip-assets # live: stop after the PRD (cheaper, no bundle)
npm run e2e -- --interactions --viewport=both   # full scenario-A capture
npm run e2e -- --state=e2e-results/<run>/state.json --views=screens,prd
npm run e2e:smoke            # no key: boot + form + start-dialog only
```

- Live mode needs `SYNAPSE_E2E_GEMINI_KEY` (or `GEMINI_API_KEY`) in the
  environment. If neither is set, offer `--state` replay (needs a prior
  run's dump) or smoke mode, and tell the user a live run needs the key
  configured as an environment variable (dedicated quota-capped test key —
  never ask them to paste it into chat or commit it).
- Auth is the dev-only local bypass (`VITE_DEV_SKIP_AUTH=true`) — no real
  account is involved and nothing syncs to the server.
- The default live run walks the **whole arc**: idea → PRD → commit through
  the readiness gate → asset bundle → the full view/tab inventory (PRD
  Overview+Features, Challenge stage decisions/findings/history, every
  artifact including Implementation Plan's five section tabs, Screens
  list→detail Overview/Flow/Mockups, per-flow User Flows shots, History) →
  `state.json` export. Screenshots are **full-height** (the harness grows
  the viewport past the app's internal scroll panes). Pass
  `--timeout-min=15` if generation times out; `--prompt=…`/`--name=…` to
  vary the idea.
- **Mockup images never render locally.** They come from the server-side
  `/api/image/generate` proxy — `api/` functions that `vite dev` doesn't
  run — so Screens always shows wireframe/placeholder here.
  `report.assets.note` records this; don't report it as a defect. `--state`
  replays don't restore them either (they live in IndexedDB, not the dump).
- Output: `e2e-results/run-<timestamp>/` — numbered PNGs (`-mobile` suffix
  for the mobile pass), `state.json` (live runs), `report.json`.

## 2. Assess — actually look at the screenshots

Read **every** PNG in the output directory with the Read tool. For each,
judge like a design reviewer, not a test runner:

- Layout breaks: overlapping elements, clipped/overflowing text, broken
  grids, horizontal scroll on mobile shots.
- Missing content: empty sections where the PRD should have content,
  `null`/`undefined`/placeholder text rendered, images that didn't load.
- Stuck states: spinners or "Generating…" in a *post-settle* screenshot.
- Readability: unreadable contrast, truncated labels, cramped mobile
  spacing.

Then read `report.json`:

- `steps[]` — any `failed`/`skipped` step is a defect or a selector-drift
  lead (see the Maintenance list in the doc before "fixing" the app).
  Interaction and consolidation steps are best-effort by design — a skipped
  consolidation *commit* can be legitimate LLM formatting drift, not a bug.
- `consoleErrors`, `pageErrors`, `httpErrors` — treat as defects.
- `expectedLocalApiErrors` and `ignoredRequests` are known local-run noise
  (no serverless functions under `vite dev`; blocked analytics) — do NOT
  report them, or the "Cloud save failed" header badge, as app defects. See
  "Known local-run noise & caveats" in `docs/E2E_LIVE_TESTING.md`.
- `generation` / `assets` — settle time and error/safety status.

## 3. Report / critique / fix

- If the user asked for an assessment: summarize findings ordered by
  severity, citing the specific screenshot file for each visual issue.
- If they asked for a **critique**: also write `critique.md` into the run
  directory — one section per screenshot with findings (severity, what's
  wrong, where), plus a top-of-file summary ranked by severity. This makes
  runs comparable over time; keep the format stable.
- If the user asked you to fix issues: fix, then **re-run and re-read the
  new screenshots** to confirm — prefer a `--state` + `--views=` subset
  replay of just the affected views (fast, free); the previous run's
  directory is your baseline.
- Never commit `e2e-results/` (gitignored) or any API key.
