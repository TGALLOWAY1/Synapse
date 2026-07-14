import type {
    AlignmentProposal,
    AlignmentProposalAnalysisStatus,
    AlignmentProposalContract,
    ArtifactSlotKey,
    DecisionEvent,
    DecisionAssessment,
    DecisionImpactPreview,
    PlanningAlignmentHint,
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

const MAX_ALIGNMENT_PROPOSALS = 8;
const MAX_ALIGNMENT_VALUE_CHARS = 12_000;
const MASKED_TARGET = '__synapse_preserved_target__';

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
    return applyPlanningTargetValue(prd, {
        kind: patch.entityType === 'feature' ? 'feature' : 'claim',
        section: patch.section,
        label: patch.section,
        jsonPath: patch.jsonPath,
        entityType: patch.entityType,
        entityId: patch.entityId,
    }, value);
}

function targetPatch(location: PlanningLocation, value: unknown): NonNullable<DecisionImpactPreview['proposedPrdPatch']>[number] {
    return {
        section: location.entityType === 'assumption' ? 'assumptions' : location.section,
        operation: 'replace',
        entityId: location.entityId,
        entityType: location.entityType,
        jsonPath: location.jsonPath,
        value,
    };
}

const DIRECT_TARGETS = new Set(['vision', 'coreProblem', 'architecture', 'targetUsers', 'risks', 'nonFunctionalRequirements', 'constraints']);
const ENTITY_TARGETS: Record<string, { identity: string; fields: Set<string> }> = {
    features: { identity: 'id', fields: new Set(['name', 'description', 'userValue', 'acceptanceCriteria', 'successCriteria', 'edgeCases', 'failureModes', 'uiAcceptanceCriteria', 'analyticsEvents', 'tier', 'priority']) },
    userLoops: { identity: 'name', fields: new Set(['trigger', 'action', 'systemResponse', 'reward', 'retentionMechanic']) },
    uxPages: { identity: 'id', fields: new Set(['name', 'purpose', 'primaryUser', 'components', 'interactions', 'emptyState', 'loadingState', 'errorState', 'responsiveNotes']) },
    successMetrics: { identity: 'name', fields: new Set(['name', 'target', 'instrumentation']) },
    architectureFlows: { identity: 'name', fields: new Set(['name', 'steps']) },
    jtbd: { identity: 'segment', fields: new Set(['segment', 'motivation', 'painPoints', 'job', 'successMoment']) },
    roles: { identity: 'role', fields: new Set(['role', 'allowed', 'restricted', 'dataVisibility', 'notes']) },
    featureSystems: { identity: 'id', fields: new Set(['name', 'purpose', 'featureIds', 'endToEndBehavior', 'dependencies', 'edgeCases', 'mvpVsLater']) },
    principles: { identity: 'name', fields: new Set(['name', 'description']) },
};
const SAFE_ROOTS = new Set([
    'vision', 'targetUsers', 'coreProblem', 'features', 'architecture', 'risks', 'nonFunctionalRequirements', 'constraints', 'domainEntities', 'primaryActions',
    'productThesis', 'jtbd', 'principles', 'userLoops', 'uxPages', 'featureSystems', 'richDataModel', 'stateMachines',
    'roles', 'architectureFlows', 'mvpScope', 'successMetrics',
]);
const UNSAFE_PATH_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function parseIndexedScalarPath(jsonPath: string | undefined): Array<string | number> | undefined {
    if (!jsonPath?.startsWith('$.')) return undefined;
    const source = jsonPath.slice(2);
    const tokens: Array<string | number> = [];
    let cursor = 0;
    const tokenPattern = /([A-Za-z_][A-Za-z0-9_]*)|\[(\d+)\]/gy;
    while (cursor < source.length) {
        tokenPattern.lastIndex = cursor;
        const match = tokenPattern.exec(source);
        if (!match) {
            if (source[cursor] === '.') { cursor += 1; continue; }
            return undefined;
        }
        const token = match[1] ?? Number(match[2]);
        if (typeof token === 'string' && UNSAFE_PATH_KEYS.has(token)) return undefined;
        if (typeof token === 'number' && (!Number.isSafeInteger(token) || token > 500)) return undefined;
        tokens.push(token);
        if (tokens.length > 12) return undefined;
        cursor = tokenPattern.lastIndex;
    }
    return typeof tokens[0] === 'string' && SAFE_ROOTS.has(tokens[0]) && tokens.some(token => typeof token === 'number')
        ? tokens
        : undefined;
}

