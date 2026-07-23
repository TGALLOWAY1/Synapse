# Live E2E Testing (real generation + visual assessment)

`scripts/e2e-live-run.mjs` boots the app locally, creates a **real project from
a plain-language idea**, waits for **actual Gemini PRD generation** to settle,
walks every pipeline stage, artifact, and sub-tab, and writes **full-height**
screenshots plus a machine-readable `report.json`. It exists so that a human —
or a coding agent that can read images (Claude Code) — can assess the live
product end-to-end without hand-driving the UI: visual gaps show up in the
PNGs, and runtime problems show up in the report's console/page/network error
lists.

```bash
npm run e2e            # live run — needs a Gemini key (see "Credentials")
npm run e2e:smoke      # no-LLM harness check: boot, form fill, start dialog
npm run e2e -- --prompt="A recipe box app for families" --name="Recipe Box"
npm run e2e -- --timeout-min=15 --out=./e2e-results/my-run
npm run e2e -- --skip-assets   # stop after the PRD (cheaper; no bundle spend)
npm run e2e -- --viewport=both --views=screens,implementation-plan
npm run e2e -- --interactions  # + canned edit/consolidate/decision loop
npm run e2e -- --state=e2e-results/run-<stamp>/state.json --views=prd
```

Output goes to `e2e-results/run-<timestamp>/` (gitignored): numbered
`NN-<step>.png` screenshots in flow order (mobile-pass shots carry a
`-mobile` suffix), a `state.json` project dump (live runs), and `report.json`
with per-step status/timing, console errors and warnings, uncaught page
errors, failed network requests, and the generation outcome.

## Full-height screenshots

The app shell is `h-screen` with per-stage internal `overflow-y-auto` panes
(`ProjectWorkspace`/`ArtifactWorkspace`), so the document never scrolls and a
plain Playwright `fullPage` capture stops at the viewport. The harness's
`fullShot()` helper measures the dominant internal scroller (widest, deepest
overflow), resets its scroll position, temporarily grows the browser viewport
by the overflow delta (capped at 8000px — the whole layout, including modals,
is viewport-relative, so it expands naturally), captures, then restores the
viewport. Known limitation: inner widgets with a fixed non-`vh` `max-height`
still clip.

## What a live run covers

1. Home page renders (signed in as the local Dev User).
2. Idea prompt + project name filled; start-mode dialog opens.
3. "Draft a working plan" (immediate generation) — a real Gemini run.
4. Generation settle detected from the app's own persisted store: the latest
   `SpineVersion.generationPhase` flipping to `'complete'` (progress
   screenshots are captured every ~45s while it runs).
5. `--interactions` only: the canned interactive loop — programmatic PRD text
   selection → the `PRD edit actions` dialog → canned edit instruction →
   branch conversation (real Gemini call) → **Consolidate to Document** →
   scope choice → generate patch (real Gemini call) → **Commit to New Spine**.
   The commit is best-effort: its exact-substring anchor replace can
   legitimately fail on LLM formatting drift, and the error state is itself
   useful visual coverage.
