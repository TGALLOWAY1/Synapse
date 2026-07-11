import { Layers, Network, Table2 } from 'lucide-react';
import { StatusLegend } from './badges';

interface Props {
    /** Distinct category count (only shown when the model is grouped). */
    categoryCount: number;
    grouped: boolean;
    /** Whether the relationships diagram is present (drives the jump link). */
    hasRelationships: boolean;
    /** Whether an API-endpoints section is present (drives the jump link). */
    hasApiEndpoints: boolean;
}

/**
 * A compact, non-duplicative supporting panel for the entity browser. The page
 * header already carries the six summary metrics and the ER diagram, so this
 * guide deliberately shows only what those don't: the status-treatment legend,
 * a category count, and in-page jump links. On < xl it stacks below the list;
 * on xl it sits as a narrow sticky sidebar.
 */
export function EntityGuide({ categoryCount, grouped, hasRelationships, hasApiEndpoints }: Props) {
    return (
        <aside
            aria-label="Entity guide"
            className="rounded-xl border border-neutral-200 bg-neutral-50/60 p-4 space-y-4 xl:sticky xl:top-4"
        >
            <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Entity guide</h4>

            {grouped && categoryCount > 0 && (
                <div className="flex items-center gap-2 text-xs text-neutral-600">
                    <Layers size={14} className="text-neutral-400 shrink-0" />
                    <span>
                        <span className="font-semibold text-neutral-800 tabular-nums">{categoryCount}</span>{' '}
                        {categoryCount === 1 ? 'category' : 'categories'}
                    </span>
                </div>
            )}

            <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Status legend</p>
                <StatusLegend />
            </div>

            {(hasRelationships || hasApiEndpoints) && (
                <div className="space-y-2 border-t border-neutral-200 pt-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">On this page</p>
                    <div className="flex flex-col gap-1.5">
                        {hasRelationships && (
                            <a
                                href="#data-model-relationships"
                                className="inline-flex items-center gap-2 text-xs text-neutral-600 hover:text-indigo-700 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                            >
                                <Network size={14} className="text-neutral-400 shrink-0" /> Relationships diagram
                            </a>
                        )}
                        {hasApiEndpoints && (
                            <a
                                href="#data-model-api-endpoints"
                                className="inline-flex items-center gap-2 text-xs text-neutral-600 hover:text-indigo-700 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                            >
                                <Table2 size={14} className="text-neutral-400 shrink-0" /> API endpoints
                            </a>
                        )}
                    </div>
                </div>
            )}
        </aside>
    );
}
