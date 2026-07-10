import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChevronsDownUp, ChevronsUpDown, Layers, Sparkles } from 'lucide-react';
import type { DataModelContent, StalenessState } from '../../types';
import {
    parseDataModelMarkdown,
    dataModelToMarkdown,
    type ParsedDataModel,
    type ParsedEntity,
} from '../../lib/services/dataModelMarkdown';
import {
    analyzeDataModel,
    entityAnchorId,
    resolveEntityId,
    slugifyEntity,
    ENTITY_CATEGORY_LABEL,
    ENTITY_CATEGORY_ORDER,
    type DataModelNode,
} from '../../lib/dataModelGraph';
import { ArtifactOutlineNav, type ArtifactOutlineItem } from '../ArtifactOutlineNav';
import { useArtifactOutline } from '../../lib/useArtifactOutline';
import { useIsMobile } from '../../lib/useIsMobile';
import { DataModelOverview } from './dataModel/DataModelOverview';
import { EntityGraph } from './dataModel/EntityGraph';
import { EntityCard } from './dataModel/EntityCard';
import { CategoryBadge } from './dataModel/badges';

interface Props {
    content: string;
    /**
     * Optional freshness state for the overview header (the "Current" pill).
     * PRD provenance is intentionally not passed here — it's shown once at the
     * artifact/page level, not repeated inside the summary card.
     */
    staleness?: StalenessState;
}

function tryParseAsJson(content: string): DataModelContent | null {
    try {
        const parsed = JSON.parse(content);
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.entities)) {
            return parsed as DataModelContent;
        }
    } catch {
        // not JSON
    }
    return null;
}

function markEntityGroupsAuto(parsed: ParsedDataModel, sourceMarkdown: string): void {
    const explicitGroupRe = /^\*\*(Key Product Fields|Relationships|System Metadata|API \/ Integration|Privacy \/ Safety)\*\*\s*$/m;
    const hasExplicitGroups = explicitGroupRe.test(sourceMarkdown);
    if (!hasExplicitGroups) {
        for (const e of parsed.entities) {
            if (e.fieldGroups.length === 1 && e.fieldGroups[0].name === 'Key Product Fields') {
                e.groupsAutoDetected = true;
            }
        }
    }
}

function MethodPill({ method }: { method: string }) {
    const m = method.toUpperCase();
    const color =
        m === 'GET'
            ? 'text-green-700 bg-green-50 border-green-200'
            : m === 'POST'
              ? 'text-blue-700 bg-blue-50 border-blue-200'
              : m === 'PUT' || m === 'PATCH'
                ? 'text-amber-700 bg-amber-50 border-amber-200'
                : m === 'DELETE'
                  ? 'text-red-700 bg-red-50 border-red-200'
                  : 'text-neutral-700 bg-neutral-50 border-neutral-200';
    return (
        <span className={`font-mono text-[11px] font-bold px-1.5 py-0.5 rounded border ${color}`}>{m}</span>
    );
}

export function DataModelRenderer({ content, staleness }: Props) {
    const { parsed, sourceMarkdown } = useMemo(() => {
        const json = tryParseAsJson(content);
        if (json) {
            const md = dataModelToMarkdown(json);
            return { parsed: parseDataModelMarkdown(md), sourceMarkdown: md };
        }
        return { parsed: parseDataModelMarkdown(content), sourceMarkdown: content };
    }, [content]);

    if (!parsed) {
        return (
            <div className="prose prose-sm prose-neutral max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
        );
    }

    markEntityGroupsAuto(parsed, sourceMarkdown);

    // Remount the stateful body when the underlying model changes (e.g. version
    // switch), so per-entity expansion defaults re-apply without a set-in-effect.
    const signature = parsed.entities.map(e => e.name).join('|');
    return (
        <DataModelBody
            key={signature}
            parsed={parsed}
            staleness={staleness}
        />
    );
}

interface BodyProps {
    parsed: ParsedDataModel;
    staleness?: StalenessState;
}

