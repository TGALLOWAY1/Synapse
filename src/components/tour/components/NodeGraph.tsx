import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Check, FileText } from 'lucide-react';
import type { TourAsset } from '../tourData';

export type GraphSelection = 'prd' | string | null;

interface Point {
    x: number;
    y: number;
}
interface Edge {
    id: string;
    from: Point;
    to: Point;
}

/**
 * Interactive PRD → assets dependency graph (screen 6). HTML nodes laid out in
 * a fixed two-column grid with an SVG overlay whose edge coordinates are
 * measured from the live node positions (re-measured on resize). Selecting the
 * PRD highlights every downstream edge; selecting an asset highlights just its
 * link back to the PRD. framer-motion animates the path draw (skipped under
 * reduced motion).
 *
 * Edge routing is a central "spine": a vertical trunk drops from the PRD down
 * the column gutter and each card connects via a rounded elbow into its *inner*
 * edge (right edge for left-column cards, left edge for right-column ones). The
 * trunk and elbows live entirely in the gutter, so connectors never sweep
 * across the faces of the cards in lower rows.
 */
export function NodeGraph({
    assets,
    selected,
    onSelect,
    reducedMotion,
    prdContent,
    showStatus = false,
}: {
    assets: TourAsset[];
    selected: GraphSelection;
    onSelect: (id: GraphSelection) => void;
    reducedMotion: boolean;
    /** Custom content for the PRD hub node (defaults to a compact label). */
    prdContent?: ReactNode;
    /** Show an "Up to date" badge under each asset node. */
    showStatus?: boolean;
}) {
    const containerRef = useRef<HTMLDivElement>(null);
    const prdRef = useRef<HTMLButtonElement>(null);
    const nodeRefs = useRef(new Map<string, HTMLButtonElement>());
    const [edges, setEdges] = useState<Edge[]>([]);
    const [size, setSize] = useState({ w: 0, h: 0 });

    const measure = useCallback(() => {
        const container = containerRef.current;
        const prd = prdRef.current;
        if (!container || !prd) return;
        const c = container.getBoundingClientRect();
        setSize({ w: c.width, h: c.height });

        const prdRect = prd.getBoundingClientRect();
        const centerX = prdRect.left - c.left + prdRect.width / 2;
        const from: Point = {
            x: centerX,
            y: prdRect.bottom - c.top,
        };

        const next: Edge[] = [];
        assets.forEach((a) => {
            const el = nodeRefs.current.get(a.id);
            if (!el) return;
            const r = el.getBoundingClientRect();
            const cardCenterX = r.left - c.left + r.width / 2;
            // Connect to the card's gutter-facing (inner) edge so the trunk and
            // elbows stay in the central gutter, never crossing a card face.
            const innerX =
                cardCenterX < centerX ? r.right - c.left : r.left - c.left;
            next.push({
                id: a.id,
                from,
                to: { x: innerX, y: r.top - c.top + r.height / 2 },
            });
        });
        setEdges(next);
    }, [assets]);

    useLayoutEffect(() => {
        measure();
        let ro: ResizeObserver | undefined;
        if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
            ro = new ResizeObserver(measure);
            ro.observe(containerRef.current);
        }
        window.addEventListener('resize', measure);
        return () => {
            ro?.disconnect();
            window.removeEventListener('resize', measure);
        };
    }, [measure]);

    const isEdgeActive = (id: string) => selected === 'prd' || selected === id;
    const anySelected = selected !== null;

    return (
        <div ref={containerRef} className="relative">
            {/* Edge overlay */}
            <svg
                className="pointer-events-none absolute inset-0 h-full w-full"
                width={size.w}
                height={size.h}
                aria-hidden="true"
            >
                {edges.map((edge) => {
                    // Trunk straight down the gutter, then a rounded elbow out
                    // into the card's inner edge at its vertical center.
                    const r = Math.min(14, Math.abs(edge.to.x - edge.from.x) / 2);
                    const dir = edge.to.x >= edge.from.x ? 1 : -1;
                    const d =
                        `M ${edge.from.x} ${edge.from.y} ` +
                        `V ${edge.to.y - r} ` +
                        `Q ${edge.from.x} ${edge.to.y}, ${edge.from.x + dir * r} ${edge.to.y} ` +
                        `H ${edge.to.x}`;
                    const active = isEdgeActive(edge.id);
                    return (
                        <motion.path
                            key={edge.id}
                            d={d}
                            fill="none"
                            stroke={active ? 'rgb(129 140 248)' : 'rgb(64 64 64)'}
                            strokeWidth={active ? 2 : 1.5}
                            strokeOpacity={anySelected && !active ? 0.3 : 1}
                            initial={false}
                            animate={
                                active && !reducedMotion
                                    ? { pathLength: [0, 1] }
                                    : { pathLength: 1 }
                            }
                            transition={{ duration: reducedMotion ? 0 : 0.5, ease: 'easeInOut' }}
                        />
                    );
                })}
            </svg>

            {/* PRD node */}
            <div className="relative z-10 flex justify-center">
                <button
                    ref={prdRef}
                    type="button"
                    onClick={() => onSelect(selected === 'prd' ? null : 'prd')}
                    aria-pressed={selected === 'prd'}
                    className={`w-full max-w-lg rounded-xl border px-4 py-3 text-left transition ${
                        selected === 'prd'
                            ? 'border-indigo-400 bg-indigo-500/15 shadow-[0_0_24px_rgba(99,102,241,0.35)]'
                            : 'border-neutral-700 bg-neutral-800/60 hover:border-neutral-500'
                    }`}
                >
                    {prdContent ?? (
                        <span className="flex items-center gap-3">
                            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-300">
                                <FileText size={18} aria-hidden="true" />
                            </span>
                            <span>
                                <span className="block text-sm font-semibold text-white">Product Requirements Document</span>
                                <span className="block text-xs text-neutral-400">Tap to trace every downstream artifact</span>
                            </span>
                        </span>
                    )}
                </button>
            </div>

            {/* Asset nodes */}
            <div className="relative z-10 mt-8 grid grid-cols-2 gap-x-10 gap-y-4">
                {assets.map((asset) => {
                    const active = isEdgeActive(asset.id);
                    return (
                        <button
                            key={asset.id}
                            type="button"
                            ref={(el) => {
                                if (el) nodeRefs.current.set(asset.id, el);
                                else nodeRefs.current.delete(asset.id);
                            }}
                            onClick={() => onSelect(selected === asset.id ? null : asset.id)}
                            aria-pressed={selected === asset.id}
                            className={`flex flex-col items-center gap-2 rounded-xl border p-3 text-center transition ${
                                active
                                    ? 'border-indigo-400 bg-indigo-500/10'
                                    : 'border-neutral-700 bg-neutral-800/40 hover:border-neutral-500'
                            } ${anySelected && !active ? 'opacity-40' : 'opacity-100'}`}
                        >
                            <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${asset.accent}`}>
                                <asset.icon size={18} aria-hidden="true" />
                            </span>
                            <span className="text-xs font-medium leading-tight text-neutral-200">{asset.name}</span>
                            {showStatus && (
                                <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400">
                                    <Check size={10} /> Up to date
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
