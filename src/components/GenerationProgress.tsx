import { useState, useEffect, useRef } from 'react';
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
}

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
}: GenerationProgressProps) {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isFading, setIsFading] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const style = VARIANT_STYLES[variant];

    useEffect(() => {
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
    }, [currentIndex, stages]);

    if (stages.length === 0) return null;

    const currentLabel = stages[currentIndex]?.label ?? stages[stages.length - 1]?.label;

    if (inline) {
        return (
            <div className="flex items-center gap-3">
                <span className="relative flex h-2 w-2">
                    <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${style.dotColor} opacity-75`} />
                    <span className={`relative inline-flex rounded-full h-2 w-2 ${style.dotColor}`} />
                </span>
                <span
                    className={`text-sm ${style.accent} transition-opacity duration-300 ${isFading ? 'opacity-0' : 'opacity-100'}`}
                >
                    {currentLabel}
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
                    style={{
                        width: `${Math.min(((currentIndex + 1) / stages.length) * 100, 95)}%`,
                    }}
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
                    <p
                        className={`text-sm text-neutral-600 transition-opacity duration-300 ${isFading ? 'opacity-0' : 'opacity-100'}`}
                    >
                        {currentLabel}
                    </p>
                </div>

                {/* Stage dots */}
                {stages.length > 1 && (
                    <div className="flex items-center gap-1 mt-3 ml-[18px]">
                        {stages.map((_, i) => (
                            <div
                                key={i}
                                className={`h-1 rounded-full transition-all duration-500 ${
                                    i < currentIndex
                                        ? `${style.barColor} w-3`
                                        : i === currentIndex
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
