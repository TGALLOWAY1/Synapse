import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from '../projectStore';
import type { SourceRef, StructuredPRD } from '../../types';

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

const prd = (vision: string): StructuredPRD => ({
    vision,
    targetUsers: [],
    coreProblem: '',
    features: [],
    architecture: '',
    risks: [],
});

describe('staleness after PRD revert', () => {
    it('flips a downstream artifact from current to possibly_outdated', () => {
        const store = useProjectStore.getState();
        const { projectId } = store.createProject('P', 'idea');
        const v1 = useProjectStore.getState().spineVersions[projectId][0];
        store.updateSpineStructuredPRD(projectId, v1.id, prd('v1'), 'md');

        // Artifact generated from the (then latest) spine v1.
        const { artifactId } = store.createArtifact(projectId, 'core_artifact', 'Screen Inventory', 'screen_inventory');
        const refs: SourceRef[] = [
            { id: 'r1', sourceArtifactId: v1.id, sourceArtifactVersionId: v1.id, sourceType: 'spine' },
        ];
        store.createArtifactVersion(projectId, artifactId, 'content', {}, refs, 'prompt');

        // Currently up to date with the latest spine.
        expect(useProjectStore.getState().getArtifactStaleness(projectId, artifactId)).toBe('current');

        // Edit the PRD so a newer spine becomes latest, then revert to v1.
        store.editSpineStructuredPRD(projectId, v1.id, prd('v2'));
        store.revertSpineToVersion(projectId, v1.id);

        // The artifact still references v1, but latest is now the reverted clone.
        expect(useProjectStore.getState().getArtifactStaleness(projectId, artifactId)).toBe('possibly_outdated');
    });
});
