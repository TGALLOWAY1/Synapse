import type {
    DomainEntity, FeatureSystem, ImplementationPlan, UXPage,
} from '../../../types';
import type { FeatureRef, ParsedFlow } from './types';

/**
 * Normalize a string for fuzzy contains-matching. Lowercase + strip
 * non-alphanumerics so "Active Workout" matches "active-workout" and
 * "ActiveWorkout".
 */
function fold(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function flowTextCorpus(flow: ParsedFlow): string {
    const parts: string[] = [
        flow.title,
        flow.goal ?? '',
        flow.preconditions ?? '',
        flow.successOutcome ?? '',
        flow.edgeCases ?? '',
        flow.assumptions ?? '',
        flow.openQuestions ?? '',
        ...flow.entryPoints,
        ...flow.inferredSystems,
    ];
    for (const step of flow.steps) {
        parts.push(
            step.title ?? '',
            step.userAction ?? '',
            step.systemBehavior ?? '',
            step.uiFeedback ?? '',
            step.rawText,
            ...step.decisions,
            ...step.errorRefs,
            ...step.apiRefs,
        );
    }
    return parts.join(' ');
}

/**
 * Heuristic membership test: does `needle` appear in the flow text?
 * Uses folded substring matching plus a length floor so short tokens
 * like "DB" don't match "feedback".
 */
function flowMentions(corpus: string, needle: string): boolean {
    const trimmed = needle.trim();
    if (trimmed.length < 3) return false;
    return corpus.includes(fold(trimmed));
}

export interface RelatedArtifacts {
    features: FeatureRef[];
    screens: UXPage[];
    entities: DomainEntity[];
    phases: NonNullable<ImplementationPlan['phases']>;
    systems: FeatureSystem[];
    /** Whether page/entity catalogs were provided (drives empty-state hints). */
    hasScreenCatalog: boolean;
    hasEntityCatalog: boolean;
}

export interface RelatedArtifactSources {
    uxPages?: UXPage[];
    domainEntities?: DomainEntity[];
    implementationPlan?: ImplementationPlan;
    featureSystems?: FeatureSystem[];
}

/**
 * Pure heuristic join of a flow against the PRD-derived catalogs. Shared by
 * the compact relationship summary in the flow header and the full Related
 * Artifacts panel so the two never drift.
 */
export function computeRelatedArtifacts(
    flow: ParsedFlow,
    sources: RelatedArtifactSources,
): RelatedArtifacts {
    const { uxPages, domainEntities, implementationPlan, featureSystems } = sources;
    const corpus = fold(flowTextCorpus(flow));
    const featureIds = new Set(flow.featureRefs.map(r => r.id));

    const screens = (uxPages ?? []).filter(p => flowMentions(corpus, p.name));
    const entities = (domainEntities ?? []).filter(e => flowMentions(corpus, e.name));

    const phases = (implementationPlan?.phases ?? []).filter(phase => {
        const ids = phase.featureIds ?? [];
        return ids.some(id => featureIds.has(id.toLowerCase().replace(/-/g, '')));
    });

    const systems = (featureSystems ?? []).filter(sys => {
        const overlap = sys.featureIds.some(
            id => featureIds.has(id.toLowerCase().replace(/-/g, '')),
        );
        return overlap || flowMentions(corpus, sys.name);
    });

    return {
        features: flow.featureRefs,
        screens,
        entities,
        phases,
        systems,
        hasScreenCatalog: uxPages !== undefined,
        hasEntityCatalog: domainEntities !== undefined,
    };
}

/** True when there is at least one linked artifact of any kind. */
export function hasAnyRelated(r: RelatedArtifacts): boolean {
    return (
        r.features.length > 0
        || r.screens.length > 0
        || r.entities.length > 0
        || r.phases.length > 0
        || r.systems.length > 0
    );
}

/** Compact "6 features · 4 screens · 2 entities" summary parts. */
export function relatedSummaryParts(r: RelatedArtifacts): string[] {
    const parts: string[] = [];
    const push = (n: number, singular: string, plural: string) => {
        if (n > 0) parts.push(`${n} ${n === 1 ? singular : plural}`);
    };
    push(r.features.length, 'feature', 'features');
    push(r.screens.length, 'screen', 'screens');
    push(r.entities.length, 'entity', 'entities');
    push(r.phases.length, 'phase', 'phases');
    push(r.systems.length, 'system', 'systems');
    return parts;
}
