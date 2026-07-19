import type {
    Artifact,
    ArtifactVersion,
    PlanningRecord,
    ScreenItem,
    SpineVersion,
    StructuredPRD,
} from '../../types';
import { parseFlows } from '../../components/renderers/userFlows/parseFlow';
import type { ParsedFlow, ParsedStep } from '../../components/renderers/userFlows/types';
import { parseScreenInventory } from '../screenInventoryNormalize';
import { parseDataModelMarkdown, type ParsedEntity } from '../services/dataModelMarkdown';
import { extractStructuredPlan } from '../services/implementationPlanParser';
import { hashReviewValue } from '../review/hash';
import { isLikelyUnaffected, summarizeSpineChange, type SpineChangeSummary } from '../spineChangeAnalysis';
import { deriveProjectOutputAlignment } from './outputAlignment';
import {
    downstreamPlanningContextHash,
    sealDownstreamUpdatePlan,
    type DownstreamImpactCertainty,
    type DownstreamUpdateArtifactSlot,
    type DownstreamUpdateEvidence,
    type DownstreamUpdatePlan,
    type DownstreamUpdatePlanItem,
    type DownstreamUpdateRecommendedAction,
    type DownstreamUpdateRegion,
} from './downstreamUpdatePlan';

export type DeriveDownstreamUpdatePlansInput = {
    projectId: string;
    artifacts: Artifact[];
    artifactVersions: ArtifactVersion[];
    spineVersions: SpineVersion[];
    planningRecords: PlanningRecord[];
    createdAt?: number;
};

const SUPPORTED_SLOTS = new Set<DownstreamUpdateArtifactSlot>(['screen_inventory', 'user_flows', 'data_model', 'implementation_plan']);
const STOP_WORDS = new Set(['about', 'after', 'again', 'also', 'before', 'being', 'between', 'could', 'from', 'have', 'into', 'only', 'other', 'should', 'that', 'their', 'there', 'these', 'this', 'through', 'user', 'users', 'with', 'without']);

const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const featureId = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const slug = (value: string): string => normalize(value).replace(/\s+/g, '-') || 'region';
const containsPhrase = (haystack: string, needle: string): boolean => {
    const normalizedNeedle = normalize(needle);
    if (normalizedNeedle.length < 4) return false;
    return ` ${normalize(haystack)} `.includes(` ${normalizedNeedle} `);
};
const significantWords = (value: string): string[] => [...new Set(normalize(value).split(' ')
    .filter(word => word.length >= 4 && !STOP_WORDS.has(word)))];

function preferredVersion(artifact: Artifact, versions: ArtifactVersion[]): ArtifactVersion | undefined {
    return versions.find(version => version.id === artifact.currentVersionId)
        ?? versions.find(version => version.artifactId === artifact.id && version.isPreferred);
}

type ChangeCandidate = {
    id: string;
    label: string;
    kind: 'removed_feature' | 'changed_feature' | 'renamed_feature' | 'section_change';
    exactTokens: string[];
    lexicalTokens: string[];
    summary: string;
};

function changeCandidates(summary: SpineChangeSummary, before?: StructuredPRD): ChangeCandidate[] {
    const beforeFeatures = new Map((before?.features ?? []).map(item => [item.id, item]));
    const candidates: ChangeCandidate[] = [];
    for (const item of summary.features.removed) {
        const feature = beforeFeatures.get(item.id);
        const text = [item.name, feature?.description, feature?.userValue].filter(Boolean).join(' ');
        candidates.push({
            id: item.id, label: item.name, kind: 'removed_feature', exactTokens: [item.id],
            lexicalTokens: [item.name, ...significantWords(text)], summary: `Removed feature: ${item.name}.`,
        });
    }
    for (const item of summary.features.changed) {
        const feature = beforeFeatures.get(item.id);
        const text = [item.name, feature?.description, feature?.userValue].filter(Boolean).join(' ');
        candidates.push({
            id: item.id, label: item.name, kind: 'changed_feature', exactTokens: [item.id],
            lexicalTokens: [item.name, ...significantWords(text)], summary: `Changed feature: ${item.name} (${item.changedFields.join(', ')}).`,
        });
    }
    for (const item of summary.features.renamed) {
        candidates.push({
            id: item.id, label: item.from, kind: 'renamed_feature', exactTokens: [item.id],
            lexicalTokens: [item.from], summary: `Renamed feature: ${item.from} → ${item.to}.`,
        });
    }
    for (const section of summary.sections.filter(item => item.kind !== 'unchanged' && item.key !== 'features')) {
        const removedText = section.segments.filter(segment => segment.removed).map(segment => segment.value).join(' ');
        candidates.push({
            id: section.key, label: section.label, kind: 'section_change', exactTokens: [],
            lexicalTokens: significantWords(removedText || section.before), summary: `${section.label} changed.`,
        });
    }
    return candidates;
}

