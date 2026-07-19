import type { ArtifactVersion, StructuredImplementationPlan } from '../../types';
import { extractStructuredPlan } from '../services/implementationPlanParser';
import { hashReviewValue } from '../review/hash';
import {
    downstreamUpdatePlanItemIntegrityHash,
    downstreamUpdateRegionKey,
    resolveDownstreamUpdateRegionContent,
    sealDownstreamArtifactUpdateProposal,
    type DownstreamArtifactUpdateOperation,
    type DownstreamArtifactUpdateProposal,
    type DownstreamArtifactUpdateReviewEvent,
} from './downstreamArtifactUpdateProposal';
import { removedDownstreamUpdateRegionHash } from './screenFlowArtifactUpdates';
import type { DownstreamUpdatePlan, DownstreamUpdatePlanItem, DownstreamUpdateRegion } from './downstreamUpdatePlan';

type ArchitectureRegion = Extract<DownstreamUpdateRegion, { kind: 'implementation_plan'; section: 'architecture' }>;
type DeliveryRegion = Extract<DownstreamUpdateRegion, { kind: 'implementation_plan'; section: 'delivery' }>;

export type UserGroundedImplementationPlanChange = {
    operation: 'replace' | 'add';
    value: unknown;
    collection?: DeliveryRegion['collection'];
};

type ProposalInput = {
    projectId: string;
    plan: DownstreamUpdatePlan;
    item: DownstreamUpdatePlanItem;
    artifactVersion: ArtifactVersion;
    createdAt?: number;
    requestNonce?: string;
    userGroundedReplacement?: string;
    userGroundedChange?: UserGroundedImplementationPlanChange;
};

export type ImplementationPlanProposalResult =
    | { ok: true; proposal: DownstreamArtifactUpdateProposal }
    | { ok: false; reason: 'unsupported_artifact' | 'region_missing' | 'binding_mismatch' };

const STRUCTURED_PLAN_FENCE = /(```json\s+synapse-plan\s*\n)([\s\S]*?)(\n```)/;

export function parseUserGroundedImplementationPlanReplacement(context: string): string | undefined {
    const match = context.trim().match(/^replace\s*:\s*([\s\S]+)$/i);
    return match?.[1]?.trim() || undefined;
}

export function parseUserGroundedImplementationPlanChange(context: string): UserGroundedImplementationPlanChange | undefined {
    const match = context.trim().match(/^(replace|add)\s*:\s*(\{[\s\S]+\})$/i);
    if (!match) return undefined;
    try {
        const parsed = JSON.parse(match[2]) as { value?: unknown; collection?: unknown };
        if (!Object.prototype.hasOwnProperty.call(parsed, 'value')) return undefined;
        if (match[1].toLowerCase() === 'add' && typeof parsed.collection !== 'string') return undefined;
        return {
            operation: match[1].toLowerCase() as 'replace' | 'add',
            value: parsed.value,
            ...(typeof parsed.collection === 'string' ? { collection: parsed.collection as DeliveryRegion['collection'] } : {}),
        };
    } catch {
        return undefined;
    }
}

function exactPlanRemoval(plan: DownstreamUpdatePlan, item: DownstreamUpdatePlanItem): boolean {
    return plan.source.confirmed
        && item.region.kind === 'implementation_plan'
        && item.certainty === 'definite'
        && item.evidence.some(evidence => evidence.kind === 'structured_trace' && evidence.quality === 'direct')
        && (item.recommendedAction === 'review_architecture' || item.recommendedAction === 'review_implementation_plan');
}

