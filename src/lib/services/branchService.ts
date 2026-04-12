import { callGemini } from '../geminiClient';

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

    const localSystem = "You are a helpful assistant. You need to rewrite a specific excerpt from a PRD based on a thread of feedback. Only provide the rewritten excerpt, nothing else.";
    const localPrompt = `Original Excerpt: "${branch.anchorText}"\nFeedback Context: The user wants to consolidate the changes discussed in the branch.${threadContext}\n\nPlease provide ONLY the rewritten excerpt.`;

    const docSystem = "You are a helpful assistant. Please rewrite the entire PRD document to incorporate the following change requested.";
    const docPrompt = `Requested change for excerpt: "${branch.anchorText}".${threadContext}\nMake sure the entire document reflects this change coherently. Provide ONLY the new Markdown document without any introductory or concluding text.\n\nOriginal Document:\n${spineText}`;

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

export const replyInBranch = async (
    context: { anchorText: string, intent: string, threadHistory: { role: string; content: string }[] }
): Promise<string> => {
    const system = `You are a product management assistant helping a user refine a PRD. The user has selected the text: "${context.anchorText}". Please respond to their intent concisely. If they ask for a change, provide a "Suggested replacement for selected text:" block.`;

    let promptText = `Thread History:\n`;
    if (context.threadHistory && context.threadHistory.length > 0) {
        context.threadHistory.forEach(msg => {
            promptText += `${msg.role.toUpperCase()}: ${msg.content}\n\n`;
        });
    }
    promptText += `USER INTENT: ${context.intent}`;

    return await callGemini(system, promptText);
};
