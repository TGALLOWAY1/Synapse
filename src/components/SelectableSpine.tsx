import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Mark from 'mark.js';
import { useProjectStore } from '../store/projectStore';
import { replyInBranch } from '../lib/llmProvider';
import { useSelectionPopover } from '../lib/useSelectionPopover';
import { useIsMobile } from '../lib/useIsMobile';
import { SelectionActionDialog } from './SelectionActionDialog';
import { MobileSelectionToolbar } from './MobileSelectionToolbar';
import { Callout } from './prd/Callout';

interface SelectableSpineProps {
    projectId: string;
    spineVersionId: string;
    text: string;
    readOnly?: boolean;
}

export function SelectableSpine({ projectId, spineVersionId, text, readOnly }: SelectableSpineProps) {
    const [intent, setIntent] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const spineRef = useRef<HTMLDivElement>(null);
    const { createBranch, addBranchMessage, branches } = useProjectStore();

    // On mobile the selection sheet would collide with the native iOS toolbar,
    // so we gate it behind an explicit "Select text to edit" mode (see
    // MobileSelectionToolbar). Desktop is unchanged.
    const isMobile = useIsMobile();
    const [mobileSelectMode, setMobileSelectMode] = useState(false);

    // Shared, touch-aware selection pipeline (mouse + pointer + selectionchange).
    const { selection, pendingText, commit, clear } = useSelectionPopover({
        containerRef: spineRef,
        enabled: !readOnly && (!isMobile || mobileSelectMode),
        manualCommit: isMobile && mobileSelectMode,
    });

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
                className: '!bg-indigo-500/20 !text-inherit !border-l-2 !border-indigo-500 !p-0.5 !rounded',
                accuracy: 'partially',
                separateWordSearch: false,
                diacritics: false,
                acrossElements: true
            });
        });

        // Cleanup on unmount or updates
        return () => instance.unmark();
    }, [text, activeBranches]);

    const dismiss = () => {
        clear();
        setIntent('');
        setMobileSelectMode(false);
    };

    // Single branch-creation path shared by the typed-intent form (desktop) and
    // the one-tap action chips (mobile). Keeps the existing history-tracked flow:
    // createBranch → replyInBranch → addBranchMessage.
    const submitBranch = async (rawIntent: string) => {
        if (!selection || !rawIntent.trim() || isSubmitting) return;
        try {
            setIsSubmitting(true);
            const anchorText = selection.text;
            const userIntent = rawIntent.trim();

            const { branchId } = createBranch(projectId, spineVersionId, anchorText, userIntent);

            // Clear selection UI immediately
            clear();
            setIntent('');
            setMobileSelectMode(false);

            const response = await replyInBranch({ anchorText, intent: userIntent, threadHistory: [] });
            addBranchMessage(projectId, branchId, 'assistant', response);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        submitBranch(intent);
    };

    const handleQuickAction = (tag: string) => {
        submitBranch(tag + ': ');
    };

    return (
        <div className="relative">
            <div
                ref={spineRef}
                className="
                    prose prose-neutral max-w-none
                    prose-h1:text-3xl prose-h1:font-extrabold prose-h1:text-neutral-900 prose-h1:mb-8 prose-h1:mt-2
                    prose-h2:text-2xl prose-h2:font-bold prose-h2:text-neutral-900 prose-h2:mt-10 prose-h2:mb-4
                    prose-h3:text-xl prose-h3:font-bold prose-h3:text-neutral-900 prose-h3:mt-8 prose-h3:mb-3
                    prose-p:leading-relaxed prose-p:mb-6
                    prose-ul:list-disc prose-ul:pl-6 prose-ul:mb-6
                    prose-ol:list-decimal prose-ol:pl-6 prose-ol:mb-6
                    prose-li:mb-2
                    prose-strong:font-bold
                    prose-a:text-indigo-600 hover:prose-a:text-indigo-500
                    prose-code:text-pink-600 prose-code:bg-neutral-100 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded
                "
            >
                <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{ blockquote: Callout }}
                >
                    {text}
                </ReactMarkdown>
            </div>

            {selection && (
                <SelectionActionDialog
                    selection={selection}
                    intent={intent}
                    setIntent={setIntent}
                    isSubmitting={isSubmitting}
                    onSubmit={handleSubmit}
                    onQuickAction={handleQuickAction}
                    onDismiss={dismiss}
                />
            )}

            {/* Mobile-only: explicit selection mode so the iOS toolbar and the
                Synapse action sheet don't fight. Hidden while the sheet is open. */}
            {isMobile && !readOnly && !selection && (
                <MobileSelectionToolbar
                    active={mobileSelectMode}
                    hasSelection={!!pendingText}
                    pendingText={pendingText}
                    onActivate={() => setMobileSelectMode(true)}
                    onEdit={commit}
                    onCancel={() => {
                        setMobileSelectMode(false);
                        clear();
                    }}
                />
            )}
        </div>
    );
}
