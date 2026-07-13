import { describe, expect, it, vi } from 'vitest';
import type { StructuredPRD } from '../../types';

// Mock the Gemini transport so retries run offline. The data_model prompt
// returns a rich data model slice; everything else returns an empty slice.
vi.mock('../geminiClient', () => ({
    callGemini: vi.fn(async (_system: string, prompt: string) => {
        if (prompt.includes('richDataModel')) {
            return JSON.stringify({
                richDataModel: {
                    entities: [{ name: 'Invoice', fields: [{ name: 'id', type: 'string' }] }],
                },
            });
        }
        return '{}';
    }),
    getFastModel: () => 'fast-model',
    getStrongModel: () => 'strong-model',
}));

import { preserveUserReviewState, regeneratePrdSection } from '../services/prdSectionRetry';

const legacyPrd: StructuredPRD = {
    vision: 'Invoicing for freelancers',
    targetUsers: ['Freelancers'],
    coreProblem: 'Manual invoicing is slow',
    features: [],
    architecture: 'SPA + serverless',
    risks: ['Adoption'],
};

describe('regeneratePrdSection retired-section back-compat', () => {
    it('retries the retired data_model section for legacy failedSections without throwing', async () => {
        const result = await regeneratePrdSection('data_model', 'An invoicing app', legacyPrd);
        // The regenerated slice is overlaid; every other section's fields survive.
        expect(result.structuredPRD.richDataModel?.entities?.[0]?.name).toBe('Invoice');
        expect(result.structuredPRD.vision).toBe('Invoicing for freelancers');
        expect(result.markdown).toContain('Invoice');
    });

    it('retries the retired implementation_plan section without throwing', async () => {
        const result = await regeneratePrdSection('implementation_plan', 'An invoicing app', legacyPrd);
        expect(result.structuredPRD.vision).toBe('Invoicing for freelancers');
    });

    it('still retries an active section', async () => {
        const result = await regeneratePrdSection('quality_risks', 'An invoicing app', legacyPrd);
        expect(result.structuredPRD.coreProblem).toBe('Manual invoicing is slow');
    });
});

describe('preserveUserReviewState', () => {
    it('keeps assumption verdicts and feature confirmations by stable id', () => {
        const current: StructuredPRD = {
            ...legacyPrd,
            assumptions: [{ id: 'a1', statement: 'Old wording', confidence: 'med', decision: 'rejected', decisionNote: 'Corrected truth', decidedAt: 10 }],
            features: [{ id: 'f1', name: 'Invoices', description: 'Old', userValue: 'Value', complexity: 'low', confirmed: true, confirmedAt: 11 }],
        };
        const generated: StructuredPRD = {
            ...legacyPrd,
            assumptions: [{ id: 'a1', statement: 'New wording', confidence: 'high' }],
            features: [{ id: 'f1', name: 'Invoices', description: 'New', userValue: 'Value', complexity: 'medium' }],
        };
        const merged = preserveUserReviewState(current, generated);
        expect(merged.assumptions?.[0]).toMatchObject({
            statement: 'New wording', decision: 'rejected', decisionNote: 'Corrected truth', decidedAt: 10,
        });
        expect(merged.features[0]).toMatchObject({ description: 'New', confirmed: true, confirmedAt: 11 });
    });
});
