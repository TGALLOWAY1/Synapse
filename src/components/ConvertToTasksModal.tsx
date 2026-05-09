import { useMemo, useState } from 'react';
import { X, Trash2, Loader2, CheckCircle2, AlertTriangle, ExternalLink, FileDown, Github, KanbanSquare } from 'lucide-react';
import type {
    ExportResult,
    ExportTargetId,
    ImplementationTask,
    TaskComplexity,
    TaskPriority,
    TaskType,
} from '../types/tasks';
import { parseImplementationPlan } from '../lib/services/implementationPlanParser';
import { extractTasks } from '../lib/services/taskExtractor';
import { EXPORT_PROVIDERS, exportTasks } from '../lib/services/taskExport';
import { useToastStore } from '../store/toastStore';
import { ErrorBanner } from './ErrorBanner';

interface ConvertToTasksModalProps {
    sourceArtifactId: string;
    artifactContent: string;
    projectName?: string;
    onClose: () => void;
}

interface EditableTask extends ImplementationTask {
    /** Per-row criteria editing buffer — one criterion per textarea line. */
    criteriaText: string;
}

const TASK_TYPE_OPTIONS: TaskType[] = [
    'frontend',
    'backend',
    'design',
    'data',
    'qa',
    'docs',
    'infra',
];

const PRIORITY_OPTIONS: TaskPriority[] = ['low', 'medium', 'high'];
const COMPLEXITY_OPTIONS: TaskComplexity[] = ['small', 'medium', 'large'];

const TARGET_ICON: Record<ExportTargetId, typeof FileDown> = {
    markdown: FileDown,
    github: Github,
    linear: KanbanSquare,
};

function toEditable(task: ImplementationTask): EditableTask {
    return {
        ...task,
        criteriaText: task.acceptanceCriteria.join('\n'),
    };
}

function fromEditable(task: EditableTask): ImplementationTask {
    const criteria = task.criteriaText
        .split('\n')
        .map(line => line.replace(/^\s*[-*]\s*/, '').replace(/^\s*\[\s*[ xX]\s*\]\s*/, '').trim())
        .filter(Boolean);
    return {
        id: task.id,
        title: task.title,
        summary: task.summary,
        sourceArtifactId: task.sourceArtifactId,
        sourceSectionId: task.sourceSectionId,
        priority: task.priority,
        taskType: task.taskType,
        estimatedComplexity: task.estimatedComplexity,
        dependencies: task.dependencies,
        acceptanceCriteria: criteria,
        implementationNotes: task.implementationNotes,
        suggestedLabels: task.suggestedLabels,
    };
}

