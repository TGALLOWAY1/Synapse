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
import { buildRestrictionDirective } from '../safety/safetyReviewArtifact';
import type { SafetyClassificationResult, SpineSafetyReview } from '../safety/safetyTypes';
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
    /**
     * The spine's persisted safety review. For a `restricted` run the binding
     * restriction directive is re-appended to the idea exactly as
     * `generateStructuredPRD` does on a full run — without this, a restricted
     * project's section retry would regenerate with only the generic safety
     * override, silently dropping its specific constraints.
     */
    safetyReview?: SpineSafetyReview;
};

/**
 * Rebuild the restriction directive from a persisted `SpineSafetyReview`.
 * Mirrors `canonicalPrdSpine.buildSafety`: the review lacks `confidence`,
 * which the directive builder does not use, so a placeholder is safe.
 */
const restrictionDirectiveFromReview = (review: SpineSafetyReview | undefined): string | null => {
    if (!review) return null;
    const restricted =
        review.status === 'restricted' || review.classification === 'allowed_with_restrictions';
    if (!restricted) return null;
    const asResult: SafetyClassificationResult = {
        classification: review.classification,
        confidence: 'medium',
        detectedConcerns: review.detectedConcerns,
        userFacingReason: review.userFacingReason,
        safeAlternatives: review.safeAlternatives,
    };
    return buildRestrictionDirective(asResult);
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
    const { platform, signal, onSectionStatus, safetyReview } = options;

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
        // Re-apply the restriction directive for restricted projects (the
        // stored promptText is the raw idea — the directive was appended
        // downstream of it on the original run).
        const restrictionDirective = restrictionDirectiveFromReview(safetyReview);
        const effectiveIdea = restrictionDirective
            ? `${promptText}\n\n${restrictionDirective}`
            : promptText;

        const { system, user } = buildSectionPrompt(sectionId, {
            idea: effectiveIdea,
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
                traceMeta: {
                    stage: 'PRD',
                    purpose: `Retry section: ${template.title}`,
                    artifact: sectionId,
                    inputs: ['Product idea', 'Current PRD (upstream context)'],
                },
            },
            signal,
        );

        const parsed = parseSectionJson(raw);
        if (!parsed) {
            throw new Error(`Section "${sectionId}" returned unparseable JSON`);
        }

        const structuredPRD = preserveUserReviewState(currentPRD, { ...currentPRD, ...parsed } as StructuredPRD);
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

/** Model section schemas intentionally omit human review fields. Preserve
 * those fields by stable entity id so retrying generated content can never
 * erase explicit user authority. */
export function preserveUserReviewState(current: StructuredPRD, generated: StructuredPRD): StructuredPRD {
    const assumptionsById = new Map((current.assumptions ?? []).map(item => [item.id, item]));
    const featuresById = new Map((current.features ?? []).map(item => [item.id, item]));
    return {
        ...generated,
        assumptions: generated.assumptions?.map(item => {
            const prior = assumptionsById.get(item.id);
            if (!prior?.decision) return item;
            return {
                ...item,
                decision: prior.decision,
                decisionNote: prior.decisionNote,
                decidedAt: prior.decidedAt,
            };
        }),
        features: (generated.features ?? []).map(item => {
            const prior = featuresById.get(item.id);
            if (!prior?.confirmed) return item;
            return { ...item, confirmed: true, confirmedAt: prior.confirmedAt };
        }),
    };
}
