import type { ArtifactVersion } from '../../types';
import { hashReviewValue } from '../review/hash';
import {
    compareDownstreamUpdatePlanCurrentness,
    type DownstreamImpactCertainty,
    type DownstreamUpdateEvidence,
    type DownstreamUpdatePlan,
    type DownstreamUpdatePlanCurrentContext,
    type DownstreamUpdatePlanItem,
    type DownstreamUpdatePlanSource,
    type DownstreamUpdateRegion,
    validateDownstreamUpdatePlanIntegrity,
} from './downstreamUpdatePlan';
import {
    MAX_DOWNSTREAM_REGION_SNAPSHOT_LENGTH,
    resolveDownstreamUpdateRegionContent,
} from './downstreamRegionContent';

export { resolveDownstreamUpdateRegionContent } from './downstreamRegionContent';

export const DOWNSTREAM_ARTIFACT_UPDATE_PROPOSAL_SCHEMA_VERSION = 1 as const;
export const DOWNSTREAM_ARTIFACT_UPDATE_REVIEW_EVENT_SCHEMA_VERSION = 1 as const;
export const DOWNSTREAM_ARTIFACT_UPDATE_APPLICATION_SCHEMA_VERSION = 1 as const;
export const DOWNSTREAM_ARTIFACT_UPDATE_VERIFICATION_SCHEMA_VERSION = 1 as const;
export const DOWNSTREAM_ARTIFACT_UPDATE_VERIFICATION_EVENT_SCHEMA_VERSION = 1 as const;

export type DownstreamArtifactUpdateOperation = 'replace' | 'add' | 'remove' | 'structural' | 'review_only';
export type DownstreamArtifactUpdateReviewAction =
    | 'accepted'
    | 'edited'
    | 'rejected'
    | 'preserved'
    | 'deferred'
    | 'requested_another'
    | 'provided_context';

export type DownstreamArtifactUpdateGenerator = {
    provider: string;
    model: string;
    modelVersion?: string;
    promptHash: string;
    reasoningVersion: string;
};

export type DownstreamDataModelChangeKind =
    | 'add'
    | 'remove'
    | 'rename'
    | 'requiredness'
    | 'cardinality'
    | 'constraint'
    | 'replace'
    | 'out_of_scope';

export type DownstreamDataModelDependency = {
    id: string;
    label: string;
    kind: 'field' | 'relationship' | 'constraint' | 'flow' | 'requirement' | 'data_expectation';
    /** Direct dependencies are structurally established; possible dependencies require review. */
    certainty: 'direct' | 'possible';
    explanation: string;
};

/**
 * Advisory impact metadata for an exact data-model proposal. It is sealed as
 * part of the proposal, but never grants authority or clears alignment.
 */
export type DownstreamDataModelImpact = {
    changeKind: DownstreamDataModelChangeKind;
    memberKind: 'entity' | 'field' | 'relationship' | 'constraint' | 'data_expectation';
    destructive: boolean;
    format: 'markdown' | 'json';
    relationshipEndpoints: string[];
    dependencies: DownstreamDataModelDependency[];
    migrationImplications: string[];
    automaticApplicationBlocked: boolean;
    blockReasons: string[];
};

export type DownstreamArtifactUpdateProposal = {
    schemaVersion: typeof DOWNSTREAM_ARTIFACT_UPDATE_PROPOSAL_SCHEMA_VERSION;
    id: string;
    projectId: string;
    authoredBy: 'synapse';
    updatePlanBinding: {
        planId: string;
        planIntegrityHash: string;
        itemId: string;
        itemIntegrityHash: string;
    };
    source: DownstreamUpdatePlanSource;
    artifact: {
        artifactId: string;
        artifactVersionId: string;
        artifactContentHash: string;
        slot: DownstreamUpdatePlan['artifact']['slot'];
        title: string;
    };
    region: DownstreamUpdateRegion;
    regionKey: string;
    /** Exact post-change identity when a bounded rename changes the lookup key. */
    resultingRegion?: DownstreamUpdateRegion;
    currentRegionContentHash: string;
    /** Bounded, displayable snapshot of what the exact region contained. */
    currentRegionSnapshot: string;
    currentRegionSnapshotTruncated: boolean;
    operation: DownstreamArtifactUpdateOperation;
    /** Null for remove and review-only operations. Generated content has no authority. */
    proposedContent: string | null;
    dataModelImpact?: DownstreamDataModelImpact;
    evidence: DownstreamUpdateEvidence[];
    reasoning: string;
    certainty: DownstreamImpactCertainty;
    ambiguity?: string;
    preservedScope: string[];
    preservedScopeHash: string;
    preservedRegionBindings: Array<{ region: DownstreamUpdateRegion; regionKey: string; contentHash: string }>;
    generator: DownstreamArtifactUpdateGenerator;
    createdAt: number;
    integrityHash: string;
};

