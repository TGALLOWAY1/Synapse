// LLM Trace recorder — the capture engine.
//
// Every LLM call in Synapse flows through the geminiClient chokepoint, which
// calls `beginTrace()` at the start of a call and `finish*()` at the end. When
// capture is DISABLED (the default), `beginTrace` returns a no-op handle so
// there is zero overhead and nothing is stored. When ENABLED, the completed
// trace is pushed to an in-memory registry (subscribable by the viewer via
// useSyncExternalStore) and persisted to IndexedDB for after-the-fact
// inspection.
//
// This is a DEVELOPER-ONLY surface. Secrets are redacted at capture time
// (traceRedaction) so credentials never reach the registry or disk.

import type {
    LlmCallMode,
    LlmTokenUsage,
    LlmTraceCall,
    LlmTraceMeta,
    LlmTraceValidation,
} from './traceTypes';
import { redactJsonString, redactText } from './traceRedaction';
import { getAllTraces, putTrace, clearTraces as clearPersistedTraces, pruneTraces } from './traceStore';

const ENABLE_KEY = 'synapse-llm-trace';
// Keep the live in-memory registry bounded independently of IndexedDB — the
// viewer renders from this, and unbounded growth would leak memory over a long
// debugging session.
const MEMORY_CAP = 1000;

// ─── Enable flag ──────────────────────────────────────────────────────────────

export const isTraceCaptureEnabled = (): boolean => {
    try {
        if (typeof localStorage !== 'undefined' && localStorage.getItem(ENABLE_KEY) === '1') {
            return true;
        }
        if (typeof location !== 'undefined' && location.search.includes('llmtrace')) {
            return true;
        }
    } catch {
        // localStorage unavailable — capture stays off.
    }
    return false;
};

export const setTraceCaptureEnabled = (enabled: boolean): void => {
    try {
        if (enabled) localStorage.setItem(ENABLE_KEY, '1');
        else localStorage.removeItem(ENABLE_KEY);
    } catch {
        // ignore — quota / privacy mode
    }
    notify();
};

// ─── In-memory registry + subscription ─────────────────────────────────────────

let traces: LlmTraceCall[] = [];
let hydrated = false;
const listeners = new Set<() => void>();

const notify = (): void => {
    for (const l of listeners) l();
};

export const subscribeTraces = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

/** Stable snapshot for useSyncExternalStore — reference changes only on mutation. */
export const getTracesSnapshot = (): LlmTraceCall[] => traces;

const upsert = (trace: LlmTraceCall): void => {
    const idx = traces.findIndex((t) => t.id === trace.id);
    let next: LlmTraceCall[];
    if (idx >= 0) {
        next = traces.slice();
        next[idx] = trace;
    } else {
        next = [...traces, trace];
    }
    // Keep newest MEMORY_CAP by createdAt.
    if (next.length > MEMORY_CAP) {
        next = next.sort((a, b) => a.createdAt - b.createdAt).slice(next.length - MEMORY_CAP);
    }
    traces = next;
    notify();
};

/** Load persisted traces from IndexedDB into memory (idempotent, deduped). */
export const hydrateTraces = async (force = false): Promise<void> => {
    if (hydrated && !force) return;
    hydrated = true;
    try {
        const stored = await getAllTraces();
        const byId = new Map<string, LlmTraceCall>();
        for (const t of stored) byId.set(t.id, t);
        for (const t of traces) byId.set(t.id, t);
        traces = Array.from(byId.values()).sort((a, b) => a.createdAt - b.createdAt).slice(-MEMORY_CAP);
        notify();
    } catch {
        // fine — memory-only
    }
};

export const clearAllTraces = async (): Promise<void> => {
    traces = [];
    notify();
    await clearPersistedTraces();
};

// ─── Capture handle ─────────────────────────────────────────────────────────────

export interface TraceInput {
    provider?: string;
    model: string;
    mode: LlmCallMode;
    systemInstruction: string;
    promptText: string;
    requestUrl: string;
    requestBody: unknown;
    meta?: LlmTraceMeta;
}

export interface TraceFinishSuccess {
    rawResponse: string;
    parsedJson?: unknown;
    usage?: LlmTokenUsage;
    finishReason?: string;
    retryCount?: number;
    validation?: LlmTraceValidation;
}

export interface TraceHandle {
    /** The id of the trace being captured, or undefined when capture is off. */
    readonly id: string | undefined;
    finishSuccess: (result: TraceFinishSuccess) => void;
    finishError: (error: unknown, extra?: { retryCount?: number; finishReason?: string }) => void;
    /** Merge additional validation info onto the in-flight trace. */
    annotate: (validation: LlmTraceValidation) => void;
}

const NOOP_HANDLE: TraceHandle = {
    id: undefined,
    finishSuccess: () => {},
    finishError: () => {},
    annotate: () => {},
};

const genId = (): string => {
    try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
    } catch {
        // fall through
    }
    return `trace-${Date.now()}-${Math.floor(Math.random() * 1e9).toString(36)}`;
};

const persist = (trace: LlmTraceCall): void => {
    void putTrace(trace).then(() => {
        // Occasionally prune so the store stays bounded without doing it every call.
        if (Math.random() < 0.05) void pruneTraces();
    });
};

/**
 * Begin capturing a call. Returns a no-op handle (zero cost) when capture is
 * disabled, so callers can unconditionally wrap every call.
 */
export const beginTrace = (input: TraceInput): TraceHandle => {
    if (!isTraceCaptureEnabled()) return NOOP_HANDLE;

    const id = genId();
    const startedAt = Date.now();
    const systemInstruction = redactText(input.systemInstruction);
    const promptText = redactText(input.promptText);
    const requestBody = redactJsonString(input.requestBody);

    const base: LlmTraceCall = {
        id,
        createdAt: startedAt,
        provider: input.provider ?? 'gemini',
        model: input.model,
        mode: input.mode,
        status: 'success',
        startedAt,
        endedAt: startedAt,
        durationMs: 0,
        systemInstruction,
        promptText,
        messages: [
            ...(systemInstruction ? [{ role: 'system' as const, content: systemInstruction }] : []),
            { role: 'user' as const, content: promptText },
        ],
        requestBody,
        requestUrl: redactText(input.requestUrl),
        rawResponse: '',
        retryCount: 0,
        meta: input.meta ?? {},
    };

    let current = base;

    const commit = (patch: Partial<LlmTraceCall>): void => {
        const endedAt = Date.now();
        current = { ...current, ...patch, endedAt, durationMs: endedAt - current.startedAt };
        upsert(current);
        persist(current);
    };

    return {
        id,
        finishSuccess: (result) => {
            commit({
                status: 'success',
                rawResponse: redactText(result.rawResponse),
                parsedJson: result.parsedJson,
                extractedText: redactText(result.rawResponse),
                usage: result.usage,
                finishReason: result.finishReason,
                retryCount: result.retryCount ?? 0,
                validation: {
                    ...current.validation,
                    ...result.validation,
                    finishReason: result.finishReason ?? current.validation?.finishReason,
                },
            });
        },
        finishError: (error, extra) => {
            commit({
                status: 'error',
                error: redactText(error instanceof Error ? error.message : String(error)),
                retryCount: extra?.retryCount ?? current.retryCount,
                finishReason: extra?.finishReason,
            });
        },
        annotate: (validation) => {
            current = {
                ...current,
                validation: { ...current.validation, ...validation },
            };
            upsert(current);
            persist(current);
        },
    };
};
