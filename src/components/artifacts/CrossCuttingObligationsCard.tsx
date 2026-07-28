import { useState, type ReactNode } from 'react';
import {
    AlertTriangle, ArrowRight, ChevronDown, ClipboardCheck, ListChecks, ShieldCheck,
} from 'lucide-react';
import type { PlanMeasurementSection, PlanSecurityPrivacySection } from '../../types';
import type { FlagPlanningConcernResult } from '../../lib/planning/flagToPlan';
import type {
    CrossCuttingObligationStatus,
    CrossCuttingObligationsReport,
} from '../../lib/planning/crossCuttingObligations';

interface Props {
    /** Derived report — required-ness + satisfaction per section (never persisted). */
    report: CrossCuttingObligationsReport;
    /** The plan's sections, when it carries them. */
    securityPrivacy?: PlanSecurityPrivacySection;
    measurement?: PlanMeasurementSection;
    /**
     * User-initiated route from a flagged obligation into the Decision Center.
     * Supplied only when the project may persist planning state — the workspace
     * derives that from the capability policy (`useProjectCapabilities`), never
     * from a project-id check. When it is absent NO write action is rendered,
     * so a demo/read-only project is never offered an action that would write.
     *
     * It must never be called on render (cross-cutting rule 13): the flag is a
     * pointer, and a `PlanningRecord` exists only after the user clicks.
     */
    onAddressObligation?: (
        status: CrossCuttingObligationStatus,
    ) => FlagPlanningConcernResult | void;
}

type ObligationState = 'unresolved' | 'covered' | 'not_required';

const CHIP_CLASS: Record<ObligationState, string> = {
    unresolved: 'border-amber-200 bg-amber-50 text-amber-800',
    covered: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    not_required: 'border-neutral-200 bg-neutral-50 text-neutral-500',
};

const ICON_CLASS: Record<ObligationState, string> = {
    unresolved: 'text-amber-600',
    covered: 'text-emerald-600',
    not_required: 'text-neutral-400',
};

/**
 * The Implementation Plan's two CONDITIONAL cross-cutting sections (plan §W5),
 * rendered as **compact flags** — one quiet row per section, never a full-width
 * amber panel and never a nested amber sub-panel.
 *
 *  1. **Not required** — renders nothing at all, unless the plan volunteered
 *     content anyway (that is real plan output and stays reachable).
 *  2. **Required and satisfied** — a "Covered" chip; the controls / metric
 *     mappings with their links sit behind the row's disclosure.
 *  3. **Required and not satisfied** — an amber *chip* naming the gap count
 *     ("3 gaps" / "Not in the plan") plus ONE action: address it in the
 *     Decision Center. The named gaps and the trigger evidence stay reachable
 *     behind the same disclosure.
 *
 * SEVERITY IS EXPRESSED ONCE. An unresolved obligation is a build-packet
 * blocker, and §W6's blocker list inside Final Review is the single
 * authoritative statement of that — it carries the consequence, the remedy, and
 * the count that drives the "Resolve N blockers" primary action. This card is a
 * quiet pointer to it, not a second full-volume statement of the same fact: the
 * row stays collapsed by default and the detail says where the severity lives
 * instead of restating it. Nothing here blocks generation or rendering; the
 * gate that blocks reads the same `deriveCrossCuttingObligations` report.
 */
export function CrossCuttingObligationsCard({
    report,
    securityPrivacy,
    measurement,
    onAddressObligation,
}: Props) {
    const showSecurity = shouldRender(report.securityPrivacy);
    const showMeasurement = shouldRender(report.measurement);
    if (!showSecurity && !showMeasurement) return null;

    return (
        <div
            data-testid="plan-cross-cutting-obligations"
            className="not-prose divide-y divide-neutral-100 rounded-lg border border-neutral-200"
        >
            {showSecurity && (
                <ObligationFlag
                    status={report.securityPrivacy}
                    icon={<ShieldCheck size={13} aria-hidden="true" />}
                    onAddressObligation={onAddressObligation}
                >
                    <SecurityPrivacyBody section={securityPrivacy} />
                </ObligationFlag>
            )}
            {showMeasurement && (
                <ObligationFlag
                    status={report.measurement}
                    icon={<ListChecks size={13} aria-hidden="true" />}
                    onAddressObligation={onAddressObligation}
                >
                    <MeasurementBody section={measurement} />
                </ObligationFlag>
            )}
        </div>
    );
}

