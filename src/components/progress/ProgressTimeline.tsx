import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, ChevronRight, Check, CheckCircle2 } from 'lucide-react';
import { useIsMobile } from '../../lib/useIsMobile';
import type { GenerationStep, GenerationStepStatus } from './types';
import { summarizeSteps } from './buildGenerationSteps';
import { TimelineStep } from './TimelineStep';
import { ConcurrentGroup } from './ConcurrentGroup';

export type ProgressTimelineProps = {
    steps: GenerationStep[];
    /** Raw progress message log (oldest first) for the inline History view. */
    messages?: string[];
    onRetryStep?: (sectionId: string) => void;
    retryingStepId?: string;
    onViewHistory?: () => void;
    title?: string;
};

const STATUS_PILL: Record<GenerationStepStatus, { label: string; cls: string }> = {
    in_progress: { label: 'In progress', cls: 'bg-indigo-50 text-indigo-700' },
    completed: { label: 'Completed', cls: 'bg-green-50 text-green-700' },
    failed: { label: 'Failed', cls: 'bg-red-50 text-red-700' },
    queued: { label: 'Queued', cls: 'bg-amber-50 text-amber-700' },
    pending: { label: 'Pending', cls: 'bg-neutral-100 text-neutral-600' },
};

const hasActiveStep = (steps: GenerationStep[]): boolean =>
    steps.some((s) =>
        s.children?.length
            ? s.children.some((c) => c.status === 'in_progress')
            : s.status === 'in_progress',
    );

export function ProgressTimeline({
    steps,
    messages,
    onRetryStep,
    retryingStepId,
    onViewHistory,
    title = 'PRD Generation',
}: ProgressTimelineProps) {
    const isMobile = useIsMobile();
    const isDesktop = !isMobile;
    const [collapsed, setCollapsed] = useState(false);
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
    const [tab, setTab] = useState<'current' | 'history'>('current');
    const [now, setNow] = useState(() => Date.now());

    const active = hasActiveStep(steps);

    // Live elapsed ticker — only runs while a step is in progress.
    useEffect(() => {
        if (!active) return;
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, [active]);

    const summary = useMemo(() => summarizeSteps(steps), [steps]);

    // Inject live elapsed seconds into in-progress leaves.
    const displaySteps = useMemo(() => {
        const withElapsed = (s: GenerationStep): GenerationStep =>
            s.status === 'in_progress' && s.startedAt
                ? { ...s, elapsedSeconds: Math.max(0, (now - s.startedAt) / 1000) }
                : s;
        return steps.map((s) =>
            s.children?.length ? { ...s, children: s.children.map(withElapsed) } : withElapsed(s),
        );
    }, [steps, now]);

    const toggle = (id: string) =>
        setExpandedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });

    const pill = STATUS_PILL[summary.status];

    const renderTimeline = () => (
        <div className="mt-4">
            {displaySteps.map((step, i) => {
                const isLast = i === displaySteps.length - 1;
                return step.children?.length ? (
                    <ConcurrentGroup
                        key={step.id}
                        group={step}
                        isDesktop={isDesktop}
                        expandedIds={expandedIds}
                        onToggle={toggle}
                        onRetry={onRetryStep}
                        retryingStepId={retryingStepId}
                        isLast={isLast}
                    />
                ) : (
                    <TimelineStep
                        key={step.id}
                        step={step}
                        isDesktop={isDesktop}
                        expanded={expandedIds.has(step.id)}
                        onToggle={() => toggle(step.id)}
                        onRetry={onRetryStep}
                        retrying={retryingStepId === step.sectionId}
                        isLast={isLast}
                    />
                );
            })}
        </div>
    );

    const renderHistory = () => (
        <div className="mt-4 space-y-1.5">
            {(!messages || messages.length === 0) && (
                <p className="text-sm text-neutral-400">No activity yet.</p>
            )}
            {messages?.map((m, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-neutral-600">
                    <Check size={13} className="text-neutral-300 mt-0.5 shrink-0" />
                    <span className="break-words">{m}</span>
                </div>
            ))}
        </div>
    );

    return (
        <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm p-4 sm:p-5">
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-lg font-bold text-neutral-900">{title}</h2>
                        <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${pill.cls}`}>
                            {summary.status === 'in_progress' && (
                                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
                            )}
                            {pill.label}
                        </span>
                    </div>
                    <p className="text-sm text-neutral-500 mt-0.5">
                        {summary.completed} of {summary.total} steps completed
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => setCollapsed((c) => !c)}
                    aria-label={collapsed ? 'Expand' : 'Collapse'}
                    className="shrink-0 rounded-lg border border-neutral-200 text-neutral-500 hover:bg-neutral-50 p-1.5 transition"
                >
                    {collapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                </button>
            </div>

            {/* Progress bar */}
            <div className="flex items-center gap-3 mt-3">
                <div className="flex-1 h-2 rounded-full bg-neutral-100 overflow-hidden">
                    <div
                        className={`h-full rounded-full transition-all duration-700 ${summary.status === 'failed' ? 'bg-red-400' : 'bg-indigo-600'}`}
                        style={{ width: `${summary.percent}%` }}
                    />
                </div>
                <span className="text-sm font-semibold text-neutral-700 tabular-nums shrink-0">
                    {summary.percent}%
                </span>
            </div>

            {!collapsed && (
                <>
                    {/* Desktop inline tabs */}
                    {isDesktop && (
                        <div className="flex items-center gap-1 mt-4 border-b border-neutral-100">
                            {(['current', 'history'] as const).map((t) => (
                                <button
                                    key={t}
                                    type="button"
                                    onClick={() => setTab(t)}
                                    className={`text-sm font-medium px-3 py-1.5 -mb-px border-b-2 transition ${tab === t ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-neutral-500 hover:text-neutral-700'}`}
                                >
                                    {t === 'current' ? 'Current Run' : 'History'}
                                </button>
                            ))}
                        </div>
                    )}

                    {isDesktop && tab === 'history' ? renderHistory() : renderTimeline()}

                    {/* Footer */}
                    <div className="flex items-center justify-between mt-5 pt-3 border-t border-neutral-100">
                        <button
                            type="button"
                            onClick={onViewHistory}
                            className="inline-flex items-center gap-1 text-sm font-medium text-neutral-600 hover:text-neutral-900 transition"
                        >
                            View full history
                            <ChevronRight size={15} />
                        </button>
                        <span className="inline-flex items-center gap-1.5 text-xs text-neutral-400">
                            Auto-save on
                            <CheckCircle2 size={14} className="text-green-500" />
                        </span>
                    </div>
                </>
            )}
        </div>
    );
}
