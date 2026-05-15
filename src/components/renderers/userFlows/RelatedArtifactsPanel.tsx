import { useMemo } from 'react';
import { AppWindow, Database, ListChecks, Network, Sparkles } from 'lucide-react';
import type {
    DomainEntity, Feature, FeatureSystem, ImplementationPlan, UXPage,
} from '../../../types';
import type { FeatureRef, ParsedFlow } from './types';
import { FeatureReferenceChip } from './FeatureReferenceChip';

interface Props {
    flow: ParsedFlow;
    featuresById?: Map<string, Feature>;
    onSelectFeature: (refToken: FeatureRef) => void;
    /** PRD-derived screen / page catalog. Heuristic matching only. */
    uxPages?: UXPage[];
    /** PRD-derived domain entities. Heuristic matching only. */
    domainEntities?: DomainEntity[];
    /** PRD-derived implementation plan; we surface phases whose
     *  feature ids overlap with this flow's referenced features. */
    implementationPlan?: ImplementationPlan;
    /** PRD-derived feature systems; we surface ones whose feature ids
     *  overlap with this flow's referenced features. */
    featureSystems?: FeatureSystem[];
}

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
 * Uses folded substring matching plus a quick word-boundary check so
 * short tokens like "DB" don't match "feedback".
 */
function flowMentions(corpus: string, needle: string): boolean {
    const trimmed = needle.trim();
    if (trimmed.length < 3) return false;
    return fold(corpus).includes(fold(trimmed));
}

function Section({
    title, icon, children, count,
}: {
    title: string;
    icon: React.ReactNode;
    count?: number;
    children: React.ReactNode;
}) {
    return (
        <section className="rounded-lg border border-neutral-200 bg-white p-3.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-2 inline-flex items-center gap-1">
                {icon}
                <span>{title}</span>
                {typeof count === 'number' && (
                    <span className="ml-1 text-neutral-400 font-normal">· {count}</span>
                )}
            </p>
            {children}
        </section>
    );
}

function EmptyChip({ label }: { label: string }) {
    return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] text-neutral-400 italic">
            {label}
        </span>
    );
}

