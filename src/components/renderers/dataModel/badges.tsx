import type { ReactElement, ReactNode } from 'react';
import {
    Boxes, Cable, Cog, Fingerprint, ShieldCheck, Sparkles, User,
} from 'lucide-react';
import type { DataModelNode, EntityCategory, FieldTypeKind } from '../../../lib/dataModelGraph';
import { ENTITY_CATEGORY_LABEL } from '../../../lib/dataModelGraph';
import {
    CATEGORY_STYLES, FIELD_TYPE_STYLES, INSPECTOR_STYLES, type InspectorCategory,
} from './dataModelStyles';

const CATEGORY_ICON: Record<EntityCategory, typeof Boxes> = {
    core: Boxes,
    user_config: User,
    generated: Sparkles,
    system: Cog,
    external: Cable,
};

export function CategoryBadge({ category, size = 'sm' }: { category: EntityCategory; size?: 'sm' | 'xs' }) {
    const Icon = CATEGORY_ICON[category];
    const pad = size === 'xs' ? 'text-[10px] px-1.5 py-0.5' : 'text-[11px] px-2 py-0.5';
    return (
        <span className={`inline-flex items-center gap-1 rounded-full font-medium ${pad} ${CATEGORY_STYLES[category].chip}`}>
            <Icon size={size === 'xs' ? 10 : 11} className="shrink-0" />
            {ENTITY_CATEGORY_LABEL[category]}
        </span>
    );
}

/**
 * A full-width, soft-tinted category header band that visually connects a
 * category to the entity cards beneath it — replacing the old detached pill +
 * horizontal rule. Icon tile + name on the left, entity count pill on the right.
 * Presentational only, not a semantic heading, so section heading order
 * (Entities `h3` → entity-card `h4`) stays correct in both grouped and
 * ungrouped modes.
 */
export function CategoryHeader({ category, count }: { category: EntityCategory; count: number }) {
    const Icon = CATEGORY_ICON[category];
    const style = CATEGORY_STYLES[category];
    return (
        <div className={`flex items-center gap-2.5 rounded-lg px-3 py-2 ${style.band}`}>
            <span className={`inline-flex items-center justify-center w-6 h-6 rounded-md shrink-0 ${style.tile}`}>
                <Icon size={14} />
            </span>
            <span className="min-w-0 flex-1 text-sm font-semibold text-neutral-800 truncate">
                {ENTITY_CATEGORY_LABEL[category]}
            </span>
            <span className={`inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-[11px] font-semibold tabular-nums ${style.count}`}>
                {count}
            </span>
        </div>
    );
}

/**
 * A compact, restrained legend explaining the status treatments used on entity
 * cards (status is never communicated by colour alone — each swatch is labelled).
 */
