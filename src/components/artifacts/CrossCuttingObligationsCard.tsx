import type { ReactNode } from 'react';
import { AlertTriangle, ClipboardCheck, ListChecks, ShieldCheck } from 'lucide-react';
import type { PlanMeasurementSection, PlanSecurityPrivacySection } from '../../types';
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
}

/**
 * The Implementation Plan's two CONDITIONAL cross-cutting sections
 * (plan §W5), rendered in exactly three states per section:
 *
 *  1. **Not required** — renders nothing at all. A project with no safety
 *     context, no privacy signals, and no declared success metrics never sees
 *     these sections.
 *  2. **Required and satisfied** — the controls / metric mappings with their
 *     links (requirements, tasks, verification / event contract).
 *  3. **Required and not satisfied** — an explicit UNRESOLVED OBLIGATION: what
 *     triggered the requirement and the named gaps. Never an empty section and
 *     never silently omitted. Whatever the plan *does* carry still renders
 *     underneath, so a partial section shows both what exists and what does not.
 *
 * Advisory only at this layer: nothing here blocks generation or rendering.
 * The build-packet readiness evaluator (plan §W6) is what blocks, and it reads
 * the same report from `deriveCrossCuttingObligations`.
 */
export function CrossCuttingObligationsCard({ report, securityPrivacy, measurement }: Props) {
    const showSecurity = shouldRender(report.securityPrivacy);
    const showMeasurement = shouldRender(report.measurement);
    if (!showSecurity && !showMeasurement) return null;

    return (
        <div className="space-y-3 not-prose">
            {showSecurity && (
                <ObligationSection status={report.securityPrivacy} icon={<ShieldCheck size={16} aria-hidden="true" />}>
                    <SecurityPrivacyBody section={securityPrivacy} />
                </ObligationSection>
            )}
            {showMeasurement && (
                <ObligationSection status={report.measurement} icon={<ListChecks size={16} aria-hidden="true" />}>
                    <MeasurementBody section={measurement} />
                </ObligationSection>
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

function ObligationSection({
    status,
    icon,
    children,
}: {
    status: CrossCuttingObligationStatus;
    icon: ReactNode;
    children: ReactNode;
}) {
    const unresolved = status.required && !status.satisfied;
    const tone = unresolved
        ? { border: 'border-amber-200', bg: 'bg-amber-50', title: 'text-amber-950', body: 'text-amber-900', icon: 'text-amber-700' }
        : { border: 'border-neutral-200', bg: 'bg-white', title: 'text-neutral-900', body: 'text-neutral-700', icon: 'text-emerald-600' };

    return (
        <section
            aria-label={status.label}
            className={`rounded-xl border p-4 ${tone.border} ${tone.bg}`}
        >
            <div className="flex items-start gap-2.5">
                <span className={`mt-0.5 shrink-0 ${tone.icon}`}>
                    {unresolved ? <AlertTriangle size={16} aria-hidden="true" /> : icon}
                </span>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <h3 className={`text-sm font-semibold ${tone.title}`}>{status.label}</h3>
                        {unresolved ? (
                            <span className="rounded-full border border-amber-300 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-800">
                                Unresolved obligation
                            </span>
                        ) : status.required ? (
                            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                                Covered
                            </span>
                        ) : (
                            <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                                Not required
                            </span>
                        )}
                    </div>
                    <p className={`mt-1 text-xs ${tone.body}`}>{status.reason}</p>

                    {/* Why it is required — the exact input signals, quoted. */}
                    {status.triggers.length > 0 && (
                        <details className="mt-2">
                            <summary className={`cursor-pointer text-xs font-medium ${tone.body}`}>
                                {status.triggers.length === 1
                                    ? 'What triggered this obligation'
                                    : `What triggered this obligation (${status.triggers.length})`}
                            </summary>
                            <ul className={`mt-1.5 list-disc space-y-0.5 pl-4 text-xs ${tone.body}`}>
                                {status.triggers.map((trigger, i) => (
                                    <li key={`${trigger.source}-${i}`}>{trigger.detail}</li>
                                ))}
                            </ul>
                        </details>
                    )}

                    {/* State 3: the named gaps. */}
                    {unresolved && (
                        <div className="mt-2.5 rounded-lg border border-amber-200 bg-white/70 p-3">
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-800">
                                {status.absent ? 'Missing from the plan' : `Gaps (${status.missing.length})`}
                            </p>
                            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-amber-900">
                                {status.missing.map((item, i) => <li key={i}>{item}</li>)}
                            </ul>
                            <p className="mt-2 text-[11px] text-amber-800">
                                Regenerate the Implementation Plan (or edit it) so every obligation above is
                                assigned to a task. Synapse does not fill these in for you.
                            </p>
                        </div>
                    )}

                    {/* State 2 (and any partial content in state 3). */}
                    <div className="mt-2.5">{children}</div>

                    {status.advisories.length > 0 && (
                        <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[11px] text-neutral-500">
                            {status.advisories.map((item, i) => <li key={i}>{item}</li>)}
                        </ul>
                    )}
                </div>
            </div>
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
