import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Calendar, ChevronRight, Flag, Layers, Target, Users } from 'lucide-react';
import { SectionTabs, type SectionTabItem } from '../SectionTabs';
import type {
    StructuredImplementationPlan,
    ImplementationPlanMilestone,
    ImplementationPlanTask,
    TaskStatus,
} from '../../types';

// Render an `implementation_plan` artifact.
//
// New artifacts include a trailing ```json synapse-plan fence — when present,
// we render the structured tabbed UI (Tasks / Architecture / Risks / DoD).
// Legacy artifacts (no fence) fall through to the original milestone-regex
// timeline so older projects in localStorage keep rendering unchanged.
//
// See docs/backlog/BACKLOG.md (Implementation Plan section) for deferred features.

interface Props {
    content: string;
}

const STRUCTURED_FENCE = /```json\s+synapse-plan\s*\n([\s\S]*?)\n```/;

function extractStructuredPlan(markdown: string): StructuredImplementationPlan | null {
    const match = markdown.match(STRUCTURED_FENCE);
    if (!match) return null;
    try {
        const parsed = JSON.parse(match[1]) as StructuredImplementationPlan;
        if (!Array.isArray(parsed?.milestones)) return null;
        return parsed;
    } catch {
        return null;
    }
}

// --- Legacy markdown parsing (kept verbatim for backward compat) ---

type Milestone = {
    id: number;
    title: string;
    timeframe?: string;
    body: string;
};

type ParsedPlan = {
    preamble: string;
    milestones: Milestone[];
    appendix: string;
};

const MILESTONE_HEADING = /^###\s+Milestone\s+(\d+)\s*[:\-—]?\s*(.+?)\s*(\(([^)]*)\))?\s*$/i;

function parsePlan(markdown: string): ParsedPlan {
    const lines = markdown.split('\n');
    const preamble: string[] = [];
    const milestones: Milestone[] = [];
    let inMilestones = false;
    let appendixStart = -1;
    let current: Milestone | null = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const m = line.match(MILESTONE_HEADING);
        if (m) {
            if (current) milestones.push(current);
            inMilestones = true;
            const id = Number(m[1]);
            const baseTitle = m[2].trim();
            const timeframe = m[4]?.trim();
            current = {
                id,
                title: timeframe ? baseTitle : baseTitle.replace(/\s*\([^)]*\)\s*$/, ''),
                timeframe: timeframe ?? extractTimeframe(baseTitle),
                body: '',
            };
            continue;
        }
        if (inMilestones && /^---+\s*$/.test(line.trim())) {
            if (current) {
                milestones.push(current);
                current = null;
            }
            appendixStart = i + 1;
            break;
        }
        if (current) {
            current.body += line + '\n';
        } else if (!inMilestones) {
            preamble.push(line);
        }
    }
    if (current) milestones.push(current);

    const appendix = appendixStart >= 0 ? lines.slice(appendixStart).join('\n').trim() : '';
    return {
        preamble: preamble.join('\n').trim(),
        milestones,
        appendix,
    };
}

function extractTimeframe(title: string): string | undefined {
    const m = title.match(/\(([^)]*)\)\s*$/);
    return m?.[1];
}

type ParsedSection = {
    label: string;
    body: string;
};

function parseMilestoneBody(body: string): {
    sections: ParsedSection[];
    deliverables: { text: string; checked: boolean }[];
} {
    const lines = body.split('\n');
    const sections: ParsedSection[] = [];
    const deliverables: { text: string; checked: boolean }[] = [];
    let currentLabel: string | null = null;
    let currentLines: string[] = [];

    const flushSection = () => {
        if (currentLabel) {
            sections.push({ label: currentLabel, body: currentLines.join('\n').trim() });
        }
        currentLabel = null;
        currentLines = [];
    };

    for (const raw of lines) {
        const line = raw;
        const labelMatch = line.match(/^\*\*([^*]+):\*\*\s*(.*)$/);
        if (labelMatch) {
            flushSection();
            currentLabel = labelMatch[1].trim();
            currentLines = labelMatch[2] ? [labelMatch[2]] : [];
            continue;
        }
        const checklistMatch = line.match(/^\s*-\s*\[\s*([ xX])\s*\]\s*(.+)$/);
        if (checklistMatch) {
            deliverables.push({
                text: checklistMatch[2].trim(),
                checked: checklistMatch[1].toLowerCase() === 'x',
            });
            continue;
        }
        if (currentLabel) {
            currentLines.push(line);
        }
    }
    flushSection();
    return { sections, deliverables };
}

