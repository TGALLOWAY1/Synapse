import { callGemini } from '../geminiClient';
import type { StructuredPRD } from '../../types';
import { type SectionId, SECTION_SCHEMAS } from '../schemas/prdSchemas';
import { buildSectionPrompt, SECTION_TITLES, type SectionPromptContext } from '../prompts/prdSectionPrompts';
import { repairTruncatedJson } from '../jsonRepair';
import type { ProjectPlatform } from '../../types';
import type { LlmTraceMeta } from '../trace/traceTypes';

/** Identity threaded into per-section LLM traces (developer-only). */
export interface TraceContext {
    sessionId?: string;
    projectId?: string;
    projectName?: string;
}

export type PrdSectionStatus =
    | 'pending'
    | 'queued'
    | 'generating'
    | 'streaming'
    | 'draft_complete'
    | 'refining'
    | 'complete'
    | 'error'
    | 'user_edited';

export type ModelTier = 'fast' | 'strong' | 'premium';

export type PrdSectionJob = {
    id: string;
    title: string;
    order: number;
    status: PrdSectionStatus;
    modelTier: ModelTier;
    assignedModel?: string;
    content: string;
    confidence?: number;
    startedAt?: string;
    completedAt?: string;
    error?: string;
    isUserEdited: boolean;
    version: number;
};

export type GenerationTaskRisk = 'low' | 'high';

export type PrdSectionTemplate = {
    id: SectionId;
    title: string;
    order: number;
    risk: GenerationTaskRisk;
    dependencies?: SectionId[];
    /** Rough wall-clock estimate (seconds) used by the progress UI. */
    estimatedSeconds: number;
};

export type SectionGenerationResult = {
    content: string;
    confidence: number;
    concerns: string[];
};

export type ProgressiveGenerationConfig = {
    fastModel: string;
    strongModel: string;
    premiumModel?: string;
    maxFastConcurrency: number;
    maxStrongConcurrency: number;
    enableRefinementPass: boolean;
};

/** Token counts captured from a model call (observational; for metrics). */
export type NodeTokenUsage = {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
};

export type ModelProvider = {
    generateText: (input: {
        prompt: string;
        model: string;
        schema: object;
        signal?: AbortSignal;
        /** Optional sink for token usage — forwarded to the transport. */
        onUsage?: (usage: NodeTokenUsage) => void;
        /** Optional developer-only trace enrichment forwarded to the transport. */
        traceMeta?: LlmTraceMeta;
    }) => Promise<string>;
};

export type ProgressiveEvent =
    | { type: 'session_started'; sections: PrdSectionJob[] }
    // Emitted by the executor the moment a section's dependencies are all
    // satisfied and it enters the ready queue. The section may still wait for a
    // free concurrency slot before `section_started` fires, so this maps to the
    // "queued — waiting for a slot" UI state (distinct from "waiting on deps").
    | { type: 'section_ready'; sectionId: string }
    | { type: 'section_started'; sectionId: string; modelTier: ModelTier; model: string }
    | { type: 'section_completed'; sectionId: string; content: string; confidence?: number; usage?: NodeTokenUsage }
    | { type: 'section_refining'; sectionId: string }
    | { type: 'section_refined'; sectionId: string; content: string; confidence?: number }
    | { type: 'section_error'; sectionId: string; error: string }
    | { type: 'session_completed' };

// ─── Section topology ────────────────────────────────────────────────────────
// 8 schema-aligned sections. Each emits a typed slice of StructuredPRD that
// is merged client-side into the final document. Fast (Flash) sections run
// independently; strong (Pro) sections depend on earlier results.
//
// The PRD is the product DECISION document — detailed specification belongs to
// the dedicated downstream artifacts. The former `data_model` and
// `implementation_plan` sections are retired from the default graph (see
// RETIRED_PRD_SECTIONS below): the data_model and implementation_plan
// artifacts own that detail, the PRD-embedded copies duplicated them (two
// entity lists — domainEntities vs richDataModel.entities — was a standing
// internal-inconsistency source), and implementationPlan was never rendered.

