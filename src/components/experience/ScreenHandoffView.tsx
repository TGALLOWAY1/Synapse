// Phase 5A: the Screen Detail "Handoff" tab. Turns an accepted screen into a
// developer-ready build contract — route, components, state, events, data
// dependencies, mockups to reference, acceptance criteria, a QA checklist, a
// build-task checklist, and trace/confidence notes — plus a copy-to-markdown
// action. Purely presentational over the derived ScreenImplementationHandoff
// (src/lib/screenImplementationHandoff.ts). Everything is an estimate; missing
// data reads "Not specified", never fabricated. Never blocks use.

import { useCallback, useState } from 'react';
import {
    AlertOctagon, CheckCircle2, ClipboardCopy, ClipboardList, Copy, Route as RouteIcon,
    ShieldQuestion,
} from 'lucide-react';
import type {
    HandoffConfidence, HandoffQaCategory, HandoffTaskPriority,
    ScreenImplementationHandoff, ScreenImplementationReadiness,
} from '../../lib/screenImplementationHandoff';
import { IMPLEMENTATION_READINESS_LABELS, renderHandoffMarkdown } from '../../lib/screenImplementationHandoff';
import { copyToClipboard } from '../../lib/utils/copyToClipboard';

interface Props {
    handoff: ScreenImplementationHandoff;
}

const STATUS_META: Record<ScreenImplementationReadiness, {
    tone: 'good' | 'warn' | 'block'; ring: string; text: string; Icon: typeof CheckCircle2;
}> = {
    ready: { tone: 'good', ring: 'border-emerald-200 bg-emerald-50/60', text: 'text-emerald-800', Icon: CheckCircle2 },
    review_recommended: { tone: 'warn', ring: 'border-amber-200 bg-amber-50/60', text: 'text-amber-800', Icon: ShieldQuestion },
    blocked: { tone: 'block', ring: 'border-red-200 bg-red-50/60', text: 'text-red-800', Icon: AlertOctagon },
};

const CONFIDENCE_LABELS: Record<HandoffConfidence, string> = {
    explicit: 'From generated spec',
    derived: 'Derived — confirm before building',
    missing: 'Not specified',
};

const QA_CATEGORY_LABELS: Record<HandoffQaCategory, string> = {
    rendering: 'Rendering',
    interaction: 'Interaction',
    state: 'State',
    data: 'Data',
    accessibility: 'Accessibility',
    responsive: 'Responsive',
    error_handling: 'Error handling',
    acceptance: 'Acceptance',
};

const PRIORITY_STYLES: Record<HandoffTaskPriority, string> = {
    must: 'text-red-700 bg-red-50 ring-red-200',
    should: 'text-amber-700 bg-amber-50 ring-amber-200',
    could: 'text-neutral-600 bg-neutral-50 ring-neutral-200',
};

