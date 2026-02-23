import { useProjectStore } from '../store/projectStore';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { replyInBranch } from '../lib/llmProvider';
import { Send, Maximize2, Trash2 } from 'lucide-react';
import type { Branch, BranchMessage } from '../types';

interface BranchListProps {
    projectId: string;
    spineVersionId: string;
    onConsolidate: (branch: Branch) => void;
}

export function BranchList({ projectId, spineVersionId, onConsolidate }: BranchListProps) {
    const navigate = useNavigate();
    const { getBranchesForSpine, addBranchMessage, deleteBranch } = useProjectStore();
    const branches = getBranchesForSpine(projectId, spineVersionId);
    const [replyInputs, setReplyInputs] = useState<Record<string, string>>({});
    const [isReplying, setIsReplying] = useState<Record<string, boolean>>({});

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

            // Assistant response mock
            const response = await replyInBranch({
                anchorText: branch.anchorText,
                intent: replyText.trim(),
                threadHistory: branch.messages
            });
            addBranchMessage(projectId, branch.id, 'assistant', response);

        } finally {
            setIsReplying(prev => ({ ...prev, [branch.id]: false }));
        }
    };

    const getIntentHelper = (firstMessage?: string) => {
        if (!firstMessage) return null;
        const lowerMsg = firstMessage.toLowerCase();
        let intent = '';
        let helper = '';

        if (lowerMsg.startsWith('clarify')) {
            intent = 'Clarify';
            helper = 'Ask for precision, fix ambiguity, or correct a specific detail tied to this text.';
        } else if (lowerMsg.startsWith('expand')) {
            intent = 'Expand';
            helper = 'Add depth or options. Generate UX ideas, NB3 prompts, or elaborations.';
        } else if (lowerMsg.startsWith('specify')) {
            intent = 'Specify';
            helper = 'Turn this into implementable requirements: constraints, acceptance criteria, data/API details.';
        } else if (lowerMsg.startsWith('alternative')) {
            intent = 'Alternative';
            helper = 'Propose a different approach or architecture and explain tradeoffs.';
        } else if (lowerMsg.startsWith('replace')) {
            intent = 'Replace';
            helper = 'Suggest a concrete change. The system will apply locally or across the document during consolidation.';
        }

        if (!intent) return null;

        return (
            <div className="mt-2 text-xs">
                <span className="font-semibold text-neutral-500 uppercase tracking-wider">Intent: {intent}</span>
                <p className="text-neutral-400 italic mt-0.5 leading-snug">{helper}</p>
            </div>
        );
    };

    return (
        <div className="flex flex-col gap-6">
            {branches.slice().reverse().map(branch => (
                <div key={branch.id} className="bg-white border border-neutral-200 shadow-sm rounded-lg overflow-hidden flex flex-col">
                    {/* Header */}
                    <div className="bg-neutral-50 border-b border-neutral-200 p-3 flex justify-between items-start">
                        <div className="flex-1 pr-4">
                            <div className="truncate">
                                <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Anchor</span>
                                <p className="text-sm text-neutral-700 truncate italic">"{branch.anchorText}"</p>
                            </div>
                            {getIntentHelper(branch.messages[0]?.content)}
                        </div>
                        <div className="flex flex-col items-end gap-2">
                            <div className={`text-xs px-2 py-1 rounded-full border ${branch.status === 'active' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-neutral-100 border-neutral-200 text-neutral-500'}`}>
                                {branch.status}
                            </div>
                            {branch.status === 'active' && (
                                <>
                                    <button
                                        onClick={() => navigate(`/p/${projectId}/branch/${branch.id}`)}
                                        className="p-1.5 text-neutral-400 hover:text-blue-500 hover:bg-blue-50 rounded transition"
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
                                    <button
                                        onClick={() => onConsolidate(branch)}
                                        className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded transition"
                                    >
                                        Consolidate
                                    </button>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Messages */}
                    <div className="p-3 flex flex-col gap-3 max-h-96 overflow-y-auto bg-neutral-50/50">
                        {branch.messages.map((msg: BranchMessage) => (
                            <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                                <div className={`max-w-[85%] rounded-lg p-2.5 text-sm ${msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-white border border-neutral-200 text-neutral-800'}`}>
                                    <p className="whitespace-pre-wrap">{msg.content}</p>
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
                    {branch.status === 'active' && (
                        <form onSubmit={(e) => handleReply(e, branch)} className="p-2 border-t border-neutral-200 bg-white flex gap-2">
                            <input
                                type="text"
                                value={replyInputs[branch.id] || ''}
                                onChange={e => setReplyInputs(prev => ({ ...prev, [branch.id]: e.target.value }))}
                                placeholder="Reply..."
                                className="flex-1 bg-neutral-100 border-transparent focus:bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm rounded-md px-3 py-1.5 outline-none transition"
                                disabled={isReplying[branch.id]}
                            />
                            <button
                                type="submit"
                                disabled={!replyInputs[branch.id]?.trim() || isReplying[branch.id]}
                                className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-md transition disabled:opacity-50"
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
