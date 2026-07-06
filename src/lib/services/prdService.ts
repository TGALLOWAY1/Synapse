import type { StructuredPRD, ProjectPlatform } from '../../types';
import { callGemini } from '../geminiClient';
import type { ProviderOptions } from '../geminiClient';
import { runProgressivePrdPipeline, type ProgressivePrdPipelineOptions } from './progressivePrdPipeline';
import type { PrdPipelineResult } from './prdPipeline';
import { renderPremiumMarkdown } from './prdMarkdownRenderer';
import type { SectionId } from '../schemas/prdSchemas';
import type { SectionStatusUpdate } from './progressivePrdPipeline';
import { classifyProjectSafety, SafetyBlockedError, buildRestrictionDirective } from '../safety';
import type { SafetyClassificationResult } from '../safety';
import { buildClarificationPromptBlock, type PreflightContext } from '../prompts/preflightPrompts';

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
 * Runs the section-by-section DAG PRD pipeline (safety gate → concurrent
 * section generation → merge → silent consistency review) and returns the
 * final structured PRD.
 *
 * The legacy single-return signature is preserved so existing call sites
 * continue to compile. Callers that want the markdown and generation meta
 * should pass `options.onResult` (a richer callback) and use
 * `options.onPartial` to render the in-progress draft. The returned promise
 * still resolves with the final StructuredPRD for backwards compat.
 */
export const generateStructuredPRD = async (
    promptText: string,
    options?: ProviderOptions & {
        onPartial?: ProgressivePrdPipelineOptions['onPartial'];
        onProgress?: ProgressivePrdPipelineOptions['onProgress'];
        onSectionStatus?: (sectionId: SectionId, update: SectionStatusUpdate) => void;
        onResult?: (result: PrdPipelineResult) => void;
        /**
         * Fired once at completion with the assembled orchestration WorkflowRun
         * (per-section timings, tokens, concurrency/speedup metrics). Purely
         * observational — feeds the Metrics dashboard.
         */
        onWorkflowRun?: ProgressivePrdPipelineOptions['onWorkflowRun'];
        /**
         * Fired once the pre-generation safety classification completes, for
         * `allowed` and `allowed_with_restrictions` outcomes. `disallowed`
         * does NOT fire this — it throws `SafetyBlockedError` instead so the
         * pipeline hard-stops.
         */
        onSafety?: (result: SafetyClassificationResult) => void;
        /**
         * Optional preflight clarification context. When present (and
         * `mode !== 'none'`), the answered/skipped responses and summary are
         * appended to the prompt forwarded to every section, with an
         * instruction to treat answers as authoritative intent and skipped
         * questions as open unknowns.
         */
        preflight?: PreflightContext;
        /**
         * Consistency-review override. The final review runs by default and
         * silently; pass `false` only as a developer/debug override to skip it.
         * Undefined leaves the default-on behavior. See prdConsistencyReview.ts.
         */
        enableConsistencyReview?: ProgressivePrdPipelineOptions['enableConsistencyReview'];
        /** Rendering surface for observability logs. */
        surface?: ProgressivePrdPipelineOptions['surface'];
        /**
         * The user-chosen project name. When meaningful (not a generic
         * placeholder), it becomes the PRD's authoritative `productName` so the
         * name the user typed carries through to the PRD and downstream assets.
         */
        projectName?: ProgressivePrdPipelineOptions['projectName'];
    },
    platform?: ProjectPlatform,
): Promise<StructuredPRD> => {
    // --- Pre-generation safety gate (hard stop) -------------------------------
    // Classify the request before any section runs. A `disallowed` verdict
    // throws SafetyBlockedError, so no PRD sections are ever generated and the
    // section-by-section refusal failure mode cannot occur.
    options?.onStatus?.('Reviewing request…');
    options?.onProgress?.('Reviewing request for safety…');
    const safety = await classifyProjectSafety(promptText, { signal: options?.signal });
    if (safety.classification === 'disallowed') {
        throw new SafetyBlockedError(safety);
    }
    options?.onSafety?.(safety);

    // For allowed_with_restrictions, constrain generation by appending a
    // binding directive to the prompt forwarded to every section.
    const withRestrictions =
        safety.classification === 'allowed_with_restrictions'
            ? `${promptText}\n\n${buildRestrictionDirective(safety)}`
            : promptText;

    // Append preflight clarification context (kept AFTER the safety gate so a
    // disallowed idea can never reach this point).
    const effectivePrompt =
        options?.preflight && options.preflight.mode !== 'none'
            ? `${withRestrictions}\n\n${buildClarificationPromptBlock(options.preflight)}`
            : withRestrictions;

    options?.onStatus?.('Generating structured PRD with Gemini...');

    const result = await runProgressivePrdPipeline(
        effectivePrompt,
        {
            onStatus: options?.onStatus,
            onPartial: options?.onPartial,
            onProgress: options?.onProgress,
            onSectionStatus: options?.onSectionStatus,
            signal: options?.signal,
            enableConsistencyReview: options?.enableConsistencyReview,
            surface: options?.surface,
            onWorkflowRun: options?.onWorkflowRun,
            projectName: options?.projectName,
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
