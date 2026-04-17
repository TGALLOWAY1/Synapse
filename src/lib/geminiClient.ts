export interface JsonModeConfig {
    responseMimeType: string;
    responseSchema: object;
    temperature?: number;
    topP?: number;
    topK?: number;
}

export interface StreamCallbacks {
    onChunk: (text: string) => void;
    onComplete: (fullText: string) => void;
    onError: (error: Error) => void;
}

export interface ProviderOptions {
    onStatus?: (status: string) => void;
}

const getApiKey = () => {
    const key = localStorage.getItem('GEMINI_API_KEY');
    if (!key) {
        throw new Error('Missing Gemini API Key. Please click the Settings gear icon in the top right to add your key.');
    }
    return key;
};

/**
 * Default model. Gemini 3 Flash (preview) replaced 2.5 Flash as the recommended
 * everyday model in early 2026 — it has more capacity headroom and better
 * quality at a similar price. See SettingsModal for the full catalog + legacy
 * migration flag.
 */
export const DEFAULT_GEMINI_MODEL = 'gemini-3-flash-preview';

const getModel = () => {
    return localStorage.getItem('GEMINI_MODEL') || DEFAULT_GEMINI_MODEL;
};

export const callGemini = async (systemInstruction: string, promptText: string, jsonMode?: JsonModeConfig, signal?: AbortSignal) => {
    const startTime = performance.now();
    const apiKey = getApiKey();
    const model = getModel();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    const body: Record<string, unknown> = {
        systemInstruction: {
            parts: [{ text: systemInstruction }]
        },
        contents: [{
            parts: [{ text: promptText }]
        }]
    };

    if (jsonMode) {
        body.generationConfig = {
            responseMimeType: jsonMode.responseMimeType,
            responseSchema: jsonMode.responseSchema,
            ...(typeof jsonMode.temperature === 'number' ? { temperature: jsonMode.temperature } : {}),
            ...(typeof jsonMode.topP === 'number' ? { topP: jsonMode.topP } : {}),
            ...(typeof jsonMode.topK === 'number' ? { topK: jsonMode.topK } : {}),
        };
    }

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(body),
        signal,
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(`Gemini API Error: ${response.statusText} - ${errorData?.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();

    // Safely extract text — Gemini may return no candidates (e.g. safety block)
    // or candidates with no content/parts.
    const candidate = data?.candidates?.[0];
    const finishReason = candidate?.finishReason;
    if (finishReason === 'SAFETY') {
        throw new Error('Gemini refused to generate content due to safety filters. Try adjusting your prompt or PRD content.');
    }
    const text: string | undefined = candidate?.content?.parts?.[0]?.text;
    if (!text) {
        const reason = finishReason ? ` (finishReason: ${finishReason})` : '';
        throw new Error(`Gemini returned an empty response${reason}. Please try again.`);
    }
    const durationMs = performance.now() - startTime;
    console.log(`[GEN] callGemini: ${durationMs.toFixed(0)}ms (${text.length} chars)`);
    return text;
};

export const callGeminiStream = async (
    systemInstruction: string,
    promptText: string,
    callbacks: StreamCallbacks,
    signal?: AbortSignal,
): Promise<string> => {
    const startTime = performance.now();
    const apiKey = getApiKey();
    const model = getModel();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`;

    const body = {
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ parts: [{ text: promptText }] }],
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(body),
        signal,
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        const err = new Error(`Gemini API Error: ${response.statusText} - ${errorData?.error?.message || 'Unknown error'}`);
        callbacks.onError(err);
        throw err;
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body for streaming');

    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const jsonStr = line.slice(6).trim();
                if (!jsonStr || jsonStr === '[DONE]') continue;

                try {
                    const chunk = JSON.parse(jsonStr);
                    const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (text) {
                        fullText += text;
                        callbacks.onChunk(text);
                    }
                } catch {
                    // Skip malformed JSON chunks
                }
            }
        }
    } catch (e) {
        if (signal?.aborted) {
            reader.cancel();
            throw new DOMException('Aborted', 'AbortError');
        }
        throw e;
    }

    const durationMs = performance.now() - startTime;
    console.log(`[GEN] callGeminiStream: ${durationMs.toFixed(0)}ms (${fullText.length} chars)`);
    callbacks.onComplete(fullText);
    return fullText;
};
