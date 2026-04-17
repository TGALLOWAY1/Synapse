/**
 * Centralized error normalization and user-friendly formatting.
 *
 * Every catch block in Synapse should use `normalizeError()` instead of
 * ad-hoc `e instanceof Error ? e.message : String(e)` patterns, and
 * `userMessage()` for anything shown in the UI.
 */

export type ErrorCategory =
    | 'api_key_missing'
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

const CATEGORY_PATTERNS: [ErrorCategory, RegExp][] = [
    ['api_key_missing', /missing gemini api key/i],
    ['free_tier_quota', /free.?tier|freetier|-FreeTier/i],
    ['rate_limited', /429|resource exhausted|too many requests/i],
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

const USER_MESSAGES: Record<ErrorCategory, string> = {
    api_key_missing: 'API key not configured. Open Settings to add your Gemini API key.',
    rate_limited: 'Too many requests. Wait a moment and try again.',
    free_tier_quota:
        'Request hit the Gemini free-tier quota. Open Settings and set your Billing Project ID, ' +
        'or recreate the API key on a project with billing enabled. Preview models also have ' +
        'capped quotas — switch to a stable model if this keeps happening.',
    safety_blocked: 'Content was blocked by safety filters. Try adjusting your prompt.',
    empty_response: 'No content was generated. Please try again.',
    network: 'Network error. Check your internet connection and try again.',
    parse_failure: 'The response could not be processed. Please try again.',
    unknown: 'Something went wrong. Please try again.',
};

/** Return a calm, human-readable message suitable for product UI. */
export function userMessage(err: NormalizedError): string {
    return USER_MESSAGES[err.category];
}
