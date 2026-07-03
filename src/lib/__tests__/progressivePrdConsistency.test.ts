import { describe, expect, it, vi, beforeEach } from 'vitest';

// Controls what the mocked consistency-review model call returns per test.
let consistencyResponse = '{}';

// Mock the Gemini transport so the pipeline runs offline. Section calls return
// empty JSON (so every section succeeds and no section-failure skips the
// review); the final consistency-review call is detected by its system prompt
// and returns `consistencyResponse`.
vi.mock('../geminiClient', () => ({
    callGemini: vi.fn(async (_system: string, prompt: string) => {
        if (prompt.includes('final consistency pass')) return consistencyResponse;
        return '{}';
    }),
    getFastModel: () => 'fast-model',
    getStrongModel: () => 'strong-model',
}));

import { callGemini } from '../geminiClient';
import { runProgressivePrdPipeline } from '../services/progressivePrdPipeline';

const consistencyCalls = () =>
    (callGemini as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter(
        (c) => typeof c[1] === 'string' && (c[1] as string).includes('final consistency pass'),
    );

describe('progressive pipeline consistency review (default-on)', () => {
    beforeEach(() => {
        localStorage.clear();
        consistencyResponse = '{}';
        vi.clearAllMocks();
    });

    it('runs the consistency review automatically after the DAG merge', async () => {
        consistencyResponse = JSON.stringify({
            prd: { productName: 'Canonical', vision: 'v' },
            changeLog: 'normalized terminology',
        });
        const result = await runProgressivePrdPipeline('Build a project management app');
        expect(consistencyCalls()).toHaveLength(1);
        expect(result.generationMeta.consistencyReview?.ran).toBe(true);
    });

    it('replaces the merged PRD with the accepted reviewed PRD and renders its markdown', async () => {
        consistencyResponse = JSON.stringify({
            prd: { productName: 'Canonical Name', vision: 'reviewed vision' },
            changeLog: 'normalized product name',
        });
        const result = await runProgressivePrdPipeline('Build a project management app');
        expect(result.generationMeta.consistencyReview?.status).toBe('applied');
        expect(result.generationMeta.revised).toBe(true);
        expect(result.structuredPRD.productName).toBe('Canonical Name');
        // Markdown must be rendered from the reviewed PRD, not the pre-review one.
        expect(result.markdown).toContain('Canonical Name');
    });

    it('falls back to the merged PRD when the review is unparseable', async () => {
        consistencyResponse = 'not json at all';
        const result = await runProgressivePrdPipeline('Build a project management app');
        expect(result.generationMeta.consistencyReview?.status).toBe('rejected');
        expect(result.generationMeta.consistencyReview?.rejectionReason).toBe('unparseable');
        expect(result.generationMeta.revised).toBe(false);
        // A usable (merged) PRD is still returned — the failure does not block.
        expect(result.structuredPRD).toBeTruthy();
    });

    it('skips the review when disabled by the developer override', async () => {
        const result = await runProgressivePrdPipeline('Build a project management app', {
            enableConsistencyReview: false,
        });
        expect(consistencyCalls()).toHaveLength(0);
        expect(result.generationMeta.consistencyReview?.status).toBe('skipped');
        expect(result.generationMeta.consistencyReview?.ran).toBe(false);
    });
});
