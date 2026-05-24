import type { StructuredPRD, ProjectPlatform } from '../../types';
import { callGemini } from '../geminiClient';
import type { ProviderOptions } from '../geminiClient';
import { runProgressivePrdPipeline, type ProgressivePrdPipelineOptions } from './progressivePrdPipeline';
import type { PrdPipelineResult } from './prdPipeline';
import { renderPremiumMarkdown } from './prdMarkdownRenderer';
import type { SectionId } from '../schemas/prdSchemas';
import type { SectionStatusUpdate } from './progressivePrdPipeline';

export const enhancePrompt = async (rawPrompt: string): Promise<string> => {
    const system = `You are a senior product consultant. The user has written a rough product idea. Expand it into a clear, grounded product description that will support a high-quality PRD.

Rules:
- Preserve the user's core idea and intent exactly; do not redirect the concept.
- Add specificity: target users, key features, differentiators, and technical considerations.
- Use formal, professional, implementation-ready language. Do not use marketing language, hype, or subjective descriptors such as "powerful", "seamless", or "cutting-edge".
- Do not hedge or speculate. State concrete details; where a detail is inferred, phrase it as a clearly grounded assumption.
- Keep it to 2-3 paragraphs maximum.
- Write in natural, descriptive prose, not bullet points.
- Do NOT add markdown formatting.
- Return ONLY the enhanced prompt text, nothing else.`;

    return await callGemini(system, rawPrompt);
};

/**
 * Runs the multi-pass PRD generation pipeline (Strategy → Render+Score →
 * conditional Revision) and returns the final structured PRD.
 *
 * The legacy single-return signature is preserved so existing call sites
 * continue to compile. Callers that want the markdown, quality scores, and
 * generation meta should pass `options.onResult` (a richer callback) and use
 * `options.onPartial` to render the Pass A draft progressively. The returned
 * promise still resolves with the final StructuredPRD for backwards compat.
 */
export const generateStructuredPRD = async (
    promptText: string,
    options?: ProviderOptions & {
        onPartial?: ProgressivePrdPipelineOptions['onPartial'];
        onProgress?: ProgressivePrdPipelineOptions['onProgress'];
        onSectionStatus?: (sectionId: SectionId, update: SectionStatusUpdate) => void;
        onResult?: (result: PrdPipelineResult) => void;
    },
    platform?: ProjectPlatform,
): Promise<StructuredPRD> => {
    options?.onStatus?.('Generating structured PRD with Gemini...');

    const result = await runProgressivePrdPipeline(
        promptText,
        {
            onStatus: options?.onStatus,
            onPartial: options?.onPartial,
            onProgress: options?.onProgress,
            onSectionStatus: options?.onSectionStatus,
            signal: options?.signal,
        },
        platform,
    );

    options?.onResult?.(result);
    return result.structuredPRD;
};

/**
 * Convert a StructuredPRD to canonical premium markdown. Delegated to the
 * deterministic renderer in prdMarkdownRenderer.ts so legacy call sites and
 * the new pipeline produce identical output.
 */
export const structuredPRDToMarkdown = (prd: StructuredPRD): string => {
    return renderPremiumMarkdown(prd);
};
