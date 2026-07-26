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
- [ ] Choose **Develop the idea**. Clarification questions generate.
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
      stages advancing, not a static spinner.
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
      value persists. **Cancel editing** discards.

On the **Features** tab:

- [ ] Features are listed with enough detail to act on.
- [ ] The filters **All / MVP / Later / Needs review / Confirmed** each change
      the list.
- [ ] Deleting a feature (hover the card → the delete control → confirm the
      browser prompt) removes it and the list updates.

- [ ] A first-time reader can find the primary user, the core workflow, the
      feature list and the open decisions **without reading the whole page**.

*If a section renders empty:* `src/components/StructuredPRDView.tsx` and the
section prompts in `src/lib/prompts/prdSectionPrompts.ts`.

---

## 3. Refine the plan

This is the least-covered path in the codebase — exercise it properly.

- [ ] Select a sentence in the Overview. The **PRD edit actions** dialog appears.
- [ ] Pick an action, give an instruction, and start a branch.
- [ ] The branch conversation returns a proposal that actually addresses the
      instruction.
- [ ] **Consolidate to Document** → choose a scope → generate the patch.
- [ ] The patch preview shows what will change.
- [ ] **Commit to New Spine** applies it, and the plan text visibly changes.
- [ ] The change is **appended** as a new version — the previous version is
      still in Version History, not overwritten.
- [ ] If consolidation fails to find its anchor, you get a clear error — the
      edit is not silently dropped.

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

## 5. Finalize

- [ ] The header **Review readiness** opens the readiness checkpoint.
- [ ] It lists what is outstanding, and blocking items are distinguishable from
      advisory ones.
- [ ] With blockers open, **Finalize with accepted risk** requires a rationale
      before **Finalize with N accepted blockers** is available.
- [ ] Finalizing shows the success modal: **one** primary button plus the
      secondary **Keep reviewing the plan**. The primary button's label depends
      on the state you finalized from — **Generate build foundation** when the
      plan was ready to build, **Explore outputs** when you finalized with
      accepted risk, **Review outputs** if outputs already exist or are
      building. Only one of the three appears; that is correct, not a missing
      control.
- [ ] Finalization is a checkpoint, not a lock — you can still edit the plan
      afterwards.
- [ ] It is clear what finalizing actually changed.

---

## 6. Generate outputs

- [ ] **Generate build foundation** → the visual direction picker appears →
      choose a preset → **Continue with …**.
- [ ] All five artifacts generate: **Design System**, **User Flows**,
      **Screens**, **Data Model**, **Implementation Plan**.
- [ ] Sidebar status dots progress and **all settle** — nothing stuck spinning.
- [ ] The sidebar groups read Project Foundation · Experience · Architecture ·
      Development · Project Map.

Then check each output is usable:

- [ ] **Design System** — tokens and components, not lorem filler.
- [ ] **User Flows** — flow navigation works; each flow's steps trace a
      complete journey with no unexplained jumps.
- [ ] **Screens** — the list is populated; opening one shows **Overview / Flow /
      Mockups** tabs; **All screens** returns. Screens reference the features
      they serve.
- [ ] **Data Model** — entities, fields and relationships; the entities named
      in the plan actually appear here.
- [ ] **Implementation Plan** — the **Final Review** card renders above the tab
      strip with **exactly one** primary action, and the three tabs **Build
      Brief / Roadmap / Prompts** all render with content.
- [ ] **Final Review's** primary action matches the state: *Resolve N blockers*
      (expands the ordered blocker list, each entry navigating somewhere real),
      *Approve build packet*, or *Copy first implementation prompt* once
      approved. Copy plan / Review prompts / Convert to tasks stay inside
      **More actions** in all three states.
- [ ] **Artifact versions this approval covers** lists every output; after
      regenerating one, that row reads *Changed since approval* and the CTA asks
      to re-approve.
- [ ] **Traceability matrix** (inside Final Review) actually links work back to
      features and screens; it is not empty.
- [ ] Tasks state objective completion conditions. Flag vague ones — *"improve
      the page"*, *"build the backend"*, *"make it intuitive"*.
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
- [ ] Overflow menu → **Project History** shows the event timeline.

Interrupt a generation (reload the page mid-run):

- [ ] Reopening the project does not lose confirmed decisions, manual edits or
      previous artifact versions.
- [ ] An interrupted run is presented as interrupted rather than stuck
      mid-progress, and can be retried.
- [ ] Retrying does not produce duplicate artifacts.
- [ ] Interrupt an **output** run the same way; it resumes or can be restarted
      without duplicating slots.

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

- [ ] With a blocking decision still open, **Export** shows *"Finalize blocking
      decisions before export"* and points at the checkpoint.
- [ ] Resolve it; export unblocks.
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