// Dependencies are TRUE data dependencies only — a section lists another only
// when it actually consumes that section's output as prompt context. Sections
// are NOT sequenced just because they appear later in the document. Earlier
// revisions over-constrained the graph (e.g. `features` waited on the slow
// `product_thesis`, and `quality_risks` waited on the full architecture chain),
// which serialized the two heaviest early calls and delayed fan-out. The graph
// below relaxes those spurious edges so independent work overlaps. Prompt
// builders degrade gracefully (via `missingNote()`) when an upstream field they
// reference is not a declared dependency, so dropping an edge never breaks a
// section — it just lets it start sooner.
export const DEFAULT_PRD_SECTIONS: PrdSectionTemplate[] = [
    { id: 'product_basics',       title: SECTION_TITLES.product_basics,       order: 1,  risk: 'low',  estimatedSeconds: 8 },
    { id: 'product_thesis',       title: SECTION_TITLES.product_thesis,       order: 2,  risk: 'high', estimatedSeconds: 25, dependencies: ['product_basics'] },
    { id: 'grounding',            title: SECTION_TITLES.grounding,            order: 3,  risk: 'low',  estimatedSeconds: 10, dependencies: ['product_basics'] },
    // features depends on product_basics only — it runs in parallel with the
    // slow product_thesis call instead of waiting behind it.
    { id: 'features',             title: SECTION_TITLES.features,             order: 4,  risk: 'high', estimatedSeconds: 35, dependencies: ['product_basics'] },
    // ux_loops only truly needs the feature set; thesis is incidental context.
    { id: 'ux_loops',             title: SECTION_TITLES.ux_loops,             order: 6,  risk: 'high', estimatedSeconds: 25, dependencies: ['features'] },
    // architecture grounds its entity reasoning in the grounding section's
    // domainEntities (the retired data_model section previously played this role).
    { id: 'architecture',         title: SECTION_TITLES.architecture,         order: 7,  risk: 'high', estimatedSeconds: 25, dependencies: ['features', 'grounding'] },
    // quality_risks is derivable from the feature set; it no longer waits on the
    // long architecture chain.
    { id: 'quality_risks',        title: SECTION_TITLES.quality_risks,        order: 8,  risk: 'low',  estimatedSeconds: 10, dependencies: ['features'] },
    { id: 'metrics_scope',        title: SECTION_TITLES.metrics_scope,        order: 9,  risk: 'low',  estimatedSeconds: 10, dependencies: ['features'] },
];

// Sections retired from the DEFAULT generation graph. Kept ONLY so the
// single-section retry path (prdSectionRetry.ts) can re-run them for legacy
// PRDs whose generationMeta.failedSections still reference them — their
// SectionId, prompt builder, slice schema, and title all survive. Never feed
// these to runDag, and never re-add them to DEFAULT_PRD_SECTIONS: the
// dedicated data_model / implementation_plan artifacts own that detail now.
export const RETIRED_PRD_SECTIONS: PrdSectionTemplate[] = [
    { id: 'data_model',          title: SECTION_TITLES.data_model,          order: 98, risk: 'high', estimatedSeconds: 25 },
    { id: 'implementation_plan', title: SECTION_TITLES.implementation_plan, order: 99, risk: 'high', estimatedSeconds: 30 },
];

export const RETIRED_SECTION_IDS: ReadonlySet<string> = new Set(
    RETIRED_PRD_SECTIONS.map(s => s.id),
);

/** Lookup of estimated wall-clock seconds per section, derived from DEFAULT_PRD_SECTIONS. */
export const SECTION_ESTIMATES_S: Record<string, number> = Object.fromEntries(
    DEFAULT_PRD_SECTIONS.map(s => [s.id, s.estimatedSeconds]),
);

const nowIso = () => new Date().toISOString();

export const makeSkeletonJobs = (sections = DEFAULT_PRD_SECTIONS): Record<string, PrdSectionJob> =>
    Object.fromEntries(
        sections.map(s => [s.id, {
            id: s.id,
            title: s.title,
            order: s.order,
            status: 'pending' as const,
            modelTier: s.risk === 'low' ? 'fast' : 'strong',
            content: '',
            isUserEdited: false,
            version: 1,
        }]),
    );

export const selectModelTier = (risk: GenerationTaskRisk): ModelTier =>
    risk === 'low' ? 'fast' : 'strong';

export const selectModelForTier = (tier: ModelTier, cfg: ProgressiveGenerationConfig): string => {
    if (tier === 'premium' && cfg.premiumModel) return cfg.premiumModel;
    return tier === 'fast' ? cfg.fastModel : cfg.strongModel;
};

