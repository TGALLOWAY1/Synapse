import { useMemo, type ReactNode } from 'react';
import {
    Braces, Check, ChevronDown, Database, GitBranch, KeyRound, ListTree, ShieldAlert, SlidersHorizontal,
} from 'lucide-react';
import type { ParsedEntity, ParsedFieldGroup } from '../../../lib/services/dataModelMarkdown';
import type { DataModelNode } from '../../../lib/dataModelGraph';
import {
    classifyFieldType, entityAnchorId, indexedFieldNames, parseRelationshipCallout,
} from '../../../lib/dataModelGraph';
import { CategoryBadge, EntityAttributeBadges, FieldTypeChip, InspectorRow } from './badges';
import { dataModelMemberAnchorId, type DataModelMemberAspect } from './dataModelNavigation';

interface Props {
    entity: ParsedEntity;
    node: DataModelNode;
    expanded: boolean;
    onToggle: () => void;
    /** Resolve a relationship target name to a known node id (for linking). */
    resolveTargetId: (targetName: string) => string | undefined;
    onNavigateToEntity: (nodeId: string) => void;
    /**
     * Show the per-card category chip. False in grouped mode, where the category
     * is already shown once in the surrounding group header (avoids repetition).
     */
    showCategory: boolean;
    /** Mobile viewport — drives collapsed-card chip density. */
    isMobile: boolean;
    focusedEntity?: boolean;
    initialMemberName?: string;
    initialMemberAspect?: DataModelMemberAspect;
}

/**
 * A quiet, compact metadata item for the card footer — small icon + count +
 * correctly pluralised label (e.g. "1 field" / "2 fields", "1 privacy rule").
 * Neutral bordered by default; colour is reserved for the privacy warning tone.
 */
