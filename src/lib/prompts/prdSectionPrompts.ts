import type { ProjectPlatform, StructuredPRD } from '../../types';
import type { SectionId } from '../schemas/prdSchemas';
import { RUBRIC_DEFINITION, PROMPT_CONTRACT } from './prdPrompts';

export type SectionPromptContext = {
    idea: string;
    platform?: ProjectPlatform;
    upstream: Partial<StructuredPRD>;
};

const PLATFORM_NOTE: Record<ProjectPlatform, string> = {
    app: 'Target platform: native mobile application (iOS/Android). Bias toward touch interaction, offline operation, push notifications, and device APIs.',
    web: 'Target platform: web application. Bias toward responsive layouts, browser APIs, SEO, and URL routing.',
};

const SHARED_PREAMBLE = `You are a senior product strategist and tech lead generating one section of a structured PRD as JSON. Output ONLY the JSON object matching the provided schema — no markdown, no commentary, no preamble, no extra fields, and no conversational language. Every string value must be specific, definitive, and implementation-ready; write as a practitioner who has shipped this product.

${PROMPT_CONTRACT}

${RUBRIC_DEFINITION}`;

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
    product_basics: (ctx) => ({
        system: `${SHARED_PREAMBLE}

You are generating the product_basics slice: productName, productCategory, executiveSummary, vision, targetUsers, coreProblem.
${ctx.platform ? PLATFORM_NOTE[ctx.platform] : ''}`,
        user: `Product idea:\n${ctx.idea}

Return JSON with: productName (string), productCategory (short label e.g. "B2C Marketplace"), executiveSummary (2–3 sentences), vision (1 aspirational sentence), targetUsers (3–5 specific user types as strings), coreProblem (the core pain solved — state the user's current workaround, why existing solutions fail, and the consequence of leaving it unsolved).`,
    }),

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

You are generating the features slice: features, featureSystems. This is the most consequential section; be thorough, specific, and definitive. Every feature and system decision must include reasoning or a stated constraint that justifies it (user value, dependency, or scope rationale).
${ctx.platform ? PLATFORM_NOTE[ctx.platform] : ''}`,
            user: `${note}Product idea:\n${ctx.idea}

Product basics: ${basics}
${hasThesis ? `Product thesis: ${thesis}` : ''}

Return JSON with:
- features: array of 8–14 features, each: { id (f1, f2…), name, description, userValue, complexity (low/medium/high), priority (must/should/could), acceptanceCriteria (≥2 success-path checks), system?, successCriteria?, edgeCases?, failureModes?, uiAcceptanceCriteria?, analyticsEvents?, tier? (mvp/v1/later), dependencies? }
- featureSystems: array of 2–4 system groups, each: { id (s1…), name, purpose, featureIds, endToEndBehavior, dependencies?, edgeCases?, mvpVsLater? }

For every must- and should-priority feature, populate successCriteria, edgeCases, failureModes, and uiAcceptanceCriteria — treat these as expected, not optional.`,
        };
    },

    data_model: (ctx) => {
        const features = pick(ctx.upstream, 'features', 'featureSystems');
        const grounding = pick(ctx.upstream, 'domainEntities', 'primaryActions');
        const hasFeatures = features !== UNAVAILABLE;
        const note = !hasFeatures ? missingNote('features') : '';
        return {
            system: `${SHARED_PREAMBLE}

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
- uxPages: array of 5–10 screens, each: { id (pg1…), name, purpose, primaryUser?, components (array), interactions (array), emptyState?, loadingState?, errorState?, responsiveNotes? }. Specify emptyState, loadingState, and errorState for every screen.
- roles: array of user roles, each: { role, allowed (array), restricted?, dataVisibility?, notes? }`,
        };
    },

    architecture: (ctx) => {
        const features = pick(ctx.upstream, 'features', 'featureSystems');
        const dataModel = pick(ctx.upstream, 'richDataModel');
        const hasFeatures = features !== UNAVAILABLE;
        const note = !hasFeatures ? missingNote('features') : '';
        return {
            system: `${SHARED_PREAMBLE}

You are generating the architecture slice: architecture (narrative), architectureFlows, nonFunctionalRequirements, constraints. Every technology and architectural decision must include reasoning grounded in scalability, maintainability, ecosystem maturity, or performance — never stylistic descriptors. Prefer widely adopted, stable technologies unless the product requires otherwise.
${ctx.platform ? PLATFORM_NOTE[ctx.platform] : ''}`,
            user: `${note}Product idea:\n${ctx.idea}

${hasFeatures ? `Features: ${features}` : ''}
${dataModel !== UNAVAILABLE ? `Data model: ${dataModel}` : ''}

Return JSON with:
- architecture: string — 2–4 paragraph technical architecture narrative covering tech stack, key components, integration points
- architectureFlows: array of { name, steps (array of strings) } — 3–5 key system flows (auth, data write, notification, etc.). Express each flow's steps as an ordered, numbered sequence.
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
- assumptions: array of { id (a1…), statement, confidence (low/med/high) } — 4–8 product assumptions. Record every fact you inferred rather than were told. Calibrate confidence: high = directly implied by the idea; med = reasonable industry default; low = speculative.`,
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
- successMetrics: array of { name, target?, instrumentation? } — 5–8 measurable product success criteria spanning activation, engagement, conversion, quality, and operational metrics`,
        };
    },

    implementation_plan: (ctx) => {
        const features = pick(ctx.upstream, 'features', 'featureSystems');
        const dataModel = pick(ctx.upstream, 'richDataModel');
        const arch = pick(ctx.upstream, 'architecture', 'architectureFlows');
        const hasFeatures = features !== UNAVAILABLE;
        const hasArch = arch !== UNAVAILABLE;
        const note = (!hasFeatures ? missingNote('features') : '') +
            (!hasArch ? missingNote('architecture') : '');
        return {
            system: `${SHARED_PREAMBLE}

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
