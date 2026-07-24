import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from '../projectStore';
import type { SourceRef } from '../../types';

beforeEach(() => {
    useProjectStore.setState({
        projects: {},
        spineVersions: {},
        historyEvents: {},
        branches: {},
        artifacts: {},
        artifactVersions: {},
        feedbackItems: {},
    });
    localStorage.clear();
});

const spineRef = (spineId: string): SourceRef[] => ([
    { id: 'r1', sourceArtifactId: spineId, sourceArtifactVersionId: spineId, sourceType: 'spine' },
]);

describe('revertArtifactToVersion', () => {
    it('appends a cloned version, increments versionNumber, sets preferred, carries sourceRefs', () => {
        const store = useProjectStore.getState();
        const { projectId } = store.createProject('P', 'idea');
        const spineId = useProjectStore.getState().spineVersions[projectId][0].id;
        const { artifactId } = store.createArtifact(projectId, 'core_artifact', 'Screen Inventory', 'screen_inventory');

        const { versionId: v1Id } = store.createArtifactVersion(
            projectId,
            artifactId,
            'v1 content',
            {
                k: 1,
                validationBlockers: ['legacy blocker'],
                validationAcceptance: { actor: 'user' },
            },
            spineRef(spineId),
            'prompt-1',
        );
        store.createArtifactVersion(
            projectId, artifactId, 'v2 content', { k: 2 }, spineRef(spineId), 'prompt-2',
        );

        // Revert to v1.
        const { versionId: revertId } = store.revertArtifactToVersion(projectId, artifactId, v1Id);

        const versions = useProjectStore.getState().artifactVersions[projectId]
            .filter(v => v.artifactId === artifactId);
        expect(versions).toHaveLength(3);

        const reverted = versions.find(v => v.id === revertId)!;
        expect(reverted.versionNumber).toBe(3);
        expect(reverted.content).toBe('v1 content');
        expect(reverted.metadata).toEqual({
            k: 1,
            validationBlockers: ['legacy blocker'],
        });
        expect(reverted.generationPrompt).toBe('prompt-1');
        expect(reverted.sourceRefs).toEqual(spineRef(spineId));
        expect(reverted.isPreferred).toBe(true);
        expect(reverted.provenance?.changeSource).toBe('revert');
        expect(reverted.provenance?.revertedFromVersionId).toBe(v1Id);

        // Exactly one preferred; artifact currentVersionId points at the clone.
        expect(versions.filter(v => v.isPreferred)).toHaveLength(1);
        const artifact = useProjectStore.getState().artifacts[projectId].find(a => a.id === artifactId)!;
        expect(artifact.currentVersionId).toBe(revertId);
    });

    it('pushes a Reverted history event', () => {
        const store = useProjectStore.getState();
        const { projectId } = store.createProject('P', 'idea');
        const spineId = useProjectStore.getState().spineVersions[projectId][0].id;
        const { artifactId } = store.createArtifact(projectId, 'core_artifact', 'Data Model', 'data_model');
        const { versionId } = store.createArtifactVersion(
            projectId, artifactId, 'c', {}, spineRef(spineId), 'p',
        );
        store.createArtifactVersion(projectId, artifactId, 'c2', {}, spineRef(spineId), 'p2');
        store.revertArtifactToVersion(projectId, artifactId, versionId);

        const events = useProjectStore.getState().historyEvents[projectId];
        expect(events.some(e => e.type === 'Reverted' && e.artifactId === artifactId)).toBe(true);
    });
});
