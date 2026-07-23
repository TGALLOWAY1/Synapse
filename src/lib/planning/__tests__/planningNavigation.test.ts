import { describe, expect, it } from 'vitest';
import {
    isPlanningScreenTab,
    parsePlanningNavigationIntent,
    planningReturnTargetForSurface,
    planningStageForDestination,
    serializePlanningNavigationIntent,
    validatePlanningDestination,
    withPlanningNavigationIntent,
    type PlanningNavigationIntent,
    type PlanningScreenDestination,
} from '../planningNavigation';

describe('planning navigation presentation contract', () => {
    it('round-trips an exact cross-stage target and explicit return without entering project state', () => {
        const intent: PlanningNavigationIntent = {
            destination: { kind: 'planning_record', recordId: 'decision-7' },
            returnTo: {
                destination: {
                    kind: 'update_plan', planId: 'plan-3', itemId: 'item-2',
                    artifactId: 'artifact-screens', nodeId: 'screen_inventory',
                },
                label: 'Return to update plan',
            },
        };

        const serialized = serializePlanningNavigationIntent(intent);
        expect(parsePlanningNavigationIntent(serialized)).toEqual(intent);
        const params = withPlanningNavigationIntent(new URLSearchParams('debug=1'), intent);
        expect(params.get('debug')).toBe('1');
        expect(parsePlanningNavigationIntent(params.get('planning'))).toEqual(intent);
    });

    it('round-trips a bounded exact data-model member while rejecting partial member identity', () => {
        const exact: PlanningNavigationIntent = {
            destination: {
                kind: 'artifact', artifactId: 'data-model', nodeId: 'data_model',
                region: {
                    planId: 'plan-1', itemId: 'field-1', label: 'Workspace · owner_id',
                    dataEntityName: 'Workspace', dataMemberAspect: 'field', dataMemberName: 'owner_id',
                },
            },
            returnTo: { destination: { kind: 'update_plan', planId: 'plan-1' }, label: 'Return to update plan' },
        };
        expect(parsePlanningNavigationIntent(serializePlanningNavigationIntent(exact))).toEqual(exact);
        expect(parsePlanningNavigationIntent(JSON.stringify({
            destination: {
                kind: 'artifact', artifactId: 'data-model',
                region: { planId: 'plan-1', itemId: 'field-1', label: 'Field', dataEntityName: 'Workspace', dataMemberName: 'owner_id' },
            },
        }))).toBeUndefined();
    });

    it('round-trips an exact screen return target', () => {
        const screen: PlanningScreenDestination = {
            kind: 'screen',
            artifactId: 'artifact-screens',
            nodeId: 'screen_inventory',
            screenId: 'scr-checkout',
            tab: 'flow',
            label: 'Checkout · Flow',
        };
        const intent: PlanningNavigationIntent = {
            destination: { kind: 'planning_record', recordId: 'decision-7' },
            returnTo: {
                destination: screen,
                label: 'Back to Checkout · Flow',
            },
        };

        expect(parsePlanningNavigationIntent(serializePlanningNavigationIntent(intent))).toEqual(intent);
    });

    it('recognizes only supported screen tabs', () => {
        expect(['overview', 'flow', 'mockups'].every(isPlanningScreenTab)).toBe(true);
        expect(isPlanningScreenTab('handoff')).toBe(false);
    });

    it('rejects unknown screen tabs and overlong screen labels', () => {
        expect(parsePlanningNavigationIntent(JSON.stringify({
            destination: {
                kind: 'screen',
                nodeId: 'screen_inventory',
                screenId: 'scr-checkout',
                tab: 'handoff',
                label: 'Checkout · Handoff',
            },
        }))).toBeUndefined();
        expect(parsePlanningNavigationIntent(JSON.stringify({
            destination: {
                kind: 'screen',
                nodeId: 'screen_inventory',
                screenId: 'scr-checkout',
                label: 'x'.repeat(501),
            },
        }))).toBeUndefined();
    });

    it('rejects malformed, overlong, and unknown targets', () => {
        expect(parsePlanningNavigationIntent('{not-json')).toBeUndefined();
        expect(parsePlanningNavigationIntent(JSON.stringify({ destination: { kind: 'authority_override' } }))).toBeUndefined();
        expect(parsePlanningNavigationIntent('x'.repeat(8_001))).toBeUndefined();
        expect(parsePlanningNavigationIntent(JSON.stringify({
            destination: { kind: 'artifact', nodeId: 'invented_artifact' },
        }))).toBeUndefined();
    });

    it('keeps durable historical ids addressable and safely falls back for missing exact children', () => {
        const history = validatePlanningDestination(
            { kind: 'readiness', reviewId: 'historical-review', concernId: 'old-concern' },
            { readinessReviewIds: new Set(['historical-review']) },
        );
        expect(history).toEqual({ kind: 'readiness', reviewId: 'historical-review', concernId: 'old-concern' });

        expect(validatePlanningDestination(
            { kind: 'challenge', reviewId: 'review-1', issueId: 'deleted-issue' },
            { reviewIds: new Set(['review-1']), reviewIssueIds: new Set() },
        )).toEqual({ kind: 'challenge', reviewId: 'review-1' });
        expect(validatePlanningDestination(
            { kind: 'update_plan', planId: 'deleted-plan', artifactId: 'artifact-1', nodeId: 'data_model' },
            { updatePlanIds: new Set(), artifactIds: new Set(['artifact-1']) },
        )).toEqual({ kind: 'artifact', artifactId: 'artifact-1', nodeId: 'data_model' });
        expect(validatePlanningDestination(
            { kind: 'planning_record', recordId: 'deleted-record' },
            { planningRecordIds: new Set() },
        )).toEqual({ kind: 'prd' });
    });

    it('falls back from a missing screen to its artifact, Screens node, then workspace', () => {
        const screen: PlanningScreenDestination = {
            kind: 'screen',
            artifactId: 'artifact-screens',
            nodeId: 'screen_inventory',
            screenId: 'scr-checkout',
            tab: 'flow',
            label: 'Checkout · Flow',
        };

        expect(validatePlanningDestination(screen, {
            artifactIds: new Set(['artifact-screens']),
            screenIdsByArtifactId: new Map([['artifact-screens', new Set<string>()]]),
        })).toEqual({
            kind: 'artifact',
            artifactId: 'artifact-screens',
            nodeId: 'screen_inventory',
        });
        expect(validatePlanningDestination(screen, {
            artifactIds: new Set(),
        })).toEqual({
            kind: 'artifact',
            nodeId: 'screen_inventory',
        });
        expect(validatePlanningDestination(
            { ...screen, nodeId: undefined },
            { artifactIds: new Set() },
        )).toEqual({ kind: 'workspace' });
        expect(validatePlanningDestination(
            { ...screen, artifactId: undefined, nodeId: undefined },
            {},
        )).toEqual({ kind: 'workspace' });
    });

    it('maps destinations to active planning stages', () => {
        expect(planningStageForDestination({ kind: 'readiness', reviewId: 'review-1' })).toBe('prd');
        expect(planningStageForDestination({ kind: 'planning_record', recordId: 'decision-1' })).toBe('review');
        expect(planningStageForDestination({ kind: 'history' })).toBe('history');
        expect(planningStageForDestination({ kind: 'artifact', nodeId: 'screen_inventory' })).toBe('workspace');
    });

    it('builds return targets for current presentation stages and exact workspace screens', () => {
        const screen: PlanningScreenDestination = {
            kind: 'screen',
            artifactId: 'artifact-screens',
            nodeId: 'screen_inventory',
            screenId: 'scr-checkout',
            tab: 'flow',
            label: 'Checkout · Flow',
        };

        expect(planningReturnTargetForSurface({ stage: 'prd' })).toEqual({
            destination: { kind: 'prd' },
            label: 'Back to Plan',
        });
        expect(planningReturnTargetForSurface({ stage: 'review' })).toEqual({
            destination: { kind: 'challenge' },
            label: 'Back to Challenge',
        });
        expect(planningReturnTargetForSurface({ stage: 'workspace' })).toEqual({
            destination: { kind: 'workspace' },
            label: 'Back to Build',
        });
        expect(planningReturnTargetForSurface({ stage: 'history' })).toEqual({
            destination: { kind: 'history' },
            label: 'Back to History',
        });
        expect(planningReturnTargetForSurface({ stage: 'workspace', screen })).toEqual({
            destination: screen,
            label: 'Back to Checkout · Flow',
        });
    });
});
