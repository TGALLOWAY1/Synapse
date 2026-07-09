// Phase 4B: the Screens implementation preflight — a local, collapsible
// decision surface shown above the screen list. It summarizes whether the
// Screens artifact is ready to inform implementation planning / export:
// blocking items, review-recommended items, informational notes, prioritized
// next steps, and export/snapshot caveats. Purely presentational over the
// derived ScreensPreflightModel (src/lib/screenDownstreamImpact.ts) — it is a
// decision surface, NEVER a hard gate (nothing here blocks normal use). We
// deliberately avoid hooking into export/finalization flows: there is no
// Screens-specific export action today, so this local panel is the Phase 4B
// preflight surface (see the export-hook note in CLAUDE.md).

import { useState } from 'react';
import {
    AlertOctagon, CheckCircle2, ChevronDown, ChevronUp, ClipboardList, Info, ListChecks, ShieldQuestion,
} from 'lucide-react';
import type { ScreensPreflightModel } from '../../lib/screenDownstreamImpact';

interface Props {
    preflight: ScreensPreflightModel;
}

const STATUS_META: Record<ScreensPreflightModel['status'], { tone: 'good' | 'warn'; }> = {
    ready: { tone: 'good' },
    review_recommended: { tone: 'warn' },
    not_ready: { tone: 'warn' },
};

export function ScreenPreflightPanel({ preflight }: Props) {
    // Default open only when there's something to act on — a ready artifact
    // stays collapsed so it doesn't nag.
    const hasContent = preflight.blocking.length > 0 || preflight.review.length > 0
        || preflight.recommendedNextActions.length > 0;
    const [open, setOpen] = useState(preflight.status !== 'ready' && hasContent);

    const good = STATUS_META[preflight.status].tone === 'good';

    return (
        <div className="rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
            <button
                type="button"
                onClick={() => setOpen(v => !v)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-neutral-50 transition"
            >
                <div className="flex items-center gap-2 min-w-0">
                    <div className={`h-7 w-7 shrink-0 rounded-lg flex items-center justify-center ${good ? 'bg-emerald-50' : 'bg-amber-50'}`}>
                        <ClipboardList size={15} className={good ? 'text-emerald-600' : 'text-amber-600'} />
                    </div>
                    <div className="min-w-0 text-left">
                        <h3 className="text-sm font-semibold text-neutral-900">Implementation preflight</h3>
                        <p className={`text-[11px] ${good ? 'text-emerald-700' : 'text-amber-700'}`}>{preflight.headline}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    {preflight.blocking.length > 0 && (
                        <span className="text-[10px] font-medium text-red-700 bg-red-50 ring-1 ring-red-200 px-1.5 py-0.5 rounded-full">
                            {preflight.blocking.length} blocking
                        </span>
                    )}
                    {preflight.review.length > 0 && (
                        <span className="text-[10px] font-medium text-amber-700 bg-amber-50 ring-1 ring-amber-200 px-1.5 py-0.5 rounded-full">
                            {preflight.review.length} review
                        </span>
                    )}
                    {open ? <ChevronUp size={16} className="text-neutral-400" /> : <ChevronDown size={16} className="text-neutral-400" />}
                </div>
            </button>

            {open && (
                <div className="px-4 pb-4 space-y-3 border-t border-neutral-100 pt-3">
                    {preflight.status === 'ready' && preflight.blocking.length === 0 && preflight.review.length === 0 && (
                        <p className="inline-flex items-center gap-1.5 text-xs text-emerald-700">
                            <CheckCircle2 size={13} />
                            All P0 screens are signed off and current. No blocking downstream impacts detected.
                        </p>
                    )}

                    {preflight.blocking.length > 0 && (
                        <Group
                            icon={<AlertOctagon size={13} className="text-red-600" />}
                            title="Blocking"
                            items={preflight.blocking}
                            tone="text-red-700"
                        />
                    )}
                    {preflight.review.length > 0 && (
                        <Group
                            icon={<ShieldQuestion size={13} className="text-amber-600" />}
                            title="Review recommended"
                            items={preflight.review}
                            tone="text-amber-700"
                        />
                    )}
                    {preflight.info.length > 0 && (
                        <Group
                            icon={<Info size={13} className="text-neutral-400" />}
                            title="For your information"
                            items={preflight.info}
                            tone="text-neutral-600"
                        />
                    )}

                    {preflight.recommendedNextActions.length > 0 && (
                        <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-3">
                            <div className="flex items-center gap-1.5 mb-1.5">
                                <ListChecks size={13} className="text-indigo-500" aria-hidden />
                                <h4 className="text-[11px] font-semibold uppercase tracking-wide text-indigo-600">
                                    Recommended next steps
                                </h4>
                            </div>
                            <ol className="space-y-1 text-xs text-neutral-700 list-decimal list-inside">
                                {preflight.recommendedNextActions.map((a, i) => <li key={i}>{a}</li>)}
                            </ol>
                        </div>
                    )}

                    {preflight.caveats.length > 0 && (
                        <ul className="space-y-1 text-[11px] text-neutral-400">
                            {preflight.caveats.map((c, i) => (
                                <li key={i} className="flex gap-1.5">
                                    <span className="select-none">·</span>
                                    <span>{c}</span>
                                </li>
                            ))}
                        </ul>
                    )}

                    <p className="text-[11px] text-neutral-400">
                        Preflight is advisory and derived from the current screen state — it never blocks using
                        the Screens artifact.
                    </p>
                </div>
            )}
        </div>
    );
}

function Group({ icon, title, items, tone }: {
    icon: React.ReactNode; title: string; items: string[]; tone: string;
}) {
    return (
        <div>
            <div className="flex items-center gap-1.5 mb-1">
                {icon}
                <h4 className={`text-[11px] font-semibold uppercase tracking-wide ${tone}`}>{title}</h4>
            </div>
            <ul className="space-y-0.5 text-xs text-neutral-700">
                {items.map((item, i) => (
                    <li key={i} className="flex gap-1.5">
                        <span className="text-neutral-300 select-none">·</span>
                        <span>{item}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}
