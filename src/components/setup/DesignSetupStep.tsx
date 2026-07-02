import { useMemo, useState } from 'react';
import { CheckCircle2, Loader2, Sparkles } from 'lucide-react';
import { useProjectStore } from '../../store/projectStore';
import { DESIGN_SYSTEM_PRESETS } from '../../lib/designSystemPresets';
import { recommendDesignSystemPresetId } from '../../lib/designPresetRecommendation';
import { getDefaultDesignPreset, setDefaultDesignPreset } from '../../lib/designPresetPreference';
import { DesignPresetGrid } from './DesignPresetGrid';

interface DesignSetupStepProps {
    projectId: string;
    /**
     * Idea + clarification text driving the rule-based recommendation
     * (original prompt, preflight summary, and answers, joined).
     */
    recommendationText: string;
    /** Whether the background PRD run is still working (drives the header copy). */
    prdGenerating: boolean;
}

/**
 * Setup-stage design selection. Shown in the workspace right after
 * clarification answers are submitted — while PRD generation is already
 * running in the background — and until the user picks a visual direction or
 * skips. Choosing here stores the preset on the project so the design system,
 * mockups, and copied screen prompts all follow it from the start; skipping
 * falls back to the original Mark-as-Final preset gate.
 */
export function DesignSetupStep({ projectId, recommendationText, prdGenerating }: DesignSetupStepProps) {
    const setProjectDesignSystemPreset = useProjectStore((s) => s.setProjectDesignSystemPreset);
    const markDesignSetupComplete = useProjectStore((s) => s.markDesignSetupComplete);

    const recommendedId = useMemo(
        () => recommendDesignSystemPresetId(recommendationText),
        [recommendationText],
    );
    // Captured once on mount: the saved default (if any) preselects; the
    // recommendation still gets its badge either way.
    const [defaultPresetId] = useState<string | null>(() => getDefaultDesignPreset());
    const [selectedId, setSelectedId] = useState<string>(defaultPresetId ?? recommendedId);
    const [saveAsDefault, setSaveAsDefault] = useState(false);

    const selectedPreset = DESIGN_SYSTEM_PRESETS.find((p) => p.id === selectedId);

    const handleContinue = () => {
        if (!selectedPreset) return;
        // Persist the default first (explicit opt-in only), then the project
        // choice — which also settles the setup step in the store.
        if (saveAsDefault) setDefaultDesignPreset(selectedPreset.id);
        setProjectDesignSystemPreset(projectId, selectedPreset.id);
    };

    const handleSkip = () => {
        markDesignSetupComplete(projectId);
    };

    return (
        <div className="bg-white rounded-2xl shadow-sm border border-neutral-200/80 p-6 md:p-10 mb-8">
            {/* Background-generation status */}
            <div
                className={`flex items-center gap-2.5 rounded-xl border px-4 py-3 mb-6 text-sm ${
                    prdGenerating
                        ? 'bg-indigo-50 border-indigo-100 text-indigo-800'
                        : 'bg-emerald-50 border-emerald-100 text-emerald-800'
                }`}
                role="status"
            >
                {prdGenerating ? (
                    <>
                        <Loader2 size={16} className="animate-spin shrink-0 text-indigo-500" />
                        <span>
                            Synapse is preparing your PRD. While that runs, choose a visual
                            direction for your project.
                        </span>
                    </>
                ) : (
                    <>
                        <CheckCircle2 size={16} className="shrink-0 text-emerald-500" />
                        <span>Your PRD is ready. Choose a visual direction to continue.</span>
                    </>
                )}
            </div>

            <h2 className="text-xl md:text-2xl font-semibold text-neutral-900">
                Choose your visual direction
            </h2>
            <p className="mt-2 text-sm text-neutral-500 max-w-2xl">
                This becomes the project&apos;s design system. Mockups and the prompts you copy
                for external image tools will follow it, so everything stays visually
                consistent. You can change it later from the Design System artifact.
            </p>

            <div className="mt-6">
                <DesignPresetGrid
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    recommendedId={recommendedId}
                    defaultPresetId={defaultPresetId}
                />
            </div>

            {/* Action bar — pinned near the bottom with safe-area inset,
                mirroring the preflight cards */}
            <div
                className="sticky bottom-0 mt-6 flex flex-wrap items-center gap-3 bg-white/95 backdrop-blur pt-4 border-t border-neutral-100"
                style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.25rem)' }}
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
                    onClick={handleSkip}
                    className="px-4 py-3 min-h-[44px] rounded-xl text-sm font-medium text-neutral-500 hover:bg-neutral-100 transition"
                >
                    Decide later
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
    );
}
