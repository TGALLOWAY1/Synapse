import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock the Gemini transport so the pipeline runs offline: one section's
// prompt marker triggers a failure, everything else returns empty JSON.
vi.mock('../geminiClient', () => ({
    callGemini: vi.fn(async (_system: string, prompt: string) => {
        if (prompt.includes('product_thesis slice')) throw new Error('boom');
        return '{}';
    }),
    getFastModel: () => 'fast-model',
    getStrongModel: () => 'strong-model',
}));

import { runProgressivePrdPipeline } from '../services/progressivePrdPipeline';

describe('runProgressivePrdPipeline partial failure', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('persists failed section ids in generationMeta so the UI can flag an incomplete PRD', async () => {
        const result = await runProgressivePrdPipeline('Build a project management app');
        expect(result.generationMeta.failedSections).toEqual(['product_thesis']);
        // The run still settles with a merged (partial) PRD.
        expect(result.structuredPRD).toBeTruthy();
    });
});
