import { useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { resetDemoProjectSingleFlight } from '../lib/demoRouteHydration';

type ResetPhase = 'idle' | 'confirming' | 'resetting' | 'error';

// SYN-001: "Reset Demo" — a compact, self-contained affordance on the
// workspace-level read-only banner. Deliberately no modal: an inline
// confirm keeps the banner calm and single-line-ish. `resetDemoProjectSingleFlight`
// wipes the demo's local state and reloads the pinned snapshot; on success
// the workspace re-renders from the restored state via the store, so no
// local "restored" messaging is needed here — the phase just returns to idle.
export function DemoReadOnlyNotice() {
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
            className="shrink-0 bg-indigo-500/10 border-b border-indigo-500/30 text-indigo-200 text-sm px-4 py-2 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-center sm:gap-3 z-10"
        >
            <span>
                This is a read-only example project. Explore its PRD, screens, mockups, data model,
                and implementation plan without changing the saved project.
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
    );
}
