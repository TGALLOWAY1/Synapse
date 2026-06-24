import { AlertTriangle, RotateCcw, X } from 'lucide-react';

// Confirmation for restoring a historical version. Restore is non-destructive:
// it always appends a NEW version and never deletes history. The PRD variant
// additionally warns which downstream artifacts will be marked possibly
// outdated (computed by the caller via getArtifactStaleness).
interface RevertConfirmModalProps {
    kind: 'prd' | 'artifact';
    sourceLabel: string;              // e.g. "Version 3" / "version 2"
    staleArtifactTitles?: string[];   // PRD only — artifacts that will go stale
    onCancel: () => void;
    onConfirm: () => void;
}

export function RevertConfirmModal({
    kind, sourceLabel, staleArtifactTitles = [], onCancel, onConfirm,
}: RevertConfirmModalProps) {
    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-end md:items-center justify-center p-0 md:p-4" onClick={onCancel}>
            <div
                className="bg-white rounded-t-2xl md:rounded-xl shadow-2xl w-full max-w-md flex flex-col"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-start justify-between p-4 md:p-5 border-b border-neutral-200">
                    <h2 className="text-base md:text-lg font-bold text-neutral-900">
                        Restore {kind === 'prd' ? 'this PRD version' : 'this version'}?
                    </h2>
                    <button
                        type="button"
                        onClick={onCancel}
                        className="p-1.5 rounded-md hover:bg-neutral-100 text-neutral-500 shrink-0"
                        aria-label="Cancel"
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className="p-4 md:p-5 space-y-4">
                    <p className="text-sm text-neutral-600">
                        {kind === 'prd' ? (
                            <>Restoring this PRD will create a new version. Existing history will not be deleted.</>
                        ) : (
                            <>This restores <span className="font-medium text-neutral-800">{sourceLabel}</span> as a new version. Existing versions are kept.</>
                        )}
                    </p>

                    {kind === 'prd' && staleArtifactTitles.length > 0 && (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                            <div className="flex items-center gap-1.5 text-amber-800 font-medium text-sm">
                                <AlertTriangle size={14} />
                                This may mark these artifacts as possibly outdated:
                            </div>
                            <ul className="mt-2 ml-1 space-y-0.5 text-sm text-amber-700 list-disc list-inside">
                                {staleArtifactTitles.map(title => (
                                    <li key={title}>{title}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>

                <div className="flex items-center justify-end gap-2 p-4 border-t border-neutral-200">
                    <button
                        type="button"
                        onClick={onCancel}
                        className="px-3.5 py-2 text-sm font-medium text-neutral-700 rounded-lg hover:bg-neutral-100 transition min-h-[44px] md:min-h-0"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition min-h-[44px] md:min-h-0"
                    >
                        <RotateCcw size={14} /> Restore as New Version
                    </button>
                </div>
            </div>
        </div>
    );
}
