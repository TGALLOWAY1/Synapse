import type { TourMode } from './tourTypes';

/** Segmented Guided / Overview switch shown in the tour header. */
export function ModeToggle({
    mode,
    onChange,
}: {
    mode: TourMode;
    onChange: (mode: TourMode) => void;
}) {
    return (
        <div
            className="inline-flex rounded-full border border-neutral-700 bg-neutral-800/60 p-0.5 text-xs"
            role="radiogroup"
            aria-label="Tour mode"
        >
            {(['guided', 'overview'] as const).map((m) => (
                <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={mode === m}
                    onClick={() => onChange(m)}
                    className={`rounded-full px-3 py-1.5 font-medium capitalize transition ${
                        mode === m ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:text-neutral-200'
                    }`}
                >
                    {m}
                </button>
            ))}
        </div>
    );
}