function readIndexedScalar(root: unknown, tokens: Array<string | number>): { found: true; value: unknown } | { found: false } {
    let current = root;
    for (const token of tokens) {
        if (typeof token === 'number') {
            if (!Array.isArray(current) || token >= current.length) return { found: false };
            current = current[token];
        } else {
            if (typeof current !== 'object' || current === null || !(token in current)) return { found: false };
            current = (current as Record<string, unknown>)[token];
        }
    }
    return ['string', 'number', 'boolean'].includes(typeof current) || current === null
        ? { found: true, value: current }
        : { found: false };
}

function replaceIndexedScalar(root: unknown, tokens: Array<string | number>, value: unknown): unknown | undefined {
    const current = readIndexedScalar(root, tokens);
    if (!current.found) return undefined;
    if (current.value === null ? value !== null : typeof value !== typeof current.value) return undefined;
    const replace = (node: unknown, depth: number): unknown | undefined => {
        if (depth === tokens.length) return value;
        const token = tokens[depth];
        if (typeof token === 'number') {
            if (!Array.isArray(node) || token >= node.length) return undefined;
            const child = replace(node[token], depth + 1);
            if (child === undefined) return undefined;
            const copy = [...node];
            copy[token] = child;
            return copy;
        }
        if (typeof node !== 'object' || node === null || !(token in node)) return undefined;
        const child = replace((node as Record<string, unknown>)[token], depth + 1);
        return child === undefined ? undefined : { ...(node as Record<string, unknown>), [token]: child };
    };
    return replace(root, 0);
}

function parseTarget(location: PlanningLocation):
    | { kind: 'direct'; key: string }
    | { kind: 'mvp'; field: string }
    | { kind: 'entity'; root: string; field: string; identity: string }
    | { kind: 'data_entity'; field: string }
    | undefined {
    const path = location.jsonPath?.slice(2);
    if (!path) return undefined;
    if (DIRECT_TARGETS.has(path)) return { kind: 'direct', key: path };
    if (path.startsWith('mvpScope.')) {
        const field = path.slice('mvpScope.'.length);
        return ['mvp', 'v1', 'later', 'rationale'].includes(field) ? { kind: 'mvp', field } : undefined;
    }
    if (path.startsWith('richDataModel.entities.')) {
        const field = path.slice('richDataModel.entities.'.length);
        return ['description', 'relationships', 'constraints', 'examples'].includes(field) ? { kind: 'data_entity', field } : undefined;
    }
    const [root, field, ...rest] = path.split('.');
    if (UNSAFE_PATH_KEYS.has(root) || UNSAFE_PATH_KEYS.has(field) || !Object.hasOwn(ENTITY_TARGETS, root)) return undefined;
    const spec = ENTITY_TARGETS[root];
    if (rest.length > 0 || !spec.fields.has(field)) return undefined;
    return { kind: 'entity', root, field, identity: spec.identity };
}

export function readPlanningTargetValue(prd: StructuredPRD, location: PlanningLocation): { found: true; value: unknown } | { found: false } {
    if (location.entityType === 'assumption' && location.entityId) {
        const value = prd.assumptions?.find(item => item.id === location.entityId);
        return value ? { found: true, value } : { found: false };
    }
    const indexedPath = parseIndexedScalarPath(location.jsonPath);
    if (indexedPath) return readIndexedScalar(prd, indexedPath);
    const target = parseTarget(location);
    if (!target) return { found: false };
    const document = prd as unknown as Record<string, unknown>;
    if (target.kind === 'direct') return target.key in document ? { found: true, value: document[target.key] } : { found: false };
    if (target.kind === 'mvp') return prd.mvpScope && target.field in prd.mvpScope
        ? { found: true, value: (prd.mvpScope as unknown as Record<string, unknown>)[target.field] }
        : { found: false };
    if (!location.entityId) return { found: false };
    if (target.kind === 'data_entity') {
        const entity = prd.richDataModel?.entities.find(item => item.name === location.entityId);
        return entity && target.field in entity ? { found: true, value: (entity as unknown as Record<string, unknown>)[target.field] } : { found: false };
    }
    const collection = document[target.root];
    if (!Array.isArray(collection)) return { found: false };
    const entity = collection.find(item => typeof item === 'object' && item !== null && (item as Record<string, unknown>)[target.identity] === location.entityId) as Record<string, unknown> | undefined;
    return entity && target.field in entity ? { found: true, value: entity[target.field] } : { found: false };
}

