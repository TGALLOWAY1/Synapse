import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useProjectStore } from '../../store/projectStore';
import { useProjectFreshness } from '../../hooks/useProjectFreshness';
import { computeArtifactInputHashes, selectArtifactPrdInput } from '../../lib/artifactInputSlices';
import type { SourceRef, StructuredPRD } from '../../types';

// Guards the two things that matter for the hook: (1) it obeys the
// selector-stability rule — an unrelated store update must NOT produce a new
// result object (else useSyncExternalStore churns → React #185), and (2) it
// recomputes when a slice it actually depends on changes.

beforeEach(() => {
    useProjectStore.setState({
        projects: {},
        spineVersions: {},
        historyEvents: {},
        branches: {},
        artifacts: {},
        artifactVersions: {},
        feedbackItems: {},
        jobs: {},
    });
    localStorage.clear();
});

const prd = (vision: string): StructuredPRD => ({
    vision, targetUsers: [], coreProblem: '', features: [], architecture: '', risks: [],
});

function seedProject(vision = 'v1') {
    const store = useProjectStore.getState();
    const { projectId } = store.createProject('P', 'idea');
    const v1 = useProjectStore.getState().spineVersions[projectId][0];
    store.updateSpineStructuredPRD(projectId, v1.id, prd(vision), 'md');
    const { artifactId } = store.createArtifact(projectId, 'core_artifact', 'Screen Inventory', 'screen_inventory');
    const refs: SourceRef[] = [
        { id: 'r1', sourceArtifactId: v1.id, sourceArtifactVersionId: v1.id, sourceType: 'spine' },
    ];
    store.createArtifactVersion(projectId, artifactId, 'content', {}, refs, 'prompt');
    return { projectId, spineV1Id: v1.id, artifactId };
}

describe('useProjectFreshness', () => {
    it('returns a stable reference across an unrelated store update', () => {
        const { projectId } = seedProject();
        const { result } = renderHook(() => useProjectFreshness(projectId));
        const first = result.current;
        expect(first.bySlot('screen_inventory')?.status).toBe('up_to_date');

        // An update to a slice the hook does not subscribe to for this project.
        act(() => {
            useProjectStore.setState(s => ({
                feedbackItems: { ...s.feedbackItems, other: [] },
            }));
        });

        expect(result.current).toBe(first);
    });

    it('recomputes (new reference + new status) when the depended-on slice changes', () => {
        const store = useProjectStore.getState();
        const { projectId, spineV1Id } = seedProject();
        const { result } = renderHook(() => useProjectFreshness(projectId));
        const first = result.current;
        expect(first.bySlot('screen_inventory')?.status).toBe('up_to_date');

        // Editing the PRD changes spineVersions[projectId] → the hook recomputes.
        act(() => {
            store.editSpineStructuredPRD(projectId, spineV1Id, prd('v2'));
        });

        expect(result.current).not.toBe(first);
        expect(result.current.bySlot('screen_inventory')?.status).toBe('needs_update');
    });

    it('exposes byArtifactId and recommendedUpdates', () => {
        const store = useProjectStore.getState();
        const { projectId, spineV1Id, artifactId } = seedProject();
        act(() => {
            store.editSpineStructuredPRD(projectId, spineV1Id, prd('v2'));
        });
        const { result } = renderHook(() => useProjectFreshness(projectId));
        expect(result.current.byArtifactId.get(artifactId)?.status).toBe('needs_update');
        expect(result.current.recommendedUpdates).toContain('screen_inventory');
    });
});

describe('useProjectFreshness — input fingerprints', () => {
    /** A screen inventory that recorded the fingerprint of the v1 inputs. */
    function seedFingerprinted() {
        const store = useProjectStore.getState();
        const { projectId } = store.createProject('P', 'idea', 'web');
        const v1 = useProjectStore.getState().spineVersions[projectId][0];
        store.updateSpineStructuredPRD(projectId, v1.id, prd('v1'), 'md');
        const spine = useProjectStore.getState().spineVersions[projectId][0];
        const inputHashes = computeArtifactInputHashes('screen_inventory', selectArtifactPrdInput('screen_inventory', {
            structuredPRD: spine.structuredPRD!,
            prdMarkdown: spine.responseText,
            project: useProjectStore.getState().projects[projectId],
        }), {});
        const { artifactId } = store.createArtifact(projectId, 'core_artifact', 'Screen Inventory', 'screen_inventory');
        store.createArtifactVersion(projectId, artifactId, 'content', {}, [
            { id: 'r1', sourceArtifactId: projectId, sourceArtifactVersionId: v1.id, sourceType: 'spine' },
        ], 'prompt', null, { inputHashes });
        return { projectId, spineV1Id: v1.id };
    }

    it('reads the project options, so a restore to identical content stays up to date', () => {
        const store = useProjectStore.getState();
        const { projectId, spineV1Id } = seedFingerprinted();
        const { result } = renderHook(() => useProjectFreshness(projectId));
        act(() => {
            store.editSpineStructuredPRD(projectId, spineV1Id, prd('v2'));
        });
        expect(result.current.bySlot('screen_inventory')?.status).toBe('needs_update');
        act(() => {
            store.revertSpineToVersion(projectId, spineV1Id);
        });
        expect(result.current.bySlot('screen_inventory')?.status).toBe('up_to_date');
    });

    it('recomputes when a project option the fingerprint reads changes', () => {
        const { projectId } = seedFingerprinted();
        const { result } = renderHook(() => useProjectFreshness(projectId));
        const first = result.current;
        act(() => {
            useProjectStore.getState().setProjectDesignSystemPreset(projectId, 'saas_minimal');
        });
        expect(result.current).not.toBe(first);
    });

    it('keeps a stable reference across a project-record write it does not read (the run heartbeat)', () => {
        const { projectId } = seedFingerprinted();
        const { result } = renderHook(() => useProjectFreshness(projectId));
        const first = result.current;
        act(() => {
            useProjectStore.setState(s => ({
                projects: { ...s.projects, [projectId]: { ...s.projects[projectId], updatedAt: 42 } },
            }));
        });
        expect(result.current).toBe(first);
    });
});
