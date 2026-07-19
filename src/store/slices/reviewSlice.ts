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
    appendAssumptionEvidenceCorrection,
    appendAssumptionValidationEvent as appendValidationEvent,
    assumptionEvidenceSetHash,
    assumptionStatementHash,
    assumptionValidationDecisionEvent,
    appendDecisionEvent,
    importPrdAssumptions,
    normalizePlanningRecord,
    planningContentHash,
    projectAssumptionValidation,
    projectDecision,
    sealAssumptionEvidence,
    sealAssumptionValidationEvent,
    type AssumptionEvidenceRecordedEvent,
    type AssumptionEvidenceRetractedEvent,
} from '../../lib/planning';
import type {
    AssumptionEvidenceCorrectionInput,
    AssumptionEvidenceMutationGuard,
    AssumptionEvidenceMutationResult,
    AssumptionEvidenceReplacementInput,
    ProjectState,
} from '../types';
import { validateReviewIssueRecovery } from '../../lib/review';

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
    | 'reopenReviewIssue'
    | 'createPlanningRecord'
    | 'setPlanningRecordDecisionOptions'
    | 'updatePlanningRecordStatusByUser'
    | 'appendPlanningDecisionEvent'
    | 'importPlanningAssumptions'
    | 'addPlanningAssessment'
    | 'appendAssumptionValidationEvent'
    | 'retractAssumptionEvidence'
    | 'correctAssumptionEvidence'
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

const evidenceMutationAt = (record: PlanningRecord): number => Math.max(
    Date.now(),
    (record.assumptionValidation?.events.at(-1)?.at ?? -Infinity) + 1,
);

const validateEvidenceMutationGuard = (
    record: PlanningRecord,
    input: AssumptionEvidenceMutationGuard,
    context: ReturnType<typeof currentPlanningContext>,
    at: number,
): { ok: true; evidence: ReturnType<typeof projectAssumptionValidation>['activeEvidence'][number] }
    | { ok: false; reason: string } => {
    if (!input.reason.trim()) return { ok: false, reason: 'Evidence correction or retraction requires a reason.' };
    if (!context.currentSpineVersionId || !context.currentSpineContentHash
        || input.expectedSpineVersionId !== context.currentSpineVersionId
        || input.expectedSpineContentHash !== context.currentSpineContentHash) {
        return { ok: false, reason: 'The plan changed before the evidence action was recorded.' };
    }
    const projection = projectAssumptionValidation(record, at);
    if (input.expectedEvidenceSetHash !== assumptionEvidenceSetHash(projection.activeEvidence)) {
        return { ok: false, reason: 'The evidence changed before this action was recorded.' };
    }
    const evidence = projection.activeEvidence.find(item => item.id === input.evidenceId);
    if (!evidence || evidence.planningRecordId !== record.id
        || evidence.contentHash !== input.expectedEvidenceContentHash) {
        return { ok: false, reason: 'The selected evidence is no longer current for this assumption.' };
    }
    return { ok: true, evidence };
};

