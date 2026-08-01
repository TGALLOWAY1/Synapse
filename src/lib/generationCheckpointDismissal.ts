/**
 * Dismissal memory for the post-generation workflow checkpoint banner.
 *
 * A checkpoint the user closed must stay closed for THAT generation run — a
 * remount (switching projects and back, re-entering the workspace, a reload
 * that re-observes the same job) must not resurrect it.
 *
 * This is browser-local UI state, not project data, so it is deliberately kept
 * OUT of the Zustand project store: a new persisted store collection would
 * have to be wired into `ALL_PROJECT_COLLECTIONS`, the snapshot
 * collectors/restorers, sync and demo cleanup (CLAUDE.md rule 6), which is far
 * too much machinery for "the user closed a banner". It uses the repo's simple
 * direct-localStorage preference pattern (`tourPersistence.ts`,
 * `designPresetPreference.ts`) with defensive try/catch for private-mode /
 * storage-disabled browsers.
 *
 * Entries are stored as `${projectId}::${jobKey}` where `jobKey` is the
 * workspace's `spineVersionId:startedAt` generation-job key, so a NEW run
 * always shows its own checkpoint again.
 */

export const GENERATION_CHECKPOINT_DISMISSED_KEY = 'synapse-dismissed-generation-checkpoints';

/** Only the most recent dismissals matter; keep the list bounded. */
const MAX_REMEMBERED = 50;

const SEPARATOR = '::';

const entryId = (projectId: string, jobKey: string): string =>
    `${projectId}${SEPARATOR}${jobKey}`;

function readEntries(): string[] {
    try {
        const raw = localStorage.getItem(GENERATION_CHECKPOINT_DISMISSED_KEY);
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((value): value is string => typeof value === 'string');
    } catch {
        return [];
    }
}

/** The dismissed generation-job keys recorded for one project. */
export function readDismissedGenerationCheckpoints(projectId: string | undefined): string[] {
    if (!projectId) return [];
    const prefix = `${projectId}${SEPARATOR}`;
    return readEntries()
        .filter(entry => entry.startsWith(prefix))
        .map(entry => entry.slice(prefix.length));
}

/** True once this project's generation job has been dismissed. */
export function isGenerationCheckpointDismissed(
    projectId: string | undefined,
    jobKey: string | undefined,
): boolean {
    if (!projectId || !jobKey) return false;
    return readEntries().includes(entryId(projectId, jobKey));
}

/** Record a dismissal (idempotent, best-effort). */
export function dismissGenerationCheckpoint(
    projectId: string | undefined,
    jobKey: string | undefined,
): void {
    if (!projectId || !jobKey) return;
    try {
        const id = entryId(projectId, jobKey);
        const next = [...readEntries().filter(entry => entry !== id), id];
        localStorage.setItem(
            GENERATION_CHECKPOINT_DISMISSED_KEY,
            JSON.stringify(next.slice(-MAX_REMEMBERED)),
        );
    } catch {
        // Storage unavailable/full — dismissal simply won't outlive this mount.
    }
}

/** Forget every recorded dismissal (tests, and any future "reset UI" action). */
export function clearDismissedGenerationCheckpoints(): void {
    try {
        localStorage.removeItem(GENERATION_CHECKPOINT_DISMISSED_KEY);
    } catch {
        // ignore
    }
}