export const applyAiUpdate = (section: PrdSectionJob, content: string): PrdSectionJob => {
    if (section.isUserEdited) return section;
    return {
        ...section,
        content,
        status: 'complete',
        completedAt: nowIso(),
        version: section.version + 1,
    };
};

/**
 * Parse a section's raw JSON response, applying truncation repair as a
 * fallback. Per-section maxOutputTokens is bounded (8192) so complex sections
 * like `features` can hit MAX_TOKENS and end mid-string. Returns `null` when
 * the response is unparseable even after repair. Shared by the DAG worker and
 * the single-section retry path so both stay in sync.
 */
export const parseSectionJson = (raw: string): Partial<StructuredPRD> | null => {
    try {
        return JSON.parse(raw) as Partial<StructuredPRD>;
    } catch {
        const { text: repairedText, repaired } = repairTruncatedJson(raw);
        if (repaired) {
            try {
                return JSON.parse(repairedText) as Partial<StructuredPRD>;
            } catch {
                return null;
            }
        }
        return null;
    }
};

export const makeJsonProvider = (): ModelProvider => ({
    async generateText({ prompt, model, schema, signal, onUsage, traceMeta }) {
        return callGemini('', prompt, {
            responseMimeType: 'application/json',
            responseSchema: schema,
            model,
            maxOutputTokens: 8192,
            temperature: 0.4,
            topP: 0.9,
            onUsage,
            traceMeta,
        }, signal);
    },
});

// ─── Graph validation ─────────────────────────────────────────────────────────
// Run before execution so a malformed graph fails fast and loudly instead of
// silently deadlocking (sections that never run would be quietly dropped from
// the merged PRD). Detects (a) dependencies referencing unknown section ids and
// (b) circular dependencies (Kahn's algorithm — if fewer than all nodes can be
// topologically processed, a cycle exists).
export const validateGraph = (sections: PrdSectionTemplate[]): void => {
    const ids = new Set(sections.map(s => s.id));
    const inDegree: Record<string, number> = {};
    const dependents: Record<string, string[]> = {};
    for (const s of sections) {
        inDegree[s.id] = 0;
        dependents[s.id] = [];
    }
    for (const s of sections) {
        for (const dep of (s.dependencies ?? [])) {
            if (!ids.has(dep)) {
                throw new Error(
                    `Invalid PRD section graph: "${s.id}" depends on unknown section "${dep}"`,
                );
            }
            inDegree[s.id]++;
            dependents[dep].push(s.id);
        }
    }

    const queue: string[] = sections.filter(s => inDegree[s.id] === 0).map(s => s.id);
    let processed = 0;
    while (queue.length > 0) {
        const id = queue.shift()!;
        processed++;
        for (const dep of dependents[id]) {
            if (--inDegree[dep] === 0) queue.push(dep);
        }
    }
    if (processed < sections.length) {
        const cyclic = sections.filter(s => inDegree[s.id] > 0).map(s => s.id);
        throw new Error(
            `Circular dependency detected in PRD section graph among: ${cyclic.join(', ')}`,
        );
    }
};

// ─── DAG executor ────────────────────────────────────────────────────────────
// Runs sections respecting dependency ordering with separate per-tier
// concurrency caps. Each section receives the already-merged partial PRD from
// its upstream sections as prompt context.
//
// `results` is passed in by reference from the caller so both the worker and
// buildUpstream share the same source of truth for completed section values.
//
// `onReady` fires when a section's dependencies are all satisfied and it enters
// the ready queue (it may still wait for a free concurrency slot before the
// worker actually starts it).

