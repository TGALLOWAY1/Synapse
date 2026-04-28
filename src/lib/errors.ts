/**
 * Centralized error normalization and user-friendly formatting.
 *
 * Every catch block in Synapse should use `normalizeError()` instead of
 * ad-hoc `e instanceof Error ? e.message : String(e)` patterns, and
 * `userMessage()` for anything shown in the UI.
 */

export type ErrorCategory =
    | 'api_key_missing'
    | 'auth_failed'
    | 'permission_denied'
    | 'billing_disabled'
    | 'model_not_found'
    | 'bad_request'
    | 'rate_limited'
    | 'free_tier_quota'
    | 'safety_blocked'
    | 'empty_response'
    | 'network'
    | 'parse_failure'
    | 'unknown';

export interface NormalizedError {
    message: string;
    category: ErrorCategory;
    raw: string;
    timestamp: number;
}

// Order matters — first match wins. Specific paid-tier failures must come
// before the broader `free_tier_quota` and `rate_limited` patterns so a 403
// with a "billing disabled" message doesn't get mis-classified as a quota hit.
const CATEGORY_PATTERNS: [ErrorCategory, RegExp][] = [
    ['api_key_missing', /missing gemini api key/i],
    ['billing_disabled', /billing.*(not enabled|disabled)|enable billing|consumer.*not.*active|SERVICE_DISABLED/i],
    ['auth_failed', /api key not valid|api[_ ]?key.*invalid|invalid.*api.*key|UNAUTHENTICATED|\b401\b/i],
    ['permission_denied', /permission denied|PERMISSION_DENIED|forbidden|\b403\b/i],
    ['model_not_found', /publisher model.*not found|model.*not.*found|NOT_FOUND.*model|\b404\b.*model|is not supported/i],
    ['free_tier_quota', /free.?tier|freetier|-FreeTier/i],
    ['rate_limited', /\b429\b|resource exhausted|too many requests/i],
    ['bad_request', /INVALID_ARGUMENT|\b400\b/i],
    ['safety_blocked', /safety filter/i],
    ['empty_response', /empty response/i],
    ['network', /failed to fetch|networkerror|load failed|net::/i],
    ['parse_failure', /failed to parse|invalid json|json\.parse|non-object response/i],
];

function classifyError(message: string): ErrorCategory {
    for (const [category, pattern] of CATEGORY_PATTERNS) {
        if (pattern.test(message)) return category;
    }
    return 'unknown';
}

/** Extract a message string from any thrown value. */
export function normalizeError(e: unknown): NormalizedError {
    const raw = e instanceof Error ? e.message : String(e);
    const category = classifyError(raw);
    return {
        message: raw,
        category,
        raw,
        timestamp: Date.now(),
    };
}

const USER_MESSAGES: Record<Exclude<ErrorCategory, 'unknown'>, string> = {
    api_key_missing: 'API key not configured. Open Settings to add your Gemini API key.',
    auth_failed:
        'Gemini rejected the API key as invalid. Open Settings and paste a fresh key from ' +
        'https://aistudio.google.com/app/apikey — make sure you copy it from a project that has billing enabled.',
    permission_denied:
        'Gemini rejected the request: permission denied. Most common cause on paid tier: the ' +
        '"Generative Language API" is not enabled on your billing project. In Google Cloud Console, ' +
        'open APIs & Services → Library, search for "Generative Language API", and enable it on the ' +
        'project whose ID is in Settings.',
    billing_disabled:
        'Billing is not enabled on the Google Cloud project tied to this API key. Enable billing on ' +
        'that project (or switch to a key from a project that has billing enabled), then try again.',
    model_not_found:
        'The selected Gemini model is not available to your project. Open Settings and switch to a ' +
        'stable model like Gemini 2.5 Flash — preview model IDs (e.g. Gemini 3 Flash Preview) are ' +
        'sometimes renamed or restricted.',
    bad_request:
        'Gemini rejected the request as malformed. This usually means the selected model does not ' +
        'support structured JSON output, or the prompt is too long. Try a different model in Settings.',
    rate_limited: 'Too many requests. Wait a moment and try again.',
    free_tier_quota:
        'Request hit the Gemini free-tier quota. Open Settings and set your Billing Project ID, ' +
        'or recreate the API key on a project with billing enabled. Preview models also have ' +
        'capped quotas — switch to a stable model if this keeps happening.',
    safety_blocked: 'Content was blocked by safety filters. Try adjusting your prompt.',
    empty_response: 'No content was generated. Please try again.',
    network: 'Network error. Check your internet connection and try again.',
    parse_failure: 'The response could not be processed. Please try again.',
};

const RAW_TRUNCATE = 400;

/** Return a calm, human-readable message suitable for product UI. */
export function userMessage(err: NormalizedError): string {
    if (err.category === 'unknown') {
        // No specific category matched — surface the raw API response so the
        // user (especially on mobile, where DevTools is not available) has
        // something actionable to act on or share.
        const raw = err.raw.length > RAW_TRUNCATE ? `${err.raw.slice(0, RAW_TRUNCATE)}…` : err.raw;
        return `Something went wrong. Raw error from Gemini: ${raw}`;
    }
    return USER_MESSAGES[err.category];
}
