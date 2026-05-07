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

        const spineCurrent = spineRef.sourceArtifactVersionId === latestSpine.id;

        // Mockup-specific: also check whether the recorded design system
        // tokensHash still matches the project's preferred design system.
        // Token-only changes (not just any new design_system version) drive
        // this — the artifactJobController records the tokensHash on the
        // mockup version's design_system source ref via SourceRef.anchorInfo.
        // Token regenerations that produce identical tokens leave the hash
        // unchanged and mockups stay current.
        if (artifact.type === 'mockup') {
            const designRef = preferredVersion.sourceRefs.find(
                r => r.sourceType === 'core_artifact' && typeof r.anchorInfo === 'string',
            );
            if (designRef) {
                const designSystem = (state.artifacts[projectId] || []).find(
                    a => a.type === 'core_artifact' && a.subtype === 'design_system' && a.status !== 'archived',
                );
                if (designSystem && designSystem.currentVersionId) {
                    const preferredDesign = (state.artifactVersions[projectId] || []).find(
                        v => v.id === designSystem.currentVersionId,
                    );
                    const currentHash = preferredDesign?.metadata?.tokensHash;
                    if (typeof currentHash === 'string' && currentHash !== designRef.anchorInfo) {
                        return 'possibly_outdated';
                    }
                }
            }
        }

        return spineCurrent ? 'current' : 'possibly_outdated';
    },
});
