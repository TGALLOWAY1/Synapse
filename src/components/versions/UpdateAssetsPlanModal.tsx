// Two-speed output sync. Quick sync uses the existing per-output triage choices
// and runs a dependency-safe regeneration batch; Careful sync opens the
// existing bounded, per-region update plans. Presentational: the caller owns
// freshness, execution, and navigation.

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ListChecks, PencilLine, RefreshCcw, ShieldCheck, X } from 'lucide-react';
import type {
    OutputSyncChoice,
    OutputSyncExecutionPlan,
    OutputSyncRow,
} from '../../lib/outputSyncPlan';

export type UpdatePlanChoice = OutputSyncChoice;
export type UpdatePlanRow = OutputSyncRow;

interface UpdateAssetsPlanModalProps {
    /** Positional label of the current PRD version ("Version 3"). */
    prdLabel: string;
    /** Project-level summary of why sync is being offered. */
    changeHeadline?: string;
    rows: UpdatePlanRow[];
    /** Apply Quick-sync choices. Keys are row ids. */
    onConfirm: (choices: Record<string, UpdatePlanChoice>) => void;
    /** Dependency-aware preview used to explain choices that cannot be applied safely. */
    previewExecution?: (choices: Record<string, UpdatePlanChoice>) => OutputSyncExecutionPlan;
    /** Open one already-generated per-region Careful plan. */
    onOpenCareful?: (planId: string) => void;
    /** Disable all Quick writes, normally because another job is active. */
    quickDisabled?: boolean;
    /** Blocks regeneration choices while still allowing mark-current-only sync. */
    regenerationDisabledReason?: string;
    onCancel: () => void;
}

const CHOICE_LABELS: Record<UpdatePlanChoice, string> = {
    update: 'Regenerate',
    mark_current: 'Mark up to date',
    skip: 'Decide later',
};

