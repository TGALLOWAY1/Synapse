import { RotateCcw } from 'lucide-react';
import { TOUR_SCREENS } from './tourTypes';

/**
 * Overview-mode navigator: a horizontal strip of every section so returning
 * users can jump straight to Refinement, Versioning, Assets, etc. without
 * replaying the guided story. Includes a "Restart tour" affordance.
 */
export function TourProgressRail({
    activeIndex,
    onGoto,
    onRestart,
}: {
    activeIndex: number;
    onGoto: (index: number) => void;
    onRestart: () => void;
}) {
    return (
        <div className="flex items-center gap-2 overflow-x-auto border-b border-neutral-800 px-5 py-3 sm:px-8">
            <nav className="flex items-center gap-1.5" aria-label="Tour sections">
                {TOUR_SCREENS.map((screen, i) => {
                    const isActive = i === activeIndex;
                    return (
                        <button
                            key={screen.id}
                            type="button"
                            aria-current={isActive ? 'page' : undefined}
                            onClick={() => onGoto(i)}
                            className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                                isActive
                                    ? 'border-indigo-400/70 bg-indigo-500/15 text-indigo-200'
                                    : 'border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200'
                            }`}
                        >
                            <span className="mr-1 tabular-nums opacity-60">{i + 1}</span>
                            {screen.shortLabel}
                        </button>
                    );
                })}
            </nav>
            <button
                type="button"
                onClick={onRestart}
                className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 transition hover:border-indigo-500/60 hover:text-white"
            >
                <RotateCcw size={13} /> Restart tour
            </button>
        </div>
    );
}
