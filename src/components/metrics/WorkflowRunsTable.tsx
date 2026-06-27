import type { WorkflowRun } from '../../types';
import {
    formatConcurrency,
    formatCost,
    formatDuration,
    formatSpeedup,
    formatTimestamp,
    formatTokens,
} from './format';

// Recent-runs table. Each row is a recorded WorkflowRun; clicking selects it
// for the detail/Gantt view. Horizontally scrollable on narrow screens.

interface Props {
    runs: WorkflowRun[];
    selectedId?: string;
    onSelect: (run: WorkflowRun) => void;
}

const STATUS_STYLES: Record<WorkflowRun['status'], string> = {
    complete: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
    partial: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
    error: 'bg-red-500/10 text-red-300 border-red-500/30',
};

const TYPE_LABEL: Record<WorkflowRun['workflowType'], string> = {
    prd: 'PRD Generation',
    artifacts: 'Artifact Bundle',
};

export function WorkflowRunsTable({ runs, selectedId, onSelect }: Props) {
    return (
        <div className="overflow-x-auto rounded-2xl border border-white/10">
            <table className="w-full min-w-[860px] text-left text-sm">
                <thead>
                    <tr className="border-b border-white/10 text-[11px] uppercase tracking-wide text-neutral-400">
                        <th className="px-3 py-2 font-medium">When</th>
                        <th className="px-3 py-2 font-medium">Project</th>
                        <th className="px-3 py-2 font-medium">Type</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                        <th className="px-3 py-2 text-right font-medium">Actual</th>
                        <th className="px-3 py-2 text-right font-medium">Sequential</th>
                        <th className="px-3 py-2 text-right font-medium">Speedup</th>
                        <th className="px-3 py-2 text-right font-medium">Max&nbsp;Conc.</th>
                        <th className="px-3 py-2 text-right font-medium">Tokens</th>
                        <th className="px-3 py-2 text-right font-medium">Est.&nbsp;Cost</th>
                        <th className="px-3 py-2 text-right font-medium">Retries</th>
                        <th className="px-3 py-2 text-right font-medium">Fails</th>
                    </tr>
                </thead>
                <tbody>
                    {runs.map((r) => (
                        <tr
                            key={r.id}
                            onClick={() => onSelect(r)}
                            className={`cursor-pointer border-b border-white/5 transition-colors hover:bg-white/5 ${
                                selectedId === r.id ? 'bg-indigo-500/10' : ''
                            }`}
                        >
                            <td className="whitespace-nowrap px-3 py-2 text-neutral-300">{formatTimestamp(r.startedAt)}</td>
                            <td className="px-3 py-2 text-neutral-200">{r.projectName ?? '—'}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-neutral-300">{TYPE_LABEL[r.workflowType]}</td>
                            <td className="px-3 py-2">
                                <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] capitalize ${STATUS_STYLES[r.status]}`}>
                                    {r.status}
                                </span>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-white">{formatDuration(r.actualRuntimeMs)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-neutral-400">{formatDuration(r.sequentialEstimateMs)}</td>
                            <td className="px-3 py-2 text-right tabular-nums font-semibold text-indigo-300">{formatSpeedup(r.speedupRatio)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-neutral-300">{formatConcurrency(r.maxConcurrency)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-neutral-300">{formatTokens(r.totalTokens)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-neutral-300">{formatCost(r.estimatedCost)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-neutral-400">{r.retryCount}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-neutral-400">{r.failureCount}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
