// Shared entry point for kicking off PRD generation against an existing spine.
// Used by both the "Generate Immediately" path (HomePage) and the preflight
// clarification path (PreflightView) so there is exactly one generation flow
// with one set of store callbacks and error handling.

import { useProjectStore } from '../store/projectStore';
import { normalizeError, userMessage } from './errors';
import {
    SafetyBlockedError,
    buildBlockedSafetyReview,
    buildRestrictedSafetyReview,
    buildSafetyReviewMarkdown,
} from './safety';
import type { ProjectPlatform } from '../types';
import type { PreflightContext } from './llmProvider';
import { detectSurface } from './services/prdGenerationLog';

/**
 * Resolve the consistency-review override from localStorage.
 *
 * The final consistency-review pass now runs by DEFAULT and silently as part of
 * normal PRD generation (see prdConsistencyReview.ts / progressivePrdPipeline).
 * The `synapse-prd-consistency-review` key is retained only as a
 * developer/debug override: `'false'` skips the pass (saving one model call),
 * anything else (including absent) leaves the default-on behavior. Returns
 * `undefined` when there is no override, so the pipeline default applies.
 * Wrapped in try/catch for non-browser contexts.
 */
const consistencyReviewOverride = (): boolean | undefined => {
    try {
        if (typeof localStorage === 'undefined') return undefined;
        const value = localStorage.getItem('synapse-prd-consistency-review');
        if (value === 'false') return false;
        if (value === 'true') return true;
        return undefined;
    } catch {
        return undefined;
    }
};

export interface RunPrdGenerationParams {
    projectId: string;
    spineId: string;
    /** The original user idea. Safety is classified on this text. */
    sourcePrompt: string;
    platform?: ProjectPlatform;
    /** Optional preflight clarification context to inject into the prompt. */
    preflight?: PreflightContext;
}

/**
 * Runs PRD generation for a spine and wires the streaming results back into the
 * store. Resolves when generation settles (success or handled failure); never
 * rejects — disallowed/blocked and generation errors are persisted on the spine
 * exactly as the prior inline call sites did.
 */
export async function runPrdGeneration({
    projectId,
    spineId,
    sourcePrompt,
    platform,
    preflight,
}: RunPrdGenerationParams): Promise<void> {
    const store = useProjectStore.getState();
    // The name the user gave the project is forwarded into generation so the
    // PRD's productName reflects it (see prdSectionPrompts.product_basics).
    const projectName = store.getProject(projectId)?.name;
    // Fresh run starts with a clean event log. Marking the spine 'running'
    // lets rehydration detect an interrupted run if the page is closed
    // mid-generation (see markInterruptedGenerations).
    store.clearPrdProgress(projectId);
    store.clearSectionStatus(projectId);
    store.markSpineGenerationStarted(projectId, spineId);

    let generateStructuredPRD;
    try {
        ({ generateStructuredPRD } = await import('./llmProvider'));
    } catch (e) {
        const err = normalizeError(e);
        console.error('[Module load failed]', err.raw);
        useProjectStore.getState().setSpineError(projectId, spineId, {
            message: 'Failed to load generation module. Try refreshing the page.',
            category: err.category,
            timestamp: err.timestamp,
            raw: err.raw,
        });
        return;
    }

    try {
        await generateStructuredPRD(
            sourcePrompt,
            {
                preflight,
                projectName,
                enableConsistencyReview: consistencyReviewOverride(),
                surface: detectSurface(),
                onWorkflowRun: (run) => {
                    // The pipeline doesn't know the project — stamp identity here
                    // where we do, so the Metrics dashboard can group by project.
                    const project = useProjectStore.getState().getProject(projectId);
                    useProjectStore.getState().recordWorkflowRun({
                        ...run,
                        projectId,
                        projectName: project?.name,
                    });
                },
                onProgress: (message) => {
                    useProjectStore.getState().appendPrdProgress(projectId, message);
                },
                onSectionStatus: (sectionId, update) => {
                    useProjectStore.getState().setSectionStatus(projectId, sectionId, update);
                },
                // Progressive render: paint the draft as soon as each section lands.
                onPartial: ({ structuredPRD, markdown }) => {
                    useProjectStore.getState().updateSpineStructuredPRD(
                        projectId,
                        spineId,
                        structuredPRD,
                        markdown,
                        { sourcePrompt },
                    );
                    if (structuredPRD.productName || structuredPRD.productCategory) {
                        useProjectStore.getState().updateProjectProductMetadata(projectId, {
                            productName: structuredPRD.productName,
                            productCategory: structuredPRD.productCategory,
                        });
                    }
                },
                onResult: ({ structuredPRD, markdown, generationMeta, model }) => {
                    useProjectStore.getState().updateSpineStructuredPRD(
                        projectId,
                        spineId,
                        structuredPRD,
                        markdown,
                        {
                            sourcePrompt,
                            generationMeta,
                            model,
                            prdVersion: generationMeta.schemaVersion,
                        },
                    );
                },
                onSafety: (safety) => {
                    if (safety.classification === 'allowed_with_restrictions') {
                        useProjectStore.getState().setSpineSafetyReview(
                            projectId,
                            spineId,
                            buildRestrictedSafetyReview(safety),
                        );
                    }
                },
            },
            platform,
        );
    } catch (e) {
        // Disallowed requests hard-stop: store a blocked Safety Review (which
        // shows the dedicated screen and gates downstream generation).
        if (e instanceof SafetyBlockedError) {
            useProjectStore.getState().setSpineSafetyReview(
                projectId,
                spineId,
                buildBlockedSafetyReview(e.result),
                buildSafetyReviewMarkdown(e.result),
            );
            return;
        }
        const err = normalizeError(e);
        console.error('[PRD generation failed]', err.raw);
        useProjectStore.getState().setSpineError(projectId, spineId, {
            message: userMessage(err),
            category: err.category,
            timestamp: err.timestamp,
            raw: err.raw,
        });
    }
}
