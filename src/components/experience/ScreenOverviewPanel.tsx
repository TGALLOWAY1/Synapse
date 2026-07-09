// Structured "screen contract" for the Screen Detail Overview tab. Replaces
// the flat ScreenCard presentation with clearly-labeled sections: purpose,
// PRD traceability, navigation, core UI regions, required states, risks,
// derived acceptance criteria, and a lightweight developer-handoff block.
//
// Honesty rules (see src/lib/screenReadiness.ts): every derived section is
// labeled as derived/estimated; missing data renders as "Not specified" /
// "Review recommended" — never fabricated. The generated artifact content is
// never modified here; this is presentation over the joined index.

import { useMemo, type ReactNode } from 'react';
import {
    AlertTriangle, ArrowRight, CheckCircle2, Code2, GitBranch, Layers, ListChecks, Workflow,
} from 'lucide-react';
import type { Feature, ScreenItem, ScreenState } from '../../types';
import type { ScreenExperienceItem } from '../../lib/screenExperience';
import {
    buildScreenTraceability, resolveAcceptanceCriteria, resolveScreenHandoff,
    type ScreenReadiness,
} from '../../lib/screenReadiness';
import { ScreenImageGallery, type ScreenImageGalleryContext } from '../renderers/ScreenImageGallery';

interface Props {
    item: ScreenExperienceItem;
    readiness?: ScreenReadiness;
    features?: Feature[];
    /** Upload gallery context — absent for legacy inventories. */
    imageContext?: ScreenImageGalleryContext;
    /** Stored generated name the gallery keys images by (rename-safe). */
    imageStorageName?: string;
}

function Section({
    title, icon, badge, children,
}: {
    title: string;
    icon?: ReactNode;
    badge?: ReactNode;
    children: ReactNode;
}) {
    return (
        <section className="bg-white rounded-lg border border-neutral-200 p-4">
            <header className="flex items-center gap-1.5 mb-2.5">
                {icon}
                <h4 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                    {title}
                </h4>
                {badge}
            </header>
            {children}
        </section>
    );
}

function DerivedBadge({ label = 'Derived' }: { label?: string }) {
    return (
        <span className="text-[9px] uppercase tracking-wide text-indigo-500 bg-indigo-50 ring-1 ring-indigo-100 px-1.5 py-0.5 rounded">
            {label}
        </span>
    );
}

const NotSpecified = ({ children = 'Not specified' }: { children?: ReactNode }) => (
    <span className="text-neutral-400 italic">{children}</span>
);

