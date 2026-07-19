import { describe, expect, it } from 'vitest';
import type { StructuredPRD } from '../../../types';
import {
    generateDecisionOptions,
    type DecisionOptionsGenerationInput,
    type DecisionOptionsTransport,
} from '../decisionOptionsGeneration';

const structuredPRD = {
    vision: 'Track daily project momentum.',
    coreProblem: 'Makers cannot see which projects are actually progressing.',
    targetUsers: ['Independent makers'],
    features: [{ id: 'f1', name: 'Contribution graph', tier: 'mvp' }],
    constraints: ['Local-first storage'],
} as unknown as StructuredPRD;

const input: DecisionOptionsGenerationInput = {
    baselineSpineVersionId: 'spine-v1',
    record: {
        id: 'record-1',
        type: 'decision',
        title: 'How should mixed-success days render?',
        statement: 'The contribution graph needs a rule for days with mixed outcomes.',
        whyItMatters: 'It defines what the graph communicates at a glance.',
        evidence: [{ label: 'PRD', excerpt: 'The graph shows one cell per day.' }],
    },
    structuredPRD,
};

const validResponse = JSON.stringify({
    options: [
        {
            label: 'Split-color cells',
            description: 'Each day cell renders proportional success and failure segments.',
            tradeoffs: [{ kind: 'risk', summary: 'Hard to read at small sizes' }],
        },
        {
            label: 'Dominant outcome wins',
            description: 'The day takes the color of the majority outcome.',
            tradeoffs: [{ kind: 'benefit', summary: 'Stays legible' }, { kind: 'cost', summary: 'Hides minority outcomes' }],
        },
    ],
    recommendedIndex: 1,
    recommendationSummary: 'Dominant outcome wins',
    recommendationRationale: 'It keeps the at-a-glance reading unambiguous.',
    recommendationConfidence: 'medium',
});

const transportReturning = (...responses: string[]): DecisionOptionsTransport => {
    let call = 0;
    return async () => responses[Math.min(call++, responses.length - 1)];
};

describe('generateDecisionOptions', () => {
    it('returns validated options with a recommendation bound to one option', async () => {
        const result = await generateDecisionOptions(input, { transport: transportReturning(validResponse), model: 'test-model' });
        if (!result.ok) throw new Error(result.errors.join('; '));
        expect(result.options).toHaveLength(2);
        expect(result.options.map(option => option.label)).toEqual(['Split-color cells', 'Dominant outcome wins']);
        expect(new Set(result.options.map(option => option.id)).size).toBe(2);
        expect(result.recommendation.optionId).toBe(result.options[1].id);
        expect(result.recommendation.confidence).toBe('medium');
        expect(result.model).toBe('test-model');
    });

    it('derives stable option ids from the record and label', async () => {
        const first = await generateDecisionOptions(input, { transport: transportReturning(validResponse), model: 'test-model' });
        const second = await generateDecisionOptions(input, { transport: transportReturning(validResponse), model: 'test-model' });
        if (!first.ok || !second.ok) throw new Error('expected success');
        expect(first.options.map(option => option.id)).toEqual(second.options.map(option => option.id));
    });

    it('repairs once and fails closed on persistent invalid responses', async () => {
        const missingRisk = JSON.stringify({
            options: [
                { label: 'A', description: 'Only upside claimed.', tradeoffs: [{ kind: 'benefit', summary: 'Great' }] },
                { label: 'B', description: 'Also only upside.', tradeoffs: [] },
            ],
            recommendedIndex: 0,
            recommendationSummary: 'A',
            recommendationRationale: 'Because.',
            recommendationConfidence: 'high',
        });
        const repaired = await generateDecisionOptions(input, { transport: transportReturning(missingRisk, validResponse), model: 'test-model' });
        expect(repaired.ok).toBe(true);
        expect(repaired.attempts).toBe(2);

        const failed = await generateDecisionOptions(input, { transport: transportReturning(missingRisk), model: 'test-model' });
        expect(failed).toMatchObject({ ok: false, reason: 'invalid_response' });
        if (!failed.ok) expect(failed.errors.join(' ')).toMatch(/cost or risk/);
    });

    it('rejects a recommendation that does not reference a returned option', async () => {
        const badIndex = JSON.stringify({ ...JSON.parse(validResponse), recommendedIndex: 5 });
        const result = await generateDecisionOptions(input, {
            transport: transportReturning(badIndex),
            model: 'test-model',
            maxStructuredRepairAttempts: 0,
        });
        expect(result).toMatchObject({ ok: false, reason: 'invalid_response' });
        if (!result.ok) expect(result.errors.join(' ')).toMatch(/recommendedIndex/);
    });

    it('rejects duplicate or missing options without a model retry budget', async () => {
        const duplicates = JSON.stringify({
            ...JSON.parse(validResponse),
            options: [
                { label: 'Same idea', description: 'One.', tradeoffs: [{ kind: 'risk', summary: 'r' }] },
                { label: 'same idea', description: 'Two.', tradeoffs: [{ kind: 'cost', summary: 'c' }] },
            ],
        });
        const result = await generateDecisionOptions(input, {
            transport: transportReturning(duplicates),
            model: 'test-model',
            maxStructuredRepairAttempts: 0,
        });
        expect(result).toMatchObject({ ok: false, reason: 'invalid_response' });
    });

    it('fails closed for unsupported record types before any transport call', async () => {
        let called = false;
        const result = await generateDecisionOptions(
            { ...input, record: { ...input.record, type: 'assumption' as unknown as 'decision' } },
            { transport: async () => { called = true; return validResponse; }, model: 'test-model' },
        );
        expect(result).toMatchObject({ ok: false, reason: 'invalid_context' });
        expect(called).toBe(false);
    });

    it('reports transport failures without fabricating options', async () => {
        const result = await generateDecisionOptions(input, {
            transport: async () => { throw new Error('offline'); },
            model: 'test-model',
        });
        expect(result).toMatchObject({ ok: false, reason: 'transport_error', errors: ['offline'] });
    });
});
