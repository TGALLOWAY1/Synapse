# Synapse Redesign — Google Stitch Prompt

## A. Product Understanding

**Synapse** is an AI-native product definition environment that transforms the traditional PRD (Product Requirements Document) from a static text file into a dynamic, spec-driven pipeline. It targets product managers, founders, and product designers who want to go from a raw brain-dump idea to a structured PRD, then cascade that specification into downstream artifacts: UI mockups, screen inventories, data models, component libraries, user flows, implementation roadmaps, prompt packs, and visual annotation boards.

The core workflow is: **Prompt → Structured PRD → Branch/Refine → Mark Final → Generate Mockups & Artifacts → Feedback Loop → Iterate**. It uses Google Gemini as the LLM backbone, stores everything locally via Zustand + localStorage, and renders generated content as rich markdown with specialized type-specific renderers (card grids for screens, entity tables for data models, SVG annotations for markup images).

**The redesign should emphasize:**
- The artifact generation pipeline as the hero experience — the moment where a PRD cascades into 7+ derivative outputs is the product's signature moment
- Visual artifact presentation (mockups, SVG annotations, screen inventories) as portfolio-grade showcases
- The branching/refinement workflow as a sophisticated product thinking tool
- Speed and perceived performance throughout the generation pipeline
- A workspace that feels like a creative studio, not a document editor

## B. UX / Product Issues Found

1. **Flat, minimal homepage** — The project grid (`grid-cols-3` of dark cards) looks like a generic todo app. No hero moment, no visual preview of project contents, no sense of what's inside each project.

2. **Two-route architecture limits depth** — Only `/` and `/p/:projectId` exist. Everything is packed into `ProjectWorkspace.tsx` behind a stage tab bar. No dedicated routes for artifacts, mockups, or individual artifact detail views. This creates a cramped, tab-heavy experience.

3. **Linear pipeline tab bar feels restrictive** — The `PipelineStageBar` (PRD → Mockups → Artifacts → History) forces a linear flow and gates access (disabled tabs until PRD is finalized). This hides the product's most impressive features behind a multi-step unlock.

4. **Content area is narrow and text-heavy** — Main content is constrained to `max-w-2xl mx-auto` on a `bg-neutral-50` panel. For a product generating visual artifacts, mockups, and SVG annotations, the layout wastes horizontal space and buries visual outputs in markdown prose.

5. **No artifact gallery or visual preview** — Generated artifacts (screen inventories, data models, component libraries) appear as expandable accordion cards with text content. No thumbnail previews, no gallery grid, no visual hierarchy distinguishing artifact types.

6. **Mockup generation buried in sub-tab** — The mockup system (with platform/fidelity/scope selectors) is powerful but hidden inside one tab of the workspace. No visual preview cards, no side-by-side comparison hero view.

7. **Markup images are afterthoughts** — SVG annotation artifacts (critique boards, wireframe callouts, flow annotations) appear as a "below the fold" section in the Artifacts tab. These are visually impressive but have no showcase moment.

8. **Branch/refinement UX is clever but cramped** — Text-selection-to-branch is a great concept, but branches are squeezed into a right sidebar (`w-80`) with tiny chat bubbles. The canvas mode exists but feels disconnected.

9. **No visual version history** — The history sidebar shows a timeline of text events. No visual diffs, no before/after artifact comparisons, no timeline with thumbnail snapshots.

10. **Settings modal is the only config surface** — API key and model selection live in a basic modal. No onboarding flow, no workspace preferences, no visual theming.

11. **No empty states that inspire** — Empty states are dashed-border text blocks. For a product that generates rich visual content, empty states should preview what's possible and invite action.

12. **Dark/light theme split is jarring** — The shell is `bg-neutral-900` but the content area switches to `bg-neutral-50`. This creates an inconsistent visual identity rather than a cohesive dark or light theme.

13. **No export/share presentation mode** — Export is a simple modal with download options. No shareable link, no presentation view, no "show this to stakeholders" mode.

