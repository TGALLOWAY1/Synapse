import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { readOnlyWhileRunElsewhere, useOutputRunLiveElsewhere } from '../../hooks/useOutputRunLiveElsewhere';
import { useProjectStore } from '../../store/projectStore';
import { setActiveProjectUser } from '../../store/userScope';
import { getProjectCapabilities } from '../../lib/projectCapabilities';
import { getTabId, OUTPUT_RUN_LEASE_MS } from '../../lib/outputRunLease';
import type { OutputRunMarker } from '../../types';

// While another tab holds a live output-run lease, the Build view shows that
// run read-only (src/lib/outputRunLease.ts, ArtifactWorkspace).

const projectId = 'p-lease';
const marker = (ownerTabId: string, heartbeatAt: number): OutputRunMarker => ({
    spineVersionId: 's1', runId: 'r1', startedAt: heartbeatAt - 1_000, phase: 'running', ownerTabId, heartbeatAt,
});

function seedMemory(outputRun?: OutputRunMarker): void {
    useProjectStore.setState({
        projects: { [projectId]: { id: projectId, name: 'P', createdAt: 1, ...(outputRun ? { outputRun } : {}) } },
    });
}

function persistMarker(outputRun: OutputRunMarker): void {
    localStorage.setItem('synapse-projects-storage', JSON.stringify({
        state: { projects: { [projectId]: { id: projectId, name: 'P', createdAt: 1, outputRun } } },
        version: 0,
    }));
}

beforeEach(() => {
    localStorage.clear();
    setActiveProjectUser(null);
});

afterEach(() => {
    localStorage.clear();
});

describe('useOutputRunLiveElsewhere', () => {
    it('reports another tab\'s run with a fresh heartbeat as live', () => {
        seedMemory(marker('other-tab', Date.now()));
        const { result } = renderHook(() => useOutputRunLiveElsewhere(projectId));
        expect(result.current).toBe(true);
    });

    it('never reports this tab\'s own run, or no run', () => {
        seedMemory(marker(getTabId(), Date.now()));
        expect(renderHook(() => useOutputRunLiveElsewhere(projectId)).result.current).toBe(false);
        seedMemory();
        expect(renderHook(() => useOutputRunLiveElsewhere(projectId)).result.current).toBe(false);
    });

    it('keeps the run live when only this tab\'s copy of the heartbeat lapsed but the owner kept writing', () => {
        seedMemory(marker('other-tab', Date.now() - OUTPUT_RUN_LEASE_MS - 5_000));
        persistMarker(marker('other-tab', Date.now()));
        expect(renderHook(() => useOutputRunLiveElsewhere(projectId)).result.current).toBe(true);
    });

    it('lets go once the owner stopped heartbeating', () => {
        const lapsed = marker('other-tab', Date.now() - OUTPUT_RUN_LEASE_MS - 5_000);
        seedMemory(lapsed);
        persistMarker(lapsed);
        expect(renderHook(() => useOutputRunLiveElsewhere(projectId)).result.current).toBe(false);
    });
});

describe('readOnlyWhileRunElsewhere', () => {
    it('turns off generation and editing but keeps exploring', () => {
        const readOnly = readOnlyWhileRunElsewhere(getProjectCapabilities({ id: projectId }));
        expect(readOnly).toMatchObject({
            canExplore: true,
            canGenerateArtifacts: false,
            canEditArtifacts: false,
            canReviewArtifacts: false,
            canManageDesignSystem: false,
            canPersistWorkflowState: false,
        });
    });
});
