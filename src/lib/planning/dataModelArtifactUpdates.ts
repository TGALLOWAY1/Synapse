import type { ArtifactVersion } from '../../types';
import { parseDataModelMarkdown, type ParsedEntity } from '../services/dataModelMarkdown';
import { hashReviewValue } from '../review/hash';
import {
    downstreamUpdatePlanItemIntegrityHash,
    downstreamArtifactUpdateResultRegion,
    downstreamUpdateRegionKey,
    resolveDownstreamUpdateRegionContent,
    sealDownstreamArtifactUpdateProposal,
    type DownstreamArtifactUpdateOperation,
    type DownstreamArtifactUpdateProposal,
    type DownstreamArtifactUpdateReviewEvent,
    type DownstreamDataModelChangeKind,
    type DownstreamDataModelDependency,
    type DownstreamDataModelImpact,
} from './downstreamArtifactUpdateProposal';
import type { DownstreamUpdatePlan, DownstreamUpdatePlanItem, DownstreamUpdateRegion } from './downstreamUpdatePlan';
import { removedDownstreamUpdateRegionHash } from './screenFlowArtifactUpdates';

type DataModelRegion = Extract<DownstreamUpdateRegion, { kind: 'data_model' }>;
type MutableRecord = Record<string, unknown>;

export type DataModelDependencyDocument = {
    id: string;
    label: string;
    kind: 'flow' | 'requirement';
    content: string;
};

export type UserGroundedDataModelChange = {
    changeKind: DownstreamDataModelChangeKind;
    memberKind?: DownstreamDataModelImpact['memberKind'];
    /** Exact replacement/addition. JSON is preferred for structured values. */
    content: string | null;
};

type ProposalInput = {
    projectId: string;
    plan: DownstreamUpdatePlan;
    item: DownstreamUpdatePlanItem;
    artifactVersion: ArtifactVersion;
    dependencyDocuments?: DataModelDependencyDocument[];
    userGroundedChange?: UserGroundedDataModelChange;
    /** Distinguishes absent context from context that was intentionally conservative/unparseable. */
    userContextProvided?: boolean;
    createdAt?: number;
    requestNonce?: string;
};

export type DataModelProposalResult =
    | { ok: true; proposal: DownstreamArtifactUpdateProposal }
    | { ok: false; reason: 'unsupported_artifact' | 'region_missing' | 'binding_mismatch' | 'invalid_user_context' };

const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const token = (value: string): string => normalize(value).replace(/\s+/g, '_');
const escaped = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isRecord = (value: unknown): value is MutableRecord => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function parseJsonRecord(content: string): MutableRecord | undefined {
    try {
        const value = JSON.parse(content);
        return isRecord(value) ? value : undefined;
    } catch {
        return undefined;
    }
}

export function parseUserGroundedDataModelChange(context: string): UserGroundedDataModelChange | undefined {
    const parsed = parseJsonRecord(context);
    if (!parsed) return undefined;
    const allowed = new Set<DownstreamDataModelChangeKind>([
        'add', 'remove', 'rename', 'requiredness', 'cardinality', 'constraint', 'replace', 'out_of_scope',
    ]);
    const memberKinds = new Set<DownstreamDataModelImpact['memberKind']>([
        'entity', 'field', 'relationship', 'constraint', 'data_expectation',
    ]);
    if (typeof parsed.changeKind !== 'string' || !allowed.has(parsed.changeKind as DownstreamDataModelChangeKind)) return undefined;
    if (parsed.memberKind !== undefined && (typeof parsed.memberKind !== 'string'
        || !memberKinds.has(parsed.memberKind as DownstreamDataModelImpact['memberKind']))) return undefined;
    if (parsed.content !== null && typeof parsed.content !== 'string' && typeof parsed.content !== 'object') return undefined;
    const content = parsed.content === null ? null
        : typeof parsed.content === 'string' ? parsed.content
            : JSON.stringify(parsed.content);
    return {
        changeKind: parsed.changeKind as DownstreamDataModelChangeKind,
        ...(parsed.memberKind ? { memberKind: parsed.memberKind as DownstreamDataModelImpact['memberKind'] } : {}),
        content,
    };
}

function jsonEntities(content: string): MutableRecord[] | undefined {
    const root = parseJsonRecord(content);
    return root && Array.isArray(root.entities) ? root.entities.filter(isRecord) : undefined;
}

function markdownFieldTableCount(content: string, entityName: string): number {
    const heading = new RegExp(`^##\\s+${escaped(entityName)}\\s*$`, 'im').exec(content);
    if (!heading || heading.index === undefined) return 0;
    const tail = content.slice(heading.index + heading[0].length);
    const next = /^##\s+.+$/m.exec(tail);
    const section = tail.slice(0, next?.index ?? tail.length);
    return [...section.matchAll(/^\|.*\bField\b.*\bType\b.*\bRequired\b.*\|\s*$/gim)].length;
}

