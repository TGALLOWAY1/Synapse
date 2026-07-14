import type { ProjectPlatform, StructuredPRD } from '../../types';
import type { SectionId } from '../schemas/prdSchemas';
import { RUBRIC_DEFINITION, PROMPT_CONTRACT, SAFETY_OVERRIDE } from './prdPrompts';

export type SectionPromptContext = {
    idea: string;
    platform?: ProjectPlatform;
    upstream: Partial<StructuredPRD>;
    /**
     * The name the user gave the project when creating it. When present and not
     * a generic placeholder, it is treated as the authoritative product name so
     * the generated PRD (and every downstream artifact/mockup) uses the name the
     * user chose rather than one the model invents. Only `product_basics`
     * consumes it (it owns `productName`).
     */
    projectName?: string;
};

// Generic project names users type to get past the required-name field carry no
// product intent — "untitled", "test", "my app", "new project", etc. When the
// name looks like one of these, we don't force it onto the PRD as the product
// name; the model is free to coin a fitting one instead.
const GENERIC_PROJECT_NAMES = new Set([
    'untitled', 'untitled project', 'new project', 'project', 'my project',
    'test', 'test project', 'demo', 'example', 'app', 'my app', 'new app',
    'website', 'my website', 'web app', 'prototype', 'mvp', 'draft', 'temp',
]);

const isMeaningfulProjectName = (name: string | undefined): name is string => {
    const trimmed = name?.trim();
    if (!trimmed) return false;
    return !GENERIC_PROJECT_NAMES.has(trimmed.toLowerCase());
};

const PLATFORM_NOTE: Record<ProjectPlatform, string> = {
    app: 'Target platform: native mobile application (iOS/Android). Bias toward touch interaction, offline operation, push notifications, and device APIs.',
    web: 'Target platform: web application. Bias toward responsive layouts, browser APIs, SEO, and URL routing.',
};

const SHARED_PREAMBLE = `${SAFETY_OVERRIDE}

You are a senior product strategist and tech lead generating one section of a structured working PRD as JSON. Output ONLY the JSON object matching the provided schema — no markdown, no commentary, no preamble, no extra fields, and no conversational language. Be concrete and implementation-useful without manufacturing certainty. Treat product intent the user did not provide as a working proposal, never as user-confirmed fact. Do not silently expand scope to make the document look complete.

${PROMPT_CONTRACT}

${RUBRIC_DEFINITION}`;

// Preamble for RETIRED sections (legacy single-section retry only). Omits
// RUBRIC_DEFINITION: its lean-PRD rules ("database schemas, state machines …
// do NOT belong in the PRD") would directly contradict these sections' own
// asks (richDataModel / stateMachines / implementationPlan) and could thin or
// empty the regenerated slice. A legacy retry must reproduce full detail.
const RETIRED_SECTION_PREAMBLE = `${SAFETY_OVERRIDE}

You are a senior product strategist and tech lead regenerating one section of an existing full-detail structured working PRD as JSON. Output ONLY the JSON object matching the provided schema — no markdown, no commentary, no preamble, no extra fields, and no conversational language. Be concrete and implementation-useful without manufacturing certainty or silently expanding scope. Produce the complete level of detail this section's schema asks for.

${PROMPT_CONTRACT}`;

const UNAVAILABLE = '<unavailable — infer conservatively and flag uncertainties as assumptions>';

// Serialize a subset of the upstream PRD as compact JSON. Returns the
// UNAVAILABLE sentinel when the requested field is not populated.
const pick = (upstream: Partial<StructuredPRD>, ...keys: (keyof StructuredPRD)[]): string => {
    const slice: Partial<StructuredPRD> = {};
    for (const key of keys) {
        if (upstream[key] !== undefined) {
            (slice as Record<string, unknown>)[key] = upstream[key];
        }
    }
    return Object.keys(slice).length ? JSON.stringify(slice) : UNAVAILABLE;
};

const missingNote = (sectionName: string): string =>
    `\nNote: ${sectionName} data was unavailable — make conservative inferences and flag anything uncertain as an Assumption.\n`;

type SectionPrompt = { system: string; user: string };