function evidence(
    candidate: ChangeCandidate,
    match: 'trace' | 'reference' | 'broad',
    regionLabel: string,
): DownstreamUpdateEvidence[] {
    const direct = match === 'trace';
    return [{
        id: hashReviewValue({ candidate: candidate.id, match, regionLabel }),
        kind: direct ? 'structured_trace' : match === 'reference' ? 'deterministic_reference' : 'plan_diff',
        quality: direct ? 'direct' : match === 'reference' ? 'inferred' : 'incomplete',
        summary: direct
            ? `${regionLabel} explicitly traces to ${candidate.label}.`
            : match === 'reference'
                ? `${regionLabel} contains language associated with ${candidate.label}.`
                : `${candidate.summary} Precise dependency metadata is unavailable.`,
        sourceId: candidate.id,
    }];
}

function certainty(candidate: ChangeCandidate, match: 'trace' | 'reference' | 'broad'): DownstreamImpactCertainty {
    if (match === 'trace' && candidate.kind === 'removed_feature') return 'definite';
    if (match === 'trace') return 'likely';
    return 'possible';
}

function recommendation(
    slot: DownstreamUpdateArtifactSlot,
    candidate: ChangeCandidate,
    match: 'trace' | 'reference' | 'broad',
): { action: DownstreamUpdateRecommendedAction; text: string } {
    if (match === 'broad') return { action: 'review_only', text: 'Review this output against the changed planning area before deciding whether any edit is needed.' };
    if (slot === 'user_flows') return {
        action: candidate.kind === 'removed_feature' ? 'reconsider_flow_branch' : 'review_only',
        text: candidate.kind === 'removed_feature'
            ? 'Review this flow step or branch and remove it only if the retired behavior is no longer needed.'
            : 'Review this flow region against the changed behavior.',
    };
    if (slot === 'data_model') return {
        action: candidate.kind === 'removed_feature' ? 'review_relationship' : 'review_entity',
        text: 'Review this exact data-model region; preserve the rest of the entity unless a dependency is demonstrated.',
    };
    if (slot === 'implementation_plan') return {
        action: 'review_architecture',
        text: candidate.kind === 'removed_feature'
            ? 'Review this exact architecture entry and remove it only when its explicit dependency is no longer part of the plan.'
            : 'Review this exact architecture entry against the changed planning foundation.',
    };
    return {
        action: candidate.kind === 'removed_feature' ? 'remove_obsolete_element' : 'revise_behavior',
        text: candidate.kind === 'removed_feature'
            ? 'Review the named screen region and remove only behavior that no longer serves the current plan.'
            : 'Review this screen behavior against the changed plan.',
    };
}

function makeItem(input: {
    artifactVersionId: string;
    candidate: ChangeCandidate;
    slot: DownstreamUpdateArtifactSlot;
    region: DownstreamUpdateRegion;
    label: string;
    interpretation: string;
    match: 'trace' | 'reference' | 'broad';
    preservedScope: string[];
    index: number;
}): DownstreamUpdatePlanItem {
    const recommended = recommendation(input.slot, input.candidate, input.match);
    const impactCertainty = certainty(input.candidate, input.match);
    return {
        id: `update-${hashReviewValue({ version: input.artifactVersionId, candidate: input.candidate.id, region: input.region })}`,
        region: input.region,
        currentInterpretation: input.interpretation,
        whyAffected: input.candidate.summary,
        certainty: impactCertainty,
        evidence: evidence(input.candidate, input.match, input.label),
        ambiguity: input.match === 'trace' && input.candidate.kind === 'removed_feature'
            ? 'The dependency is explicit, but the user still decides whether the region should be removed, adapted, or retained for exploration.'
            : 'The reference establishes relevance, not proof that the current output is incorrect.',
        recommendedAction: recommended.action,
        recommendation: recommended.text,
        preservedScope: input.preservedScope,
        recommendedPriority: input.index + 1,
        implementationCritical: impactCertainty === 'definite',
    };
}

const screenText = (screen: ScreenItem): string => JSON.stringify(screen);
const screenRefs = (screen: ScreenItem): string[] => (screen.featureRefs ?? []).map(featureId);

