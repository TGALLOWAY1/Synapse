import { X } from 'lucide-react';
import { DESIGN_SYSTEM_PRESETS } from '../lib/designSystemPresets';

interface DesignSystemPresetChoiceProps {
    onChoose: (presetId: string) => void;
    onClose: () => void;
}

/**
 * One-time "visual direction" choice shown right before assets are generated
 * (on Mark as Final). The selected preset is stored on the project and steers
 * design-system generation — and through it, both the internal mockups and the
 * prompts users copy for external image tools, so the two stay consistent.
 *
 * Responsive: centered dialog on desktop, full-width bottom sheet on mobile —
 * mirrors PreflightModeChoice.
 */
export function DesignSystemPresetChoice({ onChoose, onClose }: DesignSystemPresetChoiceProps) {
    return (
        <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center z-50"
            onClick={onClose}
        >
            <div
                className="bg-neutral-900 border border-white/10 rounded-t-3xl sm:rounded-3xl w-full sm:max-w-lg max-h-[90vh] overflow-y-auto"
                style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-6 pt-6 pb-2">
                    <h2 className="text-lg font-semibold text-white">Choose your visual direction</h2>
                    <button
                        onClick={onClose}
                        className="p-2 -mr-2 text-neutral-400 hover:text-white rounded-lg transition"
                        aria-label="Cancel"
                    >
                        <X size={18} />
                    </button>
                </div>
                <p className="px-6 text-sm text-neutral-400 mb-1">
                    This sets your project's design system. Internal mockups and the prompts you copy
                    for external image tools will both follow it, so everything stays visually consistent.
                </p>
                <p className="px-6 text-xs text-neutral-500 mb-4">
                    You can regenerate the design system later, but that may change your mockups and
                    screen-level prompts.
                </p>
                <div className="px-4 pb-5 space-y-2">
                    {DESIGN_SYSTEM_PRESETS.map(({ id, icon: Icon, label, subtitle, detail }) => (
                        <button
                            key={id}
                            onClick={() => onChoose(id)}
                            className="w-full text-left flex items-start gap-4 p-4 min-h-[64px] rounded-2xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.07] hover:border-indigo-500/50 transition group"
                        >
                            <div className="shrink-0 w-10 h-10 rounded-xl bg-indigo-500/15 text-indigo-300 flex items-center justify-center group-hover:bg-indigo-500/25 transition">
                                <Icon size={18} />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-medium text-white">{label}</span>
                                    <span className="text-xs text-indigo-300/80 bg-indigo-500/10 px-2 py-0.5 rounded-full">
                                        {subtitle}
                                    </span>
                                </div>
                                <p className="text-sm text-neutral-400 mt-0.5">{detail}</p>
                            </div>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
