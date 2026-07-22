import { getCachedGeminiKey } from './geminiKeyVault';
import { getLocalCredential, GEMINI_API_KEY } from './localCredentials';
import { beginTrace } from './trace/traceRecorder';
import type { LlmTraceMeta } from './trace/traceTypes';

export interface JsonModeConfig {
    /**
     * JSON-mode response controls. Optional so this config can also carry a
     * plain-text per-call `model` override with no schema (the artifact tier
     * routing passes `{ model }` alone). When omitted, no JSON `generationConfig`
     * is sent and the call behaves as a normal text generation.
     */
    responseMimeType?: string;
    responseSchema?: object;
    temperature?: number;
    topP?: number;
    topK?: number;
    /**
     * Cap on the number of output tokens. Without this, Gemini applies a
     * conservative default (~8K on Flash models) which is well under what a
     * rich JSON-mode PRD response needs — hitting the cap mid-response
     * truncates the JSON inside a string and causes "Unterminated string in
     * JSON" parse failures. Pin this to the model's full headroom for
     * structured-output paths.
     */
    maxOutputTokens?: number;
    /**
     * Per-call model override. When set, this model is used instead of the
     * user's configured default. Lets latency-sensitive paths (e.g. mockup
     * generation) pin to a faster, higher-capacity stable model without
     * changing the global default.
     */
    model?: string;
    /**
     * Optional usage sink. When provided, it is invoked once with the token
     * counts reported by Gemini's `usageMetadata` after a successful response.
     * Purely observational (powers the orchestration Metrics dashboard) — the
     * call still resolves to the response text, so no existing caller breaks.
     */
    onUsage?: (usage: GeminiTokenUsage) => void;
    /**
     * Optional finish sink. Invoked once with the `finishReason` Gemini
     * reported for the response (e.g. 'STOP', 'MAX_TOKENS'). Lets callers
     * detect truncation — a MAX_TOKENS finish returns the partial body as
     * "success" at the transport level, so any JSON-mode caller that must not
     * silently accept a truncated payload should inspect this. (Streaming
     * callers get the same signal via `StreamCallbacks.onFinish`.)
     */
    onFinish?: (info: { finishReason?: string }) => void;
    /**
     * Optional developer-only trace enrichment (LLM Trace Viewer). Purely
     * observational — attaches human labels (purpose/stage/artifact/inputs) to
     * the trace captured at the geminiClient chokepoint. No effect on the
     * request or response; ignored entirely unless trace capture is enabled.
     */
    traceMeta?: LlmTraceMeta;
}

/** Token counts extracted from a Gemini response's `usageMetadata`. */
export interface GeminiTokenUsage {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
}

export interface StreamCallbacks {
    onChunk: (text: string) => void;
    onComplete: (fullText: string) => void;
    onError: (error: Error) => void;
    /**
     * Fired when the stream is re-attempted after a transient network drop.
     * Callers that accumulate chunk-derived state (e.g. char counters, phase
     * trackers) should reset it here — the next chunks belong to a fresh
     * stream from byte zero.
     */
    onRestart?: () => void;
    /**
     * Fired once the stream has finished, with the final `finishReason`
     * reported by Gemini (e.g. 'STOP', 'MAX_TOKENS', 'SAFETY'). Lets callers
     * distinguish a clean completion from a truncated one — important for
     * JSON-mode where MAX_TOKENS leaves the response unparseable.
     */
    onFinish?: (info: { finishReason?: string }) => void;
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
    // Prefer the user's vault key (fetched into memory at call time, never
    // persisted client-side); fall back to a local key for dev/offline use.
    const key = getCachedGeminiKey() || getLocalCredential(GEMINI_API_KEY);
    if (!key) {
        throw new Error('Add a Gemini API key in Settings to generate PRDs.');
    }
    return key;
};

