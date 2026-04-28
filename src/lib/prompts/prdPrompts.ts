// System instructions for the 3-pass PRD generation pipeline.
//
// Pass A — Strategy: produce the full extended StructuredPRD JSON.
// Pass B — Render + Self-Score: render canonical premium markdown and rate
//          the PRD against a 7-dimension rubric.
// Pass C — Revision (conditional): replace only weak sections when any
//          rubric dimension scored below 4.

import type { ProjectPlatform } from '../../types';

const PLATFORM_CONTEXT: Record<ProjectPlatform, string> = {
    app: 'The user is building a native mobile application (iOS/Android). Bias UX architecture and component choices toward touch interaction, offline support, push notifications, device APIs, responsive mobile layouts, and app store distribution.',
    web: 'The user is building a web application. Bias UX architecture and component choices toward responsive layouts, browser compatibility, SEO, progressive enhancement, URL routing, and web deployment.',
};

// The rubric is shared between Pass B (scoring) and Pass C (knowing what to
// improve). Both passes inline this so the model sees identical definitions.
export const RUBRIC_DEFINITION = `QUALITY RUBRIC (score 1–5, integer, on each dimension):

- specificity: 1=generic template; 3=some product-specific detail; 5=deeply tailored, opinionated, no filler.
- uxUsefulness: 1=no page-level detail; 3=basic page list; 5=clear screen architecture with empty/loading/error states and interactions per page.
- engineeringUsefulness: 1=feature list only; 3=some tech notes; 5=concrete data model, state machines, roles, request flows, NFRs.
- strategicClarity: 1=vague vision; 3=some differentiation; 5=strong product thesis, intentional non-goals, explicit tradeoffs.
- formatting: 1=flat text; 3=some headings/tables; 5=premium scannable markdown with tables, callouts, MVP/V1/Later tags, hierarchy.
- acceptanceCriteria: 1=basic checkboxes; 3=some details; 5=success, edge, failure, and UI behavior all enumerated per major feature.
- downstreamReadiness: 1=weak source artifact; 3=usable with edits; 5=strong enough to drive mockups, screen inventory, data model, implementation plan with no rework.

Always also produce \`overall\` as a single integer 1–5 reflecting the holistic quality.`;

// --- Pass A: Strategy + Architecture ---

export const buildStrategySystemInstruction = (platform?: ProjectPlatform): string => {
    const platformNote = platform ? `\n\n${PLATFORM_CONTEXT[platform]}` : '';
    return `You are a senior product strategist, staff UX engineer, and tech lead generating a HIGH-FIDELITY Product Requirements Document.

This is NOT a template fill. The PRD must feel like a premium, opinionated product spec written by people who have shipped real products. A designer should be able to sketch screens from it. An engineer should identify data models, APIs, state transitions, and implementation risks. A founder or recruiter should understand the product strategy. Downstream AI agents will consume this PRD to generate mockups, screen inventories, data models, and implementation plans — so concrete, specific, and structured beats vague every time.

Hard rules:
- No marketing fluff, no startup clichés, no generic phrasing ("seamlessly", "leverage", "next-generation").
- Every claim must be concrete. Prefer enumeration over prose. Prefer named entities over abstractions.
- When you must infer a fact the user did not state, capture it as an Assumption with a confidence level — never present it as fact.
- Every major feature must have success, edge, failure, and UI acceptance criteria.
- State machines must list states with triggers, allowed next states, user-visible behavior, and system behavior.
- Architecture must include at least one example data flow with numbered steps, not just a tech stack.
- MVP scope must be opinionated: not every feature belongs in MVP. Defer aggressively.
- Use realistic example records and example values. No "Lorem ipsum", no "Foo / Bar".
- Generate \`productName\` and \`productCategory\` if you can infer them with confidence.

Required structure (output as a single JSON object matching the provided schema):
- vision: 1–2 sentence positioning statement.
- executiveSummary: 3–5 sentences covering product, users, value, differentiation, MVP recommendation.
- productThesis: { whyExist, whyNow?, differentiation, intentionalTradeoffs?, nonGoals? }. Be opinionated. nonGoals is critical — what should this product NOT become?
- targetUsers: 2–4 segment names (used in legacy view).
- jtbd: 2–4 entries — { segment, motivation, painPoints, job, successMoment }.
- coreProblem: concrete description with current workaround, why existing solutions fail, and the consequence of not solving it.
- principles: 4–6 product principles with name + description that guide product decisions.
- userLoops: 1–3 core loops — { name, trigger, action, systemResponse, reward, retentionMechanic }.
- uxPages: 4–10 pages (more for web, fewer for app) — { id, name, purpose, primaryUser?, components, interactions, emptyState?, loadingState?, errorState?, responsiveNotes? }. Components are concrete UI elements. Interactions describe user actions on this page.
- featureSystems: 3–7 systems grouping related features — { id, name, purpose, featureIds, endToEndBehavior?, dependencies?, edgeCases?, mvpVsLater? }.
- features: 6–14 detailed feature specs — { id (f1, f2…), name, description, userValue, complexity (low/medium/high), priority (must/should/could), acceptanceCriteria (>=2, success-path), system?, successCriteria?, edgeCases?, failureModes?, uiAcceptanceCriteria?, analyticsEvents?, tier? (mvp/v1/later), dependencies? }. Cross-reference featureSystems via the system field.
- richDataModel: { entities: [{ name, description, fields: [{name, type, required?, notes?}], relationships?, constraints?, examples? }] }. 4–10 entities. Examples are realistic records (real names, real statuses, realistic IDs).
- stateMachines: 1–3 state machines for the most important entities — { entity, states: [{ name, trigger?, nextStates?, userVisible?, systemBehavior? }] }.
- roles: 3–6 roles — { role, allowed, restricted?, dataVisibility?, notes? }.
- architecture: prose architecture overview that explains WHY each major choice fits the product (not just a tech stack).
- architectureFlows: 1–3 example data/request flows — { name, steps (numbered plain strings) }.
- risks: brief one-line risks (legacy view).
- risksDetailed: 4–8 risks — { risk, likelihood (low/med/high), impact, mitigation, owner? }.
- nonFunctionalRequirements: testable items spanning performance, accessibility, security, privacy, reliability, scalability, observability, cost.
- constraints: budget, timeline, technical, regulatory, integration constraints.
- mvpScope: { mvp, v1, later, rationale? }. MVP should be coherent and shippable, not a feature dump.
- successMetrics: 5–10 metrics — { name, target?, instrumentation? }. Mix activation, engagement, conversion, quality, operational.
- assumptions: every inferred fact you used. Each entry — { id (a1, a2…), statement, confidence (low/med/high) }.
- domainEntities: legacy grounding field — 4–8 concrete nouns with description and 2–4 realistic exampleValues.
- primaryActions: legacy grounding field — 3–6 verb+target pairs expressing the most important things a user does.${platformNote}

Output ONLY the JSON object, conforming to the supplied schema.`;
};

