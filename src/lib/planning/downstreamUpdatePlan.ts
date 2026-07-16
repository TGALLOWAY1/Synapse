import type { ArtifactSlotKey, PlanningRecord } from '../../types';
import { hashReviewValue } from '../review/hash';

export const DOWNSTREAM_UPDATE_PLAN_SCHEMA_VERSION = 1 as const;
export const DOWNSTREAM_UPDATE_PLAN_EVENT_SCHEMA_VERSION = 1 as const;

export type DownstreamUpdateArtifactSlot = Extract<ArtifactSlotKey, 'screen_inventory' | 'user_flows' | 'data_model'>;
export type DownstreamImpactCertainty = 'possible' | 'likely' | 'definite';
export type DownstreamUpdateDisposition = 'planned' | 'deferred' | 'not_applicable' | 'already_aligned';

export type DownstreamUpdateRegion =
    | {
        kind: 'screen';
        screenId: string;
        screenName: string;
        aspect: 'screen' | 'state' | 'behavior' | 'role';
        aspectId?: string;
        label?: string;
    }
    | {
        kind: 'flow';
        flowId: string;
        flowName: string;
        aspect: 'flow' | 'step' | 'branch';
        stepIndex?: number;
        label?: string;
    }
    | {
        kind: 'data_model';
        entityName: string;
        aspect: 'entity' | 'field' | 'relationship' | 'constraint';
        memberName?: string;
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
    const { integrityHash: _integrityHash, ...canonical } = plan as DownstreamUpdatePlan;
    return canonical;
};

const canonicalEvent = (event: Omit<DownstreamUpdatePlanEvent, 'integrityHash'> | DownstreamUpdatePlanEvent) => {
    const { integrityHash: _integrityHash, ...canonical } = event as DownstreamUpdatePlanEvent;
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
): { disposition?: DownstreamUpdateDisposition; priority: number; eventIds: string[] } {
    const item = plan.items.find(candidate => candidate.id === itemId);
    const applicable = events
        .filter(event => event.planId === plan.id && event.itemId === itemId && validateDownstreamUpdatePlanEventIntegrity(event))
        .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
    let disposition: DownstreamUpdateDisposition | undefined;
    let priority = item?.recommendedPriority ?? Number.MAX_SAFE_INTEGER;
    for (const event of applicable) {
        if (event.type === 'disposition_recorded') disposition = event.disposition;
        if (event.type === 'priority_changed') priority = event.priority;
    }
    return { disposition, priority, eventIds: applicable.map(event => event.id) };
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
