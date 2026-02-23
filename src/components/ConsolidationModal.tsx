import { useState } from 'react';
import { useProjectStore } from '../store/projectStore';
import { consolidateBranch, type ConsolidationResult } from '../lib/llmProvider';
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
    const [selectedPatch, setSelectedPatch] = useState<'local' | 'doc-wide'>('local');
    const [isCommitting, setIsCommitting] = useState(false);

    const handleGenerate = async () => {
        setIsConsolidating(true);
        try {
            const res = await consolidateBranch(spineText, branch);
            setResult(res);
            setSelectedPatch('local'); // Default
        } finally {
            setIsConsolidating(false);
        }
    };

    const handleCommit = async () => {
        if (!result) return;
        setIsCommitting(true);
        try {
            // For S4 MVP, local patch just appends to the old text (mock behavior).
            // docWidePatch is a full text replacement.
            let finalSpineText = spineText;
            if (selectedPatch === 'doc-wide') {
                finalSpineText = result.docWidePatch;
            } else {
                finalSpineText = spineText.replace(branch.anchorText, result.localPatch);
            }

            mergeBranch(projectId, branch.id, finalSpineText);
            onClose();
        } finally {
            setIsCommitting(false);
        }
    };

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

                {/* Body */}
                <div className="flex-1 overflow-hidden flex flex-col">
                    {!result ? (
                        <div className="p-12 flex flex-col items-center justify-center text-center h-[400px]">
                            <div className="bg-blue-50 p-4 rounded-full mb-6">
                                <RefreshCcw size={32} className={`text-blue-500 ${isConsolidating ? 'animate-spin' : ''}`} />
                            </div>
                            <h3 className="text-xl font-medium text-neutral-800 mb-2">
                                {isConsolidating ? 'Synthesizing Patches...' : 'Ready to Consolidate'}
                            </h3>
                            <p className="text-neutral-500 max-w-md mb-8">
                                {isConsolidating
                                    ? 'Our AI is generating both a localized edit and a document-wide rewrite based on the branch discussion.'
                                    : 'Generate patches to safely merge this branch\'s intent into the main spine.'}
                            </p>
                            {!isConsolidating && (
                                <button
                                    onClick={handleGenerate}
                                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg font-medium shadow-sm transition flex items-center gap-2"
                                >
                                    Generate Patches <ArrowRight size={18} />
                                </button>
                            )}
                        </div>
                    ) : (
                        <div className="flex flex-1 overflow-hidden h-full">
                            {/* Left Column: Output Preview */}
                            <div className="flex-1 border-r border-neutral-200 flex flex-col overflow-hidden">
                                <div className="p-3 bg-neutral-100 border-b border-neutral-200 flex gap-2">
                                    <button
                                        onClick={() => setSelectedPatch('local')}
                                        className={`flex-1 py-2 text-sm font-medium rounded-md transition ${selectedPatch === 'local' ? 'bg-white shadow-sm border border-neutral-200 text-neutral-800' : 'text-neutral-500 hover:bg-neutral-200'}`}
                                    >
                                        Local Scope Patch
                                    </button>
                                    <button
                                        onClick={() => setSelectedPatch('doc-wide')}
                                        className={`flex-1 py-2 text-sm font-medium rounded-md transition ${selectedPatch === 'doc-wide' ? 'bg-white shadow-sm border border-neutral-200 text-neutral-800' : 'text-neutral-500 hover:bg-neutral-200'}`}
                                    >
                                        Doc-Wide Scope Patch
                                    </button>
                                </div>
                                <div className="flex-1 p-6 overflow-y-auto bg-neutral-50 text-neutral-800 font-mono text-sm whitespace-pre-wrap">
                                    {selectedPatch === 'local' ? result.localPatch : result.docWidePatch}
                                </div>
                            </div>

                            {/* Right Column: Decisions */}
                            <div className="w-80 p-6 bg-white flex flex-col gap-6 overflow-y-auto">
                                <div>
                                    <h3 className="font-semibold text-neutral-800 mb-2">Patch Analysis</h3>
                                    <div className="text-sm text-neutral-600 p-3 bg-neutral-50 border border-neutral-200 rounded-lg">
                                        {selectedPatch === 'local'
                                            ? 'Replaces the specific anchor text with a rewritten block. Safe, localized change that leaves the rest of the PRD untouched.'
                                            : 'Rewrites the entire PRD to incorporate the branch intent contextually throughout the document. May alter tone or structure.'}
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