function DataModelBody({ parsed, staleness }: BodyProps) {
    const isMobile = useIsMobile();
    const { graph, summary } = useMemo(() => analyzeDataModel(parsed), [parsed]);

    const nodeById = useMemo(() => new Map(graph.nodes.map(n => [n.id, n])), [graph]);
    const nodeIdSet = useMemo(() => new Set(graph.nodes.map(n => n.id)), [graph]);

    // Entity + derived node pairs, in document order.
    const pairs = useMemo(
        () => parsed.entities
            .map(entity => ({ entity, node: nodeById.get(slugifyEntity(entity.name)) }))
            .filter((p): p is { entity: ParsedEntity; node: DataModelNode } => Boolean(p.node)),
        [parsed, nodeById],
    );

    const distinctCategories = useMemo(
        () => new Set(pairs.map(p => p.node.category)).size,
        [pairs],
    );
    const canGroup = distinctCategories >= 2 && pairs.length >= 4;
    const [grouped, setGrouped] = useState(canGroup);

    const orderedPairs = useMemo(() => {
        if (!grouped) return pairs;
        return [...pairs].sort(
            (a, b) => ENTITY_CATEGORY_ORDER.indexOf(a.node.category) - ENTITY_CATEGORY_ORDER.indexOf(b.node.category),
        );
    }, [pairs, grouped]);

    // Expansion — single-entity models open by default; larger ones start
    // collapsed for scannability.
    const [expandedIds, setExpandedIds] = useState<Set<string>>(
        () => (pairs.length === 1 ? new Set(pairs.map(p => p.node.id)) : new Set()),
    );

    const outlineItems: ArtifactOutlineItem[] = useMemo(
        () => orderedPairs.map(({ entity, node }) => ({
            id: entityAnchorId(entity.name),
            label: entity.name,
            countLabel: `${node.fieldCount} ${node.fieldCount === 1 ? 'field' : 'fields'}`,
        })),
        [orderedPairs],
    );
    const outlineIds = useMemo(() => outlineItems.map(i => i.id), [outlineItems]);
    const { activeId, scrollTo } = useArtifactOutline(outlineIds);

    const toggleEntity = (nodeId: string) =>
        setExpandedIds(prev => {
            const next = new Set(prev);
            if (next.has(nodeId)) next.delete(nodeId);
            else next.add(nodeId);
            return next;
        });

    const focusEntity = (nodeId: string) => {
        setExpandedIds(prev => (prev.has(nodeId) ? prev : new Set(prev).add(nodeId)));
        const node = nodeById.get(nodeId);
        if (node) scrollTo(entityAnchorId(node.name));
    };

    const allExpanded = expandedIds.size >= pairs.length;
    const toggleAll = () =>
        setExpandedIds(allExpanded ? new Set() : new Set(pairs.map(p => p.node.id)));

    const resolveTargetId = (name: string) => resolveEntityId(name, nodeIdSet);

    // Category boundaries for grouped rendering — derived purely so no variable
    // is reassigned during render.
    const orderedWithHeader = orderedPairs.map((pair, i) => ({
        ...pair,
        showHeader: grouped && (i === 0 || orderedPairs[i - 1].node.category !== pair.node.category),
    }));

    return (
        <div className="space-y-6">
            <DataModelOverview summary={summary} staleness={staleness} />

            {parsed.overview && (
                <section className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-5">
                    <div className="flex items-center gap-2 mb-3">
                        <Sparkles className="w-4 h-4 text-indigo-600" />
                        <h3 className="font-semibold text-indigo-900 text-sm uppercase tracking-wider">
                            How This Data Model Works
                        </h3>
                    </div>
                    {parsed.overview.summary && (
                        <p className="text-sm text-neutral-800 leading-relaxed mb-3">{parsed.overview.summary}</p>
                    )}
                    <div className="space-y-2">
                        {parsed.overview.dataFlow && (
                            <div className="text-sm text-neutral-700">
                                <span className="font-semibold text-indigo-900">Data flow: </span>
                                {parsed.overview.dataFlow}
                            </div>
                        )}
                        {parsed.overview.productOutcome && (
                            <div className="text-sm text-neutral-700">
                                <span className="font-semibold text-indigo-900">Product outcome: </span>
                                {parsed.overview.productOutcome}
                            </div>
                        )}
                    </div>
                </section>
            )}

            {graph.nodes.length > 0 && (
                <EntityGraph graph={graph} onOpenEntity={focusEntity} />
            )}

            {pairs.length > 0 && (
                <section className="space-y-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 inline-flex items-center gap-1.5">
                            <Layers className="w-4 h-4 text-neutral-400" /> Entities
                        </h3>
                        <div className="flex items-center gap-1.5">
                            {canGroup && (
                                <button
                                    type="button"
                                    onClick={() => setGrouped(g => !g)}
                                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-md border transition ${
                                        grouped
                                            ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                                            : 'bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50'
                                    }`}
                                >
                                    <Layers size={12} /> Group by category
                                </button>
                            )}
                            {pairs.length > 1 && (
                                <button
                                    type="button"
                                    onClick={toggleAll}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-md border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50 transition"
                                >
                                    {allExpanded ? <ChevronsDownUp size={12} /> : <ChevronsUpDown size={12} />}
                                    {allExpanded ? 'Collapse all' : 'Expand all'}
                                </button>
                            )}
                        </div>
                    </div>

                    {pairs.length > 1 && (
                        <ArtifactOutlineNav
                            title="Entities"
                            items={outlineItems}
                            activeId={activeId}
                            activeLabel="Current entity"
                            defaultExpanded={false}
                            collapseOnSelect={isMobile}
                            onSelect={scrollTo}
                        />
                    )}

                    <div className="space-y-3">
                        {orderedWithHeader.map(({ entity, node, showHeader }) => {
                            return (
                                <div key={node.id}>
                                    {showHeader && (
                                        <div className="flex items-center gap-2 pt-2 pb-1.5">
                                            <CategoryBadge category={node.category} />
                                            <span className="text-[11px] text-neutral-400">
                                                {ENTITY_CATEGORY_LABEL[node.category]}
                                            </span>
                                            <span className="flex-1 h-px bg-neutral-100" />
                                        </div>
                                    )}
                                    <EntityCard
                                        entity={entity}
                                        node={node}
                                        expanded={expandedIds.has(node.id)}
                                        onToggle={() => toggleEntity(node.id)}
                                        resolveTargetId={resolveTargetId}
                                        onNavigateToEntity={focusEntity}
                                    />
                                </div>
                            );
                        })}
                    </div>
                </section>
            )}

            {parsed.productMapping.length > 0 && (
                <section className="space-y-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                        How This Appears in the Product
                    </h3>
                    <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="bg-neutral-50 text-neutral-500 uppercase tracking-wider text-[10px]">
                                    <th className="text-left px-3 py-2 font-medium">Field</th>
                                    <th className="text-left px-3 py-2 font-medium">UI behavior</th>
                                </tr>
                            </thead>
                            <tbody>
                                {parsed.productMapping.map((m, mi) => (
                                    <tr key={mi} className="border-t border-neutral-100 align-top">
                                        <td className="px-3 py-1.5 font-mono text-neutral-800 whitespace-nowrap">{m.field}</td>
                                        <td className="px-3 py-1.5 text-neutral-600">{m.uiBehavior}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            )}

            {parsed.apiEndpoints.length > 0 && (
                <section className="space-y-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">API Endpoints</h3>
                    <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="bg-neutral-50 text-neutral-500 uppercase tracking-wider text-[10px]">
                                    <th className="text-left px-3 py-2 font-medium">Method</th>
                                    <th className="text-left px-3 py-2 font-medium">Path</th>
                                    <th className="text-left px-3 py-2 font-medium">Description</th>
                                    <th className="text-left px-3 py-2 font-medium">Entity</th>
                                </tr>
                            </thead>
                            <tbody>
                                {parsed.apiEndpoints.map((ep, ei) => (
                                    <tr key={ei} className="border-t border-neutral-100 align-top">
                                        <td className="px-3 py-1.5 whitespace-nowrap"><MethodPill method={ep.method} /></td>
                                        <td className="px-3 py-1.5 font-mono text-neutral-800 whitespace-nowrap">{ep.path}</td>
                                        <td className="px-3 py-1.5 text-neutral-600">{ep.description}</td>
                                        <td className="px-3 py-1.5 text-neutral-700 whitespace-nowrap">{ep.entity ?? ''}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            )}
        </div>
    );
}
