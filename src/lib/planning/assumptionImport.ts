import type {
    Assumption,
    PlanningRecord,
    PlanningSourceRef,
    PreflightSession,
    StructuredPRD,
} from '../../types';
import { PLANNING_RECORD_SCHEMA_VERSION } from '../../types';

export type AssumptionImportInput = {
    projectId: string;
    sourceSpineVersionId: string;
    structuredPRD: StructuredPRD;
    preflightSession?: PreflightSession;
    existingRecords: PlanningRecord[];
    now?: () => number;
};

export type AssumptionImportResult = {
    records: PlanningRecord[];
    imported: PlanningRecord[];
    existing: PlanningRecord[];
    updated: PlanningRecord[];
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

const planningSignalKey = (kind: 'assumption' | 'unknown', statement: string): string =>
    `preflight:${kind}:${stableHash(statement.trim().toLowerCase())}`;

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
        materiality: assumption.materiality,
        whyItMatters: assumption.whyItMatters,
        affectedPrdSections: assumption.affectedPrdSections,
        affectedPlanLocations: assumption.affectedPlanLocations,
        schemaVersion: PLANNING_RECORD_SCHEMA_VERSION,
        sources: [source],
        sourceState: 'current',
        currentSourceStatement: assumption.statement,
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
 * planning records. User history wins; source wording/version drift is tracked
 * separately so Synapse can request review without fabricating a verdict.
 */
export function importPrdAssumptions(input: AssumptionImportInput): AssumptionImportResult {
    const at = input.now?.() ?? Date.now();
    const records = [...input.existingRecords];
    const imported: PlanningRecord[] = [];
    const existing: PlanningRecord[] = [];
    const updated: PlanningRecord[] = [];
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
            const priorSource = (prior.sources ?? []).find(source => source.key === key);
            const sourceChanged = (prior.currentSourceStatement ?? prior.statement) !== assumption.statement;
            const next: PlanningRecord = {
                ...prior,
                sources: (prior.sources ?? []).map(source => source.key === key
                    ? { ...source, sourceVersionId: input.sourceSpineVersionId }
                    : source),
                sourceState: sourceChanged || prior.sourceState === 'changed' ? 'changed' : 'current',
                currentSourceStatement: assumption.statement,
                materiality: assumption.materiality ?? prior.materiality,
                whyItMatters: assumption.whyItMatters ?? prior.whyItMatters,
                affectedPrdSections: assumption.affectedPrdSections ?? prior.affectedPrdSections,
                affectedPlanLocations: assumption.affectedPlanLocations ?? prior.affectedPlanLocations,
            };
            const index = records.findIndex(record => record.id === prior.id);
            const planningContextChanged = assumption.materiality !== undefined && assumption.materiality !== prior.materiality
                || assumption.whyItMatters !== undefined && assumption.whyItMatters !== prior.whyItMatters
                || assumption.affectedPrdSections !== undefined
                    && JSON.stringify(assumption.affectedPrdSections) !== JSON.stringify(prior.affectedPrdSections)
                || assumption.affectedPlanLocations !== undefined
                    && JSON.stringify(assumption.affectedPlanLocations) !== JSON.stringify(prior.affectedPlanLocations);
            if (index >= 0 && (sourceChanged || planningContextChanged || priorSource?.sourceVersionId !== input.sourceSpineVersionId || prior.sourceState === 'missing')) {
                records[index] = next;
                knownKeys.set(key, next);
                updated.push(next);
                existing.push(next);
            } else {
                existing.push(prior);
            }
            continue;
        }
        const record = importOne(input.projectId, input.sourceSpineVersionId, assumption, at);
        records.push(record);
        imported.push(record);
        knownKeys.set(key, record);
    }

    const preflightSignals = [
        ...(input.preflightSession?.unknowns ?? []).map(statement => ({ statement, type: 'open_question' as const, kind: 'unknown' as const })),
        ...(input.preflightSession?.assumptions ?? []).map(statement => ({ statement, type: 'assumption' as const, kind: 'assumption' as const })),
    ];
    for (const signal of preflightSignals) {
        if (!signal.statement.trim()) continue;
        const key = planningSignalKey(signal.kind, signal.statement);
        const prior = knownKeys.get(key) ?? records.find(record => recordHasSource(record, key));
        if (prior) {
            existing.push(prior);
            continue;
        }
        const id = importedRecordId(input.projectId, key);
        const record: PlanningRecord = {
            id,
            projectId: input.projectId,
            type: signal.type,
            status: 'open',
            title: signal.statement,
            statement: signal.statement,
            evidence: [],
            sourceFindingIds: [],
            createdBy: 'synapse',
            createdAt: at,
            updatedAt: at,
            schemaVersion: PLANNING_RECORD_SCHEMA_VERSION,
            materiality: 'normal',
            sources: [{ key, sourceType: 'preflight', sourceId: key, sourceVersionId: input.sourceSpineVersionId }],
            events: [{ id: `${id}:imported`, planningRecordId: id, type: 'imported', actor: 'synapse', at, sourceKey: key }],
        };
        records.push(record);
        imported.push(record);
        knownKeys.set(key, record);
    }

    const currentKeys = new Set((input.structuredPRD.assumptions ?? [])
        .filter(assumption => assumption.id?.trim())
        .map(assumption => assumptionSourceKey(assumption.id)));
    for (let index = 0; index < records.length; index += 1) {
        const record = records[index];
        const source = record.sources?.find(item => item.sourceType === 'prd_assumption');
        if (!source || currentKeys.has(source.key) || record.sourceState === 'missing') continue;
        const next = { ...record, sourceState: 'missing' as const };
        records[index] = next;
        updated.push(next);
    }
    return { records, imported, existing, updated };
}
