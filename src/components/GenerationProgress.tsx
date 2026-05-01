import { useState, useEffect, useRef } from 'react';
import { Check } from 'lucide-react';
import type { ProgressStage } from './generationStages';

interface GenerationProgressProps {
    /** Ordered stages to cycle through */
    stages: ProgressStage[];
    /** Visual variant to match context */
    variant?: 'default' | 'foundation' | 'creative' | 'systematic' | 'precise';
    /** Optional header text */
    title?: string;
    /** Optional subtitle for context */
    subtitle?: string;
    /** Compact inline mode (no card wrapper) */
    inline?: boolean;
    /**
     * 0-100 real completion percent. When provided, the component is
     * state-driven: the bar width tracks this value directly and the
     * timer-based stage rotation is disabled.
     */
    progress?: number;
    /**
     * Live status string shown instead of the rotating stage label when
     * the component is state-driven (paired with `progress`).
     */
    statusLabel?: string;
    /**
     * Real progress events emitted by the operation, oldest first. When
     * non-empty, the panel renders an accumulating list (✓ for past entries,
     * pulsing dot for the active one) instead of cycling stage labels.
     */
    history?: string[];
}

const VISIBLE_HISTORY_CAP = 8;

const VARIANT_STYLES = {
    default: {
        accent: 'text-indigo-600',
        accentBg: 'bg-indigo-50',
        barColor: 'bg-indigo-500',
        dotColor: 'bg-indigo-400',
        borderColor: 'border-indigo-100',
    },
    foundation: {
        accent: 'text-indigo-700',
        accentBg: 'bg-indigo-50',
        barColor: 'bg-indigo-600',
        dotColor: 'bg-indigo-500',
        borderColor: 'border-indigo-100',
    },
    creative: {
        accent: 'text-violet-600',
        accentBg: 'bg-violet-50',
        barColor: 'bg-violet-500',
        dotColor: 'bg-violet-400',
        borderColor: 'border-violet-100',
    },
    systematic: {
        accent: 'text-sky-600',
        accentBg: 'bg-sky-50',
        barColor: 'bg-sky-500',
        dotColor: 'bg-sky-400',
        borderColor: 'border-sky-100',
    },
    precise: {
        accent: 'text-emerald-600',
        accentBg: 'bg-emerald-50',
        barColor: 'bg-emerald-500',
        dotColor: 'bg-emerald-400',
        borderColor: 'border-emerald-100',
    },
};

/** Minimum time per stage when no explicit duration is set */
const DEFAULT_MIN_DURATION = 3000;

/**
 * Staged progress indicator for long-running generation operations.
 *
 * Mount this component when generation starts and unmount when it completes.
 * State resets automatically on mount.
 */
