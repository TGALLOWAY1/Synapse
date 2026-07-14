import type {
    AlignmentProposal,
    ArtifactSlotKey,
    DecisionEvent,
    DecisionAssessment,
    DecisionImpactPreview,
    PlanningLocation,
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

export type AlignmentProposalReview = {
    proposal: AlignmentProposal;
    disposition: 'pending' | 'accepted' | 'rejected' | 'edited' | 'deferred';
    editedValue?: unknown;
    editedSummary?: string;
};

const sectionLocation = (section: string): PlanningLocation => ({
    kind: 'section',
    section,
    label: section,
});

function preciseLocations(record: PlanningRecord): PlanningLocation[] {
    const locations: PlanningLocation[] = [...(record.affectedPlanLocations ?? [])];
    for (const evidence of record.evidence) {
        const locator = evidence.locator;
        if (!locator?.section) continue;
        locations.push({
            kind: locator.entityType === 'feature' ? 'feature' : 'claim',
            section: locator.section,
            label: locator.entityId ? `${locator.entityType ?? 'Item'} ${locator.entityId}` : evidence.excerpt ?? locator.section,
            jsonPath: locator.jsonPath,
            entityType: locator.entityType,
            entityId: locator.entityId,
            excerpt: evidence.excerpt,
        });
    }
    for (const featureId of record.affectedFeatureIds ?? []) {
        locations.push({ kind: 'feature', section: 'Features', label: `Feature ${featureId}`, entityType: 'feature', entityId: featureId });
    }
    if (locations.length === 0) locations.push(...(record.affectedPrdSections ?? []).map(sectionLocation));
    const seen = new Set<string>();
    return locations.filter(location => {
        const key = `${location.kind}:${location.section}:${location.jsonPath ?? ''}:${location.entityType ?? ''}:${location.entityId ?? ''}:${location.label}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export function alignmentProposalReviews(record: PlanningRecord, preview: DecisionImpactPreview): AlignmentProposalReview[] {
    const latest = new Map<string, Extract<DecisionEvent, { type: 'alignment_change_reviewed' }>>();
    for (const event of record.events ?? []) {
        if (event.type === 'alignment_change_reviewed' && event.impactPreviewId === preview.id) latest.set(event.proposalId, event);
    }
    return (preview.alignmentProposals ?? []).map(proposal => {
        const event = latest.get(proposal.id);
        return {
            proposal,
            disposition: event?.disposition ?? 'pending',
            editedValue: event?.editedValue,
            editedSummary: event?.editedSummary,
        };
    });
}

export function alignmentProposalNeedsResolution(
    review: AlignmentProposalReview,
    acceptedChangesApplied: boolean,
): boolean {
    if (review.disposition === 'pending' || review.disposition === 'deferred') return true;
    if (review.disposition === 'accepted' || review.disposition === 'edited') return !acceptedChangesApplied;
    return review.disposition === 'rejected' && review.proposal.requiredForVerdictAlignment === true;
}

function patchPrd(prd: StructuredPRD, patch: NonNullable<DecisionImpactPreview['proposedPrdPatch']>[number], value: unknown): StructuredPRD | undefined {
    if (patch.section === 'assumptions' && patch.entityId) {
        const assumptions = prd.assumptions ?? [];
        if (!assumptions.some(item => item.id === patch.entityId) || typeof value !== 'object' || !value) return undefined;
        return { ...prd, assumptions: assumptions.map(item => item.id === patch.entityId ? value as typeof item : item) };
    }
    const jsonPath = patch.jsonPath;
    if (!jsonPath?.startsWith('$.')) return undefined;
    if (patch.entityId && jsonPath.startsWith('$.features.')) {
        const field = jsonPath.slice('$.features.'.length) as keyof StructuredPRD['features'][number];
        const index = prd.features.findIndex(feature => feature.id === patch.entityId);
        if (index < 0 || !field || field === 'id') return undefined;
        return {
            ...prd,
            features: prd.features.map((feature, featureIndex) => featureIndex === index ? { ...feature, [field]: value } : feature),
        };
    }
    const key = jsonPath.slice(2) as keyof StructuredPRD;
    if (!key || key.includes('.') || !(key in prd)) return undefined;
    return { ...prd, [key]: value };
}

export function buildReviewedDecisionImpact(input: {
    record: PlanningRecord;
    preview: DecisionImpactPreview;
    structuredPRD: StructuredPRD;
}): { nextPrd?: StructuredPRD; acceptedProposalIds: string[]; pendingCount: number; deferredCount: number } {
    const reviews = alignmentProposalReviews(input.record, input.preview);
    let nextPrd = input.structuredPRD;
    const acceptedProposalIds: string[] = [];
    for (const review of reviews) {
        if (review.proposal.requiresInput || !['accepted', 'edited'].includes(review.disposition)) continue;
        const patch = input.preview.proposedPrdPatch?.find(item => item.proposalId === review.proposal.id);
        if (!patch) continue;
        let value = review.disposition === 'edited' ? review.editedValue : patch.value;
        if (patch.section === 'assumptions' && typeof review.editedValue === 'string' && typeof patch.value === 'object' && patch.value) {
            value = { ...(patch.value as Record<string, unknown>), decisionNote: review.editedValue };
        } else if (review.disposition === 'edited' && typeof review.editedValue === 'string' && Array.isArray(patch.value)) {
            value = [review.editedValue];
        }
        const patched = patchPrd(nextPrd, patch, value);
        if (!patched) continue;
        nextPrd = patched;
        acceptedProposalIds.push(review.proposal.id);
    }
    return {
        nextPrd: acceptedProposalIds.length > 0 ? nextPrd : undefined,
        acceptedProposalIds,
        pendingCount: reviews.filter(review => review.disposition === 'pending').length,
        deferredCount: reviews.filter(review => review.disposition === 'deferred').length,
    };
}

/** After a partial apply, rebase only the unresolved review targets onto the
 * newly-created PRD version. This keeps deferred work actionable without
 * asking the user to re-review changes that were already applied or dismissed. */
export function buildResidualDecisionImpact(input: {
    record: PlanningRecord;
    preview: DecisionImpactPreview;
    structuredPRD: StructuredPRD;
    baselineSpineVersionId: string;
    now?: () => number;
}): { assessment: DecisionAssessment; preview: DecisionImpactPreview } | undefined {
    const unresolved = alignmentProposalReviews(input.record, input.preview)
        .filter(review => alignmentProposalNeedsResolution(review, true));
    if (unresolved.length === 0) return undefined;

    const createdAt = input.now?.() ?? Date.now();
    const id = `impact-${input.record.id}-${planningContentHash(`${input.baselineSpineVersionId}:${input.preview.decisionEventId}:residual:${input.preview.id}`)}`;
    let proposedPrd = input.structuredPRD;
    const proposedPrdPatch: NonNullable<DecisionImpactPreview['proposedPrdPatch']> = [];
    const alignmentProposals: AlignmentProposal[] = unresolved.map((review, index) => {
        const proposalId = `${id}-change-${index + 1}`;
        const oldPatch = input.preview.proposedPrdPatch?.find(patch => patch.proposalId === review.proposal.id);
        if (!oldPatch) return { ...review.proposal, id: proposalId };
        const rebasedPatch = { ...oldPatch, proposalId };
        const next = patchPrd(proposedPrd, rebasedPatch, rebasedPatch.value);
        if (!next) return {
            ...review.proposal,
            id: proposalId,
            operation: 'review',
            requiresInput: true,
            reason: `${review.proposal.reason} The plan changed during partial apply, so Synapse can no longer propose this edit safely.`,
        };
        proposedPrd = next;
        proposedPrdPatch.push(rebasedPatch);
        return { ...review.proposal, id: proposalId };
    });
    const preview: DecisionImpactPreview = {
        ...input.preview,
        id,
        status: 'ready',
        baseline: {
            spineVersionId: input.baselineSpineVersionId,
            spineContentHash: planningContentHash(input.structuredPRD),
        },
        proposedPrdPatch: proposedPrdPatch.length > 0 ? proposedPrdPatch : undefined,
        proposedResultHash: proposedPrdPatch.length > 0 ? planningContentHash(proposedPrd) : undefined,
        alignmentProposals,
        explanation: 'Some alignment work remains after the accepted changes were applied. Review these remaining targets against the updated working plan.',
        createdAt,
        appliedAt: undefined,
        resultingSpineVersionId: undefined,
    };
    return {
        preview,
        assessment: {
            id: `assessment-${id}`,
            projectId: input.record.projectId,
            planningRecordId: input.record.id,
            sourceSpineVersionId: input.baselineSpineVersionId,
            status: 'fresh',
            recommendation: input.record.recommendationDetail,
            evidence: input.record.evidence,
            inferredAssumptions: [],
            possibleConflictRecordIds: preview.possibleConflictRecordIds,
            impactPreview: preview,
            createdAt,
        },
    };
}

function linkedArtifactSlots(record: PlanningRecord): ArtifactSlotKey[] {
    const graph = buildArtifactDependencyGraph();
    const order = graph.nodes.map(node => node.id);
    const seeds = new Set<DependencyNodeId>();
    const explicitSlots = record.affectedArtifactSlots ?? [];
    if (explicitSlots.length > 0) {
        // Recognition already calculated the meaningful downstream set. Treat
        // it as authoritative output precision, not as graph seeds that should
        // fan back out into unrelated artifacts.
        const explicit = new Set(explicitSlots);
        return order.filter((id): id is ArtifactSlotKey => id !== 'prd' && explicit.has(id as ArtifactSlotKey));
    } else {
        if (record.evidence.some(evidence => evidence.sourceType === 'spine')
            || record.sources?.some(source => source.sourceType === 'prd' || source.sourceType === 'prd_assumption')) {
            seeds.add('prd');
        }
        for (const subtype of record.evidence.flatMap(evidence => evidence.artifactSubtype ? [evidence.artifactSubtype] : [])) seeds.add(subtype);
        for (const subtype of (record.sources ?? []).flatMap(source => source.artifactSubtype ? [source.artifactSubtype] : [])) seeds.add(subtype);
    }

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
        const directEditSourceLocators = input.record.resultingSpineVersionId === input.baselineSpineVersionId
            ? (input.record.sources ?? [])
                .filter(source => source.key.startsWith('prd_edit:'))
                .flatMap(source => source.locator ? [source.locator] : [])
            : [];
        const locations = preciseLocations(input.record).filter(location => !directEditSourceLocators.some(locator => (
            location.jsonPath === locator.jsonPath
            && (!locator.entityId || location.entityId === locator.entityId)
        )));
        const explicitHints = input.record.alignmentHints ?? [];
        // Source and affected locators prove traceability, not the replacement
        // value. Only an explicit alignment hint may authorize a deterministic
        // general-decision patch; every generic locator remains review-only.
        const hintLocations = explicitHints;
        const previewId = `impact-${input.record.id}-${planningContentHash(`${input.baselineSpineVersionId}:${projection.latestVerdictEventId}`)}`;
        const alignmentProposals: AlignmentProposal[] = hintLocations.map((hint, index) => ({
            id: `${previewId}-change-${index + 1}`,
            target: hint.target,
            operation: hint.operation,
            proposedSummary: hint.proposedSummary,
            proposedValue: hint.proposedValue,
            reason: hint.reason,
            confidence: hint.confidence ?? 'likely',
            requiredForVerdictAlignment: hint.requiredForVerdictAlignment ?? true,
        }));
        const hintedTargets = new Set(hintLocations.map(hint => stablePlanningStringify(hint.target)));
        for (const location of locations) {
            if (hintedTargets.has(stablePlanningStringify(location))) continue;
            alignmentProposals.push({
                id: `${previewId}-review-${alignmentProposals.length + 1}`,
                target: location,
                operation: 'review',
                beforeSummary: location.excerpt,
                reason: 'This content may depend on the decision, but Synapse needs additional input before proposing a safe rewrite.',
                confidence: 'possible',
                requiresInput: true,
            });
        }
        if (alignmentProposals.length === 0) alignmentProposals.push({
            id: `${previewId}-review-1`,
            target: sectionLocation('Working plan'),
            operation: 'review',
            reason: 'The decision is recorded, but no precise plan dependency has been established yet.',
            confidence: 'possible',
            requiresInput: true,
        });
        const proposedPrdPatch = alignmentProposals.flatMap(proposal => {
            const hint = hintLocations.find(item => stablePlanningStringify(item.target) === stablePlanningStringify(proposal.target));
            if (!hint?.target.jsonPath || proposal.requiresInput) return [];
            return [{
                proposalId: proposal.id,
                section: hint.target.section,
                operation: hint.operation,
                entityId: hint.target.entityId,
                jsonPath: hint.target.jsonPath,
                beforeSummary: hint.target.excerpt,
                afterSummary: hint.proposedSummary,
                value: hint.proposedValue,
            }];
        });
        let proposedPrd = input.structuredPRD;
        let patchable = proposedPrdPatch.length > 0;
        for (const patch of proposedPrdPatch) {
            const next = patchPrd(proposedPrd, patch, patch.value);
            if (!next) { patchable = false; break; }
            proposedPrd = next;
        }
        const affectedPrdSections = [...new Set(alignmentProposals.map(proposal => proposal.target.section).filter(section => section !== 'Working plan'))];
        const preview: DecisionImpactPreview = {
            id: previewId,
            projectId: input.projectId,
            planningRecordId: input.record.id,
            decisionEventId: projection.latestVerdictEventId,
            status: 'ready',
            baseline: {
                spineVersionId: input.baselineSpineVersionId,
                spineContentHash: planningContentHash(input.structuredPRD),
            },
            proposedPrdPatch: proposedPrdPatch.length > 0 ? proposedPrdPatch : undefined,
            proposedResultHash: patchable ? planningContentHash(proposedPrd) : undefined,
            affectedPrdSections,
            alignmentProposals,
            affectedArtifactSlots: linkedArtifactSlots(input.record),
            possibleConflictRecordIds: input.record.relatedPlanningRecordIds ?? [],
            explanation: patchable
                ? 'Review each proposed alignment change. Nothing changes until you accept or edit a proposal and explicitly apply it to a fresh working-plan version.'
                : 'The decision is recorded, but these targets need more context before Synapse can propose a safe rewrite. Synapse will not offer Apply to plan, and the unresolved alignment remains visible.',
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
        return { ok: true, assessment, preview, ...(patchable ? { nextPrd: proposedPrd } : {}) };
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
    const affectedPrdSections = [...new Set(['Assumptions', ...(input.record.affectedPrdSections ?? [])])];
    const sourceTarget: PlanningLocation = {
        kind: 'claim', section: 'Assumptions', label: sourceAssumption.statement,
        jsonPath: '$.assumptions', entityType: 'assumption', entityId: sourceAssumption.id,
        excerpt: sourceAssumption.statement,
    };
    const sourceProposalId = `${id}-change-1`;
    const secondaryLocations = preciseLocations(input.record).filter(location =>
        !(location.entityType === 'assumption' && location.entityId === sourceAssumption.id),
    );
    const alignmentProposals: AlignmentProposal[] = [{
        id: sourceProposalId,
        target: sourceTarget,
        operation: 'replace',
        beforeSummary: sourceAssumption.statement,
        proposedSummary: projection.status === 'rejected'
            ? `Record as rejected${projection.answer ? ` — ${projection.answer}` : ''}`
            : `Record as confirmed${projection.answer && projection.answer !== sourceAssumption.statement ? ` — ${projection.answer}` : ''}`,
        proposedValue: nextAssumption,
        reason: 'The durable user verdict should be represented on its source assumption in the working plan.',
        confidence: 'definite',
        requiredForVerdictAlignment: true,
    }, ...secondaryLocations.map((location, index): AlignmentProposal => ({
        id: `${id}-review-${index + 1}`,
        target: location,
        operation: 'review',
        beforeSummary: location.excerpt,
        reason: 'This content may depend on the decision and should be checked before the plan is considered aligned.',
        confidence: 'possible',
        requiresInput: true,
    }))];
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
            proposalId: sourceProposalId,
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
        affectedPrdSections,
        alignmentProposals,
        affectedArtifactSlots: input.record.affectedArtifactSlots?.length
            ? linkedArtifactSlots(input.record)
            : artifactSlotsDependingOnPrd(),
        possibleConflictRecordIds: input.record.relatedPlanningRecordIds ?? [],
        explanation: 'Review the exact source update and every dependent target. Accepted changes create a new PRD version; rejected or deferred changes do not alter the decision, and existing assets are never silently rewritten.',
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
