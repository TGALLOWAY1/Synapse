import { Check, X, RefreshCcw, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import type { GenerationStep, GenerationStepStatus } from './types';

const roundEst = (s?: number) => (s == null ? null : `~${Math.round(s)}s`);
const fixed = (s?: number) => (s == null ? null : `${s.toFixed(1)}s`);

// ─── Status icon ─────────────────────────────────────────────────────────────

export function StatusIcon({ status, size = 'md' }: { status: GenerationStepStatus; size?: 'sm' | 'md' }) {
    const dim = size === 'sm' ? 'w-5 h-5' : 'w-6 h-6';
    const icon = size === 'sm' ? 11 : 13;
    if (status === 'completed') {
        return (
            <span className={`${dim} shrink-0 rounded-full bg-indigo-600 text-white flex items-center justify-center`}>
                <Check size={icon} strokeWidth={3} />
            </span>
        );
    }
    if (status === 'failed') {
        return (
            <span className={`${dim} shrink-0 rounded-full bg-red-500 text-white flex items-center justify-center`}>
                <X size={icon} strokeWidth={3} />
            </span>
        );
    }
    if (status === 'in_progress') {
        return (
            <span className={`${dim} shrink-0 rounded-full border-2 border-indigo-500 flex items-center justify-center`}>
                <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
            </span>
        );
    }
    if (status === 'queued') {
        // Dependencies satisfied, waiting for a free slot — distinct from the
        // plain "pending (waiting on deps)" ring.
        return (
            <span className={`${dim} shrink-0 rounded-full border-2 border-amber-400 flex items-center justify-center`}>
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            </span>
        );
    }
    return <span className={`${dim} shrink-0 rounded-full border-2 border-neutral-300 bg-white`} />;
}

// ─── Model chip ──────────────────────────────────────────────────────────────

export function ModelChip({ model }: { model: string }) {
    if (!model) return null;
    return (
        <span className="inline-flex items-center gap-1 rounded-md bg-indigo-50 text-indigo-700 text-xs font-medium px-2 py-0.5 max-w-full min-w-0">
            <Sparkles size={11} className="shrink-0" />
            <span className="truncate">{model}</span>
        </span>
    );
}

// ─── Time / status block ─────────────────────────────────────────────────────

function TimeBlock({ step }: { step: GenerationStep }) {
    const lines: Array<{ text: string; cls?: string }> = [];
    if (step.status === 'completed') {
        const a = fixed(step.actualSeconds);
        if (a) lines.push({ text: `Actual: ${a}` });
    } else if (step.status === 'in_progress') {
        lines.push({ text: 'In progress', cls: 'text-indigo-600 font-medium' });
        const est = roundEst(step.estimatedSeconds);
        if (est) lines.push({ text: `Est. ${est}`, cls: 'text-neutral-400' });
        if (step.elapsedSeconds != null) {
            lines.push({ text: `Elapsed: ${Math.round(step.elapsedSeconds)}s`, cls: 'text-neutral-500' });
        }
    } else if (step.status === 'failed') {
        lines.push({ text: 'Failed', cls: 'text-red-600 font-medium' });
        const est = roundEst(step.estimatedSeconds);
        if (est) lines.push({ text: `Est. ${est}`, cls: 'text-neutral-400' });
        const a = fixed(step.actualSeconds);
        if (a) lines.push({ text: `Actual: ${a}`, cls: 'text-neutral-500' });
    } else if (step.status === 'queued') {
        lines.push({ text: 'Queued', cls: 'text-amber-600 font-medium' });
        const est = roundEst(step.estimatedSeconds);
        if (est) lines.push({ text: `Est. ${est}`, cls: 'text-neutral-400' });
    } else {
        lines.push({ text: 'Waiting', cls: 'text-neutral-400' });
        const est = roundEst(step.estimatedSeconds);
        if (est) lines.push({ text: `Est. ${est}`, cls: 'text-neutral-400' });
    }
    return (
        <div className="text-right text-xs leading-tight shrink-0 min-w-[72px]">
            {lines.map((l, i) => (
                <div key={i} className={l.cls ?? 'text-neutral-600'}>{l.text}</div>
            ))}
        </div>
    );
}

// ─── Step body (shared by sequential rows and concurrent children) ───────────

export function StepBody({
    step,
    isDesktop,
    expanded,
    onToggle,
    onRetry,
    retrying,
}: {
    step: GenerationStep;
    isDesktop: boolean;
    expanded: boolean;
    onToggle: () => void;
    onRetry?: (sectionId: string) => void;
    retrying?: boolean;
}) {
    // Failed steps stay expanded so the error + retry are always discoverable.
    const showDetails = isDesktop || expanded || step.status === 'failed';
    const canToggle = !isDesktop && step.status !== 'failed';

    return (
        <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-neutral-800">
                            <span className="text-neutral-400 font-medium mr-1.5">{step.label}.</span>
                            {step.title}
                        </span>
                        {step.retryCount != null && step.retryCount > 0 && (
                            <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-700 text-[10px] font-semibold px-1.5 py-0.5">
                                Retried ×{step.retryCount}
                            </span>
                        )}
                    </div>
                    {showDetails && step.description && (
                        <p className="text-xs text-neutral-500 mt-0.5">{step.description}</p>
                    )}
                    {(step.status === 'pending' || step.status === 'queued') && step.dependsOn && step.dependsOn.length > 0 && (
                        <p className="text-xs text-neutral-400 mt-0.5 break-words">
                            {step.status === 'queued' ? 'Ready — waiting for a slot' : `Waits on: ${step.dependsOn.join(', ')}`}
                        </p>
                    )}
                    <div className="mt-1.5 min-w-0">
                        <ModelChip model={step.modelName} />
                    </div>
                </div>
                <div className="flex items-start gap-1.5">
                    <TimeBlock step={step} />
                    {canToggle && (
                        <button
                            type="button"
                            onClick={onToggle}
                            aria-label={expanded ? 'Collapse step' : 'Expand step'}
                            className="text-neutral-400 hover:text-neutral-600 p-0.5 shrink-0"
                        >
                            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </button>
                    )}
                </div>
            </div>

            {step.status === 'failed' && (
                <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                    {step.errorMessage && (
                        <p className="text-xs text-red-700 break-words mb-2">{step.errorMessage}</p>
                    )}
                    {step.canRetry && step.sectionId && onRetry && (
                        <button
                            type="button"
                            onClick={() => onRetry(step.sectionId!)}
                            disabled={retrying}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 text-red-600 hover:bg-red-100 text-sm font-medium px-3 py-1.5 transition disabled:opacity-50"
                        >
                            <RefreshCcw size={14} className={retrying ? 'animate-spin' : ''} />
                            {retrying ? 'Retrying…' : 'Run again'}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

// ─── Top-level sequential timeline row ───────────────────────────────────────

export function TimelineStep({
    step,
    isDesktop,
    expanded,
    onToggle,
    onRetry,
    retrying,
    isLast,
}: {
    step: GenerationStep;
    isDesktop: boolean;
    expanded: boolean;
    onToggle: () => void;
    onRetry?: (sectionId: string) => void;
    retrying?: boolean;
    isLast?: boolean;
}) {
    return (
        <div className="flex gap-3">
            <div className="flex flex-col items-center shrink-0">
                <StatusIcon status={step.status} />
                {!isLast && <span className="w-px flex-1 bg-neutral-200 mt-1" />}
            </div>
            <div className={isLast ? 'pb-0 flex-1 min-w-0' : 'pb-5 flex-1 min-w-0'}>
                <StepBody
                    step={step}
                    isDesktop={isDesktop}
                    expanded={expanded}
                    onToggle={onToggle}
                    onRetry={onRetry}
                    retrying={retrying}
                />
            </div>
        </div>
    );
}
