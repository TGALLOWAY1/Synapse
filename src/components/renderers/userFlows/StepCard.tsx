import { type ReactNode } from 'react';
import { AlertTriangle, Code, GitBranch as DecisionIcon } from 'lucide-react';
import type { Feature } from '../../../types';
import type { FeatureRef, FlowIssue, ParsedStep } from './types';
import { ISSUE_KIND_META } from './issueMeta';
import { inlineWithFeatures } from './inlineWithFeatures';
import { inlineMd } from './markdown';

/** Strip surrounding markdown code backticks from a short label (e.g. a
 * screen name like `` `Import Dashboard` `` → "Import Dashboard"). */
function stripBackticks(text: string): string {
    return text.replace(/^`+|`+$/g, '').trim();
}

interface Props {
    flowIndex: number;
    step: ParsedStep;
    /** Issues linked to this specific step. */
    inlineIssues: FlowIssue[];
    featuresById?: Map<string, Feature>;
    onSelectFeature: (refToken: FeatureRef) => void;
}

function FieldRow({
    label, tone, children,
}: { label: string; tone: 'indigo' | 'neutral'; children: ReactNode }) {
    const labelColor = tone === 'indigo' ? 'text-indigo-600' : 'text-neutral-500';
    return (
        <div>
            <dt className={`text-[10px] font-semibold uppercase tracking-wider ${labelColor}`}>
                {label}
            </dt>
            <dd className="text-neutral-800 mt-0.5">{children}</dd>
        </div>
    );
}

export function StepCard({
    flowIndex, step, inlineIssues, featuresById, onSelectFeature,
}: Props) {
    const hasStructured = Boolean(
        step.title || step.userAction || step.systemBehavior || step.uiFeedback
            || step.decisions.length > 0 || step.apiRefs.length > 0
    );

    const renderText = (text: string) =>
        inlineWithFeatures(text, { featuresById, onSelectFeature });

    return (
        <article
            id={`flow-${flowIndex}-step-${step.index}`}
            className="bg-white rounded-xl border border-neutral-200 p-4 mb-3 scroll-mt-24"
        >
            {/* Number badge inline with the step name, so it reads like
                "1. Daily Review Dashboard" instead of a floated left column. */}
            <div className="flex items-center gap-2.5">
                <span className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold">
                    {step.index + 1}
                </span>
                {hasStructured ? (
                    step.title ? (
                        <h4 className="min-w-0 flex-1 text-sm font-semibold text-neutral-900 leading-snug">
                            {inlineMd(stripBackticks(step.title))}
                        </h4>
                    ) : (
                        <h4 className="min-w-0 flex-1 text-sm font-semibold text-neutral-400 leading-snug">
                            Step {step.index + 1}
                        </h4>
                    )
                ) : (
                    <div className="min-w-0 flex-1 text-sm text-neutral-800 leading-snug">
                        {renderText(step.rawText)}
                    </div>
                )}
            </div>

            {/* Body runs flush to the card edge — no left gutter. */}
            {hasStructured && (step.userAction || step.systemBehavior || step.uiFeedback) && (
                <dl className="mt-3 space-y-2.5 text-sm">
                    {step.userAction && (
                        <FieldRow label="User" tone="indigo">
                            {renderText(step.userAction)}
                        </FieldRow>
                    )}
                    {step.systemBehavior && (
                        <FieldRow label="System" tone="neutral">
                            {renderText(step.systemBehavior)}
                        </FieldRow>
                    )}
                    {step.uiFeedback && (
                        <FieldRow label="UI" tone="neutral">
                            {renderText(step.uiFeedback)}
                        </FieldRow>
                    )}
                </dl>
            )}

            {/* Quiet inline "Uses:" reference instead of a row of large colored
                chips — the same features are shown prominently elsewhere
                (flow header summary + Related Artifacts). Each name stays
                clickable to open the feature drawer. */}
            {step.featureRefs.length > 0 && (
                <p className="mt-3 text-[11px] text-neutral-500 leading-relaxed">
                    <span className="font-medium text-neutral-400 uppercase tracking-wider mr-1">Uses</span>
                    {step.featureRefs.map((ref, i) => {
                        const feature = featuresById?.get(ref.id);
                        const label = feature?.name ?? feature?.id ?? ref.id.toUpperCase();
                        return (
                            <span key={ref.id}>
                                {i > 0 && <span className="text-neutral-300">, </span>}
                                <button
                                    type="button"
                                    onClick={() => onSelectFeature(ref)}
                                    className="text-neutral-600 hover:text-fuchsia-700 hover:underline transition-colors"
                                >
                                    {label}
                                </button>
                            </span>
                        );
                    })}
                </p>
            )}

            {step.decisions.length > 0 && (
                <div className="mt-3 px-3 py-2 rounded-md bg-amber-50 border border-amber-200">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700 flex items-center gap-1 mb-1">
                        <DecisionIcon size={11} /> Decisions
                    </p>
                    <ul className="space-y-1 text-xs text-amber-900">
                        {step.decisions.map((d, i) => (
                            <li key={i} className="flex gap-2">
                                <span className="text-amber-400">•</span>
                                <span className="min-w-0 flex-1">{renderText(d)}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {step.apiRefs.length > 0 && (
                <div className="mt-3 px-3 py-2 rounded-md bg-neutral-50 border border-neutral-200">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-600 flex items-center gap-1 mb-1">
                        <Code size={11} /> APIs / services
                    </p>
                    <div className="flex flex-wrap gap-1">
                        {step.apiRefs.map((ref, i) => (
                            <code
                                key={i}
                                className="text-[11px] bg-white border border-neutral-200 text-neutral-800 px-1.5 py-0.5 rounded"
                            >
                                {stripBackticks(ref)}
                            </code>
                        ))}
                    </div>
                </div>
            )}

            {inlineIssues.length > 0 && (
                <div className="mt-3 px-3 py-2 rounded-md bg-amber-50/60 border border-amber-200">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-800 flex items-center gap-1 mb-1.5">
                        <AlertTriangle size={11} /> Branches & exceptions
                    </p>
                    <ul className="space-y-1.5 text-xs text-neutral-800">
                        {inlineIssues.map((issue, i) => {
                            const meta = ISSUE_KIND_META[issue.kind];
                            return (
                                <li key={i} className="flex gap-2">
                                    <span
                                        className={`shrink-0 self-start text-[9px] font-semibold uppercase tracking-wider px-1 py-0.5 rounded ${meta.badgeBg} ${meta.badgeText} mt-0.5`}
                                        title={meta.label}
                                    >
                                        {meta.shortLabel}
                                    </span>
                                    <span className="min-w-0 flex-1">{renderText(issue.text)}</span>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}
        </article>
    );
}
