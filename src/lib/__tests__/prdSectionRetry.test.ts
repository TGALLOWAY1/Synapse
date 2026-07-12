import { describe, expect, it, vi } from 'vitest';
import type { StructuredPRD } from '../../types';
import type { SectionId } from '../schemas/prdSchemas';

// Mock the Gemini transport so retries run offline.
vi.mock('../geminiClient', () => ({
    callGemini: vi.fn(async () => '{}'),
    getFastModel: () => 'fast-model',
    getStrongModel: () => 'strong-model',
}));

import { regeneratePrdSection } from '../services/prdSectionRetry';

const legacyPrd: StructuredPRD = {
    vision: 'Invoicing for freelancers',
    targetUsers: ['Freelancers'],
    coreProblem: 'Manual invoicing is slow',
    features: [],
    architecture: 'SPA + serverless',
    risks: ['Adoption'],
};

describe('regeneratePrdSection retired-section handling', () => {
    // The retired data_model / implementation_plan sections were removed from
    // the graph and schema; a legacy failedSections entry referencing one now
    // surfaces the standard unknown-section error (graceful degradation).
    it('throws on a retired data_model section id', async () => {
        await expect(
            regeneratePrdSection('data_model' as SectionId, 'An invoicing app', legacyPrd),
        ).rejects.toThrow('Unknown PRD section: data_model');
    });

    it('throws on a retired implementation_plan section id', async () => {
        await expect(
            regeneratePrdSection('implementation_plan' as SectionId, 'An invoicing app', legacyPrd),
        ).rejects.toThrow('Unknown PRD section: implementation_plan');
    });

    it('still retries an active section', async () => {
        const result = await regeneratePrdSection('quality_risks', 'An invoicing app', legacyPrd);
        expect(result.structuredPRD.coreProblem).toBe('Manual invoicing is slow');
    });
});
