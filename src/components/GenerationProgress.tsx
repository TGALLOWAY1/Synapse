import { useState, useEffect, useRef } from 'react';
import { Check, X, Zap, Brain } from 'lucide-react';
import type { ProgressStage } from './generationStages';

export interface SectionStatusInfo {
    tier: 'fast' | 'strong';
    status: 'pending' | 'queued' | 'generating' | 'complete' | 'error' | 'refining';
    model?: string;
    ms?: number;
    error?: string;
    /** Rough wall-clock estimate (seconds). */
    estimatedSeconds?: number;
    /** Wall-clock start timestamp (ms). Set when status === 'generating'. */
    startedAt?: number;
}

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
    /**
     * Per-section generation status. When populated, renders a section-grid
     * below the message log: one pip per section, colour-coded by tier
     * (teal = Flash, indigo = Pro) and shaped by status.
     */
    sectionStatus?: Record<string, SectionStatusInfo>;
    /**
     * Ordered section labels for the grid, keyed by section id.
     * Falls back to the section id itself when omitted.
     */
    sectionTitles?: Record<string, string>;
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
    sectionStatus,
    sectionTitles,
}: GenerationProgressProps) {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isFading, setIsFading] = useState(false);
    const [now, setNow] = useState(() => Date.now());
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const style = VARIANT_STYLES[variant];
    const isStateDriven = typeof progress === 'number';
    const hasHistory = !!history && history.length > 0;
    const hasSectionStatus = !!sectionStatus && Object.keys(sectionStatus).length > 0;

    // Tick once per second while any section is mid-generation so the
    // "elapsed/estimate" counter on each active pip stays current.
    const hasActiveSection = hasSectionStatus && Object.values(sectionStatus!).some(
        info => info.status === 'generating' || info.status === 'refining',
    );
    useEffect(() => {
        if (!hasActiveSection) return;
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, [hasActiveSection]);

    useEffect(() => {
        // Skip the rotation timer entirely when the parent supplies real
        // progress data — either an explicit `progress` value or a `history`
        // event stream. Letting the timer run alongside real progress
        // produces label/data mismatches (the timer would race ahead and
        // park on a stage that the underlying work hadn't reached yet).
        if (isStateDriven) return;
        if (hasHistory) return;
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

    // Dedupe consecutive identical entries (chunk-rate progress messages can
    // round to the same string) and trim to the last N for display.
    const dedupedHistory = hasHistory
        ? history!.filter((msg, i, arr) => i === 0 || arr[i - 1] !== msg)
        : [];
    const effectiveHistoryCap = hasSectionStatus ? 3 : VISIBLE_HISTORY_CAP;
    const visibleHistory = dedupedHistory.slice(-effectiveHistoryCap);
    const hiddenCount = dedupedHistory.length - visibleHistory.length;

    // When `history` is the source of truth, derive the active stage from
    // the latest message that matches a known stage label. We match by
    // first-three-words substring (case-insensitive, ignoring trailing
    // ellipsis/punctuation). Walk backwards so transient messages like
    // "Sending request to model…", "Parsing structured PRD…", or
    // "Connection dropped — retrying…" fall through to the most recent
    // matching stage instead of yanking the dot to a wrong place.
    const stageIndexFromMessage = (msg: string | undefined): number | null => {
        if (!msg) return null;
        const norm = msg.toLowerCase();
        for (let i = stages.length - 1; i >= 0; i--) {
            const label = stages[i]?.label?.toLowerCase().replace(/[….\s]+$/g, '') || '';
            if (label && norm.includes(label.split(' ').slice(0, 3).join(' '))) {
                return i;
            }
        }
        return null;
    };

    // Clamp/derive values for state-driven mode
    const clampedProgress = isStateDriven ? Math.max(0, Math.min(100, progress!)) : 0;
    const historyLatest = hasHistory ? dedupedHistory[dedupedHistory.length - 1] : undefined;
    let lastMatchedStage: number | null = null;
    if (hasHistory) {
        for (let i = dedupedHistory.length - 1; i >= 0 && lastMatchedStage === null; i--) {
            lastMatchedStage = stageIndexFromMessage(dedupedHistory[i]);
        }
    }
    const activeDotIndex = isStateDriven
        ? Math.min(
              stages.length - 1,
              Math.floor((clampedProgress / 100) * stages.length),
          )
        : hasHistory
            ? (lastMatchedStage !== null ? lastMatchedStage : 0)
            : currentIndex;

    const currentLabel = isStateDriven
        ? (statusLabel ?? stages[activeDotIndex]?.label ?? stages[stages.length - 1]?.label)
        : hasHistory
            ? (historyLatest ?? stages[activeDotIndex]?.label ?? stages[stages.length - 1]?.label)
            : (stages[currentIndex]?.label ?? stages[stages.length - 1]?.label);

    const barWidthPct = isStateDriven
        ? clampedProgress
        : hasHistory
            ? Math.min(((activeDotIndex + 1) / Math.max(stages.length, 1)) * 100, 95)
            : Math.min(((currentIndex + 1) / stages.length) * 100, 95);

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

                {/* Stage dots — hidden when section-grid is shown */}
                {stages.length > 1 && !hasSectionStatus && (
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

                {/* Per-section status grid */}
                {hasSectionStatus && (
                    <div className="mt-4 ml-[18px]">
                        <div className="grid grid-cols-5 gap-x-2 gap-y-3">
                            {Object.entries(sectionStatus!).map(([sectionId, info]) => {
                                const label = sectionTitles?.[sectionId] ?? sectionId;
                                const isFast = info.tier === 'fast';
                                const modelLabel = info.model
                                    ? (info.model.toLowerCase().includes('flash') ? 'Flash'
                                        : info.model.toLowerCase().includes('pro') ? 'Pro'
                                        : info.model.slice(0, 6))
                                    : (isFast ? 'Flash' : 'Pro');

                                const isActive = info.status === 'generating' || info.status === 'refining';
                                const isComplete = info.status === 'complete';
                                const isError = info.status === 'error';

                                // Time annotation for the pip subtitle:
                                //   - active   → "5s / ~25s" (live elapsed vs. estimate)
                                //   - complete → "9.7s"     (actual duration)
                                //   - queued / pending → "~25s" (estimate only)
                                let timeLabel = '';
                                if (isComplete && typeof info.ms === 'number') {
                                    timeLabel = `${(info.ms / 1000).toFixed(1)}s`;
                                } else if (isActive) {
                                    const elapsedS = info.startedAt
                                        ? Math.max(0, Math.floor((now - info.startedAt) / 1000))
                                        : null;
                                    if (elapsedS !== null && info.estimatedSeconds) {
                                        timeLabel = `${elapsedS}s / ~${info.estimatedSeconds}s`;
                                    } else if (elapsedS !== null) {
                                        timeLabel = `${elapsedS}s`;
                                    } else if (info.estimatedSeconds) {
                                        timeLabel = `~${info.estimatedSeconds}s`;
                                    }
                                } else if (info.estimatedSeconds) {
                                    timeLabel = `~${info.estimatedSeconds}s`;
                                }

                                // Highlight the elapsed counter when it overshoots the estimate
                                // so users can tell that a section is running long.
                                const overEstimate = isActive
                                    && info.startedAt
                                    && info.estimatedSeconds
                                    && (now - info.startedAt) / 1000 > info.estimatedSeconds;

                                const pipRing = isError
                                    ? 'border-red-400 bg-red-400'
                                    : isComplete
                                        ? (isFast ? 'border-teal-400 bg-teal-400' : 'border-indigo-500 bg-indigo-500')
                                        : isActive
                                            ? (isFast ? 'border-teal-400 bg-teal-100' : 'border-indigo-400 bg-indigo-100')
                                            : info.status === 'queued'
                                                ? (isFast ? 'border-teal-300 bg-teal-50' : 'border-indigo-300 bg-indigo-50')
                                                : 'border-neutral-300 bg-transparent';

                                const textColor = isError
                                    ? 'text-red-500'
                                    : isComplete || isActive
                                        ? (isFast ? 'text-teal-700' : 'text-indigo-700')
                                        : 'text-neutral-400';

                                const timeColor = overEstimate
                                    ? 'text-amber-600'
                                    : isComplete
                                        ? (isFast ? 'text-teal-600' : 'text-indigo-600')
                                        : 'text-neutral-400';

                                return (
                                    <div key={sectionId} className="flex flex-col items-center gap-0.5">
                                        <div className={`relative flex h-7 w-7 items-center justify-center rounded-full border-2 transition-all duration-300 ${pipRing} ${isActive ? 'animate-pulse' : ''}`}>
                                            {isComplete && <Check size={11} className="text-white" />}
                                            {isError && <X size={11} className="text-white" />}
                                            {isActive && (
                                                isFast
                                                    ? <Zap size={9} className="text-teal-500" />
                                                    : <Brain size={9} className="text-indigo-500" />
                                            )}
                                        </div>
                                        <div className="text-center min-w-0 w-full">
                                            <div className={`text-[9px] font-medium leading-tight truncate ${textColor}`}>{label}</div>
                                            <div className="text-[8px] text-neutral-400 leading-tight">{modelLabel}</div>
                                            {timeLabel && (
                                                <div className={`text-[8px] leading-tight tabular-nums ${timeColor}`}>{timeLabel}</div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
