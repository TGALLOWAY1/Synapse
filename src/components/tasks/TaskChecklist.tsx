import { useState } from 'react';
import {
    CheckCircle2, Circle, Clock, Trash2, ExternalLink, ChevronDown, ChevronRight,
} from 'lucide-react';
import { useProjectStore } from '../../store/projectStore';
import type { ProjectTask, TaskStatus } from '../../types';

// Stable empty reference for the tasks selector. A fresh `[]` literal each
// call makes Zustand's useSyncExternalStore see a snapshot change on every
// render and triggers React #185 (Maximum update depth) for projects without
// saved tasks.
const EMPTY_TASKS: ProjectTask[] = [];

interface TaskChecklistProps {
    projectId: string;
    sourceArtifactId: string;
}

const PRIORITY_STYLE: Record<string, string> = {
    high: 'bg-red-50 text-red-700 border-red-200',
    medium: 'bg-amber-50 text-amber-700 border-amber-200',
    low: 'bg-neutral-100 text-neutral-600 border-neutral-200',
};

/** Cycle order for the status toggle: todo → in_progress → done → todo.
 * `blocked` (only set by structured-plan imports, never by this UI) folds
 * back into the cycle at `todo`. */
const NEXT_STATUS: Record<TaskStatus, TaskStatus> = {
    todo: 'in_progress',
    in_progress: 'done',
    done: 'todo',
    blocked: 'todo',
};

function StatusButton({ status, onClick }: { status: TaskStatus; onClick: () => void }) {
    const label =
        status === 'done' ? 'Done — click to reset'
            : status === 'in_progress' ? 'In progress — click to mark done'
                : 'To do — click to start';
    const Icon = status === 'done' ? CheckCircle2 : status === 'in_progress' ? Clock : Circle;
    const color =
        status === 'done' ? 'text-green-600'
            : status === 'in_progress' ? 'text-amber-500'
                : 'text-neutral-300 hover:text-neutral-500';
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={label}
            title={label}
            className={`shrink-0 p-1 -m-1 transition ${color}`}
        >
            <Icon size={20} />
        </button>
    );
}

export function TaskChecklist({ projectId, sourceArtifactId }: TaskChecklistProps) {
    const tasks = useProjectStore(s => s.tasks[projectId] ?? EMPTY_TASKS);
    const setTaskStatus = useProjectStore(s => s.setTaskStatus);
    const removeProjectTask = useProjectStore(s => s.removeProjectTask);
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const mine: ProjectTask[] = tasks.filter(t => t.sourceArtifactId === sourceArtifactId);
    if (mine.length === 0) return null;

    const done = mine.filter(t => t.status === 'done').length;
    const inProgress = mine.filter(t => t.status === 'in_progress').length;
    const pct = Math.round((done / mine.length) * 100);

    return (
        <section className="not-prose mb-6 rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
            <header className="p-4 border-b border-neutral-100">
                <div className="flex items-center justify-between gap-3 mb-2">
                    <h3 className="text-sm font-semibold text-neutral-800">Implementation progress</h3>
                    <span className="text-xs text-neutral-500 shrink-0">
                        {done} of {mine.length} done
                        {inProgress > 0 && <span className="text-amber-600"> · {inProgress} in progress</span>}
                    </span>
                </div>
                <div className="h-2 rounded-full bg-neutral-100 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                    <div
                        className="h-full bg-green-500 transition-all duration-300"
                        style={{ width: `${pct}%` }}
                    />
                </div>
            </header>

            <ul className="divide-y divide-neutral-100">
                {mine.map(task => {
                    const expanded = expandedId === task.id;
                    const githubRef = task.externalRefs?.find(r => r.target === 'github');
                    return (
                        <li key={task.id} className="px-4 py-2.5">
                            <div className="flex items-start gap-3">
                                <StatusButton
                                    status={task.status}
                                    onClick={() => setTaskStatus(projectId, task.id, NEXT_STATUS[task.status])}
                                />
                                <div className="flex-1 min-w-0">
                                    <button
                                        type="button"
                                        onClick={() => setExpandedId(expanded ? null : task.id)}
                                        className="w-full flex items-center gap-1.5 text-left"
                                    >
                                        {expanded ? <ChevronDown size={13} className="shrink-0 text-neutral-400" /> : <ChevronRight size={13} className="shrink-0 text-neutral-400" />}
                                        <span className={`text-sm font-medium truncate ${task.status === 'done' ? 'text-neutral-400 line-through' : 'text-neutral-800'}`}>
                                            {task.title}
                                        </span>
                                    </button>
                                    {expanded && (
                                        <div className="mt-2 ml-[19px] space-y-2">
                                            <p className="text-xs text-neutral-600 leading-relaxed">{task.summary}</p>
                                            {task.acceptanceCriteria.length > 0 && (
                                                <div>
                                                    <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 mb-1">Acceptance criteria</p>
                                                    <ul className="space-y-0.5">
                                                        {task.acceptanceCriteria.map((c, i) => (
                                                            <li key={i} className="text-xs text-neutral-600 flex gap-1.5">
                                                                <span className="text-neutral-300">•</span>
                                                                <span>{c}</span>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                    {task.priority && (
                                        <span className={`hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-medium rounded border ${PRIORITY_STYLE[task.priority] ?? PRIORITY_STYLE.low}`}>
                                            {task.priority}
                                        </span>
                                    )}
                                    {githubRef?.externalUrl && (
                                        <a
                                            href={githubRef.externalUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            title="Open linked GitHub issue"
                                            className="p-1 text-neutral-400 hover:text-indigo-600 transition"
                                        >
                                            <ExternalLink size={13} />
                                        </a>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => removeProjectTask(projectId, task.id)}
                                        aria-label={`Remove task: ${task.title}`}
                                        className="p-1 text-neutral-300 hover:text-red-600 transition"
                                    >
                                        <Trash2 size={13} />
                                    </button>
                                </div>
                            </div>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
