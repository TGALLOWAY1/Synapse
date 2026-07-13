import type {
    ArtifactSlotKey,
    DecisionAssessment,
    DecisionImpactPreview,
    PlanningRecord,
    StructuredPRD,
} from '../../types';
import { projectDecision } from './decisionProjection';
import {
    buildArtifactDependencyGraph,
    computeDownstreamImpacts,
    getDirectDependents,
    type DependencyNodeId,
} from '../artifactDependencyGraph';

/** Derived from the generation pipeline's real PRD foundation edges. */
function artifactSlotsDependingOnPrd(): ArtifactSlotKey[] {
    return getDirectDependents(buildArtifactDependencyGraph(), 'prd')
        .filter((id): id is ArtifactSlotKey => id !== 'prd');
}

export function stablePlanningStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stablePlanningStringify).join(',')}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stablePlanningStringify(record[key])}`).join(',')}}`;
}

export function planningContentHash(value: unknown): string {
    const input = stablePlanningStringify(value);
    let hash = 0x811c9dc5;
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
}

export type BuildDecisionImpactResult =
    | { ok: true; assessment: DecisionAssessment; preview: DecisionImpactPreview; nextPrd?: StructuredPRD }
    | { ok: false; reason: string };

function linkedArtifactSlots(record: PlanningRecord): ArtifactSlotKey[] {
    const graph = buildArtifactDependencyGraph();
    const order = graph.nodes.map(node => node.id);
    const seeds = new Set<DependencyNodeId>();
    if (record.evidence.some(evidence => evidence.sourceType === 'spine')
        || record.sources?.some(source => source.sourceType === 'prd' || source.sourceType === 'prd_assumption')) {
        seeds.add('prd');
    }
    for (const subtype of record.evidence.flatMap(evidence => evidence.artifactSubtype ? [evidence.artifactSubtype] : [])) seeds.add(subtype);
    for (const subtype of (record.sources ?? []).flatMap(source => source.artifactSubtype ? [source.artifactSubtype] : [])) seeds.add(subtype);
    for (const slot of record.affectedArtifactSlots ?? []) seeds.add(slot);

    const impacted = new Set<DependencyNodeId>();
    for (const seed of seeds) {
        if (seed !== 'prd') impacted.add(seed);
        const downstream = computeDownstreamImpacts(graph, seed);
        for (const id of [...downstream.direct, ...downstream.indirect]) impacted.add(id);
    }
    return order.filter((id): id is ArtifactSlotKey => id !== 'prd' && impacted.has(id));
}

