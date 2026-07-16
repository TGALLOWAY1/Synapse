import type { Artifact, ArtifactSlotKey, ArtifactVersion, PlanningRecord, SpineVersion } from '../../types';
import { hashReviewValue } from '../review/hash';

export const DOWNSTREAM_UPDATE_PLAN_SCHEMA_VERSION = 1 as const;
export const DOWNSTREAM_UPDATE_PLAN_EVENT_SCHEMA_VERSION = 1 as const;

export type DownstreamUpdateArtifactSlot = Extract<ArtifactSlotKey, 'screen_inventory' | 'user_flows' | 'data_model' | 'implementation_plan'>;
export type DownstreamImpactCertainty = 'possible' | 'likely' | 'definite';
export type DownstreamUpdateDisposition = 'planned' | 'deferred' | 'not_applicable' | 'already_aligned';

export type DownstreamUpdateRegion =
    | {
        kind: 'screen';
        screenId: string;
        screenName: string;
        aspect:
            | 'screen'
            | 'state'
            | 'behavior'
            | 'component'
            | 'role'
            | 'interaction'
            | 'empty'
            | 'error'
            | 'permission'
            | 'navigation';
        aspectId?: string;
        label?: string;
    }
    | {
        kind: 'flow';
        flowId: string;
        flowName: string;
        aspect:
            | 'flow'
            | 'step'
            | 'branch'
            | 'entry'
            | 'exit'
            | 'actor'
            | 'decision'
            | 'error_recovery';
        stepIndex?: number;
        label?: string;
    }
    | {
        kind: 'data_model';
        entityName: string;
        aspect: 'entity' | 'field' | 'relationship' | 'constraint' | 'data_expectation';
        memberName?: string;
        label?: string;
    }
    | {
        kind: 'implementation_plan';
        section: 'architecture';
        aspect:
            | 'decision'
            | 'component'
            | 'integration'
            | 'data_flow'
            | 'security_boundary'
            | 'deployment'
            | 'storage'
            | 'authentication'
            | 'external_dependency'
            | 'operational_constraint';
        entryIndex: number;
        entryLabel: string;
        label?: string;
    }
    | {
        kind: 'implementation_plan';
        section: 'delivery';
        aspect:
            | 'milestone'
            | 'workstream'
            | 'task'
            | 'dependency'
            | 'acceptance_criterion'
            | 'risk'
            | 'sequencing_assumption'
            | 'technical_prerequisite'
            | 'testing_requirement';
        collection:
            | 'milestones'
            | 'tasks'
            | 'dependencies'
            | 'definition_of_done'
            | 'prompt_acceptance_criteria'
            | 'risks'
            | 'critical_path'
            | 'validation_commands'
            | 'quality_gates';
        milestoneId?: string;
        taskId?: string;
        promptPackId?: string;
        qualityGateId?: string;
        entryIndex: number;
        entryLabel: string;
        label?: string;
    }
    | {
        kind: 'artifact_review';
        reason: 'legacy_provenance' | 'unstructured_content' | 'insufficient_dependency';
        label: string;
    };

export type DownstreamUpdateEvidence = {
    id: string;
    kind: 'structured_trace' | 'deterministic_reference' | 'plan_diff' | 'provenance' | 'missing_provenance';
    quality: 'direct' | 'inferred' | 'incomplete';
    summary: string;
    sourceId?: string;
    contentHash?: string;
};

export type DownstreamUpdateRecommendedAction =
    | 'review_only'
    | 'revise_behavior'
    | 'remove_obsolete_element'
    | 'add_missing_state'
    | 'reconsider_flow_branch'
    | 'review_entity'
    | 'review_field'
    | 'review_relationship'
    | 'review_architecture'
    | 'review_implementation_plan'
    | 'confirm_no_change'
    | 'gather_information';

export type DownstreamUpdatePlanItem = {
    id: string;
    region: DownstreamUpdateRegion;
    currentInterpretation: string;
    whyAffected: string;
    certainty: DownstreamImpactCertainty;
    evidence: DownstreamUpdateEvidence[];
    ambiguity?: string;
    recommendedAction: DownstreamUpdateRecommendedAction;
    recommendation: string;
    /** Specific neighboring work that the bounded analysis found no reason to revisit. */
    preservedScope: string[];
    recommendedPriority: number;
    implementationCritical: boolean;
};

export type DownstreamUpdatePlanSource = {
    kind: 'planning_change';
    summary: string;
    sourceSpineVersionId?: string;
    targetSpineVersionId: string;
    targetSpineContentHash: string;
    planningContextHash: string;
    planningRecordId?: string;
    planningEventId?: string;
    confirmed: boolean;
};

