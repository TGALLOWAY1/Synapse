import { useMemo, useState } from 'react';
import {
    AlertTriangle,
    ArrowRight,
    CheckCircle2,
    ClipboardList,
    Flag,
    Layers,
    ShieldCheck,
    Sparkles,
    XCircle,
} from 'lucide-react';
import type {
    ConsolidatedImplementationPlan,
    ImplementationQualityGate,
    QualityGateCategory,
} from '../../../types';
import {
    collectAllPromptPacks,
    consolidatedPlanToMarkdown,
    promptPackToClipboardText,
} from '../../../lib/services/implementationPlanAdapter';
import { CopyTextButton } from './CopyTextButton';
import { MilestoneCard } from './MilestoneCard';
import { PromptPackCard } from './PromptPackCard';
import { QualityGateRow } from './QualityGateRow';
import { GATE_CATEGORY_LABELS, GATE_CATEGORY_ORDER } from './gateCategories';

type TabId = 'overview' | 'milestones' | 'prompt_packs' | 'quality_gates' | 'traceability';

const READINESS_STYLE = {
    ready: { icon: CheckCircle2, cls: 'bg-emerald-50 border-emerald-200 text-emerald-800', label: 'Ready to build' },
    needs_review: { icon: AlertTriangle, cls: 'bg-amber-50 border-amber-200 text-amber-800', label: 'Needs review' },
    blocked: { icon: XCircle, cls: 'bg-red-50 border-red-200 text-red-800', label: 'Blocked' },
} as const;

interface Props {
    plan: ConsolidatedImplementationPlan;
}

/**
 * The consolidated Implementation Plan view: one place that connects
 * milestones, tasks, prompt packs, linked artifacts, quality gates,
 * validation commands, and definitions of done.
 *
 * Tabs scroll horizontally on mobile; the traceability matrix renders as a
 * table on desktop and stacked cards on small screens.
 */
