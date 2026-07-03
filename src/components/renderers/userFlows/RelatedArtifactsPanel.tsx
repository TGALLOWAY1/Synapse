import type { ReactNode } from 'react';
import { AppWindow, Database, ListChecks, Network, Sparkles } from 'lucide-react';
import type { Feature } from '../../../types';
import type { FeatureRef } from './types';
import type { RelatedArtifacts } from './relatedArtifacts';
import { hasAnyRelated, relatedSummaryParts } from './relatedArtifacts';
import { FeatureReferenceChip } from './FeatureReferenceChip';
import { CollapsibleSection } from './CollapsibleSection';

interface Props {
    /** Precomputed heuristic join (shared with the flow header summary). */
    related: RelatedArtifacts;
    featuresById?: Map<string, Feature>;
    onSelectFeature: (refToken: FeatureRef) => void;
}

function Section({
    title, icon, children, count,
}: {
    title: string;
    icon: ReactNode;
    count?: number;
    children: ReactNode;
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

/**
 * Progressive-disclosure panel of PRD artifacts this flow touches. The
 * heuristic join is computed once by the parent and shared with the compact
 * relationship summary in the flow header, so counts never disagree.
 * Collapsed by default — secondary context, not primary reading flow.
 */
export function RelatedArtifactsPanel({ related, featuresById, onSelectFeature }: Props) {
    // If literally nothing connects, render nothing — avoids an empty panel
    // that adds noise without information.
    if (!hasAnyRelated(related)) return null;

    const { features, screens, entities, phases, systems } = related;
    const total = features.length + screens.length + entities.length
        + phases.length + systems.length;

    return (
        <CollapsibleSection
            title="Related artifacts"
            icon={<Network size={12} />}
            count={total}
            collapsedSummary={relatedSummaryParts(related).join(' · ')}
        >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {features.length > 0 && (
                    <Section
                        title="Features"
                        icon={<Sparkles size={11} className="text-fuchsia-600" />}
                        count={features.length}
                    >
                        <div className="flex flex-wrap gap-1.5">
                            {features.map(ref => (
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

                {related.hasScreenCatalog && (
                    <Section
                        title="Screens"
                        icon={<AppWindow size={11} className="text-indigo-600" />}
                        count={screens.length}
                    >
                        {screens.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
                                {screens.map(p => (
                                    <span
                                        key={p.id || p.name}
                                        className="inline-flex items-center px-2 py-0.5 rounded-md bg-neutral-50 border border-neutral-200 text-neutral-700 text-[11px] font-medium"
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

                {related.hasEntityCatalog && (
                    <Section
                        title="Data entities"
                        icon={<Database size={11} className="text-emerald-600" />}
                        count={entities.length}
                    >
                        {entities.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
                                {entities.map(e => (
                                    <span
                                        key={e.name}
                                        className="inline-flex items-center px-2 py-0.5 rounded-md bg-neutral-50 border border-neutral-200 text-neutral-700 text-[11px] font-medium"
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

                {phases.length > 0 && (
                    <Section
                        title="Implementation phases"
                        icon={<ListChecks size={11} className="text-sky-600" />}
                        count={phases.length}
                    >
                        <ul className="space-y-1">
                            {phases.map((phase, i) => (
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

                {systems.length > 0 && (
                    <Section
                        title="Feature systems"
                        icon={<Network size={11} className="text-violet-600" />}
                        count={systems.length}
                    >
                        <div className="flex flex-wrap gap-1.5">
                            {systems.map(s => (
                                <span
                                    key={s.id}
                                    className="inline-flex items-center px-2 py-0.5 rounded-md bg-neutral-50 border border-neutral-200 text-neutral-700 text-[11px] font-medium"
                                    title={s.purpose}
                                >
                                    {s.name}
                                </span>
                            ))}
                        </div>
                    </Section>
                )}
            </div>
        </CollapsibleSection>
    );
}
