import { useEffect, useState } from 'react';
import { useProjectStore, requestCrossTabCatchUp } from '../store/projectStore';
import { artifactJobController } from '../lib/services/artifactJobController';
import type { ProjectCapabilities } from '../lib/projectCapabilities';
import {
    getTabId,
    isOutputRunLiveElsewhere,
    OUTPUT_RUN_HEARTBEAT_MS,
} from '../lib/outputRunLease';
import type { OutputRunMarker } from '../types';

/** This tab's memory shows a 'running' marker owned by another tab. */
function foreignRunningMarker(marker: OutputRunMarker | undefined): boolean {
    return !!marker && marker.phase === 'running' && marker.ownerTabId !== getTabId();
}

/**
 * Is another tab's run alive right now? Memory first (cheap). Once memory
 * alone no longer proves it — this tab never receives the other tab's
 * heartbeats on its own — ask what that tab last persisted.
 */
function foreignRunLive(projectId: string): boolean {
    const marker = useProjectStore.getState().projects[projectId]?.outputRun;
    if (isOutputRunLiveElsewhere(marker, Date.now(), getTabId())) return true;
    return foreignRunningMarker(marker) && artifactJobController.isRunLiveElsewhere(projectId);
}

/**
 * Whether another tab holds a live lease on this project's output run
 * (src/lib/outputRunLease.ts). While it does, the Build view shows that run's
 * in-progress state read-only (generating or editing here would duplicate it
 * or race its writes). Re-checked every heartbeat interval while live; once
 * the run settles or its lease lapses, this tab pulls in the other tab's
 * writes so the view shows the outcome.
 */
export function useOutputRunLiveElsewhere(projectId: string): boolean {
    const marker = useProjectStore((s) => s.projects[projectId]?.outputRun);
    const [live, setLive] = useState(() => foreignRunLive(projectId));

    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const check = () => {
            const next = foreignRunLive(projectId);
            setLive(next);
            if (next) {
                timer = setTimeout(check, OUTPUT_RUN_HEARTBEAT_MS);
                return;
            }
            // The other tab's run settled or its lease lapsed while this tab
            // still holds its marker: catch up with that tab's writes.
            if (foreignRunningMarker(useProjectStore.getState().projects[projectId]?.outputRun)) {
                requestCrossTabCatchUp();
            }
        };
        timer = setTimeout(check, 0);
        return () => clearTimeout(timer);
    }, [projectId, marker]);

    return live;
}

/** The Build view's capabilities while another tab's run is live: look, don't touch. */
export function readOnlyWhileRunElsewhere(capabilities: ProjectCapabilities): ProjectCapabilities {
    return {
        ...capabilities,
        canEditArtifacts: false,
        canReviewArtifacts: false,
        canGenerateArtifacts: false,
        canManageDesignSystem: false,
        canPersistWorkflowState: false,
    };
}
