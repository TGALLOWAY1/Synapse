import { Check, Loader2 } from 'lucide-react';

export type StepStatus = 'queued' | 'generating' | 'done';

/** Shared status glyph used by the spec timeline (screen 2) and asset gen (screen 5). */
export function StatusIcon({
    status,
    reducedMotion,
    size = 'md',
}: {
    status: StepStatus;
    reducedMotion: boolean;
    size?: 'sm' | 'md';
}) {
    const box = size === 'sm' ? 'h-5 w-5' : 'h-6 w-6';

    if (status === 'done') {
        return (
            <span
                className={`${box} flex shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white`}
                aria-hidden="true"
            >
                <Check size={size === 'sm' ? 12 : 14} strokeWidth={3} />
            </span>
        );
    }
    if (status === 'generating') {
        return (
            <span
                className={`${box} flex shrink-0 items-center justify-center rounded-full border-2 border-indigo-400 text-indigo-300`}
                aria-hidden="true"
            >
                <Loader2 size={size === 'sm' ? 11 : 13} className={reducedMotion ? '' : 'animate-spin'} />
            </span>
        );
    }
    return (
        <span
            className={`${box} shrink-0 rounded-full border-2 border-neutral-600`}
            aria-hidden="true"
        />
    );
}

const STATUS_TEXT: Record<StepStatus, string> = {
    queued: 'Queued',
    generating: 'Generating',
    done: 'Done',
};

const STATUS_TONE: Record<StepStatus, string> = {
    queued: 'text-neutral-500',
    generating: 'text-indigo-300',
    done: 'text-emerald-400',
};

/**
 * One row of a vertical generation timeline (screen 2). Draws the connector
 * line down to the next step unless `isLast`.
 */
export function GenerationStep({
    label,
    status,
    reducedMotion,
    elapsedLabel,
    isLast = false,
}: {
    label: string;
    status: StepStatus;
    reducedMotion: boolean;
    /** e.g. "8s" (done) or "Generating (12s)" detail. */
    elapsedLabel?: string;
    isLast?: boolean;
}) {
    return (
        <li className="relative flex gap-3 pb-5 last:pb-0">
            {!isLast && (
                <span
                    aria-hidden="true"
                    className={`absolute left-3 top-6 -ml-px h-full w-0.5 ${
                        status === 'done' ? 'bg-emerald-500/50' : 'bg-neutral-700'
                    }`}
                />
            )}
            <StatusIcon status={status} reducedMotion={reducedMotion} />
            <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                    <span
                        className={`truncate text-sm font-medium ${
                            status === 'queued' ? 'text-neutral-400' : 'text-neutral-100'
                        }`}
                    >
                        {label}
                    </span>
                    {elapsedLabel && status === 'done' && (
                        <span className="shrink-0 text-xs text-neutral-500">{elapsedLabel}</span>
                    )}
                </div>
                <span className={`text-xs ${STATUS_TONE[status]}`}>
                    {status === 'generating' && elapsedLabel ? elapsedLabel : STATUS_TEXT[status]}
                </span>
            </div>
        </li>
    );
}
