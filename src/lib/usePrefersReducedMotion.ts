import { useEffect, useState } from 'react';

/**
 * Returns true when the user has requested reduced motion at the OS level
 * (`prefers-reduced-motion: reduce`).
 *
 * SSR / jsdom-safe: guards `window` and `matchMedia` (mirrors `useIsMobile`).
 * Subscribes to changes so the UI reacts if the setting is toggled while open.
 *
 * The tour also consults framer-motion's `useReducedMotion()`; this hook exists
 * so non-motion components (timelines, the node graph) can branch on the same
 * signal without pulling in framer-motion.
 */
export function usePrefersReducedMotion(): boolean {
    const query = '(prefers-reduced-motion: reduce)';

    const getInitial = () => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
            return false;
        }
        return window.matchMedia(query).matches;
    };

    const [prefersReduced, setPrefersReduced] = useState<boolean>(getInitial);

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
            return;
        }
        const mql = window.matchMedia(query);
        const handler = (e: MediaQueryListEvent) => setPrefersReduced(e.matches);

        if (typeof mql.addEventListener === 'function') {
            mql.addEventListener('change', handler);
            return () => mql.removeEventListener('change', handler);
        }
        mql.addListener(handler);
        return () => mql.removeListener(handler);
    }, []);

    return prefersReduced;
}