function screenRegion(screen: ScreenItem, candidate: ChangeCandidate): { region: DownstreamUpdateRegion; label: string } {
    const lexical = candidate.lexicalTokens.find(token => containsPhrase(JSON.stringify(screen.states ?? []), token));
    if (lexical) {
        const state = (screen.states ?? []).find(item => containsPhrase(JSON.stringify(item), lexical));
        const stateAspect = state?.type === 'empty' || state?.type === 'error' || state?.type === 'permission'
            ? state.type
            : 'state';
        return {
            region: { kind: 'screen', screenId: screen.id ?? slug(screen.name), screenName: screen.name, aspect: stateAspect, aspectId: state ? slug(state.name) : undefined, label: state?.name },
            label: `${screen.name} — ${state?.name ?? 'state'}`,
        };
    }
    const component = (screen.coreUIElements ?? screen.components)?.find(item =>
        candidate.lexicalTokens.some(token => containsPhrase(item, token)));
    if (component) return {
        region: {
            kind: 'screen', screenId: screen.id ?? slug(screen.name), screenName: screen.name,
            aspect: 'component', aspectId: slug(component), label: component,
        },
        label: `${screen.name} — ${component}`,
    };
    const interaction = screen.handoff?.events?.find(event =>
        candidate.lexicalTokens.some(token => containsPhrase(JSON.stringify(event), token)));
    if (interaction) return {
        region: {
            kind: 'screen', screenId: screen.id ?? slug(screen.name), screenName: screen.name,
            aspect: 'interaction', aspectId: slug(interaction.name), label: interaction.name,
        },
        label: `${screen.name} — ${interaction.name}`,
    };
    const exit = screen.exitPaths?.find(path =>
        candidate.lexicalTokens.some(token => containsPhrase(JSON.stringify(path), token)));
    const entry = screen.entryPoints?.find(value =>
        candidate.lexicalTokens.some(token => containsPhrase(value, token)));
    const route = screen.handoff?.route && candidate.lexicalTokens.some(token => containsPhrase(screen.handoff!.route!, token))
        ? screen.handoff.route : undefined;
    const navigation = exit?.label ?? entry ?? route;
    if (navigation) return {
        region: {
            kind: 'screen', screenId: screen.id ?? slug(screen.name), screenName: screen.name,
            aspect: 'navigation', aspectId: slug(navigation), label: navigation,
        },
        label: `${screen.name} — ${navigation}`,
    };
    const behavior = candidate.lexicalTokens.some(token => containsPhrase(JSON.stringify({ handoff: screen.handoff }), token));
    return {
        region: {
            kind: 'screen', screenId: screen.id ?? slug(screen.name), screenName: screen.name,
            aspect: behavior ? 'behavior' : candidate.id === 'targetUsers' ? 'role' : 'screen',
            label: behavior ? 'Behavior' : undefined,
        },
        label: behavior ? `${screen.name} — behavior` : screen.name,
    };
}

function screenItems(version: ArtifactVersion, candidates: ChangeCandidate[]): DownstreamUpdatePlanItem[] | null {
    const inventory = parseScreenInventory(version.content);
    if (!inventory) return null;
    const screens = inventory.sections.flatMap(section => section.screens);
    const matches: Array<{ screen: ScreenItem; candidate: ChangeCandidate; match: 'trace' | 'reference' }> = [];
    for (const screen of screens) {
        for (const candidate of candidates) {
            const trace = candidate.exactTokens.some(token => screenRefs(screen).includes(featureId(token)));
            const reference = candidate.lexicalTokens.some(token => containsPhrase(screenText(screen), token));
            if (trace || reference) matches.push({ screen, candidate, match: trace ? 'trace' : 'reference' });
        }
    }
    return matches.map((match, index) => {
        const affected = new Set(matches.map(item => item.screen.id ?? slug(item.screen.name)));
        const { region, label } = screenRegion(match.screen, match.candidate);
        return makeItem({
            artifactVersionId: version.id, candidate: match.candidate, slot: 'screen_inventory', region, label,
            interpretation: `${label} currently represents behavior connected to ${match.candidate.label}.`, match: match.match,
            preservedScope: screens.filter(screen => !affected.has(screen.id ?? slug(screen.name))).map(screen => `Screen: ${screen.name}`), index,
        });
    });
}

const flowRefs = (flow: ParsedFlow): string[] => flow.featureRefs.map(ref => featureId(ref.id));
const stepRefs = (step: ParsedStep): string[] => step.featureRefs.map(ref => featureId(ref.id));

