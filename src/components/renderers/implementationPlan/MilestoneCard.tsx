import { useState } from 'react';
import {
    AppWindow,
    Calendar,
    CheckCircle2,
    ChevronDown,
    ChevronUp,
    Clock,
    Database,
    Flag,
    GitBranch,
    Link2,
    Puzzle,
    Square,
    Target,
    TerminalSquare,
} from 'lucide-react';
import type { ImplementationPlanMilestone, ImplementationPromptPack, ProjectTask } from '../../../types';
import { promptPackToClipboardText } from '../../../lib/services/implementationPlanAdapter';
import type { QualityGateRunStatus } from '../../../lib/services/implementationPlanInsights';
import { PromptPackCard } from './PromptPackCard';
import { CopyTextButton } from './CopyTextButton';
import { QualityGateCard } from './QualityGateCard';

const PRIORITY_STYLE: Record<NonNullable<ImplementationPlanMilestone['priority']>, string> = {
    critical: 'bg-red-50 text-red-700 border-red-200',
    high: 'bg-amber-50 text-amber-700 border-amber-200',
    medium: 'bg-sky-50 text-sky-700 border-sky-200',
    low: 'bg-neutral-100 text-neutral-600 border-neutral-200',
};

const ARTIFACT_KIND_ROWS: Array<{
    key: keyof NonNullable<ImplementationPlanMilestone['linkedArtifacts']>;
    icon: typeof Database;
    label: string;
    why: string;
}> = [
    { key: 'screens', icon: AppWindow, label: 'Screens', why: 'Defines the layouts this milestone builds' },
    { key: 'userFlows', icon: GitBranch, label: 'User Flows', why: 'Defines the journeys this milestone implements' },
    { key: 'dataModels', icon: Database, label: 'Data Models', why: 'Defines the entities this milestone persists' },
    { key: 'components', icon: Puzzle, label: 'Components', why: 'Reusable UI pieces this milestone assembles' },
    { key: 'apis', icon: TerminalSquare, label: 'APIs', why: 'Endpoints this milestone exposes or consumes' },
    { key: 'risks', icon: Flag, label: 'Risks', why: 'Watch-outs recorded for this milestone' },
];

interface Props {
    milestone: ImplementationPlanMilestone;
    index: number;
    /** Resolve a milestone id in `dependencies` to its display name. */
    milestoneNameById: Map<string, string>;
    defaultExpanded?: boolean;
    /**
     * Saved (converted) project tasks keyed by task id. Structured plans keep
     * the plan task ids on conversion, so a match means the row is tracked in
     * the Implementation-progress checklist; no match = still just planned.
     */
    savedTaskById?: Map<string, ProjectTask>;
    /** User-recorded gate outcomes; a gate absent here is Not run. */
    gateStatuses?: Record<string, QualityGateRunStatus>;
    onSetGateStatus?: (gateId: string, status: QualityGateRunStatus) => void;
    /** Prompt packs the user already copied (drives the Copied chip). */
    copiedPackIds?: ReadonlySet<string>;
    onPackCopied?: (packId: string) => void;
}

/**
 * Full milestone detail in a fixed section order — Outcome → linked
 * artifacts → build tasks → prompt packs → quality gates → validation
 * commands → "Done when" — so every milestone card reads the same way.
 * Header shows the compact roadmap facts (priority, effort, dependencies,
 * counts).
 */