type ReviewEventBase = {
    schemaVersion: typeof DOWNSTREAM_ARTIFACT_UPDATE_REVIEW_EVENT_SCHEMA_VERSION;
    id: string;
    projectId: string;
    proposalId: string;
    actor: 'user';
    at: number;
    expectedProposalIntegrityHash: string;
    expectedPlanIntegrityHash: string;
    expectedItemIntegrityHash: string;
    expectedRegionContentHash: string;
    /** Exact negative user disposition carried across an unchanged region rebase. */
    carriedFrom?: {
        eventId: string;
        eventIntegrityHash: string;
        proposalId: string;
    };
    integrityHash: string;
};

export type DownstreamArtifactUpdateReviewEvent = ReviewEventBase & (
    | { action: 'accepted'; rationale?: string }
    | { action: 'edited'; operation: Exclude<DownstreamArtifactUpdateOperation, 'review_only'>; editedContent: string | null; rationale: string }
    | { action: 'rejected' | 'preserved' | 'deferred' | 'requested_another'; rationale: string }
    | { action: 'provided_context'; context: string }
);

export type DownstreamArtifactUpdateApplication = {
    schemaVersion: typeof DOWNSTREAM_ARTIFACT_UPDATE_APPLICATION_SCHEMA_VERSION;
    id: string;
    projectId: string;
    proposalId: string;
    proposalIntegrityHash: string;
    authorizedByReviewEventId: string;
    authorizedByReviewEventIntegrityHash: string;
    actor: 'system';
    initiatedBy: 'user';
    effectiveOperation: Exclude<DownstreamArtifactUpdateOperation, 'review_only'>;
    effectiveContentHash: string | null;
    expectedArtifactVersionId: string;
    expectedArtifactContentHash: string;
    expectedRegionContentHash: string;
    resultingArtifactVersionId: string;
    resultingArtifactContentHash: string;
    resultingRegionContentHash: string;
    appliedAt: number;
    integrityHash: string;
};

export type DownstreamArtifactUpdateVerification = {
    schemaVersion: typeof DOWNSTREAM_ARTIFACT_UPDATE_VERIFICATION_SCHEMA_VERSION;
    id: string;
    projectId: string;
    /** Legacy bindings remain readable; new verification records use subject. */
    proposalId?: string;
    proposalIntegrityHash?: string;
    applicationId?: string;
    applicationIntegrityHash?: string;
    subject?: {
        kind: 'application' | 'manual_update';
        planId: string;
        planIntegrityHash: string;
        itemId: string;
        itemIntegrityHash: string;
        sourceSpineVersionId: string;
        sourceSpineContentHash: string;
        planningContextHash: string;
        artifactId: string;
        baselineArtifactVersionId: string;
        baselineArtifactContentHash: string;
        targetArtifactVersionId: string;
        targetArtifactContentHash: string;
        proposalId?: string;
        proposalIntegrityHash?: string;
        applicationId?: string;
        applicationIntegrityHash?: string;
    };
    authoredBy: 'synapse';
    result:
        | 'aligned'
        | 'review_recommended'
        | 'update_still_required'
        | 'verification_unavailable'
        /** Legacy Stage 1 values are retained conservatively. */
        | 'matches_proposal'
        | 'partial'
        | 'mismatch'
        | 'inconclusive';
    evidence: DownstreamUpdateEvidence[];
    reasoning: string;
    remainingAmbiguity?: string;
    verifiedArtifactVersionId: string;
    verifiedArtifactContentHash: string;
    verifiedRegionContentHash: string;
    generator: DownstreamArtifactUpdateGenerator;
    createdAt: number;
    integrityHash: string;
};

