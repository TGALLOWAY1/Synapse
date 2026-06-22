/**
 * Fullscreen image lightbox for mockup AI previews. The in-card image is
 * deliberately constrained (max-h-[680px], shrinks hard on mobile), so this
 * overlay is how a user actually inspects a mockup at size — especially on
 * phones where the card preview is tiny.
 *
 * Two zoom states:
 *   - fit (default): image scaled to fit the viewport (object-contain).
 *   - zoomed: image rendered larger than the viewport inside a scrollable,
 *     pannable container so the user can drag around fine detail.
 *
 * Tap/click the image to toggle zoom; the backdrop, the close button, or
 * Escape dismiss. Safe-area insets keep the close button reachable on
 * notched devices.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { X, ZoomIn, ZoomOut } from 'lucide-react';

interface Props {
    src: string;
    alt: string;
    onClose: () => void;
}

export function ImageLightbox({ src, alt, onClose }: Props) {
    const [zoomed, setZoomed] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    // Escape to close + lock background scroll while open.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKey);
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = prevOverflow;
        };
    }, [onClose]);

    // When zooming in, recentre the scroll container so the user starts in the
    // middle of the enlarged image rather than pinned to the top-left.
    useEffect(() => {
        if (!zoomed) return;
        const el = scrollRef.current;
        if (!el) return;
        el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
        el.scrollTop = (el.scrollHeight - el.clientHeight) / 2;
    }, [zoomed]);

    const toggleZoom = useCallback(() => setZoomed((z) => !z), []);

    return (
        <div
            className="fixed inset-0 z-50 bg-black/90 flex flex-col"
            role="dialog"
            aria-modal="true"
            aria-label={alt}
        >
            <div
                className="absolute top-0 right-0 flex items-center gap-1 p-3 z-10"
                style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))', paddingRight: 'max(0.75rem, env(safe-area-inset-right))' }}
            >
                <button
                    type="button"
                    onClick={toggleZoom}
                    aria-label={zoomed ? 'Zoom out' : 'Zoom in'}
                    className="inline-flex items-center justify-center w-11 h-11 rounded-full bg-white/10 text-white hover:bg-white/20 transition"
                >
                    {zoomed ? <ZoomOut size={20} /> : <ZoomIn size={20} />}
                </button>
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close"
                    className="inline-flex items-center justify-center w-11 h-11 rounded-full bg-white/10 text-white hover:bg-white/20 transition"
                >
                    <X size={20} />
                </button>
            </div>

            <div
                ref={scrollRef}
                className={`flex-1 ${zoomed ? 'overflow-auto' : 'overflow-hidden flex items-center justify-center'}`}
                // Tapping empty space (the backdrop) closes; the image stops
                // propagation so a tap on it only toggles zoom.
                onClick={onClose}
            >
                <img
                    src={src}
                    alt={alt}
                    onClick={(e) => {
                        e.stopPropagation();
                        toggleZoom();
                    }}
                    draggable={false}
                    className={
                        zoomed
                            ? 'max-w-none w-[180%] sm:w-[150%] mx-auto cursor-zoom-out select-none'
                            : 'max-w-full max-h-full object-contain cursor-zoom-in select-none'
                    }
                />
            </div>

            <div
                className="text-center text-[11px] text-white/50 pb-3 pointer-events-none"
                style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
            >
                Tap image to {zoomed ? 'zoom out' : 'zoom in'} · tap outside to close
            </div>
        </div>
    );
}