/**
 * Default model. Gemini 3.5 Flash (GA, announced at I/O May 2026) is the
 * recommended everyday Flash model — it replaced the earlier Gemini 3 Flash
 * preview, shipping as GA with full (non-preview) quotas and frontier-class
 * quality at a similar price. See SettingsModal for the full catalog and
 * `modelMigration.ts` for the one-shot upgrade of older Flash selections.
 */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash';

/**
 * Per-tier defaults. These MUST match the tier defaults advertised in the
 * Settings model pickers (`SettingsModal`/`ArtifactModelsSection`) — the Fast
 * tier defaults to Flash, the Expert (strong) tier defaults to Pro. If the
 * runtime and the UI disagree here, the app silently generates complex PRD
 * sections / high-complexity artifacts on Flash while Settings claims Pro.
 */
export const DEFAULT_FAST_MODEL = DEFAULT_GEMINI_MODEL;
export const DEFAULT_STRONG_MODEL = 'gemini-3.1-pro-preview';

/** The single "Default model" override, when the user has set one. */
const getStoredDefaultModel = () => localStorage.getItem('GEMINI_MODEL') || '';

const getModel = () => getStoredDefaultModel() || DEFAULT_GEMINI_MODEL;

// Resolution order per tier: explicit tier override → the single Default model
// override (so "set both to the same model" still works) → the tier default.
// The final fallback is the crux: the strong tier defaults to Pro (matching the
// UI), NOT to the Flash global default.
export const getFastModel = (): string =>
    localStorage.getItem('GEMINI_FAST_MODEL') || getStoredDefaultModel() || DEFAULT_FAST_MODEL;

export const getStrongModel = (): string =>
    localStorage.getItem('GEMINI_STRONG_MODEL') || getStoredDefaultModel() || DEFAULT_STRONG_MODEL;

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

// On mobile Safari, a transient connection drop during a long-running fetch
// (the PRD pipeline can take 60–90s end-to-end) surfaces as a generic
// `TypeError: Load failed`. Without retry, a single drop kills the whole
// generation. We retry connection-level failures with exponential backoff;
// any non-network error (auth, quota, abort, HTTP 4xx/5xx returned by the
// server) bypasses retry and propagates immediately.
const MAX_FETCH_RETRIES = 3;
const RETRY_BASE_MS = 1000;

/**
 * Hard ceiling on how long a single request may sit without producing any
 * data. A hung connection (common on mobile Safari after a network handoff)
 * otherwise waits forever — no error, no retry, no way for the UI to recover.
 * Streaming calls reset the clock on every received chunk, so an actively
 * streaming response is never killed mid-flight; only true silence trips it.
 */
export const GEMINI_TIMEOUT_MS = 120_000;

export class GeminiTimeoutError extends Error {
    constructor(ms: number) {
        super(`Gemini did not respond within ${Math.round(ms / 1000)}s. The connection may have dropped — retrying usually fixes this.`);
        this.name = 'GeminiTimeoutError';
    }
}

export const isRetryableNetworkError = (e: unknown): boolean => {
    if (e instanceof DOMException && e.name === 'AbortError') return false;
    if (e instanceof GeminiTimeoutError) return true;
    if (!(e instanceof Error)) return false;
    const msg = e.message.toLowerCase();
    return (
        msg.includes('load failed') ||
        msg.includes('failed to fetch') ||
        msg.includes('networkerror') ||
        msg.includes('network request failed') ||
        msg.startsWith('net::')
    );
};

/**
 * Combine the caller's AbortSignal with an inactivity watchdog. The returned
 * signal aborts when either the caller aborts or `ms` elapses without a
 * `touch()`. `timedOut()` distinguishes the watchdog firing from a real user
 * cancel so callers can rethrow a retryable GeminiTimeoutError instead of a
 * terminal AbortError.
 */