## C. Redesign Direction

Synapse should be redesigned as a **premium AI product studio** — a workspace where product ideas become living, visual specifications. The redesign should shift the product identity from "AI document editor" to "product definition lab" by:

1. **Centering the artifact pipeline as the hero** — The dashboard should immediately showcase the generative cascade: PRD → 7 artifacts + mockups + markup annotations. This is the product's wow factor.

2. **Gallery-first artifact presentation** — All generated outputs should appear in a visual gallery with thumbnail previews, type-specific cards, and expand-to-detail interactions. Markup SVGs and mockups should be prominently displayed, not hidden in accordions.

3. **Workspace-centric layout** — Replace the narrow centered column with a full-width workspace that uses panels, sidebars, and split views. Think Figma's canvas feel meets Linear's information density.

4. **Pipeline visibility** — Show the generation pipeline as a visual flow (not just tabs). Users should see their PRD cascading into downstream artifacts in real-time, with status indicators, staleness connections, and dependency lines.

5. **Comparison and versioning as first-class** — Side-by-side artifact comparison, visual version diffs, and branch/merge visualization should be prominent features, not hidden utilities.

6. **Premium visual identity** — Commit to a cohesive dark theme with carefully chosen accent colors, generous spacing, and modern typography. Glassmorphism and backdrop blur used tastefully for depth. Subtle gradients and color-coded artifact type system.

7. **Impressive empty states and onboarding** — Empty states should show example outputs, animated previews, or visual hints of what generation produces. First-run experience should feel magical.

## D. Final Google Stitch Prompt

---

Design a premium AI product studio called **Synapse** — a web application where product managers and founders transform raw product ideas into comprehensive, living specifications with AI-generated downstream artifacts.

**Product concept:** The user starts with a product idea (plain text prompt). Synapse's AI engine generates a structured PRD (Product Requirements Document) with vision, target users, features with priority levels, architecture, risks, and acceptance criteria. From that PRD, the user can generate 7+ downstream artifacts: screen inventories, user flow maps, component libraries, design system specs, data model schemas, implementation roadmaps, and prompt packs. They can also generate multi-fidelity UI mockups (wireframe through high-fidelity, mobile/desktop) and visual SVG annotation boards (critique boards, wireframe callouts, flow annotations with arrows, highlights, and numbered markers). Users refine the PRD through threaded branches — they highlight any text, spawn a discussion branch, and merge decisions back into the main document. Everything is versioned with full history.

**Design the following screens:**

**1. Dashboard / Project Gallery**
A dark-themed dashboard showing all projects as rich visual cards. Each project card should display: the project name, a mini status indicator showing pipeline progress (PRD → Mockups → Artifacts), a thumbnail preview of the most recent generated artifact or mockup, the date, and a subtle artifact count badge. Include a prominent "New Project" CTA with a brief inline prompt input that feels inviting and low-friction. The empty state should show a beautiful illustration or animated preview of what Synapse generates, with example output thumbnails (a mockup, an SVG annotation, a screen inventory card grid) to inspire action. Top bar should have a subtle Synapse wordmark on the left and a minimal settings icon on the right.

**2. Project Workspace — PRD Canvas**
The main workspace for editing and viewing the structured PRD. Layout: full-width dark workspace shell with a left content area (70%) and a right context panel (30%). The left area shows the PRD as a beautifully typeset document with collapsible sections: Vision, Target Users, Core Problem, Features (as cards with priority badges — must/should/could — complexity indicators, and acceptance criteria), Architecture, Risks, and Non-Functional Requirements. Each section should have a subtle hover-to-edit interaction. The right panel has two tabs: "Branches" showing active discussion threads with chat-bubble messages, and "History" showing a visual timeline of changes. At the top, a horizontal pipeline bar shows the current stage (PRD → Mockups → Artifacts → History) with the active stage highlighted in the brand accent color. Include a "Mark as Final" prominent button that visually unlocks the downstream pipeline stages with a satisfying state change.

