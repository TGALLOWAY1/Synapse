// Shared styling for the Data Model renderer (category chips, inspector-row
// categories, field-type chips, graph node accents). Lives in its own module —
// not a component file — so component files keep exporting only components
// (the react-refresh/only-export-components rule).

import type { EntityCategory, FieldTypeKind } from '../../../lib/dataModelGraph';

/** Inspector-row categories — the compact colour language for detail rows. */
export type InspectorCategory = 'relationship' | 'constraint' | 'privacy' | 'index' | 'warning';

export const INSPECTOR_STYLES: Record<InspectorCategory, { badge: string; label: string; dot: string }> = {
    relationship: { badge: 'bg-blue-100 text-blue-700 ring-1 ring-blue-200', label: 'Relationship', dot: 'bg-blue-500' },
    constraint: { badge: 'bg-purple-100 text-purple-700 ring-1 ring-purple-200', label: 'Constraint', dot: 'bg-purple-500' },
    privacy: { badge: 'bg-rose-100 text-rose-700 ring-1 ring-rose-200', label: 'Privacy', dot: 'bg-rose-500' },
    index: { badge: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200', label: 'Index', dot: 'bg-slate-400' },
    warning: { badge: 'bg-amber-100 text-amber-800 ring-1 ring-amber-200', label: 'Warning', dot: 'bg-amber-500' },
};

/** Category chip + graph-node accent styling, one entry per derived category. */
export const CATEGORY_STYLES: Record<EntityCategory, {
    chip: string;
    /** Left border accent used on graph nodes + grouped section headers. */
    accent: string;
    /** Soft icon tile background. */
    tile: string;
}> = {
    core: { chip: 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-200', accent: 'border-l-indigo-400', tile: 'bg-indigo-50 text-indigo-600' },
    user_config: { chip: 'bg-violet-100 text-violet-700 ring-1 ring-violet-200', accent: 'border-l-violet-400', tile: 'bg-violet-50 text-violet-600' },
    generated: { chip: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200', accent: 'border-l-emerald-400', tile: 'bg-emerald-50 text-emerald-600' },
    system: { chip: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200', accent: 'border-l-slate-400', tile: 'bg-slate-100 text-slate-500' },
    external: { chip: 'bg-amber-100 text-amber-800 ring-1 ring-amber-200', accent: 'border-l-amber-400', tile: 'bg-amber-50 text-amber-600' },
};

/** Type-chip styling per coarse field-type family. */
export const FIELD_TYPE_STYLES: Record<FieldTypeKind, string> = {
    id: 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200',
    reference: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
    text: 'bg-neutral-100 text-neutral-600 ring-1 ring-neutral-200',
    number: 'bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200',
    boolean: 'bg-teal-50 text-teal-700 ring-1 ring-teal-200',
    datetime: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200',
    json: 'bg-fuchsia-50 text-fuchsia-700 ring-1 ring-fuchsia-200',
    enum: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200',
    other: 'bg-neutral-100 text-neutral-600 ring-1 ring-neutral-200',
};

/** SVG stroke colour for graph edges (default vs highlighted). */
export const EDGE_STROKE = { base: '#cbd5e1', active: '#6366f1', label: '#64748b' } as const;
