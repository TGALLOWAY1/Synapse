import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, ArrowUp, type LucideIcon } from 'lucide-react';
import { useIsMobile } from '../../lib/useIsMobile';

// Reusable "table-of-contents" navigation shared by document-style artifacts
// (Developer Prompts today; mirrors the inline Pages navigator in MockupViewer).
// It owns the collapsible shell, scroll-spy active tracking, smooth
// scroll-to-section, mobile collapse-on-select, and the floating reopen pill —
// so each artifact only supplies its section ids and a row renderer instead of
// reinventing a navigation style.
//
// The parent renders the actual sections in document order; each section must
// carry the matching DOM id from `sectionIds` and a `scroll-mt-*` offset so the
// sticky workspace chrome doesn't cover the jump target.

export interface CollapsibleArtifactNavProps {
    /** Heading label, e.g. "Prompts". */
    label: string;
    /** Icon shown next to the label. */
    icon?: LucideIcon;
    /** DOM ids of each navigable section, in document order. */
    sectionIds: string[];
    /** Render the inner content of row `index`. The component owns the button. */
    renderRow: (index: number, active: boolean) => ReactNode;
}

export function CollapsibleArtifactNav({
    label,
    icon: Icon,
    sectionIds,
    renderRow,
}: CollapsibleArtifactNavProps) {
    const isMobile = useIsMobile();
    const [navOpen, setNavOpen] = useState(true);
    const [activeIndex, setActiveIndex] = useState(0);
    const [showFloatingNav, setShowFloatingNav] = useState(false);
    const navRef = useRef<HTMLDivElement | null>(null);

    const count = sectionIds.length;
    const sectionKey = sectionIds.join('|');

    // Scroll-spy: track which section is most visible so the active row stays in
    // sync as the user scrolls the document.
    useEffect(() => {
        if (typeof IntersectionObserver === 'undefined') return;
        const ids = sectionKey ? sectionKey.split('|') : [];
        const elements = ids
            .map((id) => document.getElementById(id))
            .filter((el): el is HTMLElement => el != null);
        if (elements.length === 0) return;
        const observer = new IntersectionObserver(
            (entries) => {
                let best: { idx: number; ratio: number } | null = null;
                for (const entry of entries) {
                    if (!entry.isIntersecting) continue;
                    const idx = ids.indexOf(entry.target.id);
                    if (idx < 0) continue;
                    if (!best || entry.intersectionRatio > best.ratio) {
                        best = { idx, ratio: entry.intersectionRatio };
                    }
                }
                if (best) setActiveIndex(best.idx);
            },
            { rootMargin: '-15% 0px -60% 0px', threshold: [0, 0.25, 0.5, 0.75, 1] },
        );
        elements.forEach((el) => observer.observe(el));
        return () => observer.disconnect();
    }, [sectionKey]);

    // Show the floating reopen pill (mobile only) once the navigator card has
    // scrolled out of view.
    useEffect(() => {
        if (typeof IntersectionObserver === 'undefined') return;
        const el = navRef.current;
        if (!el) return;
        const observer = new IntersectionObserver(
            (entries) => setShowFloatingNav(!entries[0].isIntersecting),
            { threshold: 0 },
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    const scrollToSection = (idx: number) => {
        const el = document.getElementById(sectionIds[idx]);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    const handleSelect = (idx: number) => {
        setActiveIndex(idx);
        scrollToSection(idx);
        // On mobile, collapse after a tap so the section itself is the next
        // thing on screen — the floating pill handles re-opening.
        if (isMobile) setNavOpen(false);
    };

    const handleOpenFloating = () => {
        setNavOpen(true);
        if (navRef.current) navRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    if (count === 0) return null;

    return (
        <>
            <div
                ref={navRef}
                className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden"
            >
                <button
                    type="button"
                    onClick={() => setNavOpen(!navOpen)}
                    className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-neutral-50/60 transition"
                    aria-expanded={navOpen}
                    aria-controls="collapsible-artifact-nav-list"
                >
                    <span className="inline-flex items-center gap-2 text-sm font-semibold text-neutral-900">
                        {Icon && <Icon size={15} className="text-neutral-500" aria-hidden="true" />}
                        {label}
                        <span className="text-neutral-400 font-normal">({count})</span>
                    </span>
                    {navOpen ? (
                        <ChevronDown size={16} className="text-neutral-400 shrink-0" />
                    ) : (
                        <ChevronRight size={16} className="text-neutral-400 shrink-0" />
                    )}
                </button>
                {navOpen && (
                    <ul
                        id="collapsible-artifact-nav-list"
                        className="border-t border-neutral-100 pb-1"
                    >
                        {sectionIds.map((id, idx) => {
                            const active = idx === activeIndex;
                            return (
                                <li key={id}>
                                    <button
                                        type="button"
                                        onClick={() => handleSelect(idx)}
                                        aria-current={active ? 'true' : undefined}
                                        className={`w-full px-4 py-3 flex items-center gap-3 text-left border-l-2 transition ${
                                            active
                                                ? 'border-indigo-500 bg-indigo-50/50'
                                                : 'border-transparent hover:bg-neutral-50'
                                        }`}
                                    >
                                        {renderRow(idx, active)}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>

            {/* Floating reopen pill (mobile only) — surfaces once the navigator
                card has scrolled out of view. */}
            {isMobile && showFloatingNav && (
                <button
                    type="button"
                    onClick={handleOpenFloating}
                    className="md:hidden fixed bottom-5 right-5 z-30 inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-full bg-neutral-900 text-white text-xs font-semibold shadow-lg hover:bg-neutral-800 active:scale-[0.98] transition"
                    style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 1.25rem)' }}
                    aria-label={`Open ${label} navigator`}
                >
                    {Icon && <Icon size={14} />}
                    {label}
                    <span className="text-[10px] opacity-70 tabular-nums">
                        {activeIndex + 1}/{count}
                    </span>
                    <ArrowUp size={12} className="opacity-70" />
                </button>
            )}
        </>
    );
}