function flowItems(version: ArtifactVersion, candidates: ChangeCandidate[]): DownstreamUpdatePlanItem[] | null {
    const flows = parseFlows(version.content);
    if (flows.length === 0) return null;
    const raw: Array<{ flow: ParsedFlow; step?: ParsedStep; candidate: ChangeCandidate; match: 'trace' | 'reference' }> = [];
    for (const flow of flows) {
        for (const candidate of candidates) {
            const step = flow.steps.find(item => candidate.exactTokens.some(token => stepRefs(item).includes(featureId(token))))
                ?? flow.steps.find(item => candidate.lexicalTokens.some(token => containsPhrase(JSON.stringify(item), token)));
            const trace = candidate.exactTokens.some(token => flowRefs(flow).includes(featureId(token)));
            const reference = candidate.lexicalTokens.some(token => containsPhrase(JSON.stringify(flow), token));
            if (step || trace || reference) raw.push({
                flow, step, candidate,
                match: trace || (step && candidate.exactTokens.some(token => stepRefs(step).includes(featureId(token)))) ? 'trace' : 'reference',
            });
        }
    }
    const affected = new Set(raw.map(item => item.flow.title));
    return raw.map((match, index) => {
        const decision = match.step?.decisions.find(value => match.candidate.lexicalTokens.some(token => containsPhrase(value, token)))
            ?? (match.step?.decisions.length ? match.step.decisions[0] : undefined);
        const recovery = match.step?.errorRefs.find(value => match.candidate.lexicalTokens.some(token => containsPhrase(value, token)));
        const aspect = recovery ? 'error_recovery' : decision ? 'decision' : match.step ? 'step' : 'flow';
        const label = match.step ? `${match.flow.title} — Step ${match.step.index + 1}` : match.flow.title;
        return makeItem({
            artifactVersionId: version.id, candidate: match.candidate, slot: 'user_flows',
            region: {
                kind: 'flow', flowId: slug(match.flow.title), flowName: match.flow.title, aspect,
                stepIndex: match.step?.index, label: recovery ?? decision ?? match.step?.title,
            },
            label, interpretation: match.step?.rawText ?? match.flow.goal ?? `Flow: ${match.flow.title}`, match: match.match,
            preservedScope: flows.filter(flow => !affected.has(flow.title)).map(flow => `Flow: ${flow.title}`), index,
        });
    });
}