function preservedBindings(
    version: ArtifactVersion,
    target: ArchitectureRegion | DeliveryRegion,
): DownstreamArtifactUpdateProposal['preservedRegionBindings'] {
    const plan = extractStructuredPlan(version.content);
    if (!plan) return [];
    const regions: DownstreamUpdateRegion[] = [];
    for (const [entryIndex, entry] of (plan.architecture ?? []).entries()) {
        if (target.section === 'architecture' && entryIndex === target.entryIndex) continue;
        const region: ArchitectureRegion = {
            kind: 'implementation_plan', section: 'architecture', aspect: 'decision',
            entryIndex, entryLabel: entry, label: entry,
        };
        regions.push(region);
    }
    for (const [entryIndex, milestone] of plan.milestones.entries()) {
        if (target.section === 'delivery' && target.milestoneId === milestone.id) continue;
        regions.push({
            kind: 'implementation_plan', section: 'delivery', aspect: 'milestone', collection: 'milestones',
            milestoneId: milestone.id, entryIndex, entryLabel: milestone.name, label: milestone.name,
        });
    }
    if (target.section === 'delivery' && target.milestoneId) {
        const milestone = plan.milestones.find(candidate => candidate.id === target.milestoneId);
        const siblings: Array<{ value: unknown; label: string; region: DeliveryRegion }> = [];
        if (milestone && target.collection === 'tasks') milestone.tasks.forEach((task, entryIndex) => siblings.push({
            value: task, label: task.title, region: { ...target, entryIndex, taskId: task.id, entryLabel: task.title, label: task.title },
        }));
        if (milestone && target.collection === 'dependencies') (milestone.dependencies ?? []).forEach((value, entryIndex) => siblings.push({
            value, label: value, region: { ...target, entryIndex, entryLabel: value, label: value },
        }));
        if (milestone && target.collection === 'definition_of_done') (milestone.definitionOfDone ?? []).forEach((value, entryIndex) => siblings.push({
            value, label: value, region: { ...target, entryIndex, entryLabel: value, label: value },
        }));
        siblings.filter(candidate => candidate.region.entryIndex !== target.entryIndex).forEach(candidate => regions.push(candidate.region));
    }
    return regions.flatMap(region => {
        const content = resolveDownstreamUpdateRegionContent(version, region);
        return content.found && content.contentHash ? [{
            region, regionKey: downstreamUpdateRegionKey(region), contentHash: content.contentHash,
        }] : [];
    });
}

const deliveryValueLabel = (collection: DeliveryRegion['collection'], value: unknown): string | undefined => {
    if (typeof value === 'string') return value.trim() || undefined;
    if (!value || typeof value !== 'object') return undefined;
    const record = value as Record<string, unknown>;
    if (collection === 'milestones') return typeof record.name === 'string' ? record.name : undefined;
    if (collection === 'tasks' || collection === 'quality_gates') return typeof record.title === 'string' ? record.title : undefined;
    if (collection === 'risks') return typeof record.description === 'string' ? record.description : undefined;
    return undefined;
};

const deliveryValueValid = (collection: DeliveryRegion['collection'], value: unknown): boolean => {
    const label = deliveryValueLabel(collection, value);
    if (!label) return false;
    if (collection === 'milestones') {
        const record = value as Record<string, unknown>;
        return typeof record.id === 'string' && Array.isArray(record.tasks);
    }
    if (collection === 'tasks') {
        const record = value as Record<string, unknown>;
        return typeof record.id === 'string' && typeof record.status === 'string';
    }
    if (collection === 'quality_gates') {
        const record = value as Record<string, unknown>;
        return typeof record.id === 'string' && typeof record.category === 'string' && typeof record.required === 'boolean';
    }
    return true;
};

function deliveryArray(plan: StructuredImplementationPlan, region: DeliveryRegion): unknown[] | undefined {
    const milestone = region.milestoneId ? plan.milestones.find(candidate => candidate.id === region.milestoneId) : undefined;
    if (region.collection === 'milestones') return plan.milestones;
    if (region.collection === 'tasks') return milestone?.tasks;
    if (region.collection === 'dependencies') return milestone?.dependencies;
    if (region.collection === 'definition_of_done') return milestone ? milestone.definitionOfDone : plan.definitionOfDone;
    if (region.collection === 'prompt_acceptance_criteria') {
        return milestone?.promptPacks?.find(candidate => candidate.id === region.promptPackId)?.acceptanceCriteria;
    }
    if (region.collection === 'risks') return plan.risks;
    if (region.collection === 'critical_path') return plan.summary?.criticalPath;
    if (region.collection === 'validation_commands') return milestone?.validationCommands;
    return milestone ? milestone.qualityGates : plan.globalQualityGates;
}

