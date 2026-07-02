import { useState } from 'react';
import { AlertTriangle, Sparkles, X } from 'lucide-react';
import { DESIGN_SYSTEM_PRESETS } from '../../lib/designSystemPresets';
import { getDefaultDesignPreset, setDefaultDesignPreset } from '../../lib/designPresetPreference';
import { DesignPresetGrid } from './DesignPresetGrid';

interface ChangeDirectionModalProps {
    /** The direction currently stored on the project (marked "Current"). */
    currentPresetId?: string;
    /**
     * Commit a newly-chosen direction. The caller persists it and leads into a
     * regenerate confirmation — the change only takes effect on regeneration.
     */
    onChoose: (presetId: string) => void;
    onClose: () => void;
}

/**
 * Post-finalization "Change your visual direction" screen. Deliberately mirrors
 * the setup-stage `DesignSetupStep` a user sees right after their initial prompt
 * — same light surface and large preview cards — so switching direction feels
 * like the original choice, not a different control. A prominent warning makes
 * clear the change flows through to downstream artifacts (mockups, screens, and
 * copied image prompts) before the user commits; the caller then requires an
 * explicit regenerate confirmation.
 */
export function ChangeDirectionModal({
    currentPresetId,
    onChoose,
    onClose,
}: ChangeDirectionModalProps) {
    // Preselect the current direction so the screen opens on what's active.
    const [selectedId, setSelectedId] = useState<string>(
        currentPresetId ?? DESIGN_SYSTEM_PRESETS[0].id,
    );
    const [defaultPresetId] = useState<string | null>(() => getDefaultDesignPreset());
    const [saveAsDefault, setSaveAsDefault] = useState(false);

    const selectedPreset = DESIGN_SYSTEM_PRESETS.find((p) => p.id === selectedId);
    const isUnchanged = selectedId === currentPresetId;

    const handleContinue = () => {
        if (!selectedPreset) return;
        if (saveAsDefault) setDefaultDesignPreset(selectedPreset.id);
        onChoose(selectedPreset.id);
    };

    return (
        <div
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4"
            onClick={onClose}
            role="presentation"
        >
            <div
                className="bg-white w-full sm:max-w-3xl max-h-[92vh] rounded-t-3xl sm:rounded-2xl shadow-xl border border-neutral-200/80 overflow-y-auto"
                style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.25rem)' }}
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="change-direction-title"
            >
                <div className="p-6 md:p-8">
                    <div className="flex items-start justify-between gap-3">
                        <h2
                            id="change-direction-title"
                            className="text-xl md:text-2xl font-semibold text-neutral-900"
                        >
                            Change your visual direction
                        </h2>
                        <button
                            onClick={onClose}
                            className="p-2 -mr-2 -mt-1 text-neutral-400 hover:text-neutral-700 rounded-lg transition shrink-0"
                            aria-label="Cancel"
                        >
                            <X size={18} />
                        </button>
                    </div>
                    <p className="mt-2 text-sm text-neutral-500 max-w-2xl">
                        Pick a new direction for this project&apos;s design system. Internal mockups and
                        the prompts you copy for external image tools both follow it, so everything
                        stays visually consistent.
                    </p>

                    {/* Downstream-impact warning — shown before the user commits. */}
                    <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                        <AlertTriangle size={16} className="shrink-0 mt-0.5 text-amber-500" />
                        <span>
                            Changing direction regenerates the design system, which may make your
                            existing <span className="font-medium">mockups and screen-level prompts</span>{' '}
                            out of date. You&apos;ll confirm before anything regenerates, and the current
                            version stays in version history.
                        </span>
                    </div>

                    <div className="mt-6">
                        <DesignPresetGrid
                            selectedId={selectedId}
                            onSelect={setSelectedId}
                            defaultPresetId={defaultPresetId}
                            currentId={currentPresetId}
                        />
                    </div>

                    {/* Action bar */}
                    <div
                        className="sticky bottom-0 mt-6 flex flex-wrap items-center gap-3 bg-white/95 backdrop-blur pt-4 border-t border-neutral-100"
                    >
                        <label className="flex items-center gap-2 text-sm text-neutral-600 cursor-pointer select-none min-h-[44px]">
                            <input
                                type="checkbox"
                                checked={saveAsDefault}
                                onChange={(e) => setSaveAsDefault(e.target.checked)}
                                className="h-4 w-4 rounded border-neutral-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            Use this as my default for future projects
                        </label>
                        <div className="flex-1" />
                        <button
                            onClick={onClose}
                            className="px-4 py-3 min-h-[44px] rounded-xl text-sm font-medium text-neutral-500 hover:bg-neutral-100 transition"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleContinue}
                            disabled={!selectedPreset || isUnchanged}
                            className="inline-flex items-center gap-1.5 px-6 py-3 min-h-[44px] rounded-xl text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 transition disabled:opacity-60"
                        >
                            <Sparkles size={16} />
                            {isUnchanged
                                ? 'Current direction'
                                : `Continue with ${selectedPreset?.label ?? 'selection'}`}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
