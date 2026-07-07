// Shared prompt fragments for PRD generation. The live PRD path is the
// progressive section pipeline (prdSectionPrompts.ts), which composes these
// fragments into every section preamble. Markdown is rendered
// deterministically on the client from the structured JSON.

import { renderInPromptSafetyOverride } from '../safety/safetyPolicy';

// Highest-priority safety instruction. Placed AHEAD of all formatting and
// rubric instructions so it takes precedence. This is defense-in-depth — the
// authoritative guardrail is the code-level classifier in
// src/lib/safety/classifyProjectSafety.ts, which hard-stops disallowed
// requests before any section prompt runs. This block ensures the model never
// fills template sections with refusal text if a disallowed request somehow
// reaches generation. Rendered from the single policy source in
// src/lib/safety/safetyPolicy.ts so the capability list can never drift from
// the classifier's again.
export const SAFETY_OVERRIDE = renderInPromptSafetyOverride();

// Global prompt contract. Augments (never replaces) the per-prompt
// instructions to keep tone, rigor, and terminology consistent across every
// generation in the system. Referenced via ${PROMPT_CONTRACT}.
export const PROMPT_CONTRACT = `OPERATING CONTRACT — these principles are binding for every part of your output:
- Use formal, professional, implementation-ready language.
- Do not use subjective or stylistic descriptors, marketing language, or hype.
- Do not hedge. Prohibited phrasings include "you could", "might be", "a good option is", and "something like". State definitive decisions, or state an explicit assumption when information is missing.
- Justify every technical recommendation with concrete reasoning — scalability, maintainability, ecosystem maturity, or performance — not adjectives.
- Prefer widely adopted, stable technologies unless the input specifies otherwise.
- Produce no filler and no redundant explanation. Be explicit and structured.
- Use consistent terminology throughout, and reuse the entities, features, and names already defined elsewhere in this product specification.`;

// Quality bar appended to the strategy system instruction. Phrased as
// targets the model should aim for in its first (and only) output.
// The PRD is the product DECISION document: it must make every product
// decision crisp and unambiguous, and must NOT contain the detailed
// specifications (schemas, state machines, per-screen UI specs, tracking
// plans) that the dedicated downstream artifacts own.
export const RUBRIC_DEFINITION = `QUALITY BAR — this is a hard requirement, not guidance. Your output is judged on these dimensions and must reach 5/5 on each:

- specificity: 1=generic template; 3=some product-specific detail; 5=deeply tailored, opinionated, no filler.
- uxUsefulness: 1=no screen-level signal; 3=basic page list; 5=every screen's name, purpose, and key content are unambiguous enough for the dedicated Screen Inventory and Design System artifacts to specify the full UI without guessing. Per-screen component architecture, interaction specs, and state matrices do NOT belong in the PRD.
- engineeringUsefulness: 1=feature list only; 3=some tech notes; 5=architecture direction, roles, NFRs, and constraints decided crisply enough for the dedicated Data Model and Implementation Plan artifacts to be derived with no rework. Database schemas, state machines, and request-flow specifications do NOT belong in the PRD.
- strategicClarity: 1=vague vision; 3=some differentiation; 5=strong product thesis, intentional non-goals, explicit tradeoffs.
- formatting: handled deterministically by the client renderer — focus on populating the structured fields richly.
- acceptanceCriteria: 1=basic checkboxes; 3=some details; 5=success, edge, and failure behavior enumerated per major feature.
- downstreamReadiness: 1=weak source artifact; 3=usable with edits; 5=every product decision is stated and unambiguous, so the dedicated downstream artifacts (screen inventory, user flows, data model, design system, implementation plan) can be generated with no rework — decisions live in the PRD, detail lives in those artifacts.`;
