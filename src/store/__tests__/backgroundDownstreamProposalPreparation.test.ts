import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Artifact, ArtifactVersion, PlanningRecord, SpineVersion } from '../../types';
import { sealDownstreamUpdatePlan } from '../../lib/planning/downstreamUpdatePlan';
import { useProjectStore } from '../projectStore';

const projectId = 'background-proposals';
const spine: SpineVersion = {
    id: 'spine-current',
    projectId,
    promptText: 'Plan',
    responseText: 'Keep all product data local.',
    createdAt: 2,
    isLatest: true,
    isFinal: true,
};
const artifact: Artifact = {
    id: 'screens',
    projectId,
    type: 'core_artifact',
    subtype: 'screen_inventory',
    title: 'Screen Inventory',
    status: 'active',
    currentVersionId: 'screens-v1',
    createdAt: 1,
    updatedAt: 1,
};
const version: ArtifactVersion = {
    id: 'screens-v1',
    artifactId: artifact.id,
    versionNumber: 1,
    parentVersionId: null,
    content: JSON.stringify({
        sections: [{
            title: 'Core',
            screens: [{
                id: 'workspace',
                name: 'Workspace',
                priority: 'P0',
                purpose: 'Edit locally',
                states: [{ name: 'Syncing', description: 'Uploads to cloud' }],
            }],
        }],
    }),
    metadata: {},
    sourceRefs: [],
    generationPrompt: '',
    isPreferred: true,
    createdAt: 1,
};
const record: PlanningRecord = {
    id: 'local-only',
    projectId,
    type: 'decision',
    status: 'confirmed',
    title: 'Storage',
    statement: 'Where is data stored?',
    resolution: 'Local only',
    evidence: [],
    sourceFindingIds: [],
    createdBy: 'user',
    createdAt: 1,
    updatedAt: 1,
};

beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(100);
    useProjectStore.setState({
        projects: { [projectId]: { id: projectId, name: 'Project', createdAt: 1 } },
        spineVersions: { [projectId]: [spine] },
        artifacts: { [projectId]: [artifact] },
        artifactVersions: { [projectId]: [version] },
        planningRecords: { [projectId]: [record] },
        downstreamUpdatePlans: {},
        downstreamUpdatePlanEvents: {},
        downstreamArtifactUpdateProposals: {},
        downstreamArtifactUpdateReviewEvents: {},
        downstreamArtifactUpdateApplications: {},
        downstreamArtifactUpdateVerifications: {},
        downstreamArtifactUpdateVerificationEvents: {},
        historyEvents: {},
    });
});

describe('background exact-region proposal preparation', () => {
    it('prepares idempotent proposals without recording authority or changing output versions', () => {
        const before = useProjectStore.getState();
        const beforeArtifacts = before.artifacts[projectId];
        const beforeVersions = before.artifactVersions[projectId];

        const first = before.prepareCurrentDownstreamArtifactUpdateProposals(projectId);
        expect(first).toMatchObject({
            status: 'prepared',
            attempted: 1,
            created: 1,
            rejected: [],
        });
        if (first.status !== 'prepared') return;
        expect(first.prepared[0]).toMatchObject({ operation: 'review_only', reused: false });

        const after = useProjectStore.getState();
        expect(after.artifacts[projectId]).toBe(beforeArtifacts);
        expect(after.artifactVersions[projectId]).toBe(beforeVersions);
        expect(after.artifacts[projectId][0].currentVersionId).toBe(version.id);
        expect(after.artifactVersions[projectId]).toEqual([version]);
        expect(after.downstreamArtifactUpdateReviewEvents[projectId] ?? []).toEqual([]);
        expect(after.downstreamArtifactUpdateApplications[projectId] ?? []).toEqual([]);
        expect(after.historyEvents[projectId] ?? []).toEqual([]);

        const second = after.prepareCurrentDownstreamArtifactUpdateProposals(projectId);
        expect(second).toMatchObject({ status: 'prepared', created: 0, rejected: [] });
        if (second.status === 'prepared') expect(second.prepared[0].reused).toBe(true);
        expect(useProjectStore.getState().downstreamArtifactUpdateProposals[projectId]).toHaveLength(1);
    });

    it('returns partial results when one current item cannot bind an exact region', () => {
        const initial = useProjectStore.getState().prepareCurrentDownstreamArtifactUpdateProposals(projectId);
        expect(initial.status).toBe('prepared');
        const state = useProjectStore.getState();
        const validPlan = state.downstreamUpdatePlans[projectId][0];
        const { integrityHash: _integrityHash, ...base } = validPlan;
        void _integrityHash;
        const missingRegionPlan = sealDownstreamUpdatePlan({
            ...base,
            id: 'missing-region-plan',
            items: [{
                ...validPlan.items[0],
                id: 'missing-region-item',
                region: {
                    kind: 'screen',
                    screenId: 'missing',
                    screenName: 'Missing',
                    aspect: 'screen',
                },
            }],
        });
        useProjectStore.setState({
            downstreamUpdatePlans: {
                [projectId]: [...state.downstreamUpdatePlans[projectId], missingRegionPlan],
            },
        });

        const result = useProjectStore.getState()
            .prepareCurrentDownstreamArtifactUpdateProposals(projectId);
        expect(result).toMatchObject({
            status: 'prepared',
            created: 0,
            rejected: [{
                planId: missingRegionPlan.id,
                itemId: 'missing-region-item',
                reason: 'region_missing',
            }],
        });
        if (result.status === 'prepared') {
            expect(result.prepared.some(item => item.reused)).toBe(true);
            expect(result.attempted).toBe(result.prepared.length + 1);
        }
        expect(useProjectStore.getState().artifactVersions[projectId]).toEqual([version]);
    });
});
