// The Overview tab of the Screen Detail view — a lightweight product-design
// review surface, NOT an implementation dashboard.
//
// Order (mobile-first: the screen itself comes first, warnings/metadata don't):
//   Purpose + User goal → Primary mockup → Review notes → Acceptance checklist →
//   PRD features (collapsed) → Screen details (collapsed).
//
// Developer-handoff content was moved OUT of Screens into the Implementation
// Plan artifact. Risks moved into Review notes. Everything implementation-
// leaning (states, navigation, UI regions, data) is preserved but progressively
// disclosed. Honesty rules still hold: missing data renders "Not specified",
// derived acceptance criteria keep a plain "generated details" disclosure — but
// the noisy "Derived / Estimated / Mapped at generation" badges are gone.

import { useMemo, useState, type ReactNode } from 'react';
import {
    ArrowRight, CheckCircle2, ChevronDown, ChevronUp, GitBranch, Layers, Workflow,
} from 'lucide-react';
import type { Feature, ScreenState } from '../../types';
import type { ScreenExperienceItem } from '../../lib/screenExperience';
import {
    buildScreenTraceability, resolveAcceptanceCriteria,
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
    /** The primary mockup preview, injected so the screen appears near the top. */
    primaryMockup?: ReactNode;
    /** The Review Notes control (stateful — owned by ScreenDetailView). */
    reviewNotes?: ReactNode;
    /** Edit / reset controls, anchored into the Purpose card header instead of
     * floating unattached above it (audit M8). */
    headerActions?: ReactNode;
}

const NotSpecified = ({ children = 'Not specified' }: { children?: ReactNode }) => (
    <span className="text-neutral-400 italic">{children}</span>
);

/** A titled card, with optional right-aligned header actions. */
function Card({ title, icon, actions, children }: {
    title: string; icon?: ReactNode; actions?: ReactNode; children: ReactNode;
}) {
    return (
        <section className="bg-white rounded-lg border border-neutral-200 p-4">
            <header className="flex items-center gap-1.5 mb-2.5">
                {icon}
                <h4 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 flex-1 min-w-0">{title}</h4>
                {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
            </header>
            {children}
        </section>
    );
}

/** A collapsible card — used for the progressively-disclosed sections. */
function Collapsible({
    title, icon, defaultOpen = false, children,
}: {
    title: string;
    icon?: ReactNode;
    defaultOpen?: boolean;
    children: ReactNode;
}) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <section className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className="w-full flex items-center justify-between gap-2 px-4 py-3 hover:bg-neutral-50 transition"
            >
                <span className="flex items-center gap-1.5">
                    {icon}
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{title}</span>
                </span>
                {open ? <ChevronUp size={15} className="text-neutral-400" /> : <ChevronDown size={15} className="text-neutral-400" />}
            </button>
            {open && <div className="px-4 pb-4">{children}</div>}
        </section>
    );
}