function parsedEntities(content: string): ParsedEntity[] {
    return parseDataModelMarkdown(content)?.entities ?? [];
}

function memberNames(entity: ParsedEntity, aspect: DataModelRegion['aspect']): string[] {
    if (aspect === 'field') return entity.fieldGroups.flatMap(group => group.fields).map(field => field.name);
    if (aspect === 'relationship') return entity.callouts.filter(item => item.kind === 'RELATIONSHIP').map(item => item.text);
    if (aspect === 'constraint') return entity.callouts.filter(item => item.kind === 'CONSTRAINT').map(item => item.text);
    if (aspect === 'data_expectation') return entity.callouts.filter(item => item.kind === 'PRIVACY' || item.kind === 'INDEX').map(item => item.text);
    return [];
}

function enumerateRegions(version: ArtifactVersion, target: DataModelRegion): DataModelRegion[] {
    const markdown = parsedEntities(version.content);
    if (markdown.length > 0) return markdown.flatMap(entity => {
        const regions: DataModelRegion[] = [{ kind: 'data_model', entityName: entity.name, aspect: 'entity' }];
        for (const aspect of ['field', 'relationship', 'constraint', 'data_expectation'] as const) {
            for (const memberName of memberNames(entity, aspect)) regions.push({
                kind: 'data_model', entityName: entity.name, aspect, memberName,
            });
        }
        return regions;
    }).filter(region => downstreamUpdateRegionKey(region) !== downstreamUpdateRegionKey(target));
    const entities = jsonEntities(version.content) ?? [];
    return entities.flatMap(entity => {
        const name = typeof entity.name === 'string' ? entity.name : '';
        if (!name) return [];
        const regions: DataModelRegion[] = [{ kind: 'data_model', entityName: name, aspect: 'entity' }];
        const addMembers = (values: unknown, aspect: DataModelRegion['aspect'], nameOf: (value: unknown) => string | undefined) => {
            if (!Array.isArray(values)) return;
            for (const value of values) {
                const memberName = nameOf(value);
                if (memberName) regions.push({ kind: 'data_model', entityName: name, aspect, memberName });
            }
        };
        addMembers(entity.fields, 'field', value => isRecord(value) && typeof value.name === 'string' ? value.name : undefined);
        addMembers(entity.relationships, 'relationship', value => typeof value === 'string' ? value
            : isRecord(value) ? [value.type, value.target, value.description].filter(part => typeof part === 'string').join(' → ') : undefined);
        addMembers(entity.constraints, 'constraint', value => typeof value === 'string' ? value : undefined);
        addMembers(entity.dataExpectations ?? entity.privacyRules ?? entity.indexes, 'data_expectation', value => typeof value === 'string' ? value : undefined);
        return regions;
    }).filter(region => downstreamUpdateRegionKey(region) !== downstreamUpdateRegionKey(target));
}

function preservedBindings(version: ArtifactVersion, target: DataModelRegion): DownstreamArtifactUpdateProposal['preservedRegionBindings'] {
    return enumerateRegions(version, target).flatMap(region => {
        const resolved = resolveDownstreamUpdateRegionContent(version, region);
        return resolved.found && resolved.contentHash ? [{
            region, regionKey: downstreamUpdateRegionKey(region), contentHash: resolved.contentHash,
        }] : [];
    });
}

function targetEntity(version: ArtifactVersion, region: DataModelRegion): ParsedEntity | MutableRecord | undefined {
    const markdown = parsedEntities(version.content).find(entity => entity.name === region.entityName);
    if (markdown) return markdown;
    return jsonEntities(version.content)?.find(entity => entity.name === region.entityName);
}

function relationshipEndpoints(region: DataModelRegion, snapshot: string): string[] {
    if (region.aspect !== 'relationship') return [];
    const endpoints = new Set<string>([region.entityName]);
    const parsed = (() => { try { return JSON.parse(snapshot) as unknown; } catch { return snapshot; } })();
    if (isRecord(parsed) && typeof parsed.target === 'string') endpoints.add(parsed.target);
    const text = typeof parsed === 'string' ? parsed
        : isRecord(parsed) && typeof parsed.text === 'string' ? parsed.text : snapshot;
    const arrow = text.match(/(?:→|->)\s*([A-Za-z][A-Za-z0-9_]*)/);
    if (arrow?.[1]) endpoints.add(arrow[1]);
    const natural = text.match(/^([A-Za-z][A-Za-z0-9_]*)\s+(?:has\s+(?:many|one)|belongs\s+to|many\s+to\s+many)\s+([A-Za-z][A-Za-z0-9_]*)/i);
    if (natural?.[1]) endpoints.add(natural[1].replace(/s$/i, ''));
    if (natural?.[2]) endpoints.add(natural[2].replace(/s$/i, ''));
    const through = text.match(/\bthrough\s+([A-Za-z][A-Za-z0-9_]*)/i);
    if (through?.[1]) endpoints.add(through[1]);
    return [...endpoints];
}

