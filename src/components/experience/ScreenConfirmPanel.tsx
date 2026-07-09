// The single confirmation control for a screen — the ONE review action in the
// Screens artifact. It replaces the old three-action workflow (Request changes /
// Accept / Mark ready to build) with a plain toggle:
//
//   Needs Review   →   [Confirm Screen]
//   Screen Confirmed  ·  Confirmed from PRD Version N   →   [Edit again]
//
// "One screen. One confirmation." Confirming maps to the accepted review status
// (preserving the underlying data model + sign-off signature); editing the
// screen returns it to Needs Review. When a confirmed screen changed after
// sign-off we surface a calm "PRD sync" note instead of the old "freshness"
// wording. Presentational only — mutations go back through the callbacks.

import { Check, Circle, Pencil, RefreshCw } from 'lucide-react';
import type { ScreenReviewModel } from '../../lib/screenReviewWorkflow';

interface Props {
    model: ScreenReviewModel;
    /** "Version N" of the PRD this screen was confirmed against, when known. */
    confirmedFromPrd?: string;
    /** Confirm the screen (→ accepted + sign-off signature). */
    onConfirm: () => void;
    /** Return the screen to Needs Review so it can be edited. */
    onEditAgain: () => void;
    /** Re-confirm against the current spec (clears the "changed since confirmed" note). */
    onReconfirm: () => void;
    /** Absent onSave → read-only (demo / legacy inventory). */
    readOnly?: boolean;
}

export function ScreenConfirmPanel({
    model, confirmedFromPrd, onConfirm, onEditAgain, onReconfirm, readOnly,
}: Props) {
    const confirmed = model.userStatus === 'accepted' || model.userStatus === 'implementation_ready';
    const changedSinceConfirm = confirmed && model.freshness === 'outdated';

    return (
        <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3 shadow-sm">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 min-w-0">
                    {confirmed ? (
                        <>
                            <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-emerald-100">
                                <Check size={13} className="text-emerald-700" aria-hidden />
                            </span>
                            <div className="min-w-0">
                                <div className="text-sm font-semibold text-neutral-900">Screen confirmed</div>
                                {confirmedFromPrd && (
                                    <div className="text-[11px] text-neutral-500">Confirmed from PRD {confirmedFromPrd}</div>
                                )}
                            </div>
                        </>
                    ) : (
                        <>
                            <Circle size={16} className="text-neutral-300" aria-hidden />
                            <div className="text-sm font-medium text-neutral-700">Needs review</div>
                        </>
                    )}
                </div>

                {!readOnly && (
                    confirmed ? (
                        <button
                            type="button"
                            onClick={onEditAgain}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-neutral-100 hover:bg-neutral-200 text-neutral-700 transition"
                        >
                            <Pencil size={12} /> Edit again
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={onConfirm}
                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-md bg-emerald-600 hover:bg-emerald-700 text-white transition"
                        >
                            <Check size={13} /> Confirm screen
                        </button>
                    )
                )}
            </div>

            {changedSinceConfirm && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 flex items-start gap-2">
                    <RefreshCw size={13} className="text-amber-600 mt-0.5 shrink-0" aria-hidden />
                    <div className="min-w-0 flex-1">
                        <p className="text-[11px] text-amber-800">
                            This screen changed after it was confirmed. Re-confirm once you&rsquo;ve reviewed the update.
                        </p>
                    </div>
                    {!readOnly && (
                        <button
                            type="button"
                            onClick={onReconfirm}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md bg-amber-600 hover:bg-amber-700 text-white transition shrink-0"
                        >
                            Re-confirm
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
