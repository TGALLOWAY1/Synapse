import { useState } from 'react';
import { useProjectStore } from '../store/projectStore';
import { consolidateBranch, type ConsolidationResult, type ConsolidationScope } from '../lib/llmProvider';
import { X, ArrowRight, Check, RefreshCcw } from 'lucide-react';
import type { Branch } from '../types';

interface ConsolidationModalProps {
    projectId: string;
    spineVersionId: string;
    branch: Branch;
    spineText: string;
    onClose: () => void;
}

export function ConsolidationModal({ projectId, spineVersionId, branch, spineText, onClose }: ConsolidationModalProps) {
    const { mergeBranch } = useProjectStore();
    const [isConsolidating, setIsConsolidating] = useState(false);
    const [result, setResult] = useState<ConsolidationResult | null>(null);
    const [selectedScope, setSelectedScope] = useState<ConsolidationScope>('local');
    const [isCommitting, setIsCommitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleGenerate = async () => {
        setIsConsolidating(true);
        setError(null);
        try {
            const res = await consolidateBranch(spineText, branch, selectedScope);
            setResult(res);
        } catch (err: any) {
            setError(err.message || 'Failed to generate patch. Please check your API key and connection.');
        } finally {
            setIsConsolidating(false);
        }
    };

    const handleCommit = async () => {
        if (!result) return;
        setIsCommitting(true);
        setError(null);
        try {
            let finalSpineText = spineText;
            if (selectedScope === 'doc-wide' && result.docWidePatch) {
                finalSpineText = result.docWidePatch;
            } else if (selectedScope === 'local' && result.localPatch) {
                // Precise replacement
                const newText = spineText.replace(branch.anchorText, result.localPatch);

                if (newText === spineText) {
                    // Mismatch warning
                    setError("Could not locate the exact anchor text in the document. This can happen if the text contains markdown formatting. Try a Doc-Wide Rewrite instead.");
                    setIsCommitting(false);
                    return;
                }
                finalSpineText = newText;
            }

            if (finalSpineText === spineText && selectedScope === 'doc-wide') {
                setError("The generated document is identical to the current one. No changes were applied.");
                setIsCommitting(false);
                return;
            }

            mergeBranch(projectId, branch.id, finalSpineText);
            onClose();
        } finally {
            setIsCommitting(false);
        }
    };

    const hasActivePatch = (selectedScope === 'local' && result?.localPatch) || (selectedScope === 'doc-wide' && result?.docWidePatch);

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex justify-center items-center overflow-y-auto p-8">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl flex flex-col max-h-[90vh]">

                {/* Header */}
                <div className="p-4 border-b border-neutral-200 flex justify-between items-center bg-neutral-50 rounded-t-xl">
                    <div>
                        <h2 className="text-lg font-semibold text-neutral-800">Consolidate Branch</h2>
                        <p className="text-sm text-neutral-500">Anchor: <span className="italic">"{branch.anchorText}"</span></p>
                    </div>
                    <button onClick={onClose} className="p-2 text-neutral-400 hover:text-neutral-700 hover:bg-neutral-200 rounded-full transition">
                        <X size={20} />
                    </button>
                </div>

                {/* Error Banner */}
                {error && (
                    <div className="mx-4 mt-4 p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-600 flex items-center gap-2">
                        <span className="font-bold">Error:</span> {error}
                    </div>
                )}

                {/* Body */}
                <div className="flex-1 overflow-hidden flex flex-col">
                    {!hasActivePatch ? (
                        <div className="p-12 flex flex-col items-center justify-center text-center h-[450px]">
                            <div className="bg-blue-50 p-4 rounded-full mb-6">
                                <RefreshCcw size={32} className={`text-blue-500 ${isConsolidating ? 'animate-spin' : ''}`} />
                            </div>
                            <h3 className="text-xl font-medium text-neutral-800 mb-2">
                                {isConsolidating ? 'Synthesizing Patch...' : 'Select Consolidation Scope'}
                            </h3>
                            <p className="text-neutral-500 max-w-md mb-8">
                                {isConsolidating
                                    ? `Generating a ${selectedScope === 'local' ? 'localized edit' : 'document-wide rewrite'} based on the branch discussion.`
                                    : 'Choose how you want to merge this branch\'s intent into the main spine.'}
                            </p>

                            {!isConsolidating && (
                                <>
                                    <div className="flex gap-4 mb-8 w-full max-w-lg">
                                        <button
                                            onClick={() => { setSelectedScope('local'); setError(null); }}
                                            className={`flex-1 p-4 rounded-xl border-2 text-left transition ${selectedScope === 'local' ? 'border-blue-500 bg-blue-50' : 'border-neutral-200 hover:border-neutral-300'}`}
                                        >
                                            <div className="font-semibold text-neutral-800 mb-1">Local Patch</div>
                                            <div className="text-xs text-neutral-500">Replace only the selected anchor text. Safe and predictable.</div>
                                        </button>
                                        <button
                                            onClick={() => { setSelectedScope('doc-wide'); setError(null); }}
                                            className={`flex-1 p-4 rounded-xl border-2 text-left transition ${selectedScope === 'doc-wide' ? 'border-blue-500 bg-blue-50' : 'border-neutral-200 hover:border-neutral-300'}`}
                                        >
                                            <div className="font-semibold text-neutral-800 mb-1">Doc-Wide Rewrite</div>
                                            <div className="text-xs text-neutral-500">Rewrite the entire PRD to incorporate the intent contextually.</div>
                                        </button>
                                    </div>
                                    <button
                                        onClick={handleGenerate}
                                        className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-lg font-medium shadow-sm transition flex items-center gap-2"
                                    >
                                        Generate {selectedScope === 'local' ? 'Local' : 'Global'} Patch <ArrowRight size={18} />
                                    </button>
                                </>
                            )}
                        </div>
                    ) : (
                        <div className="flex flex-1 overflow-hidden h-full">
                            {/* Left Column: Output Preview */}
                            <div className="flex-1 border-r border-neutral-200 flex flex-col overflow-hidden">
                                <div className="p-3 bg-neutral-100 border-b border-neutral-200 flex items-center justify-between">
                                    <span className="text-sm font-semibold text-neutral-700 uppercase tracking-wider pl-2">
                                        {selectedScope === 'local' ? 'Local Scope Preview' : 'Doc-Wide Scope Preview'}
                                    </span>
                                    <button
                                        onClick={() => { setResult(null); setError(null); }}
                                        className="text-xs text-blue-600 hover:underline font-medium pr-2"
                                    >
                                        Change Scope
                                    </button>
                                </div>
                                <div className="flex-1 p-6 overflow-y-auto bg-neutral-50 text-neutral-800 font-mono text-sm whitespace-pre-wrap">
                                    {selectedScope === 'local' ? result.localPatch : result.docWidePatch}
                                </div>
                            </div>

                            {/* Right Column: Decisions */}
                            <div className="w-80 p-6 bg-white flex flex-col gap-6 overflow-y-auto">
                                <div>
                                    <h3 className="font-semibold text-neutral-800 mb-2">Patch Analysis</h3>
                                    <div className="text-sm text-neutral-600 p-3 bg-neutral-50 border border-neutral-200 rounded-lg">
                                        {selectedScope === 'local'
                                            ? 'Replaces the specific anchor text with the rewritten block shown. Safe, localized change.'
                                            : 'This is a document-wide rewrite. The entire PRD will be replaced with the content shown on the left.'}
                                    </div>
                                </div>

                                <div className="mt-auto pt-6 border-t border-neutral-100">
                                    <button
                                        onClick={handleCommit}
                                        disabled={isCommitting}
                                        className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg font-medium shadow-sm transition flex justify-center items-center gap-2 disabled:opacity-50"
                                    >
                                        {isCommitting ? 'Committing...' : 'Commit to New Spine'}
                                        {!isCommitting && <Check size={18} />}
                                    </button>
                                    <p className="text-xs text-neutral-400 text-center mt-3">
                                        This will close the branch and spawn Spine version v{Number(spineVersionId.replace('v', '')) + 1}.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
