import { useMemo, useState } from 'react';
import { Database, GitBranch, MousePointerClick } from 'lucide-react';
import {
    computeDataModelLayout, type DataModelGraph, type DataModelNode,
} from '../../../lib/dataModelGraph';
import { CATEGORY_STYLES, EDGE_STROKE } from './dataModelStyles';
import { CategoryBadge } from './badges';

interface Props {
    graph: DataModelGraph;
    /** Jump to (and expand) an entity's detail card. */
    onOpenEntity: (nodeId: string) => void;
}

// Deterministic canvas geometry — no DOM measurement (mirrors DependencyGraphView).
const CARD_W = 224;
const CARD_H = 118;
const GAP_X = 40;
const ROW_GAP = 92;

type Selection = { type: 'node'; id: string } | { type: 'edge'; id: string } | null;

function NodeCardInner({ node }: { node: DataModelNode }) {
    return (
        <>
            <div className="flex items-center gap-1.5 min-w-0">
                <Database size={13} className="shrink-0 text-neutral-400" />
                <span className="text-sm font-semibold text-neutral-900 truncate">{node.name}</span>
            </div>
            <div className="mt-1.5">
                <CategoryBadge category={node.category} size="xs" />
            </div>
            {node.description && (
                <p className="mt-1.5 text-[11px] leading-snug text-neutral-500 line-clamp-2">
                    {node.description}
                </p>
            )}
            <div className="mt-auto pt-1.5 flex items-center gap-2 text-[10px] text-neutral-500">
                <span className="inline-flex items-center gap-1">
                    <span className="font-semibold text-neutral-700 tabular-nums">{node.fieldCount}</span> fields
                </span>
                <span className="inline-flex items-center gap-1">
                    <GitBranch size={10} className="text-neutral-400" />
                    <span className="font-semibold text-neutral-700 tabular-nums">{node.relationshipCount}</span> rel.
                </span>
            </div>
        </>
    );
}

/** Empty state / no-relationship layout: a responsive grid of entity cards. */
function EntityGrid({ graph, onOpenEntity }: Props) {
    return (
        <div className="space-y-3">
            <div className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50/50 px-3 py-2 text-xs text-neutral-500">
                No relationships are defined between these entities — they stand alone in the model.
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {graph.nodes.map(node => (
                    <button
                        key={node.id}
                        type="button"
                        onClick={() => onOpenEntity(node.id)}
                        className={`flex flex-col text-left rounded-xl border border-l-4 bg-white px-3 py-2.5 shadow-sm hover:border-indigo-300 hover:shadow transition ${CATEGORY_STYLES[node.category].accent}`}
                        style={{ minHeight: CARD_H }}
                    >
                        <NodeCardInner node={node} />
                    </button>
                ))}
            </div>
        </div>
    );
}

/**
 * ER-style entity-relationship diagram. Renders each entity as a rounded node
 * card and each (deduped) relationship as a directional, cardinality-labelled
 * edge — visually aligned with the artifact dependency graph and user-flow
 * diagrams. Deterministic layered layout; horizontally scrollable on small
 * screens. Clicking a node opens its detail card; clicking an edge highlights
 * the entities it connects.
 */