function CountChip({ icon: Icon, count, singular, plural, tone = 'neutral' }: {
    icon: typeof Database; count: number; singular: string; plural: string; tone?: 'neutral' | 'rose';
}) {
    if (count <= 0) return null;
    const toneCls = tone === 'rose'
        ? 'border-rose-200 bg-rose-50 text-rose-600'
        : 'border-neutral-200 bg-white text-neutral-500';
    return (
        <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-md border ${toneCls}`}>
            <Icon size={11} className="shrink-0" />
            <span className="tabular-nums">{count} {count === 1 ? singular : plural}</span>
        </span>
    );
}

function FieldTable({ group, indexed, entityName, initialMemberName }: {
    group: ParsedFieldGroup;
    indexed: Set<string>;
    entityName: string;
    initialMemberName?: string;
}) {
    return (
        <div className="space-y-1.5">
            <h5 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">{group.name}</h5>
            <div className="overflow-x-auto -mx-1">
                <table className="w-full text-xs table-fixed">
                    <colgroup>
                        <col className="w-[34%]" />
                        <col className="w-[22%]" />
                        <col className="w-[10%]" />
                        <col className="w-[34%]" />
                    </colgroup>
                    <thead>
                        <tr className="text-neutral-400 uppercase tracking-wider text-[10px]">
                            <th className="text-left px-2 py-1.5 font-medium">Field</th>
                            <th className="text-left px-2 py-1.5 font-medium">Type</th>
                            <th className="text-center px-2 py-1.5 font-medium">Req</th>
                            <th className="text-left px-2 py-1.5 font-medium">Description</th>
                        </tr>
                    </thead>
                    <tbody>
                        {group.fields.map((f, fi) => {
                            const kind = classifyFieldType(f.type, f.name);
                            const isIndexed = indexed.has(f.name);
                            const highlighted = f.name === initialMemberName;
                            const rowId = dataModelMemberAnchorId(entityName, 'field', f.name);
                            return (
                                <tr
                                    key={fi}
                                    id={rowId}
                                    tabIndex={-1}
                                    aria-current={highlighted ? 'true' : undefined}
                                    className={`scroll-mt-24 border-t align-top outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500 ${highlighted ? 'border-indigo-200 bg-indigo-50 ring-2 ring-inset ring-indigo-300' : 'border-neutral-100'}`}
                                >
                                    <td className="px-2 py-1.5">
                                        <span className="inline-flex items-center gap-1 font-mono text-[11px] text-neutral-800 break-all">
                                            {f.name}
                                            {isIndexed && (
                                                <KeyRound size={10} className="shrink-0 text-slate-400" aria-label="Indexed" />
                                            )}
                                        </span>
                                    </td>
                                    <td className="px-2 py-1.5">
                                        <span className="inline-flex items-center gap-1">
                                            <FieldTypeChip kind={kind} label={f.type} />
                                            {kind === 'json' && (
                                                <Braces size={11} className="text-fuchsia-400" aria-label="Structured / object" />
                                            )}
                                        </span>
                                    </td>
                                    <td className="px-2 py-1.5 text-center">
                                        {f.required
                                            ? <Check size={13} className="inline text-emerald-500" aria-label="Required" />
                                            : <span className="text-neutral-300" aria-label="Optional">—</span>}
                                    </td>
                                    <td className="break-words px-2 py-1.5 leading-relaxed text-neutral-600">{f.description}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

/**
 * A compact, collapsible entity card. Collapsed: name, one-line description,
 * key badges, and counts. Expanded: overview, grouped field tables, and
 * inspector-style rows for relationships / constraints / privacy / indexes,
 * plus the example record.
 */
export function EntityCard({
    entity, node, expanded, onToggle, resolveTargetId, onNavigateToEntity, showCategory, isMobile,
    focusedEntity = false, initialMemberName, initialMemberAspect,
}: Props) {
    const indexed = useMemo(() => indexedFieldNames(entity), [entity]);

    const relationships = entity.callouts.filter(c => c.kind === 'RELATIONSHIP');
    const constraints = entity.callouts.filter(c => c.kind === 'CONSTRAINT');
    const privacy = entity.callouts.filter(c => c.kind === 'PRIVACY');
    const indexes = entity.callouts.filter(c => c.kind === 'INDEX');

    return (
        <section
            id={entityAnchorId(entity.name)}
            tabIndex={-1}
            aria-current={focusedEntity ? 'true' : undefined}
            className={`scroll-mt-24 overflow-hidden rounded-xl border bg-white shadow-sm outline-none transition focus:ring-2 focus:ring-indigo-500 ${
                focusedEntity
                    ? 'border-indigo-300 ring-2 ring-indigo-300'
                    : expanded
                        ? 'border-indigo-300 ring-1 ring-indigo-200/70 shadow'
                        : 'border-neutral-200'
            }`}
        >
            {/* Header — always visible, toggles expansion */}
            <button
                type="button"
                onClick={onToggle}
                aria-expanded={expanded}
                className={`w-full text-left px-4 py-3 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-inset ${
                    expanded ? 'bg-indigo-50/40' : 'hover:bg-neutral-50/60'
                }`}
            >
                <div className="flex items-start gap-3">
                    <div className="mt-0.5 p-1.5 rounded-lg bg-neutral-100 text-neutral-500 shrink-0">
                        <Database size={15} />
                    </div>

                    <div className="min-w-0 flex-1">
                        {/* Name + status labels — name and its chips share one row on
                            desktop (chips pushed right); on mobile the chips wrap below. */}
                        <div className="flex items-center gap-x-2 gap-y-1.5 flex-wrap">
                            <h4 className="min-w-0 max-w-full text-sm font-semibold text-neutral-900 truncate">{entity.name}</h4>
                            <div className="flex items-center gap-1.5 flex-wrap sm:ml-auto">
                                {showCategory && <CategoryBadge category={node.category} size="xs" />}
                                <EntityAttributeBadges node={node} collapsed={isMobile && !expanded} />
                            </div>
                        </div>

                        {entity.description && (
                            <p className={`mt-1.5 text-xs text-neutral-500 ${expanded ? '' : 'line-clamp-2'}`}>
                                {entity.description}
                            </p>
                        )}

                        {/* Quantitative metadata footer — quieter than name/description. */}
                        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                            <CountChip icon={ListTree} count={node.fieldCount} singular="field" plural="fields" />
                            <CountChip icon={GitBranch} count={node.relationshipCount} singular="relationship" plural="relationships" />
                            <CountChip icon={SlidersHorizontal} count={node.constraintCount} singular="constraint" plural="constraints" />
                            <CountChip icon={ShieldAlert} count={node.privacyCount} singular="privacy rule" plural="privacy rules" tone="rose" />
                            <CountChip icon={KeyRound} count={node.indexCount} singular="index" plural="indexes" />
                        </div>
                    </div>

                    <ChevronDown
                        size={18}
                        className={`mt-0.5 shrink-0 text-neutral-400 transition-transform ${expanded ? 'rotate-180 text-indigo-500' : ''}`}
                        aria-hidden="true"
                    />
                </div>
            </button>

            {expanded && (
                <div className="px-4 pb-4 pt-1 space-y-4 border-t border-neutral-100">
                    {entity.purpose && (
                        <div className="rounded-lg bg-indigo-50/50 border border-indigo-100 px-3 py-2">
                            <p className="text-xs text-neutral-700">
                                <span className="font-semibold text-indigo-900">Purpose: </span>
                                {entity.purpose}
                            </p>
                        </div>
                    )}

                    {entity.groupsAutoDetected && (
                        <p className="text-[11px] text-neutral-400 italic">
                            Fields grouped automatically — refine the artifact for explicit grouping.
                        </p>
                    )}

                    {entity.fieldGroups.map((group, gi) => (
                        <FieldTable
                            key={gi}
                            group={group}
                            indexed={indexed}
                            entityName={entity.name}
                            initialMemberName={initialMemberAspect === 'field' ? initialMemberName : undefined}
                        />
                    ))}

                    {relationships.length > 0 && (
                        <InspectorSection title="Relationships">
                            {relationships.map((c, i) => {
                                const rel = parseRelationshipCallout(c.text);
                                if (!rel) return null;
                                const targetId = resolveTargetId(rel.target);
                                const label = rel.cardinality ? `${rel.verb} · ${rel.cardinality}` : rel.verb;
                                return (
                                    <InspectorRow
                                        key={i}
                                        id={dataModelMemberAnchorId(entity.name, 'relationship', c.text)}
                                        highlighted={initialMemberAspect === 'relationship' && initialMemberName === c.text}
                                        category="relationship"
                                        label={label}
                                        description={rel.description}
                                        linkLabel={rel.target}
                                        onLink={targetId ? () => onNavigateToEntity(targetId) : undefined}
                                    />
                                );
                            })}
                        </InspectorSection>
                    )}

                    {constraints.length > 0 && (
                        <InspectorSection title="Constraints">
                            {constraints.map((c, i) => (
                                <InspectorRow key={i} id={dataModelMemberAnchorId(entity.name, 'constraint', c.text)} highlighted={initialMemberAspect === 'constraint' && initialMemberName === c.text} category="constraint" label="" description={c.text} />
                            ))}
                        </InspectorSection>
                    )}

                    {privacy.length > 0 && (
                        <InspectorSection title="Privacy">
                            {privacy.map((c, i) => (
                                <InspectorRow key={i} id={dataModelMemberAnchorId(entity.name, 'data_expectation', c.text)} highlighted={initialMemberAspect === 'data_expectation' && initialMemberName === c.text} category="privacy" label="" description={c.text} />
                            ))}
                        </InspectorSection>
                    )}

                    {indexes.length > 0 && (
                        <InspectorSection title="Indexes">
                            {indexes.map((c, i) => (
                                <InspectorRow key={i} id={dataModelMemberAnchorId(entity.name, 'data_expectation', c.text)} highlighted={initialMemberAspect === 'data_expectation' && initialMemberName === c.text} category="index" label="" description={c.text} />
                            ))}
                        </InspectorSection>
                    )}

                    {entity.exampleRecord && (
                        <div className="space-y-1">
                            <h5 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">Example record</h5>
                            <p className="text-[11px] text-neutral-400 italic">Illustrative — not real data.</p>
                            <pre className="font-mono text-[11px] bg-neutral-900 text-neutral-100 rounded-lg p-3 overflow-x-auto whitespace-pre">
                                {entity.exampleRecord}
                            </pre>
                        </div>
                    )}
                </div>
            )}
        </section>
    );
}

function InspectorSection({ title, children }: { title: string; children: ReactNode }) {
    return (
        <div className="space-y-0.5">
            <h5 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 px-2.5">{title}</h5>
            <div className="divide-y divide-neutral-50">{children}</div>
        </div>
    );
}
