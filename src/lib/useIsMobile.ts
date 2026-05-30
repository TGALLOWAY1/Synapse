import { useEffect, useState } from 'react';

/**
 * Returns true when the viewport is at or below the given max width.
 * Defaults to 767px, matching Tailwind's `md` breakpoint (mobile = below `md`).
 *
 * SSR / jsdom-safe: guards `window` and `matchMedia` so it can run in tests
 * and during server rendering without throwing. Subscribes to viewport
 * changes so the dialog can switch between floating popover and bottom sheet
 * if the device rotates or the window is resized.
 */
export function useIsMobile(maxWidth = 767): boolean {
    const query = `(max-width: ${maxWidth}px)`;

    const getInitial = () => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
            return false;
        }
        return window.matchMedia(query).matches;
    };

    const [isMobile, setIsMobile] = useState<boolean>(getInitial);

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
            return;
        }
        const mql = window.matchMedia(query);
        // The lazy initializer already read `matchMedia` at render time, so the
        // mount value is correct; we only need to subscribe to later changes.
        const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);

        // addEventListener is the modern API; addListener is the Safari < 14 fallback.
        if (typeof mql.addEventListener === 'function') {
            mql.addEventListener('change', handler);
            return () => mql.removeEventListener('change', handler);
        }
        mql.addListener(handler);
        return () => mql.removeListener(handler);
    }, [query]);

    return isMobile;
}
