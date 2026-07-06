import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Sparkles, Database, Workflow, Layers } from 'lucide-react';
import type { DataModelContent } from '../../types';
import {
    parseDataModelMarkdown,
    dataModelToMarkdown,
    type ParsedCallout,
    type ParsedCalloutKind,
    type ParsedDataModel,
    type ParsedEntity,
} from '../../lib/services/dataModelMarkdown';
import { ArtifactOutlineNav, type ArtifactOutlineItem } from '../ArtifactOutlineNav';
import { useArtifactOutline } from '../../lib/useArtifactOutline';
import { useIsMobile } from '../../lib/useIsMobile';

interface Props {
    content: string;
}

const CALLOUT_STYLES: Record<ParsedCalloutKind, { container: string; label: string; labelText: string }> = {
    CONSTRAINT: {
        container: 'border-purple-200 bg-purple-50 text-purple-900',
        label: 'bg-purple-200 text-purple-900',
        labelText: 'Constraint',
    },
    PRIVACY: {
        container: 'border-rose-200 bg-rose-50 text-rose-900',
        label: 'bg-rose-200 text-rose-900',
        labelText: 'Privacy',
    },
    INDEX: {
        container: 'border-slate-200 bg-slate-50 text-slate-900',
        label: 'bg-slate-200 text-slate-900',
        labelText: 'Index',
    },
    RELATIONSHIP: {
        container: 'border-indigo-200 bg-indigo-50 text-indigo-900',
        label: 'bg-indigo-200 text-indigo-900',
        labelText: 'Relationship',
    },
};

const CALLOUT_ORDER: ParsedCalloutKind[] = ['RELATIONSHIP', 'CONSTRAINT', 'PRIVACY', 'INDEX'];

function DataModelCallout({ kind, text }: { kind: ParsedCalloutKind; text: string }) {
    const styles = CALLOUT_STYLES[kind];
    return (
        <div className={`rounded-lg border ${styles.container} px-3 py-2`}>
            <div className="flex items-start gap-2">
                <span
                    className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 ${styles.label}`}
                >
                    {styles.labelText}
                </span>
                <p className="text-sm leading-relaxed">{text}</p>
            </div>
        </div>
    );
}

function VisibilityBadge({ userFacing }: { userFacing: boolean }) {
    return userFacing ? (
        <span className="text-[10px] px-1.5 py-0.5 rounded border font-medium bg-emerald-50 text-emerald-700 border-emerald-200">
            User-facing
        </span>
    ) : (
        <span className="text-[10px] px-1.5 py-0.5 rounded border font-medium bg-neutral-100 text-neutral-600 border-neutral-200">
            Internal
        </span>
    );
}

function MutabilityBadge({ mutability }: { mutability: string }) {
    const m = mutability.toLowerCase();
    const cls =
        m.includes('immutable') && !m.includes('mostly')
            ? 'bg-slate-50 text-slate-700 border-slate-200'
            : m.includes('mostly')
              ? 'bg-blue-50 text-blue-700 border-blue-200'
              : 'bg-amber-50 text-amber-700 border-amber-200';
    return (
        <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${cls}`}>
            {mutability.replace(/_/g, ' ')}
        </span>
    );
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
        <span className={`font-mono text-[11px] font-bold px-1.5 py-0.5 rounded border ${color}`}>
            {m}
        </span>
    );
}

function entityAnchorId(name: string): string {
    return `data-model-entity-${name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')}`;
}