export function ScreenOverviewPanel({
    item, features, imageContext, imageStorageName, primaryMockup, reviewNotes, headerActions,
}: Props) {
    const { screen } = item;
    const traceability = useMemo(() => buildScreenTraceability(item, features), [item, features]);
    const criteria = useMemo(() => resolveAcceptanceCriteria(screen), [screen]);

    const ui = (screen.coreUIElements && screen.coreUIElements.length > 0
        ? screen.coreUIElements
        : screen.components ?? []).filter(c => c.trim());
    const states = screen.states ?? [];
    const entry = screen.entryPoints ?? [];
    const exits = screen.exitPaths ?? [];

    return (
        <div className="space-y-3">
            {/* Purpose + user goal — the first meaningful content. */}
            <Card title="Purpose" actions={headerActions}>
                {screen.purpose
                    ? <p className="text-sm leading-relaxed text-neutral-700">{screen.purpose}</p>
                    : <p className="text-xs"><NotSpecified>No purpose recorded yet.</NotSpecified></p>}
                {screen.userIntent && (
                    <p className="text-xs text-neutral-600 mt-2">
                        <span className="text-[10px] uppercase tracking-wide text-neutral-400 mr-1.5">User goal</span>
                        {screen.userIntent}
                    </p>
                )}
            </Card>

            {/* Primary mockup — the screen itself, near the top (storyboard feel). */}
            {primaryMockup}

            {/* Review notes — collapsed, action-oriented. */}
            {reviewNotes}

            {/* Acceptance criteria — concise; full generated text behind disclosure.
                Neutral bullets, NOT green checks: these are derived/generated
                statements the user has not verified, so pass/verified iconography
                would overstate them. */}
            <Card title="Acceptance criteria" icon={<CheckCircle2 size={12} className="text-neutral-400" aria-hidden />}>
                {criteria.criteria.length > 0 ? (
                    <>
                        <ul className="space-y-1.5">
                            {criteria.criteria.map((c, i) => (
                                <li key={i} className="flex gap-2 items-start text-xs text-neutral-700">
                                    <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-neutral-300 shrink-0" aria-hidden />
                                    <span>{c}</span>
                                </li>
                            ))}
                        </ul>
                        <details className="mt-2 group">
                            <summary className="text-[11px] text-neutral-400 hover:text-neutral-600 cursor-pointer list-none">
                                Show generated details
                            </summary>
                            <p className="text-[11px] text-neutral-500 mt-1.5">
                                {criteria.source === 'generated'
                                    ? 'Generated with this screen (screen-level plus per-state criteria). Review and refine before treating these as requirements.'
                                    : 'Restated from the screen’s intent, navigation, states, and risks. Review and refine before treating these as requirements.'}
                            </p>
                        </details>
                    </>
                ) : (
                    <p className="text-xs text-neutral-500">
                        Not enough detail yet to state acceptance criteria — add the intent, navigation, and states.
                    </p>
                )}
            </Card>

            {/* PRD features — collapsed reference. */}
            <Collapsible title="PRD features" icon={<GitBranch size={12} className="text-violet-500" aria-hidden />}>
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
                                        <span className="text-neutral-400"> (not in the current PRD feature list)</span>
                                    )}
                                </span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-xs text-neutral-500">
                        No linked PRD features found. Link this screen to the requirements it serves, or confirm
                        it is intentional supporting UI.
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
            </Collapsible>

            {/* Screen details — everything implementation-leaning, progressively
                disclosed so it never crowds the review. */}
            <Collapsible title="Screen details" icon={<Layers size={12} className="text-sky-500" aria-hidden />}>
                <div className="space-y-4">
                    {/* Entry / exit navigation */}
                    <div>
                        <div className="text-[10px] uppercase tracking-wide text-neutral-400 mb-1.5">Navigation</div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-xs">
                            <div>
                                <div className="text-[10px] font-medium text-neutral-500 mb-1">How users arrive</div>
                                {entry.length > 0 ? (
                                    <ul className="text-neutral-700 space-y-0.5">
                                        {entry.map((e, i) => (
                                            <li key={i} className="flex gap-1.5"><span className="text-neutral-300">·</span><span>{e}</span></li>
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
                                                {p.condition && <div className="text-[11px] text-neutral-400 italic mt-0.5">when {p.condition}</div>}
                                            </li>
                                        ))}
                                    </ul>
                                ) : <NotSpecified />}
                            </div>
                        </div>
                    </div>

                    {/* Core UI regions + data */}
                    <div>
                        <div className="text-[10px] uppercase tracking-wide text-neutral-400 mb-1.5">Core UI regions</div>
                        {ui.length > 0 ? (
                            <ul className="space-y-1 text-xs text-neutral-700">
                                {ui.map((c, i) => (
                                    <li key={i} className="flex gap-1.5"><span className="text-neutral-300">·</span><span>{c}</span></li>
                                ))}
                            </ul>
                        ) : <p className="text-xs"><NotSpecified>Not specified.</NotSpecified></p>}
                        {screen.outputData && screen.outputData.length > 0 && (
                            <div className="mt-2.5">
                                <div className="text-[10px] uppercase tracking-wide text-neutral-400 mb-1">Data outputs</div>
                                <ul className="text-xs text-neutral-700 space-y-0.5">
                                    {screen.outputData.map((o, i) => (
                                        <li key={i} className="flex gap-1.5"><span className="text-neutral-300">·</span><span>{o}</span></li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>

                    {/* Required states */}
                    <div>
                        <div className="text-[10px] uppercase tracking-wide text-neutral-400 mb-1.5">Screen states</div>
                        {states.length > 0 ? (
                            <ul className="space-y-2">
                                {states.map((s, i) => <StateRow key={i} state={s} />)}
                            </ul>
                        ) : (
                            <p className="text-xs text-neutral-500">
                                No UI states documented. Empty, loading, and error states may still be needed.
                            </p>
                        )}
                    </div>
                </div>
            </Collapsible>

            {/* Titled — this used to be an unlabeled card whose only visible
                content was orphaned "Copy image prompt / Upload image" actions
                (audit M8). */}
            {imageContext && (
                <Card title="Your reference images">
                    <ScreenImageGallery screen={screen} context={imageContext} storageName={imageStorageName} />
                </Card>
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
            </dl>
        </li>
    );
}