export function EntityGraph(props: Props) {
    const { graph, onOpenEntity } = props;
    const [selection, setSelection] = useState<Selection>(null);

    const layout = useMemo(() => computeDataModelLayout(graph), [graph]);

    const geometry = useMemo(() => {
        const maxCols = Math.max(1, ...layout.rows.map(r => r.length));
        const canvasW = maxCols * CARD_W + (maxCols - 1) * GAP_X;
        const canvasH = layout.rows.length * CARD_H + Math.max(0, layout.rows.length - 1) * ROW_GAP;
        const positions = new Map<string, { x: number; y: number }>();
        layout.rows.forEach((row, r) => {
            const rowWidth = row.length * CARD_W + (row.length - 1) * GAP_X;
            row.forEach((id, i) => {
                positions.set(id, {
                    x: (canvasW - rowWidth) / 2 + i * (CARD_W + GAP_X),
                    y: r * (CARD_H + ROW_GAP),
                });
            });
        });
        return { canvasW, canvasH, positions };
    }, [layout]);

    if (graph.edges.length === 0) {
        return <EntityGrid {...props} />;
    }

    const { canvasW, canvasH, positions } = geometry;

    // Which edges / nodes are highlighted by the current selection.
    const activeEdgeIds = new Set<string>();
    const activeNodeIds = new Set<string>();
    if (selection?.type === 'node') {
        activeNodeIds.add(selection.id);
        for (const e of graph.edges) {
            if (e.fromId === selection.id || e.toId === selection.id) {
                activeEdgeIds.add(e.id);
                activeNodeIds.add(e.fromId);
                activeNodeIds.add(e.toId);
            }
        }
    } else if (selection?.type === 'edge') {
        const edge = graph.edges.find(e => e.id === selection.id);
        if (edge) {
            activeEdgeIds.add(edge.id);
            activeNodeIds.add(edge.fromId);
            activeNodeIds.add(edge.toId);
        }
    }

    // Edge path + midpoint label position, choosing connection points by the
    // relative vertical position of the two nodes (down / up / same row).
    const edgeRenders = graph.edges.map(edge => {
        const from = positions.get(edge.fromId);
        const to = positions.get(edge.toId);
        if (!from || !to) return null;
        const active = activeEdgeIds.has(edge.id);
        let x1: number, y1: number, x2: number, y2: number, d: string, mx: number, my: number;
        if (to.y > from.y) {
            x1 = from.x + CARD_W / 2; y1 = from.y + CARD_H;
            x2 = to.x + CARD_W / 2; y2 = to.y;
            const midY = (y1 + y2) / 2;
            d = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
            mx = (x1 + x2) / 2; my = midY;
        } else if (to.y < from.y) {
            x1 = from.x + CARD_W / 2; y1 = from.y;
            x2 = to.x + CARD_W / 2; y2 = to.y + CARD_H;
            const midY = (y1 + y2) / 2;
            d = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
            mx = (x1 + x2) / 2; my = midY;
        } else {
            const leftToRight = to.x >= from.x;
            x1 = from.x + (leftToRight ? CARD_W : 0); y1 = from.y + CARD_H / 2;
            x2 = to.x + (leftToRight ? 0 : CARD_W); y2 = to.y + CARD_H / 2;
            const midX = (x1 + x2) / 2;
            d = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
            mx = midX; my = (y1 + y2) / 2;
        }
        return { edge, active, d, mx, my };
    }).filter((e): e is NonNullable<typeof e> => e !== null);

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 inline-flex items-center gap-1.5">
                    <GitBranch size={12} /> Entity relationships
                </p>
                <span className="text-[10px] text-neutral-400 inline-flex items-center gap-1">
                    <MousePointerClick size={11} /> Tap an entity to open its details
                </span>
            </div>

            <div className="bg-white rounded-xl border border-neutral-200 shadow-sm p-4 overflow-x-auto">
                <div className="relative mx-auto" style={{ width: canvasW, height: canvasH }}>
                    <svg
                        className="absolute inset-0 pointer-events-none"
                        width={canvasW}
                        height={canvasH}
                        aria-hidden="true"
                    >
                        <defs>
                            <marker id="dm-arrow-base" markerWidth="9" markerHeight="9" refX="7.5" refY="3" orient="auto" markerUnits="userSpaceOnUse">
                                <path d="M0,0 L7,3 L0,6 Z" fill={EDGE_STROKE.base} />
                            </marker>
                            <marker id="dm-arrow-active" markerWidth="9" markerHeight="9" refX="7.5" refY="3" orient="auto" markerUnits="userSpaceOnUse">
                                <path d="M0,0 L7,3 L0,6 Z" fill={EDGE_STROKE.active} />
                            </marker>
                            <marker id="dm-arrow-base-start" markerWidth="9" markerHeight="9" refX="-0.5" refY="3" orient="auto" markerUnits="userSpaceOnUse">
                                <path d="M7,0 L0,3 L7,6 Z" fill={EDGE_STROKE.base} />
                            </marker>
                            <marker id="dm-arrow-active-start" markerWidth="9" markerHeight="9" refX="-0.5" refY="3" orient="auto" markerUnits="userSpaceOnUse">
                                <path d="M7,0 L0,3 L7,6 Z" fill={EDGE_STROKE.active} />
                            </marker>
                        </defs>
                        {edgeRenders.map(({ edge, active, d }) => (
                            <path
                                key={edge.id}
                                d={d}
                                fill="none"
                                stroke={active ? EDGE_STROKE.active : EDGE_STROKE.base}
                                strokeWidth={active ? 2 : 1.5}
                                markerEnd={`url(#dm-arrow-${active ? 'active' : 'base'})`}
                                markerStart={edge.arrow === 'both' ? `url(#dm-arrow-${active ? 'active' : 'base'}-start)` : undefined}
                            />
                        ))}
                    </svg>

                    {/* Edge labels (verb + cardinality) as positioned pills. */}
                    {edgeRenders.map(({ edge, active, mx, my }) => (
                        <button
                            key={`label-${edge.id}`}
                            type="button"
                            onClick={() => setSelection(sel =>
                                sel?.type === 'edge' && sel.id === edge.id ? null : { type: 'edge', id: edge.id },
                            )}
                            style={{ left: mx, top: my, transform: 'translate(-50%, -50%)' }}
                            className={`absolute z-10 max-w-[10rem] rounded-full border px-2 py-0.5 text-[10px] font-medium leading-tight shadow-sm transition ${
                                active
                                    ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                                    : 'border-neutral-200 bg-white text-neutral-600 hover:border-indigo-200'
                            }`}
                            title={edge.description || `${edge.verb}${edge.cardinality ? ` (${edge.cardinality})` : ''}`}
                        >
                            <span className="block truncate">{edge.verb}</span>
                            {edge.cardinality && (
                                <span className="block text-[9px] font-mono text-neutral-400 leading-none">{edge.cardinality}</span>
                            )}
                        </button>
                    ))}

                    {/* Entity nodes. */}
                    {graph.nodes.map(node => {
                        const pos = positions.get(node.id);
                        if (!pos) return null;
                        const highlighted = activeNodeIds.has(node.id);
                        const dim = activeNodeIds.size > 0 && !highlighted;
                        return (
                            <button
                                key={node.id}
                                type="button"
                                onClick={() => {
                                    setSelection({ type: 'node', id: node.id });
                                    onOpenEntity(node.id);
                                }}
                                style={{ left: pos.x, top: pos.y, width: CARD_W, height: CARD_H }}
                                className={`absolute flex flex-col text-left rounded-xl border border-l-4 bg-white px-3 py-2.5 shadow-sm transition ${CATEGORY_STYLES[node.category].accent} ${
                                    highlighted
                                        ? 'border-indigo-500 ring-2 ring-indigo-200'
                                        : 'border-neutral-200 hover:border-indigo-300 hover:shadow'
                                } ${dim ? 'opacity-45' : ''}`}
                            >
                                <NodeCardInner node={node} />
                            </button>
                        );
                    })}
                </div>
            </div>

            {(graph.unresolved.length > 0 || graph.selfRefs.length > 0) && (
                <p className="text-[11px] text-neutral-400">
                    {graph.selfRefs.length > 0 && (
                        <span>{graph.selfRefs.length} self-reference{graph.selfRefs.length === 1 ? '' : 's'}</span>
                    )}
                    {graph.selfRefs.length > 0 && graph.unresolved.length > 0 && ' · '}
                    {graph.unresolved.length > 0 && (
                        <span>
                            {graph.unresolved.length} relationship{graph.unresolved.length === 1 ? '' : 's'} reference an entity outside this model
                        </span>
                    )}
                </p>
            )}
        </div>
    );
}
