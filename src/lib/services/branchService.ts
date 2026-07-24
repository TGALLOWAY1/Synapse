import { callGemini } from '../geminiClient';
import { getActionFromIntent, getPrdEditAction, type PrdEditActionId } from '../prdEditActions';

export interface ConsolidationResult {
    localPatch?: string;
    docWidePatch?: string;
}

export type ConsolidationScope = 'local' | 'doc-wide';

export const consolidateBranch = async (
    spineText: string,
    branch: { anchorText: string, messages?: { role: string, content: string }[] },
    scope?: ConsolidationScope
): Promise<ConsolidationResult> => {
    let threadContext = '';
    if (branch.messages && branch.messages.length > 0) {
        threadContext = '\n\nConversation Context:\n' + branch.messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n');
    }

    const localSystem = "You are a senior PRD editor. Rewrite the supplied excerpt to incorporate the feedback thread, using formal, professional, implementation-ready language. Make the minimal, targeted edits the feedback requires; preserve any wording not affected by the feedback. Provide ONLY the rewritten excerpt, nothing else.";
    const localPrompt = `Original Excerpt: "${branch.anchorText}"\nFeedback Context: The user wants to consolidate the changes discussed in the branch.${threadContext}\n\nProvide ONLY the rewritten excerpt.`;

    const docSystem = "You are a senior PRD editor. Rewrite the entire PRD document to incorporate the requested change, using formal, professional, implementation-ready language. Edit only what the change requires for document-wide coherence; leave all unaffected content unchanged. Provide ONLY the new Markdown document, with no introductory or concluding text.";
    const docPrompt = `Requested change for excerpt: "${branch.anchorText}".${threadContext}\nEnsure the entire document reflects this change coherently. Provide ONLY the new Markdown document without any introductory or concluding text.\n\nOriginal Document:\n${spineText}`;

    try {
        if (scope === 'local') {
            const localPatch = await callGemini(localSystem, localPrompt);
            return { localPatch: localPatch.trim() };
        } else if (scope === 'doc-wide') {
            const docWidePatch = await callGemini(docSystem, docPrompt);
            return { docWidePatch: docWidePatch.trim() };
        } else {
            // Default to both for backward compatibility or if not specified
            const [localPatch, docWidePatch] = await Promise.all([
                callGemini(localSystem, localPrompt),
                callGemini(docSystem, docPrompt)
            ]);
            return {
                localPatch: localPatch.trim(),
                docWidePatch: docWidePatch.trim()
            };
        }
    } catch (e: unknown) {
        console.error(e);
        throw e;
    }
};

/** Generic fallback prompt for free-text intents with no recognized action. */
const GENERIC_BRANCH_SYSTEM = (anchorText: string) =>
    `You are a senior product manager helping a user refine a PRD. The user has selected the text: "${anchorText}". Respond to their intent concisely and precisely, using formal, professional language and avoiding hedging. If they request a change, provide a "Suggested replacement for selected text:" block.`;

export const replyInBranch = async (
    context: {
        anchorText: string,
        intent: string,
        threadHistory: { role: string; content: string }[],
        /** Explicit action; when omitted it is derived from the intent prefix. */
        actionId?: PrdEditActionId,
    }
): Promise<string> => {
    // Prefer an explicit action id; otherwise recover it from the intent's
    // `"<Label>: "` prefix (the initial branch message carries it). A follow-up
    // reply with no prefix and no id falls back to the generic prompt.
    const action = context.actionId
        ? getPrdEditAction(context.actionId)
        : getActionFromIntent(context.intent);
    const system = action
        ? `${action.systemPrompt}\n\nThe user has selected the text: "${context.anchorText}".`
        : GENERIC_BRANCH_SYSTEM(context.anchorText);

    let promptText = `Thread History:\n`;
    if (context.threadHistory && context.threadHistory.length > 0) {
        context.threadHistory.forEach(msg => {
            promptText += `${msg.role.toUpperCase()}: ${msg.content}\n\n`;
        });
    }
    promptText += `USER INTENT: ${context.intent}`;

    return await callGemini(system, promptText);
};