export type DownstreamArtifactUpdateVerificationEvent = {
    schemaVersion: typeof DOWNSTREAM_ARTIFACT_UPDATE_VERIFICATION_EVENT_SCHEMA_VERSION;
    id: string;
    projectId: string;
    verificationId: string;
    actor: 'user';
    action: 'confirmed' | 'rejected' | 'deferred' | 'requested_another' | 'provided_context';
    rationale?: string;
    context?: string;
    expectedVerificationIntegrityHash: string;
    at: number;
    integrityHash: string;
};

export type DownstreamArtifactUpdateProposalCurrentnessReason =
    | 'proposal_tampered'
    | 'plan_missing'
    | 'plan_tampered'
    | 'plan_changed'
    | 'item_missing'
    | 'item_changed'
    | 'source_changed'
    | 'spine_changed'
    | 'spine_content_changed'
    | 'planning_context_changed'
    | 'artifact_version_changed'
    | 'artifact_content_changed'
    | 'region_missing'
    | 'region_content_changed'
    | 'preserved_region_changed';

export type DownstreamArtifactUpdateProposalCurrentness = {
    current: boolean;
    reasons: DownstreamArtifactUpdateProposalCurrentnessReason[];
};

type UnsealedReviewEvent = DownstreamArtifactUpdateReviewEvent extends infer Event
    ? Event extends unknown ? Omit<Event, 'integrityHash'> : never
    : never;
type UnsealedVerificationEvent = Omit<DownstreamArtifactUpdateVerificationEvent, 'integrityHash'>;

const withoutIntegrity = <T extends { integrityHash?: string }>(value: T): Omit<T, 'integrityHash'> => {
    const canonical = { ...value };
    delete canonical.integrityHash;
    return canonical;
};

const seal = <T extends { integrityHash: string }>(input: Omit<T, 'integrityHash'>): T => ({
    ...input,
    integrityHash: hashReviewValue(input),
}) as T;

const validSeal = <T extends { integrityHash: string }>(value: T): boolean =>
    value.integrityHash === hashReviewValue(withoutIntegrity(value));

export function downstreamUpdatePlanItemIntegrityHash(plan: DownstreamUpdatePlan, item: DownstreamUpdatePlanItem): string {
    return hashReviewValue({ planId: plan.id, planIntegrityHash: plan.integrityHash, item });
}

export function downstreamUpdateRegionKey(region: DownstreamUpdateRegion): string {
    return hashReviewValue(region);
}

/**
 * Resolves the exact normalized region used by a proposal. A broad artifact
 * review binds an artifact-level snapshot for freshness only; the proposal
 * contract prevents it from becoming a writable operation.
 */
export function sealDownstreamArtifactUpdateProposal(
    input: Omit<DownstreamArtifactUpdateProposal, 'integrityHash'>,
): DownstreamArtifactUpdateProposal {
    return seal<DownstreamArtifactUpdateProposal>(input);
}

