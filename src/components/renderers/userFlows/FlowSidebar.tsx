import { useEffect } from 'react';
import { Menu, X } from 'lucide-react';
import type { FlowCategory, ParsedFlow } from './types';
import { CATEGORY_ORDER } from './categorize';

interface Props {
    flows: ParsedFlow[];
    selectedIndex: number;
    onSelect: (index: number) => void;
    isMobileOpen: boolean;
    onToggleMobile: (open: boolean) => void;
}

type Grouped = { category: FlowCategory; items: Array<{ flow: ParsedFlow; originalIndex: number }> };

function groupFlows(flows: ParsedFlow[]): Grouped[] {
    const map = new Map<FlowCategory, Array<{ flow: ParsedFlow; originalIndex: number }>>();
    flows.forEach((flow, originalIndex) => {
        const list = map.get(flow.category) ?? [];
        list.push({ flow, originalIndex });
        map.set(flow.category, list);
    });
    return CATEGORY_ORDER
        .filter(cat => map.has(cat))
        .map(category => ({ category, items: map.get(category)! }));
}

export function FlowSidebar({ flows, selectedIndex, onSelect, isMobileOpen, onToggleMobile }: Props) {
    const grouped = groupFlows(flows);
    const selected = flows[selectedIndex];

    useEffect(() => {
        if (!isMobileOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onToggleMobile(false);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isMobileOpen, onToggleMobile]);

    const renderList = (onPick: (i: number) => void) => (
        <div className="space-y-4">
            {grouped.map(group => (
                <div key={group.category}>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-1.5 px-2">
                        {group.category}
                    </p>
                    <ul className="space-y-0.5">
                        {group.items.map(({ flow, originalIndex }) => {
                            const active = originalIndex === selectedIndex;
                            const errorCount = flow.errorPaths.length;
                            const stepCount = flow.steps.length;
                            return (
                                <li key={originalIndex}>
                                    <button
                                        type="button"
                                        onClick={() => onPick(originalIndex)}
                                        className={`w-full text-left px-2 py-2 rounded-md transition border-l-2 ${
                                            active
                                                ? 'bg-indigo-50 border-indigo-600 text-indigo-900'
                                                : 'border-transparent hover:bg-neutral-100 text-neutral-700'
                                        }`}
                                    >
                                        <div className="text-sm font-medium leading-snug line-clamp-2">
                                            {flow.title}
                                        </div>
                                        <div className="mt-1 flex items-center gap-2 text-[10px] text-neutral-500">
                                            <span>
                                                {stepCount} {stepCount === 1 ? 'step' : 'steps'}
                                            </span>
                                            {errorCount > 0 && (
                                                <>
                                                    <span aria-hidden="true">·</span>
                                                    <span className="text-red-600">
                                                        {errorCount} {errorCount === 1 ? 'error' : 'errors'}
                                                    </span>
                                                </>
                                            )}
                                        </div>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            ))}
        </div>
    );

    return (
        <>
            {/* Desktop rail */}
            <aside
                className="hidden md:block w-60 shrink-0 self-start sticky top-0 max-h-[calc(100vh-6rem)] overflow-y-auto pr-2 border-r border-neutral-200"
                aria-label="Flow navigation"
            >
                {renderList(onSelect)}
            </aside>

            {/* Mobile trigger */}
            <div className="md:hidden mb-3 flex items-center justify-between gap-2">
                <button
                    type="button"
                    onClick={() => onToggleMobile(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-neutral-300 rounded-md text-neutral-700 hover:bg-neutral-50"
                >
                    <Menu size={14} /> Flows
                    <span className="text-neutral-400">({flows.length})</span>
                </button>
                {selected && (
                    <span className="text-xs text-neutral-500 truncate flex-1 text-right">
                        {selected.title}
                    </span>
                )}
            </div>

            {/* Mobile drawer overlay + panel */}
            {isMobileOpen && (
                <button
                    type="button"
                    aria-label="Close flow navigation"
                    onClick={() => onToggleMobile(false)}
                    className="md:hidden fixed inset-0 bg-black/40 z-40"
                />
            )}
            <aside
                className={`md:hidden fixed top-0 left-0 h-full w-72 max-w-[85vw] bg-white border-r border-neutral-200 z-50 transform transition-transform duration-200 ease-out ${
                    isMobileOpen ? 'translate-x-0' : '-translate-x-full'
                }`}
                aria-hidden={!isMobileOpen}
            >
                <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-200">
                    <span className="text-sm font-semibold text-neutral-900">Flows</span>
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