function addedDeliveryRegion(
    plan: StructuredImplementationPlan,
    target: DeliveryRegion,
    change: UserGroundedImplementationPlanChange,
): DeliveryRegion | undefined {
    if (change.operation !== 'add' || !change.collection || !deliveryValueValid(change.collection, change.value)) return undefined;
    if (['milestones'].includes(change.collection)) return undefined;
    const region: DeliveryRegion = { ...target, collection: change.collection, entryIndex: 0, entryLabel: '', label: '' };
    if (change.collection === 'risks' || change.collection === 'critical_path' || (!target.milestoneId && change.collection === 'quality_gates')) {
        delete region.milestoneId;
        delete region.taskId;
        delete region.promptPackId;
    } else if (!target.milestoneId) return undefined;
    if (change.collection === 'prompt_acceptance_criteria' && !target.promptPackId) return undefined;
    const values = deliveryArray(plan, region) ?? [];
    const label = deliveryValueLabel(change.collection, change.value);
    if (!label || values.some(value => deliveryValueLabel(change.collection!, value) === label)) return undefined;
    region.entryIndex = values.length;
    region.entryLabel = label;
    region.label = label;
    region.aspect = change.collection === 'tasks'
        ? (/security|auth|migration|api|prerequisite|schema/i.test(JSON.stringify(change.value)) ? 'technical_prerequisite' : 'task')
        : change.collection === 'dependencies' ? 'technical_prerequisite'
            : change.collection === 'definition_of_done' || change.collection === 'prompt_acceptance_criteria' ? 'acceptance_criterion'
                : change.collection === 'risks' ? 'risk'
                    : change.collection === 'critical_path' ? 'sequencing_assumption'
                        : 'testing_requirement';
    if (change.collection === 'tasks') region.taskId = (change.value as { id: string }).id;
    if (change.collection === 'quality_gates') region.qualityGateId = (change.value as { id: string }).id;
    return region;
}

function ensureDeliveryArray(plan: StructuredImplementationPlan, region: DeliveryRegion): unknown[] | undefined {
    const existing = deliveryArray(plan, region);
    if (existing) return existing;
    const milestone = region.milestoneId ? plan.milestones.find(candidate => candidate.id === region.milestoneId) : undefined;
    if (region.collection === 'dependencies' && milestone) return (milestone.dependencies = []);
    if (region.collection === 'definition_of_done') {
        if (milestone) return (milestone.definitionOfDone = []);
        return (plan.definitionOfDone = []);
    }
    if (region.collection === 'risks') return (plan.risks = []);
    if (region.collection === 'critical_path') {
        plan.summary ??= {};
        return (plan.summary.criticalPath = []);
    }
    if (region.collection === 'validation_commands' && milestone) return (milestone.validationCommands = []);
    if (region.collection === 'quality_gates') {
        if (milestone) return (milestone.qualityGates = []);
        return (plan.globalQualityGates = []);
    }
    return undefined;
}

function parsedDeliveryProposal(content: string | null, operation: 'replace' | 'add'): UserGroundedImplementationPlanChange | undefined {
    if (!content) return undefined;
    try {
        const value = JSON.parse(content) as UserGroundedImplementationPlanChange;
        return value?.operation === operation && Object.prototype.hasOwnProperty.call(value, 'value') ? value : undefined;
    } catch {
        return undefined;
    }
}

function replacementDeliveryRegion(target: DeliveryRegion, value: unknown): DeliveryRegion | undefined {
    if (!deliveryValueValid(target.collection, value)) return undefined;
    const label = deliveryValueLabel(target.collection, value);
    if (!label) return undefined;
    return {
        ...target,
        entryLabel: label,
        label,
        ...(target.collection === 'milestones' ? { milestoneId: (value as { id: string }).id } : {}),
        ...(target.collection === 'tasks' ? { taskId: (value as { id: string }).id } : {}),
        ...(target.collection === 'quality_gates' ? { qualityGateId: (value as { id: string }).id } : {}),
    };
}

function removalHasInboundDependency(plan: StructuredImplementationPlan | null, region: ArchitectureRegion | DeliveryRegion): boolean {
    if (!plan || region.section !== 'delivery') return false;
    if (region.collection === 'milestones' && region.milestoneId) {
        return plan.milestones.some(milestone => milestone.id !== region.milestoneId
            && (milestone.dependencies ?? []).includes(region.milestoneId!));
    }
    if (region.collection === 'tasks' && region.taskId) {
        return plan.milestones.some(milestone => milestone.tasks.some(task => task.id !== region.taskId
            && (task.dependencies ?? []).includes(region.taskId!)));
    }
    return false;
}

