import type {
    Assumption,
    PlanningRecord,
    PlanningSourceRef,
    StructuredPRD,
} from '../../types';
import { PLANNING_RECORD_SCHEMA_VERSION } from '../../types';

export type AssumptionImportInput = {
    projectId: string;
    sourceSpineVersionId: string;
    structuredPRD: StructuredPRD;
    existingRecords: PlanningRecord[];
    now?: () => number;
};

export type AssumptionImportResult = {
    records: PlanningRecord[];
    imported: PlanningRecord[];
    existing: PlanningRecord[];
};

/** Stable across PRD versions and wording changes as long as assumption ID survives. */
export const assumptionSourceKey = (assumptionId: string): string =>
    `prd_assumption:${assumptionId.trim()}`;

const stableHash = (value: string): string => {
    let hash = 0x811c9dc5;
    for (let i = 0; i < value.length; i += 1) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
};

const importedRecordId = (projectId: string, sourceKey: string): string =>
    `planning-assumption-${stableHash(`${projectId}:${sourceKey}`)}`;

const sourceFor = (assumption: Assumption, sourceSpineVersionId: string): PlanningSourceRef => ({
    key: assumptionSourceKey(assumption.id),
    sourceType: 'prd_assumption',
    sourceId: assumption.id,
    sourceVersionId: sourceSpineVersionId,
    locator: { section: 'assumptions', entityType: 'assumption', entityId: assumption.id },
});

const recordHasSource = (record: PlanningRecord, key: string): boolean =>
    (record.sources ?? []).some((source) => source.key === key);

const importOne = (
    projectId: string,
    sourceSpineVersionId: string,
    assumption: Assumption,
    at: number,
): PlanningRecord => {
    const source = sourceFor(assumption, sourceSpineVersionId);
    const id = importedRecordId(projectId, source.key);
    const verdictAt = assumption.decidedAt ?? at;
    const createdAt = Math.min(at, verdictAt);
    const verdict = assumption.decision === 'confirmed'
        ? [{
            id: `${id}:legacy-verdict`, planningRecordId: id, type: 'custom_answered' as const,
            actor: 'user' as const, at: verdictAt,
            answer: assumption.decisionNote?.trim() || assumption.statement,
            rationale: assumption.decisionNote,
        }]
        : assumption.decision === 'rejected'
            ? [{
                id: `${id}:legacy-verdict`, planningRecordId: id, type: 'premise_rejected' as const,
                actor: 'user' as const, at: verdictAt,
                reason: assumption.decisionNote?.trim() || 'Rejected in the legacy PRD',
                rationale: assumption.decisionNote,
            }]
            : [];
    return {
        id,
        projectId,
        type: 'assumption',
        status: assumption.decision === 'confirmed'
            ? 'confirmed'
            : assumption.decision === 'rejected' ? 'rejected' : 'open',
        title: assumption.statement,
        statement: assumption.statement,
        evidence: [],
        sourceFindingIds: [],
        createdBy: 'migration',
        createdAt,
        updatedAt: verdict.length ? verdictAt : at,
        confirmedAt: assumption.decision === 'confirmed' ? verdictAt : undefined,
        resolution: assumption.decisionNote,
        schemaVersion: PLANNING_RECORD_SCHEMA_VERSION,
        sources: [source],
        events: [{
            id: `${id}:imported`,
            planningRecordId: id,
            type: 'imported',
            actor: 'migration',
            at: createdAt,
            sourceKey: source.key,
        }, ...verdict],
    };
};

/**
 * Lazily imports PRD assumptions without rewriting or duplicating existing
 * planning records. Existing records win completely, preserving user history.
 */
export function importPrdAssumptions(input: AssumptionImportInput): AssumptionImportResult {
    const at = input.now?.() ?? Date.now();
    const records = [...input.existingRecords];
    const imported: PlanningRecord[] = [];
    const existing: PlanningRecord[] = [];
    const knownKeys = new Map<string, PlanningRecord>();
    for (const record of records) {
        for (const source of record.sources ?? []) knownKeys.set(source.key, record);
    }

    for (const assumption of input.structuredPRD.assumptions ?? []) {
        if (!assumption.id?.trim() || !assumption.statement?.trim()) continue;
        const key = assumptionSourceKey(assumption.id);
        const prior = knownKeys.get(key)
            ?? records.find((record) => recordHasSource(record, key));
        if (prior) {
            existing.push(prior);
            continue;
        }
        const record = importOne(input.projectId, input.sourceSpineVersionId, assumption, at);
        records.push(record);
        imported.push(record);
        knownKeys.set(key, record);
    }
    return { records, imported, existing };
}
