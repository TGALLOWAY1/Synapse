const GEMINI_MODEL = 'gemini-2.5-flash';

const getApiKey = () => {
    const key = localStorage.getItem('GEMINI_API_KEY');
    if (!key) {
        throw new Error('Missing Gemini API Key. Please click the Settings gear icon in the top right to add your key.');
    }
    return key;
};

const callGemini = async (systemInstruction: string, promptText: string) => {
    const apiKey = getApiKey();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            systemInstruction: {
                parts: [{ text: systemInstruction }]
            },
            contents: [{
                parts: [{ text: promptText }]
            }]
        })
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(`Gemini API Error: ${response.statusText} - ${errorData?.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
};

export interface ProviderOptions {
    onStatus?: (status: string) => void;
}

export const generatePRD = async (promptText: string, options?: ProviderOptions): Promise<string> => {
    options?.onStatus?.("Generating PRD with Gemini...");
    const system = "You are an expert product manager. Write a comprehensive Product Requirements Document (PRD) based on the following user prompt. Use Markdown formatting. Include sections for Overview, Goals, Scope, and Technical Approach.";
    return callGemini(system, `User Prompt: ${promptText}`);
};

export interface ConsolidationResult {
    localPatch: string;
    docWidePatch: string;
}

export const consolidateBranch = async (
    spineText: string,
    branch: { anchorText: string, messages?: { role: string, content: string }[] }
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
        const [localPatch, docWidePatch] = await Promise.all([
            callGemini(localSystem, localPrompt),
            callGemini(docSystem, docPrompt)
        ]);

        return {
            localPatch: localPatch.trim(),
            docWidePatch: docWidePatch.trim()
        };
    } catch (e: unknown) {
        console.error(e);
        const errorMsg = e instanceof Error ? e.message : String(e);
        return {
            localPatch: `[Error generating local patch: ${errorMsg}]`,
            docWidePatch: spineText
        };
    }
};

export const replyInBranch = async (
    context: { anchorText: string, intent: string, threadHistory: { role: string; content: string }[] }
): Promise<string> => {
    try {
        const system = `You are a product management assistant helping a user refine a PRD. The user has selected the text: "${context.anchorText}". Please respond to their intent concisely. If they ask for a change, provide a "Suggested replacement for selected text:" block.`;

        let promptText = `Thread History:\n`;
        if (context.threadHistory && context.threadHistory.length > 0) {
            context.threadHistory.forEach(msg => {
                promptText += `${msg.role.toUpperCase()}: ${msg.content}\n\n`;
            });
        }
        promptText += `USER INTENT: ${context.intent}`;

        return await callGemini(system, promptText);
    } catch (e: unknown) {
        console.error(e);
        const errorMsg = e instanceof Error ? e.message : String(e);
        return `Error: ${errorMsg}`;
    }
};
