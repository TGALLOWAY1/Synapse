// LLM Trace Viewer — shared type contract.
//
// A "trace" is a full, unredacted-except-secrets record of a single LLM call
// made anywhere in Synapse. Every call flows through the geminiClient
// chokepoint (`callGemini` / `callGeminiStream`), which is where traces are
// captured. This is a DEVELOPER-ONLY debugging surface (owner-gated) — it is
// never shown to normal users and never affects generation behavior.
//
// These types live in their own module (no store/React imports) so they can be
// consumed by the pure recorder, the IndexedDB store, and the viewer alike.

export type LlmTraceProvider = 'gemini' | string;

/** How the model was invoked. */
export type LlmCallMode = 'json' | 'text' | 'stream';

export type LlmTraceStatus = 'success' | 'error';

/** A single message in the request (Synapse uses a flat system + user shape). */
export interface LlmTraceMessage {
    role: 'system' | 'user' | 'developer';
    content: string;
}

/**
 * A single piece of context that contributed to prompt construction, with a
 * human-readable label and where it came from. Powers the Context tab.
 */
export interface LlmTraceContextItem {
    label: string;
    /** Where this piece came from, e.g. "PRD Spine", "Previous artifact". */
    source: string;
    /** Optional short excerpt / detail (already redacted). */
    detail?: string;
}

/**
 * A named prompt-assembly component and whether it was present in this call.
 * Powers the Prompt Construction tab (debugging prompt contamination).
 */
export interface LlmPromptPiece {
    label: string;
    present: boolean;
    detail?: string;
}

/**
 * Post-response validation / repair outcome. Filled in by the call site after
 * it parses/validates the response (via `annotateTrace`), so it is all
 * optional — a raw auto-captured trace has none of it.
 */
export interface LlmTraceValidation {
    jsonParsed?: boolean;
    schemaValid?: boolean;
    parserWarnings?: string[];
    /** Deterministic repairs applied (e.g. "Duplicate permissions removed"). */
    repairs?: string[];
    /** Why the call was retried, if it was a retry of a prior failure. */
    retryReason?: string;
    finishReason?: string;
    notes?: string[];
}

/**
 * Caller-supplied enrichment. Optional on every field — a call with no
 * `traceMeta` is still captured (raw), just with fewer human labels. Passed
 * through `JsonModeConfig.traceMeta`.
 */
export interface LlmTraceMeta {
    /** Groups all calls of one generation run into a session. */
    sessionId?: string;
    sessionLabel?: string;
    /** Coarse pipeline stage, e.g. "PRD", "Artifact", "Safety", "Preflight". */
    stage?: string;
    /** Human purpose, e.g. "Generate Permissions & Roles". */
    purpose?: string;
    /** The artifact / section id being generated, e.g. "features". */
    artifact?: string;
    projectId?: string;
    projectName?: string;
    /** Concise human-readable input summary lines. */
    inputs?: string[];
    contextItems?: LlmTraceContextItem[];
    promptPieces?: LlmPromptPiece[];
}

/** The complete captured record of one LLM call. */
export interface LlmTraceCall {
    id: string;
    /** epoch ms — capture time (start of the call). */
    createdAt: number;
    provider: LlmTraceProvider;
    model: string;
    mode: LlmCallMode;
    status: LlmTraceStatus;
    startedAt: number;
    endedAt: number;
    durationMs: number;
    systemInstruction: string;
    promptText: string;
    messages: LlmTraceMessage[];
    /** Request payload sent to the provider, as JSON string, secrets redacted. */
    requestBody: string;
    requestUrl: string;
    /** Complete model response text BEFORE parsing — never truncated. */
    rawResponse: string;
    /** Parsed JSON when the response parsed as JSON; undefined otherwise. */
    parsedJson?: unknown;
    /** Extracted markdown / text (same as rawResponse for text calls). */
    extractedText?: string;
    usage?: LlmTokenUsage;
    retryCount: number;
    finishReason?: string;
    error?: string;
    validation?: LlmTraceValidation;
    meta: LlmTraceMeta;
}

export interface LlmTokenUsage {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
}

/** A generation session — a group of calls sharing a sessionId (or heuristic). */
export interface LlmTraceSession {
    id: string;
    label: string;
    stage?: string;
    projectId?: string;
    projectName?: string;
    startedAt: number;
    endedAt: number;
    calls: LlmTraceCall[];
}
