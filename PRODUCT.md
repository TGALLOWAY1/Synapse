# PRODUCT.md — Synapse

> Product truth for design work. Drafted from the codebase, architecture docs,
> and the 2026-08-04 design critique; refine freely — this file is authority
> for *what the product is*, DESIGN.md is authority for *how it looks*.

## What Synapse is

An AI-native product-definition environment: a plain-language idea goes in;
a structured PRD, UI mockups, screen inventory, data model, implementation
plan, decision record, and version history come out — connected, versioned,
and traceable. Tagline: **"From plain-language to product blueprint."**

## Who it's for

- **Product managers** turning fuzzy ideas into reviewable specs.
- **Founders / solo builders** who need a blueprint good enough to hand to a
  coding agent ("Copy next prompt" is a first-class path).
- **Designers** using the screen inventory, mockups, and design-system
  artifacts as a starting point.

Assume PM-level fluency ("PRD", "user story") but **not** Synapse-internal
vocabulary ("prompt packs", "quality gates", "spine") — internal terms must be
glossed where they surface.

## Surfaces and their modes

| Surface | Mode | Success looks like |
|---|---|---|
| HomePage prompt screen (`/`) | Persuade → Operate handoff | Visitor types an idea and starts a generation within a minute |
| Workspace (`/p/:projectId`) | **Operate** | Task completion: refine PRD, confirm decisions, generate artifacts, export |
| Interactive tour (`/tour`, `/about`) | Persuade | Visitor understands the seven-beat story and starts |
| Demo + gallery (showcase) | Persuade | Evaluator sees the product **on its best day** — never a config-warning state |
| Recruiter portal (`/admin/recruiters`) | Operate | Separate sub-product; excluded from product design work |

## Product character

- **Honesty is the brand.** Real progress percentages, truthful waiting
  states, humble assumption-confirmation ("Synapse made these assumptions —
  confirm the ones that are right"), reassuring failure copy. Never fake
  progress, never oversell state.
- **Evidence over vibes.** The Decision Center voice ("Replace belief with
  evidence") is the product's intellectual character; visual design should
  match that confidence.
- **The connection metaphor.** Synapse = things wired together. The
  dependency graph and tour finale visualize it; daily surfaces should echo
  it rather than hide it.
- **User authority.** Versions append, never mutate; model output is never
  presented as user-confirmed. Design must preserve the visible distinction.

## Constraints that shape design

- Local-first SPA; BYO API keys (Gemini for text; OpenAI optional for
  images). Key-less fallbacks exist and must be designed as first-class
  states, not error walls.
- Long LLM waits (30–90s) are core moments, not edge cases.
- Legacy localStorage data may lack any newer field — optional stays optional.
- Showcase projects are read-only via one capability policy.
