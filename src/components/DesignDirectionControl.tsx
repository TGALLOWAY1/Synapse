import { Palette, Wand2, RefreshCcw } from 'lucide-react';
import { getDesignSystemPresetLabel } from '../lib/designSystemPresets';

interface DesignDirectionControlProps {
    /** Preset id stored on the project, if any. */
    presetId?: string;
    /** Open the preset picker to change the visual direction. */
    onChangeDirection: () => void;
    /** Regenerate the design system (applies the current direction). */
    onRegenerate: () => void;
}

/**
 * Post-finalization control on the Design System artifact. The visual direction
 * is otherwise only chosen once, on Mark as Final — projects finalized before
 * the preset feature existed have no way to pick or change it. This card lets
 * the user (re)select a direction and regenerate the design system so the new
 * tokens flow through to mockups and the copied screen prompts.
 *
 * Presentational only: all state + the actual regeneration live in
 * ArtifactWorkspace, which owns the generation context.
 */
export function DesignDirectionControl({
    presetId,
    onChangeDirection,
    onRegenerate,
}: DesignDirectionControlProps) {
    const label = getDesignSystemPresetLabel(presetId);
    return (
        <div className="rounded-xl border border-neutral-200 bg-white p-4 not-prose">
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-start gap-3 min-w-0">
                    <div className="shrink-0 w-9 h-9 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                        <Palette size={16} />
                    </div>
                    <div className="min-w-0">
                        <p className="text-sm font-semibold text-neutral-900">Design direction</p>
                        {label ? (
                            <p className="text-xs text-neutral-600 mt-0.5">
                                Current: <span className="font-medium text-neutral-800">{label}</span>
                            </p>
                        ) : (
                            <p className="text-xs text-neutral-600 mt-0.5">
                                No direction chosen — the design system was generated from your PRD alone
                                (<span className="font-medium text-neutral-800">AI decides</span>).
                            </p>
                        )}
                        <p className="text-xs text-neutral-500 mt-1">
                            Changing the direction takes effect when you regenerate the design system. That
                            produces new tokens and may make your existing mockups out of date.
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <button
                        type="button"
                        onClick={onChangeDirection}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-md transition"
                    >
                        <Wand2 size={12} /> Change direction
                    </button>
                    <button
                        type="button"
                        onClick={onRegenerate}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded-md transition"
                    >
                        <RefreshCcw size={12} /> Regenerate
                    </button>
                </div>
            </div>
        </div>
    );
}
