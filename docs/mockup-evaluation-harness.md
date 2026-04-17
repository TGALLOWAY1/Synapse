# Mockup Evaluation Harness

This harness provides a repeatable way to measure mockup generation reliability, catch regressions early, and inspect failures with screenshots and replay.

## What it covers

- **Test input suite** across simple, medium, complex, and edge-case PRDs (`harness/mockup-test-suite.json`).
- **Automated pipeline** per test case:
  1. Generate mockup payload (fixture generator in this implementation)
  2. Validate structure/safety contracts
  3. Render each screen with Playwright
  4. Score output quality with deterministic heuristics
- **Metrics** tracked per run:
  - Render Success Rate (%)
  - Structural Validity (%)
  - Retry Rate (%)
  - Fallback Rate (%)
  - Visual Quality Score (0-100)
  - Consistency Score (same input across runs)
- **Regression detection** against a baseline summary file.
- **Artifacts** per run:
  - `run-log.json` (full per-case logs)
  - `summary.json` (top-level metrics + regressions + weak areas)
  - `failure-report.md`
  - `comparison.json` (cross-run consistency per case)
  - `dashboard.html`
  - PNG screenshots of each rendered screen

## Usage

```bash
npm run mockup:harness
```

Optional flags:

```bash
node scripts/mockup-eval-harness.mjs \
  --suite harness/mockup-test-suite.json \
  --outdir harness/results \
  --runs 3 \
  --max-attempts 2 \
  --baseline harness/sample-results/latest/summary.json \
  --case simple_landing,complex_product_flow
```

Replay failed cases from a previous run:

```bash
node scripts/mockup-eval-harness.mjs --replay-from harness/results/<run-id>/summary.json
```

Generate the committed sample output set:

```bash
npm run mockup:harness:sample
```

## Extending the suite

Add a new object in `harness/mockup-test-suite.json` with:

- `id`
- `complexity` (`simple | medium | complex | edge`)
- `title`
- `prd`
- `settings` (`platform`, `fidelity`, `scope`)
- `requiredSections`

No code changes are required for basic additions.

## Notes

- This implementation uses a **fixture generator** to keep setup lightweight and deterministic.
- In production, swap in your real model generation call and preserve the same output contract (`mockup_html_v1`).
- Screenshot rendering depends on Playwright availability.
