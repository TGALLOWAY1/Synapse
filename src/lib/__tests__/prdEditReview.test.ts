import { describe, expect, it } from 'vitest';
import { reviewStagedEdits } from '../services/prdEditReview';

const baseInput = {
    beforePrd: '# Plan\nA calm habit tracker.',
    afterPrd: '# Plan\nA forgiving habit tracker.',
    edits: [{ anchorText: 'A calm habit tracker.', replacement: 'A forgiving habit tracker.' }],
    model: 'test-model',
};

describe('reviewStagedEdits', () => {
    it('parses findings from the transport and normalizes them', async () => {
        const result = await reviewStagedEdits({
            ...baseInput,
            transport: async () => JSON.stringify({
                findings: [
                    { severity: 'high', title: 'Dangling term', detail: 'Vision references a term no longer defined.' },
                    { severity: 'nonsense', title: 'Bad sev', detail: 'coerced to medium.' },
                    { severity: 'low', title: 'Empty detail', detail: '' },
                ],
            }),
        });
        expect(result.degraded).toBe(false);
        // Empty-detail finding is dropped; bad severity coerces to medium.
        expect(result.findings).toHaveLength(2);
        expect(result.findings[0].severity).toBe('high');
        expect(result.findings[1].severity).toBe('medium');
    });

    it('returns an empty, non-degraded result when the model reports no issues', async () => {
        const result = await reviewStagedEdits({
            ...baseInput,
            transport: async () => JSON.stringify({ findings: [] }),
        });
        expect(result.degraded).toBe(false);
        expect(result.findings).toHaveLength(0);
    });

    it('fails open (degraded) when the transport throws', async () => {
        const result = await reviewStagedEdits({
            ...baseInput,
            transport: async () => { throw new Error('network'); },
        });
        expect(result.degraded).toBe(true);
        expect(result.findings).toHaveLength(0);
    });

    it('fails open when the transport returns unparseable output', async () => {
        const result = await reviewStagedEdits({
            ...baseInput,
            transport: async () => 'not json at all',
        });
        expect(result.degraded).toBe(true);
        expect(result.findings).toHaveLength(0);
    });
});