async function runDag(
    sections: PrdSectionTemplate[],
    config: ProgressiveGenerationConfig,
    results: Record<string, Partial<StructuredPRD> | null>,
    worker: (section: PrdSectionTemplate, upstream: Partial<StructuredPRD>) => Promise<void>,
    onReady?: (sectionId: string) => void,
): Promise<void> {
    validateGraph(sections);

    const sectionMap = Object.fromEntries(sections.map(s => [s.id, s]));

    // Build the dependency graph.
    const inDegree: Record<string, number> = {};
    const dependents: Record<string, string[]> = {};
    for (const s of sections) {
        inDegree[s.id] = s.dependencies?.length ?? 0;
        dependents[s.id] = [];
    }
    for (const s of sections) {
        for (const dep of (s.dependencies ?? [])) {
            dependents[dep].push(s.id);
        }
    }

    const settled = new Set<string>();

    let fastRunning = 0;
    let strongRunning = 0;
    const fastMax = config.maxFastConcurrency;
    const strongMax = config.maxStrongConcurrency;

    const ready: PrdSectionTemplate[] = sections.filter(s => (s.dependencies?.length ?? 0) === 0);
    // Sections with no dependencies are ready immediately (awaiting only a slot).
    for (const s of ready) onReady?.(s.id);

    // Notification gate: resolves whenever a section completes so the outer
    // loop can re-evaluate what's now runnable.
    let notifyTick: () => void = () => {};
    const waitForTick = () => new Promise<void>(res => { notifyTick = res; });

    const buildUpstream = (s: PrdSectionTemplate): Partial<StructuredPRD> => {
        const merged: Partial<StructuredPRD> = {};
        for (const depId of (s.dependencies ?? [])) {
            const val = results[depId];
            if (val) Object.assign(merged, val);
        }
        return merged;
    };

    const onComplete = (sectionId: string) => {
        settled.add(sectionId);
        for (const depId of dependents[sectionId]) {
            inDegree[depId]--;
            if (inDegree[depId] === 0) {
                ready.push(sectionMap[depId]);
                onReady?.(depId);
            }
        }
        notifyTick();
    };

    const running: Array<Promise<void>> = [];

    const dispatch = (section: PrdSectionTemplate) => {
        const tier = selectModelTier(section.risk);
        if (tier === 'fast') fastRunning++; else strongRunning++;

        const task = worker(section, buildUpstream(section))
            .then(() => {
                if (tier === 'fast') fastRunning--; else strongRunning--;
                onComplete(section.id);
            })
            .catch(() => {
                if (tier === 'fast') fastRunning--; else strongRunning--;
                results[section.id] = null;
                onComplete(section.id);
            });

        running.push(task);
    };

    // Main loop: drain ready queue within concurrency caps; wait for a tick
    // (any completion) when all slots are full or nothing is ready yet.
    while (settled.size < sections.length) {
        let dispatched = false;
        while (ready.length > 0) {
            const next = ready[0];
            const tier = selectModelTier(next.risk);
            const atLimit = tier === 'fast' ? fastRunning >= fastMax : strongRunning >= strongMax;
            if (atLimit) break;
            ready.shift();
            dispatch(next);
            dispatched = true;
        }

        const allIdle = fastRunning === 0 && strongRunning === 0;
        if (!dispatched && allIdle) {
            // Nothing running and nothing dispatchable while sections remain
            // unsettled — only possible with a cyclic/broken graph, which
            // validateGraph should have rejected. Fail loudly rather than
            // silently dropping the unreachable sections from the PRD.
            const stuck = sections.filter(s => !settled.has(s.id)).map(s => s.id);
            throw new Error(`PRD DAG deadlock: unreachable sections ${stuck.join(', ')}`);
        }
        if (!dispatched || (ready.length > 0 && (fastRunning >= fastMax || strongRunning >= strongMax))) {
            await waitForTick();
        }
    }

    await Promise.all(running);
}

// ─── Main entry point ────────────────────────────────────────────────────────

