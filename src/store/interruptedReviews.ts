import type { ReviewRun, SpecialistRun } from '../types';

/** Settle persisted in-flight reviews after a reload without losing results. */
export function markInterruptedReviews(
    reviewRuns: Record<string, ReviewRun[]>,
    specialistRuns: Record<string, SpecialistRun[]>,
): void {
    for (const projectId of Object.keys(reviewRuns ?? {})) {
        reviewRuns[projectId] = (reviewRuns[projectId] ?? []).map((run) => {
            if (run.status !== 'running' && run.status !== 'synthesizing') return run;
            return {
                ...run,
                status: 'interrupted',
                synthesisStatus: run.synthesisStatus === 'running' ? 'interrupted' : run.synthesisStatus,
            };
        });
    }
    for (const projectId of Object.keys(specialistRuns ?? {})) {
        specialistRuns[projectId] = (specialistRuns[projectId] ?? []).map((run) =>
            run.status === 'running' ? { ...run, status: 'interrupted' } : run,
        );
    }
}
