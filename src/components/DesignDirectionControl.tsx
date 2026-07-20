import { Palette, Wand2 } from 'lucide-react';
import { getDesignSystemPresetLabel } from '../lib/designSystemPresets';

interface DesignDirectionControlProps {
    /** Preset id stored on the project, if any. */
    presetId?: string;
    /** Open the preset picker to change the visual direction. */
    onChangeDirection: () => void;
}

/**
 * Post-finalization control on the Design System artifact. The visual direction
 * is otherwise only chosen once, on Mark as Final — projects finalized before
 * the preset feature existed have no way to pick or change it. Changing the
 * direction chains into the regenerate confirmation (ArtifactWorkspace's
 * handleChooseDirection), so no separate regenerate affordance is needed here.
 *
 * Presentational only: all state + the actual regeneration live in
 * ArtifactWorkspace, which owns the generation context.
 */
export function DesignDirectionControl({
    presetId,
    onChangeDirection,
}: DesignDirectionControlProps) {
    const label = getDesignSystemPresetLabel(presetId);
    return (
        <div className="rounded-xl border border-neutral-200 bg-white px-4 py-2.5 not-prose">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <div className="shrink-0 w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                    <Palette size={14} />
                </div>
                <p className="min-w-0 flex-1 text-sm text-neutral-900">
                    <span className="font-semibold">Design direction:</span>{' '}
                    {label ? (
                        <span className="font-medium text-neutral-800">{label}</span>
                    ) : (
                        <span className="text-neutral-600">
                            none chosen — generated from your PRD alone
                            (<span className="font-medium text-neutral-800">AI decides</span>)
                        </span>
                    )}
                </p>
                <button
                    type="button"
                    onClick={onChangeDirection}
                    className="ml-auto inline-flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-xs bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-md transition"
                >
                    <Wand2 size={12} /> Change direction
                </button>
            </div>
        </div>
    );
}
