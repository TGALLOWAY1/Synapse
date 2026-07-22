// Pre-generation safety classifier. Runs once before any PRD/artifact
// generation begins. Returns a structured verdict that the generation gate in
// prdService.ts acts on.
//
// Safety is top priority (fail-closed): if the classifier cannot reach a
// verdict — a non-config transport error, or output that doesn't parse into a
// valid result — the request is treated as `disallowed`. Genuine *config*
// errors (missing/invalid API key, billing, permissions) are re-thrown so they
// surface through the normal error path and the user can fix them.

import { callGemini, type JsonModeConfig } from '../geminiClient';
import { normalizeError } from '../errors';
import { safetyClassificationSchema } from '../schemas/safetySchemas';
import { repairTruncatedJson } from '../jsonRepair';
import type {
    SafetyClassification,
    SafetyClassificationResult,
    SafetyConfidence,
} from './safetyTypes';
import { DEFAULT_SAFE_ALTERNATIVES } from './safetyTypes';
import { renderClassifierInstruction } from './safetyPolicy';

/** Injectable transport so tests can run without hitting the network. */
export type SafetyTransport = (
    system: string,
    prompt: string,
    jsonMode: JsonModeConfig,
) => Promise<string>;

const defaultTransport: SafetyTransport = (system, prompt, jsonMode) =>
    callGemini(system, prompt, jsonMode);

// Config-level failures are not safety decisions — re-throw them so the user
// gets the normal "fix your API key / billing" guidance instead of a block.
const CONFIG_ERROR_CATEGORIES = new Set([
    'api_key_missing',
    'auth_failed',
    'billing_disabled',
    'permission_denied',
    'project_access_denied',
]);

// Policy text lives in safetyPolicy.ts (the single source shared with the
// in-prompt SAFETY_OVERRIDE and the concern-summary fallbacks).
const SYSTEM_INSTRUCTION = renderClassifierInstruction();

const VALID_CLASSIFICATIONS: SafetyClassification[] = [
    'allowed',
    'allowed_with_restrictions',
    'disallowed',
];
const VALID_CONFIDENCE: SafetyConfidence[] = ['low', 'medium', 'high'];

const asStringArray = (value: unknown): string[] =>
    Array.isArray(value)
        ? value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
        : [];

/** Synthesized fail-closed verdict used when classification cannot be trusted. */
const failClosedResult = (): SafetyClassificationResult => ({
    classification: 'disallowed',
    confidence: 'low',
    detectedConcerns: ['safety classification could not be completed'],
    userFacingReason:
        'Synapse could not verify that this request is safe to build, so generation was stopped. ' +
        'Please revise the request or try again.',
    safeAlternatives: DEFAULT_SAFE_ALTERNATIVES,
});

const parseResult = (raw: string): SafetyClassificationResult | null => {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        const { text, repaired } = repairTruncatedJson(raw);
        if (!repaired) return null;
        try {
            parsed = JSON.parse(text);
        } catch {
            return null;
        }
    }

    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;

    const classification = obj.classification as SafetyClassification;
    if (!VALID_CLASSIFICATIONS.includes(classification)) return null;

    const confidence = VALID_CONFIDENCE.includes(obj.confidence as SafetyConfidence)
        ? (obj.confidence as SafetyConfidence)
        : 'medium';

    return {
        classification,
        confidence,
        detectedConcerns: asStringArray(obj.detectedConcerns),
        userFacingReason:
            typeof obj.userFacingReason === 'string' ? obj.userFacingReason : '',
        safeAlternatives: asStringArray(obj.safeAlternatives),
    };
};

// Session-scoped memo of genuine model verdicts, keyed on the exact idea text.
// A preflighted run classifies the same text twice within seconds (preflight
// gate, then the PRD gate) — the second call is pure duplicate spend. Only
// real parsed verdicts are cached (never the fail-closed fallback, so a
// transient failure is always re-classified), and only for the default
// transport (injected test transports must never see another call's result).
// In-memory only; a reload re-classifies.
const verdictCache = new Map<string, SafetyClassificationResult>();
const VERDICT_CACHE_MAX = 20;

export async function classifyProjectSafety(
    promptText: string,
    opts?: { signal?: AbortSignal; transport?: SafetyTransport },
): Promise<SafetyClassificationResult> {
    const transport = opts?.transport ?? defaultTransport;
    const cacheable = !opts?.transport;
    if (cacheable) {
        const cached = verdictCache.get(promptText);
        if (cached) return cached;
    }

    let raw: string;
    try {
        raw = await transport(SYSTEM_INSTRUCTION, promptText, {
            responseMimeType: 'application/json',
            responseSchema: safetyClassificationSchema,
            temperature: 0.1,
            topP: 0.9,
            maxOutputTokens: 1024,
            traceMeta: {
                stage: 'Safety',
                purpose: 'Classify project safety',
                artifact: 'safety_classification',
                inputs: ['Product idea'],
            },
        });
    } catch (e) {
        // Config errors aren't safety verdicts — surface them normally.
        if (CONFIG_ERROR_CATEGORIES.has(normalizeError(e).category)) throw e;
        // Anything else (network, parse, model refusal): fail closed.
        console.warn('[safety] classifier transport failed; failing closed', e);
        return failClosedResult();
    }

    const result = parseResult(raw);
    if (!result) {
        console.warn('[safety] classifier returned unparseable output; failing closed');
        return failClosedResult();
    }
    if (cacheable) {
        if (verdictCache.size >= VERDICT_CACHE_MAX) {
            const oldest = verdictCache.keys().next().value;
            if (oldest !== undefined) verdictCache.delete(oldest);
        }
        verdictCache.set(promptText, result);
    }
    return result;
}