export function ScreenOverviewPanel({
    item, readiness, features, imageContext, imageStorageName,
}: Props) {
    const { screen } = item;
    const traceability = useMemo(
        () => buildScreenTraceability(item, features),
        [item, features],
    );
    const criteria = useMemo(() => resolveAcceptanceCriteria(screen), [screen]);
    const handoff = useMemo(() => resolveScreenHandoff(screen), [screen]);

    // The spec's own UI regions — deliberately NOT handoff.components, which
    // may be the generated primaryComponents list instead.
    const ui = (screen.coreUIElements && screen.coreUIElements.length > 0
        ? screen.coreUIElements
        : screen.components ?? []).filter(c => c.trim());
    const states = screen.states ?? [];
    const entry = screen.entryPoints ?? [];
    const exits = screen.exitPaths ?? [];

    return (
        <div className="space-y-3">
            {/* Purpose & user goal */}
            <Section title="Purpose">
                {screen.purpose
                    ? <p className="text-xs leading-relaxed text-neutral-700">{screen.purpose}</p>
                    : <p className="text-xs"><NotSpecified>No purpose recorded — review recommended.</NotSpecified></p>}
                {screen.userIntent && (
                    <p className="text-xs italic text-neutral-600 mt-2">
                        <span className="not-italic text-[10px] uppercase tracking-wide text-neutral-400 mr-1.5">User goal</span>
                        {screen.userIntent}
                    </p>
                )}
            </Section>

            {/* PRD traceability */}
            <Section
                title="PRD Traceability"
                icon={<GitBranch size={12} className="text-violet-500" aria-hidden />}
                badge={(
                    <DerivedBadge
                        label={traceability.confidence === 'explicit'
                            ? 'Mapped at generation'
                            : traceability.confidence === 'estimated'
                                ? 'Estimated from linked features'
                                : 'Traceability incomplete'}
                    />
                )}
            >
                {traceability.features.length > 0 ? (
                    <ul className="space-y-1">
                        {traceability.features.map((link, i) => (
                            <li key={i} className="flex items-start gap-1.5 text-xs">
                                <span className="font-mono font-medium text-violet-700 bg-violet-50 ring-1 ring-violet-200 rounded px-1 py-px shrink-0">
                                    {link.feature?.id ?? link.refId ?? '—'}
                                </span>
                                <span className="text-neutral-700">
                                    {link.feature?.name ?? link.raw}
                                    {link.refId && !link.feature && (
                                        <span className="text-neutral-400"> (not found in the current PRD feature list)</span>
                                    )}
                                </span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-xs text-amber-700">
                        No linked PRD features found. Review recommended — link this screen back to
                        the requirements it serves, or confirm it is intentional supporting UI.
                    </p>
                )}
                {traceability.confidence === 'explicit' && (
                    <p className="text-[11px] text-neutral-400 mt-2">
                        All linked ids resolve to PRD features. Mapped when the artifact was
                        generated — worth a human once-over, not a semantic guarantee.
                    </p>
                )}
                {traceability.flows.length > 0 && (
                    <div className="mt-2.5">
                        <div className="text-[10px] uppercase tracking-wide text-neutral-400 mb-1">User flows</div>
                        <ul className="space-y-0.5 text-xs text-neutral-700">
                            {traceability.flows.map((title, i) => (
                                <li key={i} className="flex items-center gap-1.5">
                                    <Workflow size={11} className="text-indigo-400 shrink-0" aria-hidden />
                                    {title}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </Section>

            {/* Entry / exit navigation */}
            <Section title="Entry & Exit Paths">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-xs">
                    <div>
                        <div className="text-[10px] font-medium text-neutral-500 mb-1">How users arrive</div>
                        {entry.length > 0 ? (
                            <ul className="text-neutral-700 space-y-0.5">
                                {entry.map((e, i) => (
                                    <li key={i} className="flex gap-1.5">
                                        <span className="text-neutral-300 select-none">·</span>
                                        <span>{e}</span>
                                    </li>
                                ))}
                            </ul>
                        ) : <NotSpecified />}
                    </div>
                    <div>
                        <div className="text-[10px] font-medium text-neutral-500 mb-1">Where users go next</div>
                        {exits.length > 0 ? (
                            <ul className="text-neutral-700 space-y-1">
                                {exits.map((p, i) => (
                                    <li key={i}>
                                        <div className="flex items-center gap-1 flex-wrap">
                                            <span>{p.label}</span>
                                            <ArrowRight size={10} className="text-neutral-400 shrink-0" aria-hidden />
                                            <span>{p.target}</span>
                                        </div>
                                        {p.condition && (
                                            <div className="text-[11px] text-neutral-400 italic mt-0.5">
                                                when {p.condition}
                                            </div>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        ) : <NotSpecified />}
                    </div>
                </div>
            </Section>

            {/* Core UI regions */}
            <Section title="Core UI Regions" icon={<Layers size={12} className="text-sky-500" aria-hidden />}>
                {ui.length > 0 ? (
                    <>
                        <ul className="space-y-1 text-xs text-neutral-700">
                            {ui.map((c, i) => (
                                <li key={i} className="flex gap-1.5">
                                    <span className="text-neutral-300 select-none">·</span>
                                    <span>{c}</span>
                                </li>
                            ))}
                        </ul>
                        <p className="text-[11px] text-neutral-400 mt-2">
                            Component-level details (props, behavior) are not specified in this
                            artifact — treat each region as a starting point for the component breakdown.
                        </p>
                    </>
                ) : (
                    <p className="text-xs"><NotSpecified>Component details not specified.</NotSpecified></p>
                )}
                {screen.outputData && screen.outputData.length > 0 && (
                    <div className="mt-2.5">
                        <div className="text-[10px] uppercase tracking-wide text-neutral-400 mb-1">Data outputs</div>
                        <ul className="text-xs text-neutral-700 space-y-0.5">
                            {screen.outputData.map((o, i) => (
                                <li key={i} className="flex gap-1.5">
                                    <span className="text-neutral-300 select-none">·</span>
                                    <span>{o}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </Section>

            {/* Required states */}
            <Section title="Required States" icon={<Layers size={12} className="text-indigo-500" aria-hidden />}>
                {states.length > 0 ? (
                    <ul className="space-y-2">
                        {states.map((s, i) => <StateRow key={i} state={s} />)}
                    </ul>
                ) : (
                    <p className="text-xs text-amber-700">
                        No UI states documented. Empty, loading, and error states may still be
                        needed — review recommended before implementation.
                    </p>
                )}
            </Section>

            {/* Risks & edge cases */}
            <Section title="Risks & Edge Cases" icon={<AlertTriangle size={12} className="text-amber-500" aria-hidden />}>
                <RisksBlock screen={screen} />
            </Section>

            {/* Acceptance criteria (generated when the contract carries them,
                derived otherwise) */}
            <Section
                title="Acceptance Criteria"
                icon={<ListChecks size={12} className="text-emerald-600" aria-hidden />}
                badge={<DerivedBadge label={criteria.source === 'generated' ? 'From generated spec' : 'Derived from this spec'} />}
            >
                {criteria.criteria.length > 0 ? (
                    <>
                        <ul className="space-y-1.5 text-xs text-neutral-700">
                            {criteria.criteria.map((c, i) => (
                                <li key={i} className="flex gap-1.5 items-start">
                                    <CheckCircle2 size={12} className="text-emerald-500 mt-0.5 shrink-0" aria-hidden />
                                    <span>{c}</span>
                                </li>
                            ))}
                        </ul>
                        <p className="text-[11px] text-neutral-400 mt-2">
                            {criteria.source === 'generated'
                                ? 'Generated with this screen (screen-level plus per-state criteria) — review and refine before treating these as requirements.'
                                : 'Restated from the screen’s intent, navigation, states, and risks — review and refine before treating these as requirements.'}
                        </p>
                    </>
                ) : (
                    <p className="text-xs text-amber-700">
                        Not enough detail (intent, navigation, states) to derive acceptance
                        criteria yet. Review recommended.
                    </p>
                )}
            </Section>

            {/* Developer handoff — generated contract fields when the artifact
                carries them, Phase 1 derived projection otherwise */}
            <Section
                title="Developer Handoff"
                icon={<Code2 size={12} className="text-neutral-500" aria-hidden />}
                badge={<DerivedBadge label={handoff.source === 'generated' ? 'From generated spec' : 'Derived from this spec'} />}
            >
                <dl className="space-y-2.5 text-xs">
                    <HandoffRow label="Route">
                        {handoff.route ? (
                            <span className="font-mono text-neutral-800">
                                {handoff.route}
                                {handoff.routeParams.length > 0 && (
                                    <span className="text-neutral-400 font-sans"> · params: {handoff.routeParams.join(', ')}</span>
                                )}
                            </span>
                        ) : (
                            <NotSpecified>Not specified in this artifact — assign during implementation planning.</NotSpecified>
                        )}
                    </HandoffRow>
                    <HandoffRow label={handoff.source === 'generated' ? 'Primary components' : 'UI regions to build'}>
                        {handoff.components.length > 0
                            ? <ChipList values={handoff.components} />
                            : <NotSpecified />}
                    </HandoffRow>
                    <HandoffRow label="States to implement">
                        {handoff.states.length > 0
                            ? <ChipList values={handoff.states} />
                            : <NotSpecified />}
                    </HandoffRow>
                    {handoff.stateVariables.length > 0 && (
                        <HandoffRow label="State variables">
                            <ChipList values={handoff.stateVariables} mono />
                        </HandoffRow>
                    )}
                    <HandoffRow label="Interactions / events">
                        {handoff.events.length > 0 ? (
                            <ul className="space-y-0.5 text-neutral-700">
                                {handoff.events.map((e, i) => (
                                    <li key={i} className="flex items-center gap-1 flex-wrap">
                                        <span className="font-mono font-medium">{e.name}</span>
                                        {e.trigger && <span className="text-neutral-400 italic">on {e.trigger}</span>}
                                        {e.effect && (
                                            <>
                                                <ArrowRight size={10} className="text-neutral-400" aria-hidden />
                                                <span>{e.effect}</span>
                                            </>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        ) : handoff.exitEvents.length > 0 ? (
                            <ul className="space-y-0.5 text-neutral-700">
                                {handoff.exitEvents.map((e, i) => (
                                    <li key={i} className="flex items-center gap-1 flex-wrap">
                                        <span className="font-medium">{e.label}</span>
                                        <ArrowRight size={10} className="text-neutral-400" aria-hidden />
                                        <span>{e.target}</span>
                                        {e.condition && <span className="text-neutral-400 italic">when {e.condition}</span>}
                                    </li>
                                ))}
                            </ul>
                        ) : <NotSpecified />}
                    </HandoffRow>
                    {(handoff.dataDependencies.length > 0 || handoff.apiDependencies.length > 0) && (
                        <HandoffRow label="Data & API dependencies">
                            <ChipList values={[...handoff.dataDependencies, ...handoff.apiDependencies]} />
                        </HandoffRow>
                    )}
                    <HandoffRow label="Data produced">
                        {handoff.outputs.length > 0
                            ? <ChipList values={handoff.outputs} />
                            : <NotSpecified />}
                    </HandoffRow>
                    <HandoffRow label="Accessibility">
                        {handoff.accessibilityNotes.length > 0 ? (
                            <ul className="space-y-0.5 text-neutral-700">
                                {handoff.accessibilityNotes.map((n, i) => (
                                    <li key={i} className="flex gap-1.5">
                                        <span className="text-neutral-300 select-none">·</span>
                                        <span>{n}</span>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <NotSpecified>Not specified — apply the project&rsquo;s standard accessibility checklist.</NotSpecified>
                        )}
                    </HandoffRow>
                    {handoff.responsiveNotes.length > 0 && (
                        <HandoffRow label="Responsive behavior">
                            <ul className="space-y-0.5 text-neutral-700">
                                {handoff.responsiveNotes.map((n, i) => (
                                    <li key={i} className="flex gap-1.5">
                                        <span className="text-neutral-300 select-none">·</span>
                                        <span>{n}</span>
                                    </li>
                                ))}
                            </ul>
                        </HandoffRow>
                    )}
                </dl>
                {readiness && readiness.gaps.length > 0 && (
                    <p className="text-[11px] text-amber-700 mt-2.5">
                        Before building: {readiness.gaps.slice(0, 3).map(g => g.message).join(' ')}
                    </p>
                )}
            </Section>

            {imageContext && (
                <div className="bg-white rounded-lg border border-neutral-200 p-4">
                    <ScreenImageGallery
                        screen={screen}
                        context={imageContext}
                        storageName={imageStorageName}
                    />
                </div>
            )}
        </div>
    );
}

function StateRow({ state }: { state: ScreenState }) {
    return (
        <li className="rounded-md border border-neutral-200 bg-neutral-50/60 px-2.5 py-2 text-xs">
            <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-medium text-neutral-800">{state.name}</span>
                {state.type && (
                    <span className="text-[9px] uppercase tracking-wide text-sky-700 bg-sky-50 ring-1 ring-sky-100 px-1.5 py-0.5 rounded">
                        {state.type}
                    </span>
                )}
                {state.required && (
                    <span className="text-[9px] uppercase tracking-wide text-indigo-700 bg-indigo-50 ring-1 ring-indigo-100 px-1.5 py-0.5 rounded">
                        Required
                    </span>
                )}
                {state.needsMockup && (
                    <span className="text-[9px] uppercase tracking-wide text-violet-700 bg-violet-50 ring-1 ring-violet-100 px-1.5 py-0.5 rounded">
                        Needs mockup
                    </span>
                )}
            </div>
            <dl className="mt-1 space-y-0.5 text-[11px]">
                <div className="flex gap-1.5">
                    <dt className="text-neutral-400 shrink-0 w-16">Trigger</dt>
                    <dd className="text-neutral-700">{state.trigger?.trim() || <NotSpecified />}</dd>
                </div>
                <div className="flex gap-1.5">
                    <dt className="text-neutral-400 shrink-0 w-16">User sees</dt>
                    <dd className="text-neutral-700">{state.description?.trim() || <NotSpecified />}</dd>
                </div>
                {state.systemBehavior?.trim() && (
                    <div className="flex gap-1.5">
                        <dt className="text-neutral-400 shrink-0 w-16">System</dt>
                        <dd className="text-neutral-700">{state.systemBehavior}</dd>
                    </div>
                )}
                {state.recoveryPath?.trim() && (
                    <div className="flex gap-1.5">
                        <dt className="text-neutral-400 shrink-0 w-16">Recovery</dt>
                        <dd className="text-neutral-700">{state.recoveryPath}</dd>
                    </div>
                )}
            </dl>
            {state.acceptanceCriteria && state.acceptanceCriteria.length > 0 && (
                <ul className="mt-1.5 space-y-0.5 text-[11px] text-neutral-600">
                    {state.acceptanceCriteria.map((c, i) => (
                        <li key={i} className="flex gap-1.5 items-start">
                            <CheckCircle2 size={10} className="text-emerald-500 mt-0.5 shrink-0" aria-hidden />
                            <span>{c}</span>
                        </li>
                    ))}
                </ul>
            )}
        </li>
    );
}

/** Risks list preferring structured riskDetails (severity + proposed
 * handling) and falling back to the legacy plain-string list. */
function RisksBlock({ screen }: { screen: ScreenItem }) {
    const details = screen.riskDetails ?? [];
    const legacy = details.length === 0 ? screen.risks ?? [] : [];
    if (details.length === 0 && legacy.length === 0) {
        return (
            <p className="text-xs text-neutral-500">
                No risks noted in the spec. That may just mean none were identified —
                worth a quick check for edge cases during review.
            </p>
        );
    }
    const severityStyle: Record<string, string> = {
        low: 'text-neutral-600 bg-neutral-100 ring-neutral-200',
        medium: 'text-amber-700 bg-amber-50 ring-amber-200',
        high: 'text-red-700 bg-red-50 ring-red-200',
    };
    return (
        <ul className="space-y-2">
            {details.map((r, i) => {
                const handled = Boolean(r.proposedHandling?.trim());
                return (
                    <li key={i} className={`rounded-md border px-2.5 py-2 text-xs ${handled ? 'border-neutral-200 bg-neutral-50/60' : 'border-amber-200 bg-amber-50/50'}`}>
                        <div className="flex gap-1.5 items-start text-neutral-800">
                            <AlertTriangle size={12} className={`${handled ? 'text-neutral-400' : 'text-amber-600'} mt-0.5 shrink-0`} aria-hidden />
                            <span>{r.description}</span>
                        </div>
                        <div className="mt-1.5 flex items-center gap-3 text-[11px] text-neutral-500 pl-[18px] flex-wrap">
                            {r.severity ? (
                                <span className={`px-1.5 py-px rounded ring-1 uppercase tracking-wide text-[9px] font-medium ${severityStyle[r.severity]}`}>
                                    {r.severity}
                                </span>
                            ) : (
                                <span>Severity: <NotSpecified /></span>
                            )}
                            {handled ? (
                                <span className="text-neutral-600">Handling: {r.proposedHandling}</span>
                            ) : (
                                <>
                                    <span>Proposed handling: <NotSpecified /></span>
                                    <span className="text-amber-700 font-medium">Needs review</span>
                                </>
                            )}
                        </div>
                    </li>
                );
            })}
            {legacy.map((r, i) => (
                <li key={`legacy-${i}`} className="rounded-md border border-amber-200 bg-amber-50/50 px-2.5 py-2 text-xs">
                    <div className="flex gap-1.5 items-start text-neutral-800">
                        <AlertTriangle size={12} className="text-amber-600 mt-0.5 shrink-0" aria-hidden />
                        <span>{r}</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-3 text-[11px] text-neutral-500 pl-[18px] flex-wrap">
                        <span>Severity: <NotSpecified /></span>
                        <span>Proposed handling: <NotSpecified /></span>
                        <span className="text-amber-700 font-medium">Needs review</span>
                    </div>
                </li>
            ))}
        </ul>
    );
}

function HandoffRow({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div>
            <dt className="text-[10px] uppercase tracking-wide text-neutral-400 mb-0.5">{label}</dt>
            <dd>{children}</dd>
        </div>
    );
}

function ChipList({ values, mono = false }: { values: string[]; mono?: boolean }) {
    return (
        <div className="flex flex-wrap gap-1">
            {values.map((v, i) => (
                <span key={i} className={`text-[11px] bg-neutral-100 text-neutral-700 px-1.5 py-0.5 rounded ${mono ? 'font-mono' : ''}`}>
                    {v}
                </span>
            ))}
        </div>
    );
}
