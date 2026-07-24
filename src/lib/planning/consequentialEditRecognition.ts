import type {
    ArtifactSlotKey,
    DecisionEvent,
    PlanningRecord,
    PlanningRecordType,
    PlanningLocation,
    PlanningSourceRef,
    StructuredPRD,
} from '../../types';
import { PLANNING_RECORD_SCHEMA_VERSION } from '../../types';
import { appendDecisionEvent, isDecisionVerdictEvent, projectDecision } from './decisionProjection';

export type PrdEditClassification = 'copy_edit' | 'possibly_consequential' | 'meaning_changed';
export type PrdEditConfidence = 'high' | 'medium';

export type ConsequentialPrdEditChange = {
    /** Stable identity for repeated edits to the same planning claim. */
    key: string;
    section: string;
    label: string;
    entityId?: string;
    before: string;
    after: string;
    classification: Exclude<PrdEditClassification, 'copy_edit'>;
    confidence: PrdEditConfidence;
    /** Exact means the structured mutation itself can be represented without interpretation. */
    authority: 'explicit_user_change' | 'synapse_inference';
    recordType: PlanningRecordType;
    reason: string;
    materiality: 'blocking' | 'high' | 'normal' | 'low';
    affectedPrdSections: string[];
    /** Source claim plus deterministic downstream review targets. */
    affectedPlanLocations: PlanningLocation[];
    affectedArtifactSlots: ArtifactSlotKey[];
};

export type ConsequentialPrdEditAnalysis = {
    classification: PrdEditClassification;
    confidence?: PrdEditConfidence;
    reason: string;
    changes: ConsequentialPrdEditChange[];
    affectedPrdSections: string[];
    affectedPlanLocations: PlanningLocation[];
    affectedArtifactSlots: ArtifactSlotKey[];
};

export type ConsequentialPrdEditRecognition = ConsequentialPrdEditAnalysis & {
    planningRecordIds: string[];
    possibleConflictRecordIds: string[];
};

type IdFactory = () => string;

export type RecordConsequentialPrdEditInput = {
    projectId: string;
    sourceSpineVersionId: string;
    before: StructuredPRD;
    after: StructuredPRD;
    existingRecords: PlanningRecord[];
    at: number;
    idFactory: IdFactory;
};

export type RecordConsequentialPrdEditResult = {
    records: PlanningRecord[];
    recognition: ConsequentialPrdEditRecognition;
};

const ALL_ARTIFACT_SLOTS: ArtifactSlotKey[] = [
    'screen_inventory',
    'user_flows',
    'component_inventory',
    'data_model',
    'implementation_plan',
    'mockup',
];

const SECTION_IMPACT: Record<string, { sections: string[]; slots: ArtifactSlotKey[] }> = {
    vision: {
        sections: ['Vision', 'Core Problem', 'Target Users', 'Features', 'Success Metrics'],
        slots: ALL_ARTIFACT_SLOTS,
    },
    coreProblem: {
        sections: ['Core Problem', 'Vision', 'Target Users', 'Features', 'Success Metrics'],
        slots: ALL_ARTIFACT_SLOTS,
    },
    targetUsers: {
        sections: ['Target Users', 'Jobs to Be Done', 'Features', 'UX Pages', 'Success Metrics'],
        slots: ['screen_inventory', 'user_flows', 'component_inventory', 'implementation_plan', 'mockup'],
    },
    features: {
        sections: ['Features', 'Proposed First Release', 'User Flows', 'UX Pages', 'Architecture', 'Data Model', 'Success Metrics', 'Implementation Plan'],
        slots: ['screen_inventory', 'user_flows', 'component_inventory', 'data_model', 'implementation_plan', 'mockup'],
    },
    architecture: {
        sections: ['Architecture', 'Architecture Flows', 'Data Model', 'Constraints', 'Non-Functional Requirements', 'Implementation Plan'],
        slots: ['user_flows', 'component_inventory', 'data_model', 'implementation_plan'],
    },
    risks: {
        sections: ['Risks', 'Features', 'Architecture', 'Implementation Plan'],
        slots: ['data_model', 'implementation_plan'],
    },
    constraints: {
        sections: ['Constraints', 'Features', 'Architecture', 'UX Pages', 'Implementation Plan'],
        slots: ALL_ARTIFACT_SLOTS,
    },
    nonFunctionalRequirements: {
        sections: ['Non-Functional Requirements', 'Architecture', 'Data Model', 'Implementation Plan'],
        slots: ['component_inventory', 'data_model', 'implementation_plan'],
    },
    primaryActions: {
        sections: ['Primary Actions', 'Features', 'User Flows', 'UX Pages'],
        slots: ['screen_inventory', 'user_flows', 'component_inventory', 'implementation_plan', 'mockup'],
    },
    domainEntities: {
        sections: ['Domain Entities', 'Features', 'Data Model', 'Architecture'],
        slots: ['screen_inventory', 'user_flows', 'data_model', 'implementation_plan', 'mockup'],
    },
    mvpScope: {
        sections: ['Proposed First Release', 'Features', 'User Flows', 'UX Pages', 'Implementation Plan'],
        slots: ALL_ARTIFACT_SLOTS,
    },
    successMetrics: {
        sections: ['Success Metrics', 'Core Problem', 'Features', 'Implementation Plan'],
        slots: ['screen_inventory', 'user_flows', 'implementation_plan'],
    },
};

