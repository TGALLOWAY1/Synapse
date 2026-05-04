// Multi-agent progressive PRD pipeline. Replaces the single-pass
// runPrdPipeline call with a DAG-orchestrated approach: 10 schema-aligned
// sections run concurrently with Flash (fast) or Pro (strong) per section.
// Returns the same PrdPipelineResult shape for drop-in compatibility.

import { getFastModel, getStrongModel } from '../geminiClient';
import { generateProgressivePrd, DEFAULT_PRD_SECTIONS, selectModelTier } from './progressivePrdGeneration';
import { parseSectionResults, mergeSectionsToStructuredPrd } from './prdSectionMerge';
import { renderPremiumMarkdown } from './prdMarkdownRenderer';
import type { PrdPipelineOptions, PrdPipelineResult } from './prdPipeline';
import type { StructuredPRD, GenerationPassRecord } from '../../types';
import type { SectionId } from '../schemas/prdSchemas';
import type { ProjectPlatform } from '../../types';

export const PRD_SCHEMA_VERSION = 2;

export type SectionStatusUpdate = {
    tier: 'fast' | 'strong';
    status: 'pending' | 'queued' | 'generating' | 'complete' | 'error' | 'refining';
    model?: string;
    ms?: number;
    error?: string;
};

export interface ProgressivePrdPipelineOptions extends PrdPipelineOptions {
    /**
     * Fired on each section status change. Callers can feed this into the
     * per-section grid UI in prdProgressSlice.
     */
    onSectionStatus?: (sectionId: SectionId, update: SectionStatusUpdate) => void;
}

export const runProgressivePrdPipeline = async (
    promptText: string,
    options: ProgressivePrdPipelineOptions = {},
    platform?: ProjectPlatform,
): Promise<PrdPipelineResult> => {
    const { onStatus, onPartial, onProgress, onSectionStatus, signal } = options;

    const fastModel = getFastModel();
    const strongModel = getStrongModel();
    const overallStart = performance.now();
    const passes: GenerationPassRecord[] = [];

    // Per-section start times for duration tracking.
    const sectionStarts: Record<string, number> = {};
    // Accumulate partial results for progressive onPartial emissions.
    const partialResults: Record<string, Partial<StructuredPRD> | null> = {};

    onStatus?.('Starting progressive PRD generation…');
    onProgress?.('Sending request to model…');

    const { jobs, results } = await generateProgressivePrd({
        prompt: promptText,
        platform,
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
            if (event.type === 'section_started') {
                sectionStarts[event.sectionId] = performance.now();
                onProgress?.(`Generating ${
                    DEFAULT_PRD_SECTIONS.find(s => s.id === event.sectionId)?.title ?? event.sectionId
                } (${event.modelTier === 'fast' ? 'Flash' : 'Pro'})…`);
                onSectionStatus?.(event.sectionId as SectionId, {
                    tier: event.modelTier === 'fast' ? 'fast' : 'strong',
                    status: 'generating',
                    model: event.model,
                });
            } else if (event.type === 'section_completed') {
                const ms = performance.now() - (sectionStarts[event.sectionId] ?? overallStart);
                const section = DEFAULT_PRD_SECTIONS.find(s => s.id === event.sectionId);
                const tier = section ? selectModelTier(section.risk) : 'strong';
                onProgress?.(`✓ ${section?.title ?? event.sectionId} (${tier === 'fast' ? 'Flash' : 'Pro'}) · ${(ms / 1000).toFixed(1)}s`);
                onSectionStatus?.(event.sectionId as SectionId, {
                    tier: tier === 'fast' ? 'fast' : 'strong',
                    status: 'complete',
                    ms,
                });
                passes.push({ stage: event.sectionId, ms, ok: true });
            } else if (event.type === 'section_error') {
                const ms = performance.now() - (sectionStarts[event.sectionId] ?? overallStart);
                const section = DEFAULT_PRD_SECTIONS.find(s => s.id === event.sectionId);
                const tier = section ? selectModelTier(section.risk) : 'strong';
                onSectionStatus?.(event.sectionId as SectionId, {
                    tier: tier === 'fast' ? 'fast' : 'strong',
                    status: 'error',
                    ms,
                    error: event.error,
                });
                passes.push({ stage: event.sectionId, ms, ok: false });
            } else if (event.type === 'section_refining') {
                const section = DEFAULT_PRD_SECTIONS.find(s => s.id === event.sectionId);
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
    const structuredPRD = mergeSectionsToStructuredPrd(sectionResults);
    const markdown = renderPremiumMarkdown(structuredPRD);

    const failedSections = Object.values(jobs).filter(j => j.status === 'error');
    if (failedSections.length > 0) {
        console.warn(
            `[prd] ${failedSections.length} section(s) failed: ${failedSections.map(j => j.id).join(', ')}. ` +
            'Partial PRD rendered from completed sections.',
        );
    }

    const totalMs = performance.now() - overallStart;

    return {
        structuredPRD,
        markdown,
        generationMeta: {
            passes,
            totalMs,
            revised: false,
            schemaVersion: PRD_SCHEMA_VERSION,
        },
        model: `${fastModel} / ${strongModel}`,
    };
};
