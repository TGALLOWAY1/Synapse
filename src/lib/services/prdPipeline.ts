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
import { repairTruncatedJson } from '../jsonRepair';
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
        let finishReason: string | undefined;
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
                onFinish: (info) => {
                    finishReason = info.finishReason;
                },
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
                // Pin to the model's full headroom so a rich PRD doesn't
                // truncate inside a string at the default ~8K cap.
                maxOutputTokens: 32768,
            },
        );
        onProgress?.('Parsing structured PRD…');
        structuredPRD = parseStructuredPrd(result, finishReason);
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

/**
 * Parse the streamed JSON-mode response into a StructuredPRD. If the raw
 * text fails to parse and Gemini reported MAX_TOKENS (or the parse error
 * looks like truncation), try a best-effort repair before giving up. On
 * unrecoverable failure, throw a clearer error than the bare
 * `Unterminated string in JSON` message Gemini's truncated output
 * produces — this is what `errors.ts` classifies and surfaces to the user.
 */
const parseStructuredPrd = (raw: string, finishReason?: string): StructuredPRD => {
    try {
        return JSON.parse(raw) as StructuredPRD;
    } catch (parseErr) {
        const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
        const looksTruncated =
            finishReason === 'MAX_TOKENS' ||
            /unterminated|unexpected end of (json|data)|expected ['"a-z]/i.test(msg);

        if (looksTruncated) {
            const { text: repaired, repaired: didRepair } = repairTruncatedJson(raw);
            if (didRepair) {
                try {
                    const parsed = JSON.parse(repaired) as StructuredPRD;
                    console.warn(
                        `[prd] response was truncated (finishReason=${finishReason ?? 'unknown'}, ${raw.length} chars) — recovered via JSON repair. The PRD may be missing trailing sections.`,
                    );
                    return parsed;
                } catch {
                    // fall through to throw
                }
            }
            throw new Error(
                `The PRD response was truncated before it could be completed (finishReason=${finishReason ?? 'unknown'}). ` +
                `This usually means the model hit its output token limit on a long PRD. ` +
                `Try a shorter prompt, or switch to a model with more output capacity in Settings. ` +
                `Raw parse error: ${msg}`,
            );
        }
        throw parseErr;
    }
};
