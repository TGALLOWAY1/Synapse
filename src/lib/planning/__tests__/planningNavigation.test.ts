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

    it('rejects update-plan identity fields on screen destinations', () => {
        for (const forbidden of [
            { planId: 'plan-1' },
            { itemId: 'item-1' },
        ]) {
            expect(parsePlanningNavigationIntent(JSON.stringify({
                destination: {
                    kind: 'screen',
                    nodeId: 'screen_inventory',
                    screenId: 'scr-checkout',
                    label: 'Checkout',
                    ...forbidden,
                },
            }))).toBeUndefined();
        }
    });

    it('rejects artifact and update-plan identity fields on workspace and history destinations', () => {
        for (const kind of ['workspace', 'history']) {
            for (const forbidden of [
                { artifactId: 'artifact-screens' },
                { nodeId: 'screen_inventory' },
                { planId: 'plan-1' },
                { itemId: 'item-1' },
            ]) {
                expect(parsePlanningNavigationIntent(JSON.stringify({
                    destination: { kind, ...forbidden },
                }))).toBeUndefined();
            }
        }
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
        const cases = [
            [{ kind: 'prd' }, 'prd'],
            [{ kind: 'readiness', reviewId: 'review-1' }, 'prd'],
            [{ kind: 'decision_center' }, 'review'],
            [{ kind: 'planning_record', recordId: 'decision-1' }, 'review'],
            [{ kind: 'challenge' }, 'review'],
            [{ kind: 'screen', nodeId: 'screen_inventory', screenId: 'scr-checkout', label: 'Checkout' }, 'workspace'],
            [{ kind: 'workspace' }, 'workspace'],
            [{ kind: 'artifact', nodeId: 'screen_inventory' }, 'workspace'],
            [{ kind: 'update_plan', planId: 'plan-1' }, 'workspace'],
            [{ kind: 'history' }, 'history'],
        ] as const;

        for (const [destination, expected] of cases) {
            expect(planningStageForDestination(destination)).toBe(expected);
        }
    });

    it('builds return targets for every pipeline stage', () => {
        const cases = [
            ['prd', { destination: { kind: 'prd' }, label: 'Back to Plan' }],
            ['review', { destination: { kind: 'challenge' }, label: 'Back to Challenge' }],
            ['workspace', { destination: { kind: 'workspace' }, label: 'Back to Build' }],
            ['mockups', { destination: { kind: 'workspace' }, label: 'Back to Build' }],
            ['artifacts', { destination: { kind: 'workspace' }, label: 'Back to Build' }],
            ['history', { destination: { kind: 'history' }, label: 'Back to History' }],
        ] as const;

        for (const [stage, expected] of cases) {
            expect(planningReturnTargetForSurface({ stage })).toEqual(expected);
        }
    });

    it('builds exact workspace screen return targets', () => {
        const screen: Omit<PlanningScreenDestination, 'kind'> = {
            artifactId: 'artifact-screens',
            nodeId: 'screen_inventory',
            screenId: 'scr-checkout',
            tab: 'flow',
            label: 'Checkout · Flow',
        };

        expect(planningReturnTargetForSurface({ stage: 'workspace', screen })).toEqual({
            destination: { kind: 'screen', ...screen },
            label: 'Back to Checkout · Flow',
        });
    });

    it('owns the screen discriminator when runtime input carries a conflicting kind', () => {
        const screen = {
            kind: 'history',
            nodeId: 'screen_inventory',
            screenId: 'scr-checkout',
            label: 'Checkout',
        } as unknown as Omit<PlanningScreenDestination, 'kind'>;

        expect(planningReturnTargetForSurface({ stage: 'workspace', screen })).toEqual({
            destination: { ...screen, kind: 'screen' },
            label: 'Back to Checkout',
        });
    });
});
