import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_PROJECT_ID } from '../../data/demoProject';
import {
    artifactConcernPlanningSourceKey,
    buildFlagPlanningRecordInput,
    screenIssueMateriality,
    screenNotePlanningSourceKey,
    type FlagPlanningConcernInput,
} from '../../lib/planning/flagToPlan';
import { planningContentHash } from '../../lib/planning/planningHash';
import { ProjectCapabilityError } from '../../lib/projectCapabilities';
import type { PlanningRecord } from '../../types';
import { useProjectStore } from '../projectStore';

const projectId = 'project-1';

const input: FlagPlanningConcernInput = {
    sourceKey: 'screen-note:artifact-screens:artifact-version-2:scr-home:note-1',
    artifactId: 'artifact-screens',
    artifactVersionId: 'artifact-version-2',
    artifactSubtype: 'screen_inventory',
    artifactSlot: 'screen_inventory',
    spineVersionId: 'spine-2',
    title: '  Recovery path is missing  ',
    statement: '  The error state cannot return to checkout.  ',
    materiality: 'blocking',
    locator: {
        entityType: 'screen_review_note',
        entityId: 'scr-home:note-1',
    },
};

const existingRecord = (
    id: string,
    overrides: Partial<PlanningRecord> = {},
): PlanningRecord => ({
    id,
    projectId,
    type: 'open_question',
    status: 'open',
    title: 'Existing concern',
    statement: 'Existing concern statement.',
    evidence: [],
    sourceFindingIds: [],
    createdBy: 'user',
    createdAt: 1,
    updatedAt: 1,
    sources: [{
        key: input.sourceKey,
        sourceType: 'artifact',
        sourceId: input.artifactId,
        sourceVersionId: input.artifactVersionId,
    }],
    ...overrides,
});

beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    useProjectStore.setState({
        projects: {
            [projectId]: {
                id: projectId,
                name: 'Flag planning concern',
                createdAt: 1,
            },
        },
        spineVersions: {
            [projectId]: [{
                id: 'spine-1',
                projectId,
                promptText: 'Initial plan',
                responseText: 'Initial plan',
                createdAt: 1,
                isLatest: false,
                isFinal: false,
            }, {
                id: 'spine-2',
                projectId,
                promptText: 'Current plan',
                responseText: 'Current plan',
                createdAt: 2,
                isLatest: true,
                isFinal: false,
            }],
        },
        artifacts: {
            [projectId]: [{
                id: 'artifact-screens',
                projectId,
                type: 'core_artifact',
                subtype: 'screen_inventory',
                title: 'Screens',
                status: 'active',
                currentVersionId: 'artifact-version-2',
                createdAt: 1,
                updatedAt: 2,
            }],
        },
        artifactVersions: {
            [projectId]: [{
                id: 'artifact-version-1',
                artifactId: 'artifact-screens',
                versionNumber: 1,
                parentVersionId: null,
                content: 'Old screens',
                metadata: {},
                sourceRefs: [],
                generationPrompt: 'Generate screens',
                isPreferred: false,
                createdAt: 1,
            }, {
                id: 'artifact-version-2',
                artifactId: 'artifact-screens',
                versionNumber: 2,
                parentVersionId: 'artifact-version-1',
                content: 'Current screens',
                metadata: {},
                sourceRefs: [],
                generationPrompt: 'Regenerate screens',
                isPreferred: true,
                createdAt: 2,
            }],
        },
        planningRecords: {},
    });
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('flag-to-plan projections', () => {
    it('builds stable source keys from exact sources and normalized concern content', () => {
        expect(screenNotePlanningSourceKey({
            artifactId: 'artifact-screens',
            artifactVersionId: 'artifact-version-2',
            screenId: 'scr-home',
            noteId: 'note-1',
        })).toBe(input.sourceKey);

        const normalizedConcernKey = artifactConcernPlanningSourceKey({
            artifactId: 'artifact-screens',
            artifactVersionId: 'artifact-version-2',
            title: '  RECOVERY path is missing ',
            statement: ' The ERROR state cannot return to checkout. ',
        });
        expect(normalizedConcernKey).toContain(`artifact-concern:artifact-screens:artifact-version-2:${planningContentHash({
            title: 'recovery path is missing',
            statement: 'the error state cannot return to checkout.',
        })}`);
        expect(normalizedConcernKey).toBe(artifactConcernPlanningSourceKey({
            artifactId: 'artifact-screens',
            artifactVersionId: 'artifact-version-2',
            title: 'recovery path is missing',
            statement: 'the error state cannot return to checkout.',
        }));
    });

    it('keeps colliding planning hashes distinct without changing normalization semantics', () => {
        const first = artifactConcernPlanningSourceKey({
            artifactId: 'artifact-screens',
            artifactVersionId: 'artifact-version-2',
            title: 'flag',
            statement: 'concern knf9ma qll',
        });
        const second = artifactConcernPlanningSourceKey({
            artifactId: 'artifact-screens',
            artifactVersionId: 'artifact-version-2',
            title: 'flag',
            statement: 'concern 1h6xn1y 2kyl',
        });

        expect(planningContentHash({
            title: 'flag',
            statement: 'concern knf9ma qll',
        })).toBe('am3g5z');
        expect(planningContentHash({
            title: 'flag',
            statement: 'concern 1h6xn1y 2kyl',
        })).toBe('am3g5z');
        expect(first).not.toBe(second);
        expect(first).toBe(artifactConcernPlanningSourceKey({
            artifactId: 'artifact-screens',
            artifactVersionId: 'artifact-version-2',
            title: '  FLAG  ',
            statement: '  CONCERN KNF9MA QLL  ',
        }));
    });

    it('maps screen issue severity conservatively', () => {
        expect(screenIssueMateriality('blocking')).toBe('blocking');
        expect(screenIssueMateriality('review')).toBe('normal');
        expect(screenIssueMateriality('info')).toBe('low');
    });

    it('projects a trimmed user-owned open question with exact source provenance', () => {
        expect(buildFlagPlanningRecordInput(input)).toEqual({
            type: 'open_question',
            status: 'open',
            title: 'Recovery path is missing',
            statement: 'The error state cannot return to checkout.',
            evidence: [{
                id: `evidence:${input.sourceKey}`,
                sourceType: 'artifact',
                sourceId: 'artifact-screens',
                sourceVersionId: 'artifact-version-2',
                artifactSubtype: 'screen_inventory',
                locator: input.locator,
                excerpt: 'The error state cannot return to checkout.',
                verified: true,
            }],
            sourceFindingIds: [],
            createdBy: 'user',
            sources: [{
                key: input.sourceKey,
                sourceType: 'artifact',
                sourceId: 'artifact-screens',
                sourceVersionId: 'artifact-version-2',
                artifactSubtype: 'screen_inventory',
                locator: input.locator,
            }, {
                key: 'prd:spine-2',
                sourceType: 'prd',
                sourceId: 'prd',
                sourceVersionId: 'spine-2',
            }],
            materiality: 'blocking',
            affectedArtifactSlots: ['screen_inventory'],
            sourceState: 'current',
        });
    });
});

