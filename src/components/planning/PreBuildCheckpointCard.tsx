import { useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';

export interface PreBuildCheckpointItem {
    id: string;
    title: string;
}

interface PreBuildCheckpointCardProps {
    primaryItem: PreBuildCheckpointItem;
    onGenerate: () => void;
    onReview: () => void;
    onCancel: () => void;
}

export function PreBuildCheckpointCard({
    primaryItem,
    onGenerate,
    onReview,
    onCancel,
}: PreBuildCheckpointCardProps) {
    const checkpointRef = useRef<HTMLElement>(null);

    useEffect(() => {
        checkpointRef.current?.focus();
    }, []);

    return (
        <section
            ref={checkpointRef}
            aria-labelledby="pre-build-checkpoint-heading"
            tabIndex={-1}
            className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-3"
        >
            <p className="sr-only" role="status" aria-live="polite">
                Generation checkpoint opened. Review the highlighted planning item or continue generating.
            </p>
            <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-2">
                    <AlertTriangle
                        aria-hidden="true"
                        className="mt-0.5 shrink-0 text-amber-700"
                        size={17}
                    />
                    <div>
                        <h2
                            id="pre-build-checkpoint-heading"
                            className="text-sm font-semibold text-amber-950"
                        >
                            Before generating: {primaryItem.title}
                        </h2>
                        <p className="mt-0.5 text-xs leading-5 text-amber-800">
                            Generation can proceed. Review this first if it may change the outputs you expect.
                        </p>
                    </div>
                </div>
                <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={onCancel}
                        className="min-h-11 rounded-lg px-3 text-sm font-semibold text-amber-900 hover:bg-amber-100"
                    >
                        Not now
                    </button>
                    <button
                        type="button"
                        onClick={onReview}
                        className="min-h-11 rounded-lg border border-amber-300 bg-white px-3 text-sm font-semibold text-amber-950 hover:bg-amber-100"
                    >
                        Review first
                    </button>
                    <button
                        type="button"
                        onClick={onGenerate}
                        className="min-h-11 rounded-lg bg-amber-700 px-3 text-sm font-semibold text-white hover:bg-amber-800"
                    >
                        Generate outputs
                    </button>
                </div>
            </div>
        </section>
    );
}
