// Multi-pass PRD generation orchestrator.
//
// Pass A — Strategy + Architecture (heavy lift, JSON, big schema, T=0.4)
// Pass B — Self-Score (small, JSON, T=0.2) — markdown is rendered locally
// Pass C — Conditional Revision (medium, JSON, T=0.3, only if min score < 4)
//
// Markdown is always produced by the deterministic renderer in
// prdMarkdownRenderer.ts; the LLM only contributes structured JSON and
// rubric scores. Progressive render: the caller can read the Pass A output
// via onPartial before Pass B finishes, so the UI can paint immediately.

import {
    callGemini,
    callGeminiStream,
    DEFAULT_GEMINI_MODEL,
    type ProviderOptions,
} from '../geminiClient';
import {
    structuredPRDSchema,
    scoreSchema,
    revisionPatchSchema,
} from '../schemas/prdSchemas';
import {
    buildStrategySystemInstruction,
    buildScoreInstruction,
    buildRevisionInstruction,
} from '../prompts/prdPrompts';
import { renderPremiumMarkdown } from './prdMarkdownRenderer';
import type {
    StructuredPRD,
    QualityScores,
    GenerationMeta,
    GenerationPassRecord,
    ProjectPlatform,
} from '../../types';

export const PRD_SCHEMA_VERSION = 2;
const MIN_PASSING_SCORE = 4;

const RUBRIC_KEYS: (keyof QualityScores)[] = [
    'specificity',
    'uxUsefulness',
    'engineeringUsefulness',
    'strategicClarity',
    'formatting',
    'acceptanceCriteria',
    'downstreamReadiness',
];

const minRubricScore = (scores: QualityScores): number => {
    return RUBRIC_KEYS.reduce((min, k) => {
        const v = scores[k];
        return typeof v === 'number' ? Math.min(min, v) : min;
    }, Infinity);
};

export interface PrdPipelineOptions extends ProviderOptions {
    /**
     * Called once Pass A completes with the initial structured PRD and
     * client-rendered markdown. Lets the UI show a draft before Pass B
     * (rendering + scoring) finishes.
     */
    onPartial?: (partial: { structuredPRD: StructuredPRD; markdown: string }) => void;
    /**
     * Fine-grained progress events suitable for a live status feed. Emitted
     * during Pass A streaming and at each pass boundary. Receivers should
     * de-duplicate consecutive identical messages.
     */
    onProgress?: (message: string) => void;
    signal?: AbortSignal;
}

export interface PrdPipelineResult {
    structuredPRD: StructuredPRD;
    markdown: string;
    qualityScores?: QualityScores;
    generationMeta: GenerationMeta;
    model: string;
}

/**
 * Run the full multi-pass PRD generation pipeline. Always resolves with at
 * least Pass A's StructuredPRD + client-rendered markdown — Pass B/C failures
 * degrade gracefully (no scores, but the PRD is still saved).
 */
