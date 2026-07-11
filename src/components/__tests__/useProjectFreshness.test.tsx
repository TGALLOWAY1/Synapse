import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useProjectStore } from '../../store/projectStore';
import { useProjectFreshness } from '../../hooks/useProjectFreshness';
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