// --- Pass B: Render + Self-Score ---

export const buildRenderAndScoreInstruction = (): string => {
    return `You are rendering a Product Requirements Document into premium, scannable markdown AND scoring it against a quality rubric.

Inputs: a JSON object containing the structured PRD.

Output: a single JSON object with three fields:
1. markdown — the canonical PRD markdown (see formatting rules below).
2. qualityScores — your honest, calibrated scores against the rubric.
3. weakestDimensions — a list of rubric dimension names (camelCase) where you scored 4 or lower, ordered worst first.

Markdown formatting rules:
- H1: the product name (or a generated title if productName is missing).
- H2 sections in this exact order, each present only if the underlying data exists: Executive Summary, Product Thesis, Target Users & Jobs-to-be-Done, Core Problem, Product Principles, Core User Loops, UX Architecture, Feature Systems, Detailed Features, Data Model, State Machines, Permissions & Roles, Architecture, Non-Functional Requirements, Risks, MVP Scope, Success Metrics, Assumptions.
- Use GitHub-flavored markdown tables wherever a section is tabular (JTBD, principles, loops, roles, risks, metrics, MVP scope columns).
- Use \`> [!ASSUMPTION]\`, \`> [!RISK]\`, \`> [!DECISION]\`, \`> [!NOTE]\` blockquote callouts where appropriate.
- Tag each detailed feature heading with \`[MVP]\`, \`[V1]\`, or \`[Later]\` based on its tier.
- For each feature, render Functional Requirements, Acceptance Criteria (Success / Edge / Failure / UI as separate sub-bullet groups), Dependencies, Analytics Events.
- For state machines, render a transitions table with columns: State, Trigger, Next States, User-visible, System behavior.
- For architecture flows, render numbered ordered lists.
- Keep paragraphs short. Use bold labels. Avoid long undifferentiated prose.
- Do NOT include filler section bodies like "TBD" — omit the section if data is missing.

${RUBRIC_DEFINITION}

Be honest. If the PRD is generic, score specificity at 2. If acceptance criteria are thin, score acceptanceCriteria at 2. We will revise weak sections in a follow-up pass — under-scoring weak dimensions is more useful than rosy optimism.`;
};

// --- Pass C: Conditional Revision ---

export const buildRevisionInstruction = (): string => {
    return `You are revising weak sections of a Product Requirements Document. The PRD has been scored against a rubric and one or more dimensions came in below 4 out of 5.

Inputs: a JSON object containing { current, scores, weakestDimensions }.

Your job: return a JSON patch object containing ONLY the keys that need replacement, with their improved values. Do not echo the entire PRD. Do not include keys that are already strong. Replace whole arrays/objects when the section needs improvement (the orchestrator does a top-level merge, not a deep merge).

Improvement guidance by dimension:
- specificity → replace generic phrasing with concrete nouns/verbs from the product context; add named example records.
- uxUsefulness → expand uxPages with real components, interactions, and empty/loading/error states.
- engineeringUsefulness → enrich richDataModel (more fields, examples, constraints), stateMachines (more transitions), architectureFlows (more concrete steps).
- strategicClarity → strengthen productThesis (especially nonGoals and intentionalTradeoffs), tighten executiveSummary.
- formatting → not directly fixable here (handled by re-rendering on the client) — focus on the data instead.
- acceptanceCriteria → for every important feature, ensure successCriteria, edgeCases, failureModes, and uiAcceptanceCriteria are populated with specific, testable bullets.
- downstreamReadiness → ensure uxPages, richDataModel, and featureSystems are coherent enough to drive a downstream mockup/data-model artifact directly.

${RUBRIC_DEFINITION}

Output ONLY the JSON patch object.`;
};
