import { getCachedGeminiKey } from './geminiKeyVault';
import { getLocalCredential, GEMINI_API_KEY } from './localCredentials';
import { beginTrace, type TraceHandle } from './trace/traceRecorder';
import { redactText } from './trace/traceRedaction';
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
 * Default model. Gemini 3.8 Flash (GA, released September 2026) is the
 * recommended everyday Flash model — it replaced Gemini 3.7 Flash, shipping as
 * GA with full (non-preview) quotas and stronger long-horizon coding/agentic
 * performance. See SettingsModal for the full catalog and `modelMigration.ts`
 * for the one-shot upgrade of older Flash selections.
 */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

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
// generation. We retry connection-level failures with exponential backoff.
//
// Rate limits and transient server failures are retried the same way: the PRD
// pipeline runs several section calls concurrently (and the artifact bundle up
// to 4), so one 429 / 5xx burst used to fail sections that a short wait would
// have saved. `RETRYABLE_HTTP_STATUSES` is a closed list — every other 4xx
// (bad request, auth, not found, …) is deterministic and propagates
// immediately, as does a caller abort. Both kinds of retry share one budget of
// MAX_FETCH_RETRIES per request.
export const MAX_FETCH_RETRIES = 3;
const RETRY_BASE_MS = 1000;
const RETRYABLE_HTTP_STATUSES: ReadonlySet<number> = new Set([429, 500, 502, 503, 504]);

/**
 * Longest server-requested wait (`Retry-After`) we will sit through. A longer
 * request means the quota window is far away — holding the generation open
 * would only stall the UI — so the error surfaces instead of being retried.
 */
export const MAX_RETRY_AFTER_MS = 60_000;

export const isRetryableHttpStatus = (status: number): boolean => RETRYABLE_HTTP_STATUSES.has(status);

/**
 * Exponential backoff with proportional jitter: ≈1s, 2s, 4s for retries 1–3,
 * each stretched by up to 50% so concurrent calls that failed together (e.g.
 * parallel PRD sections hitting the same 429) don't retry in lockstep.
 */
export const backoffDelayMs = (attempt: number, random: () => number = Math.random): number => {
    const base = RETRY_BASE_MS * 2 ** attempt;
    return Math.round(base + base * 0.5 * random());
};

/**
 * Parse a `Retry-After` header (delta-seconds or an HTTP-date) into a wait in
 * ms. Null when absent or unparseable, so the caller falls back to backoff.
 */
export const parseRetryAfterMs = (value: string | null, now: number = Date.now()): number | null => {
    if (!value) return null;
    const trimmed = value.trim();
    if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000);
    const at = Date.parse(trimmed);
    if (Number.isNaN(at)) return null;
    return Math.max(0, at - now);
};

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

/**
 * A non-OK HTTP response from Gemini, thrown once any transport retries are
 * spent. Carries the status for callers; never classified as a network error
 * (its message quotes the response body, which may itself contain words like
 * "NetworkError" — that must not trigger another round of retries).
 */
export class GeminiHttpError extends Error {
    readonly status: number;
    constructor(status: number, message: string) {
        super(message);
        this.name = 'GeminiHttpError';
        this.status = status;
    }
}

