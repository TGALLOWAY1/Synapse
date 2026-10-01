import type { Project, SpineVersion } from '../types';

/**
 * Detect spines whose PRD generation was interrupted (page refreshed or
 * closed mid-run) and convert them into a settled error state.
 *
 * Two signals identify an interrupted run:
 * - `generationPhase === 'running'` — the explicit lifecycle marker stamped
 *   when generation starts. Any run alive at save time is dead by the time
 *   this executes (a full page load kills the in-flight pipeline).
 * - The legacy `'Generating PRD...'` placeholder with no structured PRD —
 *   covers projects persisted before the marker existed, and the brief
 *   window between spine creation and the first pipeline store write.
 *
 * Skipped: spines that already settled (error or blocked safety review) and
 * spines whose preflight clarification is still open — those never started
 * generating, so there is nothing to recover.
 *
 * Mutates `spineVersions` in place (it runs inside zustand's
 * onRehydrateStorage, which hands us the draft state) and returns whether
 * anything was changed.
 */
export function markInterruptedGenerations(
    spineVersions: Record<string, SpineVersion[]>,
): boolean {
    let changed = false;
    for (const projectId of Object.keys(spineVersions)) {
        const spines = spineVersions[projectId];
        if (!Array.isArray(spines)) continue;
        spineVersions[projectId] = spines.map((s) => {
            if (s.generationError) return s;
            if (s.safetyReview?.status === 'blocked') return s;
            if (s.preflightSession && !s.preflightSession.completed) return s;

            const explicitlyRunning = s.generationPhase === 'running';
            const legacyStuckPlaceholder =
                s.responseText === 'Generating PRD...' && !s.structuredPRD;
            if (!explicitlyRunning && !legacyStuckPlaceholder) return s;

            changed = true;
            return {
                ...s,
                generationPhase: 'complete' as const,
                responseText: s.responseText === 'Generating PRD...' ? '' : s.responseText,
                generationError: {
                    message:
                        'Generation was interrupted before it finished — usually because the page was refreshed or closed mid-run. Use Try Again to restart it.',
                    category: 'interrupted',
                    timestamp: Date.now(),
                },
            };
        });
    }
    return changed;
}

/**
 * The artifact-output counterpart of `markInterruptedGenerations`: a page load
 * kills any in-flight output run, so a project still carrying a `'running'`
 * `outputRun` marker was interrupted mid-run. Flip it to `'interrupted'` —
 * the durable evidence `artifactJobController.resumeIfNeeded` uses to resume
 * the run on the next Build mount even when NO output had completed yet.
 * (Only a load converts: a `'running'` marker adopted from another tab or
 * pulled from another device may belong to a run that is still live there.)
 *
 * Mutates `projects` in place (onRehydrateStorage hands us the draft state)
 * and returns whether anything was changed.
 */
export function markInterruptedOutputRuns(projects: Record<string, Project>): boolean {
    let changed = false;
    for (const projectId of Object.keys(projects)) {
        const project = projects[projectId];
        const run = project?.outputRun;
        if (!run || run.phase !== 'running') continue;
        projects[projectId] = { ...project, outputRun: { ...run, phase: 'interrupted' } };
        changed = true;
    }
    return changed;
}
