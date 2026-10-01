import { describe, expect, it } from 'vitest';
import {
    deriveHeaderPlanStatus,
    isPreflightClarifying,
    isPrdRunInFlight,
    PRD_GENERATING_PLACEHOLDER,
    type HeaderPlanStatusInput,
    type PrdRunStateSpine,
} from '../prdRunState';
import type { PreflightSession, StructuredPRD } from '../../types';

const prd: StructuredPRD = {
    vision: 'v', targetUsers: ['u'], coreProblem: 'p', features: [], architecture: 'a', risks: [],
};

const session = (overrides: Partial<PreflightSession> = {}): PreflightSession => ({
    mode: 'quick',
    originalIdea: 'A habit tracker',
    questions: [],
    currentQuestionIndex: 0,
    status: 'awaiting_questions',
    completed: false,
    ...overrides,
});

// A freshly created spine: placeholder text, no PRD, no run stamped yet.
const placeholderSpine: PrdRunStateSpine = { responseText: PRD_GENERATING_PLACEHOLDER };
const idle = { sectionsRunning: false };

describe('isPreflightClarifying', () => {
    it('is true while an open interview precedes generation', () => {
        expect(isPreflightClarifying({ ...placeholderSpine, preflightSession: session() })).toBe(true);
        expect(isPreflightClarifying({ ...placeholderSpine, preflightSession: session({ status: 'summary' }) })).toBe(true);
    });

    it('is false once completed, once a PRD exists, when blocked, or without a session', () => {
        expect(isPreflightClarifying({
            ...placeholderSpine, preflightSession: session({ status: 'completed', completed: true }),
        })).toBe(false);
        expect(isPreflightClarifying({ ...placeholderSpine, preflightSession: session(), structuredPRD: prd })).toBe(false);
        expect(isPreflightClarifying({
            ...placeholderSpine,
            preflightSession: session(),
            safetyReview: { status: 'blocked' } as PrdRunStateSpine['safetyReview'],
        })).toBe(false);
        expect(isPreflightClarifying(placeholderSpine)).toBe(false);
        expect(isPreflightClarifying(undefined)).toBe(false);
    });
});

describe('isPrdRunInFlight', () => {
    it('is never true during the preflight interview, despite the placeholder text', () => {
        const clarifying = { ...placeholderSpine, preflightSession: session() };
        expect(isPrdRunInFlight(clarifying, idle)).toBe(false);
    });

    it('is true from the moment a run is stamped until it settles — including the consistency-review pass', () => {
        expect(isPrdRunInFlight({ ...placeholderSpine, generationPhase: 'running' }, idle)).toBe(true);
        // Every section landed (PRD present, no section running in the live
        // grid) but the run has not settled: the final consistency review.
        expect(isPrdRunInFlight({ responseText: 'md', structuredPRD: prd, generationPhase: 'running' }, idle)).toBe(true);
        expect(isPrdRunInFlight({ responseText: 'md', structuredPRD: prd, generationPhase: 'complete' }, idle)).toBe(false);
    });

    it('keeps the outputs pill hidden until the run settles, not just until sections land', () => {
        // ProjectWorkspace gates "Generate outputs" on !isPrdRunInFlight(latest).
        // Every section landed and none is running in the live grid, but the
        // consistency review is still rewriting the spine in place: outputs
        // must not start from it yet.
        const reviewing: PrdRunStateSpine = { responseText: 'md', structuredPRD: prd, generationPhase: 'running' };
        expect(isPrdRunInFlight(reviewing, idle)).toBe(true);
        // Once the run settles (onResult stamps 'complete'), the pill returns.
        expect(isPrdRunInFlight({ ...reviewing, generationPhase: 'complete' }, idle)).toBe(false);
    });

    it('is true while sections run (initial run or a single-section retry)', () => {
        expect(isPrdRunInFlight({ responseText: 'md', structuredPRD: prd, generationPhase: 'complete' }, { sectionsRunning: true })).toBe(true);
    });

    it('covers the legacy placeholder window, but not a failed or settled spine', () => {
        expect(isPrdRunInFlight(placeholderSpine, idle)).toBe(true);
        expect(isPrdRunInFlight({
            responseText: '', generationPhase: 'complete',
            generationError: { message: 'boom', category: 'unknown', timestamp: 1 },
        }, idle)).toBe(false);
        expect(isPrdRunInFlight({ responseText: 'md', structuredPRD: prd }, idle)).toBe(false);
        expect(isPrdRunInFlight(undefined, idle)).toBe(false);
    });
});

describe('deriveHeaderPlanStatus', () => {
    const none: HeaderPlanStatusInput = {
        blocked: false,
        generationFailed: false,
        clarifying: false,
        generating: false,
        commitmentUnverifiable: false,
        displaysCurrentCommitment: false,
        legacyCommitted: false,
        acceptedRisk: false,
    };

    it('reads "Clarifying…" during the interview and "Generating…" only once a run is in flight', () => {
        expect(deriveHeaderPlanStatus({ ...none, clarifying: true })).toBe('Clarifying…');
        expect(deriveHeaderPlanStatus({ ...none, generating: true })).toBe('Generating…');
        expect(deriveHeaderPlanStatus(none)).toBe('Working plan');
    });

    it('keeps blocked and failed states ahead of the run states', () => {
        expect(deriveHeaderPlanStatus({ ...none, blocked: true, clarifying: true })).toBe('Blocked');
        expect(deriveHeaderPlanStatus({ ...none, generationFailed: true, generating: true })).toBe('Generation failed');
    });

    it('reports commitment states unchanged', () => {
        expect(deriveHeaderPlanStatus({ ...none, commitmentUnverifiable: true })).toBe('Readiness unavailable');
        expect(deriveHeaderPlanStatus({ ...none, displaysCurrentCommitment: true })).toBe('Plan committed');
        expect(deriveHeaderPlanStatus({ ...none, displaysCurrentCommitment: true, acceptedRisk: true }))
            .toBe('Proceeding with accepted risk');
        expect(deriveHeaderPlanStatus({ ...none, displaysCurrentCommitment: true, legacyCommitted: true }))
            .toBe('Legacy commitment · readiness not recorded');
    });
});
