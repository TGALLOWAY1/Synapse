import { AlertCircle, GitBranch, ListChecks, Server, Sparkles, Target, Zap } from 'lucide-react';
import type { ParsedFlow } from './types';
import { inlineMd } from './markdown';

interface Props {
    flow: ParsedFlow;
    index: number;
}

function inferTimeToValue(flow: ParsedFlow): string | null {
    const sources = [flow.goal, flow.successOutcome, flow.preconditions, ...flow.steps.map(s => s.rawText)]
        .filter((s): s is string => Boolean(s))
        .join('\n');
    const m = sources.match(/<\s*(\d+(?:\.\d+)?)\s*(s|sec|seconds|m|min|minutes|h|hr|hours)\b/i)
        ?? sources.match(/\b(\d+(?:\.\d+)?)\s*(s|sec|seconds|m|min|minutes|h|hr|hours)\b/i);
    if (!m) return null;
    return `< ${m[1]}${m[2]}`;
}

export function FlowSummaryCard({ flow, index }: Props) {
    const errorCount = flow.errorPaths.length;
    const stepCount = flow.steps.length;
    const ttv = inferTimeToValue(flow);

    return (
        <section className="bg-white rounded-xl border border-neutral-200 p-5 mb-4">
            <header className="flex items-start gap-3 pb-3 mb-3 border-b border-neutral-100">
                <div className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-md bg-indigo-50 text-indigo-600">
                    <GitBranch size={16} />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-indigo-600">
                            Flow {index + 1}
                        </p>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-neutral-100 text-neutral-600 font-medium">
                            {flow.category}
                        </span>
                    </div>
                    <h3 className="text-base font-bold text-neutral-900 leading-snug mt-0.5">
                        {flow.title}
                    </h3>
                </div>
            </header>

            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                {flow.goal && (
                    <div className="flex items-start gap-2 sm:col-span-2">
                        <Target size={14} className="shrink-0 mt-0.5 text-emerald-600" />
                        <div className="min-w-0">
                            <dt className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                                Goal
                            </dt>
                            <dd className="text-neutral-800">{inlineMd(flow.goal)}</dd>
                        </div>
                    </div>
                )}
                {flow.preconditions && (
                    <div>
                        <dt className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                            Preconditions
                        </dt>
                        <dd className="text-neutral-700">{inlineMd(flow.preconditions)}</dd>
                    </div>
                )}
                {flow.inferredEntryPoints.length > 0 && (
                    <div>
                        <dt className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                            Entry points
                        </dt>
                        <dd className="text-neutral-700">
                            <ul className="list-disc list-inside">
                                {flow.inferredEntryPoints.slice(0, 4).map((ep, i) => (
                                    <li key={i}>{inlineMd(ep)}</li>
                                ))}
                            </ul>
                        </dd>
                    </div>
                )}
                {flow.inferredSystems.length > 0 && (
                    <div className="sm:col-span-2">
                        <dt className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 flex items-center gap-1">
                            <Server size={11} /> Core systems / dependencies
                        </dt>
                        <dd className="mt-1 flex flex-wrap gap-1">
                            {flow.inferredSystems.map((s, i) => (
                                <code
                                    key={i}
                                    className="text-[11px] bg-neutral-100 text-neutral-800 px-1.5 py-0.5 rounded"
                                >
                                    {s}
                                </code>
                            ))}
                        </dd>
                    </div>
                )}
                {flow.successOutcome && (
                    <div className="flex items-start gap-2 sm:col-span-2">
                        <Sparkles size={14} className="shrink-0 mt-0.5 text-emerald-600" />
                        <div className="min-w-0">
                            <dt className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                                Success outcome
                            </dt>
                            <dd className="text-neutral-800">{inlineMd(flow.successOutcome)}</dd>
                        </div>
                    </div>
                )}
            </dl>

            <div className="flex flex-wrap gap-3 mt-4 pt-3 border-t border-neutral-100 text-xs">
                <span className="inline-flex items-center gap-1 text-neutral-600">
                    <ListChecks size={12} />
                    <strong className="font-semibold text-neutral-800">{stepCount}</strong> steps
                </span>
                <span className="inline-flex items-center gap-1 text-neutral-600">
                    <AlertCircle size={12} className={errorCount > 0 ? 'text-red-500' : ''} />
                    <strong className={`font-semibold ${errorCount > 0 ? 'text-red-700' : 'text-neutral-800'}`}>
                        {errorCount}
                    </strong>{' '}
                    error paths
                </span>
                {ttv && (
                    <span className="inline-flex items-center gap-1 text-neutral-600">
                        <Zap size={12} className="text-amber-500" />
                        <strong className="font-semibold text-neutral-800">{ttv}</strong> to value
                    </span>
                )}
            </div>
        </section>
    );
}
