import { describe, expect, it } from 'vitest';
import type { PlanningRecord } from '../../../types';
import {
    assumptionDefaultBatchCandidate,
    batchVerdictTargetHash,
    deferBatchCandidate,
    recommendationBatchCandidate,
    recommendationIdentity,
    revalidateBatchVerdictCandidate,
} from '../batchVerdicts';

const record = (patch: Partial<PlanningRecord> = {}): PlanningRecord => ({
    id: 'd1',
    projectId: 'p1',
    type: 'decision',
    status: 'open',
    title: 'Account model',
    statement: 'Choose an account model',
    decisionOptions: [
        { id: 'guest', label: 'Guest session' },
        { id: 'account', label: 'Account first' },
    ],
    recommendationDetail: {
        optionId: 'guest',
        summary: 'Guest session',
        rationale: 'Lower friction',
        confidence: 'medium',
    },
    decisionOptionsProvenance: {
        authoredBy: 'synapse',
        model: 'strong',
        generatedAt: 10,
    },
    evidence: [],
    sourceFindingIds: [],
    createdBy: 'specialist_review',
    createdAt: 1,
    updatedAt: 10,
    events: [{
        id: 'created',
        planningRecordId: 'd1',
        type: 'created',
        actor: 'synapse',
        at: 1,
    }],
    ...patch,
});

describe('batch verdict candidates', () => {
    it('requires an unresolved machine recommendation bound to a real option', () => {
        expect(recommendationBatchCandidate(record())).toMatchObject({
            action: 'accept_recommendation',
            optionId: 'guest',
            answer: 'Guest session',
            expectedRecommendationIdentity: expect.any(String),
        });
        expect(recommendationBatchCandidate(record({
            decisionOptionsProvenance: undefined,
        }))).toBeUndefined();
        expect(recommendationBatchCandidate(record({
            recommendationDetail: { optionId: 'missing', summary: 'Missing' },
        }))).toBeUndefined();
    });

    it('changes identity when meaning changes under the same option id', () => {
        const changed = record({
            recommendationDetail: {
                ...record().recommendationDetail!,
                summary: 'Temporary guest only',
            },
        });
        expect(recommendationIdentity(changed)).not.toBe(recommendationIdentity(record()));
        expect(batchVerdictTargetHash(changed, 'accept_recommendation'))
            .not.toBe(batchVerdictTargetHash(record(), 'accept_recommendation'));
    });

    it('snapshots the presented assumption default and recorded Later', () => {
        const assumption = record({
            id: 'a1',
            type: 'assumption',
            createdBy: 'migration',
            statement: 'Users accept email verification',
            decisionOptions: undefined,
            recommendationDetail: undefined,
            decisionOptionsProvenance: undefined,
        });
        expect(assumptionDefaultBatchCandidate(assumption, 'spine-1')).toMatchObject({
            action: 'accept_default',
            answer: 'Users accept email verification',
            expectedSpineVersionId: 'spine-1',
        });
        expect(deferBatchCandidate(assumption, 'spine-1')).toMatchObject({
            action: 'defer',
            expectedSpineVersionId: 'spine-1',
        });
    });

    it('rejects a changed snapshot without treating it as a failure', () => {
        const candidate = recommendationBatchCandidate(record())!;
        const changed = record({
            decisionOptionsProvenance: {
                ...record().decisionOptionsProvenance!,
                generatedAt: 11,
            },
        });
        expect(revalidateBatchVerdictCandidate(changed, candidate)).toEqual({
            ok: false,
            reason: 'The recommendation changed before it could be accepted.',
        });
    });

    it('rejects forged recommendation and default payloads even with a current target hash', () => {
        const recommendation = recommendationBatchCandidate(record())!;
        expect(revalidateBatchVerdictCandidate(record(), {
            ...recommendation,
            optionId: 'account',
            answer: 'Account first',
        })).toEqual({
            ok: false,
            reason: 'The recommendation changed before it could be accepted.',
        });

        const assumption = record({
            id: 'a1',
            type: 'assumption',
            createdBy: 'migration',
            statement: 'Users accept email verification',
            decisionOptions: undefined,
            recommendationDetail: undefined,
            decisionOptionsProvenance: undefined,
        });
        const defaultCandidate = assumptionDefaultBatchCandidate(assumption)!;
        expect(revalidateBatchVerdictCandidate(assumption, {
            ...defaultCandidate,
            answer: 'A substituted answer',
        })).toEqual({
            ok: false,
            reason: 'The planning record changed before the batch action completed.',
        });
    });
});
