import { describe, expect, it, vi } from 'vitest';
import {
    buildScreenNotePlanningReturnTarget,
    flagScreenNotePlanningConcern,
    screenNotePlanningSourceScopeKey,
    type FlagPlanningConcernInput,
    type FlagPlanningConcernResult,
} from '../flagToPlan';

describe('screen-note planning adapter', () => {
    it('scopes feedback to the exact inventory artifact, version, and screen', () => {
        expect(screenNotePlanningSourceScopeKey({
            artifactId: 'inventory-1',
            artifactVersionId: 'inventory-version-7',
            screenId: 'scr-checkout',
        })).toBe('screen-note-scope:inventory-1:inventory-version-7:scr-checkout');
    });

    it('flags the exact source through the store without returning navigation', () => {
        const flagPlanningConcern = vi.fn((
            projectId: string,
            concern: FlagPlanningConcernInput,
        ): FlagPlanningConcernResult => {
            void projectId;
            void concern;
            return { status: 'created', planningRecordId: 'planning-1' };
        });
        const result = flagScreenNotePlanningConcern({
            projectId: 'project-1',
            artifactId: 'inventory-1',
            artifactVersionId: 'inventory-version-7',
            spineVersionId: 'spine-3',
            screenId: 'scr-checkout',
            request: {
                noteId: 'recovery-path',
                title: 'Recovery path is missing',
                statement: 'The error state cannot return to checkout.',
                materiality: 'blocking',
            },
        }, flagPlanningConcern);

        expect(result).toEqual({ status: 'created', planningRecordId: 'planning-1' });
        expect(result).not.toHaveProperty('returnTo');
        expect(flagPlanningConcern).toHaveBeenCalledWith('project-1', {
            sourceKey: 'screen-note:inventory-1:inventory-version-7:scr-checkout:recovery-path',
            artifactId: 'inventory-1',
            artifactVersionId: 'inventory-version-7',
            artifactSubtype: 'screen_inventory',
            artifactSlot: 'screen_inventory',
            spineVersionId: 'spine-3',
            title: 'Recovery path is missing',
            statement: 'The error state cannot return to checkout.',
            materiality: 'blocking',
            locator: {
                entityType: 'screen_review_note',
                entityId: 'scr-checkout:recovery-path',
            },
        });
    });

    it.each([
        ['overview', 'Overview'],
        ['flow', 'Flow'],
        ['mockups', 'Mockups'],
    ] as const)('builds the exact %s Review-now return target', (tab, label) => {
        expect(buildScreenNotePlanningReturnTarget({
            artifactId: 'inventory-1',
            screenId: 'scr-checkout',
            screenName: 'Checkout',
            tab,
        })).toEqual({
            destination: {
                kind: 'screen',
                artifactId: 'inventory-1',
                nodeId: 'screen_inventory',
                screenId: 'scr-checkout',
                tab,
                label: `Checkout · ${label}`,
            },
            label: 'Back to Checkout',
        });
    });
});