function entityRefs(content: string, entityName: string): string[] {
    const escaped = entityName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const section = content.match(new RegExp(`(?:^|\\n)##\\s+${escaped}\\s*\\r?\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, 'i'))?.[1] ?? '';
    const line = section.match(/^\*\*Related Features:\*\*\s*(.+)$/im)?.[1] ?? '';
    return line.split(',').map(value => featureId(value)).filter(Boolean);
}

function entityRegion(entity: ParsedEntity, candidate: ChangeCandidate): { region: DownstreamUpdateRegion; label: string } {
    const relationship = entity.callouts.find(item => item.kind === 'RELATIONSHIP'
        && candidate.lexicalTokens.some(token => containsPhrase(item.text, token)));
    if (relationship) return {
        region: { kind: 'data_model', entityName: entity.name, aspect: 'relationship', memberName: relationship.text, label: relationship.text },
        label: `${entity.name} relationship`,
    };
    for (const group of entity.fieldGroups) {
        const field = group.fields.find(item => candidate.lexicalTokens.some(token => containsPhrase(JSON.stringify(item), token)));
        if (field) return {
            region: { kind: 'data_model', entityName: entity.name, aspect: 'field', memberName: field.name, label: `${entity.name}.${field.name}` },
            label: `${entity.name}.${field.name}`,
        };
    }
    const constraint = entity.callouts.find(item => item.kind === 'CONSTRAINT'
        && candidate.lexicalTokens.some(token => containsPhrase(item.text, token)));
    if (constraint) return {
        region: { kind: 'data_model', entityName: entity.name, aspect: 'constraint', memberName: constraint.text, label: constraint.text },
        label: `${entity.name} constraint`,
    };
    return { region: { kind: 'data_model', entityName: entity.name, aspect: 'entity' }, label: `Entity: ${entity.name}` };
}

function dataModelItems(version: ArtifactVersion, candidates: ChangeCandidate[]): DownstreamUpdatePlanItem[] | null {
    const model = parseDataModelMarkdown(version.content);
    if (!model) return null;
    const raw: Array<{ entity: ParsedEntity; candidate: ChangeCandidate; match: 'trace' | 'reference' }> = [];
    for (const entity of model.entities) {
        const refs = entityRefs(version.content, entity.name);
        for (const candidate of candidates) {
            const trace = candidate.exactTokens.some(token => refs.includes(featureId(token)));
            const reference = candidate.lexicalTokens.some(token => containsPhrase(JSON.stringify(entity), token));
            if (trace || reference) raw.push({ entity, candidate, match: trace ? 'trace' : 'reference' });
        }
    }
    const affected = new Set(raw.map(item => item.entity.name));
    return raw.map((match, index) => {
        const { region, label } = entityRegion(match.entity, match.candidate);
        const action = region.kind === 'data_model' && region.aspect === 'field' ? 'review_field'
            : region.kind === 'data_model' && region.aspect === 'relationship' ? 'review_relationship'
                : undefined;
        const item = makeItem({
            artifactVersionId: version.id, candidate: match.candidate, slot: 'data_model', region, label,
            interpretation: match.entity.description || `Entity ${match.entity.name}.`, match: match.match,
            preservedScope: model.entities.filter(entity => !affected.has(entity.name)).map(entity => `Entity: ${entity.name}`), index,
        });
        return action ? { ...item, recommendedAction: action } : item;
    });
}

type ArchitectureRegion = Extract<DownstreamUpdateRegion, { kind: 'implementation_plan'; section: 'architecture' }>;
type DeliveryRegion = Extract<DownstreamUpdateRegion, { kind: 'implementation_plan'; section: 'delivery' }>;

const architectureAspect = (entry: string): ArchitectureRegion['aspect'] => {
    const text = normalize(entry);
    if (/auth|identity|sign in|login/.test(text)) return 'authentication';
    if (/permission|authorization|security boundary|access control|tenant isolation/.test(text)) return 'security_boundary';
    if (/storage|database|persist|local only|local first|cloud sync/.test(text)) return 'storage';
    if (/deploy|hosting|runtime|environment|region/.test(text)) return 'deployment';
    if (/integration|webhook|api|third party|external service/.test(text)) return 'integration';
    if (/data flow|pipeline|event flow|sync flow/.test(text)) return 'data_flow';
    if (/dependency|provider|vendor|sdk/.test(text)) return 'external_dependency';
    if (/operational|recovery|backup|monitor|availability|rate limit/.test(text)) return 'operational_constraint';
    if (/component|service|module|client|server/.test(text)) return 'component';
    return 'decision';
};

const explicitPlanTrace = (entry: string, candidate: ChangeCandidate): boolean => candidate.exactTokens.some(token => {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:\\[feature:${escaped}\\]|feature(?:Ref)?\\s*[:=]\\s*${escaped}(?:\\b|\\]))`, 'i').test(entry);
});

function architectureItems(version: ArtifactVersion, candidates: ChangeCandidate[]): DownstreamUpdatePlanItem[] | null {
    const plan = extractStructuredPlan(version.content);
    if (!plan) return null;
    const entries = plan.architecture ?? [];
    const raw: Array<{ entry: string; entryIndex: number; candidate: ChangeCandidate; match: 'trace' | 'reference' }> = [];
    entries.forEach((entry, entryIndex) => {
        candidates.forEach(candidate => {
            const trace = explicitPlanTrace(entry, candidate);
            const reference = candidate.lexicalTokens.some(token => containsPhrase(entry, token));
            if (trace || reference) raw.push({ entry, entryIndex, candidate, match: trace ? 'trace' : 'reference' });
        });
    });
    const affected = new Set(raw.map(item => item.entryIndex));
    return raw.map((match, index) => makeItem({
        artifactVersionId: version.id,
        candidate: match.candidate,
        slot: 'implementation_plan',
        region: {
            kind: 'implementation_plan', section: 'architecture', aspect: architectureAspect(match.entry),
            entryIndex: match.entryIndex, entryLabel: match.entry, label: match.entry,
        },
        label: `Architecture entry ${match.entryIndex + 1}`,
        interpretation: match.entry,
        match: match.match,
        preservedScope: entries.map((entry, entryIndex) => ({ entry, entryIndex }))
            .filter(({ entryIndex }) => !affected.has(entryIndex))
            .map(({ entry, entryIndex }) => `Architecture entry ${entryIndex + 1}: ${entry}`),
        index,
    }));
}

type DeliveryDescriptor = {
    region: DeliveryRegion;
    label: string;
    text: string;
};

