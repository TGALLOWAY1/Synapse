# Synapse

**Synapse is an AI-native product definition environment.** It turns a
plain-language idea into a structured PRD, then carries that PRD forward into
UI mockups, downstream engineering artifacts, and annotated visual feedback —
all from a single client-side workspace.

<img width="100%" alt="Synapse tour — start with a single idea" src="public/screenshots/tour-idea.png" />

## Check out the demo and tour 

- **Public URL:** 'https://synapse-prd.vercel.app'
- **No authentication** — the route is not behind the auth gate.

## What it does

A single prompt flows from a plain-language idea to a finalized blueprint and
every downstream asset:

Each stage is backed by Google Gemini, structured JSON schemas where they
matter, a code-level safety gate, and a versioned store so nothing you
generate is lost. Mockups are generated using OpenAI's GPT Image 2 model. 

## Feature tour

### 1. Start with a single idea

Synapse transforms a plain-language concept into a structured product
blueprint. Type one sentence — *"Build an app that helps musicians finish
songs."* — and you're off.

Before generation, an **optional preflight clarification** step can ask you a
**Quick** (5) or **Deep** (10) set of questions to sharpen intent, or you can
**Generate Immediately**. Answers (and anything you skip) feed straight into
the PRD prompt as authoritative intent.

The moment your answers are in, **PRD generation starts in the background** —
and while it runs, Synapse asks you to **choose a visual direction** for the
project from a set of design presets, each with a static token-driven preview
(colors, type, buttons, layout shapes). Synapse **recommends** one based on
what you're building — a music app suggests *Creative Studio*, a CRM suggests
*Enterprise Professional* — but any preset can be chosen, and you can save one
as your **default for future projects** (defaults are preselected next time).
You can also skip and decide later, at the latest when marking the PRD final.

### 2. AI builds the spec, section by section

<img width="100%" alt="PRD generation progress timeline — sections generated wave by wave" src="public/screenshots/tour-spec.png" />

The PRD is generated as structured JSON by a **dependency-graph pipeline**:
the sections run concurrently the moment their inputs are ready — they are
never sequenced just because they appear later in the document. A live
**progress timeline** shows exactly what's happening: sections are grouped into
dependency *waves*, with independent sections rendered as "running
concurrently" groups, and each step shows whether it's waiting on dependencies,
queued for a free slot, or running — alongside the actual Gemini model in use
and elapsed/estimated timing. A failed section can be re-run on its own without
touching the rest of the document.

You get back a structured PRD with vision, target users, core problems,
features (with priority, acceptance criteria, and dependencies), architecture,
metrics, risks, and non-functional requirements. The PRD deliberately stays at
the product-decision level — deep specification (data model, screens, flows,
implementation plan) is generated as the dedicated downstream assets, and the
PRD ends with a "Where the Detail Lives" appendix pointing to them.

That concurrency is **measured, not just claimed**. An **Orchestration
Metrics** dashboard (`/metrics`, linked from Settings and the workspace menu)
records each PRD generation and artifact-bundle run and shows real telemetry:
sequential estimate vs. actual runtime, **parallel speedup** and time saved,
max/average concurrency, critical path, per-section token usage, and estimated
AI cost — with a per-run Gantt timeline that visualizes which agents ran in
parallel. Cost figures are clearly labeled estimates; there's no synthetic
data, so a fresh account shows an empty state until the first real run.

### 3. Refine specific parts of the document

Highlight any passage and improve it without rewriting everything. A
contextual action dialog offers **Clarify / Expand / Specify / Alternative /
Replace**, spawning a threaded branch scoped to just that passage.

- **Branch-based refinement** — iterate on a single span in a focused thread.
- **Consolidation engine** — merge a branch's decisions back into a new
  unified PRD iteration (local or document-wide scope).
- **Touch-first** — the same highlight → action pipeline works with mouse,
  pen, and mobile long-press; the dialog is a floating popover on desktop and
  a safe-area bottom sheet on mobile. On phones, an explicit **Select text to
  edit** mode lets you adjust the native selection to a full phrase before
  tapping **Edit selection** — so the action sheet never fights the iOS
  selection toolbar.

<img width="100%" alt="Refine a passage — Clarify / Expand / Specify / Alternative / Replace dialog and threaded branch" src="public/screenshots/tour-refine.png" />

### 4. Nothing gets lost — every change is versioned

<img width="100%" alt="Version timeline with side-by-side diff comparison" src="public/screenshots/tour-versions.png" />