**3. Project Workspace — Artifact Gallery**
When the user navigates to the Artifacts stage, show a visual gallery grid of all 7 artifact types as cards. Each card should have: a type-specific icon, the artifact name, a generation status indicator (not started / generating with spinner / complete with green check / stale with amber warning), a mini preview of the content (e.g., a tiny card grid for screen inventory, a mini entity diagram for data model, a small component tree for component inventory), and a "Generate" or "Regenerate" CTA. Include a hero "Generate All" button at the top that triggers parallel generation of all artifacts with a beautiful progress visualization showing each artifact completing in real-time. Below the core artifacts grid, show a "Markup Images" section with 5 visual annotation types (screenshot annotation, critique board, wireframe callout, flow annotation, design feedback board) as smaller cards with SVG preview thumbnails. When an artifact is expanded, show it in a detail panel or modal with the full rendered content, version history, a "Refine with AI" input, and staleness tracking showing which PRD sections it derives from.

**4. Artifact Detail / Comparison View**
A split-pane view for comparing two versions of any artifact side by side. Left pane shows Version A, right pane shows Version B, with a diff overlay highlighting changes. Include version selector dropdowns at the top of each pane. This should also work for mockup comparisons. The detail view should have action buttons for: Refine (opens an AI instruction input), Extract Feedback (creates structured feedback that routes back to the PRD), Export (download as markdown or JSON), and View Provenance (shows which PRD sections generated this artifact).

**5. Mockup Studio**
A dedicated workspace for generating and reviewing UI mockups. Top section: configuration panel with visual selectors for Platform (Desktop / Mobile / Responsive — shown as device silhouettes), Fidelity (Low-fi / Mid-fi / High-fi — shown as progressive detail thumbnails), and Scope (Single Screen / Multi-Screen / Key Workflow). Below: a gallery of generated mockups as large preview cards. Each mockup card shows the rendered content prominently with version count badge, expand button, comparison button, and "Extract Feedback" action. When expanded, the mockup fills most of the viewport with the configuration panel collapsed to a minimal top bar.

**6. Branch / Refinement Canvas**
When the user highlights text in the PRD and creates a branch, show a focused refinement view. Split layout: left side shows the PRD context with the highlighted anchor text emphasized (glowing highlight or colored background), right side shows the discussion thread as a clean chat interface. The thread has user messages (brand-colored bubbles, right-aligned) and AI responses (neutral bubbles, left-aligned). Include quick-intent tags above the input (Clarify, Expand, Specify, Alternative, Replace) that pre-fill the instruction. At the bottom, a "Consolidate & Merge" button that shows a patch preview before applying changes back to the main PRD.

**Visual style and mood:**
- Dark theme foundation: deep neutral-900 background with neutral-800 cards and panels
- Brand accent: electric indigo (indigo-500) for primary actions, active states, and highlights
- Secondary accents: emerald for success/complete, amber for warnings/stale, rose for errors
- Artifact type color coding: each of the 7 artifact types gets a unique subtle color (purple for screen inventory, blue for data model, teal for component library, orange for implementation plan, etc.)
- Typography: clean sans-serif, generous line-height, clear hierarchy with size and weight contrast
- Cards: subtle border (white/10 opacity), slight background elevation, hover state with border-accent glow
- Glassmorphism on modals and overlays: backdrop-blur with semi-transparent backgrounds
- Spacing: generous padding (16-48px), clear section separation, no visual clutter
- Microinteractions: smooth transitions on hover, expand/collapse animations, progress indicators during generation
- Empty states: illustrated or icon-based, inviting, showing example outputs
- Overall energy: premium SaaS meets creative studio — like if Linear, Figma, and Vercel had a product spec tool. Confident, modern, artifact-centric, visually memorable. Should look impressive in a portfolio or recruiter demo.

The design should feel fast, purposeful, and powerful — a serious tool for product thinkers who want AI to accelerate their specification process, with every generated artifact displayed beautifully enough to share directly with stakeholders.

---