const technicalTask = (text: string): boolean => /security|authentication|authorization|migration|api|technical prerequisite|schema|encryption/i.test(text);

function deliveryDescriptors(version: ArtifactVersion): DeliveryDescriptor[] | null {
    const plan = extractStructuredPlan(version.content);
    if (!plan) return null;
    const descriptors: DeliveryDescriptor[] = [];
    plan.milestones.forEach((milestone, milestoneIndex) => {
        const milestoneText = [milestone.name, milestone.goal, milestone.objective, milestone.phase].filter(Boolean).join(' ');
        descriptors.push({
            region: {
                kind: 'implementation_plan', section: 'delivery',
                aspect: /workstream/i.test(milestoneText) ? 'workstream' : 'milestone', collection: 'milestones',
                milestoneId: milestone.id, entryIndex: milestoneIndex, entryLabel: milestone.name, label: milestone.name,
            },
            label: `Milestone: ${milestone.name}`,
            text: milestoneText,
        });
        milestone.tasks.forEach((task, entryIndex) => descriptors.push({
            region: {
                kind: 'implementation_plan', section: 'delivery',
                aspect: technicalTask(`${task.title} ${task.description ?? ''}`) ? 'technical_prerequisite' : 'task',
                collection: 'tasks', milestoneId: milestone.id, taskId: task.id,
                entryIndex, entryLabel: task.title, label: task.title,
            },
            label: `${milestone.name} · Task: ${task.title}`,
            text: JSON.stringify(task),
        }));
        (milestone.dependencies ?? []).forEach((dependency, entryIndex) => descriptors.push({
            region: {
                kind: 'implementation_plan', section: 'delivery', aspect: 'dependency', collection: 'dependencies',
                milestoneId: milestone.id, entryIndex, entryLabel: dependency, label: dependency,
            },
            label: `${milestone.name} · Dependency: ${dependency}`,
            text: dependency,
        }));
        (milestone.definitionOfDone ?? []).forEach((criterion, entryIndex) => descriptors.push({
            region: {
                kind: 'implementation_plan', section: 'delivery', aspect: 'acceptance_criterion', collection: 'definition_of_done',
                milestoneId: milestone.id, entryIndex, entryLabel: criterion, label: criterion,
            },
            label: `${milestone.name} · Done: ${criterion}`,
            text: criterion,
        }));
        (milestone.promptPacks ?? []).forEach(pack => pack.acceptanceCriteria.forEach((criterion, entryIndex) => descriptors.push({
            region: {
                kind: 'implementation_plan', section: 'delivery', aspect: 'acceptance_criterion', collection: 'prompt_acceptance_criteria',
                milestoneId: milestone.id, promptPackId: pack.id, entryIndex, entryLabel: criterion, label: criterion,
            },
            label: `${milestone.name} · ${pack.title}: ${criterion}`,
            text: criterion,
        })));
        (milestone.validationCommands ?? []).forEach((command, entryIndex) => descriptors.push({
            region: {
                kind: 'implementation_plan', section: 'delivery', aspect: 'testing_requirement', collection: 'validation_commands',
                milestoneId: milestone.id, entryIndex, entryLabel: command, label: command,
            },
            label: `${milestone.name} · Test: ${command}`,
            text: command,
        }));
        (milestone.qualityGates ?? []).forEach((gate, entryIndex) => descriptors.push({
            region: {
                kind: 'implementation_plan', section: 'delivery', aspect: 'testing_requirement', collection: 'quality_gates',
                milestoneId: milestone.id, qualityGateId: gate.id, entryIndex, entryLabel: gate.title, label: gate.title,
            },
            label: `${milestone.name} · Gate: ${gate.title}`,
            text: JSON.stringify(gate),
        }));
    });
    (plan.risks ?? []).forEach((risk, entryIndex) => descriptors.push({
        region: {
            kind: 'implementation_plan', section: 'delivery', aspect: 'risk', collection: 'risks',
            entryIndex, entryLabel: risk.description, label: risk.description,
        },
        label: `Risk: ${risk.description}`,
        text: JSON.stringify(risk),
    }));
    (plan.summary?.criticalPath ?? []).forEach((entry, entryIndex) => descriptors.push({
        region: {
            kind: 'implementation_plan', section: 'delivery', aspect: 'sequencing_assumption', collection: 'critical_path',
            entryIndex, entryLabel: entry, label: entry,
        },
        label: `Critical path: ${entry}`,
        text: entry,
    }));
    (plan.globalQualityGates ?? []).forEach((gate, entryIndex) => descriptors.push({
        region: {
            kind: 'implementation_plan', section: 'delivery', aspect: 'testing_requirement', collection: 'quality_gates',
            qualityGateId: gate.id, entryIndex, entryLabel: gate.title, label: gate.title,
        },
        label: `Global gate: ${gate.title}`,
        text: JSON.stringify(gate),
    }));
    return descriptors;
}