const builders: Record<SectionId, (ctx: SectionPromptContext) => SectionPrompt> = {
    product_basics: (ctx) => {
        const named = isMeaningfulProjectName(ctx.projectName);
        const nameDirective = named
            ? `\n\nThe user named this product "${ctx.projectName!.trim()}". Use this exact name as the productName — it is the authoritative product name. Do NOT invent a different one. (Only override it if it is clearly an offensive or unusable string.)`
            : '';
        const productNameInstruction = named
            ? `productName (string — use the user's product name "${ctx.projectName!.trim()}" verbatim)`
            : 'productName (string)';
        return {
            system: `${SHARED_PREAMBLE}

You are generating the product_basics slice: productName, productCategory, executiveSummary, vision, targetUsers, coreProblem.
${ctx.platform ? PLATFORM_NOTE[ctx.platform] : ''}`,
            user: `Product idea:\n${ctx.idea}${nameDirective}

Return JSON with: ${productNameInstruction}, productCategory (short label e.g. "B2C Marketplace"), executiveSummary (2–3 sentences), vision (1 aspirational sentence), targetUsers (3–5 specific user types as strings), coreProblem (the core pain solved — state the user's current workaround, why existing solutions fail, and the consequence of leaving it unsolved).`,
        };
    },

    product_thesis: (ctx) => {
        const basics = pick(ctx.upstream, 'vision', 'coreProblem', 'targetUsers');
        const note = basics === UNAVAILABLE ? missingNote('product_basics') : '';
        return {
            system: `${SHARED_PREAMBLE}

You are generating the product_thesis slice: productThesis, principles, jtbd.
${ctx.platform ? PLATFORM_NOTE[ctx.platform] : ''}`,
            user: `${note}Product idea:\n${ctx.idea}

Context from product_basics: ${basics}

Return JSON with:
- productThesis: { whyExist, whyNow, differentiation, intentionalTradeoffs (array), nonGoals (array) } — nonGoals is critical: state explicitly what this product must NOT become.
- principles: array of { name, description } — 3–5 design/product principles. Each principle must be able to guide a concrete product decision; do not state platitudes.
- jtbd: array of { segment, motivation, painPoints (array), job, successMoment } — 2–4 jobs-to-be-done`,
        };
    },

    grounding: (ctx) => {
        const basics = pick(ctx.upstream, 'vision', 'coreProblem', 'features');
        const note = basics === UNAVAILABLE ? missingNote('product_basics') : '';
        return {
            system: `${SHARED_PREAMBLE}

You are generating the grounding slice: domainEntities, primaryActions. These are used by the mockup generator to populate screens with realistic data.
${ctx.platform ? PLATFORM_NOTE[ctx.platform] : ''}`,
            user: `${note}Product idea:\n${ctx.idea}

Context: ${basics}

Return JSON with:
- domainEntities: array of { name, description, exampleValues (3–5 realistic examples) } — 4–8 core domain objects. Example values must be plausible real-world names, statuses, and IDs; never placeholders such as Foo/Bar or Lorem ipsum.
- primaryActions: array of { verb, target } — 6–12 key user actions (e.g. { verb: "Create", target: "listing" })`,
        };
    },

    features: (ctx) => {
        const basics = pick(ctx.upstream, 'vision', 'coreProblem', 'targetUsers');
        const thesis = pick(ctx.upstream, 'productThesis', 'jtbd');
        const hasThesis = thesis !== UNAVAILABLE;
        const note = !hasThesis ? missingNote('product_thesis') : '';
        return {
            system: `${SHARED_PREAMBLE}

You are generating the features slice: features, featureSystems. This is the most consequential section and a working scope proposal, not an approved backlog. Prefer the smallest coherent feature set that achieves the stated outcome. Every feature must trace to the core problem or a stated job; omit plausible extras that do not earn their implementation cost. Every feature and system proposal must include reasoning or a stated constraint that justifies it (user value, dependency, or scope rationale).
${ctx.platform ? PLATFORM_NOTE[ctx.platform] : ''}`,
            user: `${note}Product idea:\n${ctx.idea}

Product basics: ${basics}
${hasThesis ? `Product thesis: ${thesis}` : ''}

Return JSON with:
- features: array of 3–8 necessary features (never invent features to hit the range), each: { id (f1, f2…), name, description, userValue, complexity (low/medium/high), priority (must/should/could), acceptanceCriteria (≥2 success-path checks), system?, successCriteria?, edgeCases?, failureModes?, tier? (mvp/v1/later), dependencies? }
- featureSystems: array of 2–4 system groups, each: { id (s1…), name, purpose, featureIds, endToEndBehavior, dependencies?, edgeCases?, mvpVsLater? }

For every must- and should-priority feature, populate successCriteria, edgeCases, and failureModes — treat these as expected, not optional. Stay at the product-requirement level: do NOT specify UI acceptance details or analytics/tracking events — the dedicated Screen Inventory and downstream artifacts own that detail.`,
        };
    },

    // ── RETIRED — legacy single-section retry only (see RETIRED_PRD_SECTIONS).
    // The data_model artifact owns this detail now. Do NOT extend this builder
    // or re-add the section to DEFAULT_PRD_SECTIONS.
    data_model: (ctx) => {
        const features = pick(ctx.upstream, 'features', 'featureSystems');
        const grounding = pick(ctx.upstream, 'domainEntities', 'primaryActions');
        const hasFeatures = features !== UNAVAILABLE;
        const note = !hasFeatures ? missingNote('features') : '';
        return {
            system: `${RETIRED_SECTION_PREAMBLE}

You are generating the data_model slice: richDataModel, stateMachines.
${ctx.platform ? PLATFORM_NOTE[ctx.platform] : ''}`,
            user: `${note}Product idea:\n${ctx.idea}

${hasFeatures ? `Features: ${features}` : ''}
Grounding entities: ${grounding}

Return JSON with:
- richDataModel: { entities: array of { name, description, fields (array of { name, type, required, notes? }), relationships?, constraints?, examples? } } — 4–8 entities. Examples must be realistic records using real-world names, statuses, and IDs.
- stateMachines: array of { entity, states: array of { name, trigger?, nextStates?, userVisible?: string[], systemBehavior?: string[] } } — for 2–3 stateful entities. Provide trigger and nextStates for every non-terminal state. userVisible and systemBehavior are arrays of 1–5 distinct short sentences (≤ 140 chars each); never one paragraph, never repeat the same sentence.`,
        };
    },

    ux_loops: (ctx) => {
        const features = pick(ctx.upstream, 'features');
        const thesis = pick(ctx.upstream, 'productThesis', 'jtbd');
        const hasFeatures = features !== UNAVAILABLE;
        const note = !hasFeatures ? missingNote('features') : '';
        return {
            system: `${SHARED_PREAMBLE}

You are generating the ux_loops slice: userLoops, uxPages, roles.
${ctx.platform ? PLATFORM_NOTE[ctx.platform] : ''}`,
            user: `${note}Product idea:\n${ctx.idea}

${hasFeatures ? `Features: ${features}` : ''}
${thesis !== UNAVAILABLE ? `Product thesis: ${thesis}` : ''}

Return JSON with:
- userLoops: array of 2–4 retention loops, each: { name, trigger, action, systemResponse, reward, retentionMechanic }
- uxPages: array of 5–10 screens, each: { id (pg1…), name, purpose, primaryUser?, components (3–6 short items — the key content and primary actions the user sees on this screen) }. Stay at the decision level: do NOT write component-by-component UI specs, interaction lists, or empty/loading/error state definitions — the dedicated Screen Inventory artifact owns that detail.
- roles: array of 3–6 user roles, each: { role, allowed (array), restricted?, dataVisibility?, notes? }.
  Permissions & Roles describe **business capabilities a user has inside the product** — the things they can do — NOT how the software is built or secured. Write them the way a product manager would.
  • allowed: 5–15 concise, capability-based actions phrased "verb + product object" — e.g. "Create workouts", "Invite team members", "View analytics", "Approve requests", "Export reports". Summarize responsibilities; do not enumerate every action.
  • restricted: OPTIONAL and small (3–10 items) — include ONLY when a limit communicates meaningful product behavior (e.g. "Cannot modify coach-created programs", "Cannot view other clients"). Omit the field entirely when there is nothing product-meaningful to say. Never pad it with obvious or exhaustive negatives.
  Every permission must answer "is this something a user can do inside the product?". NEVER include backend, infrastructure, database, operating-system, networking, or security-implementation details (e.g. SSL/TLS, JWT/OAuth, SQLite/Postgres/Redis, caches, migrations, telemetry, encryption keys, API endpoints/timeouts, rate limiting, feature flags, sandboxes, Kubernetes/Docker, diagnostic endpoints, server configuration). Those belong in architecture or security docs, not here. Support richer models (role hierarchies, org-level access, subscription tiers) when the product needs them, but keep every item business-oriented.`,
        };
    },

    architecture: (ctx) => {
        const features = pick(ctx.upstream, 'features', 'featureSystems');
        const grounding = pick(ctx.upstream, 'domainEntities');
        const hasFeatures = features !== UNAVAILABLE;
        const note = !hasFeatures ? missingNote('features') : '';
        return {
            system: `${SHARED_PREAMBLE}

You are generating the architecture slice: architecture (narrative), architectureFlows, nonFunctionalRequirements, constraints. Every technology and architectural decision must include reasoning grounded in scalability, maintainability, ecosystem maturity, or performance — never stylistic descriptors. Prefer widely adopted, stable technologies unless the product requires otherwise. State decisions, not designs — detailed schemas, entity models, and step-by-step request specifications belong to the dedicated Data Model and Implementation Plan artifacts.
${ctx.platform ? PLATFORM_NOTE[ctx.platform] : ''}`,
            user: `${note}Product idea:\n${ctx.idea}

${hasFeatures ? `Features: ${features}` : ''}
${grounding !== UNAVAILABLE ? `Domain entities: ${grounding}` : ''}

Return JSON with:
- architecture: string — 2–3 paragraph decision narrative: the chosen stack and why, the major components and their responsibilities, key integration points, and significant build-vs-buy decisions
- architectureFlows: array of { name, steps (array of strings) } — the 2–3 highest-risk system flows only (e.g. auth, the core data write), each an ordered numbered sequence of at most 7 decision-level steps
- nonFunctionalRequirements: array of strings — testable requirements spanning performance, accessibility, security, privacy, reliability, scalability, observability, and cost
- constraints: array of strings — budget, timeline, technical, regulatory, or integration constraints`,
        };
    },

    quality_risks: (ctx) => {
        const features = pick(ctx.upstream, 'features');
        const arch = pick(ctx.upstream, 'architecture', 'architectureFlows');
        const hasArch = arch !== UNAVAILABLE;
        const note = !hasArch ? missingNote('architecture') : '';
        return {
            system: `${SHARED_PREAMBLE}

You are generating the quality_risks slice: risks, risksDetailed, assumptions.
${ctx.platform ? PLATFORM_NOTE[ctx.platform] : ''}`,
            user: `${note}Product idea:\n${ctx.idea}

${features !== UNAVAILABLE ? `Features: ${features}` : ''}
${hasArch ? `Architecture: ${arch}` : ''}

Return JSON with:
- risks: array of 4–8 risk strings (summary level)
- risksDetailed: array of { risk, likelihood (low/med/high), impact, mitigation, owner? }
- assumptions: array of { id (a1…), statement, confidence (low/med/high), materiality (blocking/high/normal/low), whyItMatters, affectedPrdSections (array) } — 4–8 product assumptions. Record every consequential fact you inferred rather than were told. Confidence means plausibility; materiality means how much the product would change if the assumption is wrong. Never use confidence as a proxy for importance. Use blocking sparingly for an inference that prevents credible scope, high for one that could materially change the primary user/outcome/core behavior, normal for meaningful design choices, and low for reversible detail. affectedPrdSections must use recognizable PRD section names.`,
        };
    },

    metrics_scope: (ctx) => {
        const features = pick(ctx.upstream, 'features', 'featureSystems');
        const note = features === UNAVAILABLE ? missingNote('features') : '';
        return {
            system: `${SHARED_PREAMBLE}

You are generating the metrics_scope slice: mvpScope, successMetrics.
${ctx.platform ? PLATFORM_NOTE[ctx.platform] : ''}`,
            user: `${note}Product idea:\n${ctx.idea}

${features !== UNAVAILABLE ? `Features: ${features}` : ''}

Return JSON with:
- mvpScope: { mvp (array of feature names/descriptions), v1 (array), later (array), rationale? } — the MVP must be opinionated, coherent, and shippable; defer aggressively rather than listing every feature.
- successMetrics: array of { name, target? } — 5–8 measurable product success criteria spanning activation, engagement, conversion, quality, and operational metrics. State the decision-level target; do NOT specify instrumentation, event names, or tracking implementation — analytics detail belongs to downstream artifacts.`,
        };
    },

    // ── RETIRED — legacy single-section retry only (see RETIRED_PRD_SECTIONS).
    // The implementation_plan artifact owns this detail now. Do NOT extend this
    // builder or re-add the section to DEFAULT_PRD_SECTIONS.
    implementation_plan: (ctx) => {
        const features = pick(ctx.upstream, 'features', 'featureSystems');
        const dataModel = pick(ctx.upstream, 'richDataModel');
        const arch = pick(ctx.upstream, 'architecture', 'architectureFlows');
        const hasFeatures = features !== UNAVAILABLE;
        const hasArch = arch !== UNAVAILABLE;
        const note = (!hasFeatures ? missingNote('features') : '') +
            (!hasArch ? missingNote('architecture') : '');
        return {
            system: `${RETIRED_SECTION_PREAMBLE}

You are generating the implementation_plan slice: a phased development roadmap. Phases and their goals must be concrete and actionable, not abstract; each phase must state the reasoning or dependency that determines its ordering.
${ctx.platform ? PLATFORM_NOTE[ctx.platform] : ''}`,
            user: `${note}Product idea:\n${ctx.idea}

${hasFeatures ? `Features: ${features}` : ''}
${dataModel !== UNAVAILABLE ? `Data model: ${dataModel}` : ''}
${hasArch ? `Architecture: ${arch}` : ''}

Return JSON with:
- implementationPlan: {
    phases: array of { name (e.g. "Phase 1: Foundation"), goals (array of strings), featureIds? (array of feature IDs from the features list), estimatedWeeks? },
    techStack: array of strings (key technologies),
    teamNotes?: string (team structure / hiring needs)
  }
Produce 3–5 phases from MVP foundation through full launch. Every must- and should-priority feature should map to exactly one phase via featureIds.`,
        };
    },
};

