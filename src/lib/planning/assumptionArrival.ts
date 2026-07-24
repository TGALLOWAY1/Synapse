import type { PlanningRecord } from '../../types';
import { projectDecision } from './decisionProjection';

export type AssumptionArrivalSummary = {
    arrivalRecordIds: string[];
    totalImported: number;
    pendingRecords: PlanningRecord[];
    highlights: PlanningRecord[];
    materialityCounts: Record<'blocking' | 'high' | 'normal' | 'low', number>;
};

const materialityRank = {
    blocking: 0,
    high: 1,
    normal: 2,
    low: 3,
} as const;

export function deriveAssumptionArrival(
    planningRecords: PlanningRecord[],
    arrivalIds: string[],
): AssumptionArrivalSummary | undefined {
    const ids = [...new Set(arrivalIds)];
    const recordsById = new Map(planningRecords.map(record => [record.id, record]));
    const arrival = ids.flatMap(id => {
        const record = recordsById.get(id);
        return record?.type === 'assumption' ? [record] : [];
    });
    if (!arrival.length) return;

    const pendingRecords = arrival.filter(record => (
        ['open', 'proposed'].includes(projectDecision(record).status)
    ));
    const materialityCounts = {
        blocking: 0,
        high: 0,
        normal: 0,
        low: 0,
    };
    pendingRecords.forEach(record => {
        materialityCounts[record.materiality ?? 'normal'] += 1;
    });
    const arrivalOrder = new Map(ids.map((id, index) => [id, index]));
    const highlights = [...pendingRecords]
        .sort((a, b) => (
            materialityRank[a.materiality ?? 'normal']
            - materialityRank[b.materiality ?? 'normal']
            || (arrivalOrder.get(a.id) ?? 0) - (arrivalOrder.get(b.id) ?? 0)
        ))
        .slice(0, 2);

    return {
        arrivalRecordIds: arrival.map(record => record.id),
        totalImported: arrival.length,
        pendingRecords,
        highlights,
        materialityCounts,
    };
}