function deliveryItems(version: ArtifactVersion, candidates: ChangeCandidate[]): DownstreamUpdatePlanItem[] | null {
    const descriptors = deliveryDescriptors(version);
    if (!descriptors) return null;
    const raw: Array<{ descriptor: DeliveryDescriptor; candidate: ChangeCandidate; match: 'trace' | 'reference' }> = [];
    descriptors.forEach(descriptor => candidates.forEach(candidate => {
        const trace = explicitPlanTrace(descriptor.text, candidate);
        const reference = candidate.lexicalTokens.some(token => containsPhrase(descriptor.text, token));
        if (trace || reference) raw.push({ descriptor, candidate, match: trace ? 'trace' : 'reference' });
    }));
    const affected = new Set(raw.map(item => hashReviewValue(item.descriptor.region)));
    return raw.map((match, index) => {
        const item = makeItem({
            artifactVersionId: version.id,
            candidate: match.candidate,
            slot: 'implementation_plan',
            region: match.descriptor.region,
            label: match.descriptor.label,
            interpretation: match.descriptor.text,
            match: match.match,
            preservedScope: descriptors.filter(descriptor => !affected.has(hashReviewValue(descriptor.region)))
                .map(descriptor => descriptor.label),
            index,
        });
        return {
            ...item,
            recommendedAction: 'review_implementation_plan' as const,
            recommendation: match.candidate.kind === 'removed_feature'
                ? 'Review only this exact plan entry and remove it only when its explicit dependency no longer applies.'
                : 'Review only this exact delivery-plan entry against the changed planning foundation.',
        };
    });
}

function implementationPlanItems(version: ArtifactVersion, candidates: ChangeCandidate[]): DownstreamUpdatePlanItem[] | null {
    const architecture = architectureItems(version, candidates);
    const delivery = deliveryItems(version, candidates);
    if (!architecture || !delivery) return null;
    return [...architecture, ...delivery].map((item, index) => ({ ...item, recommendedPriority: index + 1 }));
}

function fallbackItem(
    version: ArtifactVersion,
    slot: DownstreamUpdateArtifactSlot,
    summary: SpineChangeSummary | undefined,
    reason: DownstreamUpdateRegion & { kind: 'artifact_review' },
): DownstreamUpdatePlanItem {
    const candidate: ChangeCandidate = {
        id: summary?.headline ?? 'legacy', label: summary?.headline ?? 'the current planning foundation',
        kind: 'section_change', exactTokens: [], lexicalTokens: [],
        summary: summary?.headline ?? 'The output lacks enough provenance for a precise comparison.',
    };
    return makeItem({
        artifactVersionId: version.id, candidate, slot, region: reason, label: reason.label,
        interpretation: 'The existing artifact remains usable, but its exact dependency cannot be established.', match: 'broad',
        preservedScope: ['All existing manual work remains preserved until a user identifies a specific required change.'], index: 0,
    });
}

function findSourceAuthority(records: PlanningRecord[], targetSpineVersionId: string): {
    planningRecord?: PlanningRecord;
    eventId?: string;
} {
    for (const record of [...records].sort((a, b) => b.updatedAt - a.updatedAt)) {
        const event = [...(record.events ?? [])].reverse().find(candidate => (
            candidate.type === 'applied_to_plan' && candidate.resultingSpineVersionId === targetSpineVersionId
        ));
        if (event || record.resultingSpineVersionId === targetSpineVersionId) return { planningRecord: record, eventId: event?.id };
    }
    return {};
}