export function ScreenHandoffView({ handoff }: Props) {
    const meta = STATUS_META[handoff.readiness.status];
    const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
    const [showMarkdown, setShowMarkdown] = useState(false);

    const handleCopy = useCallback(async () => {
        const md = renderHandoffMarkdown(handoff);
        const ok = await copyToClipboard(md);
        if (ok) {
            setCopyState('copied');
            setTimeout(() => setCopyState('idle'), 2000);
        } else {
            // Clipboard unavailable → reveal the markdown for manual copy.
            setCopyState('failed');
            setShowMarkdown(true);
        }
    }, [handoff]);

    const markdown = renderHandoffMarkdown(handoff);

    return (
        <div className="space-y-4">
            {/* Header + status + copy */}
            <div className={`rounded-xl border p-4 ${meta.ring}`}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex items-start gap-2 min-w-0">
                        <meta.Icon size={18} className={`${meta.text} mt-0.5 shrink-0`} aria-hidden />
                        <div className="min-w-0">
                            <h3 className="text-sm font-semibold text-neutral-900">Implementation handoff</h3>
                            <p className={`text-xs font-medium ${meta.text}`}>
                                {IMPLEMENTATION_READINESS_LABELS[handoff.readiness.status]}
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={handleCopy}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-white ring-1 ring-neutral-200 hover:ring-indigo-300 hover:text-indigo-700 text-neutral-700 rounded-md transition shrink-0"
                    >
                        {copyState === 'copied' ? <ClipboardCopy size={13} /> : <Copy size={13} />}
                        {copyState === 'copied' ? 'Copied' : 'Copy handoff'}
                    </button>
                </div>
                {handoff.readiness.reasons.length > 0 && (
                    <ul className="mt-2 space-y-0.5 text-[11px] text-neutral-600">
                        {handoff.readiness.reasons.map((r, i) => (
                            <li key={i} className="flex gap-1.5">
                                <span className="text-neutral-300 select-none">·</span>
                                <span>{r}</span>
                            </li>
                        ))}
                    </ul>
                )}
                {copyState === 'failed' && (
                    <p className="mt-2 text-[11px] text-amber-700">
                        Clipboard unavailable — copy the markdown below manually.
                    </p>
                )}
            </div>

            {showMarkdown && (
                <div className="rounded-xl border border-neutral-200 bg-white p-3">
                    <label className="text-[10px] uppercase tracking-wide text-neutral-400">Handoff markdown</label>
                    <textarea
                        readOnly
                        value={markdown}
                        onFocus={e => e.currentTarget.select()}
                        rows={12}
                        className="mt-1 w-full text-[11px] font-mono border border-neutral-200 rounded-md p-2 bg-neutral-50"
                    />
                </div>
            )}

            {/* Route */}
            <Section title="Route" icon={<RouteIcon size={13} className="text-neutral-400" />}>
                {handoff.route.path ? (
                    <div className="flex items-center gap-2 flex-wrap">
                        <code className="text-xs bg-neutral-100 text-neutral-800 px-1.5 py-0.5 rounded">{handoff.route.path}</code>
                        <ConfidenceTag confidence={handoff.route.confidence} />
                    </div>
                ) : (
                    <p className="text-xs text-neutral-400">Not specified</p>
                )}
                {handoff.route.notes.map((n, i) => (
                    <p key={i} className="text-[11px] text-neutral-400 mt-1">{n}</p>
                ))}
            </Section>

            {/* Components */}
            <Section title="Components">
                {handoff.components.length > 0 ? (
                    <ul className="flex flex-wrap gap-1.5">
                        {handoff.components.map(c => (
                            <li
                                key={c.name}
                                className="text-[11px] text-neutral-700 bg-neutral-100 px-2 py-0.5 rounded-full"
                                title={c.purpose}
                            >
                                {c.name}
                                {!c.required && <span className="text-neutral-400"> · optional</span>}
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-xs text-neutral-400">Not specified</p>
                )}
            </Section>

            {/* State + events */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Section title="State">
                    {handoff.state.length > 0 ? (
                        <ul className="space-y-1 text-xs text-neutral-700">
                            {handoff.state.map(s => (
                                <li key={s.name}>
                                    <span className="font-mono text-[11px] text-neutral-800">{s.name}</span>
                                    {s.purpose && <span className="text-neutral-500"> — {s.purpose}</span>}
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-xs text-neutral-400">Not specified</p>
                    )}
                </Section>
                <Section title="Events">
                    {handoff.events.length > 0 ? (
                        <ul className="space-y-1 text-xs text-neutral-700">
                            {handoff.events.map(e => (
                                <li key={e.name}>
                                    <span className="font-mono text-[11px] text-neutral-800">{e.name}</span>
                                    {e.expectedOutcome && <span className="text-neutral-500"> → {e.expectedOutcome}</span>}
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-xs text-neutral-400">Not specified</p>
                    )}
                </Section>
            </div>

            {/* Data dependencies */}
            <Section title="Data dependencies">
                {handoff.dataDependencies.length > 0 ? (
                    <ul className="space-y-1 text-xs text-neutral-700">
                        {handoff.dataDependencies.map((d, i) => (
                            <li key={`${d.label}-${i}`} className="flex items-center gap-2 flex-wrap">
                                <span className="text-neutral-800">{d.label}</span>
                                {d.direction && (
                                    <span className="text-[10px] text-neutral-500 bg-neutral-100 px-1.5 py-0.5 rounded-full">
                                        {d.direction.replace('_', '/')}
                                    </span>
                                )}
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-xs text-amber-700">
                        No linked data model entities found. Review recommended before implementation.
                    </p>
                )}
            </Section>

            {/* Mockups */}
            <Section title="Mockups to reference">
                {handoff.mockupReferences.length > 0 ? (
                    <ul className="space-y-1 text-xs text-neutral-700">
                        {handoff.mockupReferences.map(m => (
                            <li key={m.variantId} className="flex items-center gap-2 flex-wrap">
                                <span className="text-neutral-800">{m.label}</span>
                                {m.freshness && (
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                                        m.freshness === 'current'
                                            ? 'text-emerald-700 bg-emerald-50'
                                            : m.freshness === 'unknown'
                                                ? 'text-neutral-500 bg-neutral-100'
                                                : 'text-amber-700 bg-amber-50'
                                    }`}>
                                        {m.freshness === 'possibly_stale' ? 'possibly stale' : m.freshness}
                                    </span>
                                )}
                                {m.coverage && m.coverage !== 'unknown' && (
                                    <span className="text-[10px] text-neutral-500 bg-neutral-100 px-1.5 py-0.5 rounded-full">
                                        coverage: {m.coverage.replace('_', ' ')}
                                    </span>
                                )}
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-xs text-neutral-400">No generated mockups to reference yet.</p>
                )}
            </Section>

            {/* Acceptance criteria */}
            <Section title="Acceptance criteria">
                {handoff.acceptanceCriteria.length > 0 ? (
                    <ul className="space-y-1 text-xs text-neutral-700 list-disc list-inside">
                        {handoff.acceptanceCriteria.map((c, i) => <li key={i}>{c}</li>)}
                    </ul>
                ) : (
                    <p className="text-xs text-neutral-400">Not specified</p>
                )}
            </Section>

            {/* QA checklist */}
            <Section title="QA checklist" icon={<ClipboardList size={13} className="text-neutral-400" />}>
                {handoff.qaChecklist.length > 0 ? (
                    <ul className="space-y-1.5">
                        {handoff.qaChecklist.map(q => (
                            <li key={q.id} className="flex items-start gap-2 text-xs text-neutral-700">
                                <span className="mt-0.5 h-3.5 w-3.5 rounded border border-neutral-300 shrink-0" aria-hidden />
                                <span className="min-w-0">
                                    <span className="text-[9px] uppercase tracking-wide text-neutral-400 mr-1.5">
                                        {QA_CATEGORY_LABELS[q.category]}
                                    </span>
                                    {q.label}
                                </span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-xs text-neutral-400">Not specified</p>
                )}
            </Section>

            {/* Build tasks */}
            <Section title="Build task checklist">
                {handoff.buildTasks.length > 0 ? (
                    <ol className="space-y-2">
                        {handoff.buildTasks.map((t, i) => (
                            <li key={t.id} className="flex items-start gap-2 text-xs text-neutral-700">
                                <span className="text-neutral-400 tabular-nums shrink-0">{i + 1}.</span>
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-medium text-neutral-800">{t.title}</span>
                                        <span className={`text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-full ring-1 ${PRIORITY_STYLES[t.priority]}`}>
                                            {t.priority}
                                        </span>
                                    </div>
                                    <p className="text-[11px] text-neutral-500 mt-0.5">{t.description}</p>
                                    <p className="text-[10px] text-neutral-400 mt-0.5">Why: {t.source}</p>
                                </div>
                            </li>
                        ))}
                    </ol>
                ) : (
                    <p className="text-xs text-neutral-400">Not specified</p>
                )}
            </Section>

            {/* Trace / confidence */}
            <Section title="Trace & confidence">
                <div className="space-y-1 text-xs text-neutral-600">
                    <p>
                        <span className="text-neutral-400">PRD features: </span>
                        {handoff.trace.prdFeatures.length > 0 ? handoff.trace.prdFeatures.join(', ') : 'None linked'}
                    </p>
                    <p>
                        <span className="text-neutral-400">User flows: </span>
                        {handoff.trace.userFlows.length > 0 ? handoff.trace.userFlows.join(', ') : 'None'}
                    </p>
                    {handoff.trace.warnings.map((w, i) => (
                        <p key={i} className="text-amber-700">{w}</p>
                    ))}
                    <p className="text-[11px] text-neutral-400">
                        Every field here is estimated from the generated spec — confirm before building.
                    </p>
                </div>
            </Section>
        </div>
    );
}

function ConfidenceTag({ confidence }: { confidence: HandoffConfidence }) {
    const tone = confidence === 'explicit'
        ? 'text-emerald-700 bg-emerald-50'
        : confidence === 'derived'
            ? 'text-amber-700 bg-amber-50'
            : 'text-neutral-500 bg-neutral-100';
    return (
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${tone}`}>
            {CONFIDENCE_LABELS[confidence]}
        </span>
    );
}

function Section({ title, icon, children }: {
    title: string; icon?: React.ReactNode; children: React.ReactNode;
}) {
    return (
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-1.5 mb-2">
                {icon}
                <h4 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{title}</h4>
            </div>
            {children}
        </div>
    );
}
