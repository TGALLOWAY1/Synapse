import type { PlanningRecord, ReviewIssueDisposition } from '../../types';
import type { ReviewIssueAction } from './ReviewWorkspace';

export const recordTypeForAction = (action: ReviewIssueAction): PlanningRecord['type'] | undefined => ({
    propose_decision: 'decision',
    add_assumption: 'assumption',
    add_risk: 'risk',
    request_clarification: 'open_question',
    record_conflict: 'conflict',
    challenge_decision: 'conflict',
} as Partial<Record<ReviewIssueAction, PlanningRecord['type']>>)[action];

export type InitialReviewIssueDispositionAction = Exclude<ReviewIssueDisposition['action'], 'reopen'>;

export const DISPOSITION_BY_ACTION: Record<ReviewIssueAction, InitialReviewIssueDispositionAction> = {
    propose_decision: 'propose_record',
    add_assumption: 'propose_record',
    add_risk: 'propose_record',
    request_clarification: 'propose_record',
    record_conflict: 'propose_record',
    link_existing: 'link_existing',
    challenge_decision: 'challenge_existing',
    request_revision: 'request_revision',
    defer: 'defer',
    dismiss: 'dismiss',
    already_addressed: 'already_addressed',
};

export const dispositionForAction = (action: ReviewIssueAction): InitialReviewIssueDispositionAction => DISPOSITION_BY_ACTION[action];

export const issueTreatmentLabel = (action: ReviewIssueDisposition['action']): string => ({
    propose_record: 'Added to the Decision Center',
    link_existing: 'Connected to an existing planning item',
    challenge_existing: 'Recorded as a conflict with an existing decision',
    request_revision: 'Plan revision requested',
    defer: 'Deferred',
    dismiss: 'Dismissed with rationale',
    already_addressed: 'Marked already addressed',
    reopen: 'Returned to Needs attention',
})[action];
