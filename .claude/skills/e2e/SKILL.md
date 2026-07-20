---
name: e2e
description: Run a live end-to-end check of Synapse — boot the app, generate a real project via Gemini, capture screenshots of every page, and visually assess them for gaps and defects. Use when asked to e2e test, visually verify, or assess the live product experience, or after changes to the PRD generation flow, workspace, or major UI surfaces.
---

# Live E2E run + visual assessment

Full reference: `docs/E2E_LIVE_TESTING.md`. This skill is the loop:
run → look at the screenshots → report/fix → re-run.

## 1. Run

```bash
npm run e2e            # live: real Gemini PRD generation (needs a key)
npm run e2e:smoke      # no key: boot + form + start-dialog only
```

- Live mode needs `SYNAPSE_E2E_GEMINI_KEY` (or `GEMINI_API_KEY`) in the
  environment. If neither is set, run the smoke mode and tell the user a live
  run needs the key configured as an environment variable (dedicated
  quota-capped test key — never ask them to paste it into chat or commit it).
- Auth is the dev-only local bypass (`VITE_DEV_SKIP_AUTH=true`) — no real
  account is involved and nothing syncs to the server.
- A live run takes several minutes (real generation). Pass
  `--timeout-min=15` if it times out; `--prompt=…`/`--name=…` to vary the idea.
- Output: `e2e-results/run-<timestamp>/` — numbered PNGs + `report.json`.

## 2. Assess — actually look at the screenshots

Read **every** PNG in the output directory with the Read tool. For each,
judge like a design reviewer, not a test runner:

- Layout breaks: overlapping elements, clipped/overflowing text, broken grids,
  horizontal scroll on mobile shots.
- Missing content: empty sections where the PRD should have content, `null`/
  `undefined`/placeholder text rendered, images that didn't load.
- Stuck states: spinners or "Generating…" in a *post-settle* screenshot.
- Readability: unreadable contrast, truncated labels, cramped mobile spacing.

Then read `report.json`:

- `steps[]` — any `failed`/`skipped` step is a defect or a selector-drift lead
  (see the Maintenance list in the doc before "fixing" the app).
- `consoleErrors`, `pageErrors` — treat as defects; `failedRequests` — expected
  for aborted/relayed noise, investigate anything app-relevant.
- `generation` — settle time and error/safety status.

## 3. Report / fix

- If the user asked for an assessment: summarize findings ordered by severity,
  citing the specific screenshot file for each visual issue.
- If the user asked you to fix issues: fix, then **re-run and re-read the new
  screenshots** to confirm — the previous run's directory is your baseline.
- Never commit `e2e-results/` (gitignored) or any API key.