export function validateDownstreamArtifactUpdateProposalIntegrity(proposal: DownstreamArtifactUpdateProposal): boolean {
    const contentShapeValid = proposal.operation === 'review_only' || proposal.operation === 'remove'
        ? proposal.proposedContent === null
        : typeof proposal.proposedContent === 'string' && proposal.proposedContent.trim().length > 0;
    const dataModelShapeValid = !proposal.dataModelImpact || (
        proposal.artifact.slot === 'data_model'
        && proposal.region.kind === 'data_model'
        && ['entity', 'field', 'relationship', 'constraint', 'data_expectation'].includes(proposal.dataModelImpact.memberKind)
        && (!proposal.dataModelImpact.automaticApplicationBlocked || proposal.operation === 'review_only')
        && new Set(proposal.dataModelImpact.dependencies.map(dependency => dependency.id)).size === proposal.dataModelImpact.dependencies.length
        && proposal.dataModelImpact.dependencies.every(dependency => dependency.label.trim().length > 0 && dependency.explanation.trim().length > 0)
    );
    return proposal.schemaVersion === DOWNSTREAM_ARTIFACT_UPDATE_PROPOSAL_SCHEMA_VERSION
        && proposal.authoredBy === 'synapse'
        && proposal.regionKey === downstreamUpdateRegionKey(proposal.region)
        && (!proposal.resultingRegion || proposal.resultingRegion.kind === proposal.region.kind)
        && proposal.currentRegionSnapshot.length <= MAX_DOWNSTREAM_REGION_SNAPSHOT_LENGTH
        && proposal.preservedScopeHash === hashReviewValue(proposal.preservedScope)
        && new Set(proposal.preservedRegionBindings.map(binding => binding.regionKey)).size === proposal.preservedRegionBindings.length
        && proposal.preservedRegionBindings.every(binding => binding.regionKey === downstreamUpdateRegionKey(binding.region))
        && proposal.reasoning.trim().length >= 3
        && proposal.generator.provider.trim().length > 0
        && proposal.generator.model.trim().length > 0
        && proposal.generator.promptHash.trim().length > 0
        && proposal.generator.reasoningVersion.trim().length > 0
        && (proposal.region.kind !== 'artifact_review' || proposal.operation === 'review_only')
        && dataModelShapeValid
        && contentShapeValid
        && validSeal(proposal);
}

export function downstreamArtifactUpdateResultRegion(proposal: DownstreamArtifactUpdateProposal): DownstreamUpdateRegion {
    return proposal.resultingRegion ?? proposal.region;
}

export function sealDownstreamArtifactUpdateReviewEvent(input: UnsealedReviewEvent): DownstreamArtifactUpdateReviewEvent {
    return seal<DownstreamArtifactUpdateReviewEvent>(input);
}

export function validateDownstreamArtifactUpdateReviewEventIntegrity(event: DownstreamArtifactUpdateReviewEvent): boolean {
    if (event.schemaVersion !== DOWNSTREAM_ARTIFACT_UPDATE_REVIEW_EVENT_SCHEMA_VERSION || event.actor !== 'user' || !validSeal(event)) return false;
    if (event.action === 'edited') {
        if (event.operation === 'remove') return event.editedContent === null && event.rationale.trim().length >= 3;
        return typeof event.editedContent === 'string' && event.editedContent.trim().length > 0 && event.rationale.trim().length >= 3;
    }
    if (event.action === 'provided_context') return event.context.trim().length >= 3;
    if (event.action === 'rejected' || event.action === 'preserved' || event.action === 'deferred' || event.action === 'requested_another') {
        return event.rationale.trim().length >= 3;
    }
    return true;
}

/** Editing may refine content, but it may not escalate a bounded proposal into
 * a more destructive or structurally broader operation. A removal may be
 * de-escalated to replacement so the user can preserve a revised region. */
export function downstreamArtifactUpdateReviewOperationCompatible(
    proposalOperation: DownstreamArtifactUpdateOperation,
    editedOperation: Exclude<DownstreamArtifactUpdateOperation, 'review_only'>,
): boolean {
    if (proposalOperation === 'review_only') return false;
    if (proposalOperation === 'remove') return editedOperation === 'remove' || editedOperation === 'replace';
    return editedOperation === proposalOperation;
}

export function sealDownstreamArtifactUpdateApplication(
    input: Omit<DownstreamArtifactUpdateApplication, 'integrityHash'>,
): DownstreamArtifactUpdateApplication {
    return seal<DownstreamArtifactUpdateApplication>(input);
}

export function validateDownstreamArtifactUpdateApplicationIntegrity(application: DownstreamArtifactUpdateApplication): boolean {
    const effectiveShapeValid = application.effectiveOperation === 'remove'
        ? application.effectiveContentHash === null
        : typeof application.effectiveContentHash === 'string' && application.effectiveContentHash.length > 0;
    return application.schemaVersion === DOWNSTREAM_ARTIFACT_UPDATE_APPLICATION_SCHEMA_VERSION
        && application.actor === 'system'
        && application.initiatedBy === 'user'
        && application.resultingArtifactVersionId !== application.expectedArtifactVersionId
        && effectiveShapeValid
        && validSeal(application);
}

export function sealDownstreamArtifactUpdateVerification(
    input: Omit<DownstreamArtifactUpdateVerification, 'integrityHash'>,
): DownstreamArtifactUpdateVerification {
    return seal<DownstreamArtifactUpdateVerification>(input);
}

