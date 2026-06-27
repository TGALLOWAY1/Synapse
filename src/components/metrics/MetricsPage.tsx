import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Activity, X } from 'lucide-react';
import { useProjectStore } from '../../store/projectStore';
import type { WorkflowRun } from '../../types';
import { MetricsOverviewCards } from './MetricsOverviewCards';
import { WorkflowRunsTable } from './WorkflowRunsTable';
import { WorkflowRunDetail } from './WorkflowRunDetail';

// Standalone, auth-gated orchestration Metrics dashboard (`/metrics`). Reads
// persisted WorkflowRun history straight from the project store. Everything is
// real, recorded data — there is no synthetic/demo fallback, so a fresh account
// correctly shows an empty state rather than fabricated numbers.

// Module-level stable empty fallback — a fresh `{}`/`[]` in a selector allocates
// a new reference every render and trips React error #185 (see CLAUDE.md
// "Selector stability rule").
const EMPTY_RUNS: Record<string, WorkflowRun[]> = {};

export function MetricsPage() {
    const navigate = useNavigate();
    const workflowRuns = useProjectStore((s) => s.workflowRuns ?? EMPTY_RUNS);
    const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

    const runs = useMemo(
        () => Object.values(workflowRuns).flat().sort((a, b) => b.startedAt - a.startedAt),
        [workflowRuns],
    );

    const selected = useMemo(
        () => runs.find((r) => r.id === selectedId),
        [runs, selectedId],
    );

    return (
        <div className="min-h-screen bg-neutral-950 text-white">
            <header className="sticky top-0 z-10 border-b border-white/10 bg-neutral-950/80 backdrop-blur">
                <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-4">
                    <button
                        onClick={() => navigate(-1)}
                        className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-sm text-neutral-300 transition-colors hover:bg-white/5"
                    >
                        <ArrowLeft size={15} /> Back
                    </button>
                    <div className="flex items-center gap-2">
                        <Activity size={18} className="text-indigo-400" />
                        <h1 className="text-lg font-semibold">Orchestration Metrics</h1>
                    </div>
                </div>
            </header>

            <main className="mx-auto max-w-6xl space-y-8 px-4 py-8">
                <p className="max-w-3xl text-sm text-neutral-400">
                    Telemetry from Synapse's concurrent multi-agent workflows. PRD sections and downstream
                    artifacts run on a dependency-aware DAG executor; these metrics show how much that
                    parallelism actually saved versus running every step sequentially. Cost figures are
                    estimates.
                </p>

                {runs.length === 0 ? (
                    <EmptyState />
                ) : (
                    <>
                        <MetricsOverviewCards runs={runs} />

                        <section className="space-y-3">
                            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
                                Recent Workflow Runs
                            </h2>
                            <WorkflowRunsTable runs={runs} selectedId={selectedId} onSelect={(r) => setSelectedId(r.id)} />
                            <p className="text-[11px] text-neutral-500">Select a run to inspect its node timeline.</p>
                        </section>

                        {selected && (
                            <section className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
                                        Run Detail — {selected.projectName ?? 'Project'} ·{' '}
                                        {selected.workflowType === 'prd' ? 'PRD Generation' : 'Artifact Bundle'}
                                    </h2>
                                    <button
                                        onClick={() => setSelectedId(undefined)}
                                        className="flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-xs text-neutral-400 hover:bg-white/5"
                                    >
                                        <X size={13} /> Close
                                    </button>
                                </div>
                                <WorkflowRunDetail run={selected} />
                            </section>
                        )}
                    </>
                )}
            </main>
        </div>
    );
}

function EmptyState() {
    return (
        <div className="rounded-2xl border border-dashed border-white/15 bg-white/5 p-10 text-center">
            <Activity size={28} className="mx-auto text-neutral-600" />
            <p className="mt-3 text-sm font-medium text-neutral-300">No workflow runs recorded yet</p>
            <p className="mx-auto mt-1 max-w-md text-[13px] text-neutral-500">
                Generate a PRD or build downstream artifacts and Synapse will record real orchestration
                telemetry here — runtime, parallel speedup, concurrency, tokens, and estimated cost per run.
            </p>
        </div>
    );
}