export const runPrdPipeline = async (
    promptText: string,
    options: PrdPipelineOptions = {},
    platform?: ProjectPlatform,
): Promise<PrdPipelineResult> => {
    const { onStatus, onPartial, onProgress, signal } = options;
    const passes: GenerationPassRecord[] = [];
    const overallStart = performance.now();

    const phasedStrategyLabel = (chars: number): string => {
        if (chars < 800) return `Drafting vision and target users… (${chars.toLocaleString()} chars)`;
        if (chars < 2200) return `Designing UX architecture and feature specs… (${chars.toLocaleString()} chars)`;
        if (chars < 4200) return `Defining data model and acceptance criteria… (${chars.toLocaleString()} chars)`;
        return `Wrapping up structured PRD… (${chars.toLocaleString()} chars)`;
    };

    // Resolve which model is being used (for storage/audit). Mirror the
    // logic in callGemini so we report the same value even if jsonMode.model
    // is unset.
    const model = (typeof localStorage !== 'undefined'
        ? localStorage.getItem('GEMINI_MODEL')
        : null) || DEFAULT_GEMINI_MODEL;

    // --- Pass A: Strategy ---
    onStatus?.('Drafting strategy…');
    onProgress?.('Sending request to model…');
    const passAStart = performance.now();
    let structuredPRD: StructuredPRD;
    try {
        let chars = 0;
        let lastEmitChars = 0;
        let lastEmitAt = performance.now();
        const result = await callGeminiStream(
            buildStrategySystemInstruction(platform),
            `User's product idea:\n\n${promptText}`,
            {
                onChunk: (text) => {
                    chars += text.length;
                    const now = performance.now();
                    if (chars - lastEmitChars >= 250 || now - lastEmitAt >= 350) {
                        lastEmitChars = chars;
                        lastEmitAt = now;
                        onProgress?.(phasedStrategyLabel(chars));
                    }
                },
                onComplete: () => {},
                onError: () => {},
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
        // Pass A failure is fatal — there's nothing to render.
        throw e;
    }

    // Progressive render: client-render the Pass A draft so the UI can paint.
    let markdown = renderPremiumMarkdown(structuredPRD);
    onPartial?.({ structuredPRD, markdown });

    // --- Pass B: Self-Score ---
    onStatus?.('Quality review…');
    onProgress?.('Running quality review…');
    const passBStart = performance.now();
    let qualityScores: QualityScores | undefined;
    let weakestDimensions: string[] = [];
    try {
        const result = await callGemini(
            buildScoreInstruction(),
            `PRD JSON:\n\n${JSON.stringify(structuredPRD)}`,
            {
                responseMimeType: 'application/json',
                responseSchema: scoreSchema,
                temperature: 0.2,
            },
            signal,
        );
        const parsed = JSON.parse(result) as {
            qualityScores: QualityScores;
            weakestDimensions: string[];
        };
        qualityScores = parsed.qualityScores;
        weakestDimensions = parsed.weakestDimensions || [];
        passes.push({ stage: 'render_score', ms: performance.now() - passBStart, ok: true });
    } catch (e) {
        // Pass B failure is non-fatal — the PRD ships without scores.
        if ((e as { name?: string })?.name === 'AbortError') throw e;
        passes.push({ stage: 'render_score', ms: performance.now() - passBStart, ok: false });
        console.warn('[PRD pipeline] Pass B failed; shipping PRD without scores', e);
    }

    // --- Pass C: Conditional Revision ---
    let revised = false;
    if (qualityScores && minRubricScore(qualityScores) < MIN_PASSING_SCORE) {
        onStatus?.('Revising weak sections…');
        onProgress?.('Revising weak sections…');
        const passCStart = performance.now();
        try {
            const result = await callGemini(
                buildRevisionInstruction(),
                `Inputs:\n\n${JSON.stringify({
                    current: structuredPRD,
                    scores: qualityScores,
                    weakestDimensions,
                })}`,
                {
                    responseMimeType: 'application/json',
                    responseSchema: revisionPatchSchema,
                    temperature: 0.3,
                },
                signal,
            );
            const patch = JSON.parse(result) as Partial<StructuredPRD>;
            // Top-level merge — Pass C is instructed to return whole arrays /
            // objects for the sections it wants to replace.
            structuredPRD = { ...structuredPRD, ...patch };
            // Re-render markdown deterministically; skip a 4th LLM call.
            markdown = renderPremiumMarkdown(structuredPRD);
            revised = true;
            passes.push({ stage: 'revision', ms: performance.now() - passCStart, ok: true });
        } catch (e) {
            if ((e as { name?: string })?.name === 'AbortError') throw e;
            passes.push({ stage: 'revision', ms: performance.now() - passCStart, ok: false });
            console.warn('[PRD pipeline] Pass C failed; keeping pre-revision PRD', e);
        }
    }

    const generationMeta: GenerationMeta = {
        passes,
        totalMs: performance.now() - overallStart,
        revised,
        schemaVersion: PRD_SCHEMA_VERSION,
    };

    return { structuredPRD, markdown, qualityScores, generationMeta, model };
};
