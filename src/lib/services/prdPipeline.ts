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
    const { onStatus, onPartial, signal } = options;
    const passes: GenerationPassRecord[] = [];
    const overallStart = performance.now();

    // Resolve which model is being used (for storage/audit). Mirror the
    // logic in callGemini so we report the same value even if jsonMode.model
    // is unset.
    const model = (typeof localStorage !== 'undefined'
        ? localStorage.getItem('GEMINI_MODEL')
        : null) || DEFAULT_GEMINI_MODEL;

    // --- Pass A: Strategy ---
    onStatus?.('Drafting strategy…');
    const passAStart = performance.now();
    let structuredPRD: StructuredPRD;
    try {
        const result = await callGemini(
            buildStrategySystemInstruction(platform),
            `User's product idea:\n\n${promptText}`,
            {
                responseMimeType: 'application/json',
                responseSchema: structuredPRDSchema,
                temperature: 0.4,
                topP: 0.9,
            },
            signal,
        );
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
