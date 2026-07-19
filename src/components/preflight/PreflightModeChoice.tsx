import { Zap, MessagesSquare, Compass, X } from 'lucide-react';
import type { PreflightMode } from '../../types';

interface PreflightModeChoiceProps {
    onChoose: (mode: PreflightMode) => void;
    onClose: () => void;
}

const OPTIONS: {
    mode: PreflightMode;
    icon: typeof Zap;
    title: string;
    subtitle: string;
    detail: string;
}[] = [
    {
        mode: 'quick',
        icon: MessagesSquare,
        title: 'Develop the idea',
        subtitle: 'Recommended',
        detail: 'Resolve a focused set of questions that could materially change the product.',
    },
    {
        mode: 'none',
        icon: Zap,
        title: 'Draft a working plan',
        subtitle: 'Fastest',
        detail: 'Start from the idea now. Synapse will keep inferred assumptions visible for later review.',
    },
    {
        mode: 'deep',
        icon: Compass,
        title: 'Explore deeply',
        subtitle: 'Broader discovery',
        detail: 'Examine users, outcomes, constraints, and edge cases before drafting the working plan.',
    },
];

/**
 * Post-idea choice: how to reduce initial uncertainty. A fast working-plan
 * draft remains available without implying that generated detail is settled.
 * centered dialog on desktop, full-width bottom sheet on mobile.
 */
export function PreflightModeChoice({ onChoose, onClose }: PreflightModeChoiceProps) {
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
                    <h2 className="text-lg font-semibold text-white">How would you like to start?</h2>
                    <button
                        onClick={onClose}
                        className="p-2 -mr-2 text-neutral-400 hover:text-white rounded-lg transition"
                        aria-label="Cancel"
                    >
                        <X size={18} />
                    </button>
                </div>
                <p className="px-6 text-sm text-neutral-400 mb-4">
                    Start with the level of discovery that is useful now. You can keep exploring after the plan is drafted.
                </p>
                <div className="px-4 pb-5 space-y-2">
                    {OPTIONS.map(({ mode, icon: Icon, title, subtitle, detail }) => (
                        <button
                            key={mode}
                            onClick={() => onChoose(mode)}
                            className="w-full text-left flex items-start gap-4 p-4 min-h-[64px] rounded-2xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.07] hover:border-indigo-500/50 transition group"
                        >
                            <div className="shrink-0 w-10 h-10 rounded-xl bg-indigo-500/15 text-indigo-300 flex items-center justify-center group-hover:bg-indigo-500/25 transition">
                                <Icon size={18} />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="font-medium text-white">{title}</span>
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