function inlineMd(text: string) {
    return (
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ p: ({ children }) => <>{children}</> }}>
            {text}
        </ReactMarkdown>
    );
}

function blockMd(text: string) {
    return (
        <div className="prose prose-sm prose-neutral max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
        </div>
    );
}

const SECTION_ICON: Record<string, typeof Target> = {
    goal: Target,
    'key deliverables': Layers,
    'technical approach': Layers,
    dependencies: ChevronRight,
    risks: Flag,
    'definition of done': Target,
};

function LegacyMilestoneCard({ milestone }: { milestone: Milestone }) {
    const { sections, deliverables } = useMemo(() => parseMilestoneBody(milestone.body), [milestone.body]);
    return (
        <article
            id={`milestone-${milestone.id}`}
            className="bg-white rounded-xl border border-neutral-200 p-5 scroll-mt-24"
        >
            <header className="flex items-start gap-3 mb-3 pb-3 border-b border-neutral-100">
                <div className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-lg bg-indigo-600 text-white text-sm font-bold">
                    M{milestone.id}
                </div>
                <div className="min-w-0">
                    <h3 className="text-base font-bold text-neutral-900 leading-snug">{milestone.title}</h3>
                    {milestone.timeframe && (
                        <p className="flex items-center gap-1 text-[11px] text-neutral-500 mt-0.5">
                            <Calendar size={11} />
                            {milestone.timeframe}
                        </p>
                    )}
                </div>
            </header>

            {deliverables.length > 0 && (
                <div className="mb-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-1.5">
                        Key Deliverables
                    </p>
                    <ul className="space-y-1">
                        {deliverables.map((d, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-neutral-800">
                                <input
                                    type="checkbox"
                                    checked={d.checked}
                                    readOnly
                                    aria-label={d.text}
                                    className="mt-1 rounded border-neutral-300 cursor-default"
                                />
                                <span>{inlineMd(d.text)}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {sections.length > 0 && (
                <div className="space-y-3">
                    {sections.map((section, i) => {
                        const key = section.label.toLowerCase();
                        const Icon = SECTION_ICON[key] ?? ChevronRight;
                        return (
                            <div key={i}>
                                <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-1">
                                    <Icon size={11} />
                                    {section.label}
                                </p>
                                <div className="text-sm text-neutral-800">
                                    {blockMd(section.body)}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </article>
    );
}

function AppendixSection({ markdown }: { markdown: string }) {
    if (!markdown.trim()) return null;
    return (
        <div className="bg-neutral-50 rounded-xl border border-neutral-200 p-5">
            <header className="flex items-center gap-2 mb-2">
                <Users size={14} className="text-neutral-500" />
                <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                    Notes &amp; Traceability
                </p>
            </header>
            {blockMd(markdown)}
        </div>
    );
}

function LegacyTimeline({ content }: { content: string }) {
    const plan = useMemo(() => parsePlan(content), [content]);
    if (plan.milestones.length === 0) {
        return (
            <div className="prose prose-sm prose-neutral max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
        );
    }
    const tabs: SectionTabItem[] = plan.milestones.map(m => ({
        id: `milestone-${m.id}`,
        label: `M${m.id}`,
    }));
    return (
        <div className="space-y-5">
            <SectionTabs items={tabs} />
            {plan.preamble && blockMd(plan.preamble)}
            {plan.milestones.map(m => (
                <LegacyMilestoneCard key={m.id} milestone={m} />
            ))}
            <AppendixSection markdown={plan.appendix} />
        </div>
    );
}

// --- Structured (new) rendering ---

type TopTabId = 'tasks' | 'architecture' | 'risks' | 'definition_of_done';

const TASK_STATUS_STYLE: Record<TaskStatus, { label: string; cls: string }> = {
    todo: { label: 'Todo', cls: 'bg-neutral-100 text-neutral-700 border-neutral-200' },
    in_progress: { label: 'In Progress', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    done: { label: 'Done', cls: 'bg-green-50 text-green-700 border-green-200' },
    blocked: { label: 'Blocked', cls: 'bg-red-50 text-red-700 border-red-200' },
};

type MilestoneStatus = 'not_started' | 'in_progress' | 'complete';

const MILESTONE_STATUS_STYLE: Record<MilestoneStatus, { label: string; cls: string }> = {
    not_started: { label: 'Not Started', cls: 'bg-neutral-100 text-neutral-700 border-neutral-200' },
    in_progress: { label: 'In Progress', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    complete: { label: 'Complete', cls: 'bg-green-50 text-green-700 border-green-200' },
};

function deriveMilestoneStatus(tasks: ImplementationPlanTask[]): MilestoneStatus {
    if (tasks.length === 0) return 'not_started';
    if (tasks.every(t => t.status === 'todo')) return 'not_started';
    if (tasks.every(t => t.status === 'done')) return 'complete';
    return 'in_progress';
}

function TaskRow({
    task,
    titleById,
}: {
    task: ImplementationPlanTask;
    titleById: Map<string, string>;
}) {
    const style = TASK_STATUS_STYLE[task.status] ?? TASK_STATUS_STYLE.todo;
    const deps = task.dependencies?.filter(Boolean) ?? [];
    const links = task.linkedArtifacts;
    const linkSegments: string[] = [];
    if (links?.prd?.length) linkSegments.push(`PRD: ${links.prd.join(', ')}`);
    if (links?.dataModel?.length) linkSegments.push(`Data: ${links.dataModel.join(', ')}`);
    if (links?.mockups?.length) linkSegments.push(`Mockups: ${links.mockups.join(', ')}`);

    return (
        <li className="py-2 first:pt-0 last:pb-0 border-b border-neutral-100 last:border-b-0">
            <div className="flex items-start gap-2">
                <span
                    className={`shrink-0 mt-0.5 text-[10px] px-1.5 py-0.5 rounded border font-medium ${style.cls}`}
                >
                    {style.label}
                </span>
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-neutral-900 leading-snug">{task.title}</p>
                    {task.description && (
                        <p className="text-xs text-neutral-600 mt-0.5">{task.description}</p>
                    )}
                    {deps.length > 0 && (
                        <p className="text-[11px] text-neutral-500 mt-1">
                            <span className="font-semibold">Depends on:</span>{' '}
                            {deps.map(id => titleById.get(id) ?? id).join(', ')}
                        </p>
                    )}
                    {linkSegments.length > 0 && (
                        <p className="text-[11px] text-neutral-500 mt-0.5">
                            <span className="font-semibold">Linked:</span> {linkSegments.join(' · ')}
                        </p>
                    )}
                </div>
            </div>
        </li>
    );
}

function MilestoneTaskGroup({
    milestone,
    index,
    titleById,
}: {
    milestone: ImplementationPlanMilestone;
    index: number;
    titleById: Map<string, string>;
}) {
    const completed = milestone.tasks.filter(t => t.status === 'done').length;
    const total = milestone.tasks.length;
    const status = deriveMilestoneStatus(milestone.tasks);
    const statusStyle = MILESTONE_STATUS_STYLE[status];

    return (
        <article className="bg-white rounded-xl border border-neutral-200 p-5">
            <header className="flex items-start gap-3 mb-3 pb-3 border-b border-neutral-100">
                <div className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-lg bg-indigo-600 text-white text-sm font-bold">
                    M{index + 1}
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-base font-bold text-neutral-900 leading-snug">{milestone.name}</h3>
                        <span
                            className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${statusStyle.cls}`}
                        >
                            {statusStyle.label}
                        </span>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-neutral-500 mt-0.5">
                        {milestone.timeframe && (
                            <span className="flex items-center gap-1">
                                <Calendar size={11} />
                                {milestone.timeframe}
                            </span>
                        )}
                        <span>
                            {completed}/{total} tasks
                        </span>
                    </div>
                    {milestone.goal && (
                        <p className="flex items-start gap-1.5 text-sm text-neutral-700 mt-2">
                            <Target size={12} className="mt-1 shrink-0 text-neutral-500" />
                            <span>{milestone.goal}</span>
                        </p>
                    )}
                </div>
            </header>
            {milestone.tasks.length > 0 ? (
                <ul>
                    {milestone.tasks.map(t => (
                        <TaskRow key={t.id} task={t} titleById={titleById} />
                    ))}
                </ul>
            ) : (
                <p className="text-xs text-neutral-500 italic">No tasks defined.</p>
            )}
        </article>
    );
}

function StructuredPlanView({ plan }: { plan: StructuredImplementationPlan }) {
    const [tab, setTab] = useState<TopTabId>('tasks');

    const titleById = useMemo(() => {
        const map = new Map<string, string>();
        for (const m of plan.milestones) {
            for (const t of m.tasks) map.set(t.id, t.title);
        }
        return map;
    }, [plan]);

    const tabs: { id: TopTabId; label: string; count?: number }[] = [
        { id: 'tasks', label: 'Tasks', count: plan.milestones.reduce((n, m) => n + m.tasks.length, 0) },
        { id: 'architecture', label: 'Architecture', count: plan.architecture?.length },
        { id: 'risks', label: 'Risks', count: plan.risks?.length },
        { id: 'definition_of_done', label: 'Definition of Done', count: plan.definitionOfDone?.length },
    ];

    return (
        <div className="space-y-5">
            {plan.overview?.summary && (
                <div className="bg-neutral-50 rounded-xl border border-neutral-200 p-4">
                    <p className="text-sm text-neutral-800">{plan.overview.summary}</p>
                    {(plan.overview.criticalPath || plan.overview.teamSize) && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3 text-xs text-neutral-700">
                            {plan.overview.criticalPath && (
                                <div>
                                    <span className="font-semibold text-neutral-600">Critical Path: </span>
                                    {plan.overview.criticalPath}
                                </div>
                            )}
                            {plan.overview.teamSize && (
                                <div>
                                    <span className="font-semibold text-neutral-600">Team: </span>
                                    {plan.overview.teamSize}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            <nav className="flex flex-wrap gap-1 border-b border-neutral-200">
                {tabs.map(t => {
                    const active = tab === t.id;
                    return (
                        <button
                            key={t.id}
                            type="button"
                            onClick={() => setTab(t.id)}
                            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
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
            </nav>

            {tab === 'tasks' && (
                <div className="space-y-4">
                    {plan.milestones.map((m, i) => (
                        <MilestoneTaskGroup key={m.id} milestone={m} index={i} titleById={titleById} />
                    ))}
                </div>
            )}

            {tab === 'architecture' && (
                <div className="bg-white rounded-xl border border-neutral-200 p-5">
                    {plan.architecture?.length ? (
                        <ul className="space-y-2 text-sm text-neutral-800">
                            {plan.architecture.map((a, i) => (
                                <li key={i} className="flex items-start gap-2">
                                    <Layers size={14} className="mt-0.5 shrink-0 text-neutral-500" />
                                    <span>{inlineMd(a)}</span>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-sm text-neutral-500 italic">No architecture decisions captured.</p>
                    )}
                </div>
            )}

            {tab === 'risks' && (
                <div className="space-y-3">
                    {plan.risks?.length ? (
                        plan.risks.map((r, i) => (
                            <article key={i} className="bg-white rounded-xl border border-neutral-200 p-4">
                                <p className="flex items-start gap-2 text-sm font-semibold text-neutral-900">
                                    <Flag size={14} className="mt-0.5 shrink-0 text-red-500" />
                                    <span>{r.description}</span>
                                </p>
                                {r.mitigation && (
                                    <p className="text-sm text-neutral-700 mt-2 ml-6">
                                        <span className="font-semibold text-neutral-600">Mitigation: </span>
                                        {r.mitigation}
                                    </p>
                                )}
                            </article>
                        ))
                    ) : (
                        <div className="bg-white rounded-xl border border-neutral-200 p-5">
                            <p className="text-sm text-neutral-500 italic">No risks captured.</p>
                        </div>
                    )}
                </div>
            )}

            {tab === 'definition_of_done' && (
                <div className="bg-white rounded-xl border border-neutral-200 p-5">
                    {plan.definitionOfDone?.length ? (
                        <ul className="space-y-2">
                            {plan.definitionOfDone.map((d, i) => (
                                <li key={i} className="flex items-start gap-2 text-sm text-neutral-800">
                                    <input
                                        type="checkbox"
                                        readOnly
                                        aria-label={d}
                                        className="mt-1 rounded border-neutral-300 cursor-default"
                                    />
                                    <span>{inlineMd(d)}</span>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-sm text-neutral-500 italic">No definition of done captured.</p>
                    )}
                </div>
            )}
        </div>
    );
}

export function ImplementationPlanRenderer({ content }: Props) {
    const structured = useMemo(() => extractStructuredPlan(content), [content]);
    if (structured) {
        return <StructuredPlanView plan={structured} />;
    }
    return <LegacyTimeline content={content} />;
}
