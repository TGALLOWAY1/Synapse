import { describe, expect, it } from 'vitest';
import type { DecisionEvent, PlanningRecord } from '../../../types';
import {
    deriveMaterialityGateSnapshot,
    materialityGateAcceptanceStatus,
    planningRecordHardBlocks,
} from '../materialityGate';

const record = (
    id: string,
    materiality: PlanningRecord['materiality'],
    status: PlanningRecord['status'] = 'open',
    overrides: Partial<PlanningRecord> = {},
): PlanningRecord => ({
    id,
    projectId: 'project-1',
    type: 'decision',
    status,
    title: `Decision ${id}`,
    statement: `Choose ${id}`,
    evidence: [],
    sourceFindingIds: [],
    createdBy: 'user',
    createdAt: 1,
    updatedAt: 1,
    materiality,
    ...overrides,
});

type DecisionEventInput = DecisionEvent extends infer Event
    ? Event extends DecisionEvent
        ? Omit<Event, 'id' | 'planningRecordId' | 'actor' | 'at'>
        : never
    : never;

const event = (
    planningRecordId: string,
    input: DecisionEventInput,
): DecisionEvent => ({
    id: `${planningRecordId}:${input.type}`,
    planningRecordId,
    actor: 'user',
    at: 2,
    ...input,
} as DecisionEvent);

