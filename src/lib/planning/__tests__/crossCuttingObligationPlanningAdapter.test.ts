import { describe, expect, it, vi } from 'vitest';
import {
    buildCrossCuttingObligationConcernInput,
    crossCuttingObligationPlanningSourceKey,
    flagCrossCuttingObligationConcern,
    type FlagPlanningConcernInput,
    type FlagPlanningConcernResult,
} from '../flagToPlan';
import {
    deriveCrossCuttingObligations,
    type CrossCuttingObligationStatus,
} from '../crossCuttingObligations';
import type { StructuredPRD } from '../../../types';

const prd: StructuredPRD = {
    vision: 'Playlists that match a mood.',
    targetUsers: ['Listeners'],
    coreProblem: 'Playlists ignore feelings.',
    features: [],
    architecture: 'SPA',
    risks: [],
    successMetrics: [{ name: 'Day-1 activation rate' }],
};

const unresolvedMeasurement = (): CrossCuttingObligationStatus =>
    deriveCrossCuttingObligations({ prd, plan: {} }).measurement;

describe('cross-cutting obligation planning adapter', () => {
    it('keys an obligation to the artifact, not to a plan version', () => {
        // Version-less on purpose: regenerating the plan does not turn one open
        // question into two.
        expect(crossCuttingObligationPlanningSourceKey({
            artifactId: 'plan-1',
            obligationKey: 'measurement',
        })).toBe('cross-cutting-obligation:plan-1:measurement');
    });

    it('builds a user concern from the derived status, with the §W6 blocker title', () => {
        const status = unresolvedMeasurement();
        const input = buildCrossCuttingObligationConcernInput({
            artifactId: 'plan-1',
            artifactVersionId: 'plan-version-4',
            spineVersionId: 'spine-3',
            status,
        });

        expect(input.title).toBe('Measurement not discharged');
        expect(input.artifactSlot).toBe('implementation_plan');
        expect(input.artifactSubtype).toBe('implementation_plan');
        expect(input.locator).toEqual({ entityType: 'artifact', entityId: 'plan-1' });
        // The full derived reason plus every named gap — untruncated.
        expect(input.statement).toContain('the PRD declares success metrics');
        expect(input.statement).toContain('no declared success metric has an instrumentation contract');
        // Never 'blocking': §W6 is the single authority on this obligation's
        // severity, and a blocking record would additionally arm the Finalize
        // materiality hard stop off a one-click UI action.
        expect(input.materiality).toBe('normal');
    });

    it('flags through the injected store action and returns its result unchanged', () => {
        const flagPlanningConcern = vi.fn((
            projectId: string,
            concern: FlagPlanningConcernInput,
        ): FlagPlanningConcernResult => {
            void projectId;
            void concern;
            return { status: 'created', planningRecordId: 'planning-9' };
        });

        const result = flagCrossCuttingObligationConcern({
            projectId: 'project-1',
            artifactId: 'plan-1',
            artifactVersionId: 'plan-version-4',
            spineVersionId: 'spine-3',
            status: unresolvedMeasurement(),
        }, flagPlanningConcern);

        expect(result).toEqual({ status: 'created', planningRecordId: 'planning-9' });
        expect(flagPlanningConcern).toHaveBeenCalledTimes(1);
        expect(flagPlanningConcern.mock.calls[0]?.[0]).toBe('project-1');
        expect(flagPlanningConcern.mock.calls[0]?.[1]).toMatchObject({
            sourceKey: 'cross-cutting-obligation:plan-1:measurement',
            artifactId: 'plan-1',
            artifactVersionId: 'plan-version-4',
            spineVersionId: 'spine-3',
        });
    });

    it('rejects rather than flagging when the plan artifact is not resolved', () => {
        const flagPlanningConcern = vi.fn();
        expect(flagCrossCuttingObligationConcern({
            projectId: 'project-1',
            spineVersionId: 'spine-3',
            status: unresolvedMeasurement(),
        }, flagPlanningConcern)).toEqual({ status: 'rejected', reason: 'source_not_found' });
        expect(flagPlanningConcern).not.toHaveBeenCalled();
    });
});
