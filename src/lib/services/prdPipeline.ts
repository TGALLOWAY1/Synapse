// Single-pass PRD generation. The model produces the full extended
// StructuredPRD JSON in one streamed call; the rubric is baked into the
// system prompt so we trust the first response. Markdown is rendered
// deterministically on the client.

import {
    callGeminiStream,
    DEFAULT_GEMINI_MODEL,
    type ProviderOptions,
} from '../geminiClient';
import { structuredPRDSchema } from '../schemas/prdSchemas';
import { buildStrategySystemInstruction } from '../prompts/prdPrompts';
import { renderPremiumMarkdown } from './prdMarkdownRenderer';
import type {
    StructuredPRD,
    QualityScores,
    GenerationMeta,
    GenerationPassRecord,
    ProjectPlatform,
} from '../../types';

export const PRD_SCHEMA_VERSION = 2;

export interface PrdPipelineOptions extends ProviderOptions {
    /**
     * Called once Pass A completes with the structured PRD and
     * client-rendered markdown. Kept for API compatibility with the legacy
     * multi-pass pipeline; in single-pass mode it's emitted right before
     * the final result.
     */
    onPartial?: (partial: { structuredPRD: StructuredPRD; markdown: string }) => void;
    /**
     * Fine-grained progress events suitable for a live status feed. Emitted
     * at the four phase boundaries during streaming. Receivers should
     * de-duplicate consecutive identical messages.
     */
    onProgress?: (message: string) => void;
    signal?: AbortSignal;
}

export interface PrdPipelineResult {
    structuredPRD: StructuredPRD;
    markdown: string;
    /** Always undefined now — the multi-pass scoring step was removed. */
    qualityScores?: QualityScores;
    generationMeta: GenerationMeta;
    model: string;
}

/**
 * Run the single-pass PRD generation pipeline. Resolves with the parsed
 * StructuredPRD plus deterministically-rendered markdown.
 */
export const runPrdPipeline = async (
    promptText: string,
    options: PrdPipelineOptions = {},
    platform?: ProjectPlatform,
): Promise<PrdPipelineResult> => {
    const { onStatus, onPartial, onProgress, signal } = options;
    const passes: GenerationPassRecord[] = [];
    const overallStart = performance.now();

    const phaseFor = (chars: number): string => {
        if (chars < 800) return 'Drafting vision and target users…';
        if (chars < 2200) return 'Designing UX architecture and feature specs…';
        if (chars < 4200) return 'Defining data model and acceptance criteria…';
        return 'Wrapping up structured PRD…';
    };

    // Resolve which model is being used (for storage/audit). Mirror the
    // logic in callGemini so we report the same value even if jsonMode.model
    // is unset.
    const model = (typeof localStorage !== 'undefined'
        ? localStorage.getItem('GEMINI_MODEL')
        : null) || DEFAULT_GEMINI_MODEL;

    onStatus?.('Drafting strategy…');
    onProgress?.('Sending request to model…');
    const passAStart = performance.now();
    let structuredPRD: StructuredPRD;
    try {
        let chars = 0;
        let lastPhase = '';
        const result = await callGeminiStream(
            buildStrategySystemInstruction(platform),
            `User's product idea:\n\n${promptText}`,
            {
                onChunk: (text) => {
                    chars += text.length;
                    const phase = phaseFor(chars);
                    if (phase !== lastPhase) {
                        lastPhase = phase;
                        onProgress?.(phase);
                    }
                },
                onComplete: () => {},
                onError: () => {},
                onRestart: () => {
                    // Stream was retried after a network drop — reset our
                    // local accumulators so phase emissions track the new
                    // attempt rather than the abandoned one.
                    chars = 0;
                    lastPhase = '';
                    onProgress?.('Connection dropped — retrying…');
                },
            },
            signal,
            {
                responseMimeType: 'application/json',
                responseSchema: structuredPRDSchema,
                temperature: 0.4,
                topP: 0.9,
            },
        );
        onProgress?.('Parsing structured PRD…');
        structuredPRD = JSON.parse(result) as StructuredPRD;
        passes.push({ stage: 'strategy', ms: performance.now() - passAStart, ok: true });
    } catch (e) {
        passes.push({ stage: 'strategy', ms: performance.now() - passAStart, ok: false });
        throw e;
    }

    const markdown = renderPremiumMarkdown(structuredPRD);
    onPartial?.({ structuredPRD, markdown });

    const generationMeta: GenerationMeta = {
        passes,
        totalMs: performance.now() - overallStart,
        revised: false,
        schemaVersion: PRD_SCHEMA_VERSION,
    };

    return { structuredPRD, markdown, generationMeta, model };
};