const createWatchdog = (ms: number, upstream?: AbortSignal) => {
    const controller = new AbortController();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const touch = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, ms);
    };
    const onUpstreamAbort = () => controller.abort();
    if (upstream?.aborted) controller.abort();
    else upstream?.addEventListener('abort', onUpstreamAbort, { once: true });
    touch();
    return {
        signal: controller.signal,
        touch,
        timedOut: () => timedOut,
        dispose: () => {
            clearTimeout(timer);
            upstream?.removeEventListener('abort', onUpstreamAbort);
        },
    };
};

const sleepWithAbort = (ms: number, signal?: AbortSignal): Promise<void> =>
    new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
        const t = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => {
            clearTimeout(t);
            reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
    });

const fetchWithRetry = async (url: string, init: RequestInit): Promise<Response> => {
    const signal = init.signal as AbortSignal | undefined;
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_FETCH_RETRIES; attempt++) {
        try {
            return await fetch(url, init);
        } catch (e) {
            lastError = e;
            if (!isRetryableNetworkError(e) || attempt === MAX_FETCH_RETRIES) throw e;
            const delay = RETRY_BASE_MS * 2 ** attempt;
            console.warn(`[gemini] fetch failed (${(e as Error).message}); retrying in ${delay}ms (attempt ${attempt + 2}/${MAX_FETCH_RETRIES + 1})`);
            await sleepWithAbort(delay, signal);
        }
    }
    throw lastError;
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
            'in Settings so Synapse sends x-goog-user-project; (3) preview models (e.g. Gemini 3.1 Flash-Lite Preview) ' +
            'have reduced quotas even on paid tier — switch to a GA model like gemini-3.5-flash. ' +
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
        const generationConfig: Record<string, unknown> = {
            ...(jsonMode.responseMimeType ? { responseMimeType: jsonMode.responseMimeType } : {}),
            ...(jsonMode.responseSchema ? { responseSchema: jsonMode.responseSchema } : {}),
            ...(typeof jsonMode.temperature === 'number' ? { temperature: jsonMode.temperature } : {}),
            ...(typeof jsonMode.topP === 'number' ? { topP: jsonMode.topP } : {}),
            ...(typeof jsonMode.topK === 'number' ? { topK: jsonMode.topK } : {}),
            ...(typeof jsonMode.maxOutputTokens === 'number' ? { maxOutputTokens: jsonMode.maxOutputTokens } : {}),
        };
        // A model-only override (no schema/params) carries no generationConfig.
        if (Object.keys(generationConfig).length > 0) {
            body.generationConfig = generationConfig;
        }
    }

    const trace = beginTrace({
        model,
        mode: jsonMode?.responseMimeType === 'application/json' ? 'json' : 'text',
        systemInstruction,
        promptText,
        requestUrl: url,
        requestBody: body,
        meta: jsonMode?.traceMeta,
    });

    const watchdog = createWatchdog(GEMINI_TIMEOUT_MS, signal);
    let data: {
        candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string }> } }>;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
    } | undefined;
    try {
        const response = await fetchWithRetry(url, {
            method: 'POST',
            headers: buildHeaders(apiKey),
            body: JSON.stringify(body),
            signal: watchdog.signal,
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => null);
            throw new Error(formatGeminiError(`${response.status} ${response.statusText}`.trim(), errorData));
        }

        data = await response.json();
    } catch (e) {
        if (watchdog.timedOut()) {
            const timeout = new GeminiTimeoutError(GEMINI_TIMEOUT_MS);
            trace.finishError(timeout);
            throw timeout;
        }
        trace.finishError(e);
        throw e;
    } finally {
        watchdog.dispose();
    }

    // Safely extract text — Gemini may return no candidates (e.g. safety block)
    // or candidates with no content/parts.
    const candidate = data?.candidates?.[0];
    const finishReason = candidate?.finishReason;
    if (finishReason === 'SAFETY') {
        const safetyErr = new Error('Gemini refused to generate content due to safety filters. Try adjusting your prompt or PRD content.');
        trace.finishError(safetyErr, { finishReason });
        throw safetyErr;
    }
    const text: string | undefined = candidate?.content?.parts?.[0]?.text;
    if (!text) {
        const reason = finishReason ? ` (finishReason: ${finishReason})` : '';
        const emptyErr = new Error(`Gemini returned an empty response${reason}. Please try again.`);
        trace.finishError(emptyErr, { finishReason });
        throw emptyErr;
    }
    jsonMode?.onFinish?.({ finishReason });
    // Surface token usage to any observer (Metrics dashboard). Gemini returns
    // these on the top-level `usageMetadata`; absent on some error/partial
    // responses, in which case we simply skip the callback.
    let usage: GeminiTokenUsage | undefined;
    if (data?.usageMetadata) {
        const u = data.usageMetadata;
        usage = {
            inputTokens: u.promptTokenCount ?? 0,
            outputTokens: u.candidatesTokenCount ?? 0,
            totalTokens: u.totalTokenCount ?? (u.promptTokenCount ?? 0) + (u.candidatesTokenCount ?? 0),
        };
        jsonMode?.onUsage?.(usage);
    }
    // Record the trace (developer-only; no-op when capture is disabled). For
    // JSON-mode calls, attempt a parse so the viewer's Parsed Result tab and
    // validation status are populated at the chokepoint.
    if (trace.id) {
        let parsedJson: unknown;
        let jsonParsed: boolean | undefined;
        if (jsonMode?.responseMimeType === 'application/json') {
            try {
                parsedJson = JSON.parse(text);
                jsonParsed = true;
            } catch {
                jsonParsed = false;
            }
        }
        trace.finishSuccess({
            rawResponse: text,
            parsedJson,
            usage,
            finishReason,
            validation: { jsonParsed, finishReason },
        });
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
    jsonMode?: JsonModeConfig,
): Promise<string> => {
    const startTime = performance.now();
    const apiKey = getApiKey();
    const model = jsonMode?.model || getModel();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`;

    const body: Record<string, unknown> = {
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ parts: [{ text: promptText }] }],
    };

    if (jsonMode) {
        const generationConfig: Record<string, unknown> = {
            ...(jsonMode.responseMimeType ? { responseMimeType: jsonMode.responseMimeType } : {}),
            ...(jsonMode.responseSchema ? { responseSchema: jsonMode.responseSchema } : {}),
            ...(typeof jsonMode.temperature === 'number' ? { temperature: jsonMode.temperature } : {}),
            ...(typeof jsonMode.topP === 'number' ? { topP: jsonMode.topP } : {}),
            ...(typeof jsonMode.topK === 'number' ? { topK: jsonMode.topK } : {}),
            ...(typeof jsonMode.maxOutputTokens === 'number' ? { maxOutputTokens: jsonMode.maxOutputTokens } : {}),
        };
        // A model-only override (no schema/params) carries no generationConfig.
        if (Object.keys(generationConfig).length > 0) {
            body.generationConfig = generationConfig;
        }
    }
    const bodyJson = JSON.stringify(body);

    const trace = beginTrace({
        model,
        mode: 'stream',
        systemInstruction,
        promptText,
        requestUrl: url,
        requestBody: body,
        meta: jsonMode?.traceMeta,
    });

    // Run a single stream attempt: connect, read SSE chunks, return the full
    // accumulated text along with the latest finishReason reported by the
    // server. Errors propagate to the outer retry loop so a mid-stream
    // network drop can be retried from byte zero with a fresh fetch.
    const streamOnce = async (): Promise<{ fullText: string; finishReason?: string; usage?: GeminiTokenUsage }> => {
        // Watchdog is per-attempt: each retry gets a fresh inactivity window,
        // and every received chunk resets it — only true silence times out.
        const watchdog = createWatchdog(GEMINI_TIMEOUT_MS, signal);
        let reader: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>> | undefined;
        try {
            const response = await fetchWithRetry(url, {
                method: 'POST',
                headers: buildHeaders(apiKey),
                body: bodyJson,
                signal: watchdog.signal,
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => null);
                throw new Error(formatGeminiError(`${response.status} ${response.statusText}`.trim(), errorData));
            }

            reader = response.body?.getReader();
            if (!reader) throw new Error('No response body for streaming');

            const decoder = new TextDecoder();
            let fullText = '';
            let buffer = '';
            let finishReason: string | undefined;
            let usage: GeminiTokenUsage | undefined;

            while (true) {
                const { done, value } = await reader.read();
                watchdog.touch();
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
                        const candidate = chunk.candidates?.[0];
                        const text = candidate?.content?.parts?.[0]?.text;
                        if (text) {
                            fullText += text;
                            callbacks.onChunk(text);
                        }
                        if (candidate?.finishReason) {
                            finishReason = candidate.finishReason;
                        }
                        // Gemini reports token usage on the final SSE chunk. The
                        // non-streaming path parses this too; capturing it here
                        // closes the artifact-generation token-metrics gap.
                        const u = chunk.usageMetadata;
                        if (u) {
                            usage = {
                                inputTokens: u.promptTokenCount ?? 0,
                                outputTokens: u.candidatesTokenCount ?? 0,
                                totalTokens: u.totalTokenCount ?? (u.promptTokenCount ?? 0) + (u.candidatesTokenCount ?? 0),
                            };
                        }
                    } catch {
                        // Skip malformed JSON chunks
                    }
                }
            }

            return { fullText, finishReason, usage };
        } catch (e) {
            if (watchdog.timedOut()) {
                reader?.cancel().catch(() => undefined);
                throw new GeminiTimeoutError(GEMINI_TIMEOUT_MS);
            }
            if (signal?.aborted) {
                reader?.cancel().catch(() => undefined);
                throw new DOMException('Aborted', 'AbortError');
            }
            throw e;
        } finally {
            watchdog.dispose();
        }
    };

    // Retry the entire stream (fetch + reader) on transient network errors.
    // fetchWithRetry only covers connection setup; mid-stream socket failures
    // surface here as `TypeError: Load failed` (Safari) or similar and would
    // otherwise kill a long-running PRD generation outright.
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_FETCH_RETRIES; attempt++) {
        try {
            const { fullText, finishReason, usage } = await streamOnce();
            const durationMs = performance.now() - startTime;
            console.log(`[GEN] callGeminiStream: ${durationMs.toFixed(0)}ms (${fullText.length} chars, finishReason=${finishReason ?? 'unknown'}, attempts=${attempt + 1})`);
            if (usage) jsonMode?.onUsage?.(usage);
            if (trace.id) {
                let parsedJson: unknown;
                let jsonParsed: boolean | undefined;
                if (jsonMode?.responseMimeType === 'application/json') {
                    try {
                        parsedJson = JSON.parse(fullText);
                        jsonParsed = true;
                    } catch {
                        jsonParsed = false;
                    }
                }
                trace.finishSuccess({
                    rawResponse: fullText,
                    parsedJson,
                    usage,
                    finishReason,
                    retryCount: attempt,
                    validation: { jsonParsed, finishReason },
                });
            }
            callbacks.onFinish?.({ finishReason });
            callbacks.onComplete(fullText);
            return fullText;
        } catch (e) {
            lastError = e;
            if (!isRetryableNetworkError(e) || attempt === MAX_FETCH_RETRIES) {
                trace.finishError(e, { retryCount: attempt });
                if (e instanceof Error) callbacks.onError(e);
                throw e;
            }
            const delay = RETRY_BASE_MS * 2 ** attempt;
            console.warn(`[gemini] stream failed (${(e as Error).message}); retrying in ${delay}ms (attempt ${attempt + 2}/${MAX_FETCH_RETRIES + 1})`);
            await sleepWithAbort(delay, signal);
            callbacks.onRestart?.();
        }
    }
    // Unreachable — the loop either returns or throws — but keeps TS happy.
    throw lastError;
};
