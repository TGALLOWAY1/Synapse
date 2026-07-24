import { describe, expect, it } from 'vitest';
import type { PlanningRecord } from '../../../types';
import { deriveAssumptionArrival } from '../assumptionArrival';

const assumption = (
    id: string,
    materiality: NonNullable<PlanningRecord['materiality']>,
    status: PlanningRecord['status'] = 'open',
): PlanningRecord => ({
    id,
    projectId: 'p1',
    type: 'assumption',
    status,
    title: `${id} assumption`,
    statement: `${id} assumption`,
    evidence: [],
    sourceFindingIds: [],
    createdBy: 'synapse',
    createdAt: 1,
    updatedAt: 1,
    materiality,
    events: status === 'confirmed'
        ? [{
            id: `${id}-answer`,
            planningRecordId: id,
            type: 'custom_answered',
            actor: 'user',
            answer: `${id} assumption`,
            at: 2,
        }]
        : status === 'deferred'
            ? [{
                id: `${id}-defer`,
                planningRecordId: id,
                type: 'deferred',
                actor: 'user',
                at: 2,
            }]
            : undefined,
});

describe('deriveAssumptionArrival', () => {
    it('uses exact ids, orders two highlights by materiality, and settles idempotently', () => {
        const records = [
            assumption('historical', 'blocking'),
            assumption('normal', 'normal'),
            assumption('high', 'high'),
            assumption('blocking', 'blocking'),
        ];
        const summary = deriveAssumptionArrival(
            records,
            ['normal', 'high', 'blocking'],
        );
        expect(summary?.arrivalRecordIds).toEqual(['normal', 'high', 'blocking']);
        expect(summary?.highlights.map(item => item.id)).toEqual(['blocking', 'high']);
        expect(summary?.pendingRecords.map(item => item.id)).not.toContain('historical');
        expect(deriveAssumptionArrival([
            assumption('normal', 'normal', 'confirmed'),
            assumption('high', 'high', 'deferred'),
        ], ['normal', 'high'])?.pendingRecords).toEqual([]);
    });
});
