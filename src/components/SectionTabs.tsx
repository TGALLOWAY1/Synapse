import { useEffect, useState } from 'react';

// Sticky in-page section nav for long artifacts. Sits at the top of the
// artifact main pane (which is the scroll container) and tracks the
// currently-visible section via IntersectionObserver. Click a pill to
// scroll to the matching anchor.
//
// Items must point to elements that exist in the DOM at render time and
// carry the `scroll-mt-24` class so the sticky header doesn't cover the
// jump target.

export type SectionTabItem = {
    id: string;
    label: string;
};

interface Props {
    items: SectionTabItem[];
}

export function SectionTabs({ items }: Props) {
    const [activeId, setActiveId] = useState<string | null>(items[0]?.id ?? null);

    useEffect(() => {
        if (items.length === 0) return;
        const elements = items
            .map(item => document.getElementById(item.id))
            .filter((el): el is HTMLElement => el != null);
        if (elements.length === 0) return;
        const observer = new IntersectionObserver(
            (entries) => {
                // Choose the topmost intersecting entry.
                const visible = entries
                    .filter(e => e.isIntersecting)
                    .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
                if (visible.length > 0) {
                    setActiveId(visible[0].target.id);
                }
            },
            { rootMargin: '-100px 0px -60% 0px', threshold: 0 },
        );
        elements.forEach(el => observer.observe(el));
        return () => observer.disconnect();
    }, [items]);

    if (items.length <= 1) return null;

    return (
        <nav
            aria-label="Artifact sections"
            className="sticky top-0 z-20 -mx-4 md:-mx-8 px-4 md:px-8 py-2.5 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/75 border-b border-neutral-200/80 mb-4"
        >
            <div className="flex flex-wrap gap-1.5 overflow-x-auto">
                {items.map(item => {
                    const active = item.id === activeId;
                    return (
                        <a
                            key={item.id}
                            href={`#${item.id}`}
                            onClick={(e) => {
                                const el = document.getElementById(item.id);
                                if (el) {
                                    e.preventDefault();
                                    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                    setActiveId(item.id);
                                }
                            }}
                            aria-current={active ? 'true' : undefined}
                            className={`shrink-0 inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-full no-underline hover:no-underline transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white ${
                                active
                                    ? 'bg-indigo-600 text-white border border-indigo-600 shadow-sm shadow-indigo-600/25 hover:bg-indigo-700 hover:border-indigo-700'
                                    : 'bg-white text-neutral-700 border border-neutral-200 hover:bg-neutral-50 hover:text-neutral-900 hover:border-neutral-300'
                            }`}
                        >
                            {item.label}
                        </a>
                    );
                })}
            </div>
        </nav>
    );
}