export function deriveImplementationPlanArtifactUpdateProposal(input: ProposalInput): ImplementationPlanProposalResult {
    const { plan, item, artifactVersion } = input;
    if (plan.projectId !== input.projectId || plan.artifact.artifactVersionId !== artifactVersion.id
        || !plan.items.some(candidate => candidate.id === item.id)) return { ok: false, reason: 'binding_mismatch' };
    if (plan.artifact.slot !== 'implementation_plan' || item.region.kind !== 'implementation_plan') {
        return { ok: false, reason: 'unsupported_artifact' };
    }
    const region = resolveDownstreamUpdateRegionContent(artifactVersion, item.region);
    if (!region.found || !region.contentHash || region.snapshot === undefined) return { ok: false, reason: 'region_missing' };

    const structuredPlan = extractStructuredPlan(artifactVersion.content);
    const removalBlocked = removalHasInboundDependency(structuredPlan, item.region);
    const remove = exactPlanRemoval(plan, item) && !removalBlocked;
    const architectureReplacement = item.region.section === 'architecture' ? input.userGroundedReplacement?.trim() : undefined;
    const deliveryRegion = item.region.section === 'delivery' ? item.region : undefined;
    const deliveryChange = deliveryRegion ? input.userGroundedChange : undefined;
    const deliveryResult = structuredPlan && deliveryChange && deliveryRegion
        ? deliveryChange.operation === 'replace'
            ? (!deliveryChange.collection || deliveryChange.collection === deliveryRegion.collection
                ? replacementDeliveryRegion(deliveryRegion, deliveryChange.value)
                : undefined)
            : addedDeliveryRegion(structuredPlan, deliveryRegion, deliveryChange)
        : undefined;
    const groundedChange = Boolean(architectureReplacement || deliveryResult);
    const operation: DownstreamArtifactUpdateOperation = groundedChange
        ? deliveryChange?.operation ?? 'replace'
        : remove ? 'remove' : 'review_only';
    const proposedContent = architectureReplacement
        ?? (deliveryResult && deliveryChange ? JSON.stringify(deliveryChange) : null);
    const resultingRegion: ArchitectureRegion | DeliveryRegion | undefined = architectureReplacement && item.region.section === 'architecture'
        ? { ...item.region, entryLabel: architectureReplacement, label: architectureReplacement }
        : deliveryResult;
    const createdAt = input.createdAt ?? Date.now();
    const requestNonce = input.requestNonce ?? 'initial';
    return { ok: true, proposal: sealDownstreamArtifactUpdateProposal({
        schemaVersion: 1,
        id: `artifact-update-${hashReviewValue({ plan: plan.id, item: item.id, region: region.contentHash, requestNonce, createdAt })}`,
        projectId: input.projectId,
        authoredBy: 'synapse',
        updatePlanBinding: {
            planId: plan.id,
            planIntegrityHash: plan.integrityHash,
            itemId: item.id,
            itemIntegrityHash: downstreamUpdatePlanItemIntegrityHash(plan, item),
        },
        source: plan.source,
        artifact: plan.artifact,
        region: item.region,
        regionKey: downstreamUpdateRegionKey(item.region),
        ...(resultingRegion ? { resultingRegion } : {}),
        currentRegionContentHash: region.contentHash,
        currentRegionSnapshot: region.snapshot,
        currentRegionSnapshotTruncated: Boolean(region.snapshotTruncated),
        operation,
        proposedContent,
        evidence: item.evidence,
        reasoning: groundedChange
            ? `The ${operation} is bounded to an exact structured plan entry and comes from explicit context supplied by the user.`
            : remove
                ? 'The confirmed removal and explicit feature trace support deleting only this exact structured plan entry.'
                : removalBlocked
                    ? 'This exact entry has an inbound milestone or task dependency. Review the dependent entry before removing it.'
                : item.region.section === 'architecture'
                    ? 'The architecture reference is relevant, but it does not prove a safe exact edit. Review this entry or provide an explicit `replace:` instruction.'
                    : 'The delivery-plan reference is relevant, but it does not prove a safe exact edit. Review this entry or provide explicit structured `replace:` or `add:` context.',
        certainty: item.certainty,
        ...(item.ambiguity ? { ambiguity: item.ambiguity } : {}),
        preservedScope: item.preservedScope,
        preservedScopeHash: hashReviewValue(item.preservedScope),
        preservedRegionBindings: preservedBindings(artifactVersion, item.region),
        generator: {
            provider: 'synapse', model: 'bounded-structural-planner',
            promptHash: hashReviewValue({ plan: plan.integrityHash, item, requestNonce, architectureReplacement, deliveryChange }),
            reasoningVersion: item.region.section === 'architecture' ? 'phase-5-architecture-v1' : 'phase-5-implementation-plan-v1',
        },
        createdAt,
    }) };
}

