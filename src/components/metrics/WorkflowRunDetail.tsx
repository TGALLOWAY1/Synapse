import type { WorkflowNodeRun, WorkflowRun } from '../../types';
import {
    formatConcurrency,
    formatCost,
    formatDuration,
    formatSpeedup,
    formatTokens,
} from './format';

// Detail / Gantt view for a single workflow run. The horizontal bars are laid
// out by normalizing each node's [startedAt, completedAt] against the run
// window, so overlapping bars are a direct visual proof of concurrency. Below
// the chart, a per-node table lists model / duration / tokens / cost / deps.

interface Props {
    run: WorkflowRun;
}

// A small palette indexed by parallel group so nodes in the same wave share a
// hue and the eye can read "these ran together".
const GROUP_COLORS = [
    'bg-indigo-500',
    'bg-sky-500',
    'bg-violet-500',
    'bg-teal-500',
    'bg-amber-500',
    'bg-rose-500',
];

function barColor(node: WorkflowNodeRun): string {
    if (node.status === 'error') return 'bg-red-500';
    const g = node.parallelGroupId ?? 0;
    return GROUP_COLORS[g % GROUP_COLORS.length];
}

export function WorkflowRunDetail({ run }: Props) {
    const runStart = run.startedAt;
    const span = Math.max(1, run.completedAt - run.startedAt);
    // Stable visual ordering: by start time, then by group.
    const nodes = [...run.nodes].sort(
        (a, b) => a.startedAt - b.startedAt || (a.parallelGroupId ?? 0) - (b.parallelGroupId ?? 0),
    );

    const consistencyMs = run.metadata?.consistencyReviewMs as number | undefined;

    return (
        <div className="space-y-5">
            {/* Headline metrics for this run */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Actual Runtime" value={formatDuration(run.actualRuntimeMs)} />
                <Stat label="Sequential Estimate" value={formatDuration(run.sequentialEstimateMs)} />
                <Stat label="Parallel Speedup" value={formatSpeedup(run.speedupRatio)} accent />
                <Stat label="Time Saved" value={formatDuration(run.parallelTimeSavedMs)} />
                <Stat label="Max Concurrency" value={formatConcurrency(run.maxConcurrency)} />
                <Stat label="Avg Concurrency" value={formatConcurrency(run.averageConcurrency)} />
                <Stat label="Critical Path" value={formatDuration(run.criticalPathMs)} />
                <Stat label="Est. Cost" value={formatCost(run.estimatedCost)} />
            </div>

            {/* Gantt */}
            <div>
                <h4 className="mb-2 text-sm font-semibold text-neutral-200">Timeline</h4>
                <div className="space-y-1.5">
                    {nodes.map((node) => {
                        const leftPct = ((node.startedAt - runStart) / span) * 100;
                        const widthPct = Math.max(1.5, (node.durationMs / span) * 100);
                        return (
                            <div key={node.id} className="flex items-center gap-2">
                                <div className="w-32 shrink-0 truncate text-right text-[11px] text-neutral-400" title={node.nodeName}>
                                    {node.nodeName}
                                </div>
                                <div className="relative h-5 flex-1 rounded bg-white/5">
                                    <div
                                        className={`absolute top-0 flex h-5 items-center rounded ${barColor(node)} px-1.5`}
                                        style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                                        title={`${node.nodeName} · ${formatDuration(node.durationMs)}`}
                                    >
                                        <span className="truncate text-[10px] font-medium text-white/90">
                                            {formatDuration(node.durationMs)}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
                <p className="mt-2 text-[11px] text-neutral-500">
                    Bars sharing a color ran in the same dependency wave (eligible to execute concurrently).
                    {typeof consistencyMs === 'number' && ` Consistency review: ${formatDuration(consistencyMs)}.`}
                </p>
            </div>

            {/* Node table */}
            <div className="overflow-x-auto rounded-xl border border-white/10">
                <table className="w-full min-w-[680px] text-left text-sm">
                    <thead>
                        <tr className="border-b border-white/10 text-[11px] uppercase tracking-wide text-neutral-400">
                            <th className="px-3 py-2 font-medium">Node</th>
                            <th className="px-3 py-2 font-medium">Model</th>
                            <th className="px-3 py-2 font-medium">Wave</th>
                            <th className="px-3 py-2 text-right font-medium">Duration</th>
                            <th className="px-3 py-2 text-right font-medium">Tokens</th>
                            <th className="px-3 py-2 text-right font-medium">Est. Cost</th>
                            <th className="px-3 py-2 font-medium">Depends on</th>
                            <th className="px-3 py-2 font-medium">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {nodes.map((node) => (
                            <tr key={node.id} className="border-b border-white/5">
                                <td className="px-3 py-2 text-neutral-200">{node.nodeName}</td>
                                <td className="px-3 py-2 text-neutral-400">{node.model}</td>
                                <td className="px-3 py-2 tabular-nums text-neutral-400">{(node.parallelGroupId ?? 0) + 1}</td>
                                <td className="px-3 py-2 text-right tabular-nums text-white">{formatDuration(node.durationMs)}</td>
                                <td className="px-3 py-2 text-right tabular-nums text-neutral-300">
                                    {node.totalTokens !== undefined ? formatTokens(node.totalTokens) : '—'}
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums text-neutral-300">
                                    {node.estimatedCost ? formatCost(node.estimatedCost) : '—'}
                                </td>
                                <td className="px-3 py-2 text-[11px] text-neutral-500">
                                    {node.dependencyIds.length ? node.dependencyIds.join(', ') : '—'}
                                </td>
                                <td className="px-3 py-2">
                                    {node.status === 'error' ? (
                                        <span className="text-red-300" title={node.errorMessage}>error</span>
                                    ) : (
                                        <span className="text-emerald-300">ok</span>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
    return (
        <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">{label}</p>
            <p className={`mt-0.5 text-lg font-semibold tabular-nums ${accent ? 'text-indigo-300' : 'text-white'}`}>{value}</p>
        </div>
    );
}