export const isRetryableNetworkError = (e: unknown): boolean => {
    if (e instanceof DOMException && e.name === 'AbortError') return false;
    if (e instanceof GeminiHttpError) return false;
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

/** One transport-level retry decision (see fetchWithRetry). */
export interface GeminiRetryEvent {
    /** 1-based number of the retry about to be sent. */
    retry: number;
    /** Why the previous attempt is retried, e.g. "HTTP 429" or "network error: Load failed". */
    reason: string;
    /** Wait before the retry: the backoff, or the server's `Retry-After`. */
    delayMs: number;
}

interface FetchRetryHooks {
    /** Called once per retry, before its wait (trace + diagnostics). */
    onRetry?: (event: GeminiRetryEvent) => void;
    /**
     * Called whenever the transport itself makes progress (a response arrived,
     * a backoff wait finished) so the caller's inactivity watchdog measures
     * server silence only — never our own deliberate backoff.
     */
    touch?: () => void;
}

/**
 * fetch() with bounded retries for connection-level failures AND retryable
 * HTTP statuses (429 / 5xx — see RETRYABLE_HTTP_STATUSES). Resolves with the
 * first non-retryable response, or with the last retryable one once the budget
 * is spent (the caller turns it into an error message). Waits honor the
 * caller's abort signal, so a cancel during backoff rejects promptly. A
 * response is always received before any streamed content is delivered, so
 * status retries are safe for streaming calls too.
 */
const fetchWithRetry = async (url: string, init: RequestInit, hooks: FetchRetryHooks = {}): Promise<Response> => {
    const signal = init.signal as AbortSignal | undefined;
    for (let attempt = 0; ; attempt++) {
        let response: Response;
        try {
            response = await fetch(url, init);
        } catch (e) {
            if (!isRetryableNetworkError(e) || attempt >= MAX_FETCH_RETRIES) throw e;
            const delayMs = backoffDelayMs(attempt);
            console.warn(`[gemini] fetch failed (${(e as Error).message}); retrying in ${delayMs}ms (attempt ${attempt + 2}/${MAX_FETCH_RETRIES + 1})`);
            hooks.onRetry?.({ retry: attempt + 1, reason: `network error: ${(e as Error).message}`, delayMs });
            hooks.touch?.();
            await sleepWithAbort(delayMs, signal);
            hooks.touch?.();
            continue;
        }
        if (response.ok || !isRetryableHttpStatus(response.status) || attempt >= MAX_FETCH_RETRIES) {
            return response;
        }
        const retryAfterMs = parseRetryAfterMs(response.headers.get('Retry-After'));
        // The server asked for a longer pause than we will hold a generation
        // open for — surface the error now instead of stalling.
        if (retryAfterMs !== null && retryAfterMs > MAX_RETRY_AFTER_MS) return response;
        const delayMs = retryAfterMs ?? backoffDelayMs(attempt);
        // The discarded attempt's body is never read (only the final attempt's
        // body feeds the error message) — release its connection.
        response.body?.cancel().catch(() => undefined);
        console.warn(`[gemini] HTTP ${response.status}; retrying in ${delayMs}ms (attempt ${attempt + 2}/${MAX_FETCH_RETRIES + 1})`);
        hooks.onRetry?.({ retry: attempt + 1, reason: `HTTP ${response.status}`, delayMs });
        hooks.touch?.();
        await sleepWithAbort(delayMs, signal);
        hooks.touch?.();
    }
};

/** How much of a non-JSON (or message-less) error body the thrown message quotes. */
const ERROR_BODY_SNIPPET_CHARS = 200;

const bodySnippet = (rawBody: string): string => {
    // Collapse whitespace (HTML gateway pages are mostly newlines) and scrub
    // anything credential-shaped before it can reach a toast or a log.
    const collapsed = redactText(rawBody.replace(/\s+/g, ' ').trim());
    return collapsed.length > ERROR_BODY_SNIPPET_CHARS
        ? `${collapsed.slice(0, ERROR_BODY_SNIPPET_CHARS)}…`
        : collapsed;
};

/**
 * Turn a raw Gemini error payload into a more specific message when the
 * failure is a quota/rate-limit hit. We surface free-tier hits explicitly so
 * users know to check their billing project configuration rather than
 * assuming they just need to wait.
 */
const formatGeminiError = (status: string, errorData: unknown, rawBody = ''): string => {
    const raw = (errorData as { error?: { message?: string; status?: string } })?.error;
    // A body with no Gemini error message (an HTML gateway page, a truncated
    // reply, an empty 503) still says something useful — quote it instead of
    // the old opaque "Unknown error".
    const snippet = bodySnippet(rawBody);
    const message = raw?.message || (snippet ? `Unexpected response body: ${snippet}` : 'Empty response body');
    const isQuota = raw?.status === 'RESOURCE_EXHAUSTED' || /quota|resource.exhausted|rate.limit/i.test(message);
    if (isQuota && /free.?tier|freetier|-FreeTier/i.test(message)) {
        return (
            'Gemini quota error — your request hit the FREE-TIER quota even though you expect paid tier. ' +
            'Likely causes: (1) your API key is tied to a Google Cloud project without billing enabled — ' +
            'recreate the key in AI Studio on the project that has billing; (2) set your billing project ID ' +
            'in Settings so Synapse sends x-goog-user-project; (3) preview models (e.g. Gemini 3.1 Pro Preview) ' +
            'have reduced quotas even on paid tier — switch to a GA model like gemini-3.8-flash. ' +
            `Raw: ${message}`
        );
    }
    return `Gemini API Error: ${status} - ${message}`;
};

/**
 * Read a failed response's body (exactly once) and build the thrown message:
 * the HTTP status, Gemini's error message — or the first ~200 characters of a
 * non-JSON body — and how many transport retries preceded it.
 */
const describeHttpError = async (response: Response, retries: number): Promise<string> => {
    const status = `${response.status} ${response.statusText}`.trim();
    const rawBody = await response.text().catch(() => '');
    let errorData: unknown = null;
    try {
        errorData = rawBody ? JSON.parse(rawBody) : null;
    } catch {
        errorData = null;
    }
    const message = formatGeminiError(status, errorData, rawBody);
    return retries > 0 ? `${message} (after ${retries} ${retries === 1 ? 'retry' : 'retries'})` : message;
};

const SAFETY_REFUSAL_MESSAGE =
    'Gemini refused to generate content due to safety filters. Try adjusting your prompt or PRD content.';

/** The prompt itself was blocked (`promptFeedback.blockReason`), so no candidate came back. */
const promptBlockedMessage = (blockReason: string): string =>
    blockReason === 'SAFETY'
        ? SAFETY_REFUSAL_MESSAGE
        : `Gemini blocked this request (blockReason: ${blockReason}) and returned no content. Try adjusting your prompt or PRD content.`;

/** Record why a call needed transport retries on its trace (no-op when capture is off). */
const annotateRetries = (trace: TraceHandle, reasons: string[]): void => {
    if (reasons.length > 0) trace.annotate({ retryReason: reasons.join('; ') });
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
    // Transport retries (429 / 5xx / connection drops) for the trace + message.
    let retries = 0;
    const retryReasons: string[] = [];
    let data: {
        candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string }> } }>;
        promptFeedback?: { blockReason?: string };
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
    } | undefined;
    try {
        const response = await fetchWithRetry(url, {
            method: 'POST',
            headers: buildHeaders(apiKey),
            body: JSON.stringify(body),
            signal: watchdog.signal,
        }, {
            onRetry: (event) => {
                retries = event.retry;
                retryReasons.push(event.reason);
            },
            touch: watchdog.touch,
        });

        if (!response.ok) {
            throw new GeminiHttpError(response.status, await describeHttpError(response, retries));
        }

        data = await response.json();
    } catch (e) {
        annotateRetries(trace, retryReasons);
        if (watchdog.timedOut()) {
            const timeout = new GeminiTimeoutError(GEMINI_TIMEOUT_MS);
            trace.finishError(timeout, { retryCount: retries });
            throw timeout;
        }
        trace.finishError(e, { retryCount: retries });
        throw e;
    } finally {
        watchdog.dispose();
    }

    // Safely extract text — Gemini may return no candidates (e.g. safety block)
    // or candidates with no content/parts.
    const candidate = data?.candidates?.[0];
    const finishReason = candidate?.finishReason;
    if (finishReason === 'SAFETY') {
        const safetyErr = new Error(SAFETY_REFUSAL_MESSAGE);
        annotateRetries(trace, retryReasons);
        trace.finishError(safetyErr, { finishReason, retryCount: retries });
        throw safetyErr;
    }
    const text: string | undefined = candidate?.content?.parts?.[0]?.text;
    if (!text) {
        // A blocked prompt comes back with no candidate at all — name the block
        // instead of the generic "empty response".
        const blockReason = data?.promptFeedback?.blockReason;
        const reason = finishReason ? ` (finishReason: ${finishReason})` : '';
        const emptyErr = new Error(blockReason
            ? promptBlockedMessage(blockReason)
            : `Gemini returned an empty response${reason}. Please try again.`);
        annotateRetries(trace, retryReasons);
        trace.finishError(emptyErr, { finishReason, retryCount: retries });
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
            retryCount: retries,
            validation: {
                jsonParsed,
                finishReason,
                ...(retryReasons.length > 0 ? { retryReason: retryReasons.join('; ') } : {}),
            },
        });
    }
    const durationMs = performance.now() - startTime;
    console.log(`[GEN] callGemini: ${durationMs.toFixed(0)}ms (${text.length} chars${retries > 0 ? `, ${retries} transport retries` : ''})`);
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

    // Transport-level retries (429 / 5xx / connection drops before any content)
    // across every stream attempt, for the trace and diagnostics.
    let fetchRetries = 0;
    const retryReasons: string[] = [];

    // Run a single stream attempt: connect, read SSE chunks, return the full
    // accumulated text along with the latest finishReason reported by the
    // server. Errors propagate to the outer retry loop so a mid-stream
    // network drop can be retried from byte zero with a fresh fetch.
    const streamOnce = async (): Promise<{ fullText: string; finishReason?: string; usage?: GeminiTokenUsage }> => {
        // Watchdog is per-attempt: each retry gets a fresh inactivity window,
        // and every received chunk resets it — only true silence times out.
        const watchdog = createWatchdog(GEMINI_TIMEOUT_MS, signal);
        let reader: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>> | undefined;
        let attemptRetries = 0;
        try {
            // Status retries happen here, before the body is read — i.e. before
            // any chunk reaches the caller — so they never replay content.
            const response = await fetchWithRetry(url, {
                method: 'POST',
                headers: buildHeaders(apiKey),
                body: bodyJson,
                signal: watchdog.signal,
            }, {
                onRetry: (event) => {
                    attemptRetries += 1;
                    fetchRetries += 1;
                    retryReasons.push(event.reason);
                },
                touch: watchdog.touch,
            });

            if (!response.ok) {
                throw new GeminiHttpError(response.status, await describeHttpError(response, attemptRetries));
            }

            reader = response.body?.getReader();
            if (!reader) throw new Error('No response body for streaming');

            const decoder = new TextDecoder();
            let fullText = '';
            let buffer = '';
            let finishReason: string | undefined;
            let blockReason: string | undefined;
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
                        if (chunk.promptFeedback?.blockReason) {
                            blockReason = chunk.promptFeedback.blockReason;
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

            // A safety stop (or a blocked prompt) is a refusal, not a completion
            // — say so instead of handing callers a partial or empty body that
            // later fails as a generic parse error. Never retried.
            if (finishReason === 'SAFETY') throw new Error(SAFETY_REFUSAL_MESSAGE);
            if (!fullText && blockReason) throw new Error(promptBlockedMessage(blockReason));

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
            console.log(`[GEN] callGeminiStream: ${durationMs.toFixed(0)}ms (${fullText.length} chars, finishReason=${finishReason ?? 'unknown'}, attempts=${attempt + 1}, transportRetries=${fetchRetries})`);
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
                    retryCount: attempt + fetchRetries,
                    validation: {
                        jsonParsed,
                        finishReason,
                        ...(retryReasons.length > 0 ? { retryReason: retryReasons.join('; ') } : {}),
                    },
                });
            }
            callbacks.onFinish?.({ finishReason });
            callbacks.onComplete(fullText);
            return fullText;
        } catch (e) {
            lastError = e;
            if (!isRetryableNetworkError(e) || attempt === MAX_FETCH_RETRIES) {
                annotateRetries(trace, retryReasons);
                trace.finishError(e, { retryCount: attempt + fetchRetries });
                if (e instanceof Error) callbacks.onError(e);
                throw e;
            }
            const delay = backoffDelayMs(attempt);
            retryReasons.push(`stream restart: ${(e as Error).message}`);
            console.warn(`[gemini] stream failed (${(e as Error).message}); retrying in ${delay}ms (attempt ${attempt + 2}/${MAX_FETCH_RETRIES + 1})`);
            await sleepWithAbort(delay, signal);
            callbacks.onRestart?.();
        }
    }
    // Unreachable — the loop either returns or throws — but keeps TS happy.
    throw lastError;
};
