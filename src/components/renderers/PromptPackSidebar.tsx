import { useEffect } from 'react';
import { Menu, X } from 'lucide-react';

// In-page navigation for the Prompt Pack artifact. Mirrors the User Flows
// FlowSidebar shell (desktop rail + mobile drawer) so artifact navigation
// stays consistent across the workspace. Shows one prompt at a time.

export type PromptNavItem = {
    index: number;
    title: string;
    category?: string;
};

interface Props {
    items: PromptNavItem[];
    selectedIndex: number;
    onSelect: (index: number) => void;
    isMobileOpen: boolean;
    onToggleMobile: (open: boolean) => void;
    /** Prompt indices with user edits, surfaced as a "Modified" marker. */
    modifiedIndices?: Set<number>;
}

export function PromptPackSidebar({
    items, selectedIndex, onSelect, isMobileOpen, onToggleMobile, modifiedIndices,
}: Props) {
    const selected = items[selectedIndex];

    useEffect(() => {
        if (!isMobileOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onToggleMobile(false);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isMobileOpen, onToggleMobile]);

    const renderList = (onPick: (i: number) => void) => (
        <ul className="space-y-1">
            {items.map((item, i) => {
                const active = i === selectedIndex;
                const modified = modifiedIndices?.has(item.index) ?? false;
                return (
                    <li key={item.index}>
                        <button
                            type="button"
                            onClick={() => onPick(i)}
                            aria-current={active ? 'true' : undefined}
                            className={`w-full text-left px-2.5 py-2.5 rounded-md transition border ${
                                active
                                    ? 'bg-indigo-50 border-indigo-200 ring-1 ring-indigo-200 text-indigo-900 shadow-sm'
                                    : 'border-transparent hover:bg-neutral-50 text-neutral-700'
                            }`}
                        >
                            <div className="flex items-start gap-2">
                                <span
                                    className={`shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${
                                        active
                                            ? 'bg-indigo-600 text-white'
                                            : 'bg-neutral-200 text-neutral-700'
                                    }`}
                                >
                                    {item.index}
                                </span>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-start gap-1.5">
                                        <p
                                            className="text-sm font-medium leading-snug break-words min-w-0 flex-1"
                                            title={item.title}
                                        >
                                            {item.title}
                                        </p>
                                        {modified && (
                                            <span className="mt-0.5 shrink-0 text-[9px] font-medium px-1 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
                                                Edited
                                            </span>
                                        )}
                                    </div>
                                    {item.category && (
                                        <p className="mt-0.5 text-[10px] text-neutral-500 truncate">
                                            {item.category}
                                        </p>
                                    )}
                                </div>
                            </div>
                        </button>
                    </li>
                );
            })}
        </ul>
    );

    return (
        <>
            {/* Desktop rail */}
            <aside
                className="hidden md:block w-72 shrink-0 self-start sticky top-0 max-h-[calc(100vh-6rem)] overflow-y-auto pr-2 border-r border-neutral-200"
                aria-label="Prompt navigation"
            >
                <div className="px-2 mb-3 flex items-center justify-between">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-700">
                        Prompts
                    </p>
                    <span className="text-[10px] text-neutral-400 font-mono">{items.length}</span>
                </div>
                {renderList(onSelect)}
            </aside>

            {/* Mobile trigger */}
            <div className="md:hidden mb-3 flex items-center justify-between gap-2">
                <button
                    type="button"
                    onClick={() => onToggleMobile(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-neutral-300 rounded-md text-neutral-700 hover:bg-neutral-50"
                >
                    <Menu size={14} /> Prompts
                    <span className="text-neutral-400">({items.length})</span>
                </button>
                {selected && (
                    <span className="text-xs text-neutral-500 truncate flex-1 text-right">
                        {selected.index}. {selected.title}
                    </span>
                )}
            </div>

            {/* Mobile drawer overlay + panel */}
            {isMobileOpen && (
                <button
                    type="button"
                    aria-label="Close prompt navigation"
                    onClick={() => onToggleMobile(false)}
                    className="md:hidden fixed inset-0 bg-black/40 z-40"
                />
            )}
            <aside
                className={`md:hidden fixed top-0 left-0 h-full w-80 max-w-[85vw] bg-white border-r border-neutral-200 z-50 transform transition-transform duration-200 ease-out ${
                    isMobileOpen ? 'translate-x-0' : '-translate-x-full'
                }`}
                aria-hidden={!isMobileOpen}
            >
                <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-200">
                    <span className="text-sm font-semibold text-neutral-900">Prompts</span>
                    <button
                        type="button"
                        onClick={() => onToggleMobile(false)}
                        className="p-1 rounded hover:bg-neutral-100 text-neutral-500"
                        aria-label="Close"
                    >
                        <X size={16} />
                    </button>
                </div>
                <div className="overflow-y-auto h-[calc(100%-2.75rem)] p-2">
                    {renderList(i => {
                        onSelect(i);
                        onToggleMobile(false);
                    })}
                </div>
            </aside>
        </>
    );
}