export function UpdateAssetsPlanModal({
    prdLabel, changeHeadline, rows, onConfirm, previewExecution, onOpenCareful, quickDisabled = false,
    regenerationDisabledReason, onCancel,
}: UpdateAssetsPlanModalProps) {
    const dialogRef = useRef<HTMLDivElement>(null);
    const initialFocusRef = useRef<HTMLButtonElement>(null);
    const cancelRef = useRef(onCancel);
    const [choices, setChoices] = useState<Record<string, UpdatePlanChoice>>(
        () => Object.fromEntries(rows.map(r => [r.id, r.defaultChoice])),
    );

    useEffect(() => {
        cancelRef.current = onCancel;
    }, [onCancel]);

    useEffect(() => {
        const previouslyFocused = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        initialFocusRef.current?.focus();

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                cancelRef.current();
                return;
            }
            if (event.key !== 'Tab' || !dialogRef.current) return;
            const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
                'button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
            )];
            if (focusable.length === 0) {
                event.preventDefault();
                dialogRef.current.focus();
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            previouslyFocused?.focus();
        };
    }, []);

    const setChoice = (id: string, choice: UpdatePlanChoice) =>
        setChoices(prev => ({ ...prev, [id]: choice }));

    const updateCount = rows.filter(r => choices[r.id] === 'update').length;
    const executionPreview = previewExecution?.(choices);
    const requestedKeepCount = rows.filter(r => choices[r.id] === 'mark_current').length;
    const keepCount = executionPreview?.markCurrent.length ?? requestedKeepCount;
    const deferredRows = executionPreview
        ? executionPreview.deferredMarkCurrent
            .map(slot => rows.find(row => row.id === slot))
            .filter((row): row is UpdatePlanRow => Boolean(row))
        : [];
    const deferredRegeneration = new Set(executionPreview?.regenerate ?? []);
    const skipStaleCount = rows.filter(r => r.isDrifted && choices[r.id] === 'skip').length;
    const carefulRows = rows.filter(row => row.isDrifted && row.carefulSupported);
    const unsupportedCarefulRows = rows.filter(row => row.isDrifted && !row.carefulSupported);
    const confirmDisabled = quickDisabled || (updateCount > 0 && Boolean(regenerationDisabledReason));

    const confirmLabel = updateCount > 0
        ? `Sync ${updateCount}${keepCount > 0 ? ` · keep ${keepCount} current` : ''}`
        : keepCount > 0
            ? `Keep ${keepCount} current`
            : 'Close without changes';

    return (
        <div
            className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center p-4"
            onClick={onCancel}
            role="presentation"
        >
            <div
                ref={dialogRef}
                className="bg-white rounded-xl shadow-xl border border-neutral-200 w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden"
                onClick={e => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="output-sync-title"
                tabIndex={-1}
            >
                <div className="px-5 pt-5 pb-3 shrink-0">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <h3 id="output-sync-title" className="text-base font-bold text-neutral-900">
                                Sync outputs with PRD {prdLabel}
                            </h3>
                            <p className="text-sm text-neutral-600 mt-1">
                                Quick sync regenerates selected outputs in dependency order. Mark an
                                output current when you have reviewed it, or leave it for later.
                            </p>
                        </div>
                        <button
                            ref={initialFocusRef}
                            type="button"
                            onClick={onCancel}
                            aria-label="Cancel output sync"
                            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700"
                        >
                            <X size={16} />
                        </button>
                    </div>
                    {changeHeadline && (
                        <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50 p-3">
                            <div className="text-xs font-semibold text-indigo-900">
                                What changed
                            </div>
                            <p className="text-xs text-indigo-800 mt-0.5 leading-relaxed">{changeHeadline}</p>
                        </div>
                    )}
                </div>

                <div className="px-5 space-y-2 overflow-y-auto min-h-0">
                    {rows.map(row => {
                        const choice = choices[row.id];
                        return (
                            <div
                                key={row.id}
                                className={`rounded-lg border p-3 ${row.isDrifted ? 'border-amber-200 bg-amber-50/50' : 'border-neutral-200'}`}
                            >
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                    <span className="text-sm font-semibold text-neutral-900">{row.title}</span>
                                    <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${
                                        row.isDrifted
                                            ? 'bg-amber-50 text-amber-800 border-amber-300'
                                            : 'bg-green-50 text-green-700 border-green-200'
                                    }`}>
                                        {row.statusLabel}
                                    </span>
                                </div>
                                {row.changeHeadline && (
                                    <p className="text-[11px] text-neutral-600 mt-1 leading-relaxed">
                                        {row.changeHeadline}
                                    </p>
                                )}
                                {row.likelyUnaffected && (
                                    <p className="text-[11px] text-neutral-500 mt-1 leading-relaxed">
                                        The changed PRD sections aren&rsquo;t ones this asset chiefly derives from.
                                    </p>
                                )}
                                {row.manuallyEdited && (
                                    <p className="mt-1 inline-flex items-start gap-1 text-[11px] leading-relaxed text-amber-800">
                                        <PencilLine size={12} className="mt-0.5 shrink-0" />
                                        This version includes manual edits. Regeneration creates a new version;
                                        review those edits before replacing your preferred output.
                                    </p>
                                )}
                                <fieldset className="mt-2">
                                    <legend className="sr-only">Sync action for {row.title}</legend>
                                    <div className="grid w-full grid-cols-3 rounded-lg border border-neutral-200 bg-white p-0.5">
                                        {(['update', 'mark_current', 'skip'] as UpdatePlanChoice[]).map(c => {
                                            const disabled = c === 'mark_current' && !row.canMarkCurrent;
                                            return (
                                                <label
                                                    key={c}
                                                    className={`relative inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md px-1.5 py-1 text-center text-[11px] font-medium transition focus-within:ring-2 focus-within:ring-indigo-500 focus-within:ring-offset-1 ${
                                                        choice === c
                                                            ? c === 'update'
                                                                ? 'bg-indigo-600 text-white'
                                                                : c === 'mark_current'
                                                                    ? 'bg-emerald-600 text-white'
                                                                    : 'bg-neutral-600 text-white'
                                                            : disabled
                                                                ? 'text-neutral-300 cursor-not-allowed'
                                                                : 'text-neutral-600 hover:text-neutral-900'
                                                    }`}
                                                >
                                                    <input
                                                        type="radio"
                                                        name={`output-sync-${row.id}`}
                                                        value={c}
                                                        checked={choice === c}
                                                        disabled={disabled}
                                                        onChange={() => setChoice(row.id, c)}
                                                        className="sr-only"
                                                    />
                                                    {CHOICE_LABELS[c]}
                                                </label>
                                            );
                                        })}
                                    </div>
                                </fieldset>
                            </div>
                        );
                    })}
                </div>

                <div className="min-h-0 max-h-[55vh] shrink-0 space-y-2 overflow-y-auto px-5 py-4">
                    <details className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2">
                        <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-xs font-semibold text-neutral-800">
                            <ListChecks size={14} /> Careful sync · review region by region
                        </summary>
                        <div className="border-t border-neutral-200 pb-1 pt-2">
                            <p className="text-[11px] leading-relaxed text-neutral-600">
                                Careful sync preserves the rest of an output and opens deterministic,
                                already-prepared region findings for review.
                            </p>
                            {carefulRows.length > 0 ? (
                                <div className="mt-2 space-y-1.5">
                                    {carefulRows.map(row => (
                                        <div key={row.id} className="flex items-center justify-between gap-2 rounded-md border border-neutral-200 bg-white px-2.5 py-2">
                                            <div className="min-w-0">
                                                <div className="truncate text-xs font-medium text-neutral-800">{row.title}</div>
                                                <div className="text-[11px] text-neutral-500">
                                                    {row.carefulPlanId
                                                        ? `${row.carefulItemCount ?? 0} focused region${row.carefulItemCount === 1 ? '' : 's'} ready`
                                                        : 'No focused region was identified automatically'}
                                                </div>
                                            </div>
                                            {row.carefulPlanId && onOpenCareful && (
                                                <button
                                                    type="button"
                                                    onClick={() => onOpenCareful(row.carefulPlanId!)}
                                                    className="min-h-11 shrink-0 rounded-lg border border-indigo-200 bg-indigo-50 px-3 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
                                                >
                                                    Review regions
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="mt-2 text-[11px] text-neutral-500">No affected output has a focused region plan.</p>
                            )}
                            {unsupportedCarefulRows.length > 0 && (
                                <p className="mt-2 rounded-md border border-neutral-200 bg-white px-2.5 py-2 text-[11px] leading-relaxed text-neutral-600">
                                    Region-by-region Careful sync is not available for{' '}
                                    <strong>{unsupportedCarefulRows.map(row => row.title).join(' or ')}</strong>.
                                    Use Quick sync, mark current after review, or decide later.
                                </p>
                            )}
                        </div>
                    </details>
                    {skipStaleCount > 0 && (
                        <p className="flex items-start gap-1.5 text-[11px] text-amber-700 leading-relaxed">
                            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                            {skipStaleCount} output{skipStaleCount === 1 ? '' : 's'} will stay flagged as
                            possibly outdated — you can update them later from the Project Map.
                        </p>
                    )}
                    {deferredRows.length > 0 && (
                        <p className="flex items-start gap-1.5 text-[11px] text-amber-700 leading-relaxed" role="status">
                            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                            <span>
                                <strong>{deferredRows.map(row => row.title).join(', ')}</strong>{' '}
                                cannot be marked current while an upstream is regenerated or
                                remains unresolved.{' '}
                                {deferredRows.some(row => deferredRegeneration.has(row.id))
                                    ? 'Required inputs will be regenerated; other choices will stay flagged.'
                                    : 'Those outputs will stay flagged.'}
                            </span>
                        </p>
                    )}
                    <p className="text-[11px] text-neutral-500 leading-relaxed">
                        Quick regeneration runs in dependency order; a troubled input of a selected
                        output is included automatically so nothing rebuilds from stale context.
                    </p>
                    {quickDisabled && (
                        <p className="text-[11px] font-medium text-amber-700">
                            Another output-generation job is active. Quick sync will be available when it finishes.
                        </p>
                    )}
                    {!quickDisabled && updateCount > 0 && regenerationDisabledReason && (
                        <p className="text-[11px] font-medium text-amber-700">{regenerationDisabledReason}</p>
                    )}
                    <div className="flex items-center justify-end gap-2">
                        <button
                            type="button"
                            onClick={onCancel}
                            className="min-h-11 rounded-md px-3 text-sm text-neutral-700 transition hover:bg-neutral-100"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            disabled={confirmDisabled}
                            onClick={() => onConfirm(choices)}
                            className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-indigo-600 px-3 text-sm text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {updateCount > 0 ? <RefreshCcw size={13} /> : <ShieldCheck size={13} />}
                            {confirmLabel}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