export async function generateProgressivePrd(params: {
    prompt: string;
    platform?: ProjectPlatform;
    /** User-chosen project name, surfaced to product_basics as the productName. */
    projectName?: string;
    config: ProgressiveGenerationConfig;
    provider?: ModelProvider;
    onEvent?: (event: ProgressiveEvent) => void;
    onSectionResult?: (sectionId: SectionId, value: Partial<StructuredPRD> | null) => void;
    sections?: PrdSectionTemplate[];
    signal?: AbortSignal;
    /** Developer-only trace identity, stamped onto each section's LLM trace. */
    traceContext?: TraceContext;
}) {
    const sections = params.sections ?? DEFAULT_PRD_SECTIONS;
    const provider = params.provider ?? makeJsonProvider();
    const jobs = makeSkeletonJobs(sections);

    // Shared results dict — written by the worker, read by runDag's
    // buildUpstream so dependent sections see upstream JSON as context.
    const results: Record<string, Partial<StructuredPRD> | null> = {};

    params.onEvent?.({ type: 'session_started', sections: Object.values(jobs) });

    const worker = async (section: PrdSectionTemplate, upstream: Partial<StructuredPRD>) => {
        const job = jobs[section.id];
        const tier = selectModelTier(section.risk);
        const model = selectModelForTier(tier, params.config);
        const schema = SECTION_SCHEMAS[section.id];

        job.status = 'generating';
        job.assignedModel = model;
        job.startedAt = nowIso();
        params.onEvent?.({ type: 'section_started', sectionId: section.id, modelTier: tier, model });

        const ctx: SectionPromptContext = {
            idea: params.prompt,
            platform: params.platform,
            upstream,
            projectName: params.projectName,
        };
        const { system, user } = buildSectionPrompt(section.id, ctx);

        const depIds = section.dependencies ?? [];
        const traceMeta: LlmTraceMeta = {
            sessionId: params.traceContext?.sessionId,
            sessionLabel: params.traceContext?.projectName
                ? `PRD · ${params.traceContext.projectName}`
                : 'PRD Generation',
            stage: 'PRD',
            purpose: `Generate ${section.title}`,
            artifact: section.id,
            projectId: params.traceContext?.projectId,
            projectName: params.traceContext?.projectName,
            inputs: [
                'Product idea',
                ...(params.projectName ? ['Project name'] : []),
                ...(depIds.length ? [`Upstream sections: ${depIds.join(', ')}`] : ['No upstream sections']),
            ],
            promptPieces: [
                { label: 'Section system instruction', present: true },
                { label: 'Section user prompt', present: true },
                { label: 'Upstream section context', present: depIds.length > 0, detail: depIds.join(', ') || undefined },
                { label: 'Safety override', present: true },
            ],
        };

        let usage: NodeTokenUsage | undefined;
        try {
            const raw = await provider.generateText({
                prompt: `${system}\n\n${user}`,
                model,
                schema,
                signal: params.signal,
                onUsage: (u) => { usage = u; },
                traceMeta,
            });

            // Parse with truncation repair fallback (shared helper).
            const parsed = parseSectionJson(raw);

            // Treat an unparsable response as a section failure: dropping
            // it silently while still firing `section_completed` would
            // mark the grid green with empty data and quietly omit the
            // section from the merged PRD.
            if (!parsed) {
                throw new Error(`Section "${section.id}" returned unparseable JSON`);
            }

            results[section.id] = parsed;
            params.onSectionResult?.(section.id, parsed);

            const confidence = raw.length > 120 ? 0.8 : 0.6;
            const result: SectionGenerationResult = { content: raw, confidence, concerns: [] };
            const updated = applyAiUpdate(job, result.content);
            updated.confidence = result.confidence;
            jobs[section.id] = updated;
            params.onEvent?.({
                type: 'section_completed',
                sectionId: section.id,
                content: updated.content,
                confidence: updated.confidence,
                usage,
            });

            if (params.config.enableRefinementPass && result.confidence < 0.72 && tier === 'fast') {
                jobs[section.id] = { ...jobs[section.id], status: 'refining' };
                params.onEvent?.({ type: 'section_refining', sectionId: section.id });
                const refined = await provider.generateText({
                    model: params.config.strongModel,
                    prompt: `Refine this PRD section. Increase specificity, remove all ambiguity and hedging, and replace any vague or informal phrasing with formal, professional, implementation-ready language. Preserve the structure and schema exactly — same fields, same shape — and return only the JSON object.\n\n${result.content}`,
                    schema,
                    signal: params.signal,
                    traceMeta: { ...traceMeta, purpose: `Refine ${section.title}` },
                });
                const post = applyAiUpdate(jobs[section.id], refined);
                jobs[section.id] = { ...post, confidence: Math.max(0.75, result.confidence) };
                params.onEvent?.({
                    type: 'section_refined',
                    sectionId: section.id,
                    content: jobs[section.id].content,
                    confidence: jobs[section.id].confidence,
                });
            }
        } catch (e) {
            results[section.id] = null;
            params.onSectionResult?.(section.id, null);
            jobs[section.id] = {
                ...jobs[section.id],
                status: 'error',
                error: e instanceof Error ? e.message : 'Unknown error',
            };
            params.onEvent?.({
                type: 'section_error',
                sectionId: section.id,
                error: jobs[section.id].error || 'Unknown error',
            });
            throw e;
        }
    };

    await runDag(
        sections,
        params.config,
        results,
        worker,
        (sectionId) => params.onEvent?.({ type: 'section_ready', sectionId }),
    );

    params.onEvent?.({ type: 'session_completed' });
    return { jobs, results };
}
