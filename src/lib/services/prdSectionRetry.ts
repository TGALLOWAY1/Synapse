// Single-section PRD retry. Re-runs exactly one failed section using the
// already-completed PRD as upstream context, then overlays the new slice onto
// the existing StructuredPRD. Keeps every other section's content intact — the
// full DAG pipeline is never re-run.

import { callGemini } from '../geminiClient';
import { getFastModel, getStrongModel } from '../geminiClient';
import type { StructuredPRD, ProjectPlatform } from '../../types';
import { type SectionId, SECTION_SCHEMAS } from '../schemas/prdSchemas';
import { buildSectionPrompt } from '../prompts/prdSectionPrompts';
import { renderPremiumMarkdown } from './prdMarkdownRenderer';
import { sanitizeRolePermissions } from '../prdRolesSanitizer';
import {
    DEFAULT_PRD_SECTIONS,
    RETIRED_PRD_SECTIONS,
    selectModelTier,
    parseSectionJson,
} from './progressivePrdGeneration';
import type { SectionStatusUpdate } from './progressivePrdPipeline';

export type RetrySectionResult = {
    structuredPRD: StructuredPRD;
    markdown: string;
    model: string;
    ms: number;
};

export type RetrySectionOptions = {
    platform?: ProjectPlatform;
    signal?: AbortSignal;
    onSectionStatus?: (sectionId: SectionId, update: SectionStatusUpdate) => void;
};

/**
 * Re-run a single PRD section and merge the result back into `currentPRD`.
 *
 * Sections own disjoint top-level StructuredPRD fields, so a shallow overlay
 * (`{ ...currentPRD, ...parsed }`) replaces only this section's fields while
 * preserving every other section. Throws if the section returns unparseable
 * JSON or the request fails; the caller's `onSectionStatus` is updated to
 * `error` before the throw so the progress UI can keep its retry affordance.
 */
export const regeneratePrdSection = async (
    sectionId: SectionId,
    promptText: string,
    currentPRD: StructuredPRD,
    options: RetrySectionOptions = {},
): Promise<RetrySectionResult> => {
    const { platform, signal, onSectionStatus } = options;

    // RETIRED_PRD_SECTIONS keeps retry working for legacy spines whose
    // failedSections reference a section no longer in the default graph.
    const template = [...DEFAULT_PRD_SECTIONS, ...RETIRED_PRD_SECTIONS].find((s) => s.id === sectionId);
    if (!template) {
        throw new Error(`Unknown PRD section: ${sectionId}`);
    }

    const tier = selectModelTier(template.risk);
    const uiTier = tier === 'fast' ? 'fast' : 'strong';
    const model = tier === 'fast' ? getFastModel() : getStrongModel();

    onSectionStatus?.(sectionId, {
        tier: uiTier,
        status: 'generating',
        model,
        estimatedSeconds: template.estimatedSeconds,
    });

    const start = performance.now();
    try {
        const { system, user } = buildSectionPrompt(sectionId, {
            idea: promptText,
            platform,
            upstream: currentPRD,
        });

        const raw = await callGemini(
            '',
            `${system}\n\n${user}`,
            {
                responseMimeType: 'application/json',
                responseSchema: SECTION_SCHEMAS[sectionId],
                model,
                maxOutputTokens: 8192,
                temperature: 0.4,
                topP: 0.9,
            },
            signal,
        );

        const parsed = parseSectionJson(raw);
        if (!parsed) {
            throw new Error(`Section "${sectionId}" returned unparseable JSON`);
        }

        const structuredPRD = { ...currentPRD, ...parsed } as StructuredPRD;
        // Repair a re-run ux_loops slice the same way the full merge does, so a
        // single-section retry can't reintroduce implementation-detail roles.
        if (structuredPRD.roles) structuredPRD.roles = sanitizeRolePermissions(structuredPRD.roles);
        const markdown = renderPremiumMarkdown(structuredPRD);
        const ms = performance.now() - start;

        onSectionStatus?.(sectionId, { tier: uiTier, status: 'complete', ms });

        return { structuredPRD, markdown, model, ms };
    } catch (e) {
        const ms = performance.now() - start;
        onSectionStatus?.(sectionId, {
            tier: uiTier,
            status: 'error',
            ms,
            error: e instanceof Error ? e.message : 'Unknown error',
        });
        throw e;
    }
};
