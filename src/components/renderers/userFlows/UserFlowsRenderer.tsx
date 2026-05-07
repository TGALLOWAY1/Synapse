import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AlertCircle } from 'lucide-react';
import { parseFlows } from './parseFlow';
import type { ParsedErrorPath, ViewMode } from './types';
import { FlowSidebar } from './FlowSidebar';
import { FlowSummaryCard } from './FlowSummaryCard';
import { FlowDiagram } from './FlowDiagram';
import { StepCard } from './StepCard';
import { SuccessCriteriaBlock } from './SuccessCriteriaBlock';
import { EdgeCasesAccordion } from './EdgeCasesAccordion';
import { blockMd, inlineMd } from './markdown';

interface Props {
    content: string;
}

const VIEW_MODES: Array<{ id: ViewMode; label: string }> = [
    { id: 'summary', label: 'Summary' },
    { id: 'detailed', label: 'Detailed' },
    { id: 'debug', label: 'Debug / QA' },
];

export function UserFlowsRenderer({ content }: Props) {
    const flows = useMemo(() => parseFlows(content), [content]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [viewMode, setViewMode] = useState<ViewMode>('detailed');
    const [mobileNavOpen, setMobileNavOpen] = useState(false);

    if (flows.length === 0) {
        return (
            <div className="prose prose-sm prose-neutral max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
        );
    }

    const safeIndex = Math.min(selectedIndex, flows.length - 1);
    const flow = flows[safeIndex];

    const inlineErrorByStep = new Map<number, ParsedErrorPath[]>();
    const globalErrors: ParsedErrorPath[] = [];
    for (const e of flow.errorPaths) {
        if (typeof e.linkedStepIndex === 'number') {
            const list = inlineErrorByStep.get(e.linkedStepIndex) ?? [];
            list.push(e);
            inlineErrorByStep.set(e.linkedStepIndex, list);
        } else {
            globalErrors.push(e);
        }
    }

    const showSteps = viewMode !== 'summary';
    const showEdgeCases = viewMode !== 'summary';
    const showGlobalErrors = viewMode !== 'summary' && globalErrors.length > 0;

    return (
        <div className="flex gap-5 items-start">
            <FlowSidebar
                flows={flows}
                selectedIndex={safeIndex}
                onSelect={setSelectedIndex}
                isMobileOpen={mobileNavOpen}
                onToggleMobile={setMobileNavOpen}
            />
            <div className="flex-1 min-w-0">
                <div className="flex items-center justify-end gap-1 mb-3">
                    <div
                        role="tablist"
                        aria-label="View mode"
                        className="inline-flex rounded-md bg-neutral-100 p-0.5"
                    >
                        {VIEW_MODES.map(m => {
                            const active = m.id === viewMode;
                            return (
                                <button
                                    key={m.id}
                                    type="button"
                                    role="tab"
                                    aria-selected={active}
                                    onClick={() => setViewMode(m.id)}
                                    className={`px-2.5 py-1 text-xs font-medium rounded transition ${
                                        active
                                            ? 'bg-white text-indigo-700 shadow-sm'
                                            : 'text-neutral-600 hover:text-neutral-900'
                                    }`}
                                >
                                    {m.label}
                                </button>
                            );
                        })}
                    </div>
                </div>

                <FlowSummaryCard flow={flow} index={safeIndex} />
                <FlowDiagram flowIndex={safeIndex} steps={flow.steps} />
                <SuccessCriteriaBlock flow={flow} />

                {showSteps && flow.steps.length > 0 && (
                    <section className="mb-4">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-2">
                            Steps
                        </p>
                        {flow.steps.map(step => (
                            <StepCard
                                key={step.index}
                                flowIndex={safeIndex}
                                step={step}
                                inlineErrors={inlineErrorByStep.get(step.index) ?? []}
                                viewMode={viewMode}
                            />
                        ))}
                    </section>
                )}

                {showSteps && flow.steps.length === 0 && flow.rest && (
                    <section className="bg-white rounded-xl border border-neutral-200 p-4 mb-4">
                        {blockMd(flow.rest)}
                    </section>
                )}

                {showGlobalErrors && (
                    <section className="bg-red-50/60 border border-red-100 rounded-xl p-4 mb-4">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-red-700 flex items-center gap-1 mb-2">
                            <AlertCircle size={11} /> General error paths
                        </p>
                        <ul className="space-y-1 text-sm text-red-900">
                            {globalErrors.map((e, i) => (
                                <li key={i} className="flex gap-2">
                                    <span className="text-red-400">•</span>
                                    <div className="min-w-0 flex-1">{inlineMd(e.text)}</div>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                {showEdgeCases && (
                    <EdgeCasesAccordion edgeCases={flow.edgeCases} viewMode={viewMode} />
                )}
            </div>
        </div>
    );
}