export function ConsolidatedPlanView({ plan }: Props) {
    const [tab, setTab] = useState<TabId>('overview');

    const milestoneNameById = useMemo(() => {
        const map = new Map<string, string>();
        plan.milestones.forEach(m => map.set(m.id, m.name));
        return map;
    }, [plan]);

    const allPacks = useMemo(() => collectAllPromptPacks(plan), [plan]);
    const allGates = useMemo(() => {
        const rows: Array<{ gate: ImplementationQualityGate; milestoneName?: string }> = [];
        plan.globalQualityGates.forEach(gate => rows.push({ gate }));
        plan.milestones.forEach(m => (m.qualityGates ?? []).forEach(gate => rows.push({ gate, milestoneName: m.name })));
        return rows;
    }, [plan]);

    const tabs: Array<{ id: TabId; label: string; count?: number }> = [
        { id: 'overview', label: 'Overview' },
        { id: 'milestones', label: 'Milestones', count: plan.milestones.length },
        { id: 'prompt_packs', label: 'Prompt Packs', count: allPacks.length },
        { id: 'quality_gates', label: 'Quality Gates', count: allGates.length },
        { id: 'traceability', label: 'Traceability' },
    ];

    return (
        <div className="space-y-4 not-prose">
            {/* --- Tab nav (scrolls horizontally on mobile) ------------------ */}
            <nav aria-label="Implementation plan sections" className="border-b border-neutral-200 -mx-1 px-1 overflow-x-auto">
                <div className="flex gap-1 whitespace-nowrap">
                    {tabs.map(t => {
                        const active = tab === t.id;
                        return (
                            <button
                                key={t.id}
                                type="button"
                                onClick={() => setTab(t.id)}
                                className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors min-h-[40px] ${
                                    active
                                        ? 'border-indigo-600 text-indigo-700'
                                        : 'border-transparent text-neutral-600 hover:text-neutral-900'
                                }`}
                            >
                                {t.label}
                                {typeof t.count === 'number' && t.count > 0 && (
                                    <span className="ml-1.5 text-[10px] text-neutral-500">({t.count})</span>
                                )}
                            </button>
                        );
                    })}
                </div>
            </nav>

            {tab === 'overview' && <OverviewTab plan={plan} onOpenMilestones={() => setTab('milestones')} />}

            {tab === 'milestones' && (
                <div className="space-y-3">
                    {plan.milestones.length === 0 ? (
                        <EmptyNote text="No milestones yet. Generate the Implementation Plan to get a milestone roadmap." />
                    ) : (
                        plan.milestones.map((m, i) => (
                            <MilestoneCard
                                key={m.id}
                                milestone={m}
                                index={i}
                                milestoneNameById={milestoneNameById}
                                defaultExpanded={i === 0}
                            />
                        ))
                    )}
                </div>
            )}

            {tab === 'prompt_packs' && (
                <div className="space-y-4">
                    {allPacks.length === 0 ? (
                        <EmptyNote text="No prompt packs yet. Regenerate the Implementation Plan to get copy-ready coding-agent prompts per milestone." />
                    ) : (
                        <>
                            <div className="flex items-center justify-end">
                                <CopyTextButton
                                    text={allPacks.map(promptPackToClipboardText).join('\n\n---\n\n')}
                                    label="Copy all prompt packs"
                                    variant="secondary"
                                />
                            </div>
                            {plan.milestones.map((m, i) =>
                                (m.promptPacks?.length ?? 0) > 0 ? (
                                    <section key={m.id}>
                                        <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-2">
                                            Milestone {i + 1} · {m.name}
                                        </p>
                                        <div className="space-y-3">
                                            {m.promptPacks!.map(pack => (
                                                <PromptPackCard key={pack.id} pack={pack} defaultCollapsed />
                                            ))}
                                        </div>
                                    </section>
                                ) : null,
                            )}
                            {plan.unassignedPromptPacks.length > 0 && (
                                <section>
                                    <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-700 mb-2">
                                        Unassigned Prompt Packs
                                    </p>
                                    <p className="text-xs text-neutral-500 mb-2">
                                        These prompts couldn't be confidently matched to a milestone. They're
                                        still ready to copy — run them where they fit in your build order.
                                    </p>
                                    <div className="space-y-3">
                                        {plan.unassignedPromptPacks.map(pack => (
                                            <PromptPackCard key={pack.id} pack={pack} defaultCollapsed />
                                        ))}
                                    </div>
                                </section>
                            )}
                        </>
                    )}
                </div>
            )}

            {tab === 'quality_gates' && <QualityGatesTab plan={plan} />}

            {tab === 'traceability' && <TraceabilityTab plan={plan} />}

            {/* --- Export / copy actions ------------------------------------- */}
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5">
                <ClipboardList size={15} className="text-neutral-400 shrink-0" aria-hidden="true" />
                <p className="text-xs text-neutral-500 mr-auto">Take this plan to your coding agent:</p>
                <CopyTextButton text={consolidatedPlanToMarkdown(plan)} label="Copy plan as markdown" variant="secondary" />
                {allPacks.length > 0 && (
                    <CopyTextButton
                        text={allPacks.map(promptPackToClipboardText).join('\n\n---\n\n')}
                        label="Copy all prompt packs"
                        variant="secondary"
                    />
                )}
            </div>
        </div>
    );
}

function EmptyNote({ text }: { text: string }) {
    return (
        <div className="bg-white rounded-xl border border-neutral-200 p-5">
            <p className="text-sm text-neutral-500 italic">{text}</p>
        </div>
    );
}

// --- Overview -------------------------------------------------------------

function OverviewTab({ plan, onOpenMilestones }: { plan: ConsolidatedImplementationPlan; onOpenMilestones: () => void }) {
    const readiness = READINESS_STYLE[plan.readiness.status];
    const ReadinessIcon = readiness.icon;
    const packCount = collectAllPromptPacks(plan).length;

    return (
        <div className="space-y-4">
            {/* Readiness */}
            <div className={`rounded-xl border px-4 py-3 ${readiness.cls}`}>
                <p className="flex items-center gap-2 text-sm font-semibold">
                    <ReadinessIcon size={15} /> {readiness.label}
                </p>
                {plan.readiness.recommendedNextStep && (
                    <p className="flex items-start gap-1.5 text-xs mt-1.5">
                        <ArrowRight size={12} className="mt-0.5 shrink-0" />
                        {plan.readiness.recommendedNextStep}
                    </p>
                )}
                {plan.readiness.missingInputs.length > 0 && (
                    <p className="text-xs mt-1.5">
                        <span className="font-semibold">Missing inputs:</span>{' '}
                        {plan.readiness.missingInputs.join(', ')}
                    </p>
                )}
                {plan.readiness.warnings.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5 text-xs">
                        {plan.readiness.warnings.map((w, i) => (
                            <li key={i} className="flex items-start gap-1.5">
                                <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                                {w}
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {/* Build strategy + stack */}
            <div className="bg-white rounded-xl border border-neutral-200 p-4 space-y-3">
                {plan.summary.buildStrategy && (
                    <div>
                        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-1">
                            <Sparkles size={11} /> Build Strategy
                        </p>
                        <p className="text-sm text-neutral-800">{plan.summary.buildStrategy}</p>
                    </div>
                )}
                {(plan.summary.stackSummary?.length ?? 0) > 0 && (
                    <div>
                        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-1.5">
                            <Layers size={11} /> Stack
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                            {plan.summary.stackSummary!.map((s, i) => (
                                <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-700 border border-neutral-200">
                                    {s}
                                </span>
                            ))}
                        </div>
                    </div>
                )}
                {(plan.summary.criticalPath?.length ?? 0) > 0 && (
                    <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-1">Critical Path</p>
                        <p className="text-sm text-neutral-800">
                            {plan.summary.criticalPath!.join(' → ')}
                        </p>
                    </div>
                )}
                {(plan.summary.estimatedEffort || plan.summary.teamAssumption) && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-neutral-700">
                        {plan.summary.estimatedEffort && (
                            <div><span className="font-semibold text-neutral-600">Estimated Effort: </span>{plan.summary.estimatedEffort}</div>
                        )}
                        {plan.summary.teamAssumption && (
                            <div><span className="font-semibold text-neutral-600">Team: </span>{plan.summary.teamAssumption}</div>
                        )}
                    </div>
                )}
            </div>

            {/* Roadmap-at-a-glance */}
            {plan.milestones.length > 0 && (
                <div className="bg-white rounded-xl border border-neutral-200 p-4">
                    <div className="flex items-center justify-between gap-2 mb-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                            Roadmap · {plan.milestones.length} milestones · {packCount} prompt packs
                        </p>
                        <button
                            type="button"
                            onClick={onOpenMilestones}
                            className="text-xs font-medium text-indigo-600 hover:text-indigo-800 transition"
                        >
                            Open milestones →
                        </button>
                    </div>
                    <ol className="space-y-1.5">
                        {plan.milestones.map((m, i) => (
                            <li key={m.id} className="flex items-center gap-2 text-sm text-neutral-800 min-w-0">
                                <span className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-md bg-indigo-50 text-indigo-700 text-[11px] font-bold border border-indigo-100">
                                    {i + 1}
                                </span>
                                <span className="truncate">{m.name}</span>
                                <span className="ml-auto shrink-0 text-[11px] text-neutral-500">
                                    {(m.promptPacks?.length ?? 0)} packs · {m.tasks.length} tasks
                                </span>
                            </li>
                        ))}
                    </ol>
                </div>
            )}

            {/* Architecture + risks (legacy content preservation) */}
            {plan.architecture.length > 0 && (
                <div className="bg-white rounded-xl border border-neutral-200 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-1.5">Architecture Decisions</p>
                    <ul className="space-y-1 text-sm text-neutral-800">
                        {plan.architecture.map((a, i) => (
                            <li key={i} className="flex items-start gap-2">
                                <Layers size={13} className="mt-0.5 shrink-0 text-neutral-400" />
                                <span>{a}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {plan.risks.length > 0 && (
                <div className="bg-white rounded-xl border border-neutral-200 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-1.5">Risks</p>
                    <ul className="space-y-1.5 text-sm text-neutral-800">
                        {plan.risks.map((r, i) => (
                            <li key={i} className="flex items-start gap-2">
                                <Flag size={13} className="mt-0.5 shrink-0 text-red-500" />
                                <span>
                                    {r.description}
                                    {r.mitigation && (
                                        <span className="block text-xs text-neutral-500">Mitigation: {r.mitigation}</span>
                                    )}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Unrecognized legacy appendix prose — preserved so nothing is
                lost when an old markdown plan renders through this view. */}
            {plan.appendixNotes && (
                <div className="bg-neutral-50 rounded-xl border border-neutral-200 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-1.5">Notes</p>
                    <p className="text-sm text-neutral-700 whitespace-pre-wrap">{plan.appendixNotes}</p>
                </div>
            )}
        </div>
    );
}

// --- Quality gates ----------------------------------------------------------

function QualityGatesTab({ plan }: { plan: ConsolidatedImplementationPlan }) {
    const byCategory = useMemo(() => {
        const map = new Map<QualityGateCategory, Array<{ gate: ImplementationQualityGate; milestoneName?: string }>>();
        const push = (gate: ImplementationQualityGate, milestoneName?: string) => {
            const list = map.get(gate.category) ?? [];
            list.push({ gate, milestoneName });
            map.set(gate.category, list);
        };
        plan.globalQualityGates.forEach(g => push(g));
        plan.milestones.forEach(m => (m.qualityGates ?? []).forEach(g => push(g, m.name)));
        return map;
    }, [plan]);

    if (byCategory.size === 0) {
        return <EmptyNote text="No quality gates yet. Regenerate the Implementation Plan to get per-milestone quality gates." />;
    }

    return (
        <div className="space-y-4">
            {GATE_CATEGORY_ORDER.filter(c => byCategory.has(c)).map(category => (
                <div key={category} className="bg-white rounded-xl border border-neutral-200 p-4">
                    <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-2">
                        <ShieldCheck size={11} /> {GATE_CATEGORY_LABELS[category]}
                    </p>
                    <ul className="space-y-2">
                        {byCategory.get(category)!.map(({ gate, milestoneName }, i) => (
                            <li key={`${gate.id}-${i}`}>
                                <ul><QualityGateRow gate={gate} /></ul>
                                <p className="text-[10px] text-neutral-400 ml-6 mt-0.5">
                                    {milestoneName ? `Milestone: ${milestoneName}` : 'Global gate'}
                                </p>
                            </li>
                        ))}
                    </ul>
                </div>
            ))}
        </div>
    );
}

// --- Traceability -------------------------------------------------------------

function TraceabilityTab({ plan }: { plan: ConsolidatedImplementationPlan }) {
    const packTitleById = useMemo(() => {
        const map = new Map<string, string>();
        collectAllPromptPacks(plan).forEach(p => map.set(p.id, p.title));
        return map;
    }, [plan]);
    const gateTitleById = useMemo(() => {
        const map = new Map<string, string>();
        plan.globalQualityGates.forEach(g => map.set(g.id, g.title));
        plan.milestones.forEach(m => (m.qualityGates ?? []).forEach(g => map.set(g.id, g.title)));
        return map;
    }, [plan]);

    const rows = plan.traceability;
    const hasAnyLinks = rows.some(r =>
        r.screens.length || r.dataModels.length || r.components.length || r.promptPackIds.length || r.qualityGateIds.length);

    if (rows.length === 0 || !hasAnyLinks) {
        return <EmptyNote text="No traceability links yet. Regenerate the Implementation Plan so milestones reference screens, data models, and components from your other assets." />;
    }

    const cell = (items: string[]) =>
        items.length ? items.join(', ') : <span className="text-neutral-300">—</span>;

    return (
        <div>
            {/* Desktop: matrix table */}
            <div className="hidden md:block bg-white rounded-xl border border-neutral-200 overflow-x-auto">
                <table className="w-full text-left text-xs">
                    <thead>
                        <tr className="border-b border-neutral-200 text-[10px] uppercase tracking-wider text-neutral-500">
                            <th className="px-3 py-2 font-semibold">Milestone</th>
                            <th className="px-3 py-2 font-semibold">Screens</th>
                            <th className="px-3 py-2 font-semibold">Data Models</th>
                            <th className="px-3 py-2 font-semibold">Components</th>
                            <th className="px-3 py-2 font-semibold">Prompt Packs</th>
                            <th className="px-3 py-2 font-semibold">Quality Gates</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(row => (
                            <tr key={row.milestoneId} className="border-b border-neutral-100 last:border-b-0 align-top">
                                <td className="px-3 py-2.5 font-medium text-neutral-900">{row.milestoneTitle}</td>
                                <td className="px-3 py-2.5 text-neutral-700">{cell(row.screens)}</td>
                                <td className="px-3 py-2.5 text-neutral-700">{cell(row.dataModels)}</td>
                                <td className="px-3 py-2.5 text-neutral-700">{cell(row.components)}</td>
                                <td className="px-3 py-2.5 text-neutral-700">{cell(row.promptPackIds.map(id => packTitleById.get(id) ?? id))}</td>
                                <td className="px-3 py-2.5 text-neutral-700">{cell(row.qualityGateIds.map(id => gateTitleById.get(id) ?? id))}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Mobile: stacked cards */}
            <div className="md:hidden space-y-3">
                {rows.map(row => (
                    <div key={row.milestoneId} className="bg-white rounded-xl border border-neutral-200 p-4 space-y-1.5">
                        <p className="text-sm font-bold text-neutral-900">{row.milestoneTitle}</p>
                        {([
                            ['Screens', row.screens],
                            ['Data Models', row.dataModels],
                            ['Components', row.components],
                            ['Prompt Packs', row.promptPackIds.map(id => packTitleById.get(id) ?? id)],
                            ['Quality Gates', row.qualityGateIds.map(id => gateTitleById.get(id) ?? id)],
                        ] as Array<[string, string[]]>).map(([label, items]) =>
                            items.length > 0 ? (
                                <p key={label} className="text-xs text-neutral-700">
                                    <span className="font-semibold text-neutral-500">{label}: </span>
                                    {items.join(', ')}
                                </p>
                            ) : null,
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
