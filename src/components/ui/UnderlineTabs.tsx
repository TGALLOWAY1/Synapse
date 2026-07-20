import { useRef, type ReactNode } from 'react';

// Shared underline-style tab navigation. Generalized from
// src/components/prd/PrdViewTabs.tsx (the PRD Overview/Features switch) so any
// two-or-more-way view toggle can use proper ARIA tablist semantics: a
// role="tablist" container, role="tab" buttons with aria-selected, and roving
// tabIndex with Arrow/Home/End key navigation instead of every tab being in
// natural tab order.

export interface UnderlineTab {
    id: string;
    label: ReactNode;
    icon?: ReactNode;
    /** Optional per-tab count badge (e.g. item count, pending count). */
    count?: number;
    /** Optional accessible name override, for a non-text `label`. */
    ariaLabel?: string;
    /** Optional DOM id for the tab button, e.g. so an external panel can
     * reference it via `aria-labelledby`. */
    domId?: string;
    /** Optional id of the panel this tab controls (sets `aria-controls`). */
    controls?: string;
}

export interface UnderlineTabsProps {
    tabs: UnderlineTab[];
    activeId: string;
    onChange: (id: string) => void;
    /** Accessible name for the tablist container. */
    ariaLabel: string;
    /** `md` (default) matches PrdViewTabs sizing; `sm` is more compact. */
    size?: 'sm' | 'md';
    className?: string;
}

export function UnderlineTabs({ tabs, activeId, onChange, ariaLabel, size = 'md', className }: UnderlineTabsProps) {
    const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

    const onKeyDown = (e: React.KeyboardEvent) => {
        const idx = tabs.findIndex(tab => tab.id === activeId);
        if (idx < 0) return;
        let next = idx;
        if (e.key === 'ArrowRight') next = (idx + 1) % tabs.length;
        else if (e.key === 'ArrowLeft') next = (idx - 1 + tabs.length) % tabs.length;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = tabs.length - 1;
        else return;
        e.preventDefault();
        const target = tabs[next];
        onChange(target.id);
        tabRefs.current[target.id]?.focus();
    };

    const minHeight = size === 'sm' ? 'min-h-10' : 'min-h-11';
    const padding = size === 'sm' ? 'px-2.5 py-2 text-sm' : 'px-3 sm:px-4 py-2.5 text-sm';

    return (
        <div
            role="tablist"
            aria-label={ariaLabel}
            onKeyDown={onKeyDown}
            className={`flex border-b border-neutral-200${className ? ` ${className}` : ''}`}
        >
            {tabs.map(tab => {
                const isActive = tab.id === activeId;
                return (
                    <button
                        key={tab.id}
                        ref={el => { tabRefs.current[tab.id] = el; }}
                        type="button"
                        role="tab"
                        id={tab.domId}
                        aria-selected={isActive}
                        aria-label={tab.ariaLabel}
                        aria-controls={tab.controls}
                        tabIndex={isActive ? 0 : -1}
                        onClick={() => onChange(tab.id)}
                        className={`relative flex items-center justify-center gap-2 whitespace-nowrap ${minHeight} ${padding} font-semibold transition -mb-px border-b-2 ${
                            isActive
                                ? 'text-indigo-700 border-indigo-600'
                                : 'text-neutral-500 border-transparent hover:text-neutral-800'
                        }`}
                    >
                        {tab.icon && <span className="shrink-0" aria-hidden>{tab.icon}</span>}
                        {tab.label}
                        {typeof tab.count === 'number' && tab.count > 0 && (
                            <span
                                className={`ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[11px] font-bold ${
                                    isActive ? 'bg-indigo-100 text-indigo-700' : 'bg-neutral-100 text-neutral-500'
                                }`}
                            >
                                {tab.count}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}