const SOURCE_LOCATION: Record<string, Pick<PlanningLocation, 'kind' | 'section' | 'label' | 'jsonPath'>> = {
    vision: { kind: 'claim', section: 'Vision', label: 'Vision', jsonPath: '$.vision' },
    coreProblem: { kind: 'claim', section: 'Core Problem', label: 'Core problem', jsonPath: '$.coreProblem' },
    targetUsers: { kind: 'claim', section: 'Target Users', label: 'Primary users', jsonPath: '$.targetUsers' },
    architecture: { kind: 'claim', section: 'Architecture', label: 'Architecture approach', jsonPath: '$.architecture' },
    risks: { kind: 'claim', section: 'Risks', label: 'Risk list', jsonPath: '$.risks' },
    constraints: { kind: 'constraint', section: 'Constraints', label: 'Project constraints', jsonPath: '$.constraints' },
    nonFunctionalRequirements: { kind: 'requirement', section: 'Non-Functional Requirements', label: 'Quality requirements', jsonPath: '$.nonFunctionalRequirements' },
    primaryActions: { kind: 'behavior', section: 'Primary Actions', label: 'Core product actions', jsonPath: '$.primaryActions' },
    domainEntities: { kind: 'data_expectation', section: 'Domain Entities', label: 'Product data vocabulary', jsonPath: '$.domainEntities' },
    mvpScope: { kind: 'scope', section: 'Proposed First Release', label: 'Release scope', jsonPath: '$.mvpScope' },
    successMetrics: { kind: 'success_criterion', section: 'Success Metrics', label: 'Success metrics', jsonPath: '$.successMetrics' },
    features: { kind: 'feature', section: 'Features', label: 'Feature', jsonPath: '$.features' },
};

