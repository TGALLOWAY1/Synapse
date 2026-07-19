import { useProjectStore } from '../../store/projectStore';
import { useToastStore } from '../../store/toastStore';
import { hashReviewValue, type ReviewContextManifest } from '../../lib/review';
import type { ReviewIssueAction } from './ReviewWorkspace';
import { dispositionForAction, recordTypeForAction } from './reviewIssueDispositions';

/**
 * User dispositions on synthesized review issues: acting on an issue (with
 * optional planning-record creation), reopening a treated issue against the
 * current context, and triaging an untriaged finding into a standalone issue.
 */
export function useReviewIssueActions(params: {
    projectId: string;
    canWrite: boolean;
    currentManifest: ReviewContextManifest | undefined;
    /** Called after a NEW choice record (decision/open question) is created
     * from an issue, so suggested alternatives can start generating. */
    onChoiceRecordCreated?: (recordId: string) => void;
}) {
    const { projectId, canWrite, currentManifest, onChoiceRecordCreated } = params;

    const handleIssueAction = (reviewId: string, issueId: string, action: ReviewIssueAction, note?: string, planningRecordId?: string) => {
        if (!canWrite) return;
        const state = useProjectStore.getState();
        const issue = (state.reviewIssues[projectId] ?? []).find(item => item.id === issueId && item.reviewId === reviewId);
        const run = (state.reviewRuns[projectId] ?? []).find(item => item.id === reviewId);
        if (!issue || !run) return;
        let recordId = planningRecordId;
        const recordType = recordTypeForAction(action);
        if (recordType) {
            const sourceFindings = (state.reviewFindings[projectId] ?? []).filter(
                finding => finding.reviewId === reviewId && issue.findingIds.includes(finding.id),
            );
            recordId = state.createPlanningRecord(projectId, {
                type: recordType,
                status: recordType === 'decision' ? 'proposed' : 'open',
                title: issue.title,
                statement: note?.trim() || issue.summary,
                recommendation: sourceFindings.find(finding => finding.recommendedAction)?.recommendedAction,
                evidence: sourceFindings.flatMap(finding => finding.evidence),
                sourceFindingIds: issue.findingIds,
                sourceReviewIssueId: issue.id,
                challengesRecordId: action === 'challenge_decision' ? planningRecordId : undefined,
                createdBy: 'specialist_review',
            }).planningRecordId;
        }
        state.applyReviewIssueDisposition(projectId, reviewId, issueId, {
            action: dispositionForAction(action),
            contextSignature: run.sourceManifest.contextSignature,
            reason: note?.trim() || undefined,
            planningRecordId: recordId,
        });
        if (recordId && !planningRecordId && (recordType === 'decision' || recordType === 'open_question')) {
            onChoiceRecordCreated?.(recordId);
        }
    };

    const handleReopenIssue = (reviewId: string, issueId: string, reason: string, expectedUpdatedAt: number) => {
        if (!canWrite || !currentManifest) return;
        const state = useProjectStore.getState();
        const run = (state.reviewRuns[projectId] ?? []).find(item => item.id === reviewId);
        if (!run) return;
        const result = state.reopenReviewIssue(projectId, reviewId, issueId, {
            reason,
            expectedUpdatedAt,
            expectedContextSignature: run.sourceManifest.contextSignature,
            currentContextSignature: currentManifest.contextSignature,
        });
        if (!result.ok) {
            useToastStore.getState().addToast({
                type: 'warning',
                title: 'Finding not reopened',
                message: result.reason,
            });
        }
    };

    const handleTriageFinding = (reviewId: string, findingId: string) => {
        if (!canWrite) return;
        const state = useProjectStore.getState();
        const finding = (state.reviewFindings[projectId] ?? []).find(item => (
            item.id === findingId && item.reviewId === reviewId
        ));
        if (!finding) return;
        const existing = (state.reviewIssues[projectId] ?? []).find(issue => (
            issue.reviewId === reviewId && issue.findingIds.includes(findingId)
        ));
        if (existing) return;
        state.addReviewIssue(projectId, {
            id: `${reviewId}:triage:${hashReviewValue(findingId)}`,
            reviewId,
            title: finding.title,
            summary: finding.observation,
            kind: finding.kind,
            findingIds: [finding.id],
            specialistIds: [finding.specialistId],
            relationship: 'standalone',
            severity: finding.severity,
            confidence: finding.confidence,
            implementationImpact: finding.implementationImpact,
            relatedPlanningRecordIds: [],
        });
    };

    return { handleIssueAction, handleReopenIssue, handleTriageFinding };
}
