// Multi-agent progressive PRD pipeline. Replaces the single-pass
// runPrdPipeline call with a DAG-orchestrated approach: 10 schema-aligned
// sections run concurrently with Flash (fast) or Pro (strong) per section.
// Returns the same PrdPipelineResult shape for drop-in compatibility.

import { getFastModel, getStrongModel } from '../geminiClient';
import { generateProgressivePrd, DEFAULT_PRD_SECTIONS, selectModelTier } from './progressivePrdGeneration';
import { parseSectionResults, mergeSectionsToStructuredPrd } from './prdSectionMerge';
import { renderPremiumMarkdown } from './prdMarkdownRenderer';
import { reviewPrdConsistency } from './prdConsistencyReview';
import { logPrd, type PrdLogSurface } from './prdGenerationLog';
import type { PrdPipelineOptions, PrdPipelineResult } from './prdPipeline';
import type { StructuredPRD, GenerationPassRecord, WorkflowRun, ConsistencyReviewMeta } from '../../types';
import type { SectionId } from '../schemas/prdSchemas';
import type { ProjectPlatform } from '../../types';
import { buildWorkflowRun, type NodeObservation } from '../metrics/buildWorkflowRun';

export const PRD_SCHEMA_VERSION = 2;

export type SectionStatusUpdate = {
    tier: 'fast' | 'strong';
    status: 'pending' | 'queued' | 'generating' | 'complete' | 'error' | 'refining';
    model?: string;
    ms?: number;
    error?: string;
    /** Rough wall-clock estimate (seconds) shown in the progress UI. */
    estimatedSeconds?: number;
    /** Section ids this section depends on (for the "Waits on:" hint). */
    dependsOn?: SectionId[];
};

export interface ProgressivePrdPipelineOptions extends PrdPipelineOptions {
    /**
     * Fired on each section status change. Callers can feed this into the
     * per-section grid UI in prdProgressSlice.
     */
    onSectionStatus?: (sectionId: SectionId, update: SectionStatusUpdate) => void;
    /**
     * Controls the final cross-section consistency-review pass that runs after
     * the DAG completes and reconciles terminology/name/reference drift left by
     * parallel generation. **Default ON** — the review runs automatically and
     * silently as part of normal generation (its output is only used when it
     * passes conservative acceptance guards; otherwise the merged PRD is kept).
     * Pass `false` only as a developer/debug override to skip the extra model
     * call. See prdConsistencyReview.ts.
     */
    enableConsistencyReview?: boolean;
    /** Rendering surface, attached to structured logs for observability. */
    surface?: PrdLogSurface;
    /**
     * Fired once at completion with the assembled orchestration WorkflowRun
     * (per-section node timings + aggregate speedup/concurrency/cost metrics).
     * Observational only — never affects generation. Errors thrown by the
     * callback are swallowed so metrics can never break a PRD run.
     */
    onWorkflowRun?: (run: WorkflowRun) => void;
    /** Project id stamped onto the WorkflowRun (for the metrics dashboard). */
    projectId?: string;
    /** Project name stamped onto the WorkflowRun (display only). */
    projectName?: string;
}

const SECTION_BY_ID = Object.fromEntries(DEFAULT_PRD_SECTIONS.map(s => [s.id, s]));

