import { useProjectStore } from '../store/projectStore';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { replyInBranch } from '../lib/llmProvider';
import { Send, Maximize2 } from 'lucide-react';
import type { Branch, BranchMessage } from '../types';

interface BranchListProps {
    projectId: string;
    spineVersionId: string;
    onConsolidate: (branch: Branch) => void;
}

export function BranchList({ projectId, spineVersionId, onConsolidate }: BranchListProps) {
    const navigate = useNavigate();
    const { getBranchesForSpine, addBranchMessage } = useProjectStore();
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

    return (
        <div className="flex flex-col gap-6">
            {branches.slice().reverse().map(branch => (
                <div key={branch.id} className="bg-white border border-neutral-200 shadow-sm rounded-lg overflow-hidden flex flex-col">
                    {/* Header */}
                    <div className="bg-neutral-50 border-b border-neutral-200 p-3 flex justify-between items-center">
                        <div className="flex-1 truncate pr-4">
                            <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Anchor</span>
                            <p className="text-sm text-neutral-700 truncate italic">"{branch.anchorText}"</p>
                        </div>
                        <div className="flex items-center gap-2">
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
