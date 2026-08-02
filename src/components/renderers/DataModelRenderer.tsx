import { useEffect, useMemo, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Layers, ShieldCheck, Sparkles } from 'lucide-react';
import type { DataModelContent } from '../../types';
import {
    parseDataModelMarkdown,
    dataModelToMarkdown,
    type ParsedApiEndpoint,
    type ParsedDataModel,
    type ParsedEntity,
} from '../../lib/services/dataModelMarkdown';
import {
    evaluateApiContractCompleteness,
    type ApiEndpointCompleteness,
} from '../../lib/apiContractCompleteness';
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
    initialEntityName?: string;
    initialMemberName?: string;
    initialMemberAspect?: DataModelMemberAspect;
    /** Exact review segment requested by a Final Review blocker. */
    initialSection?: 'api_contract';
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

// ---------------------------------------------------------------------------
// Review segmentation: Schema → API Contract → Privacy & Security.
// Per-section completeness indicators are DERIVED on read (advisory only —
// the API section scores through src/lib/apiContractCompleteness.ts); nothing
// here gates rendering or generation, and legacy models without the newer
// contract fields render as honest "stub"/"partial" states, never errors.
// ---------------------------------------------------------------------------

type SectionTone = 'complete' | 'partial' | 'stub' | 'none';

function SectionStatusChip({ tone, label }: { tone: SectionTone; label: string }) {
    const cls =
        tone === 'complete'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : tone === 'partial'
              ? 'border-amber-200 bg-amber-50 text-amber-700'
              : 'border-neutral-200 bg-neutral-50 text-neutral-500';
    return (
        <span
            title="Derived from the artifact content — advisory only"
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}
        >
            {label}
        </span>
    );
}

function ReviewSectionHeader({ step, title, chip }: { step: number; title: string; chip?: ReactNode }) {
    return (
        <div className="flex flex-wrap items-center gap-2">
            <span
                aria-hidden="true"
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-[11px] font-bold text-white"
            >
                {step}
            </span>
            <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
            {chip}
        </div>
    );
}

function ContractRow({ label, value }: { label: string; value?: string }) {
    if (!value) return null;
    return (
        <div className="flex gap-2 text-xs">
            <span className="w-28 shrink-0 font-medium text-neutral-500">{label}</span>
            <span className="min-w-0 break-words text-neutral-700">{value}</span>
        </div>
    );
}

function ContractListRow({ label, items }: { label: string; items?: string[] }) {
    if (!items?.length) return null;
    return (
        <div className="flex gap-2 text-xs">
            <span className="w-28 shrink-0 font-medium text-neutral-500">{label}</span>
            <ul className="min-w-0 flex-1 space-y-0.5 text-neutral-700">
                {items.map((item, i) => (
                    <li key={i} className="break-words">{item}</li>
                ))}
            </ul>
        </div>
    );
}

const ENDPOINT_STATUS_LABEL: Record<ApiEndpointCompleteness['status'], string> = {
    complete: 'Complete',
    partial: 'Partial',
    stub: 'Stub',
};

function EndpointContractCard({
    endpoint,
    completeness,
}: {
    endpoint: ParsedApiEndpoint;
    completeness: ApiEndpointCompleteness;
}) {
    const hasContractDetail = completeness.status !== 'stub';
    return (
        <div className="rounded-xl border border-neutral-200 bg-white p-3 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
                <MethodPill method={endpoint.method} />
                <span className="min-w-0 break-all font-mono text-xs font-semibold text-neutral-800">
                    {endpoint.path}
                </span>
                {endpoint.entity && (
                    <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[11px] text-neutral-600">
                        {endpoint.entity}
                    </span>
                )}
                <span className="ml-auto">
                    <SectionStatusChip
                        tone={completeness.status}
                        label={ENDPOINT_STATUS_LABEL[completeness.status]}
                    />
                </span>
            </div>
            {endpoint.description && (
                <p className="mt-1.5 text-xs text-neutral-600">{endpoint.description}</p>
            )}

            {hasContractDetail && (
                <div className="mt-2.5 space-y-1.5 border-t border-neutral-100 pt-2.5">
                    <ContractRow label="Authentication" value={endpoint.auth?.authentication} />
                    <ContractRow label="Authorization" value={endpoint.auth?.authorization} />
                    <ContractRow label="Request" value={endpoint.requestSchema} />
                    <ContractRow label="Response" value={endpoint.responseSchema} />
                    <ContractListRow label="Errors" items={endpoint.errors} />
                    <ContractRow label="Pagination" value={endpoint.pagination} />
                    <ContractRow label="Idempotency" value={endpoint.idempotency} />
                    <ContractRow label="Rate limit" value={endpoint.rateLimit} />
                    {endpoint.requirementIds && endpoint.requirementIds.length > 0 && (
                        <div className="flex gap-2 text-xs">
                            <span className="w-28 shrink-0 font-medium text-neutral-500">Requirements</span>
                            <span className="flex min-w-0 flex-wrap gap-1">
                                {endpoint.requirementIds.map(id => (
                                    <span
                                        key={id}
                                        className="rounded border border-fuchsia-200 bg-fuchsia-50 px-1.5 py-0.5 font-mono text-[11px] text-fuchsia-700"
                                    >
                                        {id}
                                    </span>
                                ))}
                            </span>
                        </div>
                    )}
                    <ContractListRow label="Tests" items={endpoint.tests} />
                </div>
            )}

            {completeness.status === 'partial' && (
                <p className="mt-2 text-[11px] text-amber-700">
                    Missing: {completeness.missingFields.join(', ')}
                </p>
            )}
            {completeness.status === 'stub' && (
                <p className="mt-2 text-[11px] text-neutral-500">
                    No contract details recorded (legacy format). Regenerate the data model to add
                    auth, request/response schemas, errors, and tests.
                </p>
            )}
        </div>
    );
}

