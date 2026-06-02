import type { DomainEntity, PrimaryAction, ProjectPlatform } from '../../types';
import { callGemini } from '../geminiClient';
import { buildSectionPrompt } from '../prompts/prdSectionPrompts';
import { groundingSliceSchema } from '../schemas/prdSchemas';
import { parseSectionJson } from './progressivePrdGeneration';
import { classifyProjectSafety, SafetyBlockedError } from '../safety';

export interface GroundingFields {
    domainEntities?: DomainEntity[];
    primaryActions?: PrimaryAction[];
}

/**
 * Narrow backfill regenerator for the Phase B grounding fields
 * (`domainEntities` / `primaryActions`). Used by `StructuredPRDView` to fill in
 * older PRDs that predate those fields.
 *
 * Unlike the previous implementation — which ran the full 10-section PRD
 * pipeline and discarded everything but two fields — this makes a single
 * grounding-section JSON call. It still runs the safety classifier first
 * (fail-closed): a `disallowed` verdict throws `SafetyBlockedError`. Because it
 * only ever requests the two grounding fields, it can never emit a
 * partially-filled PRD.
 */
export const regenerateGroundingFields = async (
    summary: string,
    platform?: ProjectPlatform,
    signal?: AbortSignal,
): Promise<GroundingFields> => {
    const safety = await classifyProjectSafety(summary, { signal });
    if (safety.classification === 'disallowed') {
        throw new SafetyBlockedError(safety);
    }

    const { system, user } = buildSectionPrompt('grounding', {
        idea: summary,
        platform,
        upstream: {},
    });

    const raw = await callGemini('', `${system}\n\n${user}`, {
        responseMimeType: 'application/json',
        responseSchema: groundingSliceSchema,
        maxOutputTokens: 8192,
        temperature: 0.4,
        topP: 0.9,
    }, signal);

    const parsed = parseSectionJson(raw);
    if (!parsed) {
        throw new Error('Grounding regeneration returned unparseable JSON');
    }

    return {
        domainEntities: parsed.domainEntities,
        primaryActions: parsed.primaryActions,
    };
};