export function buildDecisionImpact(input: {
    projectId: string;
    record: PlanningRecord;
    baselineSpineVersionId: string;
    structuredPRD: StructuredPRD;
    now?: () => number;
}): BuildDecisionImpactResult {
    const projection = projectDecision(input.record);
    if (projection.status !== 'confirmed' && projection.status !== 'rejected') {
        return { ok: false, reason: 'Resolve the decision before previewing its impact.' };
    }
    if (!projection.latestVerdictEventId) {
        return { ok: false, reason: 'The decision has no user-authored verdict to preview.' };
    }
    const assumptionSource = input.record.sources?.find(source => source.sourceType === 'prd_assumption');
    if (!assumptionSource) {
        const createdAt = input.now?.() ?? Date.now();
        const affectedPrdSections = [...new Set(input.record.evidence
            .filter(evidence => evidence.sourceType === 'spine')
            .flatMap(evidence => evidence.locator?.section ? [evidence.locator.section] : []))];
        const preview: DecisionImpactPreview = {
            id: `impact-${input.record.id}-${planningContentHash(`${input.baselineSpineVersionId}:${projection.latestVerdictEventId}`)}`,
            projectId: input.projectId,
            planningRecordId: input.record.id,
            decisionEventId: projection.latestVerdictEventId,
            status: 'ready',
            baseline: {
                spineVersionId: input.baselineSpineVersionId,
                spineContentHash: planningContentHash(input.structuredPRD),
            },
            affectedPrdSections,
            affectedArtifactSlots: linkedArtifactSlots(input.record),
            possibleConflictRecordIds: input.record.relatedPlanningRecordIds ?? [],
            explanation: 'This advisory preview traces the decision to its verified source context and downstream assets. No deterministic PRD edit is available, so Synapse will not offer Apply to plan.',
            createdAt,
        };
        const assessment: DecisionAssessment = {
            id: `assessment-${preview.id}`,
            projectId: input.projectId,
            planningRecordId: input.record.id,
            sourceSpineVersionId: input.baselineSpineVersionId,
            status: 'fresh',
            recommendation: input.record.recommendationDetail,
            evidence: input.record.evidence,
            inferredAssumptions: [],
            possibleConflictRecordIds: preview.possibleConflictRecordIds,
            impactPreview: preview,
            createdAt,
        };
        return { ok: true, assessment, preview };
    }
    const assumptions = input.structuredPRD.assumptions ?? [];
    const sourceAssumption = assumptions.find(assumption => assumption.id === assumptionSource.sourceId);
    if (!sourceAssumption) {
        return { ok: false, reason: 'The source assumption is no longer present in the current PRD.' };
    }

    const decidedAt = input.record.confirmedAt ?? input.now?.() ?? Date.now();
    const nextAssumption = {
        ...sourceAssumption,
        decision: projection.status === 'rejected' ? 'rejected' as const : 'confirmed' as const,
        decisionNote: projection.answer && projection.answer !== sourceAssumption.statement
            ? projection.answer
            : undefined,
        decidedAt,
    };
    const nextPrd: StructuredPRD = {
        ...input.structuredPRD,
        assumptions: assumptions.map(assumption => assumption.id === sourceAssumption.id ? nextAssumption : assumption),
    };
    const createdAt = input.now?.() ?? Date.now();
    const id = `impact-${input.record.id}-${planningContentHash(`${input.baselineSpineVersionId}:${projection.latestVerdictEventId}`)}`;
    const preview: DecisionImpactPreview = {
        id,
        projectId: input.projectId,
        planningRecordId: input.record.id,
        decisionEventId: projection.latestVerdictEventId,
        status: 'ready',
        baseline: {
            spineVersionId: input.baselineSpineVersionId,
            spineContentHash: planningContentHash(input.structuredPRD),
        },
        proposedPrdPatch: [{
            section: 'assumptions',
            operation: 'replace',
            entityId: sourceAssumption.id,
            beforeSummary: sourceAssumption.statement,
            afterSummary: projection.status === 'rejected'
                ? `Rejected${projection.answer ? ` — ${projection.answer}` : ''}`
                : `Confirmed${projection.answer && projection.answer !== sourceAssumption.statement ? ` — ${projection.answer}` : ''}`,
            value: nextAssumption,
        }],
        proposedResultHash: planningContentHash(nextPrd),
        affectedPrdSections: ['Assumptions'],
        affectedArtifactSlots: artifactSlotsDependingOnPrd(),
        possibleConflictRecordIds: input.record.relatedPlanningRecordIds ?? [],
        explanation: 'Applying this decision records the confirmed planning context in a new PRD version. Existing assets are not rewritten and will be evaluated for review.',
        createdAt,
    };
    const assessment: DecisionAssessment = {
        id: `assessment-${id}`,
        projectId: input.projectId,
        planningRecordId: input.record.id,
        sourceSpineVersionId: input.baselineSpineVersionId,
        status: 'fresh',
        recommendation: input.record.recommendationDetail,
        evidence: input.record.evidence,
        inferredAssumptions: [],
        possibleConflictRecordIds: preview.possibleConflictRecordIds,
        impactPreview: preview,
        createdAt,
    };
    return { ok: true, assessment, preview, nextPrd };
}

export function isDecisionImpactStale(
    preview: DecisionImpactPreview,
    currentSpineVersionId: string,
    currentPrd: StructuredPRD,
): boolean {
    return preview.baseline.spineVersionId !== currentSpineVersionId
        || preview.baseline.spineContentHash !== planningContentHash(currentPrd);
}