function compatibleBoundedValue(current: unknown, next: unknown): boolean {
    if (typeof current === 'string') return typeof next === 'string';
    if (Array.isArray(current)) return Array.isArray(next) && next.length <= 50 && next.every(item => typeof item === 'string');
    return false;
}

export function applyPlanningTargetValue(prd: StructuredPRD, location: PlanningLocation, value: unknown): StructuredPRD | undefined {
    if (location.entityType === 'assumption' && location.entityId) {
        const assumptions = prd.assumptions ?? [];
        const current = assumptions.find(item => item.id === location.entityId);
        if (!current || typeof value !== 'object' || !value) return undefined;
        const next = value as typeof current;
        if (next.id !== current.id || next.statement !== current.statement || next.confidence !== current.confidence) return undefined;
        return { ...prd, assumptions: assumptions.map(item => item.id === location.entityId ? next : item) };
    }
    const indexedPath = parseIndexedScalarPath(location.jsonPath);
    if (indexedPath) return replaceIndexedScalar(prd, indexedPath, value) as StructuredPRD | undefined;
    const target = parseTarget(location);
    const current = readPlanningTargetValue(prd, location);
    if (!target || !current.found || !compatibleBoundedValue(current.value, value)) return undefined;
    if (target.kind === 'direct') return { ...prd, [target.key]: value };
    if (target.kind === 'mvp' && prd.mvpScope) return { ...prd, mvpScope: { ...prd.mvpScope, [target.field]: value } };
    if (!location.entityId) return undefined;
    if (target.kind === 'data_entity' && prd.richDataModel) return {
        ...prd,
        richDataModel: {
            ...prd.richDataModel,
            entities: prd.richDataModel.entities.map(entity => entity.name === location.entityId ? { ...entity, [target.field]: value } : entity),
        },
    };
    if (target.kind !== 'entity') return undefined;
    const document = prd as unknown as Record<string, unknown>;
    const collection = document[target.root];
    if (!Array.isArray(collection)) return undefined;
    return {
        ...prd,
        [target.root]: collection.map(item => typeof item === 'object' && item !== null && (item as Record<string, unknown>)[target.identity] === location.entityId
            ? { ...(item as Record<string, unknown>), [target.field]: value }
            : item),
    } as StructuredPRD;
}

function preservedContentHash(prd: StructuredPRD, location: PlanningLocation): string | undefined {
    if (location.entityType === 'assumption' && location.entityId) {
        const assumptions = prd.assumptions ?? [];
        if (!assumptions.some(item => item.id === location.entityId)) return undefined;
        return planningContentHash({
            ...prd,
            assumptions: assumptions.map(item => item.id === location.entityId
                ? { id: item.id, statement: MASKED_TARGET, confidence: 'low' }
                : item),
        });
    }
    const current = readPlanningTargetValue(prd, location);
    if (!current.found) return undefined;
    const maskValue = Array.isArray(current.value)
        ? current.value.map(() => MASKED_TARGET)
        : MASKED_TARGET;
    const masked = patchPrd(prd, targetPatch(location, maskValue), maskValue);
    return masked ? planningContentHash(masked) : undefined;
}

function evidenceBindings(record: PlanningRecord): AlignmentProposalContract['evidence'] {
    return record.evidence.map(evidence => ({
        refId: evidence.id,
        sourceVersionId: evidence.sourceVersionId,
        contentHash: evidence.excerptHash ?? planningContentHash({ locator: evidence.locator, excerpt: evidence.excerpt }),
    }));
}

