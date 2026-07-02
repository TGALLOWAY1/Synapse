import { useState } from 'react';
import {
    AppWindow,
    Calendar,
    ChevronDown,
    ChevronUp,
    Database,
    Flag,
    GitBranch,
    Link2,
    Puzzle,
    ShieldCheck,
    Target,
    TerminalSquare,
} from 'lucide-react';
import type { ImplementationPlanMilestone, ImplementationPromptPack } from '../../../types';
import { promptPackToClipboardText } from '../../../lib/services/implementationPlanAdapter';
import { PromptPackCard } from './PromptPackCard';
import { CopyTextButton } from './CopyTextButton';
import { QualityGateRow } from './QualityGateRow';

const PRIORITY_STYLE: Record<NonNullable<ImplementationPlanMilestone['priority']>, string> = {
    critical: 'bg-red-50 text-red-700 border-red-200',
    high: 'bg-amber-50 text-amber-700 border-amber-200',
    medium: 'bg-sky-50 text-sky-700 border-sky-200',
    low: 'bg-neutral-100 text-neutral-600 border-neutral-200',
};

function LinkedChips({ icon: Icon, label, items }: { icon: typeof Database; label: string; items: string[] }) {
    if (items.length === 0) return null;
    return (
        <div className="flex items-start gap-1.5 min-w-0">
            <Icon size={12} className="mt-0.5 shrink-0 text-neutral-400" />
            <p className="text-[11px] text-neutral-600 leading-relaxed">
                <span className="font-semibold text-neutral-500">{label}:</span>{' '}
                {items.join(', ')}
            </p>
        </div>
    );
}

interface Props {
    milestone: ImplementationPlanMilestone;
    index: number;
    /** Resolve a milestone id in `dependencies` to its display name. */
    milestoneNameById: Map<string, string>;
    defaultExpanded?: boolean;
}

/**
 * Full milestone detail: objective, linked artifacts, tasks, prompt packs,
 * quality gates, validation commands, and definition of done. Header shows
 * the compact roadmap facts (priority, effort, dependencies, counts).
 */
export function MilestoneCard({ milestone: m, index, milestoneNameById, defaultExpanded = false }: Props) {
    const [expanded, setExpanded] = useState(defaultExpanded);
    const packs: ImplementationPromptPack[] = m.promptPacks ?? [];
    const gates = m.qualityGates ?? [];
    const links = m.linkedArtifacts ?? {};
    const objective = m.objective ?? m.goal;
    const deps = (m.dependencies ?? []).map(d => milestoneNameById.get(d) ?? d);
    const counts = [
        `${m.tasks.length} task${m.tasks.length === 1 ? '' : 's'}`,
        `${packs.length} prompt pack${packs.length === 1 ? '' : 's'}`,
        `${gates.length} quality gate${gates.length === 1 ? '' : 's'}`,
    ];
    const allPromptsText = packs.map(promptPackToClipboardText).join('\n\n---\n\n');

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
                        <p className="flex items-start gap-1.5 text-sm text-neutral-800">
                            <Target size={13} className="mt-0.5 shrink-0 text-indigo-500" />
                            <span>{objective}</span>
                        </p>
                    )}

                    {(links.screens?.length || links.dataModels?.length || links.components?.length
                        || links.userFlows?.length || links.apis?.length || links.risks?.length) ? (
                        <div className="rounded-lg bg-neutral-50 border border-neutral-200 px-3 py-2.5 space-y-1.5">
                            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                                <Link2 size={11} /> Linked Synapse Artifacts
                            </p>
                            <LinkedChips icon={AppWindow} label="Screens" items={links.screens ?? []} />
                            <LinkedChips icon={Database} label="Data Models" items={links.dataModels ?? []} />
                            <LinkedChips icon={Puzzle} label="Components" items={links.components ?? []} />
                            <LinkedChips icon={GitBranch} label="User Flows" items={links.userFlows ?? []} />
                            <LinkedChips icon={TerminalSquare} label="APIs" items={links.apis ?? []} />
                            <LinkedChips icon={Flag} label="Risks" items={links.risks ?? []} />
                        </div>
                    ) : null}

                    {m.tasks.length > 0 && (
                        <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-1.5">
                                Implementation Tasks
                            </p>
                            <ul className="space-y-1">
                                {m.tasks.map(t => (
                                    <li key={t.id} className="flex items-start gap-2 text-sm text-neutral-800">
                                        <input
                                            type="checkbox"
                                            checked={t.status === 'done'}
                                            readOnly
                                            aria-label={t.title}
                                            className="mt-1 rounded border-neutral-300 cursor-default"
                                        />
                                        <span>
                                            {t.title}
                                            {t.description && (
                                                <span className="block text-xs text-neutral-500">{t.description}</span>
                                            )}
                                        </span>
                                    </li>
                                ))}
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
                                    <PromptPackCard key={pack.id} pack={pack} defaultCollapsed={packs.length > 1} />
                                ))}
                            </div>
                        </div>
                    )}

                    {gates.length > 0 && (
                        <div>
                            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-1.5">
                                <ShieldCheck size={11} /> Quality Gates
                            </p>
                            <ul className="space-y-1">
                                {gates.map(g => <QualityGateRow key={g.id} gate={g} />)}
                            </ul>
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
                        <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-1.5">
                                Definition of Done
                            </p>
                            <ul className="space-y-1">
                                {m.definitionOfDone!.map((d, i) => (
                                    <li key={i} className="flex items-start gap-2 text-sm text-neutral-800">
                                        <input type="checkbox" readOnly aria-label={d} className="mt-1 rounded border-neutral-300 cursor-default" />
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