Every regeneration, consolidation, **and inline edit** becomes a new **spine
version** you can revisit, compare, or build on — edits never overwrite the
previous version in place. Open **Version History** to see each version's change
source (edit, regenerate, section retry, branch merge, restore), **compare** any
version against the current one with a section-aware diff, and **restore** an
earlier version (which appends a new version — history is never deleted, and any
downstream artifacts that fall out of date are flagged). Artifacts carry their
own version history and restore too, and show which PRD version they were
generated from. The History stage is a chronological audit log of every spine
regeneration, edit, restore, branch consolidation, artifact derivation, and
feedback event — with diffs where it matters.

### 5. One finalized PRD powers the entire workspace

<img width="100%" alt="Mark the PRD as final to generate every downstream asset in parallel" src="public/screenshots/tour-assets.png" />

Mark your PRD as final and Synapse generates all the assets you need to build —
in parallel, from that single source of truth. The **Design System Preset**
(Modern SaaS, Enterprise Professional, AI Workspace, Minimal Editorial,
Developer / Technical, Consumer Mobile, Creative Studio, or *Custom / Generate
for me*) you picked during project setup sets the project's visual direction;
if you skipped that step, Synapse asks just before generation. The choice is
stored on the project and steers the **Design System** artifact — and through
it, both the internal mockups and the prompts you copy for external image
tools, so everything stays visually consistent. You can change the visual
direction later from the **Design System** artifact and regenerate it; when its
tokens change, Synapse flags the affected mockups and offers to regenerate them
so they pick up the new direction.

- **Screen Inventory** and **User Flows**
- **Design System**
- **Data Model** schemas with entities, fields, and relationships
- **Implementation Plan** — a consolidated build guide: small milestones, each
  with linked screens/entities, implementation tasks, **copy-ready prompt
  packs** for your coding agent, **quality gates**, validation commands, and a
  definition of done, plus a traceability view connecting milestones →
  screens → data models → prompt packs → gates. (Projects generated before the
  consolidation had separate *Build Plan* and *Developer Prompts* artifacts;
  they're merged into this view automatically — nothing is lost or migrated.)

Two of them (`screen_inventory`, `data_model`) use Gemini JSON mode with explicit
schemas and render as card grids and entity tables rather than raw markdown. Every artifact tracks
**staleness** against the current spine, supports **natural-language
refinement** ("add error states to each screen"), and surfaces **quality
warnings** if the output looks truncated or malformed.

The workspace presents the experience artifacts screen-first: an **Experience**
section holds **User Flows** and **Screens** — a consolidated, screen-centric
view where each screen from the Screen Inventory gets its own detail page with
**Overview / Flow / Mockups** tabs (its inventory spec, every user-flow step
that touches it with the screen highlighted in the journey diagram, and its
mockup). Clicking a screen node in a User Flow jumps straight to that screen's
page, so the working mental model is "I'm working on this screen."

Screens are joined across artifacts by **stable ids**, so you can safely
**edit a screen's name, purpose, intent, priority, and notes** without
detaching its mockups, flow references, or uploaded images — edits are an
overlay; the generated artifact is never rewritten and one click restores it.
The Screens list shows **mockup coverage** ("Mockups: 3 of 12 screens
covered"); uncovered screens get an **Add to mockups** action (generation
stays explicit and cost-labeled — nothing is billed without confirmation), and
a **Generate missing mockups** batch sits behind a confirm. Every screen page
is **deep-linkable** (`?screen=…`), with working browser back/forward. A
lightweight validation panel flags broken or ambiguous references (a flow step
naming a missing screen, a mockup that lost its match, duplicate screen names)
with one-click **relink / pin / ignore** repairs — warnings never block
rendering.

Each artifact is routed to the right model by complexity — Flash for simpler
artifacts, Pro for complex reasoning — and you can override the model **per
artifact** in Settings → **Artifact Generation Models** (the PRD itself routes
per-section). Sensible defaults mean you never have to touch it.

#### Multi-fidelity UI mockups

<img width="100%" alt="UI Mockups are one of the assets generated from the finalized PRD" src="public/screenshots/tour-assets.png" />

Generate UI mockups directly from the finalized PRD with configurable platform
(mobile / desktop), fidelity (wireframe / mid-fi / high-fi), and scope (single
screen / multi-screen / key workflow). Every run is saved as a new version so
you can diff iterations side-by-side. Per-screen images come from one of two
sources (chosen in Settings → **Artifact Generation Models → Mockups**): OpenAI
`gpt-image-2`, or **your own uploads** — the latter shows a generated prompt for
each screen (goal, layout, visual style, expected format) to guide what you
create and upload. If GPT Image is selected without an OpenAI key, Synapse falls
back to the upload sheet rather than failing silently.

The Screen Inventory page also offers a **Copy image prompt** action per screen
for generating a mockup in any external tool. That copied prompt embeds the
**same** Design System Brief the internal mockups use (palette, typography,
spacing, radius, component conventions, accessibility) alongside the screen's
specifics, so externally generated mockups match your project's visual
language instead of drifting.

#### Integrated feedback loop

<img width="100%" alt="Feedback extracted from mockups feeds back into the PRD assets" src="public/screenshots/tour-assets.png" />

Extract structured feedback items from generated mockups. Feedback surfaces as
actionable cards on the PRD stage — applying one spawns a localized branch to
address the critique without regenerating the whole document.

#### Track implementation progress

The Implementation Plan converts into a tracked task checklist — no LLM call,
derived deterministically from the plan. Review and edit the extracted tasks,
**save them to the project**, and a progress checklist appears on the
Implementation Plan: a `done / total` progress bar, a per-task status toggle
(to do → in progress → done), and expandable acceptance criteria. Export the
tasks to **Markdown** or **GitHub issues**; created GitHub issues are linked
back to each task so you can jump straight to them. Progress persists across
refreshes, so Synapse answers "how far along am I?" — not just "what should I
build?".

#### Hand off to a coding agent

Export isn't just a download. The **Export** dialog includes a one-click
**"Copy for coding agent"** preset — an instruction preamble plus the PRD and
the build-relevant artifacts (implementation plan, prompt pack, data model,
design system), ready to paste straight into Claude Code, Cursor, or another
agent. Copy-to-clipboard is available for the PRD and the full bundle too, and
you can still download Markdown, a combined bundle, or structured JSON.

### 6. Everything stays connected

When the product changes, Synapse helps keep the rest of the project aligned.
Artifacts carry source references back to the spine, so staleness is detected
automatically when the PRD moves underneath them — and the History timeline
records the ripple of every change across the workspace.

<img width="100%" alt="Connections graph — the PRD wired to every artifact with up-to-date status" src="public/screenshots/tour-connections.png" />

---

## Safety gate

Every PRD generation path runs through one code-level chokepoint that
classifies the project **before** any section is written (`allowed` /
`allowed_with_restrictions` / `disallowed`). A disallowed idea never runs the
pipeline; it renders a Safety Review and is excluded from all downstream
artifact, mockup, and workspace generation. Classification **fails closed** —
if safety can't be determined, the request is treated as disallowed (genuine
API-key/billing/permission errors still surface on the normal error path).

