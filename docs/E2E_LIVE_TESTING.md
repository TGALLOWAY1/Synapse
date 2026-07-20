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
npm run e2e -- --skip-assets   # stop after the PRD (cheaper; no bundle spend)
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
5. PRD Overview / Features tabs (stable `#prd-tab-*` ids). Decisions live in
   the Decision Center (Challenge stage), not a PRD tab.
6. **`refine-popover`** (optional step). Programmatically selects a run of PRD
   text in `#prd-panel-overview` (a `Range` + `pointerup` dispatch, the same
   recipe `capture-readme-screenshots.mjs` uses for its README shot) and
   screenshots the resulting highlight-to-refine dialog (`role="dialog"`,
   `aria-label="PRD edit actions"` — `src/components/SelectionActionDialog.tsx`).
   Verifies the popover still opens off a real text selection and renders with
   real PRD content behind it; it asserts the dialog's *presence*, not its
   width, so it stays green across dialog-sizing changes. Dismissed with
   Escape afterward so the readiness-gate commit that follows starts from a
   clean PRD view.
7. **Downstream asset generation** (unless `--skip-assets`). The plan is
   committed through the readiness gate — top-bar **Review readiness** →
   ReadinessCheckpoint (**Commit plan** when ready-to-build, otherwise the
   **Proceed with accepted risk** override, filling the rationale/containment
   textareas for an exploring-phase working plan) → **FinalizationSuccessModal**
   → **Generate build foundation** / **Explore outputs** → the one-time
   **Choose your visual direction** preset picker (Modern SaaS). That fires
   `artifactJobController.startAll`, which generates the core-artifact bundle +
   mockup spec (real Gemini calls, dependency-layered). Settle is detected from
   the persisted `artifacts[projectId]` array (every *visible* core subtype has
   a `currentVersionId`) **and** the workspace going quiescent (no spinning
   `StatusDot`s in `nav[aria-label="Artifacts"]`, no "Creating your build
   assets…" pane). Each generated artifact — Design System, User Flows, Screens,
   Data Model, Implementation Plan, Dependency Graph — is then screenshotted from
   its sidebar row. Progress screenshots are captured every ~45s.
8. The History pipeline-stage tab.
9. A mobile-viewport (390×844) pass, resized in place rather than reloaded
   (see "Known local-run noise & caveats"), covering:
   - `prd-mobile` — the PRD (Plan stage).
   - `decisions-mobile` — navigates to the Challenge stage and shoots the
     Decision Center's queue list, explicitly landing on its "Decisions" tab
     (the tab's accessible name carries a dynamic record count, so it's
     matched by prefix). This is reachable regardless of whether the plan was
     committed — the Challenge stage only requires a structured PRD.
   - `decision-detail-mobile` — taps the first row in the decision queue
     (`aside[aria-label="Decision queue"]`, excluding the `role="tab"` view
     switcher above it) to open the mobile detail view, screenshots it, then
     uses "Back to decisions" to return to the list so later steps don't
     inherit a stranded detail view.
   - `artifact-design-system-mobile` (only attempted when the asset bundle was
     triggered) — navigates to the Build/Explore stage, opens the mobile
     off-canvas artifact drawer (`Open artifact list`, same
     hamburger-open/pick/auto-close pattern as
     `capture-demo-screenshots.mjs`'s `selectArtifact()`), opens Design System,
     and shoots it. Verifies the artifact workspace's mobile density/drawer
     still works, not just the desktop sidebar layout.

   These three additions verify the Decision Center's mobile list/detail flow
   and the Design System artifact's mobile rendering, distinct from the
   desktop-only per-artifact loop in step 7.

Steps 5–9 are best-effort: a missed selector records the step as `skipped`
(with the error) and the run continues, so a partially-broken UI still yields
reviewable screenshots rather than a dead run.

**Mockup images never render in this local harness.** The mockup *spec* (the
screen list) is generated by Gemini as part of the bundle, but the per-screen
rendered images come from the **server-side** `/api/image/generate` proxy, and
`hasOpenAIKey()` reflects the app's **provider-key status endpoint** — both are
`api/` serverless functions that plain `vite dev` does not run. So the Screens
view always shows wireframe/placeholder screens here, **regardless of any
`OPENAI_API_KEY` in the shell** (that env var is not the browser's key source);
`report.assets.note` records this unconditionally. Rendered mockup imagery can
only be exercised against a real deployment (e.g. a Vercel preview) where the
`api/` backend and a configured provider key exist.

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
- **Cost:** a default live run ≈ one full PRD generation (Pass A + consistency
  review) **plus** the downstream asset bundle (design system, user flows,
  screen inventory, data model, implementation plan, hidden UI components, and
  the mockup spec — each a Gemini call). Pass `--skip-assets` to stop after the
  PRD when you only need to assess the plan surfaces. Budget accordingly before
  looping runs.

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

## Known local-run noise & caveats (don't report these as app defects)

- **`/api/*` 404s + the "Cloud save failed" header badge.** Plain `vite dev`
  doesn't run the `api/` serverless functions, so project sync / activity
  calls 404 locally by design. The report buckets these under
  `expectedLocalApiErrors` (and the corresponding console resource errors are
  the same events); anything in `httpErrors` proper is real signal.
- **Vercel Analytics script failures** (`va.vercel-scripts.com`) are bucketed
  under `ignoredRequests` — blocked egress, not an app problem.
- **Deep-link reload races store rehydration.** Reloading `/p/:id` directly
  can bounce to home with a "Project not found" toast because the per-user
  project store rehydrates after the route resolves. The mobile pass
  deliberately resizes in place instead of reloading. If you're
  investigating that behavior itself, it may be a real UX issue on
  signed-in refresh — but it is not a harness failure.

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
- PRD tabs: `#prd-tab-overview|features` ids in
  `src/components/prd/PrdViewTabs.tsx` (`PRD_VIEWS` in
  `src/lib/derive/prdViews.ts` — decisions are not a PRD tab; they live in the
  Decision Center on the Challenge stage).
- Pipeline-stage nav: `PipelineStageBar.tsx` — the
  `nav[aria-label="Planning progression"]` buttons, whose accessible names are
  `"<Label>: <description>"` (matched by label prefix; the outputs stage is
  labeled `Explore` before readiness and `Build` after).
- PRD settle signal: `SpineVersion.generationPhase` and the
  `synapse-projects-storage*` persist key prefix.
- Commit-to-build path: the top-bar `Review readiness` button
  (`ProjectWorkspace.tsx`), the `Commit plan` / `Proceed with accepted risk` /
  `Proceed with N open items` buttons and `#readiness-rationale` /
  `#readiness-containment` textareas (`ReadinessCheckpoint.tsx`), the
  `Generate build foundation` / `Explore outputs` button
  (`FinalizationSuccessModal.tsx`), and the `Choose your visual direction`
  preset picker (`DesignSystemPresetChoice.tsx`) — a `DesignPresetGrid` preview
  grid where the run selects the `Modern SaaS` card and confirms via
  `Continue with…`.
- Asset settle signal: persisted `artifacts[projectId]` entries with a
  `currentVersionId` for the visible core subtypes (`design_system`,
  `user_flows`, `screen_inventory`, `data_model`, `implementation_plan`) plus a
  quiescent workspace — no `.animate-spin` in `nav[aria-label="Artifacts"]` and
  no "Creating your build assets…" pane. Artifact sidebar rows are selected by
  visible title (`Design System`, `User Flows`, `Screens`, `Data Model`,
  `Implementation Plan`, `Dependency Graph`).
- Refine popover: `#prd-panel-overview` (selection target) and the dialog's
  `role="dialog"` / `aria-label="PRD edit actions"`
  (`src/components/SelectionActionDialog.tsx`).
- Decision Center mobile: the pipeline stage nav's `Challenge:` button, the
  "Decision Center" tab button (`src/components/review/ReviewWorkspace.tsx`,
  aria-label prefix — it appends a record count), the record queue
  `aside[aria-label="Decision queue"]` (`src/components/review/DecisionCenter.tsx`
  — its rows are plain buttons, the tab switcher above them is `role="tab"`),
  and the mobile-only "Back to decisions" button.
- Design System mobile: the pipeline stage nav's `Build:`/`Explore:` button,
  the mobile drawer trigger `Open artifact list`
  (`src/components/ArtifactWorkspace.tsx`), same as the desktop artifact
  sidebar (`nav[aria-label="Artifacts"]` row selected by title).
