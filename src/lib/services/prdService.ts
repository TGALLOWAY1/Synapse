import type { StructuredPRD, ProjectPlatform } from '../../types';
import { callGemini } from '../geminiClient';
import type { ProviderOptions } from '../geminiClient';
import { runPrdPipeline, type PrdPipelineOptions, type PrdPipelineResult } from './prdPipeline';
import { renderPremiumMarkdown } from './prdMarkdownRenderer';

export const enhancePrompt = async (rawPrompt: string): Promise<string> => {
    const system = `You are an expert product consultant. The user has written a rough product idea. Your job is to expand it into a clear, detailed product description that will produce an excellent PRD.

Rules:
- Keep the user's core idea and intent intact
- Add specificity: target users, key features, differentiators, and technical considerations
- Keep it to 2-3 paragraphs maximum
- Write in a natural, descriptive style (not bullet points)
- Do NOT add markdown formatting
- Return ONLY the enhanced prompt text, nothing else`;

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
        onPartial?: PrdPipelineOptions['onPartial'];
        onProgress?: PrdPipelineOptions['onProgress'];
        onResult?: (result: PrdPipelineResult) => void;
    },
    platform?: ProjectPlatform,
): Promise<StructuredPRD> => {
    options?.onStatus?.('Generating structured PRD with Gemini...');

    const result = await runPrdPipeline(
        promptText,
        {
            onStatus: options?.onStatus,
            onPartial: options?.onPartial,
            onProgress: options?.onProgress,
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
