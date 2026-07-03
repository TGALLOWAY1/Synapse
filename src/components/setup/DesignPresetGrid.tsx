import { Check, CheckCircle2, Wand2 } from 'lucide-react';
import {
    DESIGN_SYSTEM_PRESETS,
    type DesignSystemPreset,
    type PresetPreviewTokens,
} from '../../lib/designSystemPresets';

interface DesignPresetGridProps {
    /** Currently highlighted preset id. */
    selectedId: string;
    onSelect: (presetId: string) => void;
    /** Rule-based recommendation → "Recommended" badge (optional). */
    recommendedId?: string;
    /** The user's saved default → "Your default" badge (optional). */
    defaultPresetId?: string | null;
    /**
     * The direction currently stored on the project → "Current" badge. Used by
     * the post-finalization "change your visual direction" flow so the user can
     * see what's active while they pick a new one.
     */
    currentId?: string;
}

/**
 * The shared visual-direction picker grid — the large static preview cards used
 * both by the setup-stage `DesignSetupStep` (right after the initial prompt) and
 * the post-finalization "Change your visual direction" flow, so the two screens
 * look identical. Presentational only; the caller owns the selection + actions.
 */
export function DesignPresetGrid({
    selectedId,
    onSelect,
    recommendedId,
    defaultPresetId,
    currentId,
}: DesignPresetGridProps) {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {DESIGN_SYSTEM_PRESETS.map((preset) => (
                <PresetCard
                    key={preset.id}
                    preset={preset}
                    selected={preset.id === selectedId}
                    recommended={preset.id === recommendedId}
                    isDefault={preset.id === defaultPresetId}
                    isCurrent={preset.id === currentId}
                    onSelect={() => onSelect(preset.id)}
                />
            ))}
        </div>
    );
}

// --- Cards ------------------------------------------------------------------

interface PresetCardProps {
    preset: DesignSystemPreset;
    selected: boolean;
    recommended: boolean;
    isDefault: boolean;
    isCurrent?: boolean;
    onSelect: () => void;
}

export function PresetCard({
    preset,
    selected,
    recommended,
    isDefault,
    isCurrent,
    onSelect,
}: PresetCardProps) {
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
                {isCurrent && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                        <Check size={11} /> Current
                    </span>
                )}
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
                        <CheckCircle2 size={12} />
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
export function PresetPreview({ tokens }: { tokens: PresetPreviewTokens }) {
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

export function CustomPreviewPlaceholder() {
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
