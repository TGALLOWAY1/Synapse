import { describe, expect, it, vi } from 'vitest';
import {
    dispatchPlanningAttentionItem,
    isPlanningScreenTab,
    parsePlanningNavigationIntent,
    planningReturnTargetForSurface,
    planningStageForDestination,
    resolveActivePlanningScreen,
    serializePlanningNavigationIntent,
    validatePlanningDestination,
    withPlanningNavigationIntent,
    type PlanningNavigationIntent,
    type PlanningScreenDestination,
} from '../planningNavigation';
import type { PlanningAttentionItem } from '../planningAttention';

const attentionItem = (
    condition: PlanningAttentionItem['condition'],
    destination: PlanningAttentionItem['destination'],
): PlanningAttentionItem => ({
    key: `test:${condition}`,
    condition,
    title: 'Test next action',
    why: 'This action exercises the presentation dispatcher.',
    actionLabel: 'Continue',
    destination,
    materiality: 'normal',
    dependencyCount: 0,
    actionableNow: true,
    sourceRefs: [],
});

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

    it('dispatches ready-to-commit attention directly without writing navigation', () => {
        const onCommit = vi.fn();
        const onNavigate = vi.fn();

        dispatchPlanningAttentionItem(
            attentionItem('ready_to_commit', { kind: 'prd' }),
            { onCommit, onNavigate },
        );

        expect(onCommit).toHaveBeenCalledOnce();
        expect(onNavigate).not.toHaveBeenCalled();
    });

    it('dispatches non-commit attention to its exact destination', () => {
        const onCommit = vi.fn();
        const onNavigate = vi.fn();
        const destination = { kind: 'planning_record', recordId: 'decision-7' } as const;

        dispatchPlanningAttentionItem(
            attentionItem('needs_decision', destination),
            { onCommit, onNavigate },
        );

        expect(onCommit).not.toHaveBeenCalled();
        expect(onNavigate).toHaveBeenCalledWith(destination);
    });

    it('resolves a unique active screen with its canonical tab', () => {
        expect(resolveActivePlanningScreen({
            screenId: 'scr-checkout',
            rawTab: 'flow',
            idsByArtifactId: new Map([
                ['artifact-screens', new Set(['scr-checkout'])],
                ['artifact-other', new Set(['scr-home'])],
            ]),
            labels: new Map([['artifact-screens:scr-checkout', 'Checkout']]),
        })).toEqual({
            artifactId: 'artifact-screens',
            nodeId: 'screen_inventory',
            screenId: 'scr-checkout',
            tab: 'flow',
            label: 'Checkout',
        });
    });

    it('does not guess when duplicate screen ids have no preferred artifact', () => {
        expect(resolveActivePlanningScreen({
            screenId: 'scr-checkout',
            rawTab: 'mockups',
            idsByArtifactId: new Map([
                ['artifact-a', new Set(['scr-checkout'])],
                ['artifact-b', new Set(['scr-checkout'])],
            ]),
            labels: new Map([
                ['artifact-a:scr-checkout', 'Checkout A'],
                ['artifact-b:scr-checkout', 'Checkout B'],
            ]),
        })).toBeUndefined();
    });

    it('uses a matching preferred artifact to resolve duplicate screen ids', () => {
        expect(resolveActivePlanningScreen({
            screenId: 'scr-checkout',
            rawTab: 'mockups',
            preferredArtifactId: 'artifact-b',
            idsByArtifactId: new Map([
                ['artifact-a', new Set(['scr-checkout'])],
                ['artifact-b', new Set(['scr-checkout'])],
            ]),
            labels: new Map([
                ['artifact-a:scr-checkout', 'Checkout A'],
                ['artifact-b:scr-checkout', 'Checkout B'],
            ]),
        })).toEqual({
            artifactId: 'artifact-b',
            nodeId: 'screen_inventory',
            screenId: 'scr-checkout',
            tab: 'mockups',
            label: 'Checkout B',
        });
    });

    it('does not substitute another artifact when the exact preferred artifact is stale', () => {
        expect(resolveActivePlanningScreen({
            screenId: 'scr-checkout',
            rawTab: 'flow',
            preferredArtifactId: 'artifact-stale',
            idsByArtifactId: new Map([
                ['artifact-stale', new Set(['scr-home'])],
                ['artifact-other', new Set(['scr-checkout'])],
            ]),
            labels: new Map([
                ['artifact-stale:scr-home', 'Home'],
                ['artifact-other:scr-checkout', 'Checkout'],
            ]),
        })).toBeUndefined();
    });

    it('returns no exact screen for absent or unparseable inventory maps', () => {
        const labels = new Map([['artifact-screens:scr-checkout', 'Checkout']]);

        expect(resolveActivePlanningScreen({
            screenId: 'scr-checkout',
            rawTab: 'flow',
            idsByArtifactId: new Map(),
            labels,
        })).toBeUndefined();
        expect(resolveActivePlanningScreen({
            screenId: 'scr-checkout',
            rawTab: 'handoff',
            idsByArtifactId: new Map([['artifact-screens', new Set()]]),
            labels,
        })).toBeUndefined();
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

    it('falls back from an exact screen when its known inventory artifact has no parsed ids', () => {
        expect(validatePlanningDestination({
            kind: 'screen',
            artifactId: 'artifact-screens',
            nodeId: 'screen_inventory',
            screenId: 'scr-stale',
            tab: 'flow',
            label: 'Stale screen',
        }, {
            artifactIds: new Set(['artifact-screens']),
            screenIdsByArtifactId: new Map([['artifact-screens', new Set()]]),
        })).toEqual({
            kind: 'artifact',
            artifactId: 'artifact-screens',
            nodeId: 'screen_inventory',
        });
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
