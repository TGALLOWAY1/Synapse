// Dedicated accessibility block for a component card. Accessibility is never
// buried in notes. When the contract was inferred rather than authored we show
// an "Accessibility review needed" caption so the heuristic data isn't mistaken
// for a verified guarantee.

import { CircleCheck, CircleDashed, AlertCircle } from 'lucide-react';
import type { DerivedA11y } from './inferPreview';

function Row({ ok, label }: { ok: boolean | undefined; label: string }) {
    return (
        <li className="flex items-center gap-1.5 text-xs">
            {ok ? (
                <CircleCheck size={14} className="text-green-600 shrink-0" />
            ) : (
                <CircleDashed size={14} className="text-neutral-300 shrink-0" />
            )}
            <span className={ok ? 'text-neutral-700' : 'text-neutral-400'}>{label}</span>
        </li>
    );
}

export function AccessibilityChecklist({ a11y }: { a11y: DerivedA11y }) {
    return (
        <div>
            <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] uppercase tracking-wide text-neutral-400">Accessibility</span>
                {a11y.reviewNeeded && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-amber-600">
                        <AlertCircle size={12} />
                        review needed
                    </span>
                )}
            </div>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                <Row ok={a11y.keyboard} label="Keyboard Navigation" />
                <Row ok={a11y.focusManagement} label="Focus Management" />
                <Row ok={a11y.screenReader} label="Screen Reader Support" />
                <Row ok={!!a11y.aria?.length} label="ARIA Attributes" />
            </ul>
            {a11y.aria && a11y.aria.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                    {a11y.aria.map((attr, i) => (
                        <span key={i} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-600">
                            {attr}
                        </span>
                    ))}
                </div>
            )}
            {a11y.notes && <p className="text-xs text-neutral-500 mt-2">{a11y.notes}</p>}
        </div>
    );
}
