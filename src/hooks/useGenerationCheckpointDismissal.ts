import { useCallback, useState } from 'react';
import {
    dismissGenerationCheckpoint,
    readDismissedGenerationCheckpoints,
} from '../lib/generationCheckpointDismissal';

export type GenerationCheckpointDismissal = {
    /** True when this generation-job key was already dismissed for the project. */
    isDismissed: (jobKey: string | undefined) => boolean;
    /** Persist a dismissal for this generation-job key. */
    dismiss: (jobKey: string | undefined) => void;
};

/**
 * Read/write side of the persisted post-generation checkpoint dismissal
 * (`src/lib/generationCheckpointDismissal.ts`). Seeded once from storage so a
 * dismissed checkpoint stays dismissed across a remount, and mirrored in React
 * state so dismissing re-renders the workspace immediately.
 */
export function useGenerationCheckpointDismissal(
    projectId: string | undefined,
): GenerationCheckpointDismissal {
    const [dismissedKeys, setDismissedKeys] = useState<readonly string[]>(
        () => readDismissedGenerationCheckpoints(projectId),
    );
    // The workspace remounts per project (ProjectWorkspaceSession is keyed by
    // projectId), but re-seed defensively if a caller ever swaps the id in
    // place. Adjusted during render rather than in an effect — React's
    // documented "state derived from props" pattern, and the only shape the
    // repo's react-hooks lint allows.
    const [seededProjectId, setSeededProjectId] = useState(projectId);
    if (seededProjectId !== projectId) {
        setSeededProjectId(projectId);
        setDismissedKeys(readDismissedGenerationCheckpoints(projectId));
    }

    const isDismissed = useCallback(
        (jobKey: string | undefined) => !!jobKey && dismissedKeys.includes(jobKey),
        [dismissedKeys],
    );
    const dismiss = useCallback((jobKey: string | undefined) => {
        if (!projectId || !jobKey) return;
        dismissGenerationCheckpoint(projectId, jobKey);
        setDismissedKeys(prev => (prev.includes(jobKey) ? prev : [...prev, jobKey]));
    }, [projectId]);

    return { isDismissed, dismiss };
}
