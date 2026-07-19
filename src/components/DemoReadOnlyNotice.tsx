import { useState } from 'react';
import { ChevronDown, Loader2, RotateCcw, Sparkles } from 'lucide-react';
import { resetDemoProjectSingleFlight } from '../lib/demoRouteHydration';

type ResetPhase = 'idle' | 'confirming' | 'resetting' | 'error';

// SYN-001: the workspace-level banner for the read-only example project.
// Its first job is to orient a visitor — say what Synapse *does* — in one
// compact line that stays calm on mobile. The read-only policy detail and the
// "Reset demo" affordance are secondary, so they live behind a collapsible
// "Details" toggle (collapsed by default) instead of stacking more text at the
// top of the screen. `resetDemoProjectSingleFlight` wipes the demo's local
// state and reloads the pinned snapshot; on success the workspace re-renders
// from the restored state via the store, so no local "restored" messaging is
// needed here — the phase just returns to idle.
export function DemoReadOnlyNotice() {
    const [expanded, setExpanded] = useState(false);
    const [phase, setPhase] = useState<ResetPhase>('idle');
    const [error, setError] = useState<string | null>(null);

    const handleReset = async () => {
        setPhase('resetting');
        setError(null);
        try {
            const result = await resetDemoProjectSingleFlight();
            if (!result.available) {
                setError('The demo could not be reset right now. Please try again.');
                setPhase('error');
                return;
            }
            setPhase('idle');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'The demo could not be reset right now.');
            setPhase('error');
        }
    };

    return (
        <div
            role="status"
            className="shrink-0 bg-indigo-500/10 border-b border-indigo-500/30 text-indigo-100 text-sm z-10"
        >
            {/* Compact orienting row — one line that tells a visitor what the
                product is before anything else. */}
            <div className="flex items-center gap-2 px-4 py-2">
                <Sparkles size={15} className="shrink-0 text-indigo-300" aria-hidden="true" />
                <p className="min-w-0 flex-1">
                    <span className="font-semibold text-white">Synapse</span> turns a plain-language
                    idea into a PRD, screens, mockups, and a build plan — you're exploring a saved example.
                </p>
                <button
                    type="button"
                    onClick={() => setExpanded((v) => !v)}
                    aria-expanded={expanded}
                    className="inline-flex shrink-0 items-center gap-1 rounded text-indigo-200 underline-offset-2 transition hover:text-white"
                >
                    {expanded ? 'Less' : 'Details'}
                    <ChevronDown
                        size={14}
                        aria-hidden="true"
                        className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
                    />
                </button>
            </div>

            {/* Secondary detail: the read-only policy and the reset affordance,
                revealed on demand so they don't crowd the top of the screen. */}
            {expanded && (
                <div className="flex flex-col gap-2 px-4 pb-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                    <span className="text-indigo-200/90">
                        This is a read-only example project. Explore its PRD, screens, mockups, data
                        model, and implementation plan without changing the saved project.
                    </span>

                    {phase === 'confirming' ? (
                        <span className="flex shrink-0 items-center gap-2">
                            <span className="text-indigo-100">Reset the example to its original state?</span>
                            <button
                                type="button"
                                onClick={handleReset}
                                className="underline underline-offset-2 hover:text-white transition"
                            >
                                Confirm
                            </button>
                            <button
                                type="button"
                                onClick={() => setPhase('idle')}
                                className="text-indigo-300 hover:text-white transition"
                            >
                                Cancel
                            </button>
                        </span>
                    ) : (
                        <button
                            type="button"
                            onClick={() => setPhase('confirming')}
                            disabled={phase === 'resetting'}
                            className="inline-flex shrink-0 items-center gap-1.5 text-indigo-200 underline underline-offset-2 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {phase === 'resetting' ? (
                                <>
                                    <Loader2 className="animate-spin" size={13} aria-hidden="true" />
                                    Resetting…
                                </>
                            ) : (
                                <>
                                    <RotateCcw size={13} aria-hidden="true" />
                                    Reset demo
                                </>
                            )}
                        </button>
                    )}

                    {phase === 'error' && error && (
                        <span role="alert" className="text-rose-300">
                            {error}
                        </span>
                    )}
                </div>
            )}
        </div>
    );
}