export function deriveDownstreamUpdatePlans(input: DeriveDownstreamUpdatePlansInput): DownstreamUpdatePlan[] {
    const latest = input.spineVersions.find(spine => spine.isLatest);
    if (!latest) return [];
    const alignment = deriveProjectOutputAlignment({
        artifacts: input.artifacts, artifactVersions: input.artifactVersions, spineVersions: input.spineVersions,
    });
    const planningContextHash = downstreamPlanningContextHash(input.planningRecords);
    const authority = findSourceAuthority(input.planningRecords, latest.id);
    const createdAt = input.createdAt ?? Date.now();
    const plans: DownstreamUpdatePlan[] = [];

    for (const artifact of input.artifacts) {
        if (artifact.type !== 'core_artifact' || !artifact.subtype || !SUPPORTED_SLOTS.has(artifact.subtype as DownstreamUpdateArtifactSlot)) continue;
        const slot = artifact.subtype as DownstreamUpdateArtifactSlot;
        const output = alignment.outputs.find(item => item.artifactId === artifact.id);
        if (!output || output.state === 'aligned') continue;
        const version = preferredVersion(artifact, input.artifactVersions);
        if (!version) continue;
        const sourceSpineId = version.sourceRefs.find(ref => ref.sourceType === 'spine')?.sourceArtifactVersionId;
        const sourceSpine = sourceSpineId ? input.spineVersions.find(spine => spine.id === sourceSpineId) : undefined;
        const summary = sourceSpine ? summarizeSpineChange(sourceSpine.structuredPRD, latest.structuredPRD) : undefined;

        const candidates = summary ? changeCandidates(summary, sourceSpine?.structuredPRD) : [];
        let items = slot === 'screen_inventory' ? screenItems(version, candidates)
            : slot === 'user_flows' ? flowItems(version, candidates)
                : slot === 'data_model' ? dataModelItems(version, candidates)
                    : implementationPlanItems(version, candidates);
        const parserFailed = items === null;
        const weakBinding = !sourceSpine || !summary?.comparable;
        if (parserFailed || weakBinding) {
            items = [fallbackItem(version, slot, summary, {
                kind: 'artifact_review',
                reason: !sourceSpineId ? 'legacy_provenance'
                    : slot === 'screen_inventory' && !parseScreenInventory(version.content) ? 'unstructured_content'
                        : slot === 'data_model' && !parseDataModelMarkdown(version.content) ? 'unstructured_content'
                            : slot === 'user_flows' && parseFlows(version.content).length === 0 ? 'unstructured_content'
                                : slot === 'implementation_plan' && !extractStructuredPlan(version.content) ? 'unstructured_content'
                                : 'insufficient_dependency',
                label: artifact.title,
            })];
        }
        // Affinity is only a fallback suppression boundary. A concrete trace
        // or lexical region match wins (for example an architecture edit that
        // explicitly removes cloud sync can affect a Syncing screen state).
        if ((!items || items.length === 0) && summary && isLikelyUnaffected(slot, summary)) continue;
        // A well-structured artifact with no matching trace or reference is
        // explicit negative scope for this bounded pass. Do not turn section
        // affinity alone into invented work (for example, a collaboration
        // removal must not automatically implicate unrelated data entities).
        if (!items || items.length === 0) continue;
        const sourceSummary = latest.provenance?.editSummary || summary?.headline || output.summary;
        const planSeed = {
            projectId: input.projectId, artifactId: artifact.id, artifactVersionId: version.id,
            spineVersionId: latest.id, spineContent: hashReviewValue(latest.structuredPRD ?? latest.responseText),
            planningContextHash, items: items.map(item => item.id),
        };
        plans.push(sealDownstreamUpdatePlan({
            schemaVersion: 1, id: `update-plan-${hashReviewValue(planSeed)}`, projectId: input.projectId,
            authoredBy: 'synapse',
            source: {
                kind: 'planning_change', summary: sourceSummary, sourceSpineVersionId: sourceSpineId,
                targetSpineVersionId: latest.id,
                targetSpineContentHash: hashReviewValue(latest.structuredPRD ?? latest.responseText), planningContextHash,
                planningRecordId: authority.planningRecord?.id, planningEventId: authority.eventId,
                confirmed: Boolean(latest.isFinal || (authority.planningRecord && ['confirmed', 'resolved'].includes(authority.planningRecord.status))),
            },
            artifact: {
                artifactId: artifact.id, artifactVersionId: version.id, artifactContentHash: hashReviewValue(version.content),
                slot, title: artifact.title,
            },
            items,
            preservedArtifactSummary: items.every(item => item.region.kind === 'artifact_review')
                ? 'No output content will be changed. Existing work remains useful while this focused review is unresolved.'
                : `Only ${items.length} identified region${items.length === 1 ? '' : 's'} need attention. Unlisted regions remain preserved and usable.`,
            createdAt,
        }));
    }
    return plans.sort((a, b) => a.artifact.slot.localeCompare(b.artifact.slot) || a.artifact.title.localeCompare(b.artifact.title));
}
