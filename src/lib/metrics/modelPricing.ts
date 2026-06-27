// Approximate model pricing for the Metrics dashboard's cost ESTIMATES.
//
// These are list-price approximations (USD per 1,000,000 tokens), matched to a
// model id by family keyword. They are deliberately surfaced as "est." in the
// UI — they are NOT a billing source of truth and do not account for context
// caching, batch discounts, or provider-specific rounding. Tune the table here
// if Google/OpenAI pricing changes; nothing else needs to update.

import type { TokenUsage } from '../../types';

export interface ModelPrice {
    /** USD per 1M input tokens. */
    input: number;
    /** USD per 1M output tokens. */
    output: number;
}

/**
 * Family keyword → price. Matched case-insensitively as a substring of the
 * model id, most-specific first (so 'flash-lite' wins over 'flash').
 */
export const MODEL_PRICING: Array<{ match: string; price: ModelPrice }> = [
    { match: 'flash-lite', price: { input: 0.10, output: 0.40 } },
    { match: 'pro', price: { input: 1.25, output: 5.0 } },
    { match: 'flash', price: { input: 0.30, output: 2.5 } },
    { match: 'gpt-4', price: { input: 2.5, output: 10.0 } },
];

/** Fallback when no family matches — a mid Flash-tier estimate. */
const DEFAULT_PRICE: ModelPrice = { input: 0.30, output: 2.5 };

export function priceForModel(model: string): ModelPrice {
    const id = (model || '').toLowerCase();
    for (const { match, price } of MODEL_PRICING) {
        if (id.includes(match)) return price;
    }
    return DEFAULT_PRICE;
}

/**
 * Estimated USD cost of a single call. Returns 0 when no token usage is
 * available (so a run with un-instrumented nodes simply shows $0 rather than a
 * fabricated number).
 */
export function estimateCost(model: string, usage: Partial<TokenUsage> | undefined): number {
    if (!usage) return 0;
    const { input, output } = priceForModel(model);
    const inTok = usage.inputTokens ?? 0;
    const outTok = usage.outputTokens ?? 0;
    return (inTok / 1_000_000) * input + (outTok / 1_000_000) * output;
}

/** Provider label inferred from a model id (for per-provider breakdowns). */
export function providerForModel(model: string): string {
    const id = (model || '').toLowerCase();
    if (id.includes('gpt') || id.includes('openai') || id.includes('dall')) return 'openai';
    if (id.includes('gemini')) return 'gemini';
    return 'gemini';
}
