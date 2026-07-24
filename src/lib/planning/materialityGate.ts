import type { PlanningRecord } from '../../types';
import {
    isDecisionVerdictEvent,
    projectDecision,
    validateDecisionEvent,
} from './decisionProjection';
import { planningContentHash } from './planningHash';

export const MATERIALITY_ACCEPTANCE_MIN_RATIONALE_LENGTH = 20;

export type MaterialityBlockReason =
    | 'unresolved'
    | 'source_drift'
    | 'legacy_settled_without_verdict'
    | 'missing_superseding_record'
    | 'supersession_cycle';

export type MaterialityBlockingRecordSnapshot = {
    recordId: string;
    title: string;
    type: PlanningRecord['type'];
    reason: MaterialityBlockReason;
    fingerprint: string;
};

export type MaterialityGateSnapshot = {
    spineVersionId: string;
    blockingRecords: MaterialityBlockingRecordSnapshot[];
    blockingRecordIds: string[];
    blockingSnapshotHash: string;
};

export type MaterialityGateAcceptance = {
    acceptedBlockingRecordIds?: string[];
    blockingSnapshotHash?: string;
    rationale?: string;
};

export type MaterialityGateAcceptanceStatus =
    | { canProceed: true; status: 'clear' | 'accepted' }
    | {
        canProceed: false;
        status:
            | 'missing_acceptance'
            | 'accepted_blockers_mismatch'
            | 'blocking_snapshot_mismatch'
            | 'rationale_required';
    };

type BlockingResolution =
    | { record: PlanningRecord; reason: MaterialityBlockReason }
    | undefined;

const unresolvedStatuses = new Set([
    'open',
    'proposed',
    'deferred',
    'invalidated',
]);

const settledStatuses = new Set([
    'confirmed',
    'rejected',
    'resolved',
]);

const meaningfulRationale = (value?: string): boolean =>
    (value?.trim().length ?? 0) >= MATERIALITY_ACCEPTANCE_MIN_RATIONALE_LENGTH;

function resolveBlockingRecord(
    origin: PlanningRecord,
    byId: ReadonlyMap<string, PlanningRecord>,
): BlockingResolution {
    if (origin.materiality !== 'blocking') return undefined;

    let current = origin;
    const visited = new Set<string>();
    while (true) {
        if (visited.has(current.id)) {
            return { record: origin, reason: 'supersession_cycle' };
        }
        visited.add(current.id);

        const projection = projectDecision(current);
        if (projection.status !== 'superseded') {
            if (current.materiality !== 'blocking') return undefined;
            if (current.sourceState === 'changed' || current.sourceState === 'missing') {
                return { record: current, reason: 'source_drift' };
            }
            if (unresolvedStatuses.has(projection.status)) {
                return { record: current, reason: 'unresolved' };
            }
            if (settledStatuses.has(projection.status) && !projection.latestVerdictEventId) {
                return { record: current, reason: 'legacy_settled_without_verdict' };
            }
            return undefined;
        }

        const replacement = projection.supersededById
            ? byId.get(projection.supersededById)
            : undefined;
        if (!replacement) {
            return { record: current, reason: 'missing_superseding_record' };
        }
        current = replacement;
    }
}

function blockingRecordFingerprint(
    spineVersionId: string,
    record: PlanningRecord,
    reason: MaterialityBlockReason,
): string {
    const projection = projectDecision(record);
    const authoritativeEvents = (record.events ?? []).filter(event => (
        validateDecisionEvent(event).valid && isDecisionVerdictEvent(event)
    ));
    return planningContentHash({
        spineVersionId,
        record: {
            id: record.id,
            type: record.type,
            title: record.title,
            statement: record.statement,
            materiality: record.materiality,
            sourceState: record.sourceState,
            currentSourceStatement: record.currentSourceStatement,
            supersedesId: record.supersedesId,
            sources: record.sources,
            projection,
            authoritativeEvents,
        },
        reason,
    });
}

/**
 * Returns true only for an explicitly blocking planning record whose current
 * authoritative projection still requires a user action. High/normal/low and
 * legacy records with no materiality never acquire hard-stop authority.
 */
export function planningRecordHardBlocks(
    record: PlanningRecord,
    records: PlanningRecord[] = [record],
): boolean {
    return resolveBlockingRecord(record, new Map(records.map(item => [item.id, item]))) !== undefined;
}

/**
 * Derives the narrow planning hard-stop snapshot used only at Finalize and
 * Build/export checkpoints. The hash binds the sorted exact blocker state to
 * the current planning spine without folding advisory readiness state into
 * the acceptance boundary.
 */
export function deriveMaterialityGateSnapshot(input: {
    currentSpineVersionId: string;
    planningRecords: PlanningRecord[];
}): MaterialityGateSnapshot {
    const byId = new Map(input.planningRecords.map(record => [record.id, record]));
    const unique = new Map<string, MaterialityBlockingRecordSnapshot>();
    for (const record of input.planningRecords) {
        const resolution = resolveBlockingRecord(record, byId);
        if (!resolution || unique.has(resolution.record.id)) continue;
        unique.set(resolution.record.id, {
            recordId: resolution.record.id,
            title: resolution.record.title,
            type: resolution.record.type,
            reason: resolution.reason,
            fingerprint: blockingRecordFingerprint(
                input.currentSpineVersionId,
                resolution.record,
                resolution.reason,
            ),
        });
    }
    const blockingRecords = [...unique.values()].sort((a, b) => (
        a.recordId.localeCompare(b.recordId)
    ));
    const blockingRecordIds = blockingRecords.map(record => record.recordId);
    return {
        spineVersionId: input.currentSpineVersionId,
        blockingRecords,
        blockingRecordIds,
        blockingSnapshotHash: planningContentHash({
            spineVersionId: input.currentSpineVersionId,
            blockers: blockingRecords.map(record => ({
                recordId: record.recordId,
                reason: record.reason,
                fingerprint: record.fingerprint,
            })),
        }),
    };
}

/**
 * Checks whether an append-only Finalize authorization covers the exact live
 * blocker set. Advisory changes are intentionally absent from this comparison.
 */
export function materialityGateAcceptanceStatus(
    snapshot: MaterialityGateSnapshot,
    acceptance?: MaterialityGateAcceptance,
): MaterialityGateAcceptanceStatus {
    if (snapshot.blockingRecordIds.length === 0) {
        return { canProceed: true, status: 'clear' };
    }
    if (!acceptance?.acceptedBlockingRecordIds || !acceptance.blockingSnapshotHash) {
        return { canProceed: false, status: 'missing_acceptance' };
    }
    const acceptedIds = [...new Set(acceptance.acceptedBlockingRecordIds)].sort();
    if (
        acceptedIds.length !== snapshot.blockingRecordIds.length
        || acceptedIds.some((id, index) => id !== snapshot.blockingRecordIds[index])
    ) {
        return { canProceed: false, status: 'accepted_blockers_mismatch' };
    }
    if (acceptance.blockingSnapshotHash !== snapshot.blockingSnapshotHash) {
        return { canProceed: false, status: 'blocking_snapshot_mismatch' };
    }
    if (!meaningfulRationale(acceptance.rationale)) {
        return { canProceed: false, status: 'rationale_required' };
    }
    return { canProceed: true, status: 'accepted' };
}
