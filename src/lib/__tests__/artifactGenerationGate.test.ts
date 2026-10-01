import { describe, it, expect } from 'vitest';
import {
    evaluateSpineGenerationGate,
    isHistoricalSpine,
    isIncompleteAcknowledged,
    type SpineGateInput,
} from '../artifactGenerationGate';

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

    // The durable replacement for the Finalize flow's `isFinal`: the
    // "Generate anyway" record on the spine version. Honoured exactly the same.
    it('allows a partial PRD whose version carries the recorded "Generate anyway" acknowledgement', () => {
        const partial = { ...completeSpine, generationMeta: { failedSections: ['core_features'] } };
        const result = evaluateSpineGenerationGate({ ...partial, incompleteAcknowledgedAt: 1_700_000_000_000 });
        expect(result).toMatchObject({ allowed: true, degraded: true, incompleteSections: ['core_features'] });
        expect(evaluateSpineGenerationGate({ ...partial, isFinal: true }).allowed).toBe(true);
        expect(isIncompleteAcknowledged({ incompleteAcknowledgedAt: 1 })).toBe(true);
        expect(isIncompleteAcknowledged({ isFinal: true })).toBe(true);
        expect(isIncompleteAcknowledged({ isFinal: false })).toBe(false);
        expect(isIncompleteAcknowledged(undefined)).toBe(false);
    });

    it('never lets an acknowledgement override the safety, latest-spine, or structured-PRD checks', () => {
        const acknowledged = { ...completeSpine, incompleteAcknowledgedAt: 1, generationMeta: { failedSections: ['x'] } };
        expect(evaluateSpineGenerationGate({ ...acknowledged, safetyReview: { status: 'blocked' } }).reason).toBe('blocked');
        expect(evaluateSpineGenerationGate({ ...acknowledged, isLatest: false }).reason).toBe('not_latest');
        expect(evaluateSpineGenerationGate({ ...acknowledged, structuredPRD: undefined }).reason).toBe('no_prd');
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

    // History Mode can select an old PRD; outputs regenerated from it would
    // become the project's current ones. Only the latest spine may generate.
    it('blocks a historical (non-latest) spine, even when acknowledged or legacy-final', () => {
        for (const spine of [
            { ...completeSpine, isLatest: false },
            { ...completeSpine, isLatest: false, isFinal: true },
        ]) {
            const result = evaluateSpineGenerationGate(spine, { acknowledgeIncomplete: true });
            expect(result.allowed).toBe(false);
            expect(result.reason).toBe('not_latest');
        }
    });

    it('allows the latest spine, and a structural input that omits the flag', () => {
        expect(evaluateSpineGenerationGate({ ...completeSpine, isLatest: true }).allowed).toBe(true);
        expect(evaluateSpineGenerationGate(completeSpine).allowed).toBe(true);
        expect(isHistoricalSpine({ isLatest: false })).toBe(true);
        expect(isHistoricalSpine({ isLatest: true })).toBe(false);
        expect(isHistoricalSpine({})).toBe(false);
        expect(isHistoricalSpine(undefined)).toBe(false);
    });
});
