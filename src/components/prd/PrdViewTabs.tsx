import { useRef } from 'react';
import { FileText, Layers, GitBranch } from 'lucide-react';
import { PRD_VIEWS, type PrdViewId } from '../../lib/derive/prdViews';

// Segmented tab navigation for the three coordinated PRD views. Uses proper
// ARIA tablist semantics with roving arrow-key navigation. The row scrolls
// horizontally on very narrow screens rather than shrinking labels, and never
// overflows the page (min-w-0 + overflow-x-auto on the container).

const ICONS: Record<PrdViewId, typeof FileText> = {
    overview: FileText,
    features: Layers,
    decisions: GitBranch,
};

interface Props {
    active: PrdViewId;
    onChange: (view: PrdViewId) => void;
    /** Optional per-view count badge (e.g. feature count, decisions pending). */
    counts?: Partial<Record<PrdViewId, number>>;
}

export function PrdViewTabs({ active, onChange, counts }: Props) {
    const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

    const onKeyDown = (e: React.KeyboardEvent) => {
        const idx = PRD_VIEWS.findIndex(v => v.id === active);
        if (idx < 0) return;
        let next = idx;
        if (e.key === 'ArrowRight') next = (idx + 1) % PRD_VIEWS.length;
        else if (e.key === 'ArrowLeft') next = (idx - 1 + PRD_VIEWS.length) % PRD_VIEWS.length;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = PRD_VIEWS.length - 1;
        else return;
        e.preventDefault();
        const target = PRD_VIEWS[next];
        onChange(target.id);
        tabRefs.current[target.id]?.focus();
    };

    return (
        <div
            role="tablist"
            aria-label="PRD views"
            onKeyDown={onKeyDown}
            className="flex items-center gap-1 overflow-x-auto -mx-1 px-1 mb-6 border-b border-neutral-200"
        >
            {PRD_VIEWS.map(view => {
                const Icon = ICONS[view.id];
                const isActive = view.id === active;
                const count = counts?.[view.id];
                return (
                    <button
                        key={view.id}
                        ref={el => { tabRefs.current[view.id] = el; }}
                        role="tab"
                        id={`prd-tab-${view.id}`}
                        aria-selected={isActive}
                        aria-controls={`prd-panel-${view.id}`}
                        tabIndex={isActive ? 0 : -1}
                        onClick={() => onChange(view.id)}
                        className={`relative flex items-center gap-2 whitespace-nowrap px-3 sm:px-4 py-2.5 text-sm font-semibold transition -mb-px border-b-2 ${
                            isActive
                                ? 'text-indigo-600 border-indigo-600'
                                : 'text-neutral-500 border-transparent hover:text-neutral-800'
                        }`}
                    >
                        <Icon size={16} className="shrink-0" aria-hidden />
                        {view.label}
                        {typeof count === 'number' && count > 0 && (
                            <span
                                className={`ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[11px] font-bold ${
                                    isActive ? 'bg-indigo-100 text-indigo-700' : 'bg-neutral-100 text-neutral-500'
                                }`}
                            >
                                {count}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}
