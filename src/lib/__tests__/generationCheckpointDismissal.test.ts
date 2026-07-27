import { beforeEach, describe, expect, it } from 'vitest';
import {
    GENERATION_CHECKPOINT_DISMISSED_KEY,
    clearDismissedGenerationCheckpoints,
    dismissGenerationCheckpoint,
    isGenerationCheckpointDismissed,
    readDismissedGenerationCheckpoints,
} from '../generationCheckpointDismissal';

describe('generationCheckpointDismissal', () => {
    beforeEach(() => {
        clearDismissedGenerationCheckpoints();
    });

    it('remembers a dismissal per project and generation job', () => {
        dismissGenerationCheckpoint('project-a', 'spine-1:100');

        expect(isGenerationCheckpointDismissed('project-a', 'spine-1:100')).toBe(true);
        expect(readDismissedGenerationCheckpoints('project-a')).toEqual(['spine-1:100']);
        // A different project never inherits it.
        expect(isGenerationCheckpointDismissed('project-b', 'spine-1:100')).toBe(false);
        // A NEW run of the same spine gets its own checkpoint again.
        expect(isGenerationCheckpointDismissed('project-a', 'spine-1:200')).toBe(false);
    });

    it('is idempotent and ignores missing ids', () => {
        dismissGenerationCheckpoint('project-a', 'spine-1:100');
        dismissGenerationCheckpoint('project-a', 'spine-1:100');
        dismissGenerationCheckpoint(undefined, 'spine-1:100');
        dismissGenerationCheckpoint('project-a', undefined);

        expect(readDismissedGenerationCheckpoints('project-a')).toEqual(['spine-1:100']);
        expect(isGenerationCheckpointDismissed(undefined, 'spine-1:100')).toBe(false);
        expect(readDismissedGenerationCheckpoints(undefined)).toEqual([]);
    });

    it('keeps the stored list bounded to the most recent dismissals', () => {
        for (let i = 0; i < 60; i += 1) {
            dismissGenerationCheckpoint('project-a', `spine-1:${i}`);
        }
        const stored = JSON.parse(
            localStorage.getItem(GENERATION_CHECKPOINT_DISMISSED_KEY) ?? '[]',
        ) as string[];

        expect(stored).toHaveLength(50);
        expect(isGenerationCheckpointDismissed('project-a', 'spine-1:59')).toBe(true);
        expect(isGenerationCheckpointDismissed('project-a', 'spine-1:0')).toBe(false);
    });

    it('survives corrupt storage without throwing', () => {
        localStorage.setItem(GENERATION_CHECKPOINT_DISMISSED_KEY, 'not-json');
        expect(readDismissedGenerationCheckpoints('project-a')).toEqual([]);
        expect(isGenerationCheckpointDismissed('project-a', 'spine-1:100')).toBe(false);

        dismissGenerationCheckpoint('project-a', 'spine-1:100');
        expect(isGenerationCheckpointDismissed('project-a', 'spine-1:100')).toBe(true);
    });
});