export type DownstreamUpdatePlanArtifactBinding = {
    artifactId: string;
    artifactVersionId: string;
    artifactContentHash: string;
    slot: DownstreamUpdateArtifactSlot;
    title: string;
};

export type DownstreamUpdatePlan = {
    schemaVersion: typeof DOWNSTREAM_UPDATE_PLAN_SCHEMA_VERSION;
    id: string;
    projectId: string;
    authoredBy: 'synapse';
    source: DownstreamUpdatePlanSource;
    artifact: DownstreamUpdatePlanArtifactBinding;
    items: DownstreamUpdatePlanItem[];
    preservedArtifactSummary: string;
    createdAt: number;
    integrityHash: string;
};

type DownstreamUpdatePlanEventBase = {
    schemaVersion: typeof DOWNSTREAM_UPDATE_PLAN_EVENT_SCHEMA_VERSION;
    id: string;
    projectId: string;
    planId: string;
    itemId: string;
    actor: 'user';
    at: number;
    expectedPlanIntegrityHash: string;
    integrityHash: string;
};

export type DownstreamUpdatePlanEvent = DownstreamUpdatePlanEventBase & (
    | {
        type: 'disposition_recorded';
        disposition: DownstreamUpdateDisposition;
        rationale?: string;
    }
    | {
        type: 'priority_changed';
        priority: number;
    }
);

type UnsealedDownstreamUpdatePlanEvent = DownstreamUpdatePlanEvent extends infer Event
    ? Event extends unknown ? Omit<Event, 'integrityHash'> : never
    : never;

export type DownstreamUpdatePlanCurrentContext = {
    spineVersionId: string;
    spineContentHash: string;
    planningContextHash: string;
    artifactVersions: Record<string, { versionId: string; contentHash: string }>;
};

export type DownstreamUpdatePlanCurrentness = {
    current: boolean;
    reasons: Array<'spine_changed' | 'spine_content_changed' | 'planning_context_changed' | 'artifact_version_changed' | 'artifact_content_changed'>;
};

const canonicalPlan = (plan: Omit<DownstreamUpdatePlan, 'integrityHash'> | DownstreamUpdatePlan) => {
    const canonical = { ...plan } as Partial<DownstreamUpdatePlan>;
    delete canonical.integrityHash;
    return canonical;
};

const canonicalEvent = (event: Omit<DownstreamUpdatePlanEvent, 'integrityHash'> | DownstreamUpdatePlanEvent) => {
    const canonical = { ...event } as Partial<DownstreamUpdatePlanEvent>;
    delete canonical.integrityHash;
    return canonical;
};

export function sealDownstreamUpdatePlan(input: Omit<DownstreamUpdatePlan, 'integrityHash'>): DownstreamUpdatePlan {
    return { ...input, integrityHash: hashReviewValue(canonicalPlan(input)) };
}

export function validateDownstreamUpdatePlanIntegrity(plan: DownstreamUpdatePlan): boolean {
    return plan.schemaVersion === DOWNSTREAM_UPDATE_PLAN_SCHEMA_VERSION
        && plan.authoredBy === 'synapse'
        && plan.integrityHash === hashReviewValue(canonicalPlan(plan));
}

export function sealDownstreamUpdatePlanEvent(input: UnsealedDownstreamUpdatePlanEvent): DownstreamUpdatePlanEvent {
    return { ...input, integrityHash: hashReviewValue(canonicalEvent(input)) } as DownstreamUpdatePlanEvent;
}

export function validateDownstreamUpdatePlanEventIntegrity(event: DownstreamUpdatePlanEvent): boolean {
    return event.schemaVersion === DOWNSTREAM_UPDATE_PLAN_EVENT_SCHEMA_VERSION
        && event.actor === 'user'
        && event.integrityHash === hashReviewValue(canonicalEvent(event));
}

/** Authority-bearing project state only. Advisory assessments/proposals cannot stale or approve a plan. */
export function downstreamPlanningContextHash(records: PlanningRecord[]): string {
    return hashReviewValue([...records]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(record => ({
            id: record.id,
            type: record.type,
            status: record.status,
            statement: record.statement,
            resolution: record.resolution,
            rationale: record.rationale,
            sourceState: record.sourceState,
            resultingSpineVersionId: record.resultingSpineVersionId,
            events: record.events ?? [],
            validationEvents: record.assumptionValidation?.events ?? [],
        })));
}