export function validateDownstreamArtifactUpdateVerificationIntegrity(verification: DownstreamArtifactUpdateVerification): boolean {
    const subjectValid = !verification.subject || (
        verification.subject.planId.trim().length > 0
        && verification.subject.itemId.trim().length > 0
        && verification.subject.artifactId.trim().length > 0
        && verification.subject.targetArtifactVersionId === verification.verifiedArtifactVersionId
        && verification.subject.targetArtifactContentHash === verification.verifiedArtifactContentHash
        && (verification.subject.kind === 'manual_update'
            || Boolean(verification.subject.applicationId && verification.subject.applicationIntegrityHash))
    );
    return verification.schemaVersion === DOWNSTREAM_ARTIFACT_UPDATE_VERIFICATION_SCHEMA_VERSION
        && verification.authoredBy === 'synapse'
        && subjectValid
        && validSeal(verification);
}

export function sealDownstreamArtifactUpdateVerificationEvent(
    input: UnsealedVerificationEvent,
): DownstreamArtifactUpdateVerificationEvent {
    return seal<DownstreamArtifactUpdateVerificationEvent>(input);
}

export function validateDownstreamArtifactUpdateVerificationEventIntegrity(event: DownstreamArtifactUpdateVerificationEvent): boolean {
    const explanationValid = event.action === 'confirmed'
        || (event.action === 'provided_context' ? Boolean(event.context?.trim().length && event.context.trim().length >= 3) : Boolean(event.rationale?.trim().length && event.rationale.trim().length >= 3));
    return event.schemaVersion === DOWNSTREAM_ARTIFACT_UPDATE_VERIFICATION_EVENT_SCHEMA_VERSION
        && event.actor === 'user'
        && explanationValid
        && validSeal(event);
}

export function compareDownstreamArtifactUpdateProposalCurrentness(input: {
    proposal: DownstreamArtifactUpdateProposal;
    plan?: DownstreamUpdatePlan;
    planContext: DownstreamUpdatePlanCurrentContext;
    artifactVersion?: ArtifactVersion;
}): DownstreamArtifactUpdateProposalCurrentness {
    const reasons: DownstreamArtifactUpdateProposalCurrentnessReason[] = [];
    const { proposal, plan, planContext, artifactVersion } = input;
    if (!validateDownstreamArtifactUpdateProposalIntegrity(proposal)) reasons.push('proposal_tampered');
    if (!plan) reasons.push('plan_missing');
    else {
        if (!validateDownstreamUpdatePlanIntegrity(plan)) reasons.push('plan_tampered');
        if (plan.id !== proposal.updatePlanBinding.planId || plan.projectId !== proposal.projectId) reasons.push('plan_changed');
        if (plan.integrityHash !== proposal.updatePlanBinding.planIntegrityHash) reasons.push('plan_changed');
        if (hashReviewValue(plan.artifact) !== hashReviewValue(proposal.artifact)) reasons.push('plan_changed');
        const item = plan.items.find(candidate => candidate.id === proposal.updatePlanBinding.itemId);
        if (!item) reasons.push('item_missing');
        else if (downstreamUpdatePlanItemIntegrityHash(plan, item) !== proposal.updatePlanBinding.itemIntegrityHash
            || hashReviewValue(item.region) !== hashReviewValue(proposal.region)) reasons.push('item_changed');
        if (hashReviewValue(plan.source) !== hashReviewValue(proposal.source)) reasons.push('source_changed');
        const planCurrentness = compareDownstreamUpdatePlanCurrentness(plan, planContext);
        reasons.push(...planCurrentness.reasons);
    }
    if (!artifactVersion || artifactVersion.id !== proposal.artifact.artifactVersionId) {
        if (!reasons.includes('artifact_version_changed')) reasons.push('artifact_version_changed');
    } else {
        if (hashReviewValue(artifactVersion.content) !== proposal.artifact.artifactContentHash
            && !reasons.includes('artifact_content_changed')) reasons.push('artifact_content_changed');
        const region = resolveDownstreamUpdateRegionContent(artifactVersion, proposal.region);
        if (!region.found || !region.contentHash) reasons.push('region_missing');
        else if (region.contentHash !== proposal.currentRegionContentHash
            || region.snapshot !== proposal.currentRegionSnapshot
            || Boolean(region.snapshotTruncated) !== proposal.currentRegionSnapshotTruncated) reasons.push('region_content_changed');
        if (proposal.preservedRegionBindings.some(binding => {
            const preserved = resolveDownstreamUpdateRegionContent(artifactVersion, binding.region);
            return !preserved.found || preserved.contentHash !== binding.contentHash;
        })) reasons.push('preserved_region_changed');
    }
    return { current: reasons.length === 0, reasons: [...new Set(reasons)] };
}

