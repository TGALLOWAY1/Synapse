import { useMemo, useState } from 'react';
import { Check, CheckCircle2, Loader2, Sparkles, Wand2 } from 'lucide-react';
import { useProjectStore } from '../../store/projectStore';
import {
    DESIGN_SYSTEM_PRESETS,
    type DesignSystemPreset,
    type PresetPreviewTokens,
} from '../../lib/designSystemPresets';
import { recommendDesignSystemPresetId } from '../../lib/designPresetRecommendation';
import { getDefaultDesignPreset, setDefaultDesignPreset } from '../../lib/designPresetPreference';

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

            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {DESIGN_SYSTEM_PRESETS.map((preset) => (
                    <PresetCard
                        key={preset.id}
                        preset={preset}
                        selected={preset.id === selectedId}
                        recommended={preset.id === recommendedId}
                        isDefault={preset.id === defaultPresetId}
                        onSelect={() => setSelectedId(preset.id)}
                    />
                ))}
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

// --- Cards ------------------------------------------------------------------

interface PresetCardProps {
    preset: DesignSystemPreset;
    selected: boolean;
    recommended: boolean;
    isDefault: boolean;
    onSelect: () => void;
}

function PresetCard({ preset, selected, recommended, isDefault, onSelect }: PresetCardProps) {
    return (
        <button
            onClick={onSelect}
            aria-pressed={selected}
            className={`text-left rounded-2xl border p-3 transition group ${
                selected
                    ? 'border-indigo-500 ring-2 ring-indigo-200 bg-indigo-50/40'
                    : 'border-neutral-200 hover:border-indigo-300 bg-white'
            }`}
        >
            {preset.previewTokens ? (
                <PresetPreview tokens={preset.previewTokens} />
            ) : (
                <CustomPreviewPlaceholder />
            )}
            <div className="mt-3 flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-neutral-900 text-sm">{preset.label}</span>
                {recommended && (
                    <span className="text-[11px] font-medium text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-full">
                        Recommended
                    </span>
                )}
                {isDefault && (
                    <span className="text-[11px] font-medium text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                        Your default
                    </span>
                )}
                {selected && (
                    <span className="ml-auto inline-flex items-center justify-center w-5 h-5 rounded-full bg-indigo-600 text-white shrink-0">
                        <Check size={12} />
                    </span>
                )}
            </div>
            {preset.tone && (
                <p className="mt-0.5 text-xs font-medium text-neutral-500">{preset.tone}</p>
            )}
            <p className="mt-1 text-xs text-neutral-500 leading-relaxed">{preset.detail}</p>
            {preset.recommendedUseCases && preset.recommendedUseCases.length > 0 && (
                <p className="mt-1.5 text-[11px] text-neutral-400">
                    Great for: {preset.recommendedUseCases.join(' · ')}
                </p>
            )}
        </button>
    );
}

/**
 * Static mini-layout rendered purely from the preset's preview tokens — no AI
 * call, no images. Top bar + sidebar + heading/body type sample + primary
 * button + mock content card + color swatches.
 */
function PresetPreview({ tokens }: { tokens: PresetPreviewTokens }) {
    const cardRadius = Math.min(tokens.radius, 12);
    return (
        <div
            aria-hidden
            className="pointer-events-none select-none overflow-hidden rounded-xl border"
            style={{ background: tokens.background, borderColor: tokens.border, fontFamily: tokens.fontFamily }}
        >
            {/* Header shape */}
            <div
                className="flex items-center gap-1.5 px-2.5 py-1.5 border-b"
                style={{ background: tokens.surface, borderColor: tokens.border }}
            >
                <span className="w-2 h-2 rounded-full" style={{ background: tokens.primary }} />
                <span className="h-1.5 w-10 rounded-full" style={{ background: tokens.border }} />
                <span className="ml-auto h-1.5 w-5 rounded-full" style={{ background: tokens.border }} />
            </div>
            <div className="flex gap-2 p-2.5">
                {/* Sidebar shape */}
                <div
                    className="w-9 shrink-0 p-1.5 space-y-1.5 border"
                    style={{ background: tokens.surface, borderColor: tokens.border, borderRadius: cardRadius }}
                >
                    <span className="block h-1 rounded-full" style={{ background: tokens.primary }} />
                    <span className="block h-1 rounded-full" style={{ background: tokens.border }} />
                    <span className="block h-1 rounded-full" style={{ background: tokens.border }} />
                </div>
                <div className="flex-1 min-w-0">
                    {/* Typography sample */}
                    <div
                        className="text-[11px] leading-tight truncate"
                        style={{ color: tokens.text, fontWeight: tokens.headingWeight }}
                    >
                        Aa — Heading
                    </div>
                    <div className="text-[9px] truncate" style={{ color: tokens.mutedText }}>
                        Body copy sample text
                    </div>
                    {/* Sample button */}
                    <div className="mt-1.5 flex items-center gap-1.5">
                        <span
                            className="px-2 py-0.5 text-[9px] font-medium"
                            style={{
                                background: tokens.primary,
                                color: tokens.primaryText,
                                borderRadius: cardRadius,
                            }}
                        >
                            Button
                        </span>
                        <span
                            className="px-2 py-0.5 text-[9px] border"
                            style={{
                                color: tokens.mutedText,
                                borderColor: tokens.border,
                                borderRadius: cardRadius,
                            }}
                        >
                            Action
                        </span>
                    </div>
                    {/* Mock content card */}
                    <div
                        className="mt-1.5 p-1.5 space-y-1 border"
                        style={{ background: tokens.surface, borderColor: tokens.border, borderRadius: cardRadius }}
                    >
                        <span className="block h-1 w-3/4 rounded-full" style={{ background: tokens.mutedText, opacity: 0.5 }} />
                        <span className="block h-1 w-1/2 rounded-full" style={{ background: tokens.mutedText, opacity: 0.3 }} />
                    </div>
                </div>
            </div>
            {/* Color swatches */}
            <div className="flex items-center gap-1 px-2.5 pb-2">
                {[tokens.primary, tokens.text, tokens.mutedText, tokens.surface].map((c, i) => (
                    <span
                        key={i}
                        className="w-3.5 h-3.5 rounded-full border"
                        style={{ background: c, borderColor: tokens.border }}
                    />
                ))}
            </div>
        </div>
    );
}

function CustomPreviewPlaceholder() {
    return (
        <div
            aria-hidden
            className="pointer-events-none select-none rounded-xl border border-dashed border-neutral-300 bg-neutral-50 flex flex-col items-center justify-center gap-1.5 py-8"
        >
            <Wand2 size={18} className="text-neutral-400" />
            <span className="text-[10px] text-neutral-500">
                Synapse designs it from your PRD
            </span>
        </div>
    );
}
