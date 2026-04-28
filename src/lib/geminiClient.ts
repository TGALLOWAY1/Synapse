export interface JsonModeConfig {
    responseMimeType: string;
    responseSchema: object;
    temperature?: number;
    topP?: number;
    topK?: number;
    /**
     * Per-call model override. When set, this model is used instead of the
     * user's configured default. Lets latency-sensitive paths (e.g. mockup
     * generation) pin to a faster, higher-capacity stable model without
     * changing the global default.
     */
    model?: string;
}

export interface StreamCallbacks {
    onChunk: (text: string) => void;
    onComplete: (fullText: string) => void;
    onError: (error: Error) => void;
}

export interface ProviderOptions {
    onStatus?: (status: string) => void;
    /**
     * AbortSignal forwarded to underlying fetch calls. Lets multi-pass
     * pipelines (e.g. PRD generation) be cancelled mid-flight.
     */
    signal?: AbortSignal;
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

/**
 * Optional Google Cloud project ID. When present, we forward it as the
 * `x-goog-user-project` header so Gemini bills and meters the request against
 * that project. This is the fix for the common case where a user has enabled
 * billing on one project but their AI Studio API key is still tied to a
 * different (free-tier) project — without this header Google falls back to
 * the key's home project and applies free-tier quotas.
 */
const getProjectId = () => {
    return localStorage.getItem('GEMINI_PROJECT_ID')?.trim() || '';
};

const buildHeaders = (apiKey: string): HeadersInit => {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
    };
    const projectId = getProjectId();
    if (projectId) headers['x-goog-user-project'] = projectId;
    return headers;
};

/**
 * Turn a raw Gemini error payload into a more specific message when the
 * failure is a quota/rate-limit hit. We surface free-tier hits explicitly so
 * users know to check their billing project configuration rather than
 * assuming they just need to wait.
 */
const formatGeminiError = (status: string, errorData: unknown): string => {
    const raw = (errorData as { error?: { message?: string; status?: string } })?.error;
    const message = raw?.message || 'Unknown error';
    const isQuota = raw?.status === 'RESOURCE_EXHAUSTED' || /quota|resource.exhausted|rate.limit/i.test(message);
    if (isQuota && /free.?tier|freetier|-FreeTier/i.test(message)) {
        return (
            'Gemini quota error — your request hit the FREE-TIER quota even though you expect paid tier. ' +
            'Likely causes: (1) your API key is tied to a Google Cloud project without billing enabled — ' +
            'recreate the key in AI Studio on the project that has billing; (2) set your billing project ID ' +
            'in Settings so Synapse sends x-goog-user-project; (3) preview models (e.g. Gemini 3 Flash Preview) ' +
            'have reduced quotas even on paid tier — switch to a stable model like gemini-2.5-flash. ' +
            `Raw: ${message}`
        );
    }
    return `Gemini API Error: ${status} - ${message}`;
};

export const callGemini = async (systemInstruction: string, promptText: string, jsonMode?: JsonModeConfig, signal?: AbortSignal) => {
    const startTime = performance.now();
    const apiKey = getApiKey();
    const model = jsonMode?.model || getModel();
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
        headers: buildHeaders(apiKey),
        body: JSON.stringify(body),
        signal,
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(formatGeminiError(`${response.status} ${response.statusText}`.trim(), errorData));
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
        headers: buildHeaders(apiKey),
        body: JSON.stringify(body),
        signal,
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        const err = new Error(formatGeminiError(`${response.status} ${response.statusText}`.trim(), errorData));
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