6. **Downstream asset generation** (unless `--skip-assets`). The plan is
   committed through the readiness gate — top-bar **Review readiness** →
   ReadinessCheckpoint (**Finalize plan** when ready-to-build, otherwise the
   **Finalize with accepted risk** override: reveal the override section, fill
   the rationale textarea, then **Finalize with N accepted blockers** for an
   exploring-phase working plan) → **FinalizationSuccessModal**
   → **Generate build foundation** / **Explore outputs** → the one-time
   **Choose your visual direction** preset picker (Modern SaaS). That fires
   `artifactJobController.startAll`, which generates the core-artifact bundle +
   mockup spec (real Gemini calls, dependency-layered). Settle is detected from
   the persisted `artifacts[projectId]` array (every *visible* core subtype has
   a `currentVersionId`) **and** the workspace going quiescent (no spinning
   `StatusDot`s in `nav[aria-label="Artifacts"]`, no "Creating your build
   assets…" pane). Progress screenshots are captured every ~45s.
7. **The full view/tab inventory walk**, per requested viewport:
   - PRD **Overview** and **Features** tabs (`#prd-tab-*`), reached via the
     journey rail's **Define** step.
   - The **Challenge** surface (journey **Define** → PlanningStateBar's
     **Challenge this plan**): the review workspace, **Review findings**,
     **Review history** — plus the **Decision Center slide-over** (overflow
     menu entry; queue + first record detail).
   - Every artifact (journey **Review** step): Design System; User Flows
     (plus up to 3 per-flow shots via the `Flow navigation` landmark);
     Screens (list, then the first screen's detail **Overview / Flow /
     Mockups** tabs); Data Model; Implementation Plan (**Build Brief /
     Roadmap / Prompts / Validation / Coverage** section tabs); Dependency
     Graph.
   - The **Project history** slide-over panel (overflow menu entry — history
     is no longer a pipeline stage).
8. `--interactions` only: answering one decision in the Decision Center
   (confirm → option+save → defer, whichever the record shape offers),
   captured after the pristine inventory shots.
9. A `state.json` export of the project's localStorage for later `--state`
   replays.

Inventory steps are best-effort: a missed selector records the step as
`skipped` (with the error) and the run continues, so a partially-broken UI
still yields reviewable screenshots rather than a dead run.

## Scenario flags

- `--viewport=desktop|mobile|both` — which viewport(s) the inventory walk
  runs at (desktop 1440×900 default; mobile 390×844 navigates artifacts via
  the `Open artifact list` drawer). Generation itself always runs desktop.
- `--views=<csv>` — restrict the inventory to these slugs: `prd`,
  `challenge`, `design-system`, `user-flows`, `screens`, `data-model`,
  `implementation-plan`, `dependency-graph`, `history`. A view whose data was
  never generated (e.g. `implementation-plan` against a `--skip-assets` dump)
  degrades to `skipped`.
- `--state=<file>` — **replay mode**: rehydrate a previous live run's
  `state.json`, skip all generation, and jump straight to the inventory walk.
  Zero LLM spend — the "screenshot an existing project" tier.
- `--interactions` — opt into the canned interactive loop (live mode only;
  ~2 extra Gemini calls).

### How `--state` replay works (and the deep-link race)

On a cold load the project store's **first** hydration reads the
un-namespaced base key `synapse-projects-storage` — the dev-user namespace
(`synapse-projects-storage::u:dev-user`) only applies after `refreshSession()`
runs in an effect and triggers a re-hydrate. `ProjectWorkspace`'s
"Project not found → navigate home" effect fires on the first render, before
that second hydration, which is why reloading `/p/:id` by hand can bounce.
The harness therefore seeds the replayed project blob under **both** storage
names via `addInitScript`, making the very first hydration correct — no retry
loop. If the replay step still fails, treat it as a regression signal in the
boot sequence (`App.tsx` / `userScope.ts`), not harness flakiness.

`state.json` is written after a ≥700ms settle (the store's localStorage
writer is debounced at 500ms). It contains only `synapse-projects-storage*`
keys and the tour flag — never the Gemini key. Mockup images are **not**
included (they live in IndexedDB), which costs nothing here because they
never render locally anyway (see below).

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
  every captured log line, and never writes it into `report.json` or
  `state.json`. Never commit a key; in Claude Code remote sessions, set it as
  an environment variable in the environment's settings.
- **Cost:** a default live run ≈ one full PRD generation (Pass A + consistency
  review) **plus** the downstream asset bundle (design system, user flows,
  screen inventory, data model, implementation plan, hidden UI components, and
  the mockup spec — each a Gemini call). `--interactions` adds ~2 more calls
  (branch reply + consolidation patch). Pass `--skip-assets` to stop after the
  PRD when you only need to assess the plan surfaces, or use `--state` replays
  (free) for iteration. Budget accordingly before looping live runs.

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
- **Consolidation commit failures under `--interactions`** can be legitimate
  LLM formatting drift (the commit is an exact-substring anchor replace), not
  a harness or app bug — the captured error state is still useful coverage.
- **Deep-link reload races store rehydration** for *hand-driven* reloads of
  `/p/:id` (see the `--state` section for the mechanism). The harness's
  replay mode seeds around it; the mobile pass resizes in place rather than
  reloading.

## How Claude Code should use this (the review loop)

The `/e2e` project skill (`.claude/skills/e2e/SKILL.md`) encodes this — including
the **scope-first questionnaire** (viewport / full-pipeline-vs-subset-vs-
branch-diff / critique) CLAUDE.md requires before running — but the short
version:

1. Scope the run with the user, then `npm run e2e` with the mapped flags (or
   `e2e:smoke` / `--state` when no key is available).
2. **Read every PNG** in the output directory — actually look at them. Judge
   layout breaks, overflow/clipping, unreadable contrast, empty states shown
   where content was expected, spinners that never resolved, mobile issues.
3. Read `report.json` — failed steps, console errors, page errors, failed
   requests are all defects or leads.
4. If asked for a critique, write a severity-ordered `critique.md` into the
   run directory (one section per screenshot).
5. Fix, re-run (prefer a `--state` + `--views` subset), re-compare against
   the previous run's directory.

## Maintenance

The driver leans on a small set of app touchpoints — if you change one,
update the script in the same change (treat drift here like docs drift):

- Home form: `placeholder="What product shall we design?"`, the
  `Project name…` placeholder, the `Generate PRD` submit label.
- Start-mode dialog: "How would you like to start?", the "Draft a working
  plan" option, the `Cancel` aria-label.
- Journey nav: `JourneyRail.tsx` — the `nav[aria-label="Product journey"]`
  buttons. Accessible names concatenate `"<n> · <status> <label>
  <description>"` and label words collide with description words ("Review"
  appears inside Finalize's description), so the driver matches each step by
  a unique snippet of its description (`JOURNEY_STEP_PATTERNS`, sourced from
  `src/lib/journeyPresentation.ts`). The Challenge surface is reached via
  Define + the PlanningStateBar's `Challenge this plan` button; the
  Decision Center and Project history are slide-overs behind the top-bar
  `More actions` overflow menu (`Decision Center` / `Project History`
  entries, `Close Decision Center` / `Close project history` buttons).
- PRD tabs: `#prd-tab-overview|features` ids in
  `src/components/prd/PrdViewTabs.tsx`; the PRD content panel id prefix
  `prd-panel-` (used for programmatic selection in `--interactions`).
- Challenge surface: the `Review findings` / `Review history` tab buttons
  (`ReviewWorkspace.tsx`), the `Decision queue` aria-label and the
  `Yes, that's right` / `Save decision` / `Defer` answer buttons
  (`DecisionCenter.tsx`, hosted in `DecisionCenterSlideOver.tsx`).
- Selection→branch loop (`--interactions`): the
  `[role="dialog"][aria-label="PRD edit actions"]` dialog and its
  `How should this change?` input + `Branch` submit
  (`SelectionActionDialog.tsx`), the `Consolidate to Document` bar
  (`BranchList.tsx`), and the `Generate Local|Global Patch` /
  `Commit to New Spine` buttons (`ConsolidationModal.tsx`).
- PRD settle signal: `SpineVersion.generationPhase` and the
  `synapse-projects-storage*` persist key prefix (also the `--state`
  export/seed contract — base key + `::u:dev-user`).
- Commit-to-build path: the top-bar `Review readiness` button
  (`ProjectWorkspace.tsx`), the `Finalize plan` / `Finalize with accepted
  risk` / `Finalize with N accepted blockers` buttons and the
  `#readiness-rationale` textarea (`ReadinessCheckpoint.tsx`), the
  `Generate build foundation` / `Explore outputs` button
  (`FinalizationSuccessModal.tsx`), and the `Choose your visual direction`
  preset picker (`DesignSystemPresetChoice.tsx`) — a `DesignPresetGrid` preview
  grid where the run selects the `Modern SaaS` card and confirms via
  `Continue with…`.
- Asset settle signal: persisted `artifacts[projectId]` entries with a
  `currentVersionId` for the visible core subtypes (`design_system`,
  `user_flows`, `screen_inventory`, `data_model`, `implementation_plan`) plus a
  quiescent workspace — no `.animate-spin` in `nav[aria-label="Artifacts"]` and
  no "Creating your build assets…" pane.
- Artifact sidebar rows are selected by visible title (`Design System`,
  `User Flows`, `Screens`, `Data Model`, `Implementation Plan`,
  `Dependency Graph`); on mobile via the `Open artifact list` drawer button.
- In-artifact navigation: the `Implementation plan sections` nav with labels
  `Build Brief` / `Roadmap` / `Prompts` / `Validation` / `Coverage`
  (`ConsolidatedPlanView.tsx` — `capture-demo-screenshots.mjs` shares these),
  the `Screen detail sections` tablist (`Overview` / `Flow` / `Mockups`) +
  screen cards (`main button:has(h4)`) + the `All screens` back button
  (`ScreenDetailView.tsx`), and the `Flow navigation` landmark with
  `Flow N: …` buttons (`FlowSidebar.tsx` — note `aria-label="Flows"` exists
  only in the collapsed rail; don't use it).
