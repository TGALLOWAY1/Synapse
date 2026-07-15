import type { StateCreator } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type {
    AssumptionInterpretationProposal,
    AssumptionValidationEvent,
    AssumptionValidationPlanProposal,
    DecisionAssessment,
    DecisionEvent,
    PlanningRecord,
    PlanningRecordStatus,
    ReviewIssue,
    ReviewIssueDisposition,
    ReviewRun,
    SpecialistFinding,
    SpecialistRun,
} from '../../types';
import { ASSUMPTION_VALIDATION_SCHEMA_VERSION, PLANNING_RECORD_SCHEMA_VERSION } from '../../types';
import {
    addAssumptionInterpretationProposal as addInterpretationProposal,
    addAssumptionValidationPlanProposal as addValidationPlanProposal,
    appendAssumptionValidationEvent as appendValidationEvent,
    assumptionValidationDecisionEvent,
    appendDecisionEvent,
    importPrdAssumptions,
    normalizePlanningRecord,
    planningContentHash,
} from '../../lib/planning';
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
    | 'supersedeOpenReviewIssues'
    | 'applyReviewIssueDisposition'
    | 'createPlanningRecord'
    | 'updatePlanningRecordStatusByUser'
    | 'appendPlanningDecisionEvent'
    | 'importPlanningAssumptions'
    | 'addPlanningAssessment'
    | 'appendAssumptionValidationEvent'
    | 'addAssumptionValidationPlanProposal'
    | 'addAssumptionInterpretationProposal'
>;

const currentPlanningContext = (state: ProjectState, projectId: string) => {
    const spine = (state.spineVersions[projectId] ?? []).find(item => item.isLatest)
        ?? state.spineVersions[projectId]?.at(-1);
    return spine ? {
        currentSpineVersionId: spine.id,
        currentSpineContentHash: planningContentHash(spine.structuredPRD ?? spine.responseText),
    } : {};
};