export function compareDownstreamUpdatePlanCurrentness(
    plan: DownstreamUpdatePlan,
    context: DownstreamUpdatePlanCurrentContext,
): DownstreamUpdatePlanCurrentness {
    const reasons: DownstreamUpdatePlanCurrentness['reasons'] = [];
    if (plan.source.targetSpineVersionId !== context.spineVersionId) reasons.push('spine_changed');
    if (plan.source.targetSpineContentHash !== context.spineContentHash) reasons.push('spine_content_changed');
    if (plan.source.planningContextHash !== context.planningContextHash) reasons.push('planning_context_changed');
    const artifact = context.artifactVersions[plan.artifact.artifactId];
    if (!artifact || artifact.versionId !== plan.artifact.artifactVersionId) reasons.push('artifact_version_changed');
    if (artifact && artifact.contentHash !== plan.artifact.artifactContentHash) reasons.push('artifact_content_changed');
    return { current: reasons.length === 0, reasons };
}

export function latestDownstreamUpdatePlanItemState(
    plan: DownstreamUpdatePlan,
    events: DownstreamUpdatePlanEvent[],
    itemId: string,
): { disposition?: DownstreamUpdateDisposition; priority: number; eventIds: string[]; eventIntegrityHashes: string[] } {
    const item = plan.items.find(candidate => candidate.id === itemId);
    const applicable = events
        .filter(event => event.planId === plan.id
            && event.itemId === itemId
            && event.expectedPlanIntegrityHash === plan.integrityHash
            && validateDownstreamUpdatePlanEventIntegrity(event))
        .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
    let disposition: DownstreamUpdateDisposition | undefined;
    let priority = item?.recommendedPriority ?? Number.MAX_SAFE_INTEGER;
    for (const event of applicable) {
        if (event.type === 'disposition_recorded') disposition = event.disposition;
        if (event.type === 'priority_changed') priority = event.priority;
    }
    return {
        disposition,
        priority,
        eventIds: applicable.map(event => event.id),
        eventIntegrityHashes: applicable.map(event => event.integrityHash),
    };
}

export type DownstreamUpdatePlanProjection = {
    plan: DownstreamUpdatePlan;
    currentness: DownstreamUpdatePlanCurrentness;
    items: Array<DownstreamUpdatePlanItem & {
        disposition?: DownstreamUpdateDisposition;
        priority: number;
        dispositionEventIds: string[];
        dispositionEventIntegrityHashes: string[];
    }>;
    unresolvedDefiniteCount: number;
    unresolvedAdvisoryCount: number;
};

export type DownstreamUpdatePlanSummaryItem = {
    planId: string;
    planIntegrityHash: string;
    itemId: string;
    artifactId: string;
    artifactVersionId: string;
    nodeId: DownstreamUpdateArtifactSlot;
    artifactTitle: string;
    region: DownstreamUpdateRegion;
    certainty: DownstreamImpactCertainty;
    implementationCritical: boolean;
    disposition?: DownstreamUpdateDisposition;
    priority: number;
    recommendation: string;
    verificationOutcome?: import('./downstreamArtifactUpdateVerification').DownstreamVerificationOutcome;
    verificationIntegrityHash?: string;
};

export type DownstreamUpdatePlanSummary = {
    currentPlanCount: number;
    historicalPlanCount: number;
    blockingItems: DownstreamUpdatePlanSummaryItem[];
    advisoryItems: DownstreamUpdatePlanSummaryItem[];
    reviewedItems: DownstreamUpdatePlanSummaryItem[];
    /** Exact integrity-valid current plan/event projection pinned into readiness. */
    snapshotHash: string;
};

export function projectDownstreamUpdatePlan(
    plan: DownstreamUpdatePlan,
    events: DownstreamUpdatePlanEvent[],
    context: DownstreamUpdatePlanCurrentContext,
): DownstreamUpdatePlanProjection {
    const items = plan.items.map(item => {
        const state = latestDownstreamUpdatePlanItemState(plan, events, item.id);
        return {
            ...item,
            disposition: state.disposition,
            priority: state.priority,
            dispositionEventIds: state.eventIds,
            dispositionEventIntegrityHashes: state.eventIntegrityHashes,
        };
    }).sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
    return {
        plan,
        currentness: compareDownstreamUpdatePlanCurrentness(plan, context),
        items,
        unresolvedDefiniteCount: items.filter(item => item.certainty === 'definite' && !item.disposition).length,
        unresolvedAdvisoryCount: items.filter(item => item.certainty !== 'definite' && !item.disposition).length,
    };
}

