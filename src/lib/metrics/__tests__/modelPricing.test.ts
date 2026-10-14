import { describe, it, expect } from 'vitest';
import { estimateCost } from '../modelPricing';

const ONE_MILLION_EACH = { inputTokens: 1_000_000, outputTokens: 1_000_000, totalTokens: 2_000_000 };

describe('estimateCost', () => {
    it('prices Gemini 4 Argon at its own rate, not the Flash-tier fallback', () => {
        expect(estimateCost('gemini-4-argon', ONE_MILLION_EACH)).toBeCloseTo(2 + 10);
        expect(estimateCost('gemini-4-argon', ONE_MILLION_EACH)).not.toBeCloseTo(
            estimateCost('some-unknown-model', ONE_MILLION_EACH),
        );
    });
});
