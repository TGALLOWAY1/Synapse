import { Sparkles, Maximize2, SlidersHorizontal, Shuffle, RefreshCw } from 'lucide-react';
import { REFINE_ACTIONS, type RefineAction } from '../tourData';

/**
 * The five refinement actions, mirroring `SELECTION_ACTIONS` from
 * SelectionActionDialog (the real PRD highlight pipeline). Kept as local demo
 * data so the tour stays self-contained.
 */
const ACTION_ICON: Record<RefineAction, typeof Sparkles> = {
    Clarify: Sparkles,
    Expand: Maximize2,
    Specify: SlidersHorizontal,
    Alternative: Shuffle,
    Replace: RefreshCw,
};

export function RefineMenu({
    onSelect,
    activeAction,
}: {
    onSelect: (action: RefineAction) => void;
    activeAction: RefineAction | null;
}) {
    return (
        <div
            role="menu"
            aria-label="Refinement actions"
            className="flex flex-col gap-1 rounded-xl border border-indigo-500/40 bg-neutral-900/95 p-1.5 shadow-2xl backdrop-blur"
        >
            {REFINE_ACTIONS.map((action) => {
                const Icon = ACTION_ICON[action];
                const isActive = activeAction === action;
                return (
                    <button
                        key={action}
                        type="button"
                        role="menuitem"
                        onClick={() => onSelect(action)}
                        className={`flex min-h-[40px] items-center gap-2.5 rounded-lg px-3 text-sm transition ${
                            isActive
                                ? 'bg-indigo-500/20 text-indigo-200'
                                : 'text-neutral-200 hover:bg-white/5'
                        }`}
                    >
                        <Icon size={16} className="text-indigo-300" aria-hidden="true" />
                        {action}
                    </button>
                );
            })}
        </div>
    );
}