/**
 * State 1 (not required) renders nothing — unless the plan volunteered content
 * anyway, which is real plan output and stays visible rather than being hidden.
 */
function shouldRender(status: CrossCuttingObligationStatus): boolean {
    return status.required || status.itemCount > 0;
}

function obligationState(status: CrossCuttingObligationStatus): ObligationState {
    if (!status.required) return 'not_required';
    return status.satisfied ? 'covered' : 'unresolved';
}

function chipLabel(status: CrossCuttingObligationStatus, state: ObligationState): string {
    if (state === 'covered') return 'Covered';
    if (state === 'not_required') return 'Not required';
    if (status.absent) return 'Not in the plan';
    return `${status.missing.length} gap${status.missing.length === 1 ? '' : 's'}`;
}

function rejectionCopy(
    result: Extract<FlagPlanningConcernResult, { status: 'rejected' }>,
): string {
    if (result.reason === 'source_changed') {
        return 'This plan changed since you opened it. Reopen the current version, then try again.';
    }
    if (result.reason === 'spine_not_found') {
        return 'The PRD version this plan was generated from is no longer available.';
    }
    return 'This plan version is no longer available. Reopen the current Implementation Plan to try again.';
}

/**
 * ONE compact row. The disclosure is a button + `aria-expanded` + conditional
 * render rather than `<details>` (UI_PATTERNS: jsdom does not toggle
 * `<details>`, and collapsed `<details>` content still sits in the DOM and the
 * accessibility tree).
 */