const sameEvidenceMeaning = (
    evidence: ReturnType<typeof projectAssumptionValidation>['activeEvidence'][number],
    replacement: AssumptionEvidenceReplacementInput,
): boolean => evidence.sourceType === replacement.sourceType
    && evidence.source.trim() === replacement.source.trim()
    && evidence.sourceIdentity.trim() === replacement.sourceIdentity.trim()
    && evidence.observedAt === replacement.observedAt
    && evidence.observation.trim() === replacement.observation.trim()
    && (evidence.scopeOrSample?.trim() ?? '') === (replacement.scopeOrSample?.trim() ?? '')
    && evidence.limitations.map(item => item.trim()).filter(Boolean).join('\n')
        === replacement.limitations.map(item => item.trim()).filter(Boolean).join('\n')
    && evidence.character === replacement.character
    && evidence.relation === replacement.relation;

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

    reopenReviewIssue: (projectId, reviewId, issueId, input) => {
        let outcome: { ok: true } | { ok: false; reason: string } = {
            ok: false,
            reason: 'The Challenge finding could not be reopened.',
        };
        set((state) => {
            const issue = (state.reviewIssues[projectId] ?? []).find(item => (
                item.id === issueId && item.reviewId === reviewId
            ));
            const run = (state.reviewRuns[projectId] ?? []).find(item => item.id === reviewId);
            const validation = validateReviewIssueRecovery(issue, run, input);
            if (!validation.ok || !issue || !run) {
                outcome = validation.ok ? outcome : validation;
                return state;
            }
            const at = input.at ?? Date.now();
            const disposition: ReviewIssueDisposition = {
                action: 'reopen',
                actor: 'user',
                at,
                contextSignature: run.sourceManifest.contextSignature,
                reason: validation.reason,
            };
            outcome = { ok: true };
            return {
                reviewIssues: {
                    ...state.reviewIssues,
                    [projectId]: (state.reviewIssues[projectId] ?? []).map(item => item.id === issueId && item.reviewId === reviewId
                        ? {
                            ...item,
                            status: 'open',
                            dispositions: [...item.dispositions, disposition],
                            updatedAt: at,
                        }
                        : item),
                },
            };
        });
        return outcome;
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

    setPlanningRecordDecisionOptions: (projectId, planningRecordId, input) => {
        let outcome: { ok: true } | { ok: false; reason: string } = {
            ok: false,
            reason: 'Planning record not found.',
        };
        set((state) => {
            const records = state.planningRecords[projectId] ?? [];
            const record = records.find(item => item.id === planningRecordId);
            if (!record) return state;
            if (record.type !== 'decision' && record.type !== 'open_question') {
                outcome = { ok: false, reason: 'Only decisions and open questions accept suggested alternatives.' };
                return state;
            }
            // Suggestions are advisory input to an unresolved choice. Once a
            // user verdict exists, the presented options are part of that
            // verdict's context and must not be rewritten underneath it.
            const projection = projectDecision(normalizePlanningRecord(record));
            if (projection.status !== 'open' && projection.status !== 'proposed') {
                outcome = { ok: false, reason: 'This record already has an answer; reopen it before regenerating alternatives.' };
                return state;
            }
            outcome = { ok: true };
            return {
                planningRecords: {
                    ...state.planningRecords,
                    [projectId]: records.map(item => item.id === planningRecordId ? {
                        ...item,
                        decisionOptions: input.options,
                        recommendationDetail: input.recommendation,
                        decisionOptionsProvenance: input.provenance,
                        updatedAt: Date.now(),
                    } : item),
                },
            };
        });
        return outcome;
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

    retractAssumptionEvidence: (projectId, planningRecordId, input: AssumptionEvidenceMutationGuard) => {
        let outcome: AssumptionEvidenceMutationResult = { ok: false, reason: 'Planning record not found.' };
        set((state) => {
            const records = state.planningRecords[projectId] ?? [];
            const stored = records.find(item => item.id === planningRecordId);
            if (!stored || stored.type !== 'assumption') return state;
            const record = normalizePlanningRecord(stored);
            const context = currentPlanningContext(state, projectId);
            const at = evidenceMutationAt(record);
            const guard = validateEvidenceMutationGuard(record, input, context, at);
            if (!guard.ok) {
                outcome = guard;
                return state;
            }
            const event = sealAssumptionValidationEvent({
                id: uuidv4(), planningRecordId, actor: 'user', type: 'validation_evidence_retracted', at,
                assumptionStatementHash: assumptionStatementHash(record),
                expectedSpineVersionId: input.expectedSpineVersionId,
                expectedSpineContentHash: input.expectedSpineContentHash,
                expectedEvidenceSetHash: input.expectedEvidenceSetHash,
                evidenceId: guard.evidence.id,
                evidenceContentHash: guard.evidence.contentHash,
                reason: input.reason.trim(),
            });
            const result = appendValidationEvent(record, event, context);
            if (!result.ok) {
                outcome = result;
                return state;
            }
            if (result.duplicate) {
                outcome = { ok: false, reason: 'Evidence retraction must append a fresh user event.' };
                return state;
            }
            outcome = { ok: true, eventIds: [event.id] };
            return {
                planningRecords: {
                    ...state.planningRecords,
                    [projectId]: records.map(item => item.id === planningRecordId ? result.record : item),
                },
            };
        });
        return outcome;
    },

    correctAssumptionEvidence: (projectId, planningRecordId, input: AssumptionEvidenceCorrectionInput) => {
        let outcome: AssumptionEvidenceMutationResult = { ok: false, reason: 'Planning record not found.' };
        set((state) => {
            const records = state.planningRecords[projectId] ?? [];
            const stored = records.find(item => item.id === planningRecordId);
            if (!stored || stored.type !== 'assumption') return state;
            const record = normalizePlanningRecord(stored);
            const context = currentPlanningContext(state, projectId);
            const at = evidenceMutationAt(record);
            const guard = validateEvidenceMutationGuard(record, input, context, at);
            if (!guard.ok) {
                outcome = guard;
                return state;
            }
            const projection = projectAssumptionValidation(record, at);
            if (!projection.currentPlan) {
                outcome = { ok: false, reason: 'The validation plan changed before the evidence could be corrected.' };
                return state;
            }
            if (sameEvidenceMeaning(guard.evidence, input.replacement)) {
                outcome = { ok: false, reason: 'The correction does not change the evidence.' };
                return state;
            }
            const evidence = sealAssumptionEvidence({
                id: uuidv4(), planningRecordId,
                sourceType: input.replacement.sourceType,
                source: input.replacement.source.trim(),
                sourceIdentity: input.replacement.sourceIdentity.trim(),
                observedAt: input.replacement.observedAt,
                recordedAt: at,
                observation: input.replacement.observation.trim(),
                validationQuestion: projection.currentPlan.question,
                scopeOrSample: input.replacement.scopeOrSample?.trim() || undefined,
                limitations: input.replacement.limitations.map(item => item.trim()).filter(Boolean),
                character: input.replacement.character,
                relation: input.replacement.relation,
                assumptionStatementHash: assumptionStatementHash(record),
                validationPlanHash: projection.currentPlan.contentHash,
                authoredBy: 'user',
            });
            const replacementEvent = sealAssumptionValidationEvent({
                id: uuidv4(), planningRecordId, actor: 'user', type: 'validation_evidence_recorded', at,
                assumptionStatementHash: assumptionStatementHash(record),
                expectedSpineVersionId: input.expectedSpineVersionId,
                expectedSpineContentHash: input.expectedSpineContentHash,
                expectedEvidenceSetHash: input.expectedEvidenceSetHash,
                evidence,
            }) as AssumptionEvidenceRecordedEvent;
            const intermediate = appendValidationEvent(record, replacementEvent, context);
            if (!intermediate.ok) {
                outcome = intermediate;
                return state;
            }
            const intermediateProjection = projectAssumptionValidation(intermediate.record, at + 1);
            const retractionEvent = sealAssumptionValidationEvent({
                id: uuidv4(), planningRecordId, actor: 'user', type: 'validation_evidence_retracted', at: at + 1,
                assumptionStatementHash: assumptionStatementHash(record),
                expectedSpineVersionId: input.expectedSpineVersionId,
                expectedSpineContentHash: input.expectedSpineContentHash,
                expectedEvidenceSetHash: assumptionEvidenceSetHash(intermediateProjection.activeEvidence),
                evidenceId: guard.evidence.id,
                evidenceContentHash: guard.evidence.contentHash,
                reason: input.reason.trim(),
            }) as AssumptionEvidenceRetractedEvent;
            const result = appendAssumptionEvidenceCorrection(record, replacementEvent, retractionEvent, context);
            if (!result.ok) {
                outcome = result;
                return state;
            }
            outcome = { ok: true, evidenceId: evidence.id, eventIds: [replacementEvent.id, retractionEvent.id] };
            return {
                planningRecords: {
                    ...state.planningRecords,
                    [projectId]: records.map(item => item.id === planningRecordId ? result.record : item),
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
