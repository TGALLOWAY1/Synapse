import type { ReactNode } from 'react';
import {
    Boxes, Cable, Cog, Fingerprint, KeyRound, ShieldCheck, Sparkles, User,
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
 * Compact attribute badges for an entity: visibility, mutability, PII, indexed.
 * These sit alongside the category chip and stay readable at any width.
 */
export function EntityAttributeBadges({ node }: { node: DataModelNode }) {
    return (
        <span className="inline-flex flex-wrap items-center gap-1">
            {node.userFacing !== undefined && (
                <Pill className={node.userFacing
                    ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                    : 'bg-slate-100 text-slate-600 ring-1 ring-slate-200'}>
                    {node.userFacing ? 'User-facing' : 'System'}
                </Pill>
            )}
            {node.mutability && (
                <Pill className={mutabilityClass(node.mutability)}>{node.mutability}</Pill>
            )}
            {node.hasPII ? (
                <Pill className="bg-rose-50 text-rose-700 ring-1 ring-rose-200">
                    <Fingerprint size={10} className="shrink-0" /> Contains PII
                </Pill>
            ) : (
                <Pill className="bg-neutral-50 text-neutral-500 ring-1 ring-neutral-200">
                    <ShieldCheck size={10} className="shrink-0" /> No PII
                </Pill>
            )}
            {node.indexed && (
                <Pill className="bg-slate-50 text-slate-600 ring-1 ring-slate-200">
                    <KeyRound size={10} className="shrink-0" /> Indexed
                </Pill>
            )}
        </span>
    );
}

function mutabilityClass(mutability: string): string {
    const m = mutability.toLowerCase();
    if (m.includes('immutable') && !m.includes('mostly')) return 'bg-slate-50 text-slate-600 ring-1 ring-slate-200';
    if (m.includes('mostly')) return 'bg-blue-50 text-blue-700 ring-1 ring-blue-200';
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