export const runProgressivePrdPipeline = async (
    promptText: string,
    options: ProgressivePrdPipelineOptions = {},
    platform?: ProjectPlatform,
): Promise<PrdPipelineResult> => {
    const { onStatus, onPartial, onProgress, onSectionStatus, signal, enableConsistencyReview, surface,
        onWorkflowRun, projectId, projectName } = options;

    const fastModel = getFastModel();
    const strongModel = getStrongModel();
    const overallStart = performance.now();
    // Epoch anchor so the WorkflowRun carries absolute wall-clock timestamps
    // (for the dashboard's date column + Gantt layout) while still using the
    // monotonic performance clock for durations.
    const runStartedAtEpoch = Date.now();
    const nowEpoch = () => runStartedAtEpoch + (performance.now() - overallStart);
    // Per-section observations accumulated for the orchestration WorkflowRun.
    const nodeObs: Record<string, NodeObservation> = {};
    const passes: GenerationPassRecord[] = [];

    // Per-section start times for duration tracking.
    const sectionStarts: Record<string, number> = {};
    // Accumulate partial results for progressive onPartial emissions.
    const partialResults: Record<string, Partial<StructuredPRD> | null> = {};

    onStatus?.('Starting progressive PRD generation…');
    onProgress?.('Sending request to model…');
    logPrd({ event: 'run_started', surface, model: `${fastModel} / ${strongModel}` });

    const { jobs, results } = await generateProgressivePrd({
        prompt: promptText,
        platform,
        projectName,
        config: {
            fastModel,
            strongModel,
            maxFastConcurrency: 4,
            maxStrongConcurrency: 3,
            enableRefinementPass: false,
        },
        signal,
        onSectionResult: (sectionId, value) => {
            partialResults[sectionId] = value;
            // Emit a live partial PRD after each successful section.
            if (value) {
                try {
                    const partial = mergeSectionsToStructuredPrd(
                        parseSectionResults(partialResults),
                    );
                    const markdown = renderPremiumMarkdown(partial);
                    onPartial?.({ structuredPRD: partial, markdown });
                } catch {
                    // Merge may fail transiently on very early partial results — ignore.
                }
            }
        },
        onEvent: (event) => {
            if (event.type === 'session_started') {
                // Seed the grid: every section starts 'pending' (waiting on deps)
                // with its dependency list and estimate so the UI can render the
                // full plan immediately.
                for (const section of DEFAULT_PRD_SECTIONS) {
                    onSectionStatus?.(section.id, {
                        tier: selectModelTier(section.risk) === 'fast' ? 'fast' : 'strong',
                        status: 'pending',
                        estimatedSeconds: section.estimatedSeconds,
                        dependsOn: section.dependencies ?? [],
                    });
                }
            } else if (event.type === 'section_ready') {
                // Dependencies satisfied — now waiting only for a concurrency slot.
                const section = SECTION_BY_ID[event.sectionId];
                const tier = section ? selectModelTier(section.risk) : 'strong';
                logPrd({ event: 'section_queued', sectionId: event.sectionId, surface });
                onSectionStatus?.(event.sectionId as SectionId, {
                    tier: tier === 'fast' ? 'fast' : 'strong',
                    status: 'queued',
                });
            } else if (event.type === 'section_started') {
                sectionStarts[event.sectionId] = performance.now();
                const started = SECTION_BY_ID[event.sectionId];
                nodeObs[event.sectionId] = {
                    nodeId: event.sectionId,
                    nodeName: started?.title ?? event.sectionId,
                    agentName: 'PRD Section Agent',
                    model: event.model,
                    provider: 'gemini',
                    status: 'complete',
                    dependencyIds: started?.dependencies ?? [],
                    startedAt: nowEpoch(),
                    completedAt: nowEpoch(),
                };
                const startedSection = SECTION_BY_ID[event.sectionId];
                const tierLabel = event.modelTier === 'fast' ? 'Flash' : 'Pro';
                const estimate = startedSection?.estimatedSeconds;
                const estimateSuffix = estimate ? ` · ~${estimate}s` : '';
                onProgress?.(`Generating ${startedSection?.title ?? event.sectionId} (${tierLabel}${estimateSuffix})…`);
                logPrd({
                    event: 'section_started',
                    sectionId: event.sectionId,
                    tier: event.modelTier === 'fast' ? 'fast' : 'strong',
                    model: event.model,
                    estimatedSeconds: estimate,
                    surface,
                });
                onSectionStatus?.(event.sectionId as SectionId, {
                    tier: event.modelTier === 'fast' ? 'fast' : 'strong',
                    status: 'generating',
                    model: event.model,
                    estimatedSeconds: estimate,
                });
            } else if (event.type === 'section_completed') {
                const ms = performance.now() - (sectionStarts[event.sectionId] ?? overallStart);
                const obs = nodeObs[event.sectionId];
                if (obs) {
                    obs.status = 'complete';
                    obs.completedAt = nowEpoch();
                    obs.inputTokens = event.usage?.inputTokens;
                    obs.outputTokens = event.usage?.outputTokens;
                    obs.totalTokens = event.usage?.totalTokens;
                }
                const section = SECTION_BY_ID[event.sectionId];
                const tier = section ? selectModelTier(section.risk) : 'strong';
                onProgress?.(`✓ ${section?.title ?? event.sectionId} (${tier === 'fast' ? 'Flash' : 'Pro'}) · ${(ms / 1000).toFixed(1)}s`);
                logPrd({
                    event: 'section_completed',
                    sectionId: event.sectionId,
                    tier: tier === 'fast' ? 'fast' : 'strong',
                    estimatedSeconds: section?.estimatedSeconds,
                    actualSeconds: ms / 1000,
                    surface,
                });
                onSectionStatus?.(event.sectionId as SectionId, {
                    tier: tier === 'fast' ? 'fast' : 'strong',
                    status: 'complete',
                    ms,
                });
                passes.push({ stage: event.sectionId, ms, ok: true });
            } else if (event.type === 'section_error') {
                const ms = performance.now() - (sectionStarts[event.sectionId] ?? overallStart);
                const obs = nodeObs[event.sectionId];
                if (obs) {
                    obs.status = 'error';
                    obs.completedAt = nowEpoch();
                    obs.errorMessage = event.error;
                }
                const section = SECTION_BY_ID[event.sectionId];
                const tier = section ? selectModelTier(section.risk) : 'strong';
                logPrd({
                    event: 'section_failed',
                    sectionId: event.sectionId,
                    tier: tier === 'fast' ? 'fast' : 'strong',
                    actualSeconds: ms / 1000,
                    error: event.error,
                    surface,
                });
                onSectionStatus?.(event.sectionId as SectionId, {
                    tier: tier === 'fast' ? 'fast' : 'strong',
                    status: 'error',
                    ms,
                    error: event.error,
                });
                passes.push({ stage: event.sectionId, ms, ok: false });
            } else if (event.type === 'section_refining') {
                const section = SECTION_BY_ID[event.sectionId];
                const tier = section ? selectModelTier(section.risk) : 'strong';
                onSectionStatus?.(event.sectionId as SectionId, {
                    tier: tier === 'fast' ? 'fast' : 'strong',
                    status: 'refining',
                });
            }
        },
    });

    onProgress?.('Merging sections…');

    const sectionResults = parseSectionResults(results);
    let structuredPRD = mergeSectionsToStructuredPrd(sectionResults);

    const allJobs = Object.values(jobs);
    const failedSections = allJobs.filter(j => j.status === 'error');

    // Automatic final consistency-review pass. Reconciles terminology, names,
    // feature ids, duplicates, and cross-section contradictions introduced by
    // parallel generation. Runs by DEFAULT and silently — the user is never
    // asked to approve ordinary repairs. Pass `enableConsistencyReview: false`
    // only as a developer/debug override. It is skipped when a section failed
    // (the PRD is already surfaced as incomplete) or when every section failed
    // (handled below). Its output is used only when it clears the conservative
    // acceptance guards inside reviewPrdConsistency; otherwise the
    // deterministically-merged PRD is kept and the reason is recorded in meta.
    const runConsistencyReview = enableConsistencyReview !== false;
    let reviewed = false;
    let consistencyMs: number | undefined;
    let consistencyReviewMeta: ConsistencyReviewMeta = { ran: false, applied: false, status: 'skipped' };
    if (runConsistencyReview && failedSections.length === 0) {
        onProgress?.('Reviewing for consistency…');
        const reviewStart = performance.now();
        const reviewStartEpoch = nowEpoch();
        try {
            const review = await reviewPrdConsistency(structuredPRD, { signal });
            const reviewMs = performance.now() - reviewStart;
            consistencyMs = reviewMs;
            reviewed = review.applied;
            consistencyReviewMeta = {
                ran: true,
                applied: review.applied,
                status: review.applied ? 'applied' : 'rejected',
                rejectionReason: review.applied ? undefined : review.rejectionReason,
            };
            if (review.applied) structuredPRD = review.prd;
            // Record the consistency pass as a final, all-sections-dependent
            // node so the Gantt shows it sequentially after the parallel wave.
            nodeObs['consistency_review'] = {
                nodeId: 'consistency_review',
                nodeName: 'Consistency Review',
                agentName: 'Consistency Agent',
                model: getFastModel(),
                provider: 'gemini',
                status: 'complete',
                dependencyIds: Object.keys(nodeObs),
                startedAt: reviewStartEpoch,
                completedAt: nowEpoch(),
            };
            passes.push({ stage: 'consistency_review', ms: reviewMs, ok: true });
            logPrd({
                event: 'consistency_review',
                actualSeconds: reviewMs / 1000,
                detail: review.applied
                    ? (review.changeLog || 'applied')
                    : `discarded (${review.rejectionReason ?? 'no-op'})`,
                surface,
            });
        } catch (e) {
            // A review failure must never fail the whole generation — keep the
            // deterministically-merged PRD.
            consistencyReviewMeta = { ran: true, applied: false, status: 'error', rejectionReason: 'error' };
            console.warn('[prd] consistency review failed; keeping merged PRD.', e);
        }
    }

    const markdown = renderPremiumMarkdown(structuredPRD);

    // If every section errored, the merged PRD is just stub fields — that's
    // not a "successful" result, it's a total outage (auth/quota/network).
    // Reject so callers run their normal error-handling paths instead of
    // persisting an empty PRD as if generation succeeded.
    if (allJobs.length > 0 && failedSections.length === allJobs.length) {
        const firstError = failedSections[0]?.error || 'unknown error';
        throw new Error(
            `PRD generation failed: all ${allJobs.length} sections errored. ` +
            `First error: ${firstError}`,
        );
    }

    if (failedSections.length > 0) {
        console.warn(
            `[prd] ${failedSections.length} of ${allJobs.length} section(s) failed: ${failedSections.map(j => j.id).join(', ')}. ` +
            'Partial PRD rendered from completed sections.',
        );
    }

    const totalMs = performance.now() - overallStart;
    logPrd({
        event: 'run_completed',
        totalMs,
        surface,
        detail: `${allJobs.length - failedSections.length}/${allJobs.length} sections ok${reviewed ? ', consistency-reviewed' : ''}`,
    });

    // Assemble + emit the orchestration WorkflowRun. Wrapped so a metrics bug
    // can never surface as a generation failure.
    if (onWorkflowRun) {
        try {
            const run = buildWorkflowRun({
                projectId: projectId ?? 'unknown',
                projectName,
                workflowType: 'prd',
                startedAt: runStartedAtEpoch,
                completedAt: runStartedAtEpoch + totalMs,
                nodes: Object.values(nodeObs),
                metadata: {
                    models: `${fastModel} / ${strongModel}`,
                    consistencyReviewMs: consistencyMs,
                    consistencyReviewed: reviewed,
                },
            });
            onWorkflowRun(run);
        } catch (e) {
            console.warn('[prd] failed to assemble workflow metrics run.', e);
        }
    }

    return {
        structuredPRD,
        markdown,
        generationMeta: {
            passes,
            totalMs,
            revised: reviewed,
            schemaVersion: PRD_SCHEMA_VERSION,
            failedSections: failedSections.map(j => j.id),
            consistencyReview: consistencyReviewMeta,
        },
        model: `${fastModel} / ${strongModel}`,
    };
};