export function buildDownstreamUpdatePlanCurrentContext(input: {
    spineVersions: SpineVersion[];
    planningRecords: PlanningRecord[];
    artifacts: Artifact[];
    artifactVersions: ArtifactVersion[];
}): DownstreamUpdatePlanCurrentContext | undefined {
    const spine = input.spineVersions.find(candidate => candidate.isLatest);
    if (!spine) return undefined;
    return {
        spineVersionId: spine.id,
        spineContentHash: hashReviewValue(spine.structuredPRD ?? spine.responseText),
        planningContextHash: downstreamPlanningContextHash(input.planningRecords),
        artifactVersions: Object.fromEntries(input.artifacts.flatMap(artifact => {
            const version = input.artifactVersions.find(candidate => candidate.id === artifact.currentVersionId)
                ?? input.artifactVersions.find(candidate => candidate.artifactId === artifact.id && candidate.isPreferred);
            return version ? [[artifact.id, { versionId: version.id, contentHash: hashReviewValue(version.content) }]] : [];
        })),
    };
}

export function deriveDownstreamUpdatePlanSummary(input: {
    plans: DownstreamUpdatePlan[];
    events: DownstreamUpdatePlanEvent[];
    context?: DownstreamUpdatePlanCurrentContext;
}): DownstreamUpdatePlanSummary {
    if (!input.context) {
        return {
            currentPlanCount: 0,
            historicalPlanCount: input.plans.filter(validateDownstreamUpdatePlanIntegrity).length,
            blockingItems: [], advisoryItems: [], reviewedItems: [],
            snapshotHash: hashReviewValue([]),
        };
    }
    const validPlans = input.plans.filter(validateDownstreamUpdatePlanIntegrity);
    const projections = validPlans.map(plan => projectDownstreamUpdatePlan(plan, input.events, input.context!));
    const current = projections.filter(projection => projection.currentness.current);
    const items: DownstreamUpdatePlanSummaryItem[] = current.flatMap(projection => projection.items.map(item => ({
        planId: projection.plan.id,
        planIntegrityHash: projection.plan.integrityHash,
        itemId: item.id,
        artifactId: projection.plan.artifact.artifactId,
        artifactVersionId: projection.plan.artifact.artifactVersionId,
        nodeId: projection.plan.artifact.slot,
        artifactTitle: projection.plan.artifact.title,
        region: item.region,
        certainty: item.certainty,
        implementationCritical: item.implementationCritical,
        disposition: item.disposition,
        priority: item.priority,
        recommendation: item.recommendation,
    })));
    // Phase 5A ends at a reviewed update plan. Marking an item planned therefore
    // completes this planning checkpoint, while the independent OutputAlignment
    // projection continues to decide whether the artifact itself blocks build.
    // Deferred work remains unresolved when the affected region is definite.
    const handled = (item: DownstreamUpdatePlanSummaryItem): boolean =>
        item.disposition === 'planned'
        || item.disposition === 'not_applicable'
        || item.disposition === 'already_aligned';
    const blockingItems = items.filter(item => (
        item.certainty === 'definite' && item.implementationCritical && !handled(item)
    ));
    const advisoryItems = items.filter(item => item.certainty !== 'definite' && !handled(item));
    const reviewedItems = items.filter(handled);
    const snapshot = current.map(projection => ({
        planId: projection.plan.id,
        integrityHash: projection.plan.integrityHash,
        artifact: projection.plan.artifact,
        source: projection.plan.source,
        items: projection.items.map(item => ({
            id: item.id,
            certainty: item.certainty,
            implementationCritical: item.implementationCritical,
            disposition: item.disposition,
            priority: item.priority,
            dispositionEventIds: item.dispositionEventIds,
            dispositionEventIntegrityHashes: item.dispositionEventIntegrityHashes,
        })),
    })).sort((a, b) => a.planId.localeCompare(b.planId));
    return {
        currentPlanCount: current.length,
        historicalPlanCount: projections.length - current.length,
        blockingItems: blockingItems.sort((a, b) => a.priority - b.priority || a.itemId.localeCompare(b.itemId)),
        advisoryItems: advisoryItems.sort((a, b) => a.priority - b.priority || a.itemId.localeCompare(b.itemId)),
        reviewedItems: reviewedItems.sort((a, b) => a.priority - b.priority || a.itemId.localeCompare(b.itemId)),
        snapshotHash: hashReviewValue(snapshot),
    };
}

export function normalizeDownstreamUpdatePlanCollections(value: unknown): {
    plans: Record<string, DownstreamUpdatePlan[]>;
    events: Record<string, DownstreamUpdatePlanEvent[]>;
} {
    const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const plans = raw.downstreamUpdatePlans && typeof raw.downstreamUpdatePlans === 'object'
        ? raw.downstreamUpdatePlans as Record<string, DownstreamUpdatePlan[]>
        : {};
    const events = raw.downstreamUpdatePlanEvents && typeof raw.downstreamUpdatePlanEvents === 'object'
        ? raw.downstreamUpdatePlanEvents as Record<string, DownstreamUpdatePlanEvent[]>
        : {};
    return { plans, events };
}