const TARGET_LOCATIONS: Partial<Record<string, PlanningLocation[]>> = {
    vision: [
        { kind: 'claim', section: 'Core Problem', label: 'Problem definition', jsonPath: '$.coreProblem' },
        { kind: 'claim', section: 'Target Users', label: 'Primary users', jsonPath: '$.targetUsers' },
        { kind: 'feature', section: 'Features', label: 'Feature set', jsonPath: '$.features' },
        { kind: 'success_criterion', section: 'Success Metrics', label: 'Success metrics', jsonPath: '$.successMetrics' },
    ],
    coreProblem: [
        { kind: 'claim', section: 'Vision', label: 'Product vision', jsonPath: '$.vision' },
        { kind: 'claim', section: 'Target Users', label: 'Primary users', jsonPath: '$.targetUsers' },
        { kind: 'feature', section: 'Features', label: 'Feature set', jsonPath: '$.features' },
        { kind: 'success_criterion', section: 'Success Metrics', label: 'Success metrics', jsonPath: '$.successMetrics' },
    ],
    targetUsers: [
        { kind: 'claim', section: 'Jobs to Be Done', label: 'User jobs', jsonPath: '$.jtbd' },
        { kind: 'feature', section: 'Features', label: 'Feature set', jsonPath: '$.features' },
        { kind: 'flow_step', section: 'UX Pages', label: 'User experience', jsonPath: '$.uxPages' },
        { kind: 'success_criterion', section: 'Success Metrics', label: 'Success metrics', jsonPath: '$.successMetrics' },
    ],
    features: [
        { kind: 'flow_step', section: 'User Flows', label: 'Core user flows', jsonPath: '$.userLoops' },
        { kind: 'flow_step', section: 'UX Pages', label: 'User experience', jsonPath: '$.uxPages' },
        { kind: 'claim', section: 'Architecture', label: 'Architecture approach', jsonPath: '$.architecture' },
        { kind: 'data_expectation', section: 'Data Model', label: 'Product data model', jsonPath: '$.richDataModel' },
        { kind: 'success_criterion', section: 'Success Metrics', label: 'Success metrics', jsonPath: '$.successMetrics' },
        { kind: 'scope', section: 'Implementation Plan', label: 'Implementation sequence', jsonPath: '$.implementationPlan' },
    ],
    architecture: [
        { kind: 'flow_step', section: 'Architecture Flows', label: 'Architecture flows', jsonPath: '$.architectureFlows' },
        { kind: 'data_expectation', section: 'Data Model', label: 'Product data model', jsonPath: '$.richDataModel' },
        { kind: 'constraint', section: 'Constraints', label: 'Project constraints', jsonPath: '$.constraints' },
        { kind: 'requirement', section: 'Non-Functional Requirements', label: 'Quality requirements', jsonPath: '$.nonFunctionalRequirements' },
        { kind: 'scope', section: 'Implementation Plan', label: 'Implementation sequence', jsonPath: '$.implementationPlan' },
    ],
    constraints: [
        { kind: 'feature', section: 'Features', label: 'Feature set', jsonPath: '$.features' },
        { kind: 'claim', section: 'Architecture', label: 'Architecture approach', jsonPath: '$.architecture' },
        { kind: 'flow_step', section: 'UX Pages', label: 'User experience', jsonPath: '$.uxPages' },
        { kind: 'scope', section: 'Implementation Plan', label: 'Implementation sequence', jsonPath: '$.implementationPlan' },
    ],
    nonFunctionalRequirements: [
        { kind: 'claim', section: 'Architecture', label: 'Architecture approach', jsonPath: '$.architecture' },
        { kind: 'data_expectation', section: 'Data Model', label: 'Product data model', jsonPath: '$.richDataModel' },
        { kind: 'scope', section: 'Implementation Plan', label: 'Implementation sequence', jsonPath: '$.implementationPlan' },
    ],
    primaryActions: [
        { kind: 'feature', section: 'Features', label: 'Feature set', jsonPath: '$.features' },
        { kind: 'flow_step', section: 'User Flows', label: 'Core user flows', jsonPath: '$.userLoops' },
        { kind: 'flow_step', section: 'UX Pages', label: 'User experience', jsonPath: '$.uxPages' },
    ],
    domainEntities: [
        { kind: 'feature', section: 'Features', label: 'Feature set', jsonPath: '$.features' },
        { kind: 'data_expectation', section: 'Data Model', label: 'Product data model', jsonPath: '$.richDataModel' },
        { kind: 'claim', section: 'Architecture', label: 'Architecture approach', jsonPath: '$.architecture' },
    ],
    mvpScope: [
        { kind: 'feature', section: 'Features', label: 'Feature tiers', jsonPath: '$.features' },
        { kind: 'flow_step', section: 'User Flows', label: 'Core user flows', jsonPath: '$.userLoops' },
        { kind: 'flow_step', section: 'UX Pages', label: 'User experience', jsonPath: '$.uxPages' },
        { kind: 'scope', section: 'Implementation Plan', label: 'Implementation sequence', jsonPath: '$.implementationPlan' },
    ],
    successMetrics: [
        { kind: 'claim', section: 'Core Problem', label: 'Problem definition', jsonPath: '$.coreProblem' },
        { kind: 'feature', section: 'Features', label: 'Feature set', jsonPath: '$.features' },
        { kind: 'scope', section: 'Implementation Plan', label: 'Measurement work', jsonPath: '$.implementationPlan' },
    ],
    risks: [
        { kind: 'feature', section: 'Features', label: 'Feature set', jsonPath: '$.features' },
        { kind: 'claim', section: 'Architecture', label: 'Architecture approach', jsonPath: '$.architecture' },
        { kind: 'scope', section: 'Implementation Plan', label: 'Risk mitigation work', jsonPath: '$.implementationPlan' },
    ],
};