const planningRecordInitialStatus = (
    input: Pick<PlanningRecord, 'type' | 'createdBy' | 'status'>,
): PlanningRecordStatus => {
    // This is a domain invariant, not a UI convention: AI/review-originated
    // decisions are proposals and every other record is open. Callers cannot
    // smuggle a confirmed/resolved status through creation.
    if (input.createdBy === 'specialist_review' || input.createdBy === 'synapse') {
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
        set((state) => {
            const findings = state.reviewFindings[projectId] ?? [];
            const alreadyExists = findings.some(item => item.id === id && item.reviewId === next.reviewId);
            return {
                reviewFindings: alreadyExists ? state.reviewFindings : {
                    ...state.reviewFindings,
                    [projectId]: [...findings, next],
                },
                specialistRuns: {
                    ...state.specialistRuns,
                    [projectId]: (state.specialistRuns[projectId] ?? []).map((run) =>
                        run.id === next.specialistRunId && !run.findingIds.includes(id)
                            ? { ...run, findingIds: [...run.findingIds, id] }
                            : run,
                    ),
                },
            };
        });
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

    supersedeOpenReviewIssues: (projectId, reviewId, retainedIssueIds) => {
        const now = Date.now();
        const retained = new Set(retainedIssueIds);
        set((state) => ({
            reviewIssues: {
                ...state.reviewIssues,
                [projectId]: (state.reviewIssues[projectId] ?? []).map((issue) =>
                    issue.reviewId === reviewId && issue.status === 'open' && !retained.has(issue.id)
                        ? { ...issue, status: 'superseded', updatedAt: now }
                        : issue,
                ),
            },
        }));
    },

    applyReviewIssueDisposition: (projectId, reviewId, issueId, disposition) => {
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
                    if (issue.id !== issueId || issue.reviewId !== reviewId) return issue;
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
            schemaVersion: PLANNING_RECORD_SCHEMA_VERSION,
            events: input.events ?? [{
                id: uuidv4(),
                planningRecordId: id,
                type: 'created',
                actor: input.createdBy === 'user' ? 'user' : 'synapse',
                at: now,
            }],
            // Creation never confirms a review-derived record, even if a caller
            // supplied a timestamp along with an unsafe requested status.
            confirmedAt: input.createdBy === 'specialist_review' || input.createdBy === 'synapse'
                ? undefined
                : input.confirmedAt,
            // Validation authority is append-only. Creation inputs—including
            // model/review output—cannot smuggle a user conclusion into a new
            // assumption record.
            assumptionValidation: input.type === 'assumption' ? {
                schemaVersion: ASSUMPTION_VALIDATION_SCHEMA_VERSION,
                events: [],
                planProposals: [],
                interpretationProposals: [],
            } : undefined,
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
        set((state) => {
            const records = state.planningRecords[projectId] ?? [];
            const record = records.find(item => item.id === planningRecordId);
            if (!record) return state;
            let event: DecisionEvent;
            if (status === 'open') {
                event = { id: uuidv4(), planningRecordId, type: 'reopened', actor: 'user', at: now, rationale: patch?.rationale };
            } else if (status === 'deferred') {
                event = { id: uuidv4(), planningRecordId, type: 'deferred', actor: 'user', at: now, rationale: patch?.rationale };
            } else if (status === 'rejected') {
                event = { id: uuidv4(), planningRecordId, type: 'premise_rejected', actor: 'user', at: now, reason: patch?.resolution || 'Rejected by the user', rationale: patch?.rationale };
            } else {
                event = { id: uuidv4(), planningRecordId, type: 'custom_answered', actor: 'user', at: now, answer: patch?.resolution || record.resolution || record.statement, rationale: patch?.rationale };
            }
            const result = appendDecisionEvent(normalizePlanningRecord(record), event);
            if (!result.ok) return state;
            const nextRecord = {
                ...result.record,
                ...(patch?.supersedesId ? { supersedesId: patch.supersedesId } : {}),
                ...(patch?.resultingSpineVersionId ? { resultingSpineVersionId: patch.resultingSpineVersionId } : {}),
                // Non-decision records historically use resolved; keep that
                // compatibility projection while their event remains explicit.
                status: status === 'resolved' ? 'resolved' as const : result.record.status,
            };
            return {
                planningRecords: {
                    ...state.planningRecords,
                    [projectId]: records.map(item => item.id === planningRecordId ? nextRecord : item),
                },
            };
        });
    },

    appendPlanningDecisionEvent: (projectId, planningRecordId, event) => {
        let outcome: { ok: true; duplicate: boolean } | { ok: false; reason: string } = {
            ok: false,
            reason: 'Planning record not found.',
        };
        set((state) => {
            const records = state.planningRecords[projectId] ?? [];
            const record = records.find(item => item.id === planningRecordId);
            if (!record) return state;
            const result = appendDecisionEvent(normalizePlanningRecord(record), event);
            if (!result.ok) {
                outcome = result;
                return state;
            }
            outcome = { ok: true, duplicate: result.duplicate };
            if (result.duplicate) return state;
            return {
                planningRecords: {
                    ...state.planningRecords,
                    [projectId]: records.map(item => item.id === planningRecordId ? result.record : item),
                },
            };
        });
        return outcome;
    },

    importPlanningAssumptions: (projectId, sourceSpineVersionId, structuredPRD, preflightSession) => {
        let counts = { imported: 0, existing: 0 };
        set((state) => {
            const result = importPrdAssumptions({
                projectId,
                sourceSpineVersionId,
                structuredPRD,
                preflightSession,
                existingRecords: state.planningRecords[projectId] ?? [],
            });
            counts = { imported: result.imported.length, existing: result.existing.length };
            if (result.imported.length === 0 && result.updated.length === 0) return state;
            return {
                planningRecords: { ...state.planningRecords, [projectId]: result.records },
            };
        });
        return counts;
    },

    addPlanningAssessment: (projectId, planningRecordId, assessment: DecisionAssessment) => {
        set((state) => ({
            planningRecords: {
                ...state.planningRecords,
                [projectId]: (state.planningRecords[projectId] ?? []).map(record => {
                    if (record.id !== planningRecordId) return record;
                    const assessments = [...(record.assessments ?? []).filter(item => item.id !== assessment.id), assessment];
                    return { ...record, assessments, updatedAt: Date.now() };
                }),
            },
        }));
    },

    appendAssumptionValidationEvent: (projectId, planningRecordId, event: AssumptionValidationEvent) => {
        let outcome: { ok: true; duplicate: boolean; duplicateEvidenceOf?: string } | { ok: false; reason: string } = {
            ok: false,
            reason: 'Planning record not found.',
        };
        set((state) => {
            const records = state.planningRecords[projectId] ?? [];
            const record = records.find(item => item.id === planningRecordId);
            if (!record) return state;
            const normalized = normalizePlanningRecord(record);
            const result = appendValidationEvent(normalized, event, currentPlanningContext(state, projectId));
            if (!result.ok) {
                outcome = result;
                return state;
            }
            const canonicalEvent = result.record.assumptionValidation?.events.find(item => item.id === event.id);
            const decisionEvent = canonicalEvent
                ? assumptionValidationDecisionEvent(normalized, canonicalEvent)
                : undefined;
            const synchronized = decisionEvent
                ? appendDecisionEvent(result.record, decisionEvent)
                : { ok: true as const, record: result.record, duplicate: true };
            if (!synchronized.ok) {
                outcome = { ok: false, reason: `The validation outcome could not be bound to plan impact: ${synchronized.reason}` };
                return state;
            }
            outcome = {
                ok: true,
                duplicate: result.duplicate && synchronized.duplicate,
                ...(result.duplicateEvidenceOf ? { duplicateEvidenceOf: result.duplicateEvidenceOf } : {}),
            };
            if (result.duplicate && synchronized.duplicate) return state;
            return {
                planningRecords: {
                    ...state.planningRecords,
                    [projectId]: records.map(item => item.id === planningRecordId ? synchronized.record : item),
                },
            };
        });
        return outcome;
    },

    addAssumptionValidationPlanProposal: (
        projectId,
        planningRecordId,
        proposal: AssumptionValidationPlanProposal,
    ) => {
        let outcome: { ok: true; duplicate: boolean } | { ok: false; reason: string } = {
            ok: false,
            reason: 'Planning record not found.',
        };
        set((state) => {
            const records = state.planningRecords[projectId] ?? [];
            const record = records.find(item => item.id === planningRecordId);
            if (!record) return state;
            const result = addValidationPlanProposal(record, proposal, currentPlanningContext(state, projectId));
            if (!result.ok) {
                outcome = result;
                return state;
            }
            outcome = { ok: true, duplicate: result.duplicate };
            if (result.duplicate) return state;
            return {
                planningRecords: {
                    ...state.planningRecords,
                    [projectId]: records.map(item => item.id === planningRecordId ? result.record : item),
                },
            };
        });
        return outcome;
    },

    addAssumptionInterpretationProposal: (
        projectId,
        planningRecordId,
        proposal: AssumptionInterpretationProposal,
    ) => {
        let outcome: { ok: true; duplicate: boolean } | { ok: false; reason: string } = {
            ok: false,
            reason: 'Planning record not found.',
        };
        set((state) => {
            const records = state.planningRecords[projectId] ?? [];
            const record = records.find(item => item.id === planningRecordId);
            if (!record) return state;
            const result = addInterpretationProposal(record, proposal, currentPlanningContext(state, projectId));
            if (!result.ok) {
                outcome = result;
                return state;
            }
            outcome = { ok: true, duplicate: result.duplicate };
            if (result.duplicate) return state;
            return {
                planningRecords: {
                    ...state.planningRecords,
                    [projectId]: records.map(item => item.id === planningRecordId ? result.record : item),
                },
            };
        });
        return outcome;
    },
});
