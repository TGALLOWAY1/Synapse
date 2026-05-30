import { callGemini } from '../geminiClient';
import type { StructuredPRD } from '../../types';
import { type SectionId, SECTION_SCHEMAS } from '../schemas/prdSchemas';
import { buildSectionPrompt, SECTION_TITLES, type SectionPromptContext } from '../prompts/prdSectionPrompts';
import { repairTruncatedJson } from '../jsonRepair';
import type { ProjectPlatform } from '../../types';

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

export type ModelProvider = {
    generateText: (input: { prompt: string; model: string; schema: object }) => Promise<string>;
};

export type ProgressiveEvent =
    | { type: 'session_started'; sections: PrdSectionJob[] }
    | { type: 'section_queued'; sectionId: string }
    | { type: 'section_started'; sectionId: string; modelTier: ModelTier; model: string }
    | { type: 'section_completed'; sectionId: string; content: string; confidence?: number }
    | { type: 'section_refining'; sectionId: string }
    | { type: 'section_refined'; sectionId: string; content: string; confidence?: number }
    | { type: 'section_error'; sectionId: string; error: string }
    | { type: 'session_completed' };

// ─── Section topology ────────────────────────────────────────────────────────
// 10 schema-aligned sections. Each emits a typed slice of StructuredPRD that
// is merged client-side into the final document. Fast (Flash) sections run
// independently; strong (Pro) sections depend on earlier results.

export const DEFAULT_PRD_SECTIONS: PrdSectionTemplate[] = [
    { id: 'product_basics',       title: SECTION_TITLES.product_basics,       order: 1,  risk: 'low',  estimatedSeconds: 8 },
    { id: 'product_thesis',       title: SECTION_TITLES.product_thesis,       order: 2,  risk: 'high', estimatedSeconds: 25, dependencies: ['product_basics'] },
    { id: 'grounding',            title: SECTION_TITLES.grounding,            order: 3,  risk: 'low',  estimatedSeconds: 10, dependencies: ['product_basics'] },
    { id: 'features',             title: SECTION_TITLES.features,             order: 4,  risk: 'high', estimatedSeconds: 35, dependencies: ['product_basics', 'product_thesis'] },
    { id: 'data_model',           title: SECTION_TITLES.data_model,           order: 5,  risk: 'high', estimatedSeconds: 25, dependencies: ['features', 'grounding'] },
    { id: 'ux_loops',             title: SECTION_TITLES.ux_loops,             order: 6,  risk: 'high', estimatedSeconds: 25, dependencies: ['features', 'product_thesis'] },
    { id: 'architecture',         title: SECTION_TITLES.architecture,         order: 7,  risk: 'high', estimatedSeconds: 25, dependencies: ['features', 'data_model'] },
    { id: 'quality_risks',        title: SECTION_TITLES.quality_risks,        order: 8,  risk: 'low',  estimatedSeconds: 10, dependencies: ['features', 'architecture'] },
    { id: 'metrics_scope',        title: SECTION_TITLES.metrics_scope,        order: 9,  risk: 'low',  estimatedSeconds: 10, dependencies: ['features'] },
    { id: 'implementation_plan',  title: SECTION_TITLES.implementation_plan,  order: 10, risk: 'high', estimatedSeconds: 30, dependencies: ['features', 'data_model', 'architecture'] },
];

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
    async generateText({ prompt, model, schema }) {
        return callGemini('', prompt, {
            responseMimeType: 'application/json',
            responseSchema: schema,
            model,
            maxOutputTokens: 8192,
            temperature: 0.4,
            topP: 0.9,
        });
    },
});

// ─── DAG executor ────────────────────────────────────────────────────────────
// Runs sections respecting dependency ordering with separate per-tier
// concurrency caps. Each section receives the already-merged partial PRD from
// its upstream sections as prompt context.
//
// `results` is passed in by reference from the caller so both the worker and
// buildUpstream share the same source of truth for completed section values.

async function runDag(
    sections: PrdSectionTemplate[],
    config: ProgressiveGenerationConfig,
    results: Record<string, Partial<StructuredPRD> | null>,
    worker: (section: PrdSectionTemplate, upstream: Partial<StructuredPRD>) => Promise<void>,
): Promise<void> {
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
            if (inDegree[depId] === 0) ready.push(sectionMap[depId]);
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
        if (!dispatched && allIdle) break; // deadlock guard (should not happen)
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
    config: ProgressiveGenerationConfig;
    provider?: ModelProvider;
    onEvent?: (event: ProgressiveEvent) => void;
    onSectionResult?: (sectionId: SectionId, value: Partial<StructuredPRD> | null) => void;
    sections?: PrdSectionTemplate[];
    signal?: AbortSignal;
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
        job.status = 'queued';
        params.onEvent?.({ type: 'section_queued', sectionId: section.id });

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
        };
        const { system, user } = buildSectionPrompt(section.id, ctx);

        try {
            const raw = await provider.generateText({ prompt: `${system}\n\n${user}`, model, schema });

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
            });

            if (params.config.enableRefinementPass && result.confidence < 0.72 && tier === 'fast') {
                jobs[section.id] = { ...jobs[section.id], status: 'refining' };
                params.onEvent?.({ type: 'section_refining', sectionId: section.id });
                const refined = await provider.generateText({
                    model: params.config.strongModel,
                    prompt: `Refine this PRD section. Increase specificity, remove all ambiguity and hedging, and replace any vague or informal phrasing with formal, professional, implementation-ready language. Preserve the structure and schema exactly — same fields, same shape — and return only the JSON object.\n\n${result.content}`,
                    schema,
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

    await runDag(sections, params.config, results, worker);

    params.onEvent?.({ type: 'session_completed' });
    return { jobs, results };
}