export function GenerationProgress({
    stages,
    variant = 'default',
    title,
    subtitle,
    inline = false,
    progress,
    statusLabel,
    history,
}: GenerationProgressProps) {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isFading, setIsFading] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const style = VARIANT_STYLES[variant];
    const isStateDriven = typeof progress === 'number';
    const hasHistory = !!history && history.length > 0;

    useEffect(() => {
        // When a real progress value is supplied skip time-based advancement —
        // the parent owns stage progression. History is allowed to drive the
        // event list AND let the timer advance the stage label, so users see
        // both the curated stage label and the live stream of progress.
        if (isStateDriven) return;
        if (stages.length === 0) return;

        const advance = () => {
            setIsFading(true);
            timerRef.current = setTimeout(() => {
                setCurrentIndex((prev) => {
                    const next = prev + 1;
                    return next < stages.length ? next : prev;
                });
                setIsFading(false);
            }, 300);
        };

        const duration = stages[currentIndex]?.minDuration ?? DEFAULT_MIN_DURATION;
        const id = setTimeout(advance, duration);

        return () => {
            clearTimeout(id);
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [currentIndex, stages, isStateDriven, hasHistory]);

    if (stages.length === 0 && !hasHistory) return null;

    // Clamp/derive values for state-driven mode
    const clampedProgress = isStateDriven ? Math.max(0, Math.min(100, progress!)) : 0;
    const activeDotIndex = isStateDriven
        ? Math.min(
              stages.length - 1,
              Math.floor((clampedProgress / 100) * stages.length),
          )
        : currentIndex;

    const currentLabel = isStateDriven
        ? (statusLabel ?? stages[activeDotIndex]?.label ?? stages[stages.length - 1]?.label)
        : (stages[currentIndex]?.label ?? stages[stages.length - 1]?.label);

    const barWidthPct = isStateDriven
        ? clampedProgress
        : Math.min(((currentIndex + 1) / stages.length) * 100, 95);

    // Dedupe consecutive identical entries (chunk-rate progress messages can
    // round to the same string) and trim to the last N for display.
    const dedupedHistory = hasHistory
        ? history!.filter((msg, i, arr) => i === 0 || arr[i - 1] !== msg)
        : [];
    const visibleHistory = dedupedHistory.slice(-VISIBLE_HISTORY_CAP);
    const hiddenCount = dedupedHistory.length - visibleHistory.length;

    if (inline) {
        const inlineLabel = hasHistory && dedupedHistory.length > 0
            ? `${currentLabel} — ${dedupedHistory[dedupedHistory.length - 1]}`
            : currentLabel;
        return (
            <div className="flex items-center gap-3">
                <span className="relative flex h-2 w-2">
                    <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${style.dotColor} opacity-75`} />
                    <span className={`relative inline-flex rounded-full h-2 w-2 ${style.dotColor}`} />
                </span>
                <span
                    className={`text-sm ${style.accent} transition-opacity duration-300 ${isFading ? 'opacity-0' : 'opacity-100'}`}
                >
                    {inlineLabel}
                </span>
            </div>
        );
    }

    return (
        <div className={`rounded-xl border ${style.borderColor} ${style.accentBg} overflow-hidden`}>
            {/* Progress bar - subtle, thin, animated */}
            <div className="h-0.5 bg-white/60 overflow-hidden">
                <div
                    className={`h-full ${style.barColor} transition-all duration-[2500ms] ease-linear`}
                    style={{ width: `${barWidthPct}%` }}
                />
            </div>

            <div className="px-5 py-4">
                {title && (
                    <div className="flex items-center gap-2.5 mb-2">
                        <span className="relative flex h-2 w-2">
                            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${style.dotColor} opacity-75`} />
                            <span className={`relative inline-flex rounded-full h-2 w-2 ${style.dotColor}`} />
                        </span>
                        <span className={`text-sm font-semibold ${style.accent}`}>{title}</span>
                    </div>
                )}
                {subtitle && (
                    <p className="text-xs text-neutral-500 mb-3 ml-[18px]">{subtitle}</p>
                )}
                <div className="ml-[18px]">
                    {hasHistory ? (
                        <>
                            <p
                                className={`text-sm font-medium ${style.accent} mb-2 transition-opacity duration-300 ${isFading ? 'opacity-0' : 'opacity-100'}`}
                            >
                                {currentLabel}
                            </p>
                            <ul className="space-y-1.5">
                                {hiddenCount > 0 && (
                                    <li className="text-xs text-neutral-400 italic">+{hiddenCount} earlier…</li>
                                )}
                                {visibleHistory.map((msg, i) => {
                                    const isLast = i === visibleHistory.length - 1;
                                    return (
                                        <li key={`${i}-${msg}`} className="flex items-center gap-2">
                                            {isLast ? (
                                                <span className="relative flex h-2 w-2 shrink-0">
                                                    <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${style.dotColor} opacity-75`} />
                                                    <span className={`relative inline-flex rounded-full h-2 w-2 ${style.dotColor}`} />
                                                </span>
                                            ) : (
                                                <Check size={12} className={`${style.accent} shrink-0`} />
                                            )}
                                            <span className={`text-sm ${isLast ? 'text-neutral-700' : 'text-neutral-500'}`}>{msg}</span>
                                        </li>
                                    );
                                })}
                            </ul>
                        </>
                    ) : (
                        <p
                            className={`text-sm text-neutral-600 transition-opacity duration-300 ${isFading ? 'opacity-0' : 'opacity-100'}`}
                        >
                            {currentLabel}
                        </p>
                    )}
                </div>

                {/* Stage dots */}
                {stages.length > 1 && (
                    <div className="flex items-center gap-1 mt-3 ml-[18px]">
                        {stages.map((_, i) => (
                            <div
                                key={i}
                                className={`h-1 rounded-full transition-all duration-500 ${
                                    i < activeDotIndex
                                        ? `${style.barColor} w-3`
                                        : i === activeDotIndex
                                        ? `${style.barColor} w-5 opacity-80`
                                        : 'bg-neutral-300 w-1.5'
                                }`}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
