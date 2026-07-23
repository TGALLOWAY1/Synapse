import { ExternalLink, Lightbulb, HelpCircle, CircleDashed } from 'lucide-react';
import type { AssetOpenItem, AssetOpenItemKind } from '../../lib/planning/assetOpenItems';

interface Props {
    items: AssetOpenItem[];
    /** Navigates to the exact flow/region the item was scanned out of. */
    onOpen?: (item: AssetOpenItem) => void;
    /** Promotes the item into a real planning record via flag-to-plan. */
    onAddToPlan?: (item: AssetOpenItem) => void;
    /** Ids already promoted — the add action collapses to a static label. */
    promotedIds?: ReadonlySet<string>;
    readOnly?: boolean;
}

const KIND_META: Record<AssetOpenItemKind, { label: string; tone: string; Icon: typeof Lightbulb }> = {
    open_question: { label: 'Open question', tone: 'bg-sky-100 text-sky-800', Icon: HelpCircle },
    assumption: { label: 'Assumption', tone: 'bg-amber-100 text-amber-900', Icon: Lightbulb },
    unresolved_marker: { label: 'Marked open', tone: 'bg-neutral-200 text-neutral-800', Icon: CircleDashed },
};

/**
 * Advisory list of open items scanned out of the generated outputs.
 *
 * These are candidates, not authority: they are derived on every read, never
 * persisted, and never counted toward the "needs an answer" total. Acting on
 * one means promoting it into a real planning record — that promotion is the
 * only thing that becomes durable.
 */
export function AssetOpenItemsPanel({ items, onOpen, onAddToPlan, promotedIds, readOnly }: Props) {
    if (items.length === 0) return null;

    return (
        <section className="border-t border-neutral-200 p-3" aria-label="Open items found in outputs">
            <div className="px-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                    From your outputs · {items.length}
                </p>
                <p className="mt-1 text-xs leading-5 text-neutral-500">
                    Questions and assumptions still sitting in your generated outputs. Advisory —
                    add one to the plan to make it a decision you own.
                </p>
            </div>
            <ul className="mt-2 space-y-1.5">
                {items.map(item => {
                    const meta = KIND_META[item.kind];
                    const promoted = promotedIds?.has(item.id) ?? false;
                    return (
                        <li key={item.id} className="rounded-xl border border-neutral-200 bg-white p-2.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                                <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${meta.tone}`}>
                                    <meta.Icon size={10} /> {meta.label}
                                </span>
                                <span className="text-[10px] text-neutral-500">{item.artifactTitle}</span>
                            </div>
                            <p className="mt-1.5 text-sm leading-5 text-neutral-800">{item.text}</p>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                                {onOpen && (
                                    <button
                                        type="button"
                                        onClick={() => onOpen(item)}
                                        aria-label={`Open ${item.locationLabel} in ${item.artifactTitle}`}
                                        className="inline-flex min-h-8 max-w-full items-center gap-1 rounded-lg border border-neutral-200 px-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50"
                                    >
                                        <ExternalLink size={11} className="shrink-0" />
                                        {/* The queue rail is ~320px — a long flow title
                                            must truncate rather than push the row wide. */}
                                        <span className="min-w-0 truncate">
                                            {item.locationLabel}
                                            {typeof item.flowStepIndex === 'number' && ` · Step ${item.flowStepIndex + 1}`}
                                        </span>
                                    </button>
                                )}
                                {promoted ? (
                                    <span className="text-xs font-semibold text-emerald-700">Added to plan</span>
                                ) : !readOnly && onAddToPlan ? (
                                    <button
                                        type="button"
                                        onClick={() => onAddToPlan(item)}
                                        aria-label={`Add "${item.text}" to the plan`}
                                        className="inline-flex min-h-8 items-center rounded-lg bg-neutral-900 px-2.5 text-xs font-semibold text-white hover:bg-neutral-800"
                                    >
                                        Add to plan
                                    </button>
                                ) : null}
                            </div>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