---

## Data flow

```mermaid
graph TD
    A[Initial Prompt] -->|Optional preflight Q&A| P[Clarified Intent]
    P -->|Safety gate| S{Allowed?}
    A -->|Safety gate| S
    S -->|disallowed| R[Safety Review]
    S -->|allowed| B(Structured PRD Spine)
    B --> C{PRD Canvas}
    C -->|Highlight & ask| D[Threaded Branch]
    D -->|Consolidation| B

    B -->|Mark final| E{Pipeline Stages}
    E -->|Mockups| F[UI Mockup Versions]
    F -->|Extract feedback| D

    E -->|Artifacts| H[7 Core Artifacts]
    E -->|Markup| I[Annotated SVGs]

    H --> J(Screen Inventory)
    H --> K(Data Model)
    H --> L(Design System)
    H --> M(Implementation Plan)
```

## Tech stack

- **Frontend:** React 19, TypeScript, Vite 7, Tailwind CSS 3
- **Backend:** Vercel serverless API routes + MongoDB (for recruiter auth analytics) + Vercel Blob (for owner-only project snapshots)
- **State:** Zustand 5 with debounced `localStorage` persistence; mockup PNGs in IndexedDB
- **LLM:** Google Gemini (default `gemini-3.5-flash`) via direct browser calls with streaming + connection/stream-level retry; OpenAI `gpt-image-2` for mockup image previews
- **Markdown:** `react-markdown` + `remark-gfm` + `rehype-raw`
- **Routing:** React Router v7 (workspace, recruiter portal, admin, the interactive product tour at `/tour` + `/about`, `/privacy`)
- **Icons & animation:** `lucide-react`, `framer-motion`, `@formkit/auto-animate`

The product workspace remains browser-first, while recruiter authentication
and tracking run through API routes backed by MongoDB.

---