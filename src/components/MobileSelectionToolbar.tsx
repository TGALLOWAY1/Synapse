interface MobileSelectionToolbarProps {
    /** Whether selection mode is active (footer shown) or idle (entry button). */
    active: boolean;
    /** Whether a selection is currently tracked (enables "Edit selection"). */
    hasSelection: boolean;
    /** Text of the tracked selection, echoed back to the user. */
    pendingText: string | null;
    /** Enter selection mode. */
    onActivate: () => void;
    /** Commit the tracked selection → open the Synapse action sheet. */
    onEdit: () => void;
    /** Leave selection mode and drop any tracked selection. */
    onCancel: () => void;
}

/**
 * Mobile-only control that fronts the PRD highlight → branch gesture.
 *
 * The problem it solves: on iPhone, surfacing the Synapse action sheet on the
 * first selected word collides with the native iOS Copy / Look Up / Translate
 * toolbar and leaves no room to drag the selection handles out to a full
 * phrase. So on mobile the selection pipeline runs in *manual-commit* mode and
 * this toolbar drives an explicit two-step flow:
 *
 *  - **Idle** → a single pinned "Select text to edit" button. Until tapped, the
 *    PRD is plain readable text and native iOS selection is untouched.
 *  - **Active** → a persistent footer. The user adjusts the native selection
 *    freely, then taps "Edit selection" to open the existing action sheet.
 *
 * Presentation only — all state lives in the parent renderer; it mirrors the
 * dark, safe-area-inset bottom-sheet aesthetic of `SelectionActionDialog`.
 */
export function MobileSelectionToolbar({
    active,
    hasSelection,
    pendingText,
    onActivate,
    onEdit,
    onCancel,
}: MobileSelectionToolbarProps) {
    if (!active) {
        return (
            <div className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
                <button
                    type="button"
                    onClick={onActivate}
                    className="min-h-[44px] rounded-full bg-indigo-600 px-5 text-sm font-medium text-white shadow-lg transition hover:bg-indigo-700 active:bg-indigo-800"
                >
                    Select text to edit
                </button>
            </div>
        );
    }

    const preview =
        pendingText && pendingText.length > 40 ? `${pendingText.slice(0, 40)}…` : pendingText;

    return (
        <div
            role="toolbar"
            aria-label="Mobile text selection"
            className="fixed inset-x-0 bottom-0 z-40 flex flex-col gap-2 border-t border-neutral-700 bg-neutral-900 p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] shadow-2xl"
        >
            <div className="text-xs text-neutral-400">
                {preview ? (
                    <>
                        <span className="font-semibold text-neutral-300">Selected:</span> "{preview}"
                    </>
                ) : (
                    'Select text, then tap Edit selection'
                )}
            </div>
            <div className="flex gap-2">
                <button
                    type="button"
                    onClick={onCancel}
                    className="min-h-[44px] flex-1 rounded-lg border border-neutral-700 bg-neutral-800 px-3 text-sm font-medium text-neutral-200 transition hover:bg-neutral-700 active:bg-neutral-600"
                >
                    Cancel
                </button>
                <button
                    type="button"
                    onClick={onEdit}
                    disabled={!hasSelection}
                    className="min-h-[44px] flex-[2] rounded-lg bg-indigo-600 px-3 text-sm font-medium text-white transition hover:bg-indigo-700 active:bg-indigo-800 disabled:opacity-50"
                >
                    Edit selection
                </button>
            </div>
        </div>
    );
}