const endpointToken = (value: string): string => token(value).replace(/s$/i, '');

function valueText(value: unknown): string {
    return typeof value === 'string' ? value : JSON.stringify(value);
}

function structuredRelationshipEndpoints(entityName: string, value: unknown): string[] {
    return relationshipEndpoints(
        { kind: 'data_model', entityName, aspect: 'relationship' },
        typeof value === 'string' ? value : JSON.stringify(value),
    );
}

function dependencyAnalysis(input: {
    version: ArtifactVersion;
    region: DataModelRegion;
    snapshot: string;
    documents: DataModelDependencyDocument[];
    destructive: boolean;
}): Pick<DownstreamDataModelImpact, 'relationshipEndpoints' | 'dependencies' | 'migrationImplications' | 'automaticApplicationBlocked' | 'blockReasons'> {
    const { version, region } = input;
    const dependencies: DownstreamDataModelDependency[] = [];
    const seen = new Set<string>();
    const add = (dependency: Omit<DownstreamDataModelDependency, 'id'>) => {
        const id = hashReviewValue(dependency);
        if (seen.has(id)) return;
        seen.add(id);
        dependencies.push({ id, ...dependency });
    };
    const endpoints = region.aspect === 'entity' ? [region.entityName] : relationshipEndpoints(region, input.snapshot);
    const entity = targetEntity(version, region);
    const targetTokens = [region.memberName, ...endpoints].filter((value): value is string => Boolean(value?.trim()));
    const targetEndpointTokens = new Set(endpoints.map(endpointToken).filter(Boolean));
    const parsedSnapshot = (() => { try { return JSON.parse(input.snapshot) as unknown; } catch { return input.snapshot; } })();
    const isTargetMember = (entityName: string, value: unknown): boolean => entityName === region.entityName
        && hashReviewValue(value) === hashReviewValue(parsedSnapshot);
    const references = (text: string, values: string[]): string[] => values.filter(value => {
        const needle = normalize(value);
        return needle.length >= 3 && normalize(text).includes(needle);
    });

    const scanField = (entityName: string, field: unknown, fieldName: string) => {
        if (isTargetMember(entityName, field)) return;
        const fieldRecord = isRecord(field) ? field : undefined;
        const fieldNameToken = endpointToken(fieldName);
        const structuralEndpoint = [...targetEndpointTokens].find(endpoint => (
            fieldNameToken === `${endpoint}_id` || fieldNameToken === `${endpoint}id`
            || endpointToken(String(fieldRecord?.type ?? '')) === endpoint
        ));
        const memberReferences = references(valueText(field), region.memberName ? [region.memberName] : []);
        const endpointReferences = references(valueText(field), endpoints);
        if (structuralEndpoint) add({
            label: `${entityName}.${fieldName}`, kind: 'field', certainty: 'direct',
            explanation: `This structured field is an inbound or endpoint reference to ${structuralEndpoint}.`,
        });
        else if (memberReferences.length > 0 || endpointReferences.length > 0) add({
            label: `${entityName}.${fieldName}`, kind: 'field', certainty: 'possible',
            explanation: 'This structured field description or type references the target member or one of its endpoints.',
        });
    };

    const scanRelationship = (entityName: string, relationship: unknown, label: string) => {
        if (isTargetMember(entityName, relationship)) return;
        const candidateEndpoints = structuredRelationshipEndpoints(entityName, relationship);
        const overlap = new Set(candidateEndpoints.map(endpointToken).filter(endpoint => targetEndpointTokens.has(endpoint)));
        const memberReferences = references(valueText(relationship), region.memberName ? [region.memberName] : []);
        if (overlap.size >= 2 || memberReferences.length > 0) add({
            label: `${entityName}: ${label}`, kind: 'relationship', certainty: 'direct',
            explanation: 'This reciprocal or inbound structured relationship references the target relationship.',
        });
        else if (overlap.size === 1) add({
            label: `${entityName}: ${label}`, kind: 'relationship', certainty: 'possible',
            explanation: 'This structured relationship shares an endpoint; its exact reciprocal dependency requires review.',
        });
    };

    const scanRule = (
        entityName: string,
        value: unknown,
        kind: 'constraint' | 'data_expectation',
        label: string,
    ) => {
        if (isTargetMember(entityName, value)) return;
        const memberReferences = references(valueText(value), region.memberName ? [region.memberName] : []);
        const endpointReferences = references(valueText(value), endpoints);
        if (memberReferences.length > 0 || endpointReferences.length > 0) add({
            label: `${entityName}: ${label}`, kind, certainty: memberReferences.length > 0 ? 'direct' : 'possible',
            explanation: memberReferences.length > 0
                ? 'This structured rule directly references the target member.'
                : 'This structured rule references a relationship endpoint and may depend on the target.',
        });
    };

    const markdownEntities = parsedEntities(version.content);
    if (markdownEntities.length > 0) {
        for (const parsed of markdownEntities) {
            for (const field of parsed.fieldGroups.flatMap(group => group.fields)) scanField(parsed.name, field, field.name);
            for (const callout of parsed.callouts) {
                if (callout.kind === 'RELATIONSHIP') scanRelationship(parsed.name, callout, callout.text);
                else if (callout.kind === 'CONSTRAINT') scanRule(parsed.name, callout, 'constraint', callout.text);
                else scanRule(parsed.name, callout, 'data_expectation', callout.text);
            }
        }
    } else {
        for (const parsed of jsonEntities(version.content) ?? []) {
            const entityName = typeof parsed.name === 'string' ? parsed.name : 'Unknown entity';
            for (const field of Array.isArray(parsed.fields) ? parsed.fields : []) {
                scanField(entityName, field, isRecord(field) && typeof field.name === 'string' ? field.name : valueText(field).slice(0, 80));
            }
            for (const relationship of Array.isArray(parsed.relationships) ? parsed.relationships : []) {
                scanRelationship(entityName, relationship, valueText(relationship).slice(0, 120));
            }
            for (const constraint of Array.isArray(parsed.constraints) ? parsed.constraints : []) {
                scanRule(entityName, constraint, 'constraint', valueText(constraint).slice(0, 120));
            }
            const expectations = parsed.dataExpectations ?? parsed.privacyRules ?? parsed.indexes;
            for (const expectation of Array.isArray(expectations) ? expectations : []) {
                scanRule(entityName, expectation, 'data_expectation', valueText(expectation).slice(0, 120));
            }
        }
    }

    if (region.aspect === 'entity' && entity) add({
        label: `${region.entityName} members`, kind: 'field', certainty: 'direct',
        explanation: 'Removing an entity also removes or strands its fields, relationships, constraints, and stored records.',
    });

    for (const document of input.documents) {
        const matched = targetTokens.find(value => value.length >= 3
            && new RegExp(`\\b${escaped(value).replace(/_/g, '[_\\s-]?')}\\b`, 'i').test(document.content));
        if (matched) add({
            label: document.label, kind: document.kind, certainty: 'possible',
            explanation: `This current ${document.kind} mentions ${matched}; the exact dependency must be reviewed before destructive application.`,
        });
    }

    const migrationImplications = input.destructive ? [
        region.aspect === 'field' ? 'Existing records may contain values for this field; removal can require a data migration or export decision.'
            : region.aspect === 'relationship' ? 'Existing links may need migration, archival, or cleanup at both relationship endpoints.'
                : region.aspect === 'entity' ? 'Existing records and inbound references require an explicit retention and migration decision.'
                    : 'Persisted data or validation behavior may need migration before this change is implemented.',
    ] : [];
    const blockReasons = dependencies.length > 0 && input.destructive
        ? ['Dependent data or planning regions are not included in this single-region proposal. Review them before applying a destructive change.']
        : [];
    return {
        relationshipEndpoints: endpoints,
        dependencies,
        migrationImplications,
        automaticApplicationBlocked: blockReasons.length > 0,
        blockReasons,
    };
}

