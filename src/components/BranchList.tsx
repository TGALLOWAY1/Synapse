import { useProjectStore } from '../store/projectStore';
import { useState } from 'react';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import { replyInBranch } from '../lib/llmProvider';
import { Send, Maximize2, Trash2, Layers, Undo2, Loader2 } from 'lucide-react';
import { normalizeError, userMessage } from '../lib/errors';
import { useToastStore } from '../store/toastStore';
import type { Branch, BranchMessage } from '../types';
import { IntentHelperLabel } from '../lib/intentHelper';
import { getActionFromIntent } from '../lib/prdEditActions';

interface BranchListProps {
    projectId: string;
    spineVersionId: string;
    onConsolidate: (branch: Branch) => void;
    onCanvasOpen?: (branchId: string) => void;
    /** Generate the branch's patch and stage it for batch consolidation. */
    onStage?: (branch: Branch) => Promise<void>;
    /** Open the "Review & Apply" overlay for staged edits. */
    onReviewStaged?: () => void;
    readOnly?: boolean;
}

export function BranchList({ projectId, spineVersionId, onConsolidate, onCanvasOpen, onStage, onReviewStaged, readOnly = false }: BranchListProps) {
    const [animationParent] = useAutoAnimate();
    const { getBranchesForSpine, addBranchMessage, deleteBranch, unstageBranch } = useProjectStore();
    const branches = getBranchesForSpine(projectId, spineVersionId);
    const [replyInputs, setReplyInputs] = useState<Record<string, string>>({});
    const [isReplying, setIsReplying] = useState<Record<string, boolean>>({});
    const [isStaging, setIsStaging] = useState<Record<string, boolean>>({});

    const stagedCount = branches.filter(b => b.status === 'resolved').length;

    const handleStage = async (branch: Branch) => {
        if (!onStage || isStaging[branch.id]) return;
        try {
            setIsStaging(prev => ({ ...prev, [branch.id]: true }));
            await onStage(branch);
        } catch (e) {
            const err = normalizeError(e);
            console.error('[Branch stage failed]', err.raw);
            useToastStore.getState().addToast({
                type: 'error',
                title: 'Could not stage edit',
                message: userMessage(err),
            });
        } finally {
            setIsStaging(prev => ({ ...prev, [branch.id]: false }));
        }
    };

    if (branches.length === 0) {
        return (
            <div className="text-sm text-neutral-500 italic p-4 text-center border border-dashed border-neutral-300 rounded-md">
                Highlight text in the spine to create a branch.
            </div>
        );
    }

    const handleReply = async (e: React.FormEvent, branch: Branch) => {
        e.preventDefault();
        const replyText = replyInputs[branch.id];
        if (!replyText?.trim() || isReplying[branch.id]) return;

        try {
            setIsReplying(prev => ({ ...prev, [branch.id]: true }));

            // User message
            addBranchMessage(projectId, branch.id, 'user', replyText.trim());
            setReplyInputs(prev => ({ ...prev, [branch.id]: '' }));

            // Carry the branch's originating action (from its first message's
            // `"<Label>: "` prefix) so follow-up replies keep the specialized
            // persona instead of falling back to the generic prompt.
            const response = await replyInBranch({
                anchorText: branch.anchorText,
                intent: replyText.trim(),
                threadHistory: branch.messages,
                actionId: getActionFromIntent(branch.messages[0]?.content ?? '')?.id,
            });
            addBranchMessage(projectId, branch.id, 'assistant', response);
        } catch (e) {
            const err = normalizeError(e);
            console.error('[Branch reply failed]', err.raw);
            useToastStore.getState().addToast({
                type: 'error',
                title: 'Reply failed',
                message: userMessage(err),
            });
        } finally {
            setIsReplying(prev => ({ ...prev, [branch.id]: false }));
        }
    };


    return (
        <div ref={animationParent} className="flex flex-col gap-6">
            {/* Batch-consolidation bar: apply all staged edits as one version. */}
            {stagedCount > 0 && !readOnly && (
                <div className="sticky top-0 z-10 flex items-center justify-between gap-3 rounded-lg border border-indigo-200 bg-indigo-50 p-3 shadow-sm">
                    <div className="flex items-center gap-2 text-sm text-indigo-800">
                        <Layers size={16} className="text-indigo-600" />
                        <span><span className="font-semibold">{stagedCount}</span> edit{stagedCount !== 1 ? 's' : ''} staged</span>
                    </div>
                    <button
                        onClick={() => onReviewStaged?.()}
                        className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-700"
                    >
                        Review &amp; Apply ({stagedCount})
                    </button>
                </div>
            )}
            {branches.slice().reverse().map(branch => (
                <div key={branch.id} className="bg-white border border-neutral-200 shadow-sm rounded-lg overflow-hidden flex flex-col">
                    {/* Header */}
                    <div className="bg-neutral-50 border-b border-neutral-200 p-3 flex justify-between items-start">
                        <div className="flex-1 min-w-0 pr-4">
                            <div>
                                <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wider block mb-1">Anchor</span>
                                <p className="text-sm text-neutral-700 italic break-words line-clamp-4">"{branch.anchorText}"</p>
                            </div>
                            <IntentHelperLabel text={branch.messages[0]?.content || ''} />
                        </div>
                        <div className="flex flex-col items-end gap-2 shrink-0">
                            <div className={`text-xs px-2 py-1 rounded-full border ${
                                branch.status === 'active'
                                    ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                                    : branch.status === 'resolved'
                                        ? 'bg-amber-50 border-amber-200 text-amber-700'
                                        : 'bg-neutral-100 border-neutral-200 text-neutral-500'
                            }`}>
                                {branch.status === 'resolved' ? 'staged' : branch.status}
                            </div>
                            {branch.status === 'active' && !readOnly && (
                                <div className="flex items-center gap-1 mt-1">
                                    <button
                                        onClick={() => onCanvasOpen?.(branch.id)}
                                        className="p-1.5 text-neutral-400 hover:text-indigo-500 hover:bg-indigo-50 rounded transition"
                                        title="Dive Into Canvas"
                                    >
                                        <Maximize2 size={16} />
                                    </button>
                                    <button
                                        onClick={() => {
                                            if (window.confirm("Are you sure you want to delete this branch?")) {
                                                deleteBranch(projectId, branch.id);
                                            }
                                        }}
                                        className="p-1.5 text-neutral-400 hover:text-red-500 hover:bg-red-50 rounded transition"
                                        title="Delete Branch"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Consolidate / Stage bar */}
                    {branch.status === 'active' && !readOnly && (
                        <div className="px-3 pb-3 bg-neutral-50 flex flex-col gap-2">
                            <div className="flex gap-2">
                                {onStage && (
                                    <button
                                        onClick={() => handleStage(branch)}
                                        disabled={isStaging[branch.id]}
                                        title="Generate this edit's patch and hold it to apply together with others"
                                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 border border-indigo-300 bg-white hover:bg-indigo-50 text-indigo-700 text-xs font-semibold rounded-md transition shadow-sm disabled:opacity-50"
                                    >
                                        {isStaging[branch.id]
                                            ? <><Loader2 size={13} className="animate-spin" /> Staging…</>
                                            : <><Layers size={13} /> Stage edit</>}
                                    </button>
                                )}
                                <button
                                    onClick={() => onConsolidate(branch)}
                                    className="flex-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold rounded-md transition shadow-sm"
                                >
                                    Consolidate now
                                </button>
                            </div>
                            {onStage && (
                                <p className="text-[11px] text-neutral-400 leading-snug">
                                    Stage several edits, then review and apply them together as one version.
                                </p>
                            )}
                        </div>
                    )}

                    {/* Staged: proposed replacement preview + unstage */}
                    {branch.status === 'resolved' && !readOnly && (
                        <div className="px-3 pb-3 bg-amber-50/40 flex flex-col gap-2">
                            {branch.proposedReplacement && (
                                <div className="rounded-md border border-amber-200 bg-white p-2">
                                    <span className="text-[10px] font-semibold text-amber-700 uppercase tracking-wider">Staged replacement</span>
                                    <p className="mt-1 text-xs text-neutral-700 whitespace-pre-wrap break-words line-clamp-6">{branch.proposedReplacement}</p>
                                </div>
                            )}
                            <div className="flex gap-2">
                                <button
                                    onClick={() => unstageBranch(projectId, branch.id)}
                                    className="flex items-center justify-center gap-1.5 px-3 py-1.5 border border-neutral-300 bg-white hover:bg-neutral-50 text-neutral-600 text-xs font-semibold rounded-md transition"
                                >
                                    <Undo2 size={13} /> Unstage
                                </button>
                                {onReviewStaged && (
                                    <button
                                        onClick={() => onReviewStaged()}
                                        className="flex-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-md transition shadow-sm"
                                    >
                                        Review &amp; Apply
                                    </button>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Messages */}
                    <div className="p-3 flex flex-col gap-3 max-h-96 overflow-y-auto bg-neutral-50/50">
                        {branch.messages.map((msg: BranchMessage) => (
                            <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                                <div className={`max-w-[85%] rounded-lg p-2.5 text-sm ${msg.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-white border border-neutral-200 text-neutral-800'}`}>
                                    <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                                </div>
                            </div>
                        ))}
                        {isReplying[branch.id] && (
                            <div className="flex items-start">
                                <div className="bg-white border border-neutral-200 rounded-lg p-2.5 text-sm text-neutral-500 animate-pulse">
                                    Assistant is typing...
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Input */}
                    {branch.status === 'active' && !readOnly && (
                        <form onSubmit={(e) => handleReply(e, branch)} className="p-2 border-t border-neutral-200 bg-white flex gap-2">
                            <input
                                type="text"
                                value={replyInputs[branch.id] || ''}
                                onChange={e => setReplyInputs(prev => ({ ...prev, [branch.id]: e.target.value }))}
                                placeholder="Reply..."
                                className="flex-1 bg-neutral-100 border-transparent focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-sm rounded-md px-3 py-1.5 outline-none transition"
                                disabled={isReplying[branch.id]}
                            />
                            <button
                                type="submit"
                                disabled={!replyInputs[branch.id]?.trim() || isReplying[branch.id]}
                                className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-md transition disabled:opacity-50"
                                title="Send reply"
                                aria-label="Send reply"
                            >
                                <Send size={18} />
                            </button>
                        </form>
                    )}
                </div>
            ))}
        </div>
    );
}