describe('flagPlanningConcern', () => {
    it('creates one user record and reuses the same open source', () => {
        const first = useProjectStore.getState().flagPlanningConcern(projectId, input);
        const second = useProjectStore.getState().flagPlanningConcern(projectId, input);

        expect(first.status).toBe('created');
        expect(second).toEqual({
            status: 'existing',
            planningRecordId: first.status === 'created' ? first.planningRecordId : '',
        });
        expect(useProjectStore.getState().planningRecords[projectId]).toHaveLength(1);
        expect(useProjectStore.getState().planningRecords[projectId][0]).toMatchObject({
            id: first.status === 'created' ? first.planningRecordId : '',
            projectId,
            type: 'open_question',
            status: 'open',
            title: 'Recovery path is missing',
            statement: 'The error state cannot return to checkout.',
            createdBy: 'user',
            materiality: 'blocking',
            affectedArtifactSlots: ['screen_inventory'],
            sourceState: 'current',
            evidence: [{
                sourceType: 'artifact',
                sourceId: 'artifact-screens',
                sourceVersionId: 'artifact-version-2',
                artifactSubtype: 'screen_inventory',
                locator: input.locator,
                verified: true,
            }],
            sources: [
                {
                    key: input.sourceKey,
                    sourceType: 'artifact',
                    sourceId: 'artifact-screens',
                    sourceVersionId: 'artifact-version-2',
                    locator: input.locator,
                },
                {
                    key: 'prd:spine-2',
                    sourceType: 'prd',
                    sourceId: 'prd',
                    sourceVersionId: 'spine-2',
                },
            ],
            events: [{
                type: 'created',
                actor: 'user',
                at: 1_000,
            }],
        });
    });

    it.each([
        ['open after a user-authored reopen', existingRecord('existing-open', {
            status: 'confirmed',
            events: [{
                id: 'created-open',
                planningRecordId: 'existing-open',
                type: 'created',
                actor: 'user',
                at: 1,
            }, {
                id: 'reopened-open',
                planningRecordId: 'existing-open',
                type: 'reopened',
                actor: 'user',
                at: 2,
            }],
        })],
        ['proposed from specialist authority', existingRecord('existing-proposed', {
            status: 'confirmed',
            createdBy: 'specialist_review',
            events: [{
                id: 'created-proposed',
                planningRecordId: 'existing-proposed',
                type: 'created',
                actor: 'synapse',
                at: 1,
            }],
        })],
    ])('reuses a record projected %s despite its stale top-level status', (_label, record) => {
        useProjectStore.setState({
            planningRecords: {
                [projectId]: [record],
            },
        });

        expect(useProjectStore.getState().flagPlanningConcern(projectId, input)).toEqual({
            status: 'existing',
            planningRecordId: record.id,
        });
        expect(useProjectStore.getState().planningRecords[projectId]).toEqual([record]);
    });

    it('does not reuse a top-level open record whose verdict events project it closed', () => {
        const answered = existingRecord('answered-record', {
            status: 'open',
            events: [{
                id: 'created-answered',
                planningRecordId: 'answered-record',
                type: 'created',
                actor: 'user',
                at: 1,
            }, {
                id: 'verdict-answered',
                planningRecordId: 'answered-record',
                type: 'custom_answered',
                actor: 'user',
                answer: 'The concern has been resolved.',
                at: 2,
            }],
        });
        useProjectStore.setState({
            planningRecords: {
                [projectId]: [answered],
            },
        });

        const result = useProjectStore.getState().flagPlanningConcern(projectId, input);

        expect(result).toMatchObject({
            status: 'created',
            planningRecordId: expect.not.stringMatching(/^answered-record$/),
        });
        expect(useProjectStore.getState().planningRecords[projectId]).toHaveLength(2);
        expect(useProjectStore.getState().planningRecords[projectId][0]).toBe(answered);
    });

    it.each([
        ['artifact current version changed', {
            currentVersionId: 'artifact-version-1',
            preferredVersionId: 'artifact-version-2',
        }],
        ['captured version is no longer preferred', {
            currentVersionId: 'artifact-version-2',
            preferredVersionId: 'artifact-version-1',
        }],
    ])('rejects when the %s without mutation', (_label, sourceState) => {
        useProjectStore.setState(state => ({
            artifacts: {
                ...state.artifacts,
                [projectId]: state.artifacts[projectId].map(artifact => ({
                    ...artifact,
                    currentVersionId: sourceState.currentVersionId,
                })),
            },
            artifactVersions: {
                ...state.artifactVersions,
                [projectId]: state.artifactVersions[projectId].map(version => ({
                    ...version,
                    isPreferred: version.id === sourceState.preferredVersionId,
                })),
            },
        }));
        const before = useProjectStore.getState().planningRecords;

        expect(useProjectStore.getState().flagPlanningConcern(projectId, input)).toEqual({
            status: 'rejected',
            reason: 'source_changed',
        });
        expect(useProjectStore.getState().planningRecords).toBe(before);
        expect(useProjectStore.getState().planningRecords[projectId]).toBeUndefined();
    });

    it.each([
        ['artifact', { artifactId: 'missing-artifact' }],
        ['artifact version', { artifactVersionId: 'missing-version' }],
    ])('rejects a missing %s without mutation', (_label, patch) => {
        const before = useProjectStore.getState().planningRecords;

        expect(useProjectStore.getState().flagPlanningConcern(projectId, {
            ...input,
            ...patch,
        })).toEqual({
            status: 'rejected',
            reason: 'source_not_found',
        });
        expect(useProjectStore.getState().planningRecords).toBe(before);
    });

    it('rejects a missing referenced spine without mutation', () => {
        const before = useProjectStore.getState().planningRecords;

        expect(useProjectStore.getState().flagPlanningConcern(projectId, {
            ...input,
            spineVersionId: 'missing-spine',
        })).toEqual({
            status: 'rejected',
            reason: 'spine_not_found',
        });
        expect(useProjectStore.getState().planningRecords).toBe(before);
    });

    it('keeps demo writes guarded at the store boundary', () => {
        expect(() => useProjectStore.getState().flagPlanningConcern(DEMO_PROJECT_ID, input))
            .toThrow(ProjectCapabilityError);
        expect(useProjectStore.getState().planningRecords[DEMO_PROJECT_ID]).toBeUndefined();
    });
});