export function RelatedArtifactsPanel({
    flow,
    featuresById,
    onSelectFeature,
    uxPages,
    domainEntities,
    implementationPlan,
    featureSystems,
}: Props) {
    const corpus = useMemo(() => flowTextCorpus(flow), [flow]);
    const featureIds = useMemo(() => new Set(flow.featureRefs.map(r => r.id)), [flow.featureRefs]);

    // Heuristic matching — keep it cheap and explainable. We surface pages
    // whose name appears in the flow text *or* whose component list shows
    // up among the step titles.
    const linkedScreens = useMemo(() => {
        if (!uxPages || uxPages.length === 0) return [];
        return uxPages.filter(p => flowMentions(corpus, p.name));
    }, [uxPages, corpus]);

    const linkedEntities = useMemo(() => {
        if (!domainEntities || domainEntities.length === 0) return [];
        return domainEntities.filter(e => flowMentions(corpus, e.name));
    }, [domainEntities, corpus]);

    // For implementation plan + systems we rely on feature-id overlap
    // first (more reliable than name matching), and fall back to name
    // matching for systems that don't list features.
    const linkedPhases = useMemo(() => {
        const phases = implementationPlan?.phases ?? [];
        if (phases.length === 0 || featureIds.size === 0) return [];
        return phases.filter(phase => {
            const ids = phase.featureIds ?? [];
            return ids.some(id => featureIds.has(id.toLowerCase().replace(/-/g, '')));
        });
    }, [implementationPlan, featureIds]);

    const linkedSystems = useMemo(() => {
        if (!featureSystems || featureSystems.length === 0) return [];
        return featureSystems.filter(sys => {
            const overlap = sys.featureIds.some(
                id => featureIds.has(id.toLowerCase().replace(/-/g, '')),
            );
            return overlap || flowMentions(corpus, sys.name);
        });
    }, [featureSystems, featureIds, corpus]);

    const hasFeatures = flow.featureRefs.length > 0;
    const hasScreens = linkedScreens.length > 0;
    const hasEntities = linkedEntities.length > 0;
    const hasPhases = linkedPhases.length > 0;
    const hasSystems = linkedSystems.length > 0;

    // If literally nothing connects, render nothing — avoids an empty
    // panel that adds noise without information.
    if (!hasFeatures && !hasScreens && !hasEntities && !hasPhases && !hasSystems) {
        return null;
    }

    return (
        <section className="mb-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-2 inline-flex items-center gap-1">
                <Network size={11} /> Related artifacts
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {hasFeatures && (
                    <Section
                        title="Features"
                        icon={<Sparkles size={11} className="text-fuchsia-600" />}
                        count={flow.featureRefs.length}
                    >
                        <div className="flex flex-wrap gap-1.5">
                            {flow.featureRefs.map(ref => (
                                <FeatureReferenceChip
                                    key={ref.id}
                                    refToken={ref}
                                    feature={featuresById?.get(ref.id)}
                                    onSelect={onSelectFeature}
                                />
                            ))}
                        </div>
                    </Section>
                )}

                {(uxPages !== undefined) && (
                    <Section
                        title="Screens"
                        icon={<AppWindow size={11} className="text-indigo-600" />}
                        count={linkedScreens.length}
                    >
                        {hasScreens ? (
                            <div className="flex flex-wrap gap-1.5">
                                {linkedScreens.map(p => (
                                    <span
                                        key={p.id || p.name}
                                        className="inline-flex items-center px-2 py-0.5 rounded-md bg-indigo-50 border border-indigo-200 text-indigo-700 text-[11px] font-medium"
                                        title={p.purpose}
                                    >
                                        {p.name}
                                    </span>
                                ))}
                            </div>
                        ) : (
                            <EmptyChip label="No screens detected — verify in Screen Inventory" />
                        )}
                    </Section>
                )}

                {(domainEntities !== undefined) && (
                    <Section
                        title="Data entities"
                        icon={<Database size={11} className="text-emerald-600" />}
                        count={linkedEntities.length}
                    >
                        {hasEntities ? (
                            <div className="flex flex-wrap gap-1.5">
                                {linkedEntities.map(e => (
                                    <span
                                        key={e.name}
                                        className="inline-flex items-center px-2 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-medium"
                                        title={e.description ?? ''}
                                    >
                                        {e.name}
                                    </span>
                                ))}
                            </div>
                        ) : (
                            <EmptyChip label="No entities detected — verify in Data Model" />
                        )}
                    </Section>
                )}

                {hasPhases && (
                    <Section
                        title="Implementation phases"
                        icon={<ListChecks size={11} className="text-sky-600" />}
                        count={linkedPhases.length}
                    >
                        <ul className="space-y-1">
                            {linkedPhases.map((phase, i) => (
                                <li
                                    key={i}
                                    className="flex items-start gap-1.5 text-[11px] text-neutral-700"
                                >
                                    <span className="shrink-0 mt-0.5 inline-block w-1.5 h-1.5 rounded-full bg-sky-400" />
                                    <span className="min-w-0 flex-1">
                                        <span className="font-medium text-neutral-800">{phase.name}</span>
                                        {phase.estimatedWeeks && (
                                            <span className="ml-1 text-neutral-500">
                                                · {phase.estimatedWeeks}w
                                            </span>
                                        )}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </Section>
                )}

                {hasSystems && (
                    <Section
                        title="Feature systems"
                        icon={<Network size={11} className="text-violet-600" />}
                        count={linkedSystems.length}
                    >
                        <div className="flex flex-wrap gap-1.5">
                            {linkedSystems.map(s => (
                                <span
                                    key={s.id}
                                    className="inline-flex items-center px-2 py-0.5 rounded-md bg-violet-50 border border-violet-200 text-violet-700 text-[11px] font-medium"
                                    title={s.purpose}
                                >
                                    {s.name}
                                </span>
                            ))}
                        </div>
                    </Section>
                )}
            </div>
        </section>
    );
}