export function MilestoneCard({
    milestone: m,
    index,
    milestoneNameById,
    defaultExpanded = false,
    savedTaskById,
    gateStatuses = {},
    onSetGateStatus,
    copiedPackIds,
    onPackCopied,
}: Props) {
    const [expanded, setExpanded] = useState(defaultExpanded);
    const packs: ImplementationPromptPack[] = m.promptPacks ?? [];
    const gates = m.qualityGates ?? [];
    const links = m.linkedArtifacts ?? {};
    const objective = m.objective ?? m.goal;
    const deps = (m.dependencies ?? []).map(d => milestoneNameById.get(d) ?? d);
    const counts = [
        `${m.tasks.length} task${m.tasks.length === 1 ? '' : 's'}`,
        `${packs.length} prompt${packs.length === 1 ? '' : 's'}`,
        `${gates.length} gate${gates.length === 1 ? '' : 's'}`,
    ];
    const allPromptsText = packs.map(promptPackToClipboardText).join('\n\n---\n\n');
    const trackedCount = savedTaskById
        ? m.tasks.filter(t => savedTaskById.has(t.id)).length
        : 0;
    const linkedRows = ARTIFACT_KIND_ROWS
        .map(row => ({ ...row, items: links[row.key] ?? [] }))
        .filter(row => row.items.length > 0);

    return (
        <article id={`impl-milestone-${m.id}`} className="bg-white rounded-xl border border-neutral-200 scroll-mt-24">
            {/* --- Roadmap header (always visible) --------------------------- */}
            <button
                type="button"
                onClick={() => setExpanded(prev => !prev)}
                aria-expanded={expanded}
                className="w-full text-left px-4 py-3.5 flex items-start gap-3"
            >
                <div className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-lg bg-indigo-600 text-white text-sm font-bold">
                    M{index + 1}
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-base font-bold text-neutral-900 leading-snug">{m.name}</h3>
                        {m.priority && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${PRIORITY_STYLE[m.priority]}`}>
                                {m.priority}
                            </span>
                        )}
                        {index === 0 && deps.length === 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded border font-medium bg-indigo-50 text-indigo-700 border-indigo-200">
                                Start here
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-[11px] text-neutral-500 mt-1">
                        {(m.estimatedEffort ?? m.timeframe) && (
                            <span className="flex items-center gap-1">
                                <Calendar size={11} />
                                {m.estimatedEffort ?? m.timeframe}
                            </span>
                        )}
                        {counts.map((c, i) => <span key={i}>{c}</span>)}
                    </div>
                    {deps.length > 0 && (
                        <p className="flex items-center gap-1 text-[11px] text-neutral-500 mt-1">
                            <GitBranch size={11} className="shrink-0" />
                            <span className="truncate">Depends on: {deps.join(', ')}</span>
                        </p>
                    )}
                </div>
                <span className="shrink-0 mt-1 text-neutral-400">
                    {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </span>
            </button>

            {/* --- Detail ----------------------------------------------------- */}
            {expanded && (
                <div className="px-4 pb-4 space-y-4 border-t border-neutral-100 pt-3">
                    {objective && (
                        <div>
                            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-1">
                                <Target size={11} /> Outcome
                            </p>
                            <p className="text-sm text-neutral-800">{objective}</p>
                        </div>
                    )}

                    {linkedRows.length > 0 && (
                        <div className="rounded-lg bg-neutral-50 border border-neutral-200 px-3 py-2.5">
                            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-1.5">
                                <Link2 size={11} /> Uses these Synapse artifacts
                            </p>
                            <div className="space-y-1.5">
                                {linkedRows.map(row => {
                                    const Icon = row.icon;
                                    return (
                                        <div key={row.key} className="flex items-start gap-1.5 min-w-0">
                                            <Icon size={12} className="mt-0.5 shrink-0 text-neutral-400" />
                                            <p className="text-[11px] text-neutral-600 leading-relaxed">
                                                <span className="font-semibold text-neutral-700">{row.label}</span>
                                                <span className="text-neutral-400"> — {row.why}: </span>
                                                {row.items.join(', ')}
                                            </p>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {m.tasks.length > 0 && (
                        <div>
                            <div className="flex items-center justify-between gap-2 flex-wrap mb-1.5">
                                <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                                    Build Tasks
                                </p>
                                <span className="text-[10px] text-neutral-400">
                                    {trackedCount > 0
                                        ? `${trackedCount} of ${m.tasks.length} tracked in Implementation progress`
                                        : 'Planned steps — use Convert to tasks to track progress'}
                                </span>
                            </div>
                            <ul className="space-y-1">
                                {m.tasks.map(t => {
                                    const saved = savedTaskById?.get(t.id);
                                    const status = saved?.status ?? t.status;
                                    const done = status === 'done';
                                    const inProgress = status === 'in_progress';
                                    const Icon = done ? CheckCircle2 : inProgress ? Clock : Square;
                                    const iconCls = done
                                        ? 'text-emerald-600'
                                        : inProgress ? 'text-amber-500' : 'text-neutral-300';
                                    return (
                                        <li key={t.id} className="flex items-start gap-2 text-sm text-neutral-800">
                                            <Icon size={15} className={`mt-0.5 shrink-0 ${iconCls}`} aria-hidden="true" />
                                            <span className="min-w-0">
                                                <span className={done ? 'text-neutral-400 line-through' : undefined}>{t.title}</span>
                                                {saved && (
                                                    <span className="ml-1.5 align-middle text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                                                        tracked
                                                    </span>
                                                )}
                                                {t.description && (
                                                    <span className="block text-xs text-neutral-500">{t.description}</span>
                                                )}
                                            </span>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    )}

                    {packs.length > 0 && (
                        <div>
                            <div className="flex items-center justify-between gap-2 mb-1.5">
                                <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                                    Prompt Packs
                                </p>
                                {packs.length > 1 && (
                                    <CopyTextButton text={allPromptsText} label="Copy milestone prompts" variant="secondary" />
                                )}
                            </div>
                            <div className="space-y-3">
                                {packs.map(pack => (
                                    <PromptPackCard
                                        key={pack.id}
                                        pack={pack}
                                        defaultCollapsed={packs.length > 1}
                                        prerequisites={deps}
                                        relatedGateTitles={gates.map(g => g.title)}
                                        copied={copiedPackIds?.has(pack.id) ?? false}
                                        onCopied={onPackCopied ? () => onPackCopied(pack.id) : undefined}
                                    />
                                ))}
                            </div>
                        </div>
                    )}

                    {gates.length > 0 && (
                        <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-1.5">
                                Quality Gates
                            </p>
                            <div className="space-y-2">
                                {gates.map(g => (
                                    <QualityGateCard
                                        key={g.id}
                                        gate={g}
                                        status={gateStatuses[g.id] ?? 'not_run'}
                                        onSetStatus={onSetGateStatus ? s => onSetGateStatus(g.id, s) : undefined}
                                        milestoneLabel={`M${index + 1} · ${m.name}`}
                                        verifyCommands={m.validationCommands ?? []}
                                        blocksLabel={g.required ? `M${index + 1}` : undefined}
                                    />
                                ))}
                            </div>
                        </div>
                    )}

                    {(m.validationCommands?.length ?? 0) > 0 && (
                        <div>
                            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-1.5">
                                <TerminalSquare size={11} /> Validation Commands
                            </p>
                            <div className="bg-neutral-900 text-neutral-100 rounded-lg px-3 py-2 text-xs font-mono space-y-0.5 overflow-x-auto">
                                {m.validationCommands!.map((c, i) => <p key={i}>$ {c}</p>)}
                            </div>
                        </div>
                    )}

                    {(m.definitionOfDone?.length ?? 0) > 0 && (
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 px-3 py-2.5">
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700 mb-1.5">
                                Done when
                            </p>
                            <ul className="space-y-1">
                                {m.definitionOfDone!.map((d, i) => (
                                    <li key={i} className="flex items-start gap-2 text-sm text-neutral-800">
                                        <Square size={13} className="mt-1 shrink-0 text-emerald-400" aria-hidden="true" />
                                        <span>{d}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}
        </article>
    );
}
