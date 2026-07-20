# Live E2E Testing (real generation + visual assessment)

`scripts/e2e-live-run.mjs` boots the app locally, creates a **real project from
a plain-language idea**, waits for **actual Gemini PRD generation** to settle,
walks the resulting pages, and writes full-page screenshots plus a
machine-readable `report.json`. It exists so that a human — or a coding agent
that can read images (Claude Code) — can assess the live product end-to-end
without hand-driving the UI: visual gaps show up in the PNGs, and runtime
problems show up in the report's console/page/network error lists.

```bash
npm run e2e            # live run — needs a Gemini key (see "Credentials")
npm run e2e:smoke      # no-LLM harness check: boot, form fill, start dialog
npm run e2e -- --prompt="A recipe box app for families" --name="Recipe Box"
npm run e2e -- --timeout-min=15 --out=./e2e-results/my-run
```

Output goes to `e2e-results/run-<timestamp>/` (gitignored): numbered
`NN-<step>.png` screenshots in flow order and `report.json` with per-step
status/timing, console errors and warnings, uncaught page errors, failed
network requests, and the generation outcome.

## What a live run covers

1. Home page renders (signed in as the local Dev User).
2. Idea prompt + project name filled; start-mode dialog opens.
3. "Draft a working plan" (immediate generation) — a real Gemini run.
4. Generation settle detected from the app's own persisted store: the latest
   `SpineVersion.generationPhase` flipping to `'complete'` (progress
   screenshots are captured every ~45s while it runs).
5. PRD Overview / Features / Decisions tabs (stable `#prd-tab-*` ids).
6. The workspace stage (Explore/Build outputs) — artifacts are *not* generated
   (that's a much larger token spend; drive it interactively if needed).
7. A mobile-viewport (390×844) pass over the PRD.

Steps 5–7 are best-effort: a missed selector records the step as `skipped`
(with the error) and the run continues, so a partially-broken UI still yields
reviewable screenshots rather than a dead run.

## Credentials & account model — deliberately NOT your real account

- **Auth:** the dev server boots with `VITE_DEV_SKIP_AUTH=true` — the dev-only
  bypass in `src/store/authStore.ts`. That signs the app in as a fully local
  "Dev User": no OAuth, no MongoDB session, **no project sync** (dev-skip-auth
  usage stays entirely in localStorage). Production builds never honor the
  flag. E2E runs therefore can't touch, pollute, or leak a real account's
  synced projects.
- **Gemini key:** supplied via the `SYNAPSE_E2E_GEMINI_KEY` (preferred) or
  `GEMINI_API_KEY` env var. Use a **dedicated test key with a quota/budget
  cap**, not a production key. The script seeds it into the browser's
  localStorage only (the same slot the app itself uses; the app's legacy-key
  migration namespaces it to the active user on first read), redacts it from
  every captured log line, and never writes it into `report.json`. Never
  commit a key; in Claude Code remote sessions, set it as an environment
  variable in the environment's settings.
- **Cost:** one live run ≈ one full PRD generation (Pass A + consistency
  review). Budget accordingly before looping runs.

If you later need coverage of *server-synced* behavior (cross-device projects,
snapshots), do it against a **Vercel preview deployment** with a dedicated
email-auth test account (`/api/auth/email` signup) — not by automating OAuth
and not with a personal account. That tier doesn't exist yet; this harness is
the local-first tier.

## Restricted-egress sandboxes (Claude Code web containers)

The app calls Gemini **directly from the browser**, and sandbox egress
gateways TLS-fingerprint-filter Chromium traffic (connections reset even
though Node `fetch` succeeds). When `HTTPS_PROXY` is set the script
auto-enables the same fetch relay as `capture-demo-screenshots.mjs`: every
page request is intercepted and fulfilled from Node fetch — localhost
directly, external hosts (including `generativelanguage.googleapis.com`)
through an undici `ProxyAgent` pinned to the proxy. Force with
`--fetch-relay`, disable with `--no-relay`.

## How Claude Code should use this (the review loop)

The `/e2e` project skill (`.claude/skills/e2e/SKILL.md`) encodes this, but the
short version:

1. `npm run e2e` (or `e2e:smoke` when no key is available).
2. **Read every PNG** in the output directory — actually look at them. Judge
   layout breaks, overflow/clipping, unreadable contrast, empty states shown
   where content was expected, spinners that never resolved, mobile issues.
3. Read `report.json` — failed steps, console errors, page errors, failed
   requests are all defects or leads.
4. Fix, re-run, re-compare against the previous run's directory.

## Maintenance

The driver leans on a small set of app touchpoints — if you change one,
update the script in the same change (treat drift here like docs drift):

- Home form: `placeholder="What product shall we design?"`, the
  `Project name…` placeholder, the `Generate PRD` submit label.
- Start-mode dialog: "How would you like to start?", the "Draft a working
  plan" option, the `Cancel` aria-label.
- PRD tabs: `#prd-tab-overview|features|decisions` ids in
  `src/components/prd/PrdViewTabs.tsx`.
- Stage nav: the `(Explore|Build|Review) outputs` button in
  `ProjectWorkspace.tsx`.
- Settle signal: `SpineVersion.generationPhase` and the
  `synapse-projects-storage*` persist key prefix.
