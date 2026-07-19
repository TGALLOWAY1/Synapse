import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Layers, Sparkles } from 'lucide-react';
import type { DataModelContent } from '../../types';
import type { DependencyNodeStatus } from '../../lib/artifactDependencyGraph';
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
    ENTITY_CATEGORY_ORDER,
    type DataModelNode,
    type EntityCategory,
} from '../../lib/dataModelGraph';
import { useArtifactOutline } from '../../lib/useArtifactOutline';
import { useIsMobile } from '../../lib/useIsMobile';
import { DataModelOverview } from './dataModel/DataModelOverview';
import { EntityGraph } from './dataModel/EntityGraph';
import { EntityCard } from './dataModel/EntityCard';
import { resolveDataModelMemberAnchor, type DataModelMemberAspect } from './dataModel/dataModelNavigation';
import { CategoryHeader } from './dataModel/badges';

interface EntityPair {
    entity: ParsedEntity;
    node: DataModelNode;
}

interface EntityCategoryGroup {
    category: EntityCategory | null;
    items: EntityPair[];
}

interface Props {
    content: string;
    /**
     * Optional freshness state for the overview header (the "Current" pill).
     * PRD provenance is intentionally not passed here — it's shown once at the
     * artifact/page level, not repeated inside the summary card.
     */
    staleness?: DependencyNodeStatus;
    initialEntityName?: string;
    initialMemberName?: string;
    initialMemberAspect?: DataModelMemberAspect;
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

export function DataModelRenderer({ content, staleness, initialEntityName, initialMemberName, initialMemberAspect }: Props) {
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
            key={`${signature}:${initialEntityName ?? ''}:${initialMemberAspect ?? ''}:${initialMemberName ?? ''}`}
            parsed={parsed}
            staleness={staleness}
            initialEntityName={initialEntityName}
            initialMemberName={initialMemberName}
            initialMemberAspect={initialMemberAspect}
        />
    );
}

interface BodyProps {
    parsed: ParsedDataModel;
    staleness?: DependencyNodeStatus;
    initialEntityName?: string;
    initialMemberName?: string;
    initialMemberAspect?: DataModelMemberAspect;
}

function DataModelBody({ parsed, staleness, initialEntityName, initialMemberName, initialMemberAspect }: BodyProps) {
    const isMobile = useIsMobile();
    const { graph, summary } = useMemo(() => analyzeDataModel(parsed), [parsed]);

    const nodeById = useMemo(() => new Map(graph.nodes.map(n => [n.id, n])), [graph]);
    const nodeIdSet = useMemo(() => new Set(graph.nodes.map(n => n.id)), [graph]);

    // Entity + derived node pairs, in document order.
    const pairs = useMemo<EntityPair[]>(
        () => parsed.entities
            .map(entity => ({ entity, node: nodeById.get(slugifyEntity(entity.name)) }))
            .filter((p): p is EntityPair => Boolean(p.node)),
        [parsed, nodeById],
    );

    // Entities are always organised into their derived category sections when the
    // model spans more than one category (the mockup's organizing principle); a
    // single-category model renders as a flat list with no header band.
    const initialNodeId = initialEntityName ? slugifyEntity(initialEntityName) : undefined;
    const initialPair = initialNodeId ? pairs.find(pair => pair.node.id === initialNodeId) : undefined;
    const exactMemberAnchor = initialPair
        ? resolveDataModelMemberAnchor(initialPair.entity, initialMemberAspect, initialMemberName)
        : undefined;

    const distinctCategories = useMemo(
        () => new Set(pairs.map(p => p.node.category)).size,
        [pairs],
    );
    const grouped = distinctCategories >= 2;

    const orderedPairs = useMemo(() => {
        if (!grouped) return pairs;
        return [...pairs].sort(
            (a, b) => ENTITY_CATEGORY_ORDER.indexOf(a.node.category) - ENTITY_CATEGORY_ORDER.indexOf(b.node.category),
        );
    }, [pairs, grouped]);

    // Expansion — single-entity models open by default; larger ones start
    // collapsed for scannability.
    const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
        const target = initialNodeId;
        if (target && nodeIdSet.has(target)) return new Set([target]);
        return pairs.length === 1 ? new Set(pairs.map(p => p.node.id)) : new Set();
    });

    const outlineIds = useMemo(
        () => orderedPairs.map(({ entity }) => entityAnchorId(entity.name)),
        [orderedPairs],
    );
    const { scrollTo } = useArtifactOutline(outlineIds);

    useEffect(() => {
        if (!initialEntityName) return;
        const target = document.getElementById(exactMemberAnchor ?? entityAnchorId(initialEntityName));
        target?.scrollIntoView?.({ block: 'center' });
        target?.focus({ preventScroll: true });
    }, [exactMemberAnchor, initialEntityName]);

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

    const resolveTargetId = (name: string) => resolveEntityId(name, nodeIdSet);

    // Group ordered pairs into category sections (grouped) or a single section.
    const groups = useMemo<EntityCategoryGroup[]>(() => {
        if (!grouped) return [{ category: null, items: orderedPairs }];
        const out: EntityCategoryGroup[] = [];
        for (const pair of orderedPairs) {
            const last = out[out.length - 1];
            if (last && last.category === pair.node.category) last.items.push(pair);
            else out.push({ category: pair.node.category, items: [pair] });
        }
        return out;
    }, [grouped, orderedPairs]);

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
                <section aria-label="Entities" className="space-y-4">
                    {/* Section header */}
                    <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-neutral-900 inline-flex items-center gap-1.5">
                            <Layers className="w-4 h-4 text-neutral-400" /> Entities
                            <span className="text-xs font-normal text-neutral-400">
                                {pairs.length} {pairs.length === 1 ? 'entity' : 'entities'}
                            </span>
                        </h3>
                    </div>

                    {/* Entities organised into their derived category sections. */}
                    <div className="space-y-6">
                        {groups.map(group => (
                            <div key={group.category ?? 'all'} className="space-y-2.5">
                                {group.category && (
                                    <CategoryHeader category={group.category} count={group.items.length} />
                                )}
                                <div className="space-y-2.5">
                                    {group.items.map(({ entity, node }) => (
                                        <EntityCard
                                            key={node.id}
                                            entity={entity}
                                            node={node}
                                            expanded={expandedIds.has(node.id)}
                                            onToggle={() => toggleEntity(node.id)}
                                            resolveTargetId={resolveTargetId}
                                            onNavigateToEntity={focusEntity}
                                            showCategory={!grouped}
                                            isMobile={isMobile}
                                            focusedEntity={initialPair?.node.id === node.id && !exactMemberAnchor}
                                            initialMemberName={initialPair?.node.id === node.id && exactMemberAnchor ? initialMemberName : undefined}
                                            initialMemberAspect={initialPair?.node.id === node.id && exactMemberAnchor ? initialMemberAspect : undefined}
                                        />
                                    ))}
                                </div>
                            </div>
                        ))}
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