export function ConvertToTasksModal({
    sourceArtifactId,
    artifactContent,
    projectName,
    onClose,
}: ConvertToTasksModalProps) {
    const { addToast } = useToastStore();
    const initialTasks = useMemo(() => {
        const plan = parseImplementationPlan(artifactContent);
        return extractTasks(plan, { sourceArtifactId }).map(toEditable);
    }, [artifactContent, sourceArtifactId]);

    const [tasks, setTasks] = useState<EditableTask[]>(initialTasks);
    const [target, setTarget] = useState<ExportTargetId>('markdown');
    const [exporting, setExporting] = useState(false);
    const [result, setResult] = useState<ExportResult | null>(null);
    const [readyError, setReadyError] = useState<string | null>(null);

    const provider = EXPORT_PROVIDERS[target];
    const targetReadyMessage = provider.checkReady();

    const updateTask = (index: number, patch: Partial<EditableTask>) => {
        setTasks(prev => prev.map((task, i) => (i === index ? { ...task, ...patch } : task)));
    };

    const removeTask = (index: number) => {
        setTasks(prev => prev.filter((_, i) => i !== index));
    };

    const handleExport = async () => {
        setReadyError(null);
        if (tasks.length === 0) {
            setReadyError('Nothing to export — add at least one task or close this dialog.');
            return;
        }
        if (target !== 'markdown' && targetReadyMessage) {
            setReadyError(targetReadyMessage);
            return;
        }
        setExporting(true);
        try {
            const finalized = tasks.map(fromEditable);
            const exportResult = await exportTasks(finalized, { target, projectName });
            setResult(exportResult);
            const succeeded = exportResult.succeeded.length;
            const failed = exportResult.failed.length;
            if (exportResult.fatalError) {
                addToast({ type: 'error', title: 'Export failed', message: exportResult.fatalError });
            } else if (failed === 0) {
                addToast({
                    type: 'success',
                    title: exportResult.mock ? `Linear export prepared (mocked)` : `Exported ${succeeded} task${succeeded === 1 ? '' : 's'}`,
                });
            } else {
                addToast({
                    type: 'warning',
                    title: `Exported ${succeeded} of ${succeeded + failed}`,
                    message: `${failed} task${failed === 1 ? '' : 's'} failed — see modal for details.`,
                });
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            setResult({
                target,
                succeeded: [],
                failed: tasks.map(t => ({ taskId: t.id, title: t.title, error: message })),
                fatalError: message,
            });
            addToast({ type: 'error', title: 'Export failed', message });
        } finally {
            setExporting(false);
        }
    };

    return (
        <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex justify-center items-center overflow-y-auto p-4 md:p-8"
            onClick={onClose}
        >
            <div
                className="bg-white rounded-xl shadow-2xl w-full max-w-4xl flex flex-col max-h-[90vh]"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="p-4 border-b border-neutral-200 flex justify-between items-center bg-neutral-50 rounded-t-xl">
                    <div>
                        <h2 className="text-lg font-semibold text-neutral-800">Convert Implementation Plan to Tasks</h2>
                        <p className="text-sm text-neutral-500">
                            {tasks.length} task{tasks.length === 1 ? '' : 's'} extracted — review, edit, then export.
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-neutral-400 hover:text-neutral-700 hover:bg-neutral-200 rounded-full transition"
                        aria-label="Close"
                    >
                        <X size={20} />
                    </button>
                </div>

                {readyError && (
                    <div className="mx-4 mt-4">
                        <ErrorBanner message={readyError} onDismiss={() => setReadyError(null)} />
                    </div>
                )}

                {/* Body — scrollable list of editable tasks */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-neutral-50">
                    {tasks.length === 0 && !result && (
                        <div className="text-center text-sm text-neutral-500 py-12">
                            No tasks left. Re-extract by closing and reopening the modal, or close to cancel.
                        </div>
                    )}

                    {tasks.map((task, i) => (
                        <article
                            key={task.id}
                            className="bg-white rounded-lg border border-neutral-200 shadow-sm p-4 space-y-3"
                        >
                            <header className="flex items-start gap-2">
                                <span className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-md bg-indigo-50 text-indigo-700 text-xs font-bold">
                                    {i + 1}
                                </span>
                                <input
                                    type="text"
                                    value={task.title}
                                    onChange={e => updateTask(i, { title: e.target.value })}
                                    className="flex-1 px-2 py-1 text-sm font-semibold border border-transparent rounded hover:border-neutral-200 focus:outline-none focus:border-indigo-400 focus:bg-white"
                                    aria-label={`Task ${i + 1} title`}
                                />
                                <button
                                    type="button"
                                    onClick={() => removeTask(i)}
                                    className="p-1.5 text-neutral-400 hover:text-red-600 hover:bg-red-50 rounded transition"
                                    aria-label={`Remove task ${i + 1}`}
                                    title="Remove task"
                                >
                                    <Trash2 size={14} />
                                </button>
                            </header>

                            <div className="grid grid-cols-3 gap-2 text-xs">
                                <label className="flex flex-col gap-0.5">
                                    <span className="font-medium text-neutral-500 uppercase tracking-wider">Type</span>
                                    <select
                                        value={task.taskType ?? ''}
                                        onChange={e => updateTask(i, { taskType: (e.target.value || undefined) as TaskType | undefined })}
                                        className="px-2 py-1.5 border border-neutral-200 rounded bg-white"
                                    >
                                        <option value="">—</option>
                                        {TASK_TYPE_OPTIONS.map(t => (
                                            <option key={t} value={t}>{t}</option>
                                        ))}
                                    </select>
                                </label>
                                <label className="flex flex-col gap-0.5">
                                    <span className="font-medium text-neutral-500 uppercase tracking-wider">Priority</span>
                                    <select
                                        value={task.priority ?? ''}
                                        onChange={e => updateTask(i, { priority: (e.target.value || undefined) as TaskPriority | undefined })}
                                        className="px-2 py-1.5 border border-neutral-200 rounded bg-white"
                                    >
                                        <option value="">—</option>
                                        {PRIORITY_OPTIONS.map(p => (
                                            <option key={p} value={p}>{p}</option>
                                        ))}
                                    </select>
                                </label>
                                <label className="flex flex-col gap-0.5">
                                    <span className="font-medium text-neutral-500 uppercase tracking-wider">Complexity</span>
                                    <select
                                        value={task.estimatedComplexity ?? ''}
                                        onChange={e => updateTask(i, { estimatedComplexity: (e.target.value || undefined) as TaskComplexity | undefined })}
                                        className="px-2 py-1.5 border border-neutral-200 rounded bg-white"
                                    >
                                        <option value="">—</option>
                                        {COMPLEXITY_OPTIONS.map(c => (
                                            <option key={c} value={c}>{c}</option>
                                        ))}
                                    </select>
                                </label>
                            </div>

                            <div>
                                <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-1">
                                    Summary
                                </p>
                                <p className="text-xs text-neutral-700 leading-relaxed">{task.summary}</p>
                            </div>

                            <div>
                                <label className="block">
                                    <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                                        Acceptance Criteria (one per line)
                                    </span>
                                    <textarea
                                        rows={Math.min(8, Math.max(3, task.criteriaText.split('\n').length))}
                                        value={task.criteriaText}
                                        onChange={e => updateTask(i, { criteriaText: e.target.value })}
                                        className="mt-1 w-full px-2 py-1.5 text-xs font-mono border border-neutral-200 rounded resize-y bg-white"
                                    />
                                </label>
                            </div>

                            {task.suggestedLabels && task.suggestedLabels.length > 0 && (
                                <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                                        Labels
                                    </span>
                                    {task.suggestedLabels.map(label => (
                                        <span
                                            key={label}
                                            className="px-2 py-0.5 text-[10px] font-medium bg-neutral-100 text-neutral-700 rounded-full border border-neutral-200"
                                        >
                                            {label}
                                        </span>
                                    ))}
                                </div>
                            )}

                            {task.sourceSectionId && (
                                <p className="text-[11px] text-neutral-400">
                                    Source: <code>{task.sourceSectionId}</code>
                                </p>
                            )}
                        </article>
                    ))}

                    {result && (
                        <ExportResultPanel result={result} />
                    )}
                </div>

                {/* Footer — target selector + export button */}
                <div className="border-t border-neutral-200 p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3 bg-white rounded-b-xl">
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Export to</span>
                        <div className="flex items-center gap-1 bg-neutral-100 rounded-lg p-1">
                            {(Object.keys(EXPORT_PROVIDERS) as ExportTargetId[]).map(id => {
                                const Icon = TARGET_ICON[id];
                                const active = target === id;
                                return (
                                    <button
                                        key={id}
                                        type="button"
                                        onClick={() => setTarget(id)}
                                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition ${
                                            active
                                                ? 'bg-white text-neutral-900 shadow-sm font-medium'
                                                : 'text-neutral-600 hover:text-neutral-900'
                                        }`}
                                    >
                                        <Icon size={12} />
                                        {EXPORT_PROVIDERS[id].label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="flex items-center gap-2 md:ml-auto">
                        {target !== 'markdown' && targetReadyMessage && (
                            <span className="text-[11px] text-amber-600 inline-flex items-center gap-1">
                                <AlertTriangle size={12} />
                                {targetReadyMessage}
                            </span>
                        )}
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-sm text-neutral-500 hover:text-neutral-700 transition"
                        >
                            Close
                        </button>
                        <button
                            type="button"
                            onClick={handleExport}
                            disabled={exporting || tasks.length === 0}
                            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-neutral-300 rounded-lg transition"
                        >
                            {exporting && <Loader2 size={14} className="animate-spin" />}
                            {exporting ? 'Exporting…' : `Export ${tasks.length} task${tasks.length === 1 ? '' : 's'}`}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function ExportResultPanel({ result }: { result: ExportResult }) {
    const total = result.succeeded.length + result.failed.length;
    return (
        <div className="bg-white rounded-lg border border-neutral-200 p-4 space-y-2">
            <header className="flex items-center gap-2">
                {result.fatalError ? (
                    <AlertTriangle size={16} className="text-red-500" />
                ) : result.failed.length > 0 ? (
                    <AlertTriangle size={16} className="text-amber-500" />
                ) : (
                    <CheckCircle2 size={16} className="text-green-500" />
                )}
                <h3 className="text-sm font-semibold text-neutral-800">
                    Export result — {result.target}
                    {result.mock && <span className="ml-1.5 text-[10px] uppercase tracking-wider text-amber-600 font-bold">(mock)</span>}
                </h3>
                <span className="text-xs text-neutral-500 ml-auto">
                    {result.succeeded.length} of {total} succeeded
                </span>
            </header>
            {result.fatalError && (
                <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">
                    {result.fatalError}
                </p>
            )}
            {result.notes && result.notes.length > 0 && (
                <ul className="text-xs text-neutral-600 list-disc pl-4 space-y-0.5">
                    {result.notes.map((note, i) => <li key={i}>{note}</li>)}
                </ul>
            )}
            {result.succeeded.length > 0 && (
                <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-green-700 mb-1">Succeeded</p>
                    <ul className="space-y-1">
                        {result.succeeded.map(item => (
                            <li key={item.taskId} className="text-xs text-neutral-700 flex items-center gap-2">
                                <CheckCircle2 size={12} className="text-green-500 shrink-0" />
                                <span className="truncate">{item.title}</span>
                                {item.externalId && <span className="text-neutral-400">{item.externalId}</span>}
                                {item.externalUrl && (
                                    <a
                                        href={item.externalUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="ml-auto text-indigo-600 hover:underline inline-flex items-center gap-0.5"
                                    >
                                        open <ExternalLink size={10} />
                                    </a>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {result.failed.length > 0 && (
                <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-red-700 mb-1">Failed</p>
                    <ul className="space-y-1">
                        {result.failed.map(item => (
                            <li key={item.taskId} className="text-xs text-neutral-700">
                                <div className="flex items-center gap-2">
                                    <AlertTriangle size={12} className="text-red-500 shrink-0" />
                                    <span className="truncate">{item.title}</span>
                                </div>
                                {item.error && (
                                    <p className="text-[11px] text-red-700 ml-5 break-words">{item.error}</p>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