function buildProposalContract(input: {
    record: PlanningRecord;
    target: PlanningLocation;
    structuredPRD: StructuredPRD;
    baselineSpineVersionId: string;
    decisionEventId: string;
    status: AlignmentProposalAnalysisStatus;
    method?: 'deterministic' | 'model';
    model?: string;
    provider?: string;
    failureReason?: string;
}): AlignmentProposalContract {
    const target = readPlanningTargetValue(input.structuredPRD, input.target);
    return {
        version: 1,
        analysisStatus: input.status,
        authoredBy: 'synapse',
        method: input.method ?? 'deterministic',
        model: input.model,
        provider: input.provider,
        baselineSpineVersionId: input.baselineSpineVersionId,
        baselineSpineContentHash: planningContentHash(input.structuredPRD),
        decisionEventId: input.decisionEventId,
        targetValueHash: target.found ? planningContentHash(target.value) : undefined,
        preservedContentHash: target.found ? preservedContentHash(input.structuredPRD, input.target) : undefined,
        evidence: evidenceBindings(input.record),
        maxTouchedTargets: 1,
        failureReason: input.failureReason,
    };
}

export type AlignmentProposalContractValidation =
    | { ok: true; legacy: boolean }
    | { ok: false; reason: string };

/** Re-validates machine-authored analysis at the local trust boundary. A
 * model's `bounded_applicable` label is descriptive, never authoritative. */
export function validateAlignmentProposalContract(input: {
    record: PlanningRecord;
    preview: DecisionImpactPreview;
    proposal: AlignmentProposal;
    structuredPRD: StructuredPRD;
}): AlignmentProposalContractValidation {
    const { record, preview, proposal, structuredPRD } = input;
    if ((preview.proposedPrdPatch?.length ?? 0) > MAX_ALIGNMENT_PROPOSALS) return { ok: false, reason: 'Proposal analysis exceeds the safe applicable-target limit.' };
    if (preview.baseline.spineContentHash !== planningContentHash(structuredPRD)) return { ok: false, reason: 'Proposal baseline content changed.' };
    if (preview.decisionEventId !== projectDecision(record).latestVerdictEventId) return { ok: false, reason: 'Decision verdict changed after analysis.' };
    const patches = preview.proposedPrdPatch?.filter(item => item.proposalId === proposal.id) ?? [];
    if (patches.length !== 1) return { ok: false, reason: 'Applicable proposals must map to exactly one structured target.' };
    const patch = patches[0];
    const target = readPlanningTargetValue(structuredPRD, proposal.target);
    if (!target.found || patch.operation !== 'replace') return { ok: false, reason: 'Proposal target is not a bounded replace operation.' };
    if (patch.jsonPath !== proposal.target.jsonPath || patch.entityId !== proposal.target.entityId) return { ok: false, reason: 'Proposal patch does not match its typed target.' };
    if (stablePlanningStringify(patch.value) !== stablePlanningStringify(proposal.proposedValue)) return { ok: false, reason: 'Proposal value was changed after analysis.' };
    if (stablePlanningStringify(patch.value).length > MAX_ALIGNMENT_VALUE_CHARS) return { ok: false, reason: 'Proposal value exceeds the safe breadth limit.' };
    const contract = proposal.contract;
    if (!contract) {
        if (preview.proposalContractVersion === 1) return { ok: false, reason: 'Contract-stamped preview contains an unbound proposal.' };
        // Phase 1 compatibility: retain exact single-target previews, but run
        // them through the new structural checks above instead of trusting the
        // historical proposed-result hash alone.
        return { ok: true, legacy: true };
    }
    if (contract.version !== 1 || contract.authoredBy !== 'synapse' || contract.maxTouchedTargets !== 1) return { ok: false, reason: 'Proposal contract is invalid.' };
    if (contract.analysisStatus !== 'bounded_applicable') return { ok: false, reason: `Proposal analysis is ${contract.analysisStatus.replaceAll('_', ' ')}.` };
    if (contract.method === 'model' && (!contract.model || !contract.provider)) return { ok: false, reason: 'Model-authored analysis lacks model provenance.' };
    if (contract.baselineSpineVersionId !== preview.baseline.spineVersionId
        || contract.baselineSpineContentHash !== preview.baseline.spineContentHash
        || contract.decisionEventId !== preview.decisionEventId) return { ok: false, reason: 'Proposal contract is bound to different planning context.' };
    if (contract.targetValueHash !== planningContentHash(target.value)) return { ok: false, reason: 'Proposal target evidence is stale.' };
    if (contract.preservedContentHash !== preservedContentHash(structuredPRD, proposal.target)) return { ok: false, reason: 'Proposal preservation evidence is stale.' };
    for (const binding of contract.evidence) {
        const current = record.evidence.find(item => item.id === binding.refId);
        const currentHash = current?.excerptHash ?? (current ? planningContentHash({ locator: current.locator, excerpt: current.excerpt }) : undefined);
        if (!current || current.sourceVersionId !== binding.sourceVersionId || currentHash !== binding.contentHash) {
            return { ok: false, reason: 'Proposal source evidence is stale.' };
        }
    }
    const phaseOneArrayCompatible = contract.method === 'deterministic'
        && Array.isArray(target.value)
        && Array.isArray(proposal.proposedValue)
        && compatibleBoundedValue(target.value, proposal.proposedValue);
    if (proposal.target.entityType !== 'assumption'
        && !phaseOneArrayCompatible
        && (!['string', 'number', 'boolean'].includes(typeof target.value) || typeof target.value !== typeof proposal.proposedValue)) {
        return { ok: false, reason: 'Proposal changes target type or breadth.' };
    }
    return { ok: true, legacy: false };
}

