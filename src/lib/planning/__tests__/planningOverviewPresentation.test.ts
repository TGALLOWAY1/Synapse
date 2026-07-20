import { describe, expect, it } from 'vitest';
import type { PlanningReadiness } from '../planningReadiness';
import { derivePlanningOverviewPresentation } from '../planningOverviewPresentation';

const readiness = (overrides: Partial<PlanningReadiness> = {}): PlanningReadiness => ({
    phase: 'needs_decisions',
    headline: 'Working plan · needs key decisions',
    summary: 'The direction is taking shape, but unresolved choices could still materially change it.',
    criteria: [],
    nextAction: {
        kind: 'validate_assumption',
        label: 'Validate the leading assumption',
        detail: 'LLM pricing supports real-time evaluation.',
        planningRecordId: 'record-1',
    },
    unresolvedCount: 5,
    assumptionCount: 5,
    conflictCount: 0,
    changedSourceCount: 0,
    isReadyToBuild: false,
    ...overrides,
});

describe('derivePlanningOverviewPresentation', () => {
    it('presents a healthy fresh draft as calm accomplishment, never caution', () => {
        const presentation = derivePlanningOverviewPresentation(readiness(), 5);
        expect(presentation.tone).toBe('calm');
        expect(presentation.headline).toBe('Your draft is ready');
        expect(presentation.summary).toContain('5 gaps');
        expect(presentation.hasRegression).toBe(false);
    });

    it('uses singular copy for a single open question', () => {
        const presentation = derivePlanningOverviewPresentation(readiness(), 1);
        expect(presentation.summary).toContain('1 gap ');
    });

    it('keeps a calm framing when no answerable questions remain', () => {
        const presentation = derivePlanningOverviewPresentation(readiness(), 0);
        expect(presentation.tone).toBe('calm');
        expect(presentation.summary.length).toBeGreaterThan(0);
        expect(presentation.summary).not.toContain('0 gap');
    });

    it('reserves the caution treatment for a genuine conflict', () => {
        const presentation = derivePlanningOverviewPresentation(readiness({ conflictCount: 1 }), 5);
        expect(presentation.tone).toBe('caution');
        expect(presentation.headline).toBe('Needs attention');
        expect(presentation.hasRegression).toBe(true);
    });

    it('reserves the caution treatment for a changed source', () => {
        const presentation = derivePlanningOverviewPresentation(readiness({ changedSourceCount: 2 }), 5);
        expect(presentation.tone).toBe('caution');
        expect(presentation.hasRegression).toBe(true);
    });

    it('maps the remaining phases to their existing tones and labels', () => {
        expect(derivePlanningOverviewPresentation(readiness({ phase: 'exploring' }), 0).tone).toBe('exploring');
        expect(derivePlanningOverviewPresentation(readiness({ phase: 'ready_to_challenge' }), 0)).toMatchObject({
            tone: 'challenge',
            headline: 'Ready to challenge',
        });
        expect(derivePlanningOverviewPresentation(readiness({ phase: 'needs_alignment' }), 0).tone).toBe('alignment');
        expect(derivePlanningOverviewPresentation(readiness({ phase: 'ready_to_build' }), 0).tone).toBe('ready');
    });

    it('passes the readiness summary through for non-calm phases', () => {
        const input = readiness({ phase: 'needs_alignment', summary: 'A resolved choice still has consequences to review.' });
        expect(derivePlanningOverviewPresentation(input, 0).summary).toBe('A resolved choice still has consequences to review.');
    });
});
