const OLLAMA_BASE_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'llama3'; // Default model for PRD generation and branch chats

export interface ProviderOptions {
    onStatus?: (status: string) => void;
}

export const generatePRD = async (promptText: string, options?: ProviderOptions): Promise<string> => {
    options?.onStatus?.("Generating PRD with Ollama...");

    try {
        const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: DEFAULT_MODEL,
                prompt: `You are an expert product manager. Write a comprehensive Product Requirements Document (PRD) based on the following user prompt. Use Markdown formatting. Include sections for Overview, Goals, Scope, and Technical Approach.\n\nUser Prompt: ${promptText}`,
                stream: false
            })
        });

        if (!response.ok) {
            throw new Error(`Ollama API error: ${response.statusText}`);
        }

        const data = await response.json();
        return data.response;
    } catch (e) {
        console.error("LLM Generation Error:", e);
        throw new Error(`Failed to connect to Ollama. Please ensure Ollama is installed and running locally with the '${DEFAULT_MODEL}' model (e.g., run 'ollama run ${DEFAULT_MODEL}').`);
    }
};

export interface ConsolidationResult {
    localPatch: string;
    docWidePatch: string;
}

export const consolidateBranch = async (
    spineText: string,
    branch: { anchorText: string }
): Promise<ConsolidationResult> => {
    const localPrompt = `You are a helpful assistant. You need to rewrite a specific excerpt from a PRD based on a thread of feedback. Only provide the rewritten excerpt, nothing else.
    
Original Excerpt: "${branch.anchorText}"
Feedback Context: The user wants to consolidate the changes discussed in the branch.

Please provide ONLY the rewritten excerpt.`;

    const docPrompt = `You are a helpful assistant. Please rewrite the entire PRD document to incorporate the following change requested for the excerpt "${branch.anchorText}".

Make sure the entire document reflects this change coherently. Provide ONLY the new Markdown document without any introductory or concluding text.

Original Document:
${spineText}`;

    try {
        const [localRes, docRes] = await Promise.all([
            fetch(`${OLLAMA_BASE_URL}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: DEFAULT_MODEL, prompt: localPrompt, stream: false })
            }),
            fetch(`${OLLAMA_BASE_URL}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: DEFAULT_MODEL, prompt: docPrompt, stream: false })
            })
        ]);

        if (!localRes.ok || !docRes.ok) {
            throw new Error('Failed to generate patches from Ollama.');
        }

        const localData = await localRes.json();
        const docData = await docRes.json();

        return {
            localPatch: localData.response.trim(),
            docWidePatch: docData.response.trim()
        };
    } catch (e) {
        console.error(e);
        return {
            localPatch: `[Error generating local patch via Ollama. Is it running?]`,
            docWidePatch: spineText
        };
    }
};

export const replyInBranch = async (
    context: { anchorText: string, intent: string, threadHistory: { role: string; content: string }[] }
): Promise<string> => {
    try {
        const messages = [
            { role: 'system', content: `You are a product management assistant helping a user refine a PRD. The user has selected the text: "${context.anchorText}". Please respond to their intent concisely. If they ask for a change, provide a "Suggested replacement for selected text:" block.` }
        ];

        if (context.threadHistory && context.threadHistory.length > 0) {
            messages.push(...context.threadHistory.map(msg => ({
                role: msg.role === 'user' ? 'user' : 'assistant',
                content: msg.content
            })));
        }

        messages.push({ role: 'user', content: context.intent });

        const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: DEFAULT_MODEL,
                messages: messages,
                stream: false
            })
        });

        if (!response.ok) {
            throw new Error(`Ollama API error: ${response.statusText}`);
        }

        const data = await response.json();
        return data.message.content;
    } catch (e) {
        console.error(e);
        return `Error: Could not connect to Ollama. Please ensure it is installed and running with '${DEFAULT_MODEL}'.`;
    }
};