export function buildReviewedDecisionImpact(input: {
    record: PlanningRecord;
    preview: DecisionImpactPreview;
    structuredPRD: StructuredPRD;
}): { nextPrd?: StructuredPRD; acceptedProposalIds: string[]; rejectedProposalIds: string[]; pendingCount: number; deferredCount: number } {
    const reviews = alignmentProposalReviews(input.record, input.preview);
    let nextPrd = input.structuredPRD;
    const acceptedProposalIds: string[] = [];
    const rejectedProposalIds: string[] = [];
    for (const review of reviews) {
        if (review.proposal.requiresInput || !['accepted', 'edited'].includes(review.disposition)) continue;
        const contract = validateAlignmentProposalContract({
            record: input.record, preview: input.preview, proposal: review.proposal, structuredPRD: input.structuredPRD,
        });
        if (!contract.ok) {
            rejectedProposalIds.push(review.proposal.id);
            continue;
        }
        const patch = input.preview.proposedPrdPatch?.find(item => item.proposalId === review.proposal.id);
        if (!patch) continue;
        let value = review.disposition === 'edited' ? review.editedValue : patch.value;
        if (patch.section === 'assumptions' && typeof review.editedValue === 'string' && typeof patch.value === 'object' && patch.value) {
            value = { ...(patch.value as Record<string, unknown>), decisionNote: review.editedValue };
        } else if (review.disposition === 'edited' && typeof review.editedValue === 'string' && Array.isArray(patch.value)) {
            value = [review.editedValue];
        } else if (review.disposition === 'edited' && typeof review.editedValue !== 'string') {
            rejectedProposalIds.push(review.proposal.id);
            continue;
        }
        if (stablePlanningStringify(value).length > MAX_ALIGNMENT_VALUE_CHARS) {
            rejectedProposalIds.push(review.proposal.id);
            continue;
        }
        const patched = patchPrd(nextPrd, patch, value);
        if (!patched) {
            rejectedProposalIds.push(review.proposal.id);
            continue;
        }
        nextPrd = patched;
        acceptedProposalIds.push(review.proposal.id);
    }
    return {
        nextPrd: acceptedProposalIds.length > 0 ? nextPrd : undefined,
        acceptedProposalIds,
        rejectedProposalIds,
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
        if (!oldPatch) return {
            ...review.proposal,
            id: proposalId,
            contract: buildProposalContract({
                record: input.record, target: review.proposal.target, structuredPRD: input.structuredPRD,
                baselineSpineVersionId: input.baselineSpineVersionId, decisionEventId: input.preview.decisionEventId,
                status: 'needs_input', failureReason: 'The remaining target has no bounded patch.',
            }),
        };
        const rebasedPatch = { ...oldPatch, proposalId };
        const next = patchPrd(proposedPrd, rebasedPatch, rebasedPatch.value);
        if (!next) return {
            ...review.proposal,
            id: proposalId,
            operation: 'review',
            requiresInput: true,
            reason: `${review.proposal.reason} The plan changed during partial apply, so Synapse can no longer propose this edit safely.`,
            contract: buildProposalContract({
                record: input.record, target: review.proposal.target, structuredPRD: input.structuredPRD,
                baselineSpineVersionId: input.baselineSpineVersionId, decisionEventId: input.preview.decisionEventId,
                status: 'needs_input', failureReason: 'The target could not be safely rebased.',
            }),
        };
        proposedPrd = next;
        proposedPrdPatch.push(rebasedPatch);
        return {
            ...review.proposal,
            id: proposalId,
            contract: buildProposalContract({
                record: input.record, target: review.proposal.target, structuredPRD: input.structuredPRD,
                baselineSpineVersionId: input.baselineSpineVersionId, decisionEventId: input.preview.decisionEventId,
                status: 'bounded_applicable',
            }),
        };
    });
    const preview: DecisionImpactPreview = {
        ...input.preview,
        id,
        status: 'ready',
        proposalContractVersion: 1,
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

function classifyAlignmentHint(hint: PlanningAlignmentHint, prd: StructuredPRD): {
    status: AlignmentProposalAnalysisStatus;
    failureReason?: string;
} {
    if (hint.analysisMethod === 'model' && (!hint.model || !hint.provider)) {
        return { status: 'failed', failureReason: 'Model-authored analysis did not identify its model and provider.' };
    }
    if (hint.analysisStatus === 'failed' || hint.analysisStatus === 'rejected') {
        return { status: hint.analysisStatus, failureReason: hint.failureReason ?? hint.reason };
    }
    if (hint.analysisStatus === 'needs_input' || hint.proposedValue === undefined) {
        return { status: 'needs_input', failureReason: hint.failureReason ?? 'Additional product input is required.' };
    }
    if (hint.analysisStatus === 'advisory_candidate') {
        return { status: 'advisory_candidate', failureReason: hint.failureReason ?? 'The analysis is advisory and cannot be applied directly.' };
    }
    if (hint.operation !== 'replace') return { status: 'advisory_candidate', failureReason: 'Add/remove changes require a dedicated bounded operation.' };
    if (stablePlanningStringify(hint.proposedValue).length > MAX_ALIGNMENT_VALUE_CHARS) {
        return { status: 'rejected', failureReason: 'Proposed value exceeds the safe breadth limit.' };
    }
    const current = readPlanningTargetValue(prd, hint.target);
    if (!current.found) {
        const broad = hint.target.jsonPath === '$.features' || hint.target.jsonPath === '$.assumptions' || hint.target.kind === 'section';
        return broad
            ? { status: 'rejected', failureReason: 'Broad section or collection rewrites are outside the bounded proposal contract.' }
            : { status: 'advisory_candidate', failureReason: 'The target is meaningful but not yet supported by a bounded structured patch.' };
    }
    const deterministicArray = hint.analysisMethod !== 'model'
        && Array.isArray(current.value)
        && compatibleBoundedValue(current.value, hint.proposedValue);
    if (!deterministicArray
        && (!['string', 'number', 'boolean'].includes(typeof current.value) || typeof current.value !== typeof hint.proposedValue)) {
        return { status: 'rejected', failureReason: 'Bounded proposals must replace one existing scalar leaf without changing its type.' };
    }
    return { status: 'bounded_applicable' };
}

export type IntegrateAlignmentHintResult =
    | { ok: true; preview: DecisionImpactPreview; proposal: AlignmentProposal }
    | { ok: false; reason: string; analysisStatus: AlignmentProposalAnalysisStatus };

/** Replace one unresolved review target with one locally validated model
 * proposal. The caller may persist the returned preview in the existing
 * assessment; failures never mutate the original preview. */
export function integrateAlignmentHintIntoPreview(input: {
    record: PlanningRecord;
    preview: DecisionImpactPreview;
    targetProposalId: string;
    hint: PlanningAlignmentHint;
    structuredPRD: StructuredPRD;
}): IntegrateAlignmentHintResult {
    const { record, preview, targetProposalId, hint, structuredPRD } = input;
    if (preview.proposalContractVersion !== 1) {
        return { ok: false, reason: 'Refresh this legacy preview before adding model-authored proposals.', analysisStatus: 'rejected' };
    }
    if (preview.baseline.spineContentHash !== planningContentHash(structuredPRD)
        || preview.decisionEventId !== projectDecision(record).latestVerdictEventId) {
        return { ok: false, reason: 'Planning context changed before the model proposal could be integrated.', analysisStatus: 'rejected' };
    }
    const existing = preview.alignmentProposals?.find(item => item.id === targetProposalId);
    if (!existing) return { ok: false, reason: 'Review target no longer exists.', analysisStatus: 'rejected' };
    const review = alignmentProposalReviews(record, preview).find(item => item.proposal.id === targetProposalId);
    if (review && review.disposition !== 'pending') {
        return { ok: false, reason: 'A reviewed target cannot be replaced by later model analysis.', analysisStatus: 'rejected' };
    }
    const parentPath = existing.target.jsonPath;
    if (existing.target.section !== hint.target.section
        || (parentPath && hint.target.jsonPath !== parentPath && !hint.target.jsonPath?.startsWith(`${parentPath}[`) && !hint.target.jsonPath?.startsWith(`${parentPath}.`))) {
        return { ok: false, reason: 'Model proposal is outside the requested review target.', analysisStatus: 'rejected' };
    }
    const analysis = classifyAlignmentHint({ ...hint, analysisMethod: 'model' }, structuredPRD);
    if (analysis.status !== 'bounded_applicable') {
        return { ok: false, reason: analysis.failureReason ?? 'Model analysis is not safely applicable.', analysisStatus: analysis.status };
    }
    const proposal: AlignmentProposal = {
        id: `${preview.id}-model-${planningContentHash(`${targetProposalId}:${hint.target.jsonPath}:${stablePlanningStringify(hint.proposedValue)}`)}`,
        target: hint.target,
        operation: 'replace',
        beforeSummary: readPlanningTargetValue(structuredPRD, hint.target).found
            ? stablePlanningStringify((readPlanningTargetValue(structuredPRD, hint.target) as { found: true; value: unknown }).value)
            : undefined,
        proposedSummary: hint.proposedSummary,
        proposedValue: hint.proposedValue,
        reason: hint.reason,
        confidence: hint.confidence ?? 'likely',
        ambiguity: hint.ambiguity,
        questions: hint.questions,
        evidenceSummary: hint.evidenceSummary,
        requiredForVerdictAlignment: hint.requiredForVerdictAlignment,
        contract: buildProposalContract({
            record, target: hint.target, structuredPRD,
            baselineSpineVersionId: preview.baseline.spineVersionId,
            decisionEventId: preview.decisionEventId,
            status: 'bounded_applicable', method: 'model', model: hint.model, provider: hint.provider,
        }),
    };
    const patch: NonNullable<DecisionImpactPreview['proposedPrdPatch']>[number] = {
        proposalId: proposal.id,
        section: hint.target.section,
        operation: 'replace',
        entityId: hint.target.entityId,
        entityType: hint.target.entityType,
        jsonPath: hint.target.jsonPath,
        beforeSummary: proposal.beforeSummary,
        afterSummary: hint.proposedSummary,
        value: hint.proposedValue,
    };
    const proposals = (preview.alignmentProposals ?? []).map(item => item.id === targetProposalId ? proposal : item);
    const patches = [...(preview.proposedPrdPatch ?? []).filter(item => item.proposalId !== targetProposalId), patch];
    let proposedPrd = structuredPRD;
    for (const item of patches) {
        const next = patchPrd(proposedPrd, item, item.value);
        if (!next) return { ok: false, reason: 'Combined proposal set no longer preserves the working plan.', analysisStatus: 'rejected' };
        proposedPrd = next;
    }
    const nextPreview: DecisionImpactPreview = {
        ...preview,
        proposalContractVersion: preview.proposalContractVersion,
        alignmentProposals: proposals,
        proposedPrdPatch: patches,
        proposedResultHash: planningContentHash(proposedPrd),
    };
    const validation = validateAlignmentProposalContract({ record, preview: nextPreview, proposal, structuredPRD });
    return validation.ok
        ? { ok: true, preview: nextPreview, proposal }
        : { ok: false, reason: validation.reason, analysisStatus: 'rejected' };
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
        const hintLocations = explicitHints.slice(0, MAX_ALIGNMENT_PROPOSALS);
        const previewId = `impact-${input.record.id}-${planningContentHash(`${input.baselineSpineVersionId}:${projection.latestVerdictEventId}`)}`;
        const alignmentProposals: AlignmentProposal[] = hintLocations.map((hint, index) => {
            const analysis = classifyAlignmentHint(hint, input.structuredPRD);
            return {
                id: `${previewId}-change-${index + 1}`,
                target: hint.target,
                operation: analysis.status === 'bounded_applicable' ? hint.operation : 'review',
                proposedSummary: hint.proposedSummary,
                proposedValue: hint.proposedValue,
                reason: hint.reason,
                confidence: hint.confidence ?? 'likely',
                ambiguity: hint.ambiguity,
                questions: hint.questions,
                evidenceSummary: hint.evidenceSummary,
                requiredForVerdictAlignment: hint.requiredForVerdictAlignment ?? true,
                requiresInput: analysis.status === 'needs_input',
                contract: buildProposalContract({
                    record: input.record,
                    target: hint.target,
                    structuredPRD: input.structuredPRD,
                    baselineSpineVersionId: input.baselineSpineVersionId,
                    decisionEventId: projection.latestVerdictEventId!,
                    status: analysis.status,
                    method: hint.analysisMethod,
                    model: hint.model,
                    provider: hint.provider,
                    failureReason: analysis.failureReason,
                }),
            };
        });
        const hintedTargets = new Set(hintLocations.map(hint => stablePlanningStringify(hint.target)));
        for (const location of locations) {
            if (alignmentProposals.length >= MAX_ALIGNMENT_PROPOSALS) break;
            if (hintedTargets.has(stablePlanningStringify(location))) continue;
            alignmentProposals.push({
                id: `${previewId}-review-${alignmentProposals.length + 1}`,
                target: location,
                operation: 'review',
                beforeSummary: location.excerpt,
                reason: 'This content may depend on the decision, but Synapse needs additional input before proposing a safe rewrite.',
                confidence: 'possible',
                requiresInput: true,
                contract: buildProposalContract({
                    record: input.record, target: location, structuredPRD: input.structuredPRD,
                    baselineSpineVersionId: input.baselineSpineVersionId, decisionEventId: projection.latestVerdictEventId!,
                    status: 'needs_input', failureReason: 'A safe aligned value could not be established.',
                }),
            });
        }
        if (alignmentProposals.length === 0) alignmentProposals.push({
            id: `${previewId}-review-1`,
            target: sectionLocation('Working plan'),
            operation: 'review',
            reason: 'The decision is recorded, but no precise plan dependency has been established yet.',
            confidence: 'possible',
            requiresInput: true,
            contract: buildProposalContract({
                record: input.record, target: sectionLocation('Working plan'), structuredPRD: input.structuredPRD,
                baselineSpineVersionId: input.baselineSpineVersionId, decisionEventId: projection.latestVerdictEventId!,
                status: 'needs_input', failureReason: 'No precise dependency has been established.',
            }),
        });
        const proposedPrdPatch = alignmentProposals.flatMap(proposal => {
            const hint = hintLocations.find(item => stablePlanningStringify(item.target) === stablePlanningStringify(proposal.target));
            if (!hint?.target.jsonPath || proposal.contract?.analysisStatus !== 'bounded_applicable') return [];
            return [{
                proposalId: proposal.id,
                section: hint.target.section,
                operation: hint.operation,
                entityId: hint.target.entityId,
                entityType: hint.target.entityType,
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
            proposalContractVersion: 1,
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
        contract: buildProposalContract({
            record: input.record, target: sourceTarget, structuredPRD: input.structuredPRD,
            baselineSpineVersionId: input.baselineSpineVersionId, decisionEventId: projection.latestVerdictEventId,
            status: 'bounded_applicable',
        }),
    }, ...secondaryLocations.map((location, index): AlignmentProposal => ({
        id: `${id}-review-${index + 1}`,
        target: location,
        operation: 'review',
        beforeSummary: location.excerpt,
        reason: 'This content may depend on the decision and should be checked before the plan is considered aligned.',
        confidence: 'possible',
        requiresInput: true,
        contract: buildProposalContract({
            record: input.record, target: location, structuredPRD: input.structuredPRD,
            baselineSpineVersionId: input.baselineSpineVersionId, decisionEventId: projection.latestVerdictEventId!,
            status: 'needs_input', failureReason: 'A safe aligned value could not be established.',
        }),
    }))];
    const preview: DecisionImpactPreview = {
        id,
        projectId: input.projectId,
        planningRecordId: input.record.id,
        decisionEventId: projection.latestVerdictEventId,
        status: 'ready',
        proposalContractVersion: 1,
        baseline: {
            spineVersionId: input.baselineSpineVersionId,
            spineContentHash: planningContentHash(input.structuredPRD),
        },
        proposedPrdPatch: [{
            proposalId: sourceProposalId,
            section: 'assumptions',
            operation: 'replace',
            entityId: sourceAssumption.id,
            entityType: 'assumption',
            jsonPath: '$.assumptions',
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