describe('materiality checkpoint gate', () => {
    it('never hard-blocks undefined, high, normal, or low records', () => {
        const records = [
            record('undefined', undefined),
            record('high', 'high'),
            record('normal', 'normal', 'deferred'),
            record('low', 'low', 'invalidated'),
        ];
        for (const item of records) {
            expect(planningRecordHardBlocks(item, records)).toBe(false);
        }
        expect(deriveMaterialityGateSnapshot({
            currentSpineVersionId: 'spine-1',
            planningRecords: records,
        }).blockingRecordIds).toEqual([]);
    });

    it.each(['open', 'proposed', 'deferred', 'invalidated'] as const)(
        'hard-blocks an explicitly blocking %s record',
        status => {
            const item = record(status, 'blocking', status);
            expect(planningRecordHardBlocks(item)).toBe(true);
            expect(deriveMaterialityGateSnapshot({
                currentSpineVersionId: 'spine-1',
                planningRecords: [item],
            }).blockingRecords).toMatchObject([{
                recordId: status,
                reason: 'unresolved',
            }]);
        },
    );

    it('clears a blocking record after a current authoritative user verdict', () => {
        const confirmed = record('confirmed', 'blocking', 'open', {
            events: [event('confirmed', { type: 'custom_answered', answer: 'Use option A.' })],
        });
        const rejected = record('rejected', 'blocking', 'open', {
            events: [event('rejected', { type: 'premise_rejected', reason: 'The premise is false.' })],
        });
        expect(planningRecordHardBlocks(confirmed)).toBe(false);
        expect(planningRecordHardBlocks(rejected)).toBe(false);
    });

    it('fails closed on source drift and a legacy settled status without verdict provenance', () => {
        const drifted = record('drifted', 'blocking', 'open', {
            sourceState: 'changed',
            events: [event('drifted', { type: 'custom_answered', answer: 'Use option A.' })],
        });
        const legacy = record('legacy', 'blocking', 'confirmed');
        const snapshot = deriveMaterialityGateSnapshot({
            currentSpineVersionId: 'spine-1',
            planningRecords: [drifted, legacy],
        });
        expect(snapshot.blockingRecords).toMatchObject([
            { recordId: 'drifted', reason: 'source_drift' },
            { recordId: 'legacy', reason: 'legacy_settled_without_verdict' },
        ]);
    });

    it('follows supersession and applies the replacement materiality', () => {
        const superseded = record('old', 'blocking', 'open', {
            events: [event('old', { type: 'superseded', supersededById: 'replacement' })],
        });
        const blockingReplacement = record('replacement', 'blocking');
        expect(deriveMaterialityGateSnapshot({
            currentSpineVersionId: 'spine-1',
            planningRecords: [superseded, blockingReplacement],
        }).blockingRecordIds).toEqual(['replacement']);

        const highReplacement = { ...blockingReplacement, materiality: 'high' as const };
        expect(deriveMaterialityGateSnapshot({
            currentSpineVersionId: 'spine-1',
            planningRecords: [superseded, highReplacement],
        }).blockingRecordIds).toEqual([]);
    });

    it('fails closed for a missing or cyclic supersession target', () => {
        const missing = record('missing', 'blocking', 'open', {
            events: [event('missing', { type: 'superseded', supersededById: 'absent' })],
        });
        const a = record('a', 'blocking', 'open', {
            events: [event('a', { type: 'superseded', supersededById: 'b' })],
        });
        const b = record('b', 'blocking', 'open', {
            events: [event('b', { type: 'superseded', supersededById: 'a' })],
        });
        expect(deriveMaterialityGateSnapshot({
            currentSpineVersionId: 'spine-1',
            planningRecords: [missing],
        }).blockingRecords).toMatchObject([{
            recordId: 'missing',
            reason: 'missing_superseding_record',
        }]);
        expect(deriveMaterialityGateSnapshot({
            currentSpineVersionId: 'spine-1',
            planningRecords: [a, b],
        }).blockingRecords.every(item => item.reason === 'supersession_cycle')).toBe(true);
    });

    it('produces an order-stable exact fingerprint bound to blocker content and spine', () => {
        const a = record('a', 'blocking');
        const b = record('b', 'blocking');
        const first = deriveMaterialityGateSnapshot({
            currentSpineVersionId: 'spine-1',
            planningRecords: [b, a],
        });
        const reordered = deriveMaterialityGateSnapshot({
            currentSpineVersionId: 'spine-1',
            planningRecords: [a, b],
        });
        const changedSpine = deriveMaterialityGateSnapshot({
            currentSpineVersionId: 'spine-2',
            planningRecords: [a, b],
        });
        const changedStatement = deriveMaterialityGateSnapshot({
            currentSpineVersionId: 'spine-1',
            planningRecords: [a, { ...b, statement: 'A materially different choice' }],
        });
        expect(first.blockingRecordIds).toEqual(['a', 'b']);
        expect(reordered.blockingSnapshotHash).toBe(first.blockingSnapshotHash);
        expect(changedSpine.blockingSnapshotHash).not.toBe(first.blockingSnapshotHash);
        expect(changedStatement.blockingSnapshotHash).not.toBe(first.blockingSnapshotHash);
    });

    it('accepts only the exact blocker set, snapshot, and meaningful rationale', () => {
        const snapshot = deriveMaterialityGateSnapshot({
            currentSpineVersionId: 'spine-1',
            planningRecords: [record('a', 'blocking')],
        });
        expect(materialityGateAcceptanceStatus(snapshot)).toMatchObject({
            canProceed: false,
            status: 'missing_acceptance',
        });
        expect(materialityGateAcceptanceStatus(snapshot, {
            acceptedBlockingRecordIds: ['other'],
            blockingSnapshotHash: snapshot.blockingSnapshotHash,
            rationale: 'Proceed with this bounded implementation step.',
        })).toMatchObject({ canProceed: false, status: 'accepted_blockers_mismatch' });
        expect(materialityGateAcceptanceStatus(snapshot, {
            acceptedBlockingRecordIds: ['a'],
            blockingSnapshotHash: 'stale',
            rationale: 'Proceed with this bounded implementation step.',
        })).toMatchObject({ canProceed: false, status: 'blocking_snapshot_mismatch' });
        expect(materialityGateAcceptanceStatus(snapshot, {
            acceptedBlockingRecordIds: ['a'],
            blockingSnapshotHash: snapshot.blockingSnapshotHash,
            rationale: 'Too short',
        })).toMatchObject({ canProceed: false, status: 'rationale_required' });
        expect(materialityGateAcceptanceStatus(snapshot, {
            acceptedBlockingRecordIds: ['a'],
            blockingSnapshotHash: snapshot.blockingSnapshotHash,
            rationale: 'Proceed with this bounded implementation step.',
        })).toEqual({ canProceed: true, status: 'accepted' });
    });

    it('needs no acceptance when no explicit blocker exists', () => {
        const snapshot = deriveMaterialityGateSnapshot({
            currentSpineVersionId: 'spine-1',
            planningRecords: [record('high', 'high')],
        });
        expect(materialityGateAcceptanceStatus(snapshot)).toEqual({
            canProceed: true,
            status: 'clear',
        });
    });
});
