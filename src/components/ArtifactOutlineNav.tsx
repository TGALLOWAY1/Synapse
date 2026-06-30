import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, List, ArrowUp } from 'lucide-react';
import { useIsMobile } from '../lib/useIsMobile';

/**
 * A single row in the artifact outline.
 */
export type ArtifactOutlineItem = {
    id: string;
    label: string;
    description?: string;
    /** Compact metadata shown on the right of the row, e.g. "11 tokens". */
    countLabel?: string;
};

export type ArtifactOutlineNavProps = {
    /** Group label, e.g. "Sections" or "Entities". */
    title: string;
    items: ArtifactOutlineItem[];
    activeId: string;
    /** Badge text for the active row, e.g. "Current section" or "Current entity". */
    activeLabel: string;
    defaultExpanded?: boolean;
    /** Collapse after a row is selected (used on mobile to reduce scrolling). */
    collapseOnSelect?: boolean;
    onSelect: (id: string) => void;
};

/**
 * Shared, collapsible outline navigation for long structured artifacts.
 *
 * Replaces the wrapping "pill" nav (`SectionTabs`) on the Design System and
 * Data Model pages with a single scannable list/card that mirrors the refined
 * Mockups "Pages" navigator: a collapsible header, compact numbered rows, a
 * subtle purple highlight + badge on the current row, and (on mobile) a
 * floating button to re-open the outline once it scrolls out of view.
 *
 * The component is presentational/controlled — it surfaces selection via
 * `onSelect`; the owning renderer pairs it with `useArtifactOutline` for the
 * scroll-spy (`activeId`) and smooth-scroll/hash behaviour.
 */
export function ArtifactOutlineNav({
    title,
    items,
    activeId,
    activeLabel,
    defaultExpanded = true,
    collapseOnSelect = false,
    onSelect,
}: ArtifactOutlineNavProps) {
    const isMobile = useIsMobile();
    const [expanded, setExpanded] = useState(defaultExpanded);

    const navRef = useRef<HTMLDivElement | null>(null);
    const [showFloating, setShowFloating] = useState(false);

    // Show the floating re-open control (mobile only) once the outline card has
    // scrolled out of view — mirrors the Mockups navigator.
    useEffect(() => {
        if (typeof IntersectionObserver === 'undefined') return;
        const el = navRef.current;
        if (!el) return;
        const observer = new IntersectionObserver(
            (entries) => setShowFloating(!entries[0].isIntersecting),
            { threshold: 0 },
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    if (items.length === 0) return null;

    const activeItem = items.find(i => i.id === activeId) ?? items[0];

    const handleSelect = (id: string) => {
        onSelect(id);
        if (collapseOnSelect) setExpanded(false);
    };

    const handleOpenFloating = () => {
        setExpanded(true);
        navRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    const listId = `artifact-outline-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

    return (
        <>
            <div
                ref={navRef}
                className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden"
            >
                {/* Collapsible header */}
                <button
                    type="button"
                    onClick={() => setExpanded(prev => !prev)}
                    className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-neutral-50/60 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-inset"
                    aria-expanded={expanded}
                    aria-controls={listId}
                >
                    <span className="inline-flex items-center gap-2 min-w-0 text-sm font-semibold text-neutral-900">
                        <List size={15} className="text-neutral-500 shrink-0" />
                        <span className="shrink-0">{title}</span>
                        <span className="text-neutral-400 font-normal shrink-0">({items.length})</span>
                        {!expanded && (
                            <span className="text-neutral-400 font-normal truncate">
                                · Current: <span className="text-neutral-600">{activeItem.label}</span>
                            </span>
                        )}
                    </span>
                    {expanded
                        ? <ChevronDown size={16} className="text-neutral-400 shrink-0" />
                        : <ChevronRight size={16} className="text-neutral-400 shrink-0" />}
                </button>

                {expanded && (
                    <ul
                        id={listId}
                        className="border-t border-neutral-100 max-h-[60vh] overflow-y-auto"
                    >
                        {items.map((item, idx) => {
                            const active = item.id === activeId;
                            return (
                                <li key={item.id}>
                                    <button
                                        type="button"
                                        onClick={() => handleSelect(item.id)}
                                        aria-current={active ? 'true' : undefined}
                                        className={`w-full px-4 min-h-[44px] py-2.5 md:min-h-0 md:py-2 flex items-center gap-3 text-left border-l-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-inset ${
                                            active
                                                ? 'border-indigo-500 bg-indigo-50/50'
                                                : 'border-transparent hover:bg-neutral-50'
                                        }`}
                                    >
                                        <span
                                            className={`shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-[11px] font-semibold tabular-nums ${
                                                active
                                                    ? 'bg-indigo-100 text-indigo-700'
                                                    : 'bg-neutral-100 text-neutral-500'
                                            }`}
                                        >
                                            {idx + 1}
                                        </span>
                                        <span className="flex-1 min-w-0">
                                            <span className="flex items-center gap-2 min-w-0">
                                                <span
                                                    className={`block text-sm font-medium truncate ${
                                                        active ? 'text-indigo-900' : 'text-neutral-900'
                                                    }`}
                                                >
                                                    {item.label}
                                                </span>
                                                {active && (
                                                    <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                                                        {activeLabel}
                                                    </span>
                                                )}
                                            </span>
                                            {item.description && (
                                                <span className="block text-xs text-neutral-500 truncate">
                                                    {item.description}
                                                </span>
                                            )}
                                        </span>
                                        {item.countLabel && (
                                            <span className="shrink-0 text-[11px] text-neutral-400 tabular-nums">
                                                {item.countLabel}
                                            </span>
                                        )}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>

            {/* Floating re-open control (mobile only). */}
            {isMobile && showFloating && (
                <button
                    type="button"
                    onClick={handleOpenFloating}
                    className="md:hidden fixed bottom-5 right-5 z-30 inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-full bg-neutral-900 text-white text-xs font-semibold shadow-lg hover:bg-neutral-800 active:scale-[0.98] transition"
                    style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 1.25rem)' }}
                    aria-label={`Open ${title} outline`}
                >
                    <List size={14} />
                    {title}
                    <span className="text-[10px] opacity-70 truncate max-w-[7rem]">{activeItem.label}</span>
                    <ArrowUp size={12} className="opacity-70" />
                </button>
            )}
        </>
    );
}
