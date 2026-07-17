import { describe, expect, it } from 'vitest';
import type { ReviewIssue, ReviewRun } from '../../../types';
import { validateReviewIssueRecovery } from '../issueRecovery';

const run = {
    id: 'review-1',
    sourceManifest: { contextSignature: 'context-1' },
} as ReviewRun;

const issue = {
    id: 'issue-1',
    reviewId: run.id,
    status: 'dismissed',
    updatedAt: 20,
} as ReviewIssue;

const guard = {
    reason: 'New project evidence makes this risk relevant again.',
    expectedContextSignature: 'context-1',
    currentContextSignature: 'context-1',
    expectedUpdatedAt: 20,
};

describe('Challenge finding recovery guard', () => {
    it('allows an explicit user rationale only against the reviewed current context', () => {
        expect(validateReviewIssueRecovery(issue, run, guard)).toEqual({
            ok: true,
            reason: guard.reason,
        });
    });

    it('rejects stale reviews and findings changed after the recovery control opened', () => {
        expect(validateReviewIssueRecovery(issue, run, {
            ...guard,
            currentContextSignature: 'context-2',
        })).toMatchObject({ ok: false, reason: expect.stringMatching(/Review the current plan again/i) });
        expect(validateReviewIssueRecovery(issue, run, {
            ...guard,
            expectedUpdatedAt: 19,
        })).toMatchObject({ ok: false, reason: expect.stringMatching(/finding changed/i) });
    });

    it('does not recover open or superseded findings', () => {
        expect(validateReviewIssueRecovery({ ...issue, status: 'open' }, run, guard)).toMatchObject({ ok: false });
        expect(validateReviewIssueRecovery({ ...issue, status: 'superseded' }, run, guard)).toMatchObject({ ok: false });
    });
});