export function DataModelRenderer({ content, initialEntityName, initialMemberName, initialMemberAspect, initialSection }: Props) {
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
            key={`${signature}:${initialEntityName ?? ''}:${initialMemberAspect ?? ''}:${initialMemberName ?? ''}:${initialSection ?? ''}`}
            parsed={parsed}
            initialEntityName={initialEntityName}
            initialMemberName={initialMemberName}
            initialMemberAspect={initialMemberAspect}
            initialSection={initialSection}
        />
    );
}

interface BodyProps {
    parsed: ParsedDataModel;
    initialEntityName?: string;
    initialMemberName?: string;
    initialMemberAspect?: DataModelMemberAspect;
    initialSection?: 'api_contract';
}

function DataModelBody({ parsed, initialEntityName, initialMemberName, initialMemberAspect, initialSection }: BodyProps) {
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
        const target = initialSection === 'api_contract'
            ? document.getElementById('data-model-api-contract')
            : initialEntityName
                ? document.getElementById(exactMemberAnchor ?? entityAnchorId(initialEntityName))
                : null;
        target?.scrollIntoView?.({ block: 'center' });
        target?.focus({ preventScroll: true });
    }, [exactMemberAnchor, initialEntityName, initialSection]);

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

    // Entities with PII, in document order — used by the overview's "Entities
    // with PII" tile to expand + reveal them all in one action.
    const piiNodeIds = useMemo(
        () => graph.nodes.filter(n => n.hasPII).map(n => n.id),
        [graph.nodes],
    );

    const showPiiEntities = piiNodeIds.length > 0
        ? () => {
            setExpandedIds(prev => {
                const next = new Set(prev);
                piiNodeIds.forEach(id => next.add(id));
                return next;
            });
            const firstNode = nodeById.get(piiNodeIds[0]);
            if (firstNode) scrollTo(entityAnchorId(firstNode.name));
        }
        : undefined;

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

    // --- Per-section completeness (derived on read, advisory only) ---------

    // Schema: every entity should define at least one field.
    const fieldlessEntities = useMemo(
        () => parsed.entities.filter(e => e.fieldGroups.every(g => g.fields.length === 0)),
        [parsed],
    );
    const schemaChip: { tone: SectionTone; label: string } =
        parsed.entities.length === 0
            ? { tone: 'stub', label: 'No entities' }
            : fieldlessEntities.length > 0
              ? {
                    tone: 'partial',
                    label: `${fieldlessEntities.length} ${fieldlessEntities.length === 1 ? 'entity' : 'entities'} without fields`,
                }
              : {
                    tone: 'complete',
                    label: `${parsed.entities.length} ${parsed.entities.length === 1 ? 'entity' : 'entities'} defined`,
                };

    // API Contract: scored per endpoint by the shared completeness module.
    const apiCompleteness = useMemo(
        () => evaluateApiContractCompleteness(parsed.apiEndpoints),
        [parsed],
    );
    const apiChip: { tone: SectionTone; label: string } =
        apiCompleteness.status === 'empty'
            ? { tone: 'none', label: 'No endpoints declared' }
            : apiCompleteness.status === 'complete'
              ? { tone: 'complete', label: 'Contract complete' }
              : apiCompleteness.status === 'stub'
                ? { tone: 'stub', label: 'Legacy format — no contract details' }
                : {
                      tone: 'partial',
                      label: `${apiCompleteness.completeCount} of ${apiCompleteness.endpoints.length} complete`,
                  };

    // Privacy & Security: PII-bearing entities should each declare at least
    // one privacy rule; endpoint auth coverage is reported alongside. Note
    // `hasPII` already covers entities whose only signal is a PRIVACY callout
    // (see dataModelGraph.entityHasPII), so `piiPairs` is the full population.
    const piiPairs = useMemo(() => pairs.filter(p => p.node.hasPII), [pairs]);
    const uncoveredPii = useMemo(
        () => piiPairs.filter(p => !p.entity.callouts.some(c => c.kind === 'PRIVACY')),
        [piiPairs],
    );
    const endpointsWithAuth = useMemo(
        () => parsed.apiEndpoints.filter(ep => Boolean(ep.auth?.authentication?.trim() || ep.auth?.authorization?.trim())).length,
        [parsed],
    );
    const privacyChip: { tone: SectionTone; label: string } =
        piiPairs.length === 0
            ? { tone: 'none', label: 'None declared' }
            : uncoveredPii.length > 0
              ? {
                    tone: 'partial',
                    label: `${uncoveredPii.length} PII ${uncoveredPii.length === 1 ? 'entity' : 'entities'} without rules`,
                }
              : { tone: 'complete', label: 'PII covered by rules' };

    return (
        <div className="space-y-6">
            <DataModelOverview summary={summary} onShowPii={showPiiEntities} />

            {/* ── Review section 1 · Schema ─────────────────────────────── */}
            <section aria-label="Schema" className="space-y-5">
            <ReviewSectionHeader
                step={1}
                title="Schema"
                chip={<SectionStatusChip tone={schemaChip.tone} label={schemaChip.label} />}
            />

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
                    {/* `relative` sits outside the scroll container so the fade cue
                        stays pinned to the visible right edge instead of scrolling
                        away with the table (mirrors ExamplePromptCarousel). */}
                    <div className="relative">
                        <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-x-auto">
                            <table className="w-full min-w-[480px] text-xs">
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
                        <div
                            aria-hidden="true"
                            className="pointer-events-none absolute inset-y-0 right-0 w-8 rounded-r-xl bg-gradient-to-l from-white to-transparent md:hidden"
                        />
                    </div>
                </section>
            )}
            </section>

            {/* ── Review section 2 · API Contract ───────────────────────── */}
            <section
                id="data-model-api-contract"
                tabIndex={-1}
                aria-label="API Contract"
                className="space-y-2.5"
            >
                <ReviewSectionHeader
                    step={2}
                    title="API Contract"
                    chip={<SectionStatusChip tone={apiChip.tone} label={apiChip.label} />}
                />
                {parsed.apiEndpoints.length > 0 ? (
                    <div className="space-y-2.5">
                        {parsed.apiEndpoints.map((ep, ei) => (
                            <EndpointContractCard
                                key={`${ep.method}-${ep.path}-${ei}`}
                                endpoint={ep}
                                completeness={apiCompleteness.endpoints[ei]}
                            />
                        ))}
                    </div>
                ) : (
                    <p className="rounded-xl border border-dashed border-neutral-200 bg-neutral-50/50 px-3 py-2.5 text-xs text-neutral-500">
                        No API endpoints declared in this data model.
                    </p>
                )}
            </section>

            {/* ── Review section 3 · Privacy & Security ─────────────────── */}
            <section aria-label="Privacy & Security" className="space-y-2.5">
                <ReviewSectionHeader
                    step={3}
                    title="Privacy & Security"
                    chip={<SectionStatusChip tone={privacyChip.tone} label={privacyChip.label} />}
                />
                {piiPairs.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-neutral-200 bg-neutral-50/50 px-3 py-2.5 text-xs text-neutral-500">
                        No PII fields or privacy rules declared in this data model.
                    </p>
                ) : (
                    <div className="space-y-2.5">
                        {piiPairs.map(({ entity, node }) => {
                            const rules = entity.callouts.filter(c => c.kind === 'PRIVACY');
                            return (
                                <div key={node.id} className="rounded-xl border border-neutral-200 bg-white p-3 shadow-sm">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <ShieldCheck size={14} className="shrink-0 text-rose-600" aria-hidden="true" />
                                        <button
                                            type="button"
                                            onClick={() => focusEntity(node.id)}
                                            className="text-xs font-semibold text-neutral-800 hover:text-indigo-700 hover:underline"
                                        >
                                            {entity.name}
                                        </button>
                                        <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] text-rose-700">
                                            Contains PII
                                        </span>
                                    </div>
                                    {rules.length > 0 ? (
                                        <ul className="mt-1.5 space-y-0.5 text-xs text-neutral-600">
                                            {rules.map((rule, ri) => (
                                                <li key={ri} className="break-words">{rule.text}</li>
                                            ))}
                                        </ul>
                                    ) : (
                                        <p className="mt-1.5 text-[11px] text-amber-700">
                                            Contains PII but declares no privacy rules.
                                        </p>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
                {parsed.apiEndpoints.length > 0 && (
                    <p className="text-[11px] text-neutral-500">
                        {endpointsWithAuth} of {parsed.apiEndpoints.length}{' '}
                        {parsed.apiEndpoints.length === 1 ? 'endpoint declares' : 'endpoints declare'} auth
                        — details in the API Contract section above.
                    </p>
                )}
            </section>
        </div>
    );
}