export const buildSectionPrompt = (
    sectionId: SectionId,
    ctx: SectionPromptContext,
): SectionPrompt => {
    const builder = builders[sectionId];
    return builder(ctx);
};

// Keyed by the FULL SectionId union — retired sections (data_model,
// implementation_plan) keep their entries so legacy failed-section banners
// and retries still resolve a title.
export const SECTION_TITLES: Record<SectionId, string> = {
    product_basics: 'Product Basics',
    product_thesis: 'Product Thesis',
    grounding: 'Domain Grounding',
    features: 'Features',
    data_model: 'Data Model',
    ux_loops: 'UX & Loops',
    architecture: 'Architecture',
    quality_risks: 'Risks',
    metrics_scope: 'Metrics & Scope',
    implementation_plan: 'Implementation Plan',
};

/**
 * Short, human-readable descriptions for each PRD section, used by the
 * generation progress timeline UI. Kept terse (one clause) so timeline rows
 * stay scannable on mobile.
 */
export const SECTION_DESCRIPTIONS: Record<SectionId, string> = {
    product_basics: 'Defining the core problem and target users',
    product_thesis: 'Creating the product thesis and value proposition',
    grounding: 'Identifying domain entities and primary actions',
    features: 'Specifying core features and capabilities',
    data_model: 'Designing the data model and entities',
    ux_loops: 'Mapping key user flows and journeys',
    architecture: 'Outlining the technical architecture',
    quality_risks: 'Assessing risks and quality concerns',
    metrics_scope: 'Defining success metrics and project scope',
    implementation_plan: 'Assembling the implementation roadmap',
};