export function StatusLegend() {
    const rows: Array<{ swatch: string; label: string }> = [
        { swatch: 'bg-emerald-400', label: 'User-facing — visible to end users' },
        { swatch: 'bg-slate-400', label: 'System — internal data' },
        { swatch: 'bg-amber-400', label: 'Mutable — can be updated' },
        { swatch: 'bg-blue-400', label: 'Immutable — read-only after creation' },
        { swatch: 'bg-rose-400', label: 'Contains PII — privacy-sensitive' },
    ];
    return (
        <ul className="space-y-1.5">
            {rows.map(r => (
                <li key={r.label} className="flex items-center gap-2 text-[11px] text-neutral-600">
                    <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${r.swatch}`} aria-hidden="true" />
                    <span className="min-w-0">{r.label}</span>
                </li>
            ))}
        </ul>
    );
}

/**
 * The small set of high-value, semantic status labels for an entity, in priority
 * order: Contains PII → visibility (User-facing / System) → mutability →
 * (No PII, lowest). These are the only statuses shown in the primary card area —
 * quantitative facts like index/relationship counts live in the metadata footer,
 * so "Indexed" is deliberately NOT a status chip (it duplicates "N indexes").
 *
 * Returns a fragment of pills so the caller's flex row controls spacing (and can
 * prepend a category chip in ungrouped mode). When `collapsed` (a mobile card
 * that isn't expanded), the lowest-value "No PII" chip is dropped so small
 * screens stay tidy; desktop / expanded cards always show it.
 */
export function EntityAttributeBadges({ node, collapsed = false }: { node: DataModelNode; collapsed?: boolean }) {
    const chips: ReactElement[] = [];

    // Priority 1 — PII. "Contains PII" is trust/safety-relevant and always leads.
    if (node.hasPII) {
        chips.push(
            <Pill key="pii" className="bg-rose-50 text-rose-700 ring-1 ring-rose-200">
                <Fingerprint size={10} className="shrink-0" /> Contains PII
            </Pill>,
        );
    }
    // Priority 2 — visibility.
    if (node.userFacing !== undefined) {
        chips.push(
            <Pill key="visibility" className={node.userFacing
                ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                : 'bg-slate-100 text-slate-600 ring-1 ring-slate-200'}>
                {node.userFacing ? 'User-facing' : 'System'}
            </Pill>,
        );
    }
    // Priority 3 — mutability.
    if (node.mutability) {
        chips.push(<Pill key="mutability" className={mutabilityClass(node.mutability)}>{node.mutability}</Pill>);
    }
    // Lowest priority — "No PII". Reassuring but not urgent, so it is shown only on
    // expanded/desktop cards and dropped on collapsed mobile cards.
    if (!node.hasPII && !collapsed) {
        chips.push(
            <Pill key="no-pii" className="bg-neutral-50 text-neutral-500 ring-1 ring-neutral-200">
                <ShieldCheck size={10} className="shrink-0" /> No PII
            </Pill>,
        );
    }

    return <>{chips}</>;
}

function mutabilityClass(mutability: string): string {
    // Two-colour mutability language matching the status legend: any immutable
    // variant (incl. "mostly immutable") reads blue (read-only-leaning);
    // everything else (mutable) reads amber (can be updated).
    const m = mutability.toLowerCase();
    if (m.includes('immutable')) return 'bg-blue-50 text-blue-700 ring-1 ring-blue-200';
    return 'bg-amber-50 text-amber-700 ring-1 ring-amber-200';
}

function Pill({ className, children }: { className: string; children: ReactNode }) {
    return (
        <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${className}`}>
            {children}
        </span>
    );
}

export function FieldTypeChip({ kind, label }: { kind: FieldTypeKind; label: string }) {
    return (
        <span className={`inline-block font-mono text-[11px] px-1.5 py-0.5 rounded ${FIELD_TYPE_STYLES[kind]}`}>
            {label}
        </span>
    );
}

/**
 * A compact inspector row — a small category dot/badge, a short label, optional
 * description, and an optional linked-entity affordance. Replaces the large
 * stacked callout cards for relationships / constraints / privacy / indexes.
 */
export function InspectorRow({
    category, label, description, linkLabel, onLink,
}: {
    category: InspectorCategory;
    label: string;
    description?: string;
    linkLabel?: string;
    onLink?: () => void;
}) {
    const style = INSPECTOR_STYLES[category];
    return (
        <div className="flex items-start gap-2.5 px-2.5 py-2 rounded-lg hover:bg-neutral-50 transition">
            <span className={`mt-0.5 shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${style.badge}`}>
                {style.label}
            </span>
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                    {label && <span className="text-[13px] font-medium text-neutral-800">{label}</span>}
                    {linkLabel && (
                        onLink ? (
                            <button
                                type="button"
                                onClick={onLink}
                                className="text-[11px] font-medium text-blue-600 hover:text-blue-800 hover:underline underline-offset-2"
                            >
                                → {linkLabel}
                            </button>
                        ) : (
                            <span className="text-[11px] font-medium text-neutral-500">→ {linkLabel}</span>
                        )
                    )}
                </div>
                {description && <p className="text-xs text-neutral-600 leading-relaxed mt-0.5">{description}</p>}
            </div>
        </div>
    );
}
