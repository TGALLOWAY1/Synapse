import { useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { DESIGN_SYSTEM_PRESETS } from '../lib/designSystemPresets';
import { getDefaultDesignPreset, setDefaultDesignPreset } from '../lib/designPresetPreference';
import { DesignPresetGrid } from './setup/DesignPresetGrid';

interface DesignSystemPresetChoiceProps {
    onChoose: (presetId: string) => void;
    onClose: () => void;
    /**
     * The preset already stored on the project, if any. When set, the matching
     * card is marked as the current choice — used by the post-finalization
     * "change direction" flow so the user can see what's active.
     */
    currentPresetId?: string;
    /** Heading override. Defaults to the first-time "Choose…" copy. */
    title?: string;
    /** Lead paragraph override (the explanatory line under the heading). */
    description?: string;
}

/**
 * "Visual direction" picker — the Mark-as-Final fallback gate. Shown right
 * before visual artifact generation when a project reaches finalize with no
 * preset yet (setup step skipped, or a legacy project), so generation never
 * starts without an explicit visual-direction decision.
 *
 * It renders the shared `DesignPresetGrid` live preview cards — the same look
 * as the setup-stage `DesignSetupStep` and the post-finalization
 * `ChangeDirectionModal` — so every visual-direction surface is one consistent
 * preview picker rather than a separate text-only list.
 *
 * The selected preset is stored on the project and steers design-system
 * generation — and through it, both the internal mockups and the prompts users
 * copy for external image tools, so the two stay consistent.
 *
 * Responsive: centered dialog on desktop, full-width bottom sheet on mobile —
 * mirrors ChangeDirectionModal.
 */
export function DesignSystemPresetChoice({
    onChoose,
    onClose,
    currentPresetId,
    title = 'Choose your visual direction',
    description = "This sets your project's design system. Internal mockups and the prompts you copy for external image tools will both follow it, so everything stays visually consistent.",
}: DesignSystemPresetChoiceProps) {
    const [defaultPresetId] = useState<string | null>(() => getDefaultDesignPreset());
    // Preselect the current direction (change flow) or the saved default, then
    // fall back to the first preset so the Continue action is always live.
    const [selectedId, setSelectedId] = useState<string>(
        currentPresetId ?? defaultPresetId ?? DESIGN_SYSTEM_PRESETS[0].id,
    );
    const [saveAsDefault, setSaveAsDefault] = useState(false);

    const selectedPreset = DESIGN_SYSTEM_PRESETS.find((p) => p.id === selectedId);

    const handleContinue = () => {
        if (!selectedPreset) return;
        // Persist the default first (explicit opt-in only), then hand the choice
        // to the caller, which stores it on the project and drives generation.
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
                aria-labelledby="preset-choice-title"
            >
                <div className="p-6 md:p-8">
                    <div className="flex items-start justify-between gap-3">
                        <h2
                            id="preset-choice-title"
                            className="text-xl md:text-2xl font-semibold text-neutral-900"
                        >
                            {title}
                        </h2>
                        <button
                            onClick={onClose}
                            className="p-2 -mr-2 -mt-1 text-neutral-400 hover:text-neutral-700 rounded-lg transition shrink-0"
                            aria-label="Cancel"
                        >
                            <X size={18} />
                        </button>
                    </div>
                    <p className="mt-2 text-sm text-neutral-500 max-w-2xl">{description}</p>
                    <p className="mt-1 text-xs text-neutral-400 max-w-2xl">
                        You can regenerate the design system later, but that may change your
                        mockups and screen-level prompts.
                    </p>

                    <div className="mt-6">
                        <DesignPresetGrid
                            selectedId={selectedId}
                            onSelect={setSelectedId}
                            defaultPresetId={defaultPresetId}
                            currentId={currentPresetId}
                        />
                    </div>

                    {/* Action bar */}
                    <div className="sticky bottom-0 mt-6 flex flex-wrap items-center gap-3 bg-white pt-4 border-t border-neutral-200">
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
                            disabled={!selectedPreset}
                            className="inline-flex items-center gap-1.5 px-6 py-3 min-h-[44px] rounded-xl text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 transition disabled:opacity-60"
                        >
                            <Sparkles size={16} />
                            Continue with {selectedPreset?.label ?? 'selection'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
