import { describe, it, expect } from 'vitest';
import { estimateCost } from '../modelPricing';

const ONE_MILLION_EACH = { inputTokens: 1_000_000, outputTokens: 1_000_000, totalTokens: 2_000_000 };
const LAST_INTRO_DAY = Date.UTC(2026, 10, 30, 23, 59);
const STANDARD_FROM = Date.UTC(2026, 11, 1);

describe('estimateCost', () => {
    it('prices Gemini 4 Argon at its own rate, not the Flash-tier fallback', () => {
        expect(estimateCost('gemini-4-argon', ONE_MILLION_EACH, LAST_INTRO_DAY)).not.toBeCloseTo(
            estimateCost('some-unknown-model', ONE_MILLION_EACH, LAST_INTRO_DAY),
        );
    });

    it('uses the rate in effect when the call was made', () => {
        // Introductory $2 / $10 through 2026-11-30, standard $4 / $20 after.
        expect(estimateCost('gemini-4-argon', ONE_MILLION_EACH, LAST_INTRO_DAY)).toBeCloseTo(2 + 10);
        expect(estimateCost('gemini-4-argon', ONE_MILLION_EACH, STANDARD_FROM)).toBeCloseTo(4 + 20);
        // Undated entries ignore the date.
        expect(estimateCost('gemini-3.8-flash', ONE_MILLION_EACH, LAST_INTRO_DAY)).toBeCloseTo(
            estimateCost('gemini-3.8-flash', ONE_MILLION_EACH, STANDARD_FROM),
        );
    });
});