function EntityCard({ entity }: { entity: ParsedEntity }) {
    const groupedCallouts: Partial<Record<ParsedCalloutKind, ParsedCallout[]>> = {};
    for (const c of entity.callouts) {
        const list = groupedCallouts[c.kind] ?? [];
        list.push(c);
        groupedCallouts[c.kind] = list;
    }

    return (
        <section
            id={entityAnchorId(entity.name)}
            className="bg-white rounded-lg border border-neutral-200 overflow-hidden scroll-mt-24"
        >
            <header className="bg-neutral-50 border-b border-neutral-200 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                    <h4 className="font-semibold text-neutral-900 text-base">{entity.name}</h4>
                    {entity.userFacing !== undefined && <VisibilityBadge userFacing={entity.userFacing} />}
                    {entity.mutability && <MutabilityBadge mutability={entity.mutability} />}
                </div>
                {entity.description && (
                    <p className="text-sm text-neutral-600">{entity.description}</p>
                )}
                {entity.purpose && (
                    <p className="text-sm text-neutral-700 mt-1">
                        <span className="font-medium text-neutral-900">Purpose: </span>
                        {entity.purpose}
                    </p>
                )}
            </header>

            <div className="px-4 py-3 space-y-4">
                {entity.groupsAutoDetected && (
                    <p className="text-[11px] text-neutral-400 italic">
                        Grouped automatically — refine the artifact for explicit grouping.
                    </p>
                )}
                {entity.fieldGroups.map((group, gi) => (
                    <div key={gi} className="space-y-1.5">
                        <h5 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                            {group.name}
                        </h5>
                        <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="bg-neutral-50 text-neutral-500 uppercase tracking-wider text-[10px]">
                                        <th className="text-left px-3 py-2 font-medium">Field</th>
                                        <th className="text-left px-3 py-2 font-medium">Type</th>
                                        <th className="text-center px-3 py-2 font-medium">Required</th>
                                        <th className="text-left px-3 py-2 font-medium">Description</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {group.fields.map((f, fi) => (
                                        <tr key={fi} className="border-t border-neutral-100 align-top">
                                            <td className="px-3 py-1.5 font-mono text-neutral-800 whitespace-nowrap">
                                                {f.name}
                                            </td>
                                            <td className="px-3 py-1.5 font-mono text-indigo-600 whitespace-nowrap">
                                                {f.type}
                                            </td>
                                            <td className="px-3 py-1.5 text-center text-neutral-600">
                                                {f.required ? '✓' : ''}
                                            </td>
                                            <td className="px-3 py-1.5 text-neutral-600">{f.description}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ))}

                {CALLOUT_ORDER.some(k => (groupedCallouts[k]?.length ?? 0) > 0) && (
                    <div className="space-y-2">
                        {CALLOUT_ORDER.flatMap(kind =>
                            (groupedCallouts[kind] ?? []).map((c, idx) => (
                                <DataModelCallout key={`${kind}-${idx}`} kind={kind} text={c.text} />
                            )),
                        )}
                    </div>
                )}

                {entity.exampleRecord && (
                    <div className="space-y-1">
                        <h5 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                            Example record
                        </h5>
                        <p className="text-[11px] text-neutral-400 italic">Illustrative — not real data.</p>
                        <pre className="font-mono text-xs bg-neutral-900 text-neutral-100 rounded-lg p-3 overflow-x-auto whitespace-pre">
                            {entity.exampleRecord}
                        </pre>
                    </div>
                )}
            </div>
        </section>
    );
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
    // If the markdown didn't include any explicit `**<GroupName>**` group headers,
    // mark the entity as auto-grouped so the renderer surfaces the hint.
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

function entityFieldCount(entity: ParsedEntity): number {
    return entity.fieldGroups.reduce((sum, g) => sum + g.fields.length, 0);
}

export function DataModelRenderer({ content }: Props) {
    const isMobile = useIsMobile();

    const { parsed, sourceMarkdown } = useMemo(() => {
        const json = tryParseAsJson(content);
        if (json) {
            const md = dataModelToMarkdown(json);
            const result = parseDataModelMarkdown(md);
            return { parsed: result, sourceMarkdown: md };
        }
        const result = parseDataModelMarkdown(content);
        return { parsed: result, sourceMarkdown: content };
    }, [content]);

    const outlineItems: ArtifactOutlineItem[] = useMemo(() => {
        if (!parsed) return [];
        return parsed.entities.map(e => {
            const count = entityFieldCount(e);
            return {
                id: entityAnchorId(e.name),
                label: e.name,
                countLabel: `${count} ${count === 1 ? 'field' : 'fields'}`,
            };
        });
    }, [parsed]);
    const outlineIds = useMemo(() => outlineItems.map(i => i.id), [outlineItems]);
    const { activeId, scrollTo } = useArtifactOutline(outlineIds);

    if (!parsed) {
        return (
            <div className="prose prose-sm prose-neutral max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
        );
    }

    markEntityGroupsAuto(parsed, sourceMarkdown);

    return (
        <div className="space-y-6">
            {parsed.entities.length > 1 && (
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

            {parsed.overview && (
                <section className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-5">
                    <div className="flex items-center gap-2 mb-3">
                        <Sparkles className="w-4 h-4 text-indigo-600" />
                        <h3 className="font-semibold text-indigo-900 text-sm uppercase tracking-wider">
                            How This Data Model Works
                        </h3>
                    </div>
                    {parsed.overview.summary && (
                        <p className="text-sm text-neutral-800 leading-relaxed mb-3">
                            {parsed.overview.summary}
                        </p>
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

            {parsed.relationshipFlow && (
                <section className="space-y-2">
                    <div className="flex items-center gap-2">
                        <Workflow className="w-4 h-4 text-neutral-500" />
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                            Relationship Flow
                        </h3>
                    </div>
                    <pre className="font-mono text-xs bg-neutral-50 border border-neutral-200 rounded-lg p-4 overflow-x-auto whitespace-pre text-neutral-800">
                        {parsed.relationshipFlow}
                    </pre>
                </section>
            )}

            {parsed.entities.length > 0 && (
                <section className="space-y-4">
                    <div className="flex items-center gap-2">
                        <Database className="w-4 h-4 text-neutral-500" />
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                            Entities
                        </h3>
                    </div>
                    {parsed.entities.map((entity, ei) => (
                        <EntityCard key={ei} entity={entity} />
                    ))}
                </section>
            )}

            {parsed.productMapping.length > 0 && (
                <section className="space-y-2">
                    <div className="flex items-center gap-2">
                        <Layers className="w-4 h-4 text-neutral-500" />
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                            How This Appears in the Product
                        </h3>
                    </div>
                    <div className="bg-white rounded-lg border border-neutral-200 overflow-x-auto">
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
                                        <td className="px-3 py-1.5 font-mono text-neutral-800 whitespace-nowrap">
                                            {m.field}
                                        </td>
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
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                        API Endpoints
                    </h3>
                    <div className="bg-white rounded-lg border border-neutral-200 overflow-x-auto">
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
                                        <td className="px-3 py-1.5 whitespace-nowrap">
                                            <MethodPill method={ep.method} />
                                        </td>
                                        <td className="px-3 py-1.5 font-mono text-neutral-800 whitespace-nowrap">
                                            {ep.path}
                                        </td>
                                        <td className="px-3 py-1.5 text-neutral-600">{ep.description}</td>
                                        <td className="px-3 py-1.5 text-neutral-700 whitespace-nowrap">
                                            {ep.entity ?? ''}
                                        </td>
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
