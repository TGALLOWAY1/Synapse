// Shared types for the PRD generation pipeline.
//
// The single-pass `runPrdPipeline` function that previously lived here was
// replaced by the section-by-section `runProgressivePrdPipeline` in
// `progressivePrdPipeline.ts`, which is the only PRD entry point now wired
// through `prdService.ts`. The interfaces and schema-version constant below
// are kept here because the progressive pipeline reuses them as its public
// contract.

import type { ProviderOptions } from '../geminiClient';
import type {
    StructuredPRD,
    QualityScores,
    GenerationMeta,
} from '../../types';

export const PRD_SCHEMA_VERSION = 2;

export interface PrdPipelineOptions extends ProviderOptions {
    /**
     * Emitted once the structured PRD and client-rendered markdown are
     * ready, before the pipeline resolves.
     */
    onPartial?: (partial: { structuredPRD: StructuredPRD; markdown: string }) => void;
    /**
     * Fine-grained progress events suitable for a live status feed.
     * Receivers should de-duplicate consecutive identical messages.
     */
    onProgress?: (message: string) => void;
    signal?: AbortSignal;
}

export interface PrdPipelineResult {
    structuredPRD: StructuredPRD;
    markdown: string;
    /** Retained for backward compatibility with persisted projects from the
     *  removed multi-pass scoring pipeline; never populated by current code. */
    qualityScores?: QualityScores;
    generationMeta: GenerationMeta;
    model: string;
}
