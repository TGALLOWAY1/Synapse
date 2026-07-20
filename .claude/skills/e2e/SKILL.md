---
name: e2e
description: Run a live end-to-end check of Synapse — boot the app, generate a real project via Gemini, capture screenshots of every page, and visually assess them for gaps and defects. Use when asked to e2e test, visually verify, or assess the live product experience, or after changes to the PRD generation flow, workspace, or major UI surfaces.
---

# Live E2E run + visual assessment

Full reference: `docs/E2E_LIVE_TESTING.md`. This skill is the loop:
run → look at the screenshots → report/fix → re-run.

## 1. Run

```bash
npm run e2e                  # live: real Gemini PRD + asset bundle (needs a key)
npm run e2e -- --skip-assets # live: stop after the PRD (cheaper, no bundle)
npm run e2e:smoke            # no key: boot + form + start-dialog only
```

- Live mode needs `SYNAPSE_E2E_GEMINI_KEY` (or `GEMINI_API_KEY`) in the
  environment. If neither is set, run the smoke mode and tell the user a live
  run needs the key configured as an environment variable (dedicated
  quota-capped test key — never ask them to paste it into chat or commit it).
- Auth is the dev-only local bypass (`VITE_DEV_SKIP_AUTH=true`) — no real
  account is involved and nothing syncs to the server.
- The default live run walks the **whole arc**: idea → PRD → commit through the
  readiness gate → generate the downstream asset bundle (design system, user
  flows, screens, data model, implementation plan) → screenshot each. That's a
  larger token spend and takes several minutes; use `--skip-assets` for a
  PRD-only pass. Pass `--timeout-min=15` if it times out; `--prompt=…`/`--name=…`
  to vary the idea.
- **Mockup images never render locally.** They come from the server-side
  `/api/image/generate` proxy (and `hasOpenAIKey()` reads a server status
  endpoint) — `api/` functions that `vite dev` doesn't run, so the Screens view
  always shows wireframe/placeholder screens here, regardless of any
  `OPENAI_API_KEY`. `report.assets.note` records this; don't report it as a
  defect. Rendered imagery needs a real deployment (Vercel preview).
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
- `consoleErrors`, `pageErrors`, `httpErrors` — treat as defects.
- `expectedLocalApiErrors` and `ignoredRequests` are known local-run noise
  (no serverless functions under `vite dev`; blocked analytics) — do NOT
  report them, or the "Cloud save failed" header badge, as app defects. See
  "Known local-run noise & caveats" in `docs/E2E_LIVE_TESTING.md`.
- `generation` — settle time and error/safety status.

## 3. Report / fix

- If the user asked for an assessment: summarize findings ordered by severity,
  citing the specific screenshot file for each visual issue.
- If the user asked you to fix issues: fix, then **re-run and re-read the new
  screenshots** to confirm — the previous run's directory is your baseline.
- Never commit `e2e-results/` (gitignored) or any API key.
