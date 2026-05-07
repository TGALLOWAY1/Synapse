import { describe, it, expect, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { useProjectStore } from '../projectStore';
import type { Artifact, ArtifactVersion, SourceRef, SpineVersion } from '../../types';

// Verifies the design-system tokensHash drift staleness check that the
// stalenessSlice extension performs for mockup artifacts. The contract:
// mockups become `possibly_outdated` when the recorded tokensHash on
// their design-system source ref differs from the project's current
// preferred design-system tokensHash; copy-only changes (which never
// produce a new ArtifactVersion) leave them current; non-mockup artifacts
// are unaffected.

const mockupArtifact = (projectId: string, id: string): Artifact => ({
    id,
    projectId,
    type: 'mockup',
    title: 'Mockup',
    status: 'active',
    currentVersionId: null,
    createdAt: 1,
    updatedAt: 1,
});

const designSystemArtifact = (projectId: string, id: string): Artifact => ({
    id,
    projectId,
    type: 'core_artifact',
    subtype: 'design_system',
    title: 'Design System',
    status: 'active',
    currentVersionId: null,
    createdAt: 1,
    updatedAt: 1,
});

const version = (
    _projectId: string,
    artifactId: string,
    versionId: string,
    sourceRefs: SourceRef[],
    metadata: Record<string, unknown> = {},
): ArtifactVersion => ({
    id: versionId,
    artifactId,
    versionNumber: 1,
    parentVersionId: null,
    content: '{}',
    metadata,
    sourceRefs,
    generationPrompt: '',
    isPreferred: true,
    createdAt: 1,
});

const spine = (id: string, projectId: string, isLatest: boolean): SpineVersion => ({
    id,
    projectId,
    promptText: '',
    responseText: '',
    createdAt: 1,
    isLatest,
    isFinal: true,
});

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

describe('stalenessSlice — design system tokensHash drift', () => {
    const projectId = 'project-1';
    const spineId = 'spine-1';

    function seedDesignSystem(designVersionId: string, tokensHash: string) {
        const artifactId = `design-${designVersionId}`;
        const artifact = { ...designSystemArtifact(projectId, artifactId), currentVersionId: designVersionId };
        const ds = version(projectId, artifactId, designVersionId, [], { tokensHash });
        useProjectStore.setState(state => ({
            artifacts: { ...state.artifacts, [projectId]: [...(state.artifacts[projectId] ?? []), artifact] },
            artifactVersions: { ...state.artifactVersions, [projectId]: [...(state.artifactVersions[projectId] ?? []), ds] },
        }));
        return { artifactId, designVersionId };
    }

    function seedMockup(mockupVersionId: string, designSystemSourceRef?: { artifactId: string; versionId: string; tokensHash: string }) {
        const mockupId = `mockup-${mockupVersionId}`;
        const artifact = { ...mockupArtifact(projectId, mockupId), currentVersionId: mockupVersionId };
        const refs: SourceRef[] = [
            { id: uuidv4(), sourceArtifactId: projectId, sourceArtifactVersionId: spineId, sourceType: 'spine' },
        ];
        if (designSystemSourceRef) {
            refs.push({
                id: uuidv4(),
                sourceArtifactId: designSystemSourceRef.artifactId,
                sourceArtifactVersionId: designSystemSourceRef.versionId,
                sourceType: 'core_artifact',
                anchorInfo: designSystemSourceRef.tokensHash,
            });
        }
        const v = version(projectId, mockupId, mockupVersionId, refs, {});
        useProjectStore.setState(state => ({
            artifacts: { ...state.artifacts, [projectId]: [...(state.artifacts[projectId] ?? []), artifact] },
            artifactVersions: { ...state.artifactVersions, [projectId]: [...(state.artifactVersions[projectId] ?? []), v] },
        }));
        return mockupId;
    }

    function seedSpine() {
        useProjectStore.setState(state => ({
            spineVersions: { ...state.spineVersions, [projectId]: [spine(spineId, projectId, true)] },
        }));
    }

    it('returns current when mockup tokensHash matches preferred design system', () => {
        seedSpine();
        const { artifactId, designVersionId } = seedDesignSystem('design-v1', 'hashA');
        const mockupId = seedMockup('mockup-v1', { artifactId, versionId: designVersionId, tokensHash: 'hashA' });

        const staleness = useProjectStore.getState().getArtifactStaleness(projectId, mockupId);
        expect(staleness).toBe('current');
    });

    it('returns possibly_outdated when tokens drift (different hash)', () => {
        seedSpine();
        // Mockup pulled in design 'hashA', but the user has since regenerated
        // the design system and the new preferred version has 'hashB'.
        const { artifactId, designVersionId } = seedDesignSystem('design-v1', 'hashB');
        const mockupId = seedMockup('mockup-v1', { artifactId, versionId: designVersionId, tokensHash: 'hashA' });

        const staleness = useProjectStore.getState().getArtifactStaleness(projectId, mockupId);
        expect(staleness).toBe('possibly_outdated');
    });

    it('stays current when design system was regenerated with identical tokens', () => {
        // Identical tokens → identical hash → mockup unchanged. This is the
        // "copy-only edit" / "no-op regeneration" case the user explicitly
        // wanted preserved.
        seedSpine();
        const { artifactId, designVersionId } = seedDesignSystem('design-v2', 'hashA');
        const mockupId = seedMockup('mockup-v1', { artifactId, versionId: designVersionId, tokensHash: 'hashA' });

        const staleness = useProjectStore.getState().getArtifactStaleness(projectId, mockupId);
        expect(staleness).toBe('current');
    });

    it('falls back to spine-only check when mockup has no design system source ref', () => {
        // Legacy mockup (created before this change) — no second source ref.
        // Behavior must match the pre-change spine-based contract.
        seedSpine();
        seedDesignSystem('design-v1', 'hashB');
        const mockupId = seedMockup('mockup-v1', undefined);

        const staleness = useProjectStore.getState().getArtifactStaleness(projectId, mockupId);
        expect(staleness).toBe('current');
    });

    it('does not affect non-mockup artifacts (PRD spine boundary preserved)', () => {
        // Even with a stale-looking design system source ref, a core_artifact
        // type other than mockup must NOT be marked stale by the new check.
        seedSpine();
        const { artifactId: dsArtifactId, designVersionId } = seedDesignSystem('design-v1', 'hashB');

        // Manually seed a screen_inventory artifact with a (hypothetical)
        // design-system source ref carrying the old hash. Today no artifact
        // does this in practice, but the check must remain mockup-scoped
        // either way.
        const inventoryId = 'screen-inv-1';
        const inventoryVersionId = 'siv-1';
        const inventoryArtifact: Artifact = {
            id: inventoryId,
            projectId,
            type: 'core_artifact',
            subtype: 'screen_inventory',
            title: 'Screen Inventory',
            status: 'active',
            currentVersionId: inventoryVersionId,
            createdAt: 1,
            updatedAt: 1,
        };
        const inventoryVersion = version(projectId, inventoryId, inventoryVersionId, [
            { id: uuidv4(), sourceArtifactId: projectId, sourceArtifactVersionId: spineId, sourceType: 'spine' },
            { id: uuidv4(), sourceArtifactId: dsArtifactId, sourceArtifactVersionId: designVersionId, sourceType: 'core_artifact', anchorInfo: 'hashA' },
        ], {});
        useProjectStore.setState(state => ({
            artifacts: { ...state.artifacts, [projectId]: [...(state.artifacts[projectId] ?? []), inventoryArtifact] },
            artifactVersions: { ...state.artifactVersions, [projectId]: [...(state.artifactVersions[projectId] ?? []), inventoryVersion] },
        }));

        // Non-mockup artifact: spine matches, design ref drift is ignored → current.
        const staleness = useProjectStore.getState().getArtifactStaleness(projectId, inventoryId);
        expect(staleness).toBe('current');
    });

    it('still reports stale when spine drifts even if design system tokens match', () => {
        // New spine version (isLatest = true), different from the one the
        // mockup pulled. The design system check is gated on artifact type;
        // the spine drift remains the dominant signal.
        useProjectStore.setState(state => ({
            spineVersions: {
                ...state.spineVersions,
                [projectId]: [
                    { ...spine(spineId, projectId, false) },
                    { ...spine('spine-2', projectId, true) },
                ],
            },
        }));
        const { artifactId, designVersionId } = seedDesignSystem('design-v1', 'hashA');
        const mockupId = seedMockup('mockup-v1', { artifactId, versionId: designVersionId, tokensHash: 'hashA' });

        const staleness = useProjectStore.getState().getArtifactStaleness(projectId, mockupId);
        expect(staleness).toBe('possibly_outdated');
    });
});
