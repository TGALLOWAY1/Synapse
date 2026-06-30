import { useCallback, useEffect, useState } from 'react';

/**
 * Shared scroll-spy + smooth-scroll controller for the Artifact Outline
 * navigation (see `ArtifactOutlineNav`). Both the Design System (sections) and
 * Data Model (entities) renderers drive their outline through this hook so the
 * highlight/scroll behaviour stays identical across artifacts.
 *
 * - `activeId` tracks the section/entity currently in view via an
 *   IntersectionObserver (mirrors the Mockups "Pages" navigator), so the
 *   outline highlight follows the user as they scroll.
 * - `scrollTo(id)` smooth-scrolls to the matching anchor element (which must
 *   carry a `scroll-mt-*` class so a non-sticky/collapsed header doesn't cover
 *   the jump target) and records the id in the URL hash via `history.pushState`
 *   so browser back/forward steps through visited sections.
 * - A `popstate` listener re-syncs the active id + scroll position when the
 *   user navigates back/forward.
 *
 * `ids` must be a stable (memoised) array — it keys the observer effect.
 */
export function useArtifactOutline(ids: string[], initialId?: string) {
    const [activeId, setActiveId] = useState<string>(initialId ?? ids[0] ?? '');

    // Scroll-spy: choose the topmost intersecting section as active.
    useEffect(() => {
        if (typeof IntersectionObserver === 'undefined') return;
        const elements = ids
            .map(id => document.getElementById(id))
            .filter((el): el is HTMLElement => el != null);
        if (elements.length === 0) return;
        const observer = new IntersectionObserver(
            (entries) => {
                const visible = entries
                    .filter(e => e.isIntersecting)
                    .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
                if (visible.length > 0) setActiveId(visible[0].target.id);
            },
            { rootMargin: '-100px 0px -60% 0px', threshold: 0 },
        );
        elements.forEach(el => observer.observe(el));
        return () => observer.disconnect();
    }, [ids]);

    const scrollTo = useCallback((id: string) => {
        setActiveId(id);
        const el = document.getElementById(id);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            // Preserve browser back/forward across visited sections.
            if (typeof history !== 'undefined' && typeof history.pushState === 'function') {
                try {
                    history.pushState(null, '', `#${id}`);
                } catch {
                    // pushState can throw in sandboxed contexts; navigation still works.
                }
            }
        }
    }, []);

    // Re-sync on back/forward.
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const onPop = () => {
            const hash = window.location.hash.slice(1);
            if (!hash || !ids.includes(hash)) return;
            setActiveId(hash);
            const el = document.getElementById(hash);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        };
        window.addEventListener('popstate', onPop);
        return () => window.removeEventListener('popstate', onPop);
    }, [ids]);

    return { activeId, setActiveId, scrollTo };
}
