import type { ReviewIssue, ReviewRun } from '../../types';

export type ReviewIssueRecoveryGuard = {
    reason: string;
    expectedContextSignature: string;
    currentContextSignature: string;
    expectedUpdatedAt: number;
};

export type ReviewIssueRecoveryValidation =
    | { ok: true; reason: string }
    | { ok: false; reason: string };

/**
 * Validates the user-authority boundary for changing a closed Challenge
 * finding's treatment. The current planning context must still be the exact
 * context reviewed by the Challenge run, and the issue must not have changed
 * since the user opened the recovery control.
 */
export function validateReviewIssueRecovery(
    issue: ReviewIssue | undefined,
    run: ReviewRun | undefined,
    guard: ReviewIssueRecoveryGuard,
): ReviewIssueRecoveryValidation {
    const reason = guard.reason.trim();
    if (reason.length < 10) {
        return { ok: false, reason: 'Explain why this finding needs attention again.' };
    }
    if (!issue || !run || issue.reviewId !== run.id) {
        return { ok: false, reason: 'The Challenge finding or its review is no longer available.' };
    }
    if (issue.status === 'open') {
        return { ok: false, reason: 'This finding already needs attention.' };
    }
    if (issue.status === 'superseded') {
        return { ok: false, reason: 'This historical finding was replaced. Review the current plan again.' };
    }
    if (issue.updatedAt !== guard.expectedUpdatedAt) {
        return { ok: false, reason: 'The finding changed before it could be reopened. Review its latest treatment.' };
    }
    if (guard.expectedContextSignature !== run.sourceManifest.contextSignature
        || guard.currentContextSignature !== run.sourceManifest.contextSignature) {
        return { ok: false, reason: 'The plan changed after this Challenge. Review the current plan again.' };
    }
    return { ok: true, reason };
}
