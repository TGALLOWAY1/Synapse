import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
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
    const { createBranch, addBranchMessage } = useProjectStore();

    const handleMouseUp = () => {
        if (readOnly) return;
        // Small delay to allow double-click selections to resolve
        setTimeout(() => {
            const sel = window.getSelection();
            if (sel && sel.toString().trim().length > 0 && sel.rangeCount > 0) {
                const range = sel.getRangeAt(0);
                const rect = range.getBoundingClientRect();

                // Ensure we only show the popover if the selection is within this element
                setSelection({
                    text: sel.toString().trim(),
                    top: rect.bottom + 8, // Offset slightly below the text
                    left: rect.left + (rect.width / 2), // Center under selection
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
            <div className="
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
            ">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {text}
                </ReactMarkdown>
            </div>

            {selection && (
                <div
                    className="fixed z-50 bg-neutral-900 border border-neutral-700 shadow-xl rounded-lg p-3 w-80 -translate-x-1/2 flex flex-col gap-3"
                    style={{ top: selection.top, left: selection.left }}
                >
                    <div className="text-xs text-neutral-400">
                        <span className="font-semibold text-neutral-300">Anchor:</span> "{selection.text.length > 50 ? selection.text.substring(0, 50) + '...' : selection.text}"
                    </div>

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