const dedupe = <T,>(values: T[]): T[] => [...new Set(values)];
const dedupeLocations = (locations: PlanningLocation[]): PlanningLocation[] => {
    const seen = new Set<string>();
    return locations.filter(location => {
        const key = `${location.kind}:${location.section}:${location.jsonPath ?? ''}:${location.entityId ?? ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

const normalizeCopy = (value: string): string => value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

const tokens = (value: string): string[] => normalizeCopy(value).split(' ').filter(Boolean);

const tokenSimilarity = (before: string, after: string): number => {
    const left = tokens(before);
    const right = tokens(after);
    if (left.length === 0 && right.length === 0) return 1;
    const counts = new Map<string, number>();
    for (const token of left) counts.set(token, (counts.get(token) ?? 0) + 1);
    let intersection = 0;
    for (const token of right) {
        const count = counts.get(token) ?? 0;
        if (count > 0) {
            intersection += 1;
            counts.set(token, count - 1);
        }
    }
    return (2 * intersection) / Math.max(1, left.length + right.length);
};

// These terms often flip product behavior even in a short edit. They are not
// used to infer the answer; they only prevent a meaning-changing edit from
// being dismissed as punctuation/copy cleanup.
const CONSEQUENCE_MARKERS = new Set([
    'not', 'no', 'never', 'only', 'must', 'required', 'optional', 'without',
    'anonymous', 'account', 'login', 'local', 'cloud', 'offline', 'online',
    'private', 'public', 'shared', 'collaboration', 'automatic', 'manual',
    'mobile', 'desktop', 'web', 'native', 'enterprise', 'consumer', 'admin',
    'owner', 'encrypted', 'retained', 'deleted', 'sync', 'export', 'import',
]);

const markers = (value: string): string[] => tokens(value).filter(token =>
    CONSEQUENCE_MARKERS.has(token) || /^\d+(?:\.\d+)?$/.test(token),
);

const classifyTextChange = (before: string, after: string): {
    classification: PrdEditClassification;
    confidence?: PrdEditConfidence;
    reason: string;
} => {
    if (before === after || normalizeCopy(before) === normalizeCopy(after)) {
        return { classification: 'copy_edit', reason: 'Only capitalization, spacing, or punctuation changed.' };
    }
    const similarity = tokenSimilarity(before, after);
    const beforeMarkers = markers(before).join('|');
    const afterMarkers = markers(after).join('|');
    if (similarity >= 0.86 && beforeMarkers === afterMarkers) {
        return { classification: 'copy_edit', reason: 'The same concepts remain after a small wording edit.' };
    }
    if (beforeMarkers !== afterMarkers) {
        return {
            classification: 'possibly_consequential',
            confidence: 'medium',
            reason: 'The edit changes a term that often controls product behavior, scope, access, platform, or data expectations.',
        };
    }
    return {
        classification: 'possibly_consequential',
        confidence: 'medium',
        reason: 'The concepts in this planning statement changed enough to require review.',
    };
};

const renderList = (values: string[] | undefined): string => (values ?? []).map(value => value.trim()).filter(Boolean).join('\n');
const renderActions = (prd: StructuredPRD): string => (prd.primaryActions ?? []).map(action => `${action.verb} ${action.target}`.trim()).join('\n');
const renderEntities = (prd: StructuredPRD): string => (prd.domainEntities ?? []).map(entity =>
    `${entity.name}${entity.description ? `: ${entity.description}` : ''}`,
).join('\n');
const renderMvpScope = (prd: StructuredPRD): string => {
    const scope = prd.mvpScope;
    if (!scope) return '';
    return [`MVP: ${scope.mvp.join(', ')}`, `V1: ${scope.v1.join(', ')}`, `Later: ${scope.later.join(', ')}`].join('\n');
};
const renderMetrics = (prd: StructuredPRD): string => (prd.successMetrics ?? []).map(metric =>
    `${metric.name}${metric.target ? `: ${metric.target}` : ''}`,
).join('\n');

const changeFor = (
    section: keyof typeof SECTION_IMPACT,
    label: string,
    before: string,
    after: string,
    options: {
        key?: string;
        entityId?: string;
        authority: ConsequentialPrdEditChange['authority'];
        recordType?: PlanningRecordType;
        reason: string;
        materiality?: ConsequentialPrdEditChange['materiality'];
        sourceKind?: PlanningLocation['kind'];
        jsonPath?: string;
    },
): ConsequentialPrdEditChange | null => {
    if (normalizeCopy(before) === normalizeCopy(after)) return null;
    const impact = SECTION_IMPACT[section];
    const baseSource = SOURCE_LOCATION[section];
    const sourceLocation: PlanningLocation = {
        ...baseSource,
        kind: options.sourceKind ?? baseSource.kind,
        label,
        jsonPath: options.jsonPath ?? baseSource.jsonPath,
        entityType: options.entityId ? 'feature' : undefined,
        entityId: options.entityId,
        excerpt: after.trim() || before.trim(),
    };
    const textClassification = options.authority === 'synapse_inference'
        ? classifyTextChange(before, after)
        : { classification: 'meaning_changed' as const, confidence: 'high' as const, reason: options.reason };
    if (textClassification.classification === 'copy_edit') return null;
    return {
        key: options.key ?? String(section),
        section: String(section),
        label,
        entityId: options.entityId,
        before,
        after,
        classification: textClassification.classification,
        confidence: textClassification.confidence ?? 'medium',
        authority: options.authority,
        recordType: options.recordType ?? 'decision',
        reason: options.authority === 'synapse_inference' ? textClassification.reason : options.reason,
        materiality: options.materiality ?? 'high',
        affectedPrdSections: impact.sections,
        affectedPlanLocations: dedupeLocations([sourceLocation, ...(TARGET_LOCATIONS[section] ?? [])]),
        affectedArtifactSlots: impact.slots,
    };
};

const meaningfulFeature = (name: string, description: string): boolean =>
    normalizeCopy(name) !== 'new feature' || normalizeCopy(description).length > 0;

/**
 * Deterministically separates quiet copy cleanup from structural product
 * changes. Freeform prose is never treated as a user-confirmed interpretation:
 * it yields a bounded Synapse inference for review.
 */
export function analyzeConsequentialPrdEdit(before: StructuredPRD, after: StructuredPRD): ConsequentialPrdEditAnalysis {
    const changes: ConsequentialPrdEditChange[] = [];
    const push = (change: ConsequentialPrdEditChange | null) => { if (change) changes.push(change); };

    push(changeFor('vision', 'Vision', before.vision, after.vision, {
        authority: 'synapse_inference', reason: '', materiality: 'high',
    }));
    push(changeFor('coreProblem', 'Core Problem', before.coreProblem, after.coreProblem, {
        authority: 'synapse_inference', reason: '', materiality: 'blocking',
    }));
    push(changeFor('targetUsers', 'Primary users', renderList(before.targetUsers), renderList(after.targetUsers), {
        authority: 'explicit_user_change',
        reason: 'The structured primary-user list changed.',
        materiality: 'blocking',
    }));
    push(changeFor('architecture', 'Architecture', before.architecture, after.architecture, {
        authority: 'synapse_inference', reason: '', materiality: 'high',
    }));
    push(changeFor('risks', 'Risks', renderList(before.risks), renderList(after.risks), {
        authority: 'explicit_user_change', recordType: 'risk',
        reason: 'The explicit risk list changed.', materiality: 'normal',
    }));
    push(changeFor('constraints', 'Constraints', renderList(before.constraints), renderList(after.constraints), {
        authority: 'explicit_user_change',
        reason: 'An explicit project constraint was added, removed, or changed.',
        materiality: 'high',
    }));
    push(changeFor('nonFunctionalRequirements', 'Non-Functional Requirements', renderList(before.nonFunctionalRequirements), renderList(after.nonFunctionalRequirements), {
        authority: 'explicit_user_change',
        reason: 'An explicit quality or operational requirement changed.',
        materiality: 'high',
    }));
    push(changeFor('primaryActions', 'Primary Actions', renderActions(before), renderActions(after), {
        authority: 'explicit_user_change',
        reason: 'The structured core-action list changed.',
        materiality: 'high',
    }));
    push(changeFor('domainEntities', 'Domain Entities', renderEntities(before), renderEntities(after), {
        authority: 'explicit_user_change',
        reason: 'The structured product-data vocabulary changed.',
        materiality: 'high',
    }));
    push(changeFor('mvpScope', 'Proposed First Release', renderMvpScope(before), renderMvpScope(after), {
        authority: 'explicit_user_change',
        reason: 'The structured release scope changed.',
        materiality: 'blocking',
    }));
    push(changeFor('successMetrics', 'Success Metrics', renderMetrics(before), renderMetrics(after), {
        authority: 'explicit_user_change',
        reason: 'The structured definition of success changed.',
        materiality: 'high',
    }));

    const beforeFeatures = new Map(before.features.map(feature => [feature.id, feature]));
    const afterFeatures = new Map(after.features.map(feature => [feature.id, feature]));
    for (const [id, feature] of beforeFeatures) {
        const next = afterFeatures.get(id);
        if (!next) {
            if (!meaningfulFeature(feature.name, feature.description)) continue;
            push(changeFor('features', `Feature removed: ${feature.name}`, `${feature.name}: ${feature.description}`, '', {
                key: `feature:${id}:scope`, entityId: id, authority: 'explicit_user_change',
                reason: 'A feature was removed from the plan.', materiality: feature.tier === 'later' ? 'normal' : 'high',
                sourceKind: 'scope', jsonPath: '$.features',
            }));
            continue;
        }
        const wasMeaningful = meaningfulFeature(feature.name, feature.description);
        const isMeaningful = meaningfulFeature(next.name, next.description);
        if (!wasMeaningful && isMeaningful) {
            push(changeFor('features', `Feature added: ${next.name}`, '', `${next.name}: ${next.description}`, {
                key: `feature:${id}:scope`, entityId: id, authority: 'explicit_user_change',
                reason: 'A feature was added to the plan.', materiality: next.tier === 'later' ? 'normal' : 'high',
                sourceKind: 'scope', jsonPath: '$.features',
            }));
            continue;
        }
        if (wasMeaningful && !isMeaningful) {
            push(changeFor('features', `Feature removed: ${feature.name}`, `${feature.name}: ${feature.description}`, '', {
                key: `feature:${id}:scope`, entityId: id, authority: 'explicit_user_change',
                reason: 'A feature was removed from the plan.', materiality: feature.tier === 'later' ? 'normal' : 'high',
                sourceKind: 'scope', jsonPath: '$.features',
            }));
            continue;
        }
        if ((feature.tier ?? 'mvp') !== (next.tier ?? 'mvp')) {
            push(changeFor('features', `Release scope: ${next.name}`, feature.tier ?? 'mvp', next.tier ?? 'mvp', {
                key: `feature:${id}:tier`, entityId: id, authority: 'explicit_user_change',
                reason: 'The feature moved between release tiers.', materiality: 'high',
                sourceKind: 'scope', jsonPath: '$.features.tier',
            }));
        }
        const beforeMeaning = `${feature.name}\n${feature.description}\n${feature.userValue}`;
        const afterMeaning = `${next.name}\n${next.description}\n${next.userValue}`;
        push(changeFor('features', `Feature meaning: ${next.name}`, beforeMeaning, afterMeaning, {
            key: `feature:${id}:meaning`, entityId: id, authority: 'synapse_inference',
            reason: '', materiality: next.tier === 'later' ? 'normal' : 'high',
            sourceKind: 'feature', jsonPath: '$.features',
        }));
        const requirementFields = [
            { field: 'acceptanceCriteria' as const, label: 'Acceptance criteria', kind: 'requirement' as const },
            { field: 'successCriteria' as const, label: 'Success criteria', kind: 'success_criterion' as const },
            { field: 'uiAcceptanceCriteria' as const, label: 'UI acceptance criteria', kind: 'behavior' as const },
        ];
        for (const requirement of requirementFields) {
            push(changeFor(
                'features',
                `${requirement.label}: ${next.name}`,
                renderList(feature[requirement.field]),
                renderList(next[requirement.field]),
                {
                    key: `feature:${id}:${requirement.field}`,
                    entityId: id,
                    authority: 'explicit_user_change',
                    reason: `The feature’s explicit ${requirement.label.toLowerCase()} changed.`,
                    materiality: next.tier === 'later' ? 'normal' : 'high',
                    sourceKind: requirement.kind,
                    jsonPath: `$.features.${requirement.field}`,
                },
            ));
        }
    }
    for (const [id, feature] of afterFeatures) {
        if (beforeFeatures.has(id) || !meaningfulFeature(feature.name, feature.description)) continue;
        push(changeFor('features', `Feature added: ${feature.name}`, '', `${feature.name}: ${feature.description}`, {
            key: `feature:${id}:scope`, entityId: id, authority: 'explicit_user_change',
            reason: 'A feature was added to the plan.', materiality: feature.tier === 'later' ? 'normal' : 'high',
            sourceKind: 'scope', jsonPath: '$.features',
        }));
    }

    if (changes.length === 0) {
        return {
            classification: 'copy_edit',
            reason: 'No structural or meaning-changing planning edit was detected.',
            changes: [],
            affectedPrdSections: [],
            affectedPlanLocations: [],
            affectedArtifactSlots: [],
        };
    }
    const meaningChanged = changes.some(change => change.classification === 'meaning_changed');
    const classification: PrdEditClassification = meaningChanged ? 'meaning_changed' : 'possibly_consequential';
    return {
        classification,
        confidence: meaningChanged ? 'high' : 'medium',
        reason: changes.length === 1 ? changes[0].reason : `${changes.length} planning claims changed in this edit.`,
        changes,
        affectedPrdSections: dedupe(changes.flatMap(change => change.affectedPrdSections)),
        affectedPlanLocations: dedupeLocations(changes.flatMap(change => change.affectedPlanLocations)),
        affectedArtifactSlots: dedupe(changes.flatMap(change => change.affectedArtifactSlots)),
    };
}

const sourceKeyFor = (change: ConsequentialPrdEditChange): string => `prd_edit:${change.key}`;

const sourceFor = (change: ConsequentialPrdEditChange, sourceSpineVersionId: string): PlanningSourceRef => ({
    key: sourceKeyFor(change),
    sourceType: 'prd',
    sourceId: change.key,
    sourceVersionId: sourceSpineVersionId,
    locator: {
        section: change.affectedPlanLocations[0]?.section ?? change.section,
        entityType: change.affectedPlanLocations[0]?.entityType ?? (change.entityId ? 'feature' : 'claim'),
        entityId: change.affectedPlanLocations[0]?.entityId ?? change.entityId,
        jsonPath: change.affectedPlanLocations[0]?.jsonPath,
    },
});

const latestVerdict = (record: PlanningRecord): DecisionEvent | undefined =>
    [...(record.events ?? [])].reverse().find(isDecisionVerdictEvent);

const answerFor = (change: ConsequentialPrdEditChange): string => change.after.trim() || `${change.label} removed`;

const updateSource = (
    record: PlanningRecord,
    source: PlanningSourceRef,
    change: ConsequentialPrdEditChange,
    at: number,
): PlanningRecord => ({
    ...record,
    title: change.label,
    statement: `${change.before || '(not present)'} → ${change.after || '(removed)'}`,
    materiality: change.materiality,
    affectedPrdSections: dedupe([...(record.affectedPrdSections ?? []), ...change.affectedPrdSections]),
    affectedPlanLocations: dedupeLocations([...(record.affectedPlanLocations ?? []), ...change.affectedPlanLocations]),
    affectedArtifactSlots: dedupe([...(record.affectedArtifactSlots ?? []), ...change.affectedArtifactSlots]),
    sources: [
        ...(record.sources ?? []).filter(existing => existing.key !== source.key),
        source,
    ],
    sourceState: 'current',
    currentSourceStatement: answerFor(change),
    updatedAt: Math.max(record.updatedAt, at),
});

const buildRecord = (
    input: RecordConsequentialPrdEditInput,
    change: ConsequentialPrdEditChange,
    source: PlanningSourceRef,
): PlanningRecord => {
    const id = input.idFactory();
    const createdEvent: DecisionEvent = {
        id: input.idFactory(), planningRecordId: id, type: 'created',
        actor: change.authority === 'explicit_user_change' ? 'user' : 'synapse', at: input.at,
    };
    const events: DecisionEvent[] = [createdEvent];
    if (change.authority === 'explicit_user_change' && change.recordType === 'decision') {
        events.push({
            id: input.idFactory(), planningRecordId: id, type: 'custom_answered', actor: 'user', at: input.at,
            answer: answerFor(change), rationale: `Changed directly in ${change.label}.`,
        });
    }
    return {
        id,
        projectId: input.projectId,
        type: change.recordType,
        status: change.authority === 'explicit_user_change' && change.recordType === 'decision' ? 'confirmed' : change.recordType === 'decision' ? 'proposed' : 'open',
        title: change.label,
        statement: `${change.before || '(not present)'} → ${change.after || '(removed)'}`,
        resolution: change.authority === 'explicit_user_change' && change.recordType === 'decision' ? answerFor(change) : undefined,
        rationale: change.reason,
        evidence: [],
        sourceFindingIds: [],
        createdBy: change.authority === 'explicit_user_change' ? 'user' : 'synapse',
        createdAt: input.at,
        updatedAt: input.at,
        confirmedAt: change.authority === 'explicit_user_change' && change.recordType === 'decision' ? input.at : undefined,
        resultingSpineVersionId: change.authority === 'explicit_user_change' && change.recordType === 'decision'
            ? input.sourceSpineVersionId
            : undefined,
        schemaVersion: PLANNING_RECORD_SCHEMA_VERSION,
        sources: [source],
        sourceState: 'current',
        currentSourceStatement: answerFor(change),
        materiality: change.materiality,
        affectedPrdSections: change.affectedPrdSections,
        affectedPlanLocations: change.affectedPlanLocations,
        affectedArtifactSlots: change.affectedArtifactSlots,
        events,
    };
};

const textAffinity = (needle: string, haystack: string): number => tokenSimilarity(needle, haystack);

const conflictsWith = (record: PlanningRecord, change: ConsequentialPrdEditChange): boolean => {
    const projection = projectDecision(record);
    if (!['confirmed', 'resolved', 'rejected', 'deferred'].includes(projection.status)) return false;
    const current = [projection.answer, record.resolution, record.statement, record.currentSourceStatement]
        .filter((value): value is string => !!value?.trim())
        .join('\n');
    if (!current || !change.before.trim()) return false;
    const beforeNorm = normalizeCopy(change.before);
    const afterNorm = normalizeCopy(change.after);
    const currentNorm = normalizeCopy(current);
    if (beforeNorm.length >= 5 && currentNorm.includes(beforeNorm) && (!afterNorm || !currentNorm.includes(afterNorm))) return true;
    const beforeAffinity = textAffinity(change.before, current);
    const afterAffinity = change.after ? textAffinity(change.after, current) : 0;
    return beforeAffinity >= 0.62 && beforeAffinity - afterAffinity >= 0.2;
};

const conflictSourceKey = (change: ConsequentialPrdEditChange, conflictingRecordId: string): string =>
    `prd_edit_conflict:${change.key}:${conflictingRecordId}`;

/**
 * Materializes recognition into durable planning context. Exact structured
 * changes become user-authored verdicts; prose classification and all conflict
 * detection remain Synapse-authored proposals. Repeated edits append history
 * to the same stable source record instead of producing a noisy new item.
 */
export function recordConsequentialPrdEdit(input: RecordConsequentialPrdEditInput): RecordConsequentialPrdEditResult {
    const analysis = analyzeConsequentialPrdEdit(input.before, input.after);
    if (analysis.classification === 'copy_edit') {
        return {
            records: input.existingRecords,
            recognition: { ...analysis, planningRecordIds: [], possibleConflictRecordIds: [] },
        };
    }

    const records = [...input.existingRecords];
    const planningRecordIds: string[] = [];
    const possibleConflictRecordIds: string[] = [];

    for (const change of analysis.changes) {
        const source = sourceFor(change, input.sourceSpineVersionId);
        const existingIndex = records.findIndex(record => record.sources?.some(item => item.key === source.key));
        let activeRecord: PlanningRecord;
        if (existingIndex >= 0) {
            const existing = records[existingIndex];
            activeRecord = updateSource(existing, source, change, input.at);
            if (change.authority === 'explicit_user_change' && change.recordType === 'decision') {
                const answer = answerFor(change);
                const projection = projectDecision(existing);
                if (projection.answer !== answer) {
                    const priorVerdict = latestVerdict(existing);
                    const event: DecisionEvent = priorVerdict
                        ? {
                            id: input.idFactory(), planningRecordId: existing.id, type: 'revised', actor: 'user', at: input.at,
                            previousEventId: priorVerdict.id, answer, rationale: `Changed directly in ${change.label}.`,
                        }
                        : {
                            id: input.idFactory(), planningRecordId: existing.id, type: 'custom_answered', actor: 'user', at: input.at,
                            answer, rationale: `Changed directly in ${change.label}.`,
                        };
                    const appended = appendDecisionEvent(activeRecord, event);
                    if (appended.ok) activeRecord = { ...appended.record, resultingSpineVersionId: input.sourceSpineVersionId };
                }
            } else if (change.authority === 'synapse_inference') {
                // A changed source must not revise a prior user verdict on the
                // system's behalf. Keep the authority log and flag source drift.
                activeRecord = { ...activeRecord, sourceState: 'changed', updatedAt: Math.max(activeRecord.updatedAt, input.at) };
            }
            records[existingIndex] = activeRecord;
        } else {
            activeRecord = buildRecord(input, change, source);
            records.push(activeRecord);
        }
        planningRecordIds.push(activeRecord.id);

        const conflicts = records.filter(record =>
            record.id !== activeRecord.id
            && !record.sources?.some(item => item.key.startsWith('prd_edit_conflict:'))
            && conflictsWith(record, change),
        );
        for (const conflicting of conflicts) {
            const conflictKey = conflictSourceKey(change, conflicting.id);
            const existingConflict = records.find(record => record.sources?.some(item => item.key === conflictKey));
            if (existingConflict) {
                possibleConflictRecordIds.push(existingConflict.id);
                continue;
            }
            const id = input.idFactory();
            const conflict: PlanningRecord = {
                id,
                projectId: input.projectId,
                type: 'conflict',
                status: 'open',
                title: `Review conflict after ${change.label.toLowerCase()} edit`,
                statement: `The working plan now says “${answerFor(change)}”, while “${conflicting.title}” may still reflect “${change.before}”.`,
                rationale: 'Synapse matched the earlier resolved planning record to the interpretation that was edited. The user must decide whether it is still valid.',
                evidence: [],
                sourceFindingIds: [],
                createdBy: 'synapse',
                createdAt: input.at,
                updatedAt: input.at,
                schemaVersion: PLANNING_RECORD_SCHEMA_VERSION,
                sources: [{
                    key: conflictKey,
                    sourceType: 'prd',
                    sourceId: change.key,
                    sourceVersionId: input.sourceSpineVersionId,
                    locator: source.locator,
                }],
                relatedPlanningRecordIds: [activeRecord.id, conflicting.id],
                materiality: change.materiality,
                affectedPrdSections: change.affectedPrdSections,
                affectedPlanLocations: change.affectedPlanLocations,
                affectedArtifactSlots: change.affectedArtifactSlots,
                events: [{
                    id: input.idFactory(), planningRecordId: id, type: 'created', actor: 'synapse', at: input.at,
                }],
            };
            records.push(conflict);
            possibleConflictRecordIds.push(id);
        }
    }

    return {
        records,
        recognition: {
            ...analysis,
            planningRecordIds: dedupe(planningRecordIds),
            possibleConflictRecordIds: dedupe(possibleConflictRecordIds),
        },
    };
}
