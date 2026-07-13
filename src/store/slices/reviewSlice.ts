import type { StateCreator } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type {
    PlanningRecord,
    PlanningRecordStatus,
    ReviewIssue,
    ReviewIssueDisposition,
    ReviewRun,
    SpecialistFinding,
    SpecialistRun,
} from '../../types';
import type { ProjectState } from '../types';

export type ReviewSlice = Pick<
    ProjectState,
    | 'reviewRuns'
    | 'specialistRuns'
    | 'reviewFindings'
    | 'reviewIssues'
    | 'planningRecords'
    | 'createReviewRun'
    | 'updateReviewRun'
    | 'createSpecialistRun'
    | 'updateSpecialistRun'
    | 'addReviewFinding'
    | 'addReviewIssue'
    | 'applyReviewIssueDisposition'
    | 'createPlanningRecord'
    | 'updatePlanningRecordStatusByUser'
>;

const planningRecordInitialStatus = (
    input: Pick<PlanningRecord, 'type' | 'createdBy' | 'status'>,
): PlanningRecordStatus => {
    // This is a domain invariant, not a UI convention: AI/review-originated
    // decisions are proposals and every other record is open. Callers cannot
    // smuggle a confirmed/resolved status through creation.
    if (input.createdBy === 'specialist_review') {
        return input.type === 'decision' ? 'proposed' : 'open';
    }
    return input.status;
};

export const createReviewSlice: StateCreator<ProjectState, [], [], ReviewSlice> = (set) => ({
    reviewRuns: {},
    specialistRuns: {},
    reviewFindings: {},
    reviewIssues: {},
    planningRecords: {},

    createReviewRun: (projectId, input) => {
        const id = uuidv4();
        const now = Date.now();
        set((state) => {
            const existing = state.reviewRuns[projectId] ?? [];
            const run: ReviewRun = {
                ...input,
                id,
                projectId,
                sequenceNumber: existing.length + 1,
                status: 'queued',
                synthesisStatus: 'pending',
                createdAt: now,
            };
            return { reviewRuns: { ...state.reviewRuns, [projectId]: [...existing, run] } };
        });
        return { reviewId: id };
    },

    updateReviewRun: (projectId, reviewId, patch) => {
        set((state) => ({
            reviewRuns: {
                ...state.reviewRuns,
                [projectId]: (state.reviewRuns[projectId] ?? []).map((run) =>
                    run.id === reviewId ? { ...run, ...patch, id: run.id, projectId: run.projectId } : run,
                ),
            },
        }));
    },

    createSpecialistRun: (projectId, input) => {
        const id = uuidv4();
        const run: SpecialistRun = {
            ...input,
            id,
            projectId,
            status: 'queued',
            attemptCount: 0,
            findingIds: [],
            createdAt: Date.now(),
        };
        set((state) => ({
            specialistRuns: {
                ...state.specialistRuns,
                [projectId]: [...(state.specialistRuns[projectId] ?? []), run],
            },
        }));
        return { specialistRunId: id };
    },

    updateSpecialistRun: (projectId, specialistRunId, patch) => {
        set((state) => ({
            specialistRuns: {
                ...state.specialistRuns,
                [projectId]: (state.specialistRuns[projectId] ?? []).map((run) =>
                    run.id === specialistRunId
                        ? { ...run, ...patch, id: run.id, projectId: run.projectId, reviewId: run.reviewId }
                        : run,
                ),
            },
        }));
    },

    addReviewFinding: (projectId, finding) => {
        const id = finding.id || uuidv4();
        const next: SpecialistFinding = { ...finding, id, projectId };
        set((state) => ({
            reviewFindings: {
                ...state.reviewFindings,
                [projectId]: [...(state.reviewFindings[projectId] ?? []), next],
            },
            specialistRuns: {
                ...state.specialistRuns,
                [projectId]: (state.specialistRuns[projectId] ?? []).map((run) =>
                    run.id === next.specialistRunId && !run.findingIds.includes(id)
                        ? { ...run, findingIds: [...run.findingIds, id] }
                        : run,
                ),
            },
        }));
        return { findingId: id };
    },

    addReviewIssue: (projectId, issue) => {
        const id = issue.id || uuidv4();
        const now = Date.now();
        const next: ReviewIssue = {
            ...issue,
            id,
            projectId,
            status: 'open',
            dispositions: [],
            relatedPlanningRecordIds: issue.relatedPlanningRecordIds ?? [],
            createdAt: issue.createdAt || now,
            updatedAt: now,
        };
        set((state) => ({
            reviewIssues: {
                ...state.reviewIssues,
                [projectId]: [...(state.reviewIssues[projectId] ?? []), next],
            },
        }));
        return { issueId: id };
    },

    applyReviewIssueDisposition: (projectId, issueId, disposition) => {
        const nextDisposition: ReviewIssueDisposition = {
            ...disposition,
            actor: 'user',
            at: disposition.at || Date.now(),
        };
        const statusByAction: Partial<Record<ReviewIssueDisposition['action'], ReviewIssue['status']>> = {
            propose_record: 'acted',
            link_existing: 'acted',
            challenge_existing: 'acted',
            request_revision: 'acted',
            defer: 'deferred',
            dismiss: 'dismissed',
            already_addressed: 'already_addressed',
        };
        set((state) => ({
            reviewIssues: {
                ...state.reviewIssues,
                [projectId]: (state.reviewIssues[projectId] ?? []).map((issue) => {
                    if (issue.id !== issueId) return issue;
                    const recordIds = nextDisposition.planningRecordId
                        && !issue.relatedPlanningRecordIds.includes(nextDisposition.planningRecordId)
                        ? [...issue.relatedPlanningRecordIds, nextDisposition.planningRecordId]
                        : issue.relatedPlanningRecordIds;
                    return {
                        ...issue,
                        status: statusByAction[nextDisposition.action] ?? issue.status,
                        dispositions: [...issue.dispositions, nextDisposition],
                        relatedPlanningRecordIds: recordIds,
                        updatedAt: nextDisposition.at,
                    };
                }),
            },
        }));
    },

    createPlanningRecord: (projectId, input) => {
        const id = uuidv4();
        const now = Date.now();
        const record: PlanningRecord = {
            ...input,
            id,
            projectId,
            status: planningRecordInitialStatus(input),
            createdAt: now,
            updatedAt: now,
            // Creation never confirms a review-derived record, even if a caller
            // supplied a timestamp along with an unsafe requested status.
            confirmedAt: input.createdBy === 'specialist_review' ? undefined : input.confirmedAt,
        };
        set((state) => ({
            planningRecords: {
                ...state.planningRecords,
                [projectId]: [...(state.planningRecords[projectId] ?? []), record],
            },
        }));
        return { planningRecordId: id };
    },

    updatePlanningRecordStatusByUser: (projectId, planningRecordId, status, patch) => {
        const now = Date.now();
        set((state) => ({
            planningRecords: {
                ...state.planningRecords,
                [projectId]: (state.planningRecords[projectId] ?? []).map((record) =>
                    record.id === planningRecordId
                        ? {
                            ...record,
                            ...patch,
                            id: record.id,
                            projectId: record.projectId,
                            status,
                            updatedAt: now,
                            confirmedAt: status === 'confirmed' ? now : record.confirmedAt,
                        }
                        : record,
                ),
            },
        }));
    },
});

