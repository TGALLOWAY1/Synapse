import { describe, it, expect } from 'vitest';
import { evaluateSpineGenerationGate, type SpineGateInput } from '../artifactGenerationGate';

const completeSpine: SpineGateInput = {
    isFinal: false,
    structuredPRD: { features: [] },
    generationMeta: { failedSections: [] },
};

describe('evaluateSpineGenerationGate', () => {
    it('allows a complete, non-final PRD without acknowledgement', () => {
        const result = evaluateSpineGenerationGate(completeSpine);
        expect(result.allowed).toBe(true);
        expect(result.degraded).toBe(false);
    });

    it('blocks a partial PRD that is not final and not acknowledged', () => {
        const result = evaluateSpineGenerationGate({
            ...completeSpine,
            generationMeta: { failedSections: ['core_features'] },
        });
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('incomplete_unacknowledged');
        expect(result.incompleteSections).toEqual(['core_features']);
    });

    it('allows a partial PRD once the user explicitly acknowledges it (degraded)', () => {
        const result = evaluateSpineGenerationGate(
            { ...completeSpine, generationMeta: { failedSections: ['core_features'] } },
            { acknowledgeIncomplete: true },
        );
        expect(result.allowed).toBe(true);
        expect(result.degraded).toBe(true);
    });

    it('allows a partial PRD that is already final (durable acknowledgement, e.g. resume)', () => {
        const result = evaluateSpineGenerationGate({
            ...completeSpine,
            isFinal: true,
            generationMeta: { failedSections: ['core_features'] },
        });
        expect(result.allowed).toBe(true);
        expect(result.degraded).toBe(true);
    });

    it('blocks a safety-blocked spine regardless of acknowledgement', () => {
        const result = evaluateSpineGenerationGate(
            { ...completeSpine, safetyReview: { status: 'blocked' } },
            { acknowledgeIncomplete: true },
        );
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('blocked');
    });

    it('blocks a spine with no structured PRD', () => {
        const result = evaluateSpineGenerationGate({ ...completeSpine, structuredPRD: undefined });
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('no_prd');
    });
});