function ObligationFlag({
    status,
    icon,
    children,
    onAddressObligation,
}: {
    status: CrossCuttingObligationStatus;
    icon: ReactNode;
    children: ReactNode;
    onAddressObligation?: (
        status: CrossCuttingObligationStatus,
    ) => FlagPlanningConcernResult | void;
}) {
    const [open, setOpen] = useState(false);
    const [rejection, setRejection] = useState<string | null>(null);
    const state = obligationState(status);
    const unresolved = state === 'unresolved';

    const address = () => {
        setRejection(null);
        const result = onAddressObligation?.(status);
        if (result && result.status === 'rejected') setRejection(rejectionCopy(result));
    };

    return (
        <section
            aria-label={status.label}
            data-testid={`plan-obligation-${status.key}`}
            data-obligation-state={state}
        >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1">
                <button
                    type="button"
                    data-testid={`plan-obligation-toggle-${status.key}`}
                    aria-expanded={open}
                    onClick={() => setOpen(value => !value)}
                    className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left"
                >
                    <ChevronDown
                        size={14}
                        className={`shrink-0 text-neutral-400 transition ${open ? 'rotate-180' : ''}`}
                        aria-hidden="true"
                    />
                    <span className={`shrink-0 ${ICON_CLASS[state]}`}>
                        {unresolved ? <AlertTriangle size={13} aria-hidden="true" /> : icon}
                    </span>
                    <span className="min-w-0 truncate text-sm font-medium text-neutral-800">
                        {status.label}
                    </span>
                    <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${CHIP_CLASS[state]}`}>
                        {chipLabel(status, state)}
                    </span>
                </button>
                {unresolved && onAddressObligation && (
                    <button
                        type="button"
                        data-testid={`plan-obligation-address-${status.key}`}
                        onClick={address}
                        className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-md border border-neutral-200 bg-white px-2.5 text-[11px] font-medium text-neutral-700 transition hover:bg-neutral-50"
                    >
                        Address in Decision Center
                        <ArrowRight size={11} aria-hidden="true" />
                    </button>
                )}
            </div>

            {rejection && (
                <p role="alert" className="px-3 pb-2 text-[11px] text-amber-800">
                    {rejection}
                </p>
            )}

            {open && (
                <div className="space-y-2.5 border-t border-neutral-100 px-3 py-2.5">
                    <p className="text-xs text-neutral-600">{status.reason}</p>

                    {/* State 3: the named gaps — a plain list, not a nested panel.
                        Their severity is stated once, in Final Review's blocker
                        list; this only says where to find it. */}
                    {unresolved && status.missing.length > 0 && (
                        <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                                {status.absent ? 'Missing from the plan' : `Gaps (${status.missing.length})`}
                            </p>
                            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-neutral-700">
                                {status.missing.map((item, i) => <li key={i}>{item}</li>)}
                            </ul>
                            <p className="mt-1.5 text-[11px] text-neutral-500">
                                Counted in the Final Review blockers above, which state what it
                                costs and how to close it.
                            </p>
                        </div>
                    )}

                    {/* Why it is required — the exact input signals, quoted. */}
                    {status.triggers.length > 0 && (
                        <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                                {status.triggers.length === 1
                                    ? 'What triggered this obligation'
                                    : `What triggered this obligation (${status.triggers.length})`}
                            </p>
                            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-neutral-600">
                                {status.triggers.map((trigger, i) => (
                                    <li key={`${trigger.source}-${i}`}>{trigger.detail}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* State 2 (and any partial content in state 3). */}
                    {children}

                    {status.advisories.length > 0 && (
                        <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-neutral-500">
                            {status.advisories.map((item, i) => <li key={i}>{item}</li>)}
                        </ul>
                    )}
                </div>
            )}
        </section>
    );
}

function SecurityPrivacyBody({ section }: { section?: PlanSecurityPrivacySection }) {
    const controls = (section?.controls ?? []).filter(c => c?.title?.trim());
    if (!section || (controls.length === 0 && !section.summary && !section.openQuestions?.length)) return null;
    return (
        <div className="space-y-2">
            {section.summary && <p className="text-sm text-neutral-800">{section.summary}</p>}
            {controls.length > 0 && (
                <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-white">
                    {controls.map(control => (
                        <li key={control.id || control.title} className="p-3">
                            <p className="text-sm font-medium text-neutral-900">{control.title}</p>
                            {control.obligation && (
                                <p className="mt-0.5 text-xs text-neutral-600">
                                    <span className="font-semibold">Obligation: </span>{control.obligation}
                                </p>
                            )}
                            {control.implementation && (
                                <p className="mt-0.5 text-xs text-neutral-600">
                                    <span className="font-semibold">Implementation: </span>{control.implementation}
                                </p>
                            )}
                            <LinkRow label="Requirements" values={control.requirementIds} />
                            <LinkRow label="Tasks" values={control.taskIds} />
                            <LinkRow label="Verification" values={control.tests} />
                        </li>
                    ))}
                </ul>
            )}
            <OpenQuestions items={section.openQuestions} />
        </div>
    );
}

function MeasurementBody({ section }: { section?: PlanMeasurementSection }) {
    const metrics = (section?.metrics ?? []).filter(m => m?.metric?.trim());
    if (!section || (metrics.length === 0 && !section.summary && !section.openQuestions?.length)) return null;
    return (
        <div className="space-y-2">
            {section.summary && <p className="text-sm text-neutral-800">{section.summary}</p>}
            {metrics.length > 0 && (
                <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-white">
                    {metrics.map(metric => (
                        <li key={metric.id || metric.metric} className="p-3">
                            <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-neutral-900">
                                {metric.metric}
                                {metric.eventName && (
                                    <code className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] font-mono text-neutral-700">
                                        {metric.eventName}
                                    </code>
                                )}
                            </p>
                            {metric.trigger && (
                                <p className="mt-0.5 text-xs text-neutral-600">
                                    <span className="font-semibold">Trigger: </span>{metric.trigger}
                                </p>
                            )}
                            {metric.validation && (
                                <p className="mt-0.5 flex items-start gap-1 text-xs text-neutral-600">
                                    <ClipboardCheck size={12} className="mt-0.5 shrink-0 text-neutral-400" aria-hidden="true" />
                                    <span><span className="font-semibold">Validation: </span>{metric.validation}</span>
                                </p>
                            )}
                            <LinkRow label="Properties" values={metric.properties} />
                            <LinkRow label="Tasks" values={metric.taskIds} />
                        </li>
                    ))}
                </ul>
            )}
            <OpenQuestions items={section.openQuestions} />
        </div>
    );
}

function LinkRow({ label, values }: { label: string; values?: string[] }) {
    const items = (values ?? []).map(v => v?.trim()).filter(Boolean) as string[];
    if (items.length === 0) return null;
    return (
        <p className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-neutral-500">
            <span className="font-semibold uppercase tracking-wider">{label}:</span>
            {items.map((item, i) => (
                <span key={`${item}-${i}`} className="rounded border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 text-neutral-600">
                    {item}
                </span>
            ))}
        </p>
    );
}

function OpenQuestions({ items }: { items?: string[] }) {
    const questions = (items ?? []).map(q => q?.trim()).filter(Boolean) as string[];
    if (questions.length === 0) return null;
    return (
        <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">Open questions</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-neutral-700">
                {questions.map((q, i) => <li key={i}>{q}</li>)}
            </ul>
        </div>
    );
}
