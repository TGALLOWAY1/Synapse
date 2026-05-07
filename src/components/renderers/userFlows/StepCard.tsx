import { AlertTriangle, Code, GitBranch as DecisionIcon } from 'lucide-react';
import type { ParsedErrorPath, ParsedStep, ViewMode } from './types';
import { inlineMd } from './markdown';

interface Props {
    flowIndex: number;
    step: ParsedStep;
    inlineErrors: ParsedErrorPath[];
    viewMode: ViewMode;
}

export function StepCard({ flowIndex, step, inlineErrors, viewMode }: Props) {
    const debug = viewMode === 'debug';
    const hasStructured = Boolean(
        step.title || step.userAction || step.systemBehavior || step.uiFeedback
            || step.decisions.length > 0 || step.apiRefs.length > 0
    );

    return (
        <article
            id={`flow-${flowIndex}-step-${step.index}`}
            className="bg-white rounded-xl border border-neutral-200 p-4 mb-3 scroll-mt-24"
        >
            <div className="flex gap-3">
                <span className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold">
                    {step.index + 1}
                </span>
                <div className="flex-1 min-w-0">
                    {hasStructured ? (
                        <>
                            {step.title && (
                                <h4 className="text-sm font-semibold text-neutral-900 leading-snug">
                                    {step.title}
                                </h4>
                            )}
                            {(step.userAction || step.systemBehavior || step.uiFeedback) && (
                                <dl className="mt-2 space-y-1 text-sm">
                                    {step.userAction && (
                                        <div className="flex gap-2">
                                            <dt className="shrink-0 w-16 text-[10px] font-semibold uppercase tracking-wider text-indigo-600 mt-0.5">
                                                User
                                            </dt>
                                            <dd className="text-neutral-800 min-w-0">
                                                {inlineMd(step.userAction)}
                                            </dd>
                                        </div>
                                    )}
                                    {step.systemBehavior && (
                                        <div className="flex gap-2">
                                            <dt className="shrink-0 w-16 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mt-0.5">
                                                System
                                            </dt>
                                            <dd className="text-neutral-700 min-w-0">
                                                {inlineMd(step.systemBehavior)}
                                            </dd>
                                        </div>
                                    )}
                                    {step.uiFeedback && (
                                        <div className="flex gap-2">
                                            <dt className="shrink-0 w-16 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mt-0.5">
                                                UI
                                            </dt>
                                            <dd className="text-neutral-700 min-w-0">
                                                {inlineMd(step.uiFeedback)}
                                            </dd>
                                        </div>
                                    )}
                                </dl>
                            )}
                        </>
                    ) : (
                        <div className="text-sm text-neutral-800 leading-snug">
                            {inlineMd(step.rawText)}
                        </div>
                    )}

                    {step.decisions.length > 0 && (
                        <div
                            className={`mt-3 px-3 py-2 rounded-md border ${
                                debug
                                    ? 'bg-amber-50 border-amber-200'
                                    : 'bg-neutral-50 border-neutral-200'
                            }`}
                        >
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700 flex items-center gap-1 mb-1">
                                <DecisionIcon size={11} /> Decisions
                            </p>
                            <ul className="space-y-1 text-xs text-neutral-800">
                                {step.decisions.map((d, i) => (
                                    <li key={i}>{inlineMd(d)}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {step.apiRefs.length > 0 && (
                        <div
                            className={`mt-3 px-3 py-2 rounded-md border ${
                                debug
                                    ? 'bg-indigo-50 border-indigo-200'
                                    : 'bg-neutral-50 border-neutral-200'
                            }`}
                        >
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-700 flex items-center gap-1 mb-1">
                                <Code size={11} /> APIs / services
                            </p>
                            <div className="flex flex-wrap gap-1">
                                {step.apiRefs.map((ref, i) => (
                                    <code
                                        key={i}
                                        className="text-[11px] bg-white border border-neutral-200 text-neutral-800 px-1.5 py-0.5 rounded"
                                    >
                                        {ref}
                                    </code>
                                ))}
                            </div>
                        </div>
                    )}

                    {(inlineErrors.length > 0 || step.errorRefs.length > 0) && (
                        <div className="mt-3 px-3 py-2 rounded-md bg-red-50 border border-red-200">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-red-700 flex items-center gap-1 mb-1">
                                <AlertTriangle size={11} /> Errors / fallbacks
                            </p>
                            <ul className="space-y-1 text-xs text-red-900">
                                {step.errorRefs.map((e, i) => (
                                    <li key={`local-${i}`}>{inlineMd(e)}</li>
                                ))}
                                {inlineErrors.map((e, i) => (
                                    <li key={`linked-${i}`}>
                                        {inlineMd(e.text)}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            </div>
        </article>
    );
}
