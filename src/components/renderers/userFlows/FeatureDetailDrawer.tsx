import { useEffect } from 'react';
import { CheckCircle2, ExternalLink, Layers, Pin, PinOff, X } from 'lucide-react';
import type { Feature } from '../../../types';
import type { FeatureRef, ParsedFlow } from './types';
import { inlineMd } from './markdown';

interface Props {
    open: boolean;
    refToken: FeatureRef | null;
    feature: Feature | undefined;
    flows: ParsedFlow[];
    onClose: () => void;
    pinned: boolean;
    onTogglePin: () => void;
}

function findLinkedFlows(refId: string, flows: ParsedFlow[]): ParsedFlow[] {
    return flows.filter(f => f.featureRefs.some(r => r.id === refId));
}

function formatTier(tier: Feature['tier']): string {
    switch (tier) {
        case 'mvp': return 'MVP';
        case 'v1': return 'V1';
        case 'later': return 'Later';
        default: return '';
    }
}

export function FeatureDetailDrawer({
    open, refToken, feature, flows, onClose, pinned, onTogglePin,
}: Props) {
    useEffect(() => {
        if (!open || pinned) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose, pinned]);

    const idLabel = feature?.id ?? refToken?.id.toUpperCase() ?? '';
    const name = feature?.name ?? 'Feature reference';
    const linkedFlows = refToken ? findLinkedFlows(refToken.id, flows) : [];
    const tier = feature?.tier ? formatTier(feature.tier) : '';

    return (
        <>
            {/* Backdrop only when not pinned, so the user can still read flow content while pinned */}
            {open && !pinned && (
                <button
                    type="button"
                    aria-label="Close feature details"
                    onClick={onClose}
                    className="fixed inset-0 bg-black/30 z-40"
                />
            )}
            <aside
                role="dialog"
                aria-label="Feature details"
                aria-hidden={!open}
                className={`fixed top-0 right-0 h-full w-full sm:w-[380px] max-w-[95vw] bg-white border-l border-neutral-200 shadow-xl z-50 transform transition-transform duration-200 ease-out ${
                    open ? 'translate-x-0' : 'translate-x-full'
                }`}
            >
                <div className="flex flex-col h-full">
                    <header className="flex items-start justify-between gap-2 px-4 py-3 border-b border-neutral-200">
                        <div className="min-w-0 flex-1">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-fuchsia-700">
                                Feature {idLabel}
                            </p>
                            <h2 className="text-sm font-bold text-neutral-900 leading-snug truncate">
                                {name}
                            </h2>
                        </div>
                        <div className="flex items-center gap-1">
                            <button
                                type="button"
                                onClick={onTogglePin}
                                title={pinned ? 'Unpin drawer' : 'Pin drawer'}
                                aria-pressed={pinned}
                                className={`p-1 rounded hover:bg-neutral-100 ${
                                    pinned ? 'text-fuchsia-700' : 'text-neutral-500'
                                }`}
                            >
                                {pinned ? <Pin size={14} /> : <PinOff size={14} />}
                            </button>
                            <button
                                type="button"
                                onClick={onClose}
                                className="p-1 rounded hover:bg-neutral-100 text-neutral-500"
                                aria-label="Close"
                            >
                                <X size={16} />
                            </button>
                        </div>
                    </header>

                    <div className="flex-1 overflow-y-auto p-4 space-y-5 text-sm">
                        {!feature && (
                            <section className="bg-neutral-50 border border-neutral-200 rounded-lg p-3 text-neutral-600 text-xs leading-snug">
                                <p className="font-medium text-neutral-700 mb-1">
                                    No additional feature metadata available
                                </p>
                                <p>
                                    This flow references <span className="font-mono">{idLabel}</span>,
                                    but the canonical feature catalog does not contain a matching entry.
                                    The reference will resolve once the feature is defined in the PRD.
                                </p>
                            </section>
                        )}

                        {feature && (
                            <>
                                <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-fuchsia-50 text-fuchsia-700 border border-fuchsia-200">
                                        {feature.id}
                                    </span>
                                    {feature.priority && (
                                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 capitalize">
                                            {feature.priority}
                                        </span>
                                    )}
                                    {feature.complexity && (
                                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-700 capitalize">
                                            {feature.complexity} complexity
                                        </span>
                                    )}
                                    {tier && (
                                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">
                                            {tier}
                                        </span>
                                    )}
                                </div>

                                {feature.description && (
                                    <section>
                                        <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-1">
                                            Summary
                                        </p>
                                        <div className="text-neutral-800 leading-relaxed">
                                            {inlineMd(feature.description)}
                                        </div>
                                    </section>
                                )}

                                {feature.userValue && (
                                    <section>
                                        <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-1">
                                            User value
                                        </p>
                                        <div className="text-neutral-700 leading-relaxed">
                                            {inlineMd(feature.userValue)}
                                        </div>
                                    </section>
                                )}

                                {feature.acceptanceCriteria && feature.acceptanceCriteria.length > 0 && (
                                    <section>
                                        <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-1.5">
                                            Key capabilities
                                        </p>
                                        <ul className="space-y-1.5">
                                            {feature.acceptanceCriteria.map((c, i) => (
                                                <li key={i} className="flex items-start gap-2">
                                                    <CheckCircle2 size={14} className="shrink-0 mt-0.5 text-emerald-600" />
                                                    <span className="text-neutral-700">{inlineMd(c)}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </section>
                                )}

                                {feature.successCriteria && feature.successCriteria.length > 0 && (
                                    <section>
                                        <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-1.5">
                                            Success criteria
                                        </p>
                                        <ul className="space-y-1.5">
                                            {feature.successCriteria.map((c, i) => (
                                                <li key={i} className="flex items-start gap-2">
                                                    <CheckCircle2 size={14} className="shrink-0 mt-0.5 text-emerald-600" />
                                                    <span className="text-neutral-700">{inlineMd(c)}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </section>
                                )}

                                {feature.edgeCases && feature.edgeCases.length > 0 && (
                                    <section>
                                        <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-1.5">
                                            Edge cases
                                        </p>
                                        <ul className="space-y-1 text-neutral-700">
                                            {feature.edgeCases.map((c, i) => (
                                                <li key={i} className="flex gap-2">
                                                    <span className="text-neutral-400">•</span>
                                                    <span>{inlineMd(c)}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </section>
                                )}

                                {feature.dependencies && feature.dependencies.length > 0 && (
                                    <section>
                                        <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-1.5 flex items-center gap-1">
                                            <Layers size={11} /> Dependencies
                                        </p>
                                        <div className="flex flex-wrap gap-1">
                                            {feature.dependencies.map((dep, i) => (
                                                <code
                                                    key={i}
                                                    className="text-[11px] font-mono bg-neutral-100 text-neutral-700 px-1.5 py-0.5 rounded"
                                                >
                                                    {dep}
                                                </code>
                                            ))}
                                        </div>
                                    </section>
                                )}
                            </>
                        )}

                        {linkedFlows.length > 0 && (
                            <section>
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-1.5">
                                    Linked flows
                                </p>
                                <ul className="space-y-1.5">
                                    {linkedFlows.map((f, i) => (
                                        <li
                                            key={i}
                                            className="flex items-start gap-2 px-2 py-1.5 rounded-md bg-neutral-50 border border-neutral-200"
                                        >
                                            <ExternalLink size={12} className="shrink-0 mt-0.5 text-neutral-400" />
                                            <div className="min-w-0 flex-1">
                                                <p className="text-xs font-medium text-neutral-800 leading-snug">
                                                    {f.title}
                                                </p>
                                                <p className="text-[10px] text-neutral-500">{f.category}</p>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        )}
                    </div>
                </div>
            </aside>
        </>
    );
}
