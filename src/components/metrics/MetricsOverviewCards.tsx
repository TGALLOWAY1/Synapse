import type { WorkflowRun } from '../../types';
import { successRate } from '../../lib/metrics/workflowMetrics';
import {
    formatConcurrency,
    formatCost,
    formatDuration,
    formatPercent,
    formatSpeedup,
    formatTokens,
} from './format';

// Aggregate "at a glance" cards across every recorded workflow run. All values
// are averages/totals over the provided runs — see workflowMetrics.ts for the
// per-run math these roll up.

interface Props {
    runs: WorkflowRun[];
}

function avg(nums: number[]): number {
    if (nums.length === 0) return 0;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
}

interface Card {
    label: string;
    value: string;
    hint?: string;
}

export function MetricsOverviewCards({ runs }: Props) {
    const totalRuntime = runs.reduce((s, r) => s + r.actualRuntimeMs, 0);
    const totalSequential = runs.reduce((s, r) => s + r.sequentialEstimateMs, 0);
    const totalTokens = runs.reduce((s, r) => s + r.totalTokens, 0);
    const totalCost = runs.reduce((s, r) => s + r.estimatedCost, 0);

    const cards: Card[] = [
        { label: 'Workflows Run', value: `${runs.length}` },
        { label: 'Avg Actual Runtime', value: formatDuration(avg(runs.map((r) => r.actualRuntimeMs))) },
        { label: 'Avg Sequential Estimate', value: formatDuration(avg(runs.map((r) => r.sequentialEstimateMs))), hint: 'If sections ran one-by-one' },
        { label: 'Avg Parallel Speedup', value: formatSpeedup(avg(runs.map((r) => r.speedupRatio))), hint: 'Sequential ÷ actual' },
        { label: 'Avg Time Saved', value: formatDuration(avg(runs.map((r) => r.parallelTimeSavedMs))) },
        { label: 'Avg Max Concurrency', value: formatConcurrency(avg(runs.map((r) => r.maxConcurrency))), hint: 'Peak agents in flight' },
        { label: 'Success Rate', value: formatPercent(successRate(runs.map((r) => r.status))) },
        { label: 'Total Tokens', value: formatTokens(totalTokens) },
        { label: 'Estimated AI Cost', value: formatCost(totalCost), hint: 'Approximate' },
    ];

    // A headline "time saved overall" sentence — the single most resume-worthy
    // number — derived from the totals rather than an average of ratios.
    const overallSpeedup = totalRuntime > 0 ? totalSequential / totalRuntime : 1;

    return (
        <div className="space-y-4">
            <div className="rounded-2xl border border-indigo-500/30 bg-indigo-500/10 p-5">
                <p className="text-sm text-indigo-200">
                    Across {runs.length} concurrent multi-agent run{runs.length === 1 ? '' : 's'}, parallel execution
                    delivered an overall{' '}
                    <span className="font-semibold text-white">{formatSpeedup(overallSpeedup)} speedup</span>
                    {' '}— {formatDuration(totalSequential)} of sequential work completed in{' '}
                    <span className="font-semibold text-white">{formatDuration(totalRuntime)}</span>.
                </p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-3">
                {cards.map((c) => (
                    <div key={c.label} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">{c.label}</p>
                        <p className="mt-1 text-2xl font-semibold text-white tabular-nums">{c.value}</p>
                        {c.hint && <p className="mt-0.5 text-[11px] text-neutral-500">{c.hint}</p>}
                    </div>
                ))}
            </div>
        </div>
    );
}
