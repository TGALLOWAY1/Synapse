# Synapse QA Checklist

A walkable manual pass over the product's core flows, for use before a release
or after a change that touches the pipeline, the workspace, or the store.

Work top to bottom. Each item names **the action**, **what you should see**, and
**where to look** if it fails. Copy the checklist into your PR or issue and tick
as you go.

- **Full pass:** ~60–75 minutes and 2 live generations.
- **Short pass** (sections 0–3 and 9): ~20 minutes, 1 generation.

> This checklist covers what automated tests cannot. The repo already runs
> ~2500 unit tests over the pure logic — the freshness engine, the write
> barrier, planning authority, versioning, the persist codec. Do not re-verify
> those by hand. See [What automation already covers](#what-automation-already-covers).

---

## Before you start

```bash
npm install
npm run dev            # http://localhost:5173
```

- Sign in normally, or set `VITE_DEV_SKIP_AUTH=true` for the local Dev User
  bypass (localStorage only, no server sync).
- A Gemini API key is required. Set it in **Settings** in the app. Never paste a
  key into a file or a commit.
- Use a **fresh project** for sections 1–8. Reusing a project from a previous
  pass hides first-run problems.

### Known local behavior that is NOT a bug

Do not file these:

- [ ] **Mockup images never render locally.** They come from the serverless
      `/api/image/generate` proxy, which `vite dev` does not run. Screens always
      shows a wireframe or placeholder here.
- [ ] **`/api/*` requests 404 and the header shows "Cloud save failed."** No
      serverless functions run under `vite dev`.
- [ ] **Analytics requests are blocked.** Vercel Analytics is not available
      locally.
- [ ] **A console error on first load** — Vite's dependency optimizer forces one
      reload on a cold start.

---

## 0. Smoke — does it boot?

- [ ] `/` renders the idea form with the placeholder *"What product shall we
      design?"*, a project name field, and the **App / Web** toggle.
- [ ] The example prompt carousel advances and clicking an example fills the
      prompt.
- [ ] **Settings** opens and shows the API key field.
- [ ] `/tour` renders and advances through its beats.
- [ ] No uncaught page errors in the console beyond the known first-load reload.

---

## 1. Create a plan

Use a deliberately under-specified idea, e.g. *"An app that helps people stay
organized."*

- [ ] Type the idea, set a project name, choose **App**.
- [ ] Submit. The dialog **"How would you like to start?"** appears with three
      options: **Develop the idea**, **Draft a working plan**, **Explore deeply**.
- [ ] Choose **Develop the idea**. Clarification questions generate (also on
      `npm run dev`, whose React StrictMode double-runs effects). While you
      answer, the header badge reads **Clarifying…**, not Generating….
- [ ] Questions arrive one at a time with a **Question N of M** progress header.
- [ ] The questions are worth asking — they target decisions that change the
      product (who it is for, the core workflow, scope), not trivia that could
      be inferred or deferred.
- [ ] **Skip** advances without blocking. **Back** returns with the previous
      answer still present.
- [ ] The summary **"Here's what I learned"** separates **Assumptions** from
      **Open questions**.
- [ ] **Edit answers** returns to the questions without losing them.
- [ ] **Generate PRD** starts generation; the progress timeline shows real
      stages advancing, not a static spinner. Until it finishes the plan is
      read-only, with **"Editing unlocks when generation finishes."** above it.
- [ ] Generation completes and lands on the plan view.

**Safety gate** — start a second project with an idea that should be refused
(something clearly harmful):

- [ ] The Safety Review appears instead of a plan, and explains the refusal
      rather than failing silently.

*If generation stalls or errors:* `src/lib/runPrdGeneration.ts`,
`src/lib/services/progressivePrdPipeline.ts`. Check the spine's
`generationPhase` and `generationError` in the persisted store.

---

## 2. Read the plan

On the **Overview** tab:

- [ ] Vision, Core Problem, Architecture, Target Users, Risks, Domain Entities
      and Primary Actions are all present and populated — no empty sections, no
      `undefined`/`null` rendered.
- [ ] The content reflects the answers given in section 1. Spot-check two.
- [ ] Because the idea was vague, the plan **surfaces gaps** — assumptions and
      open decisions — rather than inventing certainty about everything.
- [ ] Each section's **Edit** works in place: change text, **Save changes**,
      value persists. **Cancel editing** discards. **Save changes** with
      nothing changed creates no new version (the header version number stays
      put).

On the **Features** tab:

- [ ] Features are listed with enough detail to act on.
- [ ] The filters **All / MVP / Later / Needs review / Confirmed** each change
      the list.
- [ ] Deleting a feature (hover the card → the delete control → confirm the
      browser prompt) removes it and the list updates.

- [ ] A first-time reader can find the primary user, the core workflow, the
      feature list and the open decisions **without reading the whole page**.
- [ ] Above the plan sits **one line** of planning state — *N open decisions ·
      M assumptions to confirm* (or *No open decisions or assumptions*) with
      **Open Decision Center** and *Challenge this plan* — and nothing else: no
      readiness card, check lists, or implementation-packet block. Its count
      matches the journey rail's **Decide** badge and the Decision Center's
      *Needs attention* tab.

*If a section renders empty:* `src/components/StructuredPRDView.tsx` and the
section prompts in `src/lib/prompts/prdSectionPrompts.ts`.

---

## 3. Refine the plan

This is the least-covered path in the codebase — exercise it properly.

- [ ] Select a sentence in the Overview. The **PRD edit actions** dialog appears.
- [ ] Pick an action, give an instruction, and start a branch.
- [ ] The branch conversation returns a proposal that actually addresses the
      instruction.
- [ ] **Consolidate now** → choose a scope → generate the patch.
- [ ] The patch preview shows what will change.
- [ ] **Commit to New Spine** applies it, and the plan text visibly changes.
- [ ] The change is **appended** as a new version — the previous version is
      still in Version History, not overwritten.
- [ ] If consolidation fails to find its anchor, you get a clear error — the
      edit is not silently dropped.
- [ ] Open branches survive other edits: with a branch still open, edit a
      section inline — the branch is still listed under **Active Branches**.

Then stage several edits:

- [ ] Make 2–3 edits without committing each one. The staged-edits review lists
      all of them.
- [ ] Applying them together produces one coherent new version, and no earlier
      confirmed edit is silently overwritten.

*If this misbehaves:* `src/lib/services/branchService.ts` (`consolidateBranch`)
and the `compareAndAppendStructuredPRD` write barrier. **This module has no unit
tests** — problems here will only be caught by this section.

---

## 4. Challenge and decide

- [ ] **Challenge this plan** starts the adversarial review and it completes.
- [ ] **Findings** lists issues that are worth someone's time — workflow
      confusion, unsupported assumptions, missing edge cases, security,
      architecture conflict. Not a wall of trivia.
- [ ] Each finding explains why it matters and what to do about it.
- [ ] Dispositioning a finding sticks, and the same finding does not immediately
      reappear.
- [ ] **Review history** shows past runs.
- [ ] The **Decision Center** (overflow menu → *Decision Center*) lists open
      decisions with a queue and a detail pane.
- [ ] Answering a decision records it and updates the affected content.
- [ ] Deferring a decision leaves it discoverable and does not block unrelated
      work.
- [ ] Nothing the model produced is presented as though **you** confirmed it.

*Where this lives:* `src/components/review/ReviewWorkspace.tsx`,
`src/components/review/DecisionCenter.tsx`.

---

## 5. The journey — Plan · Decide · Build

- [ ] The journey rail shows exactly three steps, **Plan · Decide · Build**. No
      step is labelled "unavailable"; before a plan exists, Decide and Build are
      simply inert.
- [ ] **Decide** opens the Decision Center over the current page and carries a
      badge with the open-item count; closing it returns you where you were.
- [ ] There is **no** Finalize, *Review readiness*, or *Commit plan* button
      anywhere, and the header never shows *Plan finalized*, *accepted risk*,
      or *unverifiable* states. The outputs stage is always called **Build**.

---

## 6. Generate outputs

- [ ] The top-bar **Generate outputs** (or the **Generate outputs** banner on
      the Build stage) starts generation straight away — nothing asks you to
      finalize or commit first, and open decisions do not block it. If no
      visual direction was chosen yet, the picker appears → choose a preset →
      **Continue with …**. A plan with a failed section first asks
      *Generate assets from an incomplete PRD?*. Confirming it is remembered
      for that version: a reload mid-run resumes, and **Sync outputs** can
      regenerate without asking again. An unconfirmed incomplete version shows
      the same confirmation inside **Sync outputs** instead of a dead end, and
      editing, restoring, or re-running a section asks again while sections
      are still failed.
- [ ] All five workspace destinations populate: **Design System**, **User
      Flows**, **Screens**, **Data Model**, **Implementation Plan**. Under the
      hood this means all six active core outputs — including **Component
      Inventory** inside Screens — plus the **Mockup** spec reach a terminal,
      successful state.
- [ ] Sidebar status dots and the hosted **Components** status progress and
      **all settle** — nothing stuck spinning, silently missing, or reported
      complete while a required hosted slot is still running.
- [ ] The sidebar groups read Project Foundation · Experience · Architecture ·
      Development · Project Map.

Then check each output is usable:

- [ ] **Design System** — tokens and components, not lorem filler.
- [ ] **User Flows** — flow navigation works; each flow's steps trace a
      complete journey with no unexplained jumps.
- [ ] **Screens** — the list is populated; opening one shows **Overview / Flow /
      Mockups** tabs; **All screens** returns. Screens reference the features
      they serve.
- [ ] **Screens → Components** — the section expands, lists reusable components,
      shows screen back-references and contradiction advisories, and a failed or
      missing inventory has a visible Retry/Generate path.
- [ ] **Data Model** — the three review segments **Schema / API Contract /
      Privacy & Security** render. Entities, fields and relationships are
      present; first-slice endpoints identify auth, schemas, errors, pagination,
      idempotency, rate limits, linked requirements, and tests. Legacy endpoints
      remain readable and are labelled as stubs rather than errors.
- [ ] **Implementation Plan** — the **Final Review** card renders above the tab
      strip with **exactly one** primary action, and the three tabs **Build
      Brief / Roadmap / Prompts** all render with content.
- [ ] **Final Review's** primary action is always the next build step —
      *Copy first implementation prompt* (then *Copy next…*), or *Start first
      slice* — whatever the checks say. **Approve build packet** sits beside it
      marked *(optional)* and works with checks still open. Copy plan / Review
      prompts / Convert to tasks stay inside **More actions**.
- [ ] The seven packet checks appear in order, labelled *estimated, advisory*,
      and agree with their evidence: **Required outputs generated**, **Packet
      inputs current**, **Output validation clear**, **In-scope requirements
      covered**, **First-slice API contracts complete**, **Cross-cutting
      obligations discharged**, **First slice is executable**. There is no
      *Product reasoning committed* check, and nothing (copying, export,
      Convert to tasks) waits on an open one.
- [ ] Every open check's fix link lands on the named destination, including
      **API Contract**, the expanded **Traceability matrix**, the requested
      first milestone, the hosted **Components** section, and a requirement in
      the PRD **Features** view (with *Back to Build*).
- [ ] A project with privacy/safety triggers lists an open **Security &
      Privacy** check; a success-metric trigger with no **Measurement** section
      shows up under *Recorded, not counted*; a project with no trigger omits
      both without inventing a check.
- [ ] **Artifact versions an approval covers** lists every output; after
      approving and then regenerating one, that row reads *Changed since
      approval* and the card offers *Re-approve build packet* (still
      optional).
- [ ] **Traceability matrix** (inside Final Review) actually links work back to
      features and screens; it is not empty.
- [ ] Tasks state objective completion conditions. Flag vague ones — *"improve
      the page"*, *"build the backend"*, *"make it intuitive"*.
- [ ] Task progress reads **Planned → Started → Implemented (self-reported)**.
      It never claims Verified or treats a checked task as build-packet evidence.
- [ ] **Dependency Graph** renders and shows the relationships between outputs.

- [ ] Pick one feature and trace it end to end: **feature → flow → screen →
      data entity → implementation task.** Every hop should be findable.

---

## 7. Coherence after a change

- [ ] Go back to the plan and make a substantive change (add or materially
      revise a feature).
- [ ] Dependent artifacts are marked **possibly outdated** — a plan change that
      marks *nothing* stale is a defect.
- [ ] The change is reflected where it should be: scope, screens, data model,
      implementation plan.
- [ ] Unaffected work is left alone.
- [ ] You are offered a way to bring outputs back in line, and you can review it
      before it applies.
- [ ] No orphans left behind — no screen, entity or task still referencing
      something you removed.

*Where this lives:* `src/lib/artifactFreshness.ts` (the single freshness
engine), `src/components/downstream/`.

---

## 8. Versions and recovery

- [ ] Overflow menu → **Version History** lists every version in order.
- [ ] Comparing two versions describes what actually changed, not just a raw
      text diff.
- [ ] Restoring an earlier version **appends** a new version — the history is
      not rewound and nothing is deleted.
- [ ] Work done after the restored point is still reachable in history.
- [ ] Viewing an older version (Plan → **Timeline** → a past version) is
      read-only: the journey's **Build** step is inert, and anything that opens
      the outputs (e.g. **Continue to Build**) returns to the latest version
      first — no output can be regenerated from the old PRD.
- [ ] After restoring, an update plan for an affected output reads
      *Confirmed source change*, not *provisional*.
- [ ] Overflow menu → **Project History** shows the event timeline.

Interrupt a generation (reload the page mid-run):

- [ ] Reopening the project does not lose confirmed decisions, manual edits or
      previous artifact versions.
- [ ] An interrupted run is presented as interrupted rather than stuck
      mid-progress, and can be retried.
- [ ] Retrying does not produce duplicate artifacts.
- [ ] Interrupt an **output** run the same way; it resumes or can be restarted
      without duplicating slots — including a reload **before the first output
      finishes** (the Build view resumes the run instead of sitting idle).
- [ ] An output that keeps failing is retried automatically at most twice per
      session (revisit Build a few times), then stays failed with **Retry**.
- [ ] Reload while a branch reply is in flight: the thread shows *"Reply was
      interrupted — send again"* with your message back in the reply box, and
      nothing is re-sent until you send it.

Recovery bundle (a separate escape hatch — it never touches the network):

- [ ] Download a recovery bundle for the project and confirm the JSON contains
      the project's collections and is self-describing.

*Where this lives:* `src/components/versions/`;
`src/store/interruptedGeneration.ts` for interrupted plan generation and
`artifactJobController.resumeIfNeeded` for output runs;
`src/lib/projectRecovery.ts` for the bundle download only — it takes no part in
interrupted generation. The interruption logic has unit coverage
(`src/store/__tests__/interruptedGeneration.test.ts`); what this section adds is
the real reload, which those tests simulate.

---

## 9. Handoff

- [ ] With decisions still open, **Export** is fully available — no plan
      checkpoint, and no *Plan finalized* / *Working plan* status line; the
      checkpoint summary lists notes only.
- [ ] **Export Full Bundle** downloads and the markdown is complete and
      readable.
- [ ] **Export Structured JSON** downloads and parses.
- [ ] The export identifies versions, and nothing stale is presented as current.
- [ ] Skim the bundle as if you were the developer receiving it: could you start
      work without a conversation? Note anything you would have to ask about.

---

## 10. Platform, persistence, and the browser

**Platform** — create a second project with the *same idea* but **Web**:

- [ ] The plan differs in substance, not just wording — navigation, screen
      structure, connectivity and device assumptions should reflect a web
      product rather than an app.
- [ ] The difference **survives into Screens and User Flows** — they should read
      as a web product too, not just the plan.

      Platform reaches both stages by design, so platform-neutral outputs are a
      **defect to report**, not an expected limitation. It enters the plan
      prompts via `PLATFORM_NOTE`
      (`src/lib/prompts/prdSectionPrompts.ts`) and reaches artifact generation
      through the canonical spine: `artifactJobController` passes
      `project.platform` into `buildCanonicalPrdSpine`, which records it as
      `identity.platform` (`"Mobile app"` / `"Web app"`), and
      `buildCanonicalSpinePromptSection` serializes that into the artifact
      prompt as the **authoritative** contract
      (`src/lib/canonicalPrdSpine.ts`).

      One real exception: that spine section is omitted entirely when the plan
      has **no features**, so a featureless plan legitimately produces
      platform-neutral outputs. Confirm the plan has features before recording a
      failure.

**Persistence:**

- [ ] Reload at each stage — plan, challenge, outputs. You return to the same
      place with the same state.
- [ ] Close the tab and reopen the project. Pending changes are still visible,
      resolved decisions are still resolved, and no artifact silently reverts.
- [ ] Open the project in a second tab, edit in one, and confirm the other does
      not clobber it.
- [ ] With a second tab open, delete a project in one tab, then make any change
      in the other: the deleted project does not come back in either tab (or,
      signed in, on another device).
- [ ] Start output generation in Build, then open the same project's Build view
      in a second tab: it shows the run in progress **read-only** (with the
      "being generated in another tab" notice) and starts no second run.
      Reloading the first tab resumes its own run; closing it mid-run hands the
      unfinished outputs to the second tab once the lease lapses (under a
      minute).
- [ ] Signed in with sync available, confirm the project appears on another
      device.

---

## 11. Accessibility and mobile

- [ ] Tab through the idea form, the plan tabs and a modal using only the
      keyboard. Focus order is sensible and focus is visible.
- [ ] Modals trap focus and **Esc** closes them.
- [ ] Every icon-only button has an accessible name (check with a screen reader
      or the accessibility inspector).
- [ ] At 390px wide: no horizontal scrolling, text is readable, tap targets are
      comfortable, and the artifact list drawer opens and closes.
- [ ] At 200% browser zoom the layout holds together.
- [ ] With reduced motion enabled, animations are suppressed.

---

## What automation already covers

Do not spend manual time here:

| Area | Covered by |
|---|---|
| Freshness / staleness rules | `src/lib/__tests__/artifactFreshness*` |
| Version append-only semantics, revert | `src/store/__tests__/spineSlice.versioning.test.ts` |
| Planning authority, decision impacts | `src/lib/planning/__tests__/` (33 files) |
| Persistence, compression, cross-tab | `src/store/__tests__/persistCodec`, `crossTabPersistence` |
| Safety classification | `src/lib/safety/__tests__/` |
| Interrupted-generation bookkeeping | `src/store/__tests__/interruptedGeneration.test.ts` |
| Prompt wording | `src/lib/__tests__/promptSurfaces.test.ts` (snapshot-locked) |
| Screenshots of every view | `npm run e2e` — see [E2E_LIVE_TESTING.md](E2E_LIVE_TESTING.md) |

Run `npm test` before a manual pass; if it is red, fix that first — a manual
pass over broken logic wastes the pass.

---

## Recording results

For each failure note: **which item**, **what you saw**, **what you expected**,
and the **project id**. Attach a screenshot for anything visual.

Treat as release-blocking:

- Generation that does not complete, or completes with empty sections.
- A refinement edit that is silently lost.
- A restore that destroys history.
- Outputs that contradict the plan.
- An export presenting stale content as current.

Everything else is a normal bug — file it and keep going.