function operationFor(change: UserGroundedDataModelChange | undefined, deterministicRemoval: boolean): DownstreamArtifactUpdateOperation {
    if (!change) return deterministicRemoval ? 'remove' : 'review_only';
    if (change.changeKind === 'remove' || change.changeKind === 'out_of_scope') return 'remove';
    if (change.changeKind === 'add') return 'add';
    return 'replace';
}

function groundedShapeValid(change: UserGroundedDataModelChange, region: DataModelRegion): boolean {
    const memberKind = change.memberKind ?? region.aspect;
    if (change.changeKind === 'add') return region.aspect === 'entity' && memberKind !== 'entity'
        && typeof change.content === 'string' && change.content.trim().length > 0;
    if (change.changeKind === 'remove' || change.changeKind === 'out_of_scope') return change.content === null;
    return memberKind === region.aspect && typeof change.content === 'string' && change.content.trim().length > 0;
}

function resultingRegionFor(change: UserGroundedDataModelChange | undefined, region: DataModelRegion): DataModelRegion | undefined {
    if (!change || change.content === null || change.changeKind === 'add') return undefined;
    const value = parseReplacement(change.content);
    if (region.aspect === 'entity') {
        const name = isRecord(value) && typeof value.name === 'string' ? value.name
            : typeof value === 'string' ? value.match(/^##\s+(.+)$/m)?.[1]?.trim() : undefined;
        return name && name !== region.entityName ? { ...region, entityName: name } : undefined;
    }
    let memberName: string | undefined;
    if (region.aspect === 'field') memberName = isRecord(value) && typeof value.name === 'string' ? value.name : undefined;
    else if (typeof value === 'string') memberName = value
        .replace(/^>\s*\[!(?:RELATIONSHIP|CONSTRAINT|PRIVACY|INDEX)\]\s*/i, '').trim();
    return memberName && memberName !== region.memberName ? { ...region, memberName, label: memberName } : undefined;
}

export function deriveDataModelArtifactUpdateProposal(input: ProposalInput): DataModelProposalResult {
    const { plan, item, artifactVersion } = input;
    if (plan.projectId !== input.projectId || plan.artifact.artifactVersionId !== artifactVersion.id
        || !plan.items.some(candidate => candidate.id === item.id)) return { ok: false, reason: 'binding_mismatch' };
    if (plan.artifact.slot !== 'data_model') return { ok: false, reason: 'unsupported_artifact' };
    if (item.region.kind === 'artifact_review') {
        const broad = resolveDownstreamUpdateRegionContent(artifactVersion, item.region);
        if (!broad.found || !broad.contentHash || broad.snapshot === undefined) return { ok: false, reason: 'region_missing' };
        const createdAt = input.createdAt ?? Date.now();
        const requestNonce = input.requestNonce ?? 'initial';
        return { ok: true, proposal: sealDownstreamArtifactUpdateProposal({
            schemaVersion: 1,
            id: `artifact-update-${hashReviewValue({ plan: plan.id, item: item.id, region: broad.contentHash, requestNonce, createdAt })}`,
            projectId: input.projectId, authoredBy: 'synapse',
            updatePlanBinding: {
                planId: plan.id, planIntegrityHash: plan.integrityHash, itemId: item.id,
                itemIntegrityHash: downstreamUpdatePlanItemIntegrityHash(plan, item),
            },
            source: plan.source, artifact: plan.artifact, region: item.region,
            regionKey: downstreamUpdateRegionKey(item.region), currentRegionContentHash: broad.contentHash,
            currentRegionSnapshot: broad.snapshot, currentRegionSnapshotTruncated: Boolean(broad.snapshotTruncated),
            operation: 'review_only', proposedContent: null, evidence: item.evidence,
            reasoning: 'Legacy or unstructured data-model provenance cannot support a precise writable change. Existing content remains preserved for manual review.',
            certainty: item.certainty, ...(item.ambiguity ? { ambiguity: item.ambiguity } : {}),
            preservedScope: item.preservedScope, preservedScopeHash: hashReviewValue(item.preservedScope),
            preservedRegionBindings: [],
            generator: {
                provider: 'synapse', model: 'bounded-data-model-planner',
                promptHash: hashReviewValue({ plan: plan.integrityHash, item, requestNonce }),
                reasoningVersion: 'phase-5-data-model-v1',
            },
            createdAt,
        }) };
    }
    if (item.region.kind !== 'data_model') return { ok: false, reason: 'unsupported_artifact' };
    const region = resolveDownstreamUpdateRegionContent(artifactVersion, item.region);
    if (!region.found || !region.contentHash || region.snapshot === undefined) return { ok: false, reason: 'region_missing' };
    if (input.userGroundedChange && !groundedShapeValid(input.userGroundedChange, item.region)) {
        return { ok: false, reason: 'invalid_user_context' };
    }
    const directRemoval = !input.userContextProvided && !input.userGroundedChange && plan.source.confirmed && item.certainty === 'definite'
        && item.evidence.some(candidate => candidate.quality === 'direct')
        && (item.recommendedAction === 'remove_obsolete_element'
            || /^Removed feature:/i.test(item.whyAffected));
    const requestedOperation = operationFor(input.userGroundedChange, directRemoval);
    const destructive = requestedOperation === 'remove';
    const baseAnalysis = dependencyAnalysis({
        version: artifactVersion, region: item.region, snapshot: region.snapshot,
        documents: input.dependencyDocuments ?? [], destructive,
    });
    const changeKind = input.userGroundedChange?.changeKind ?? (directRemoval ? 'remove' : 'replace');
    const memberKind = input.userGroundedChange?.memberKind ?? item.region.aspect;
    const format: DownstreamDataModelImpact['format'] = jsonEntities(artifactVersion.content) ? 'json' : 'markdown';
    const ambiguousMarkdownAdd = requestedOperation === 'add' && memberKind === 'field' && format === 'markdown'
        && markdownFieldTableCount(artifactVersion.content, item.region.entityName) !== 1;
    const analysis = ambiguousMarkdownAdd ? {
        ...baseAnalysis,
        automaticApplicationBlocked: true,
        blockReasons: [...baseAnalysis.blockReasons,
            'The target entity does not have one unambiguous field table. Choose an exact field group before applying this addition.'],
    } : baseAnalysis;
    const operation: DownstreamArtifactUpdateOperation = analysis.automaticApplicationBlocked
        ? 'review_only' : requestedOperation;
    const impact: DownstreamDataModelImpact = { changeKind, memberKind, destructive, format, ...analysis };
    const createdAt = input.createdAt ?? Date.now();
    const requestNonce = input.requestNonce ?? 'initial';
    const proposedContent = operation === 'review_only' || operation === 'remove'
        ? null : input.userGroundedChange?.content ?? null;
    const generator = {
        provider: 'synapse', model: 'bounded-data-model-planner',
        promptHash: hashReviewValue({ plan: plan.integrityHash, item, requestNonce, userGroundedChange: input.userGroundedChange }),
        reasoningVersion: 'phase-5-data-model-v1',
    };
    return { ok: true, proposal: sealDownstreamArtifactUpdateProposal({
        schemaVersion: 1,
        id: `artifact-update-${hashReviewValue({ plan: plan.id, item: item.id, region: region.contentHash, requestNonce, createdAt })}`,
        projectId: input.projectId,
        authoredBy: 'synapse',
        updatePlanBinding: {
            planId: plan.id, planIntegrityHash: plan.integrityHash, itemId: item.id,
            itemIntegrityHash: downstreamUpdatePlanItemIntegrityHash(plan, item),
        },
        source: plan.source,
        artifact: plan.artifact,
        region: item.region,
        regionKey: downstreamUpdateRegionKey(item.region),
        ...(resultingRegionFor(input.userGroundedChange, item.region) ? {
            resultingRegion: resultingRegionFor(input.userGroundedChange, item.region),
        } : {}),
        currentRegionContentHash: region.contentHash,
        currentRegionSnapshot: region.snapshot,
        currentRegionSnapshotTruncated: Boolean(region.snapshotTruncated),
        operation,
        proposedContent,
        dataModelImpact: impact,
        evidence: item.evidence,
        reasoning: analysis.automaticApplicationBlocked
            ? 'This exact region is affected, but dependent regions or unresolved references make automatic application unsafe.'
            : operation === 'review_only'
                ? input.userContextProvided && !input.userGroundedChange
                    ? 'The user context is preserved, but it does not specify a complete exact operation and content. Manual review remains safer than inventing a change.'
                    : 'The exact region is available, but current durable state does not contain an exact safe change. Provide explicit structured context or edit manually.'
                : input.userGroundedChange
                    ? 'This bounded change uses exact content supplied by the user and remains subject to approval and currentness checks.'
                    : 'The confirmed removed feature and direct trace support removing this exact region without changing preserved regions.',
        certainty: item.certainty,
        ...(item.ambiguity ? { ambiguity: item.ambiguity } : {}),
        preservedScope: item.preservedScope,
        preservedScopeHash: hashReviewValue(item.preservedScope),
        preservedRegionBindings: preservedBindings(artifactVersion, item.region),
        generator,
        createdAt,
    }) };
}

type ApplyResult =
    | { ok: true; content: string; resultingRegionContentHash: string }
    | { ok: false; reason: 'unsupported_region' | 'invalid_content' | 'target_missing' | 'no_change' | 'dependency_blocked' };

function effectiveChange(proposal: DownstreamArtifactUpdateProposal, review: DownstreamArtifactUpdateReviewEvent): {
    operation: Exclude<DownstreamArtifactUpdateOperation, 'review_only'>;
    content: string | null;
} | undefined {
    if (review.action === 'edited') return { operation: review.operation, content: review.editedContent };
    if (review.action === 'accepted' && proposal.operation !== 'review_only') return {
        operation: proposal.operation, content: proposal.proposedContent,
    };
    return undefined;
}

function parseReplacement(content: string): unknown {
    try { return JSON.parse(content); } catch { return content; }
}

function applyJson(input: {
    content: string;
    region: DataModelRegion;
    operation: Exclude<DownstreamArtifactUpdateOperation, 'review_only'>;
    proposedContent: string | null;
    impact: DownstreamDataModelImpact;
}): string | undefined {
    const root = parseJsonRecord(input.content);
    if (!root || !Array.isArray(root.entities)) return undefined;
    const entities = root.entities as unknown[];
    const entityIndex = entities.findIndex(candidate => isRecord(candidate) && candidate.name === input.region.entityName);
    if (entityIndex < 0 || !isRecord(entities[entityIndex])) return undefined;
    const entity = entities[entityIndex] as MutableRecord;
    if (input.region.aspect === 'entity' && input.operation !== 'add') {
        if (input.operation === 'remove') entities.splice(entityIndex, 1);
        else if (input.proposedContent !== null) {
            const replacement = parseReplacement(input.proposedContent);
            if (!isRecord(replacement)) return undefined;
            entities[entityIndex] = replacement;
        } else return undefined;
        return JSON.stringify(root);
    }
    const memberKind = input.operation === 'add' ? input.impact.memberKind : input.region.aspect;
    const key = memberKind === 'field' ? 'fields'
        : memberKind === 'relationship' ? 'relationships'
            : memberKind === 'constraint' ? 'constraints'
                : memberKind === 'data_expectation'
                    ? (Array.isArray(entity.dataExpectations) ? 'dataExpectations'
                        : Array.isArray(entity.privacyRules) ? 'privacyRules' : 'dataExpectations')
                    : undefined;
    if (!key) return undefined;
    if (!Array.isArray(entity[key])) entity[key] = [];
    const values = entity[key] as unknown[];
    if (input.operation === 'add') {
        if (input.proposedContent === null) return undefined;
        values.push(parseReplacement(input.proposedContent));
        return JSON.stringify(root);
    }
    const memberIndex = values.findIndex(value => {
        if (memberKind === 'field') return isRecord(value) && value.name === input.region.memberName;
        if (typeof value === 'string') return value === input.region.memberName;
        if (!isRecord(value)) return false;
        return value.name === input.region.memberName || value.target === input.region.memberName
            || value.description === input.region.memberName
            || [value.type, value.target, value.description].filter(part => typeof part === 'string').join(' → ') === input.region.memberName;
    });
    if (memberIndex < 0) return undefined;
    if (input.operation === 'remove') values.splice(memberIndex, 1);
    else if (input.proposedContent !== null) values[memberIndex] = parseReplacement(input.proposedContent);
    else return undefined;
    return JSON.stringify(root);
}

type EntitySlice = { start: number; end: number; text: string };
function markdownEntitySlice(content: string, entityName: string): EntitySlice | undefined {
    const heading = new RegExp(`^##\\s+${escaped(entityName)}\\s*$`, 'im').exec(content);
    if (!heading || heading.index === undefined) return undefined;
    const next = /^##\s+.+$/gim;
    next.lastIndex = heading.index + heading[0].length;
    const nextMatch = next.exec(content);
    return { start: heading.index, end: nextMatch?.index ?? content.length, text: content.slice(heading.index, nextMatch?.index ?? content.length) };
}

function replacementLine(input: {
    memberKind: DownstreamDataModelImpact['memberKind'];
    content: string;
}): string | undefined {
    const value = parseReplacement(input.content);
    if (input.memberKind === 'field') {
        if (typeof value === 'string') return value.trim();
        if (!isRecord(value) || typeof value.name !== 'string' || typeof value.type !== 'string'
            || typeof value.required !== 'boolean' || typeof value.description !== 'string') return undefined;
        return `| ${value.name} | ${value.type} | ${value.required ? 'Yes' : 'No'} | ${value.description.replaceAll('|', '\\|')} |`;
    }
    if (typeof value !== 'string') return undefined;
    if (input.memberKind === 'relationship') return value.startsWith('> [!RELATIONSHIP]') ? value : `> [!RELATIONSHIP] ${value}`;
    if (input.memberKind === 'constraint') return value.startsWith('> [!CONSTRAINT]') ? value : `> [!CONSTRAINT] ${value}`;
    if (input.memberKind === 'data_expectation') return /^> \[!(?:PRIVACY|INDEX)\]/.test(value) ? value : `> [!PRIVACY] ${value}`;
    return value;
}

function markdownMemberLine(slice: EntitySlice, region: DataModelRegion): { start: number; end: number } | undefined {
    const lines = [...slice.text.matchAll(/.*(?:\n|$)/g)].filter(match => match[0]);
    for (const line of lines) {
        const text = line[0].replace(/\r?\n$/, '');
        let matches = false;
        if (region.aspect === 'field') {
            const cells = text.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(cell => cell.trim());
            matches = cells[0] === region.memberName;
        } else if (region.aspect === 'relationship') matches = text.replace(/^>\s*\[!RELATIONSHIP\]\s*/i, '').trim() === region.memberName;
        else if (region.aspect === 'constraint') matches = text.replace(/^>\s*\[!CONSTRAINT\]\s*/i, '').trim() === region.memberName;
        else if (region.aspect === 'data_expectation') matches = text.replace(/^>\s*\[!(?:PRIVACY|INDEX)\]\s*/i, '').trim() === region.memberName;
        if (matches && line.index !== undefined) return {
            start: slice.start + line.index,
            end: slice.start + line.index + line[0].length,
        };
    }
    return undefined;
}

function applyMarkdown(input: {
    content: string;
    region: DataModelRegion;
    operation: Exclude<DownstreamArtifactUpdateOperation, 'review_only'>;
    proposedContent: string | null;
    impact: DownstreamDataModelImpact;
}): string | undefined {
    const slice = markdownEntitySlice(input.content, input.region.entityName);
    if (!slice) return undefined;
    if (input.region.aspect === 'entity' && input.operation !== 'add') {
        if (input.operation === 'remove') return input.content.slice(0, slice.start) + input.content.slice(slice.end);
        if (input.proposedContent === null) return undefined;
        return input.content.slice(0, slice.start) + input.proposedContent.trimEnd() + '\n\n' + input.content.slice(slice.end).replace(/^\s*/, '');
    }
    if (input.operation === 'add') {
        if (input.proposedContent === null) return undefined;
        const line = replacementLine({ memberKind: input.impact.memberKind, content: input.proposedContent });
        if (!line) return undefined;
        let insertion = slice.end;
        if (input.impact.memberKind === 'field') {
            const fieldRows = [...slice.text.matchAll(/^\|.*\|\s*$/gm)].filter(match => {
                const text = match[0];
                return !/\bField\b.*\bType\b.*\bRequired\b/i.test(text) && !/^\|?\s*[-:|\s]+\|?\s*$/.test(text);
            });
            const last = fieldRows.at(-1);
            if (!last || last.index === undefined) return undefined;
            insertion = slice.start + last.index + last[0].length;
            const suffix = input.content.slice(insertion);
            return input.content.slice(0, insertion) + '\n' + line + suffix;
        }
        const prefix = input.content.slice(0, insertion).replace(/\s*$/, '\n\n');
        return prefix + line + '\n\n' + input.content.slice(insertion).replace(/^\s*/, '');
    }
    const target = markdownMemberLine(slice, input.region);
    if (!target) return undefined;
    if (input.operation === 'remove') return input.content.slice(0, target.start) + input.content.slice(target.end);
    if (input.proposedContent === null) return undefined;
    const line = replacementLine({ memberKind: input.region.aspect, content: input.proposedContent });
    if (!line) return undefined;
    const newline = input.content.slice(target.start, target.end).endsWith('\n') ? '\n' : '';
    return input.content.slice(0, target.start) + line + newline + input.content.slice(target.end);
}

export function applyDataModelArtifactUpdate(input: {
    proposal: DownstreamArtifactUpdateProposal;
    review: DownstreamArtifactUpdateReviewEvent;
    artifactVersion: ArtifactVersion;
}): ApplyResult {
    const { proposal, review, artifactVersion } = input;
    if (proposal.artifact.slot !== 'data_model' || proposal.region.kind !== 'data_model' || !proposal.dataModelImpact) {
        return { ok: false, reason: 'unsupported_region' };
    }
    if (proposal.dataModelImpact.automaticApplicationBlocked) return { ok: false, reason: 'dependency_blocked' };
    const effective = effectiveChange(proposal, review);
    if (!effective) return { ok: false, reason: 'unsupported_region' };
    const next = proposal.dataModelImpact.format === 'json'
        ? applyJson({ content: artifactVersion.content, region: proposal.region, operation: effective.operation,
            proposedContent: effective.content, impact: proposal.dataModelImpact })
        : applyMarkdown({ content: artifactVersion.content, region: proposal.region, operation: effective.operation,
            proposedContent: effective.content, impact: proposal.dataModelImpact });
    if (next === undefined) return { ok: false, reason: 'target_missing' };
    if (next === artifactVersion.content) return { ok: false, reason: 'no_change' };
    const result = resolveDownstreamUpdateRegionContent({ content: next }, downstreamArtifactUpdateResultRegion(proposal));
    if (effective.operation === 'remove') {
        if (result.found) return { ok: false, reason: 'invalid_content' };
        return { ok: true, content: next, resultingRegionContentHash: removedDownstreamUpdateRegionHash(proposal.region) };
    }
    if (!result.found || !result.contentHash) return { ok: false, reason: 'invalid_content' };
    return { ok: true, content: next, resultingRegionContentHash: result.contentHash };
}