export function latestDownstreamArtifactUpdateReview(
    proposal: DownstreamArtifactUpdateProposal,
    events: DownstreamArtifactUpdateReviewEvent[],
): DownstreamArtifactUpdateReviewEvent | undefined {
    return events.filter(event => event.proposalId === proposal.id
        && event.expectedProposalIntegrityHash === proposal.integrityHash
        && event.expectedPlanIntegrityHash === proposal.updatePlanBinding.planIntegrityHash
        && event.expectedItemIntegrityHash === proposal.updatePlanBinding.itemIntegrityHash
        && event.expectedRegionContentHash === proposal.currentRegionContentHash
        && validateDownstreamArtifactUpdateReviewEventIntegrity(event))
        .sort((a, b) => b.at - a.at || b.id.localeCompare(a.id))[0];
}

export function latestDownstreamArtifactUpdateVerificationReview(
    verification: DownstreamArtifactUpdateVerification,
    events: DownstreamArtifactUpdateVerificationEvent[],
): DownstreamArtifactUpdateVerificationEvent | undefined {
    return events.filter(event => event.verificationId === verification.id
        && event.expectedVerificationIntegrityHash === verification.integrityHash
        && validateDownstreamArtifactUpdateVerificationEventIntegrity(event))
        .sort((a, b) => b.at - a.at || b.id.localeCompare(a.id))[0];
}

export function effectiveDownstreamArtifactUpdate(
    proposal: DownstreamArtifactUpdateProposal,
    review: DownstreamArtifactUpdateReviewEvent,
): { operation: Exclude<DownstreamArtifactUpdateOperation, 'review_only'>; contentHash: string | null } | undefined {
    if (review.action === 'edited') {
        if (!downstreamArtifactUpdateReviewOperationCompatible(proposal.operation, review.operation)) return undefined;
        return {
            operation: review.operation,
            contentHash: review.editedContent === null ? null : hashReviewValue(review.editedContent),
        };
    }
    if (review.action !== 'accepted' || proposal.operation === 'review_only') return undefined;
    return {
        operation: proposal.operation,
        contentHash: proposal.proposedContent === null ? null : hashReviewValue(proposal.proposedContent),
    };
}

export function normalizeDownstreamArtifactUpdateProposalCollections(value: unknown): {
    proposals: Record<string, DownstreamArtifactUpdateProposal[]>;
    reviewEvents: Record<string, DownstreamArtifactUpdateReviewEvent[]>;
    applications: Record<string, DownstreamArtifactUpdateApplication[]>;
    verifications: Record<string, DownstreamArtifactUpdateVerification[]>;
    verificationEvents: Record<string, DownstreamArtifactUpdateVerificationEvent[]>;
} {
    const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const collection = <T>(key: string): Record<string, T[]> => raw[key] && typeof raw[key] === 'object'
        ? raw[key] as Record<string, T[]>
        : {};
    return {
        proposals: collection<DownstreamArtifactUpdateProposal>('downstreamArtifactUpdateProposals'),
        reviewEvents: collection<DownstreamArtifactUpdateReviewEvent>('downstreamArtifactUpdateReviewEvents'),
        applications: collection<DownstreamArtifactUpdateApplication>('downstreamArtifactUpdateApplications'),
        verifications: collection<DownstreamArtifactUpdateVerification>('downstreamArtifactUpdateVerifications'),
        verificationEvents: collection<DownstreamArtifactUpdateVerificationEvent>('downstreamArtifactUpdateVerificationEvents'),
    };
}
