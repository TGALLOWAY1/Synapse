import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Mark from 'mark.js';
import { useProjectStore } from '../store/projectStore';
import { replyInBranch } from '../lib/llmProvider';

interface SelectableSpineProps {
    projectId: string;
    spineVersionId: string;
    text: string;
    readOnly?: boolean;
}

export function SelectableSpine({ projectId, spineVersionId, text, readOnly }: SelectableSpineProps) {
    const [selection, setSelection] = useState<{ text: string; top: number; left: number } | null>(null);
    const [intent, setIntent] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const spineRef = useRef<HTMLDivElement>(null);
    const { createBranch, addBranchMessage, branches } = useProjectStore();

    // Get active branches for this spine to highlight their anchors
    const activeBranches = (branches[projectId] || []).filter(b => b.spineVersionId === spineVersionId && b.status === 'active');

    useEffect(() => {
        if (!spineRef.current) return;

        // Use mark.js to highlight actual rendered text, 
        // bypassing ReactMarkdown AST and matching across HTML tags
        const instance = new Mark(spineRef.current);
        instance.unmark();

        activeBranches.forEach(b => {
            if (!b.anchorText) return;
            instance.mark(b.anchorText, {
                className: '!bg-blue-500/20 !text-inherit !border-l-2 !border-blue-500 !p-0.5 !rounded',
                accuracy: 'partially',
                separateWordSearch: false,
                diacritics: false,
                acrossElements: true
            });
        });

        // Cleanup on unmount or updates
        return () => instance.unmark();
    }, [text, activeBranches]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && selection) {
                setSelection(null);
                setIntent('');
                window.getSelection()?.removeAllRanges();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selection]);

    const getIntentHelper = (intentStr: string) => {
        if (!intentStr) return null;
        const lowerMsg = intentStr.toLowerCase();
        let helper = '';

        if (lowerMsg.startsWith('clarify')) {
            helper = 'Ask for precision, fix ambiguity, or correct a specific detail tied to this text.';
        } else if (lowerMsg.startsWith('expand')) {
            helper = 'Add depth or options. Generate UX ideas, NB3 prompts, or elaborations.';
        } else if (lowerMsg.startsWith('specify')) {
            helper = 'Turn this into implementable requirements: constraints, acceptance criteria, data/API details.';
        } else if (lowerMsg.startsWith('alternative')) {
            helper = 'Propose a different approach or architecture and explain tradeoffs.';
        } else if (lowerMsg.startsWith('replace')) {
            helper = 'Suggest a concrete change. The system will apply locally or across the document during consolidation.';
        }

        if (!helper) return null;

        return (
            <div className="text-xs text-neutral-400 italic leading-snug bg-neutral-800/50 p-2 rounded border border-neutral-700/50 mb-2">
                {helper}
            </div>
        );
    };

    const handleMouseUp = () => {
        if (readOnly) return;
        // Small delay to allow double-click selections to resolve
        setTimeout(() => {
            const sel = window.getSelection();
            if (sel && sel.toString().trim().length > 0 && sel.rangeCount > 0) {
                const range = sel.getRangeAt(0);
                const rect = range.getBoundingClientRect();

                // Clamp popover to viewport bounds (320px = w-80 popover width)
                const popoverWidth = 320;
                const popoverHeight = 220;
                const rawLeft = rect.left + (rect.width / 2);
                const rawTop = rect.bottom + 8;

                const clampedLeft = Math.max(popoverWidth / 2 + 8, Math.min(rawLeft, window.innerWidth - popoverWidth / 2 - 8));
                const clampedTop = rawTop + popoverHeight > window.innerHeight
                    ? rect.top - popoverHeight - 8  // Flip above if overflowing bottom
                    : rawTop;

                setSelection({
                    text: sel.toString().trim(),
                    top: Math.max(8, clampedTop),
                    left: clampedLeft,
                });
            } else if (!isSubmitting) { // Don't hide if interacting with the form
                setSelection(null);
            }
        }, 10);
    };

    const handleCreateBranch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selection || !intent.trim() || isSubmitting) return;

        try {
            setIsSubmitting(true);
            const anchorText = selection.text;
            const userIntent = intent.trim();

            const { branchId } = createBranch(projectId, spineVersionId, anchorText, userIntent);

            // Clear selection UI immediately
            setSelection(null);
            setIntent('');
            window.getSelection()?.removeAllRanges();

            // Mock LLM Response
            const response = await replyInBranch({ anchorText, intent: userIntent, threadHistory: [] });
            addBranchMessage(projectId, branchId, 'assistant', response);

        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="relative" onMouseUp={handleMouseUp}>
            <div
                ref={spineRef}
                className="
                    prose prose-neutral max-w-none 
                    prose-h1:text-3xl prose-h1:font-extrabold prose-h1:mb-8 prose-h1:mt-2
                    prose-h2:text-2xl prose-h2:font-bold prose-h2:mt-10 prose-h2:mb-4
                    prose-h3:text-xl prose-h3:font-semibold prose-h3:mt-8 prose-h3:mb-3
                    prose-p:leading-relaxed prose-p:mb-6
                    prose-ul:list-disc prose-ul:pl-6 prose-ul:mb-6
                    prose-ol:list-decimal prose-ol:pl-6 prose-ol:mb-6
                    prose-li:mb-2
                    prose-strong:font-bold
                    prose-a:text-blue-600 hover:prose-a:text-blue-500
                    prose-code:text-pink-600 prose-code:bg-neutral-100 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded
                "
            >
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {text}
                </ReactMarkdown>
            </div>

            {selection && (
                <div
                    onMouseUp={(e) => e.stopPropagation()}
                    className="fixed z-50 bg-neutral-900 border border-neutral-700 shadow-xl rounded-lg p-3 w-80 -translate-x-1/2 flex flex-col gap-3"
                    style={{ top: selection.top, left: selection.left }}
                >
                    <div className="text-xs text-neutral-400">
                        <span className="font-semibold text-neutral-300">Anchor:</span> "{selection.text.length > 50 ? selection.text.substring(0, 50) + '...' : selection.text}"
                    </div>

                    <div className="flex flex-wrap gap-1.5 mt-1 mb-2">
                        {['Clarify', 'Expand', 'Specify', 'Alternative', 'Replace'].map(tag => (
                            <button
                                key={tag}
                                type="button"
                                onClick={() => setIntent(tag + ": ")}
                                className="text-xs px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded border border-neutral-700 transition"
                            >
                                {tag}
                            </button>
                        ))}
                    </div>

                    {getIntentHelper(intent)}

                    <form onSubmit={handleCreateBranch} className="flex gap-2">
                        <input
                            autoFocus
                            type="text"
                            value={intent}
                            onChange={e => setIntent(e.target.value)}
                            placeholder="How should this change?"
                            className="flex-1 bg-neutral-800 border border-neutral-700 text-sm text-neutral-100 rounded px-2 py-1.5 outline-none focus:border-blue-500 transition"
                            disabled={isSubmitting}
                        />
                        <button
                            type="submit"
                            disabled={isSubmitting || !intent.trim()}
                            className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-3 py-1.5 rounded transition disabled:opacity-50"
                        >
                            {isSubmitting ? '...' : 'Branch'}
                        </button>
                    </form>
                </div>
            )}
        </div>
    );
}