function replaceStructuredPlanFence(content: string, plan: StructuredImplementationPlan): string | undefined {
    const match = STRUCTURED_PLAN_FENCE.exec(content);
    if (!match || match.index === undefined) return undefined;
    const replacement = `${match[1]}${JSON.stringify(plan, null, 2)}${match[3]}`;
    return content.slice(0, match.index) + replacement + content.slice(match.index + match[0].length);
}

export function applyImplementationPlanArtifactUpdate(input: {
    proposal: DownstreamArtifactUpdateProposal;
    review: DownstreamArtifactUpdateReviewEvent;
    artifactVersion: ArtifactVersion;
}):
    | { ok: true; content: string; resultingRegionContentHash: string }
    | { ok: false; reason: 'unsupported_region' | 'invalid_content' | 'target_missing' | 'no_change' } {
    const { proposal, review, artifactVersion } = input;
    if (proposal.artifact.slot !== 'implementation_plan' || proposal.region.kind !== 'implementation_plan') {
        return { ok: false, reason: 'unsupported_region' };
    }
    const operation = review.action === 'edited' ? review.operation
        : review.action === 'accepted' && proposal.operation !== 'review_only' ? proposal.operation
            : undefined;
    const proposedContent = review.action === 'edited' ? review.editedContent : proposal.proposedContent;
    if (!operation || !['remove', 'replace', 'add'].includes(operation)) return { ok: false, reason: 'unsupported_region' };
    const boundedOperation = operation as 'remove' | 'replace' | 'add';
    const plan = extractStructuredPlan(artifactVersion.content);
    if (!plan) return { ok: false, reason: 'target_missing' };
    const baseline = resolveDownstreamUpdateRegionContent(artifactVersion, proposal.region);
    if (!baseline.found || baseline.contentHash !== proposal.currentRegionContentHash) {
        return { ok: false, reason: 'target_missing' };
    }
    const nextPlan = JSON.parse(JSON.stringify(plan)) as StructuredImplementationPlan;
    if (proposal.region.section === 'architecture') {
        if (boundedOperation === 'add' || !nextPlan.architecture
            || nextPlan.architecture[proposal.region.entryIndex] !== proposal.region.entryLabel) {
            return { ok: false, reason: 'unsupported_region' };
        }
        if (boundedOperation === 'remove') nextPlan.architecture.splice(proposal.region.entryIndex, 1);
        else {
            if (!proposedContent?.trim()) return { ok: false, reason: 'invalid_content' };
            nextPlan.architecture[proposal.region.entryIndex] = proposedContent.trim();
        }
    } else {
        const change = boundedOperation === 'remove' ? undefined : parsedDeliveryProposal(proposedContent, boundedOperation);
        if (boundedOperation !== 'remove' && !change) return { ok: false, reason: 'invalid_content' };
        const targetRegion = boundedOperation === 'add'
            ? proposal.resultingRegion?.kind === 'implementation_plan' && proposal.resultingRegion.section === 'delivery'
                ? proposal.resultingRegion : undefined
            : proposal.region;
        if (!targetRegion) return { ok: false, reason: 'invalid_content' };
        if (change && !deliveryValueValid(targetRegion.collection, change.value)) return { ok: false, reason: 'invalid_content' };
        const values = boundedOperation === 'add' ? ensureDeliveryArray(nextPlan, targetRegion) : deliveryArray(nextPlan, targetRegion);
        if (!values) return { ok: false, reason: 'target_missing' };
        if (boundedOperation === 'remove') values.splice(proposal.region.entryIndex, 1);
        else if (boundedOperation === 'replace') values[proposal.region.entryIndex] = change!.value;
        else {
            if (targetRegion.entryIndex !== values.length) return { ok: false, reason: 'target_missing' };
            values.push(change!.value);
        }
    }
    const next = replaceStructuredPlanFence(artifactVersion.content, nextPlan);
    if (!next) return { ok: false, reason: 'invalid_content' };
    if (next === artifactVersion.content) return { ok: false, reason: 'no_change' };
    const resultingRegion = proposal.resultingRegion ?? proposal.region;
    const result = resolveDownstreamUpdateRegionContent({ content: next }, resultingRegion);
    if (boundedOperation === 'remove') {
        if (result.found) return { ok: false, reason: 'invalid_content' };
        return { ok: true, content: next, resultingRegionContentHash: removedDownstreamUpdateRegionHash(proposal.region) };
    }
    if (!result.found || !result.contentHash) return { ok: false, reason: 'invalid_content' };
    return { ok: true, content: next, resultingRegionContentHash: result.contentHash };
}
