import type { StateCreator } from 'zustand';
import type { StalenessState } from '../../types';
import type { ProjectState } from '../types';

export type StalenessSlice = {
    getArtifactStaleness: ProjectState['getArtifactStaleness'];
};

export const createStalenessSlice: StateCreator<ProjectState, [], [], StalenessSlice> = (_set, get) => ({
    getArtifactStaleness: (projectId: string, artifactId: string): StalenessState => {
        const state = get();
        const artifact = (state.artifacts[projectId] || []).find(a => a.id === artifactId);
        if (!artifact || !artifact.currentVersionId) return 'outdated';

        const preferredVersion = (state.artifactVersions[projectId] || [])
            .find(v => v.id === artifact.currentVersionId);
        if (!preferredVersion) return 'outdated';

        // Find the source spine version reference
        const spineRef = preferredVersion.sourceRefs.find(r => r.sourceType === 'spine');
        if (!spineRef) return 'possibly_outdated';

        // Compare against latest spine
        const latestSpine = (state.spineVersions[projectId] || []).find(v => v.isLatest);
        if (!latestSpine) return 'possibly_outdated';

        if (spineRef.sourceArtifactVersionId === latestSpine.id) return 'current';

        return 'possibly_outdated';
    },
});
