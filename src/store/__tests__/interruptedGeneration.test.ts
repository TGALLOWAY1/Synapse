import { describe, it, expect } from 'vitest';
import { markInterruptedGenerations } from '../interruptedGeneration';
import type { SpineVersion, StructuredPRD, PreflightSession } from '../../types';

const baseSpine = (overrides: Partial<SpineVersion>): SpineVersion => ({
    id: 'v1',
    projectId: 'p1',
    promptText: 'Build a thing',
    responseText: '',
    createdAt: 1,
    isLatest: true,
    isFinal: false,
    ...overrides,
});

const partialPrd = { vision: 'partial' } as unknown as StructuredPRD;

const openPreflight: PreflightSession = {
    mode: 'quick',
    originalIdea: 'Build a thing',
    questions: [],
    currentQuestionIndex: 0,
    status: 'answering',
    completed: false,
};

describe('markInterruptedGenerations', () => {
    it('converts a legacy stuck placeholder spine into an interrupted error', () => {
        const versions = {
            p1: [baseSpine({ responseText: 'Generating PRD...' })],
        };
        const changed = markInterruptedGenerations(versions);
        expect(changed).toBe(true);
        const spine = versions.p1[0];
        expect(spine.generationError?.category).toBe('interrupted');
        expect(spine.generationPhase).toBe('complete');
        // Placeholder cleared so isPRDGenerating stops being true.
        expect(spine.responseText).toBe('');
    });

    it('converts a mid-run spine (partial PRD, phase still running) into an interrupted error', () => {
        const versions = {
            p1: [baseSpine({
                responseText: '# Partial markdown',
                structuredPRD: partialPrd,
                generationPhase: 'running',
            })],
        };
        expect(markInterruptedGenerations(versions)).toBe(true);
        const spine = versions.p1[0];
        expect(spine.generationError?.category).toBe('interrupted');
        // The partial content is preserved — only the run state settles.
        expect(spine.structuredPRD).toBe(partialPrd);
        expect(spine.responseText).toBe('# Partial markdown');
    });

    it('leaves settled spines untouched', () => {
        const completed = baseSpine({
            responseText: '# Done',
            structuredPRD: partialPrd,
            generationPhase: 'complete',
        });
        const errored = baseSpine({
            id: 'v2',
            generationError: { message: 'boom', category: 'unknown', timestamp: 2 },
        });
        const legacyNoMarker = baseSpine({
            id: 'v3',
            responseText: '# Old project markdown',
            structuredPRD: partialPrd,
        });
        const versions = { p1: [completed, errored, legacyNoMarker] };
        expect(markInterruptedGenerations(versions)).toBe(false);
        expect(versions.p1[0]).toBe(completed);
        expect(versions.p1[1]).toBe(errored);
        expect(versions.p1[2]).toBe(legacyNoMarker);
    });

    it('skips spines with an open preflight session — generation never started', () => {
        const versions = {
            p1: [baseSpine({
                responseText: 'Generating PRD...',
                preflightSession: openPreflight,
            })],
        };
        expect(markInterruptedGenerations(versions)).toBe(false);
        expect(versions.p1[0].generationError).toBeUndefined();
    });

    it('skips safety-blocked spines', () => {
        const versions = {
            p1: [baseSpine({
                generationPhase: 'running',
                safetyReview: {
                    status: 'blocked',
                    classification: 'disallowed',
                    reason: 'nope',
                    reviewedAt: 3,
                },
            })],
        };
        expect(markInterruptedGenerations(versions)).toBe(false);
        expect(versions.p1[0].generationError).toBeUndefined();
    });
});
